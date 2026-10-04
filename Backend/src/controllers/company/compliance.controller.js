// State tobacco/vapor rules, customer tobacco licences, and a compliance overview of products.
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { audit } = require("../../services/audit");
const compliance = require("../../services/compliance");

const getSettings = async (req, res) => {
  const [rules, products] = await Promise.all([
    prisma.compliance_rules.findMany({ where: { company_id: req.company.id }, orderBy: [{ state: "asc" }, { category: "asc" }] }),
    prisma.products.groupBy({ by: ["compliance_category"], where: { company_id: req.company.id, is_active: true }, _count: { _all: true } }),
  ]);
  const missingMl = await prisma.products.count({ where: { company_id: req.company.id, is_active: true, compliance_category: { in: ["e_liquid", "vapor_closed"] }, nicotine_ml: null } });
  res.json({
    data: {
      rules, states: compliance.STATES, categories: compliance.CATEGORIES, tax_types: compliance.TAX_TYPES,
      products: Object.fromEntries(products.map((p) => [p.compliance_category, p._count._all])), missing_ml: missingMl,
    },
  });
};

// POST /company/compliance/rules  (creates or replaces the rule for that state + category)
const saveRule = async (req, res) => {
  const data = compliance.ruleData(req.body);
  if (!data.state) throw new HttpError(400, "Choose a state");
  data.category = data.category || "*";
  const rule = await prisma.compliance_rules.upsert({
    where: { company_id_state_category: { company_id: req.company.id, state: data.state, category: data.category } },
    create: { ...data, company_id: req.company.id },
    update: { ...data, updated_at: new Date() },
  });
  await audit(req, "compliance.rule", { entity: "compliance_rule", entityId: rule.id, changes: data });
  res.status(201).json({ message: `Rule saved for ${compliance.STATES[rule.state]}${rule.category === "*" ? "" : ` (${compliance.CATEGORIES[rule.category]})`}`, data: rule });
};

const updateRule = async (req, res) => {
  const r = await prisma.compliance_rules.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!r) throw new HttpError(404, "Rule not found");
  const data = compliance.ruleData({ ...req.body, state: undefined, category: undefined });
  const rule = await prisma.compliance_rules.update({ where: { id: r.id }, data: { ...data, updated_at: new Date() } });
  await audit(req, "compliance.rule", { entity: "compliance_rule", entityId: rule.id, changes: data });
  res.json({ message: "Rule saved", data: rule });
};

const deleteRule = async (req, res) => {
  const r = await prisma.compliance_rules.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!r) throw new HttpError(404, "Rule not found");
  await prisma.compliance_rules.delete({ where: { id: r.id } });
  await audit(req, "compliance.rule_delete", { entity: "compliance_rule", entityId: r.id, changes: { state: r.state, category: r.category } });
  res.json({ message: "Rule removed" });
};

// ---- customer licences ----

const listLicenses = async (req, res) => {
  const rows = await prisma.customer_licenses.findMany({
    where: { company_id: req.company.id, ...(req.query.user_id ? { user_id: toId(req.query.user_id, "user_id") } : {}) },
    orderBy: [{ expires_on: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  });
  const users = await prisma.users.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.user_id))] } }, select: { id: true, email: true, business_name: true } });
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    data: rows.map((l) => {
      const exp = l.expires_on ? l.expires_on.toISOString().slice(0, 10) : null;
      const u = users.find((x) => x.id === l.user_id);
      return { ...l, customer: u ? { id: u.id, email: u.email, business_name: u.business_name } : null, state_name: compliance.STATES[l.state], status: !exp ? "valid" : exp < today ? "expired" : exp <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) ? "expiring" : "valid" };
    }),
  });
};

// POST /company/compliance/licenses { user_id | email, state, license_number, expires_on?, notes? }
const saveLicense = async (req, res) => {
  let userId = req.body.user_id ? toId(req.body.user_id, "user_id") : null;
  if (!userId && req.body.email) {
    const u = await prisma.users.findFirst({ where: { email: { equals: String(req.body.email).trim(), mode: "insensitive" } }, select: { id: true } });
    userId = u?.id || null;
  }
  if (!userId) throw new HttpError(400, "Choose the customer");
  const customer = await prisma.company_customers.findUnique({ where: { company_id_user_id: { company_id: req.company.id, user_id: userId } } });
  if (!customer) throw new HttpError(400, "That person isn't one of your customers yet");
  const state = compliance.normalizeState(req.body.state);
  if (!state) throw new HttpError(400, "Choose the state the licence is for");
  const number = String(req.body.license_number || "").trim().slice(0, 128);
  if (!number) throw new HttpError(400, "Enter the licence number");
  const exp = req.body.expires_on ? String(req.body.expires_on) : null;
  if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) throw new HttpError(400, "Expiry must be a date");
  const data = { license_number: number, expires_on: exp ? new Date(`${exp}T00:00:00Z`) : null, notes: req.body.notes ? String(req.body.notes).slice(0, 500) : null, updated_at: new Date() };
  const l = await prisma.customer_licenses.upsert({
    where: { company_id_user_id_state: { company_id: req.company.id, user_id: userId, state } },
    create: { company_id: req.company.id, user_id: userId, state, ...data },
    update: data,
  });
  await audit(req, "compliance.license", { entity: "customer_license", entityId: l.id, changes: { state, number } });
  res.status(201).json({ message: `${state} licence saved`, data: l });
};

const deleteLicense = async (req, res) => {
  const l = await prisma.customer_licenses.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!l) throw new HttpError(404, "Licence not found");
  await prisma.customer_licenses.delete({ where: { id: l.id } });
  res.json({ message: "Licence removed" });
};

module.exports = { getSettings, saveRule, updateRule, deleteRule, listLicenses, saveLicense, deleteLicense };
