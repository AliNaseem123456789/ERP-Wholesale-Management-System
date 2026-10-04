// Company (tenant) profile, self-service registration and dashboard.
const prisma = require("../../prisma");
const { HttpError } = require("../../utils/http");
const { uniqueCompanySlug } = require("../../utils/slug");
const { getMemberships } = require("../../services/users");
const { ROLES, ROLE_DESCRIPTIONS } = require("../../services/permissions");
const { queueEmail } = require("../../services/email/outbox");
const { audit } = require("../../services/audit");
const { supabaseAdmin } = require("../../lib/supabaseAdmin");
const { getDefaultWarehouse } = require("../../services/inventory");

const PROFILE_FIELDS = [
  "name", "legal_name", "email", "phone", "website", "description", "tax_id",
  "address_line1", "address_line2", "city", "state", "postal_code", "country",
];

const pickProfile = (body) => {
  const data = {};
  for (const f of PROFILE_FIELDS) {
    if (body[f] !== undefined) data[f] = body[f] === "" || body[f] === null ? null : String(body[f]).trim().slice(0, f === "description" ? 5000 : 255);
  }
  if (data.name === null) throw new HttpError(400, "Company name is required");
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new HttpError(400, "Invalid company email");
  return data;
};

// GET /company/memberships -> companies the current user can work in
const myMemberships = async (req, res) => {
  res.json({ data: await getMemberships(req.user.id) });
};

// GET /company/roles -> role list for the UI
const roles = (req, res) => {
  res.json({ data: ROLES.map((r) => ({ role: r, description: ROLE_DESCRIPTIONS[r] })) });
};

// POST /company/register -> a user registers a new business (pending approval)
const registerCompany = async (req, res) => {
  const data = pickProfile(req.body);
  if (!data.name) throw new HttpError(400, "Company name is required");

  const owned = await prisma.company_members.count({
    where: { user_id: BigInt(req.user.id), role: "OWNER", companies: { status: "pending" } },
  });
  if (owned >= 3) throw new HttpError(429, "You already have businesses waiting for approval");

  const company = await prisma.companies.create({
    data: {
      ...data,
      slug: await uniqueCompanySlug(data.name),
      status: "pending",
      company_members: { create: { user_id: BigInt(req.user.id), role: "OWNER" } },
    },
  });
  await getDefaultWarehouse(prisma, company.id);
  await audit(req, "company.register", { companyId: company.id, entity: "company", entityId: company.id });

  const admins = await prisma.users.findMany({ where: { role: "ADMIN" }, select: { email: true } });
  for (const a of admins) {
    await queueEmail({ to: a.email, template: "newCompanyPending", data: { companyName: company.name, ownerEmail: req.user.email } });
  }

  res.status(201).json({
    message: "Business registered. It will appear to customers once approved.",
    data: company,
  });
};

// GET /company/profile
const getProfile = async (req, res) => {
  res.json({ data: { ...req.company, myRole: req.membership.role, myPermissions: req.membership.permissions } });
};

// PATCH /company/profile
const updateProfile = async (req, res) => {
  const data = pickProfile(req.body);
  const company = await prisma.companies.update({
    where: { id: req.company.id },
    data: { ...data, updated_at: new Date() },
  });
  await audit(req, "company.update", { entity: "company", entityId: company.id, changes: data });
  res.json({ message: "Company profile saved", data: company });
};

// POST /company/logo (multipart "image")
const uploadLogo = async (req, res) => {
  if (!supabaseAdmin) throw new HttpError(503, "Image storage is not configured on the server");
  if (!req.file?.mimetype?.startsWith("image/")) throw new HttpError(400, "Please upload an image");
  const path = `companies/${req.company.id}/logo`;
  const { error } = await supabaseAdmin.storage
    .from("site-assets")
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = supabaseAdmin.storage.from("site-assets").getPublicUrl(path);
  const logo_url = `${publicUrl}?t=${Date.now()}`;
  await prisma.companies.update({ where: { id: req.company.id }, data: { logo_url, updated_at: new Date() } });
  await audit(req, "company.logo", { entity: "company", entityId: req.company.id });
  res.json({ url: logo_url });
};

