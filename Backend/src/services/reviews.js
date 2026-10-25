// Reviews from verified buyers: a product (bought it in a delivered order) or a supplier (received an order from it).
// One review per buyer per product / per supplier; they can edit or delete it. Sellers reply once (they can edit the reply).
// Platform admins hide reviews that break the rules; hidden reviews don't count in ratings.
const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const { publicWhere } = require("./catalog");

const PAGE = 10;

/** "Ali N." — what other buyers see of a reviewer. */
const reviewerName = (u) => {
  if (!u) return "A buyer";
  const first = (u.first_name || "").trim();
  const last = (u.last_name || "").trim();
  if (first) return `${first}${last ? ` ${last[0].toUpperCase()}.` : ""}`;
  if (u.business_name) return u.business_name;
  return "A buyer";
};

const withAuthors = async (rows, { full = false } = {}) => {
  const users = rows.length ? await prisma.users.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.user_id))] } }, select: { id: true, first_name: true, last_name: true, business_name: true, email: true } }) : [];
  return rows.map((r) => {
    const u = users.find((x) => x.id === r.user_id);
    const out = { ...r, author: reviewerName(u), verified: !!r.order_id };
    if (full) out.author_email = u?.email || null;
    else delete out.hidden_reason;
    return out;
  });
};

/** Rating summary: { average, count, distribution: {5: n, ...} } for published reviews matching `where`. */
const summary = async (where) => {
  const rows = await prisma.reviews.groupBy({ by: ["rating"], where: { ...where, status: "published" }, _count: true });
  const count = rows.reduce((s, r) => s + r._count, 0);
  const total = rows.reduce((s, r) => s + r.rating * r._count, 0);
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const r of rows) distribution[r.rating] = r._count;
  return { average: count ? Math.round((total / count) * 10) / 10 : null, count, distribution };
};

/** Supplier ratings for several companies: Map companyId -> { average, count } (supplier reviews only). */
const companyRatings = async (companyIds) => {
  if (!companyIds.length) return new Map();
  const rows = await prisma.reviews.groupBy({ by: ["company_id"], where: { company_id: { in: companyIds.map((x) => BigInt(x)) }, product_id: null, status: "published" }, _avg: { rating: true }, _count: true });
  return new Map(rows.map((r) => [String(r.company_id), { average: Math.round(r._avg.rating * 10) / 10, count: r._count }]));
};

const listPublic = async (where, page = 1, sort = "newest") => {
  const p = Math.max(1, Number(page) || 1);
  const orderBy = sort === "highest" ? [{ rating: "desc" }, { created_at: "desc" }] : sort === "lowest" ? [{ rating: "asc" }, { created_at: "desc" }] : [{ created_at: "desc" }];
  const w = { ...where, status: "published" };
  const [rows, total] = await Promise.all([
    prisma.reviews.findMany({ where: w, orderBy, skip: (p - 1) * PAGE, take: PAGE, select: { id: true, rating: true, title: true, body: true, order_id: true, user_id: true, seller_reply: true, replied_at: true, created_at: true, updated_at: true, product_id: true } }),
    prisma.reviews.count({ where: w }),
  ]);
  const shaped = (await withAuthors(rows)).map(({ user_id, order_id, ...r }) => r);
  return { data: shaped, total, page: p, pages: Math.max(1, Math.ceil(total / PAGE)), summary: await summary(where) };
};

