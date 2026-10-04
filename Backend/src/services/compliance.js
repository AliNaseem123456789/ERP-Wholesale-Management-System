// Per-state tobacco / vapor compliance: excise tax, flavour bans, licence requirements, shipping bans,
// age verification and shipment reporting. Rules are entered by each company (no external services):
// a rule is for one state and one product category, or "*" for every regulated category.
const { HttpError } = require("../utils/http");
const { round2, num } = require("./money");

const STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands",
};
const NAME_TO_CODE = Object.fromEntries(Object.entries(STATES).map(([c, n]) => [n.toLowerCase(), c]));

const CATEGORIES = {
  none: "Not regulated", cigarettes: "Cigarettes", cigars: "Cigars", smokeless: "Smokeless / chewing tobacco", pipe_tobacco: "Pipe / roll-your-own tobacco",
  vapor_closed: "Vapor: closed system (pods, disposables)", vapor_open: "Vapor: open system (devices)", e_liquid: "E-liquid", nicotine_pouch: "Nicotine pouches",
  other_tobacco: "Other tobacco / nicotine",
};
const TAX_TYPES = ["none", "percent", "per_ml", "per_unit"];

const normalizeState = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (STATES[s.toUpperCase()]) return s.toUpperCase();
  return NAME_TO_CODE[s.toLowerCase()] || null;
};

const isRegulated = (p) => !!p && p.compliance_category && p.compliance_category !== "none";

// rules for one state, indexed by category
const rulesFor = async (db, companyId, state) => {
  if (!state) return new Map();
  const rows = await db.compliance_rules.findMany({ where: { company_id: BigInt(companyId), state } });
  return new Map(rows.map((r) => [r.category, r]));
};
const ruleFor = (rules, category) => rules.get(category) || rules.get("*") || null;

const todayStr = () => new Date().toISOString().slice(0, 10);
const hasValidLicense = async (db, companyId, userId, state) => {
  if (!userId) return false;
  const l = await db.customer_licenses.findUnique({ where: { company_id_user_id_state: { company_id: BigInt(companyId), user_id: BigInt(userId), state } } });
  return !!l && (!l.expires_on || l.expires_on.toISOString().slice(0, 10) >= todayStr());
};

const taxFor = (rule, p, quantity, lineTotal) => {
  const rate = num(rule.tax_rate);
  switch (rule.tax_type) {
    case "percent": return { amount: round2((lineTotal * rate) / 100), basis: `${rate}% of ${lineTotal.toFixed(2)}` };
    case "per_ml": {
      const ml = num(p.nicotine_ml);
      return { amount: round2(quantity * ml * rate), basis: `${quantity} x ${ml} ml x ${rate}/ml`, missingMl: !ml };
    }
    case "per_unit": return { amount: round2(quantity * rate), basis: `${quantity} x ${rate}/unit` };
    default: return { amount: 0, basis: null };
  }
};

/**
 * Checks the lines going to one seller for one destination state.
 * lines: [{ product_id, title, flavor?, quantity, line_total }]
 * -> { state, excise, lines: [{ product_id, title, category, amount, basis }], problems: [{ product_id, title, message }], flags: [] }
 */
const evaluate = async (db, { companyId, companyName = "this seller", userId, state, lines }) => {
  const out = { state, excise: 0, lines: [], problems: [], flags: [] };
  if (!lines.length) return out;
  const products = await db.products.findMany({
    where: { id: { in: [...new Set(lines.map((l) => BigInt(l.product_id)))] } },
    select: { id: true, title: true, compliance_category: true, nicotine_ml: true, is_flavored: true },
  });
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const regulated = lines.filter((l) => isRegulated(byId.get(String(l.product_id))));
  if (!regulated.length) return out;
  if (!state) {
    out.flags.push("Regulated products: check the destination state's rules");
    return out;
  }
  const rules = await rulesFor(db, companyId, state);
  const flags = new Set();
  let licenseChecked = null;
  for (const l of regulated) {
    const p = byId.get(String(l.product_id));
    const rule = ruleFor(rules, p.compliance_category);
    if (!rule) continue;
    const title = l.title || p.title;
    if (rule.ship_banned) {
      out.problems.push({ product_id: p.id, title, message: `"${title}" can't be shipped to ${STATES[state] || state}` });
      continue;
    }
    if (rule.flavor_ban && p.is_flavored) {
      out.problems.push({ product_id: p.id, title, message: `Flavored products like "${title}" can't be sold into ${STATES[state] || state}` });
      continue;
    }
    if (rule.license_required) {
      if (licenseChecked === null) licenseChecked = await hasValidLicense(db, companyId, userId, state);
      if (!licenseChecked) {
        out.problems.push({ product_id: p.id, title, message: `${companyName} needs your valid ${state} tobacco licence on file before shipping "${title}" to ${STATES[state] || state}` });
        continue;
      }
    }
    if (rule.age_verification) flags.add("Adult signature / age verification (21+) on delivery");
    if (rule.report_shipments) flags.add(`Report this shipment to ${STATES[state] || state} (shipment report)`);
    const t = taxFor(rule, p, Number(l.quantity), num(l.line_total));
    if (t.missingMl) flags.add(`"${title}" has no ml volume set: per-ml excise is 0`);
    if (t.amount > 0) out.lines.push({ product_id: p.id, title, category: p.compliance_category, amount: t.amount, basis: t.basis });
  }
  out.excise = round2(out.lines.reduce((s, l) => s + l.amount, 0));
  out.flags = [...flags];
  return out;
};

const assertNoProblems = (result) => {
  if (result.problems.length) throw new HttpError(400, result.problems[0].message);
};

const ruleData = (b) => {
  const data = {};
  if (b.state !== undefined) {
    data.state = normalizeState(b.state);
    if (!data.state) throw new HttpError(400, "Choose a US state");
  }
  if (b.category !== undefined) {
    data.category = String(b.category || "*");
    if (data.category !== "*" && (!CATEGORIES[data.category] || data.category === "none")) throw new HttpError(400, "Unknown product category");
  }
  if (b.tax_type !== undefined) {
    if (!TAX_TYPES.includes(b.tax_type)) throw new HttpError(400, `Tax type must be one of: ${TAX_TYPES.join(", ")}`);
    data.tax_type = b.tax_type;
  }
  if (b.tax_rate !== undefined) {
    data.tax_rate = Number(b.tax_rate || 0);
    if (!(data.tax_rate >= 0 && data.tax_rate <= 100000)) throw new HttpError(400, "Tax rate must be 0 or more");
    if ((b.tax_type ?? "") === "percent" && data.tax_rate > 1000) throw new HttpError(400, "Percent rate too high");
  }
  for (const f of ["flavor_ban", "license_required", "ship_banned", "age_verification", "report_shipments"]) if (b[f] !== undefined) data[f] = !!b[f];
  if (b.notes !== undefined) data.notes = b.notes ? String(b.notes).slice(0, 1000) : null;
  return data;
};

module.exports = { STATES, CATEGORIES, TAX_TYPES, normalizeState, isRegulated, evaluate, assertNoProblems, ruleData, hasValidLicense };
