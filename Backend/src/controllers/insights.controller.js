// Phases 6-9 endpoints: reviews, problem reports, platform commission, seller analytics.
// Public / buyer / seller / admin handlers are grouped by audience; each route file mounts the ones it needs.
const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const { audit } = require("../services/audit");
const reviews = require("../services/reviews");
const desk = require("../services/reportsDesk");
const commission = require("../services/commission");
const analytics = require("../services/analytics");
const { publicWhere } = require("../services/catalog");

// ---- public ------------------------------------------------------------------------------------

const findPublicProduct = async (req) => {
  const key = String(req.params.id);
  const p = await prisma.products.findFirst({ where: { ...publicWhere(req), ...(/^\d+$/.test(key) ? { id: BigInt(key) } : { slug: key.toLowerCase() }) }, select: { id: true } });
  if (!p) throw new HttpError(404, "Product not found");
  return p;
};

// GET /marketplace/products/:id/reviews?page&sort=newest|highest|lowest
const productReviews = async (req, res) => {
  const p = await findPublicProduct(req);
  res.json(await reviews.listPublic({ product_id: p.id }, req.query.page, req.query.sort));
};

// GET /marketplace/companies/:slug/reviews?page&sort&scope=supplier|all
const companyReviews = async (req, res) => {
  const c = await prisma.companies.findFirst({ where: { slug: String(req.params.slug).toLowerCase(), status: "active", storefront_published: true }, select: { id: true } });
  if (!c) throw new HttpError(404, "Company not found");
  const where = req.query.scope === "all" ? { company_id: c.id } : { company_id: c.id, product_id: null };
  const out = await reviews.listPublic(where, req.query.page, req.query.sort);
  // product reviews: name the product
  const pids = out.data.map((r) => r.product_id).filter(Boolean);
  if (pids.length) {
    const ps = await prisma.products.findMany({ where: { id: { in: pids } }, select: { id: true, title: true, slug: true } });
    for (const r of out.data) r.product = ps.find((x) => x.id === r.product_id) || null;
  }
  res.json(out);
};

// ---- buyers ------------------------------------------------------------------------------------

// GET /account/reviews -> my reviews and what I can still review
const myReviews = async (req, res) => {
  res.json({ data: await reviews.mine(req.user.id), eligible: await reviews.eligible(req.user.id) });
};
const createReview = async (req, res) => {
  const r = await reviews.create(req, req.body || {});
  res.status(201).json({ message: "Thanks! Your review is published.", data: r });
};
const updateReview = async (req, res) => {
  const r = await reviews.findOwn(req, req.params.id);
  const data = reviews.fields(req.body || {}, { creating: false });
  const updated = await prisma.reviews.update({ where: { id: r.id }, data: { ...data, updated_at: new Date() } });
  res.json({ message: r.status === "hidden" ? "Saved. This review is hidden by the marketplace team." : "Review updated", data: updated });
};
const deleteReview = async (req, res) => {
  const r = await reviews.findOwn(req, req.params.id);
  await prisma.reviews.delete({ where: { id: r.id } });
  res.json({ message: "Review deleted" });
};

// GET /account/reports, POST /account/reports
const myReports = async (req, res) => res.json({ data: await desk.forReporter(req.user.id), reasons: desk.REASONS });
const createReport = async (req, res) => {
  const { report, duplicate } = await desk.create(req, req.body || {});
  res.status(duplicate ? 200 : 201).json({
    message: duplicate ? `You already reported this (${report.report_number}); we're looking into it.` : `Thanks. Report ${report.report_number} was sent to the marketplace team.`,
    data: report,
  });
};
const reportReasons = async (req, res) => res.json({ data: desk.REASONS });

// ---- sellers (req.company set by companyContext) ------------------------------------------------

// GET /company/analytics?days=7|30|90
const companyAnalytics = async (req, res) => {
  const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  res.json({ data: await analytics.report(req.company.id, days) });
};

const sellerReviews = async (req, res) => res.json(await reviews.forCompany(req.company.id, req.query));
const replyToReview = async (req, res) => {
  const r = await reviews.reply(req, req.params.id, req.body?.reply);
  await audit(req, "review.reply", { entity: "review", entityId: r.id });
  res.json({ message: r.seller_reply ? "Reply published" : "Reply removed", data: r });
};
const reportReview = async (req, res) => {
  const { report, duplicate } = await desk.create(req, { ...req.body, kind: "review", review_id: req.params.id }, { asCompany: req.company.id });
  res.status(duplicate ? 200 : 201).json({ message: duplicate ? `Already reported (${report.report_number})` : `Report ${report.report_number} sent to the marketplace team`, data: report });
};

const sellerReports = async (req, res) => res.json({ data: await desk.forCompany(req.company.id, { status: req.query.status }) });
const respondToReport = async (req, res) => {
  const r = await desk.respond(req, req.params.id, req.body?.response);
  await audit(req, "report.respond", { entity: "report", entityId: r.id });
  res.json({ message: "Response sent to the marketplace team", data: r });
};

// GET /company/commission -> statements and what's not billed yet
const sellerCommission = async (req, res) => {
  const [statements, unbilled] = await Promise.all([
    prisma.commission_statements.findMany({ where: { company_id: req.company.id, status: { not: "void" } }, orderBy: { period_start: "desc" }, take: 60 }),
    commission.billableOrders(prisma, req.company.id),
  ]);
  res.json({
    data: statements.map(commission.shape),
    rate: Number(req.company.commission_rate || 0),
    unbilled: { ...commission.summarize(unbilled), orders: unbilled.slice(-50).reverse() },
  });
};
const sellerStatement = async (req, res) => res.json({ data: await commission.statementDetail(toId(req.params.id), req.company.id) });

// ---- platform admins ---------------------------------------------------------------------------