/** What a buyer can review: products from delivered orders and the suppliers of those orders, minus what's reviewed. */
const eligible = async (userId) => {
  const uid = BigInt(userId);
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON (oi.product_id) oi.product_id, o.id AS order_id, o.company_id, o.order_number, o.created_at
    FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE o.user_id = ${uid} AND o.status = 'delivered' AND oi.product_id IS NOT NULL
    ORDER BY oi.product_id, o.created_at DESC`;
  const done = await prisma.reviews.findMany({ where: { user_id: uid }, select: { product_id: true, company_id: true } });
  const doneProducts = new Set(done.filter((d) => d.product_id).map((d) => String(d.product_id)));
  const doneCompanies = new Set(done.filter((d) => !d.product_id).map((d) => String(d.company_id)));
  const pids = rows.map((r) => r.product_id).filter((p) => !doneProducts.has(String(p)));
  const products = pids.length ? await prisma.products.findMany({ where: { id: { in: pids } }, select: { id: true, title: true, slug: true, status: true, company_id: true } }) : [];
  const cids = [...new Set(rows.map((r) => String(r.company_id)))];
  const companies = cids.length ? await prisma.companies.findMany({ where: { id: { in: cids.map((x) => BigInt(x)) } }, select: { id: true, name: true, slug: true } }) : [];
  return {
    products: products.filter((p) => p.status !== "archived").map((p) => ({ ...p, order_number: rows.find((r) => String(r.product_id) === String(p.id))?.order_number, company: companies.find((c) => c.id === p.company_id) })),
    companies: companies.filter((c) => !doneCompanies.has(String(c.id))),
  };
};

const fields = (b, { creating }) => {
  const d = {};
  if (creating || b.rating !== undefined) {
    const r = Number(b.rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) throw new HttpError(400, "Choose 1 to 5 stars");
    d.rating = r;
  }
  if (b.title !== undefined) d.title = b.title ? String(b.title).replace(/<[^>]*>/g, "").trim().slice(0, 120) || null : null;
  if (b.body !== undefined) {
    d.body = b.body ? String(b.body).replace(/<[^>]*>/g, "").trim().slice(0, 4000) || null : null;
  }
  return d;
};

/** POST /account/reviews { product_id? | company_id?, rating, title?, body? } */
const create = async (req, b) => {
  const uid = BigInt(req.user.id);
  const d = fields(b, { creating: true });
  let productId = null;
  let companyId;
  let orderId;
  if (b.product_id) {
    productId = toId(b.product_id, "product_id");
    const p = await prisma.products.findUnique({ where: { id: productId }, select: { id: true, company_id: true, title: true } });
    if (!p) throw new HttpError(404, "Product not found");
    const o = await prisma.orders.findFirst({ where: { user_id: uid, status: "delivered", order_items: { some: { product_id: productId } } }, orderBy: { created_at: "desc" }, select: { id: true } });
    if (!o) throw new HttpError(403, "You can review a product once an order with it has been delivered to you");
    companyId = p.company_id; orderId = o.id;
  } else {
    companyId = toId(b.company_id, "company_id");
    const o = await prisma.orders.findFirst({ where: { user_id: uid, status: "delivered", company_id: companyId }, orderBy: { created_at: "desc" }, select: { id: true } });
    if (!o) throw new HttpError(403, "You can review a supplier once one of its orders has been delivered to you");
    orderId = o.id;
  }
  const existing = await prisma.reviews.findFirst({ where: { user_id: uid, company_id: companyId, product_id: productId } });
  if (existing) throw new HttpError(409, "You've already reviewed this. Edit your review instead.");
  const r = await prisma.reviews.create({ data: { ...d, user_id: uid, company_id: companyId, product_id: productId, order_id: orderId } });
  const { notifyStaff } = require("./inapp");
  await notifyStaff(companyId, "products.view", { type: "review.new", title: `New ${r.rating}-star review`, body: d.title || (d.body || "").slice(0, 200), link: "/business/reviews" });
  return r;
};

const findOwn = async (req, id) => {
  const r = await prisma.reviews.findFirst({ where: { id: toId(id), user_id: BigInt(req.user.id) } });
  if (!r) throw new HttpError(404, "Review not found");
  return r;
};

const mine = async (userId) => {
  const rows = await prisma.reviews.findMany({ where: { user_id: BigInt(userId) }, orderBy: { created_at: "desc" } });
  const pids = rows.map((r) => r.product_id).filter(Boolean);
  const products = pids.length ? await prisma.products.findMany({ where: { id: { in: pids } }, select: { id: true, title: true, slug: true } }) : [];
  const companies = rows.length ? await prisma.companies.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.company_id))] } }, select: { id: true, name: true, slug: true } }) : [];
  return rows.map((r) => ({ ...r, product: products.find((p) => p.id === r.product_id) || null, company: companies.find((c) => c.id === r.company_id) || null }));
};

/** Seller view: reviews of the company's products and of the company. */
const forCompany = async (companyId, { status, rating, replied, page = 1 }) => {
  const where = { company_id: BigInt(companyId), ...(status ? { status } : {}), ...(rating ? { rating: Number(rating) } : {}), ...(replied === "no" ? { seller_reply: null } : replied === "yes" ? { NOT: { seller_reply: null } } : {}) };
  const p = Math.max(1, Number(page) || 1);
  const [rows, total] = await Promise.all([
    prisma.reviews.findMany({ where, orderBy: { created_at: "desc" }, skip: (p - 1) * 20, take: 20 }),
    prisma.reviews.count({ where }),
  ]);
  const pids = rows.map((r) => r.product_id).filter(Boolean);
  const products = pids.length ? await prisma.products.findMany({ where: { id: { in: pids } }, select: { id: true, title: true, slug: true, sku: true } }) : [];
  const shaped = (await withAuthors(rows)).map(({ user_id, ...r }) => ({ ...r, product: products.find((x) => x.id === r.product_id) || null }));
  return { data: shaped, total, page: p, pages: Math.max(1, Math.ceil(total / 20)), summary: await summary({ company_id: BigInt(companyId) }), supplier: await summary({ company_id: BigInt(companyId), product_id: null }) };
};

const reply = async (req, id, text) => {
  const r = await prisma.reviews.findFirst({ where: { id: toId(id), company_id: req.company.id } });
  if (!r) throw new HttpError(404, "Review not found");
  const body = String(text || "").replace(/<[^>]*>/g, "").trim().slice(0, 2000);
  const updated = await prisma.reviews.update({ where: { id: r.id }, data: body ? { seller_reply: body, replied_at: new Date(), replied_by: BigInt(req.user.id), updated_at: new Date() } : { seller_reply: null, replied_at: null, replied_by: null, updated_at: new Date() } });
  if (body && !r.seller_reply) {
    const { notifyUsers } = require("./inapp");
    await notifyUsers([r.user_id], { type: "review.reply", title: `${req.company.name} replied to your review`, body: body.slice(0, 300), link: "/account?tab=reviews" });
  }
  return updated;
};

module.exports = { reviewerName, withAuthors, summary, companyRatings, listPublic, eligible, fields, create, findOwn, mine, forCompany, reply, publicWhere };
