// Reports to the platform team: a listing (counterfeit, prohibited, misleading...), a problem with an order,
// a seller, or a review. Buyers report; sellers can report reviews of their products. The seller concerned can
// answer; platform admins investigate, act (hide the listing or review, suspend the seller) and close it.
const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const { notifyUsers, notifyStaff } = require("./inapp");
const { queueEmail } = require("./email/outbox");

const REASONS = {
  listing: { counterfeit: "Counterfeit or fake", prohibited: "Prohibited or restricted item", misleading: "Misleading description or photos", wrong_price: "Wrong or misleading price", other: "Something else" },
  order: { not_received: "Order not received", damaged: "Arrived damaged", wrong_items: "Wrong or missing items", not_as_described: "Not as described", billing: "Billing or payment problem", other: "Something else" },
  seller: { unresponsive: "Seller doesn't respond", fraud: "Suspected fraud or scam", abusive: "Abusive or unprofessional", policy: "Breaks marketplace rules", other: "Something else" },
  review: { fake: "Fake or paid review", offensive: "Offensive or personal information", not_relevant: "Not about this product or seller", other: "Something else" },
};
const STATUSES = ["open", "in_review", "resolved", "dismissed"];
const OPEN_LIMIT_PER_DAY = 10;

const number = async () => {
  const n = await prisma.issue_reports.count();
  return `RPT-${String(n + 1).padStart(5, "0")}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
};

const adminEmails = async () => (await prisma.users.findMany({ where: { role: "ADMIN" }, select: { email: true } })).map((u) => u.email);

/**
 * Creates a report. body: { kind, reason, details?, product_id?, order_id?, company_id?, review_id? }.
 * `asCompany` = the company reporting a review of its own product (seller side).
 */
const create = async (req, b, { asCompany = null } = {}) => {
  const kind = String(b.kind || "");
  if (!REASONS[kind]) throw new HttpError(400, "Choose what you're reporting");
  const reason = String(b.reason || "");
  if (!REASONS[kind][reason]) throw new HttpError(400, "Choose a reason");
  const details = b.details ? String(b.details).replace(/<[^>]*>/g, "").trim().slice(0, 4000) : null;
  if (reason === "other" && !details) throw new HttpError(400, "Tell us what's wrong");
  const uid = BigInt(req.user.id);
  const today = await prisma.issue_reports.count({ where: { reporter_id: uid, created_at: { gte: new Date(Date.now() - 86400000) } } });
  if (today >= OPEN_LIMIT_PER_DAY) throw new HttpError(429, "You've sent a lot of reports today. Please try again tomorrow.");

  const data = { kind, reason, details, reporter_id: uid };
  if (kind === "listing") {
    const p = await prisma.products.findFirst({ where: { id: toId(b.product_id, "product_id") }, select: { id: true, company_id: true } });
    if (!p) throw new HttpError(404, "Product not found");
    Object.assign(data, { product_id: p.id, company_id: p.company_id });
  } else if (kind === "order") {
    const o = await prisma.orders.findFirst({ where: { id: toId(b.order_id, "order_id"), user_id: uid }, select: { id: true, company_id: true } });
    if (!o) throw new HttpError(404, "Order not found");
    Object.assign(data, { order_id: o.id, company_id: o.company_id });
  } else if (kind === "seller") {
    const c = await prisma.companies.findFirst({ where: { id: toId(b.company_id, "company_id"), status: { in: ["active", "suspended"] } }, select: { id: true } });
    if (!c) throw new HttpError(404, "Seller not found");
    data.company_id = c.id;
  } else {
    const r = await prisma.reviews.findFirst({ where: { id: toId(b.review_id, "review_id"), ...(asCompany ? { company_id: asCompany } : {}) }, select: { id: true, company_id: true, product_id: true } });
    if (!r) throw new HttpError(404, "Review not found");
    Object.assign(data, { review_id: r.id, company_id: r.company_id, product_id: r.product_id });
  }
  // the same person reporting the same thing again while it's open: return the existing report
  const dup = await prisma.issue_reports.findFirst({
    where: { reporter_id: uid, kind, status: { in: ["open", "in_review"] }, product_id: data.product_id ?? null, order_id: data.order_id ?? null, review_id: data.review_id ?? null, company_id: data.company_id ?? null },
  });
  if (dup) return { report: dup, duplicate: true };
  const report = await prisma.issue_reports.create({ data: { ...data, report_number: await number() } });

  for (const to of await adminEmails()) {
    await queueEmail({ to, template: "notice", data: { type: "report.new", title: `New report ${report.report_number}: ${REASONS[kind][reason]}`, lines: [details || ""].filter(Boolean), link: "/admin?tab=reports", linkLabel: "Open reports" } });
  }
  // order problems go to the seller straight away so they can fix them
  if (kind === "order" && data.company_id) {
    await notifyStaff(data.company_id, "orders.view", { type: "report.order", title: `A buyer reported a problem: ${REASONS.order[reason]}`, body: details ? details.slice(0, 300) : null, link: "/business/reports" });
  }
  return { report, duplicate: false };
};

const label = (r) => REASONS[r.kind]?.[r.reason] || r.reason;

/** Adds the names of what a report is about. */
const describe = async (rows, { reporters = false } = {}) => {
  const ids = (k) => [...new Set(rows.map((r) => r[k]).filter(Boolean))];
  const [products, orders, companies, reviews, users] = await Promise.all([
    ids("product_id").length ? prisma.products.findMany({ where: { id: { in: ids("product_id") } }, select: { id: true, title: true, slug: true, status: true } }) : [],
    ids("order_id").length ? prisma.orders.findMany({ where: { id: { in: ids("order_id") } }, select: { id: true, order_number: true, status: true, total_amount: true } }) : [],
    ids("company_id").length ? prisma.companies.findMany({ where: { id: { in: ids("company_id") } }, select: { id: true, name: true, slug: true, status: true } }) : [],
    ids("review_id").length ? prisma.reviews.findMany({ where: { id: { in: ids("review_id") } }, select: { id: true, rating: true, title: true, body: true, status: true } }) : [],
    reporters && ids("reporter_id").length ? prisma.users.findMany({ where: { id: { in: ids("reporter_id") } }, select: { id: true, email: true, first_name: true, last_name: true, business_name: true } }) : [],
  ]);
  const by = (list, id) => list.find((x) => x.id === id) || null;
  return rows.map((r) => ({
    ...r, reason_label: label(r),
    product: by(products, r.product_id), order: by(orders, r.order_id), company: by(companies, r.company_id), review: by(reviews, r.review_id),
    ...(reporters ? { reporter: by(users, r.reporter_id) } : {}),
  }));
};

/** What the reporter sees (no internal admin note). */
const forReporter = async (userId) => {
  const rows = await prisma.issue_reports.findMany({ where: { reporter_id: BigInt(userId) }, orderBy: { created_at: "desc" }, take: 100 });
  return (await describe(rows)).map(({ admin_note, handled_by, ...r }) => r);
};

/** What the seller sees: reports about it. Who reported is only shown for problems with their own orders. */
const forCompany = async (companyId, { status } = {}) => {
  const rows = await prisma.issue_reports.findMany({ where: { company_id: BigInt(companyId), ...(status ? { status } : {}) }, orderBy: { created_at: "desc" }, take: 200 });
  const shaped = await describe(rows, { reporters: true });
  return shaped.map(({ admin_note, handled_by, reporter, reporter_id, ...r }) => ({
    ...r,
    reporter: r.kind === "order" && reporter ? { name: reporter.business_name || [reporter.first_name, reporter.last_name].filter(Boolean).join(" ") || reporter.email, email: reporter.email } : null,
  }));
};

const respond = async (req, id, text) => {
  const r = await prisma.issue_reports.findFirst({ where: { id: toId(id), company_id: req.company.id } });
  if (!r) throw new HttpError(404, "Report not found");
  if (["resolved", "dismissed"].includes(r.status)) throw new HttpError(400, "This report is closed");
  const body = String(text || "").replace(/<[^>]*>/g, "").trim().slice(0, 4000);
  if (!body) throw new HttpError(400, "Write your response");
  const updated = await prisma.issue_reports.update({ where: { id: r.id }, data: { seller_response: body, seller_responded_at: new Date(), updated_at: new Date() } });
  if (r.kind === "order" && r.reporter_id) await notifyUsers([r.reporter_id], { type: "report.response", title: `${req.company.name} answered your report ${r.report_number}`, body: body.slice(0, 300), link: "/account?tab=reports" });
  return updated;
};

const forAdmin = async ({ status, kind, q, page = 1 }) => {
  const p = Math.max(1, Number(page) || 1);
  const where = { ...(status ? { status } : {}), ...(kind ? { kind } : {}), ...(q ? { report_number: { contains: String(q), mode: "insensitive" } } : {}) };
  const [rows, total, counts] = await Promise.all([
    prisma.issue_reports.findMany({ where, orderBy: [{ created_at: "desc" }], skip: (p - 1) * 30, take: 30 }),
    prisma.issue_reports.count({ where }),
    prisma.issue_reports.groupBy({ by: ["status"], _count: true }),
  ]);
  return { data: await describe(rows, { reporters: true }), total, page: p, pages: Math.max(1, Math.ceil(total / 30)), counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) };
};

/**
 * PATCH /admin/reports/:id { status?, admin_note?, resolution?, action? }
 *   action: hide_product | hide_review | suspend_company (done together with the update)
 */
const adminUpdate = async (req, id, b) => {
  const r = await prisma.issue_reports.findUnique({ where: { id: toId(id) } });
  if (!r) throw new HttpError(404, "Report not found");
  const data = { updated_at: new Date(), handled_by: BigInt(req.user.id) };
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) throw new HttpError(400, "Unknown status");
    data.status = b.status;
    data.resolved_at = ["resolved", "dismissed"].includes(b.status) ? new Date() : null;
  }
  if (b.admin_note !== undefined) data.admin_note = b.admin_note ? String(b.admin_note).slice(0, 4000) : null;
  if (b.resolution !== undefined) data.resolution = b.resolution ? String(b.resolution).slice(0, 4000) : null;
  const done = [];
  if (b.action === "hide_product") {
    if (!r.product_id) throw new HttpError(400, "This report isn't about a product");
    await prisma.products.update({ where: { id: r.product_id }, data: { status: "hidden", updated_at: new Date() } });
    if (r.company_id) await notifyStaff(r.company_id, "products.manage", { type: "report.action", title: "A product was hidden by the marketplace team", body: `Report ${r.report_number}: ${label(r)}`, link: "/business/reports" });
    done.push("product hidden");
  } else if (b.action === "hide_review") {
    if (!r.review_id) throw new HttpError(400, "This report isn't about a review");
    await prisma.reviews.update({ where: { id: r.review_id }, data: { status: "hidden", hidden_reason: `Report ${r.report_number}: ${label(r)}`, updated_at: new Date() } });
    done.push("review hidden");
  } else if (b.action === "suspend_company") {
    if (!r.company_id) throw new HttpError(400, "This report isn't about a seller");
    await prisma.companies.update({ where: { id: r.company_id }, data: { status: "suspended", updated_at: new Date() } });
    done.push("seller suspended");
  } else if (b.action) throw new HttpError(400, "Unknown action");
  if (done.length) data.admin_note = [data.admin_note ?? r.admin_note, `${new Date().toISOString().slice(0, 10)}: ${done.join(", ")}`].filter(Boolean).join("\n");
  const updated = await prisma.issue_reports.update({ where: { id: r.id }, data });
  if (data.status && data.status !== r.status && ["resolved", "dismissed"].includes(data.status) && r.reporter_id) {
    await notifyUsers([r.reporter_id], { type: "report.closed", title: `Your report ${r.report_number} was ${data.status}`, body: (data.resolution ?? r.resolution ?? "").slice(0, 300) || null, link: "/account?tab=reports" });
  }
  return { report: updated, done };
};

module.exports = { REASONS, STATUSES, create, forReporter, forCompany, respond, forAdmin, adminUpdate, describe, label };
