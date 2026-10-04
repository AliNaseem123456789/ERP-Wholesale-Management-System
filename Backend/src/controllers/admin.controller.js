const prisma = require("../prisma");
const { supabaseAdmin } = require("../lib/supabaseAdmin");
const { HttpError, toId } = require("../utils/http");
const { productData } = require("../services/productInput");
const { uniqueCompanySlug } = require("../utils/slug");
const { newToken, hashToken } = require("../services/tokens");
const { queueEmail, processOutbox, verifySmtp } = require("../services/email/outbox");
const { audit } = require("../services/audit");
const { getDefaultWarehouse } = require("../services/inventory");
const inv = require("../services/inventory");

const ROLES = ["USER", "ADMIN", "SUBACCOUNT"];

// ---- users ------------------------------------------------------------------

const getAllUsers = async (req, res) => {
  const data = await prisma.users.findMany({
    select: { id: true, email: true, role: true, first_name: true, last_name: true, created_at: true },
    orderBy: { created_at: "desc" },
  });
  res.status(200).json(data);
};

const updateUserRole = async (req, res) => {
  const id = toId(req.params.id);
  const { role } = req.body;
  if (!ROLES.includes(role)) throw new HttpError(400, "Invalid role");
  if (String(id) === String(req.user.id) && role !== "ADMIN") {
    throw new HttpError(400, "You can't remove your own admin access");
  }
  const user = await prisma.users.update({
    where: { id },
    data: { role, updated_at: new Date() },
    select: { id: true, email: true, role: true, first_name: true, last_name: true, created_at: true },
  });
  res.status(200).json({ message: "User role updated", user });
};

const deleteUser = async (req, res) => {
  const id = toId(req.params.id);
  if (String(id) === String(req.user.id)) throw new HttpError(400, "You can't delete your own account");

  const [orders, payments, credits, teamMembers] = await Promise.all([
    prisma.orders.count({ where: { user_id: id } }),
    prisma.payment_history.count({ where: { user_id: id } }),
    prisma.credit_history.count({ where: { user_id: id } }),
    prisma.users.count({ where: { parent_id: id } }),
  ]);
  if (teamMembers) {
    // users.parent_id is ON DELETE CASCADE, so deleting the owner would silently delete their staff.
    throw new HttpError(409, "This user has team members (sub-accounts). Remove those first.");
  }
  if (orders || payments || credits) {
    throw new HttpError(
      409,
      "This user has orders or payment history, so they can't be deleted. Change their role instead.",
    );
  }

  await prisma.$transaction([
    prisma.sub_accounts.deleteMany({ where: { OR: [{ user_id: id }, { parent_id: id }] } }),
    prisma.users.delete({ where: { id } }),
  ]);
  res.status(200).json({ message: "User deleted successfully" });
};

// ---- products ---------------------------------------------------------------

// Platform admin product creation: the product goes to `company_id` if given,
// otherwise to the company that owns the brand, otherwise to the default company.
const resolveCompanyForBrand = async (brandName, companyId) => {
  if (companyId) {
    const c = await prisma.companies.findUnique({ where: { id: toId(companyId, "company_id") }, select: { id: true } });
    if (!c) throw new HttpError(400, "Company not found");
    return c.id;
  }
  const brand = await prisma.brands.findFirst({ where: { name: { equals: brandName, mode: "insensitive" } } });
  if (brand?.company_id) return brand.company_id;
  const fallback = await prisma.companies.findFirst({ where: { slug: "smoke-wholesale" }, select: { id: true } });
  return fallback?.id ?? null;
};

const ensureBrand = async (name, companyId) => {
  if (!name) return;
  const brand = await prisma.brands.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (!brand) await prisma.brands.create({ data: { name, company_id: companyId } });
};