const adminCommission = async (req, res) => {
  const statements = await prisma.commission_statements.findMany({
    where: { ...(req.query.company_id ? { company_id: toId(req.query.company_id, "company_id") } : {}), ...(req.query.status ? { status: String(req.query.status) } : {}) },
    orderBy: { created_at: "desc" }, take: 200,
  });
  const companies = statements.length ? await prisma.companies.findMany({ where: { id: { in: [...new Set(statements.map((s) => s.company_id))] } }, select: { id: true, name: true, slug: true } }) : [];
  res.json({
    data: await commission.unbilledByCompany(),
    statements: statements.map((s) => ({ ...commission.shape(s), company: companies.find((c) => c.id === s.company_id) || null })),
  });
};
// POST /admin/commission/statements { company_id, period_start, period_end, notes? }
const createStatement = async (req, res) => {
  const st = await commission.createStatement({ companyId: toId(req.body.company_id, "company_id"), periodStart: req.body.period_start, periodEnd: req.body.period_end, notes: req.body.notes, userId: req.user.id });
  await audit(req, "admin.commission.statement", { entity: "commission_statement", entityId: st.id, changes: { number: st.statement_number, amount: Number(st.commission_amount) } });
  const company = await prisma.companies.findUnique({ where: { id: st.company_id }, select: { id: true, name: true } });
  const { notifyStaff } = require("../services/inapp");
  await notifyStaff(st.company_id, "accounting.view", { type: "commission.statement", title: `Commission statement ${st.statement_number}`, body: `$${Number(st.commission_amount).toFixed(2)} for ${st.order_count} order(s)`, link: "/business/commission" });
  res.status(201).json({ message: `Statement ${st.statement_number} created for ${company?.name}: $${Number(st.commission_amount).toFixed(2)}`, data: commission.shape(st) });
};
const adminStatement = async (req, res) => res.json({ data: await commission.statementDetail(toId(req.params.id)) });
// PATCH /admin/commission/statements/:id { status: paid|issued|void, payment_reference?, notes? }
const updateStatement = async (req, res) => {
  const st = await commission.setStatus({ id: toId(req.params.id), status: req.body.status, reference: req.body.payment_reference, notes: req.body.notes });
  await audit(req, "admin.commission.status", { entity: "commission_statement", entityId: st.id, changes: { status: st.status } });
  res.json({ message: `Statement ${st.statement_number} is ${st.status === "issued" ? "unpaid" : st.status}`, data: commission.shape(st) });
};

// GET /admin/reviews?status&rating&q&page
const adminReviews = async (req, res) => {
  const p = Math.max(1, Number(req.query.page) || 1);
  const where = {
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    ...(req.query.rating ? { rating: Number(req.query.rating) } : {}),
    ...(req.query.q ? { OR: [{ title: { contains: String(req.query.q), mode: "insensitive" } }, { body: { contains: String(req.query.q), mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([prisma.reviews.findMany({ where, orderBy: { created_at: "desc" }, skip: (p - 1) * 30, take: 30 }), prisma.reviews.count({ where })]);
  const shaped = await reviews.withAuthors(rows, { full: true });
  const pids = rows.map((r) => r.product_id).filter(Boolean);
  const [products, companies, reportCounts] = await Promise.all([
    pids.length ? prisma.products.findMany({ where: { id: { in: pids } }, select: { id: true, title: true, slug: true } }) : [],
    rows.length ? prisma.companies.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.company_id))] } }, select: { id: true, name: true, slug: true } }) : [],
    rows.length ? prisma.issue_reports.groupBy({ by: ["review_id"], where: { review_id: { in: rows.map((r) => r.id) } }, _count: true }) : [],
  ]);
  res.json({
    data: shaped.map((r) => ({ ...r, product: products.find((x) => x.id === r.product_id) || null, company: companies.find((x) => x.id === r.company_id) || null, reports: reportCounts.find((x) => x.review_id === r.id)?._count || 0 })),
    total, page: p, pages: Math.max(1, Math.ceil(total / 30)),
  });
};
// PATCH /admin/reviews/:id { status: published|hidden, hidden_reason? }
const moderateReview = async (req, res) => {
  const r = await prisma.reviews.findUnique({ where: { id: toId(req.params.id) } });
  if (!r) throw new HttpError(404, "Review not found");
  if (!["published", "hidden"].includes(req.body.status)) throw new HttpError(400, "Status must be published or hidden");
  const updated = await prisma.reviews.update({ where: { id: r.id }, data: { status: req.body.status, hidden_reason: req.body.status === "hidden" ? String(req.body.hidden_reason || "Breaks the review rules").slice(0, 255) : null, updated_at: new Date() } });
  await audit(req, "admin.review.moderate", { entity: "review", entityId: r.id, changes: { status: updated.status } });
  res.json({ message: updated.status === "hidden" ? "Review hidden" : "Review published again", data: updated });
};

const adminReports = async (req, res) => res.json({ ...(await desk.forAdmin(req.query)), reasons: desk.REASONS });
const adminUpdateReport = async (req, res) => {
  const { report, done } = await desk.adminUpdate(req, req.params.id, req.body || {});
  await audit(req, "admin.report.update", { entity: "report", entityId: report.id, changes: { status: report.status, done } });
  res.json({ message: done.length ? `Saved: ${done.join(", ")}` : "Report saved", data: report });
};

module.exports = {
  productReviews, companyReviews,
  myReviews, createReview, updateReview, deleteReview, myReports, createReport, reportReasons,
  companyAnalytics, sellerReviews, replyToReview, reportReview, sellerReports, respondToReport, sellerCommission, sellerStatement,
  adminCommission, createStatement, adminStatement, updateStatement, adminReviews, moderateReview, adminReports, adminUpdateReport,
};