// GET /company/dashboard
const dashboard = async (req, res) => {
  const companyId = req.company.id;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [byStatus, revenue30, activeProducts, inactiveProducts, team, recentOrders, topProducts] = await Promise.all([
    prisma.orders.groupBy({ by: ["status"], where: { company_id: companyId }, _count: { _all: true } }),
    prisma.orders.aggregate({
      where: { company_id: companyId, created_at: { gte: since }, status: { not: "cancelled" } },
      _sum: { total_amount: true },
      _count: { _all: true },
    }),
    prisma.products.count({ where: { company_id: companyId, is_active: true } }),
    prisma.products.count({ where: { company_id: companyId, is_active: false } }),
    prisma.company_members.count({ where: { company_id: companyId, status: "active" } }),
    prisma.orders.findMany({
      where: { company_id: companyId },
      orderBy: { created_at: "desc" },
      take: 5,
      select: {
        id: true, order_number: true, status: true, total_amount: true, created_at: true, business_name: true,
        users: { select: { email: true } },
      },
    }),
    prisma.$queryRaw`
      SELECT p.id, p.title, SUM(oi.quantity)::int AS units, SUM(oi.quantity * oi.price_at_time)::float AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      WHERE o.company_id = ${companyId} AND o.status <> 'cancelled' AND o.created_at >= ${since}
      GROUP BY p.id, p.title ORDER BY revenue DESC LIMIT 5`,
  ]);

  // Inventory & purchasing snapshot (only for staff who can see it).
  let inventory = null;
  if (req.can("inventory.view") || req.can("purchasing.view")) {
    const [stock] = await prisma.$queryRaw`
      SELECT (SELECT COALESCE(SUM(l.on_hand * p2.cost_price), 0) FROM inventory_levels l
              JOIN products p2 ON p2.id = l.product_id WHERE l.company_id = ${companyId})::float AS value,
             COUNT(*) FILTER (WHERE x.avail <= 0)::int AS out_of_stock,
             COUNT(*) FILTER (WHERE x.avail > 0 AND p.reorder_point > 0 AND x.avail <= p.reorder_point)::int AS low_stock
      FROM products p
      LEFT JOIN LATERAL (SELECT COALESCE(SUM(on_hand - reserved), 0) AS avail FROM inventory_levels WHERE product_id = p.id) x ON true
      WHERE p.company_id = ${companyId} AND p.is_active = true`;
    const openPos = await prisma.purchase_orders.aggregate({
      where: { company_id: companyId, status: { in: ["sent", "partially_received"] } },
      _count: { _all: true },
      _sum: { total_amount: true },
    });
    inventory = {
      tracking: req.company.settings?.inventory?.tracking === true,
      stockValue: Math.round(Number(stock.value) * 100) / 100,
      lowStock: stock.low_stock,
      outOfStock: stock.out_of_stock,
      openPurchaseOrders: openPos._count._all,
      openPurchaseValue: Number(openPos._sum.total_amount || 0),
    };
  }

  res.json({
    data: {
      inventory,
      ordersByStatus: Object.fromEntries(byStatus.map((s) => [s.status || "unknown", s._count._all])),
      last30Days: { orders: revenue30._count._all, revenue: Number(revenue30._sum.total_amount || 0) },
      products: { active: activeProducts, inactive: inactiveProducts },
      teamMembers: team,
      recentOrders: recentOrders.map(({ users, ...o }) => ({ ...o, customer_email: users?.email ?? null })),
      topProducts,
    },
  });
};

// GET /company/audit?page=
const auditLog = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const take = 50;
  const where = { company_id: req.company.id };
  const [rows, total] = await Promise.all([
    prisma.audit_logs.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * take,
      take,
      include: { users: { select: { email: true, first_name: true, last_name: true } } },
    }),
    prisma.audit_logs.count({ where }),
  ]);
  res.json({
    data: rows.map(({ users, ...r }) => ({ ...r, user: users })),
    total,
    totalPages: Math.ceil(total / take),
    page,
  });
};

module.exports = { myMemberships, roles, registerCompany, getProfile, updateProfile, uploadLogo, dashboard, auditLog };