const createProduct = async (req, res) => {
  const data = productData(req.body);
  if (!data.title || !data.brand) throw new HttpError(400, "Title and brand are required");
  const companyId = await resolveCompanyForBrand(data.brand, req.body.company_id);
  const product = await prisma.products.create({
    data: { categories: [], flavors: [], ...data, company_id: companyId, updated_at: new Date() },
  });
  await ensureBrand(product.brand, companyId);
  if (data.flavors) await inv.syncVariants(prisma, { id: product.id, flavors: [] }, data.flavors);
  await audit(req, "admin.product.create", { companyId, entity: "product", entityId: product.id });
  res.status(201).json(product);
};

const updateProduct = async (req, res) => {
  const data = productData(req.body);
  if (data.title === "" || data.brand === "") throw new HttpError(400, "Title and brand can't be empty");
  if (data.flavors) {
    const existing = await prisma.products.findUnique({ where: { id: toId(req.params.id) } });
    if (existing) await inv.syncVariants(prisma, existing, data.flavors);
  }
  const product = await prisma.products.update({ where: { id: toId(req.params.id) }, data: { ...data, updated_at: new Date() } });
  if (data.brand) await ensureBrand(product.brand, product.company_id);
  res.status(200).json(product);
};

const getProducts = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const search = String(req.query.search || "").trim();
  const where = {
    ...(search ? { title: { contains: search, mode: "insensitive" } } : {}),
    ...(req.query.company_id ? { company_id: toId(req.query.company_id, "company_id") } : {}),
  };

  const [products, totalCount] = await Promise.all([
    prisma.products.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { companies: { select: { id: true, name: true } } },
    }),
    prisma.products.count({ where }),
  ]);

  res.status(200).json({
    products,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
  });
};

const deleteProduct = async (req, res) => {
  const id = toId(req.params.id);
  const ordered = await prisma.order_items.count({ where: { product_id: id } });
  if (ordered) {
    throw new HttpError(409, "This product appears in past orders and can't be deleted.");
  }
  await prisma.$transaction([
    prisma.cart_items.deleteMany({ where: { product_id: id } }),
    prisma.wishlist_items.deleteMany({ where: { product_id: id } }),
    prisma.products.delete({ where: { id } }),
  ]);
  res.status(200).json({ message: "Product deleted successfully" });
};

// ---- storage uploads --------------------------------------------------------

const requireStorage = () => {
  if (!supabaseAdmin) throw new HttpError(503, "Image storage is not configured on the server");
};

const uploadImage = async (req, res) => {
  requireStorage();
  const productId = toId(req.body.productId, "productId");
  const file = req.file;
  if (!file) throw new HttpError(400, "No file uploaded");
  if (!file.mimetype?.startsWith("image/")) throw new HttpError(400, "Only image files are allowed");

  const filePath = `${productId}/1.webp`;
  const { error } = await supabaseAdmin.storage
    .from("product-images")
    .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: true });
  if (error) throw error;

  const { data: { publicUrl } } = supabaseAdmin.storage.from("product-images").getPublicUrl(filePath);
  res.status(200).json({ url: `${publicUrl}?t=${Date.now()}` });
};

// ---- homepage feature banners (site_settings) -------------------------------

const updateFeatureSection = async (req, res) => {
  const slotKey = String(req.body.slotKey || "");
  if (!/^feature_[a-z0-9_]+$/i.test(slotKey)) throw new HttpError(400, "Invalid slot key");
  const link = req.body.link ?? "";

  const current = await prisma.site_settings.findUnique({ where: { key: slotKey } });
  let imageUrl = req.body.existingImage || current?.value?.image || null;

  if (req.file) {
    requireStorage();
    if (!req.file.mimetype?.startsWith("image/")) throw new HttpError(400, "Only image files are allowed");
    const filePath = `features/${slotKey}.webp`;
    const { error } = await supabaseAdmin.storage
      .from("site-assets")
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabaseAdmin.storage.from("site-assets").getPublicUrl(filePath);
    imageUrl = `${publicUrl}?t=${Date.now()}`;
  }

  const value = { image: imageUrl, link };
  await prisma.site_settings.upsert({
    where: { key: slotKey },
    create: { key: slotKey, value },
    update: { value },
  });
  res.status(200).json({ message: "Feature updated", url: imageUrl });
};

const getSiteSettings = async (req, res) => {
  const data = await prisma.site_settings.findMany();
  res.status(200).json(data);
};

// ---- companies (tenants) -----------------------------------------------------------

const COMPANY_STATUSES = ["pending", "active", "suspended"];

// GET /admin/companies?status&search
const listCompanies = async (req, res) => {
  const search = String(req.query.search || "").trim();
  const companies = await prisma.companies.findMany({
    where: {
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { products: true, orders: true, company_members: true, brands: true } },
      company_members: {
        where: { role: "OWNER" },
        select: { users: { select: { email: true } } },
      },
    },
  });
  res.json({
    data: companies.map(({ _count, company_members, ...c }) => ({
      ...c,
      counts: _count,
      owners: company_members.map((m) => m.users.email),
    })),
  });
};

// POST /admin/companies { name, ownerEmail?, status? }
// Creates a company and (optionally) emails an OWNER invitation.
const createCompany = async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) throw new HttpError(400, "Company name is required");
  const status = req.body.status && COMPANY_STATUSES.includes(req.body.status) ? req.body.status : "active";
  const ownerEmail = req.body.ownerEmail ? String(req.body.ownerEmail).trim().toLowerCase() : null;
  if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new HttpError(400, "Invalid owner email");

  const company = await prisma.companies.create({
    data: {
      name,
      slug: await uniqueCompanySlug(req.body.slug || name),
      status,
      email: req.body.email || ownerEmail,
      phone: req.body.phone || null,
    },
  });

  await getDefaultWarehouse(prisma, company.id);

  if (ownerEmail) {
    const token = newToken();
    await prisma.company_invitations.create({
      data: {
        company_id: company.id,
        email: ownerEmail,
        role: "OWNER",
        token_hash: hashToken(token),
        invited_by: BigInt(req.user.id),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await queueEmail({
      to: ownerEmail,
      template: "invitation",
      companyId: company.id,
      data: { companyName: company.name, role: "OWNER", inviterName: "The platform team", token },
    });
  }
  await audit(req, "admin.company.create", { companyId: company.id, entity: "company", entityId: company.id, changes: { name, status, ownerEmail } });
  res.status(201).json({ message: ownerEmail ? `Company created and invitation sent to ${ownerEmail}` : "Company created", data: company });
};

// PATCH /admin/companies/:id { name?, status?, commission_rate? }
const updateCompany = async (req, res) => {
  const id = toId(req.params.id);
  const before = await prisma.companies.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Company not found");

  const data = { updated_at: new Date() };
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) throw new HttpError(400, "Company name is required");
    data.name = name;
  }
  if (req.body.status !== undefined) {
    if (!COMPANY_STATUSES.includes(req.body.status)) throw new HttpError(400, `Status must be one of ${COMPANY_STATUSES.join(", ")}`);
    data.status = req.body.status;
  }
  if (req.body.commission_rate !== undefined) {
    const rate = Number(req.body.commission_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new HttpError(400, "Commission must be between 0 and 100");
    data.commission_rate = rate;
  }

  const company = await prisma.companies.update({ where: { id }, data });
  await audit(req, "admin.company.update", { companyId: id, entity: "company", entityId: id, changes: data });

  if (data.status && data.status !== before.status) {
    const owners = await prisma.company_members.findMany({
      where: { company_id: id, role: "OWNER" },
      select: { users: { select: { email: true } } },
    });
    for (const o of owners) {
      await queueEmail({ to: o.users.email, template: "companyStatus", companyId: id, data: { companyName: company.name, status: data.status } });
    }
  }
  res.json({ message: "Company updated", data: company });
};

// GET /admin/brands -> every brand with its company
const listAllBrands = async (req, res) => {
  const brands = await prisma.brands.findMany({
    orderBy: { name: "asc" },
    include: { companies: { select: { id: true, name: true } } },
  });
  const counts = await prisma.products.groupBy({ by: ["brand"], _count: { _all: true } });
  const countByName = new Map(counts.map((c) => [c.brand.toLowerCase(), c._count._all]));
  res.json({
    data: brands.map(({ companies, ...b }) => ({ ...b, company: companies, productCount: countByName.get(b.name.toLowerCase()) || 0 })),
  });
};

// POST /admin/brands/:id/assign { company_id } -> moves the brand AND all its products to that company
const assignBrand = async (req, res) => {
  const brandId = toId(req.params.id);
  const companyId = toId(req.body.company_id, "company_id");
  const [brand, company] = await Promise.all([
    prisma.brands.findUnique({ where: { id: brandId } }),
    prisma.companies.findUnique({ where: { id: companyId } }),
  ]);
  if (!brand) throw new HttpError(404, "Brand not found");
  if (!company) throw new HttpError(404, "Company not found");

  const [, moved] = await prisma.$transaction([
    prisma.brands.update({ where: { id: brandId }, data: { company_id: companyId } }),
    prisma.products.updateMany({
      where: { brand: { equals: brand.name, mode: "insensitive" } },
      data: { company_id: companyId, updated_at: new Date() },
    }),
  ]);
  await audit(req, "admin.brand.assign", {
    companyId, entity: "brand", entityId: brandId,
    changes: { brand: brand.name, from: brand.company_id, to: companyId, products: moved.count },
  });
  res.json({ message: `"${brand.name}" and ${moved.count} product(s) moved to ${company.name}`, productsMoved: moved.count });
};

// ---- email outbox ----------------------------------------------------------------

// GET /admin/emails?status
const listEmails = async (req, res) => {
  const emails = await prisma.email_outbox.findMany({
    where: req.query.status ? { status: String(req.query.status) } : {},
    orderBy: { id: "desc" },
    take: 100,
    select: { id: true, to_email: true, subject: true, template: true, status: true, attempts: true, last_error: true, created_at: true, sent_at: true },
  });
  const smtp = await verifySmtp();
  res.json({ data: emails, smtp });
};

// POST /admin/emails/test { to }
const sendTestEmail = async (req, res) => {
  const to = String(req.body.to || req.user.email);
  await queueEmail({ to, template: "passwordChanged", data: { name: "Test" } });
  await processOutbox();
  const last = await prisma.email_outbox.findFirst({ where: { to_email: to.toLowerCase() }, orderBy: { id: "desc" } });
  res.json({ message: last?.status === "sent" ? `Test email sent to ${to}` : `Email not sent: ${last?.last_error || "unknown error"}`, data: last });
};

// POST /admin/emails/:id/retry
const retryEmail = async (req, res) => {
  const id = toId(req.params.id);
  await prisma.email_outbox.update({ where: { id }, data: { status: "pending", attempts: 0, send_after: new Date() } });
  await processOutbox();
  res.json({ message: "Retry queued", data: await prisma.email_outbox.findUnique({ where: { id } }) });
};

module.exports = {
  listCompanies,
  createCompany,
  updateCompany,
  listAllBrands,
  assignBrand,
  listEmails,
  sendTestEmail,
  retryEmail,
  getAllUsers,
  updateUserRole,
  deleteUser,
  updateProduct,
  createProduct,
  deleteProduct,
  getProducts,
  uploadImage,
  updateFeatureSection,
  getSiteSettings,
};

// ---- platform KPIs (admin dashboard) ----------------------------------------------------------
// GET /api/admin/kpis?days=30  -> headline numbers for the period and the one before it, a daily series,
// top companies and products, order statuses and system health.
const kpis = async (req, res) => {
  const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const now = new Date();
  const start = new Date(now.getTime() - days * 86400000);
  const prevStart = new Date(start.getTime() - days * 86400000);
  const headline = async (from, to) => {
    const [o] = await prisma.$queryRaw`
      SELECT COUNT(*) FILTER (WHERE COALESCE(status,'pending') <> 'cancelled')::int AS orders,
             COALESCE(SUM(total_amount) FILTER (WHERE COALESCE(status,'pending') <> 'cancelled'), 0)::float AS gmv,
             COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
             COUNT(DISTINCT user_id) FILTER (WHERE COALESCE(status,'pending') <> 'cancelled')::int AS buyers
      FROM orders WHERE created_at >= ${from} AND created_at < ${to}`;
    const [u] = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM users WHERE created_at >= ${from} AND created_at < ${to}`;
    const [c] = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM companies WHERE created_at >= ${from} AND created_at < ${to}`;
    const [rep] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n FROM (SELECT user_id FROM orders WHERE created_at >= ${from} AND created_at < ${to} AND COALESCE(status,'pending') <> 'cancelled'
      GROUP BY user_id HAVING COUNT(*) > 1) x`;
    const all = o.orders + o.cancelled;
    return {
      gmv: Math.round(o.gmv * 100) / 100, orders: o.orders, aov: o.orders ? Math.round((o.gmv / o.orders) * 100) / 100 : 0, buyers: o.buyers,
      repeat_rate: o.buyers ? Math.round((rep.n / o.buyers) * 1000) / 10 : 0, cancel_rate: all ? Math.round((o.cancelled / all) * 1000) / 10 : 0,
      new_users: u.n, new_companies: c.n,
    };
  };
  const [current, previous, series, topCompanies, topProducts, statuses, companies, users, emails, pendingList] = await Promise.all([
    headline(start, now),
    headline(prevStart, start),
    prisma.$queryRaw`
      SELECT to_char(d::date, 'YYYY-MM-DD') AS date, COUNT(o.id)::int AS orders, COALESCE(SUM(o.total_amount), 0)::float AS gmv
      FROM generate_series(${start}::date, ${now}::date, interval '1 day') d
      LEFT JOIN orders o ON o.created_at::date = d::date AND COALESCE(o.status,'pending') <> 'cancelled'
      GROUP BY d ORDER BY d`,
    prisma.$queryRaw`
      SELECT c.id, c.name, c.status, COUNT(o.id)::int AS orders, COALESCE(SUM(o.total_amount), 0)::float AS gmv
      FROM orders o JOIN companies c ON c.id = o.company_id
      WHERE o.created_at >= ${start} AND COALESCE(o.status,'pending') <> 'cancelled'
      GROUP BY c.id ORDER BY gmv DESC LIMIT 8`,
    prisma.$queryRaw`
      SELECT p.id, p.title, c.name AS company, SUM(oi.quantity)::int AS units, SUM(oi.quantity * oi.price_at_time)::float AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id LEFT JOIN companies c ON c.id = p.company_id
      WHERE o.created_at >= ${start} AND COALESCE(o.status,'pending') <> 'cancelled'
      GROUP BY p.id, c.name ORDER BY revenue DESC LIMIT 8`,
    prisma.$queryRaw`SELECT COALESCE(status,'pending') AS status, COUNT(*)::int AS n FROM orders WHERE created_at >= ${start} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw`SELECT status, COUNT(*)::int AS n FROM companies GROUP BY status`,
    prisma.$queryRaw`SELECT role, COUNT(*)::int AS n FROM users GROUP BY role`,
    prisma.$queryRaw`SELECT status, COUNT(*)::int AS n FROM email_outbox WHERE created_at >= ${new Date(now.getTime() - 7 * 86400000)} GROUP BY status`,
    prisma.companies.findMany({ where: { status: "pending" }, orderBy: { created_at: "asc" }, take: 5, select: { id: true, name: true, email: true, created_at: true } }),
  ]);
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.status ?? r.role, r.n]));
  const change = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : a ? null : 0);
  res.json({
    data: {
      days, from: start, to: now, current, previous,
      change: Object.fromEntries(Object.keys(current).map((k) => [k, change(current[k], previous[k])])),
      series: series.map((r) => ({ ...r, gmv: Math.round(r.gmv * 100) / 100 })),
      top_companies: topCompanies.map((r) => ({ ...r, gmv: Math.round(r.gmv * 100) / 100 })),
      top_products: topProducts.map((r) => ({ ...r, revenue: Math.round(r.revenue * 100) / 100 })),
      order_statuses: statuses,
      companies: toMap(companies), users: toMap(users), emails_7d: toMap(emails), pending_companies: pendingList,
    },
  });
};
module.exports.kpis = kpis;
