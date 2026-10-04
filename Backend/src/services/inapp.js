// In-app notifications (the bell). Never throws: a notification problem must not break a request.
//   notifyUsers(userIds, n)            -> specific people
//   notifyStaff(companyId, perm, n)    -> every active member of a company holding a permission
//   fromEmail({ to, template, data })  -> called by queueEmail: emails to a registered user also land in their bell
// n = { type, title, body?, link?, companyId?, dedupeKey? }
const prisma = require("../prisma");
const { can } = require("./permissions");

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

const create = async (userIds, n) => {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return 0;
  const r = await prisma.notifications.createMany({
    data: ids.map((u) => ({
      user_id: BigInt(u), company_id: n.companyId ? BigInt(n.companyId) : null, type: clip(n.type, 48), title: clip(n.title, 255),
      body: clip(n.body, 1000), link: clip(n.link, 500), dedupe_key: n.dedupeKey ? clip(n.dedupeKey, 160) : null,
    })),
    skipDuplicates: true, // dedupe_key
  });
  return r.count;
};

const notifyUsers = async (userIds, n) => {
  try {
    return await create(userIds, n);
  } catch (err) {
    console.error("notifyUsers failed:", err.message);
    return 0;
  }
};

const staffWith = async (companyId, permission) => {
  const members = await prisma.company_members.findMany({ where: { company_id: BigInt(companyId), status: "active" }, select: { user_id: true, role: true } });
  return members.filter((m) => can(m.role, permission)).map((m) => m.user_id);
};

const notifyStaff = async (companyId, permission, n) => {
  try {
    return await create(await staffWith(companyId, permission), { ...n, companyId });
  } catch (err) {
    console.error("notifyStaff failed:", err.message);
    return 0;
  }
};

// Email template -> notification. Templates not listed (password reset, invitations, emails to suppliers...) stay email-only.
const FROM_TEMPLATE = {
  newOrderForCompany: (d) => ({ type: "order.new", title: `New order ${d.orderNumber}`, body: `${d.businessName || d.customerEmail} ordered ${money(d.total)}`, link: "/business/orders" }),
  orderStatus: (d) => ({ type: "order.status", title: `Order ${d.orderNumber} is ${d.status}`, body: `${d.companyName}${d.trackingNumber ? ` · tracking ${d.trackingNumber}` : ""}`, link: "/account?tab=orders" }),
  invoice: (d) => ({ type: "invoice.issued", title: `Invoice ${d.invoiceNumber} from ${d.companyName}`, body: `${money(d.total)}${d.dueDate ? `, due ${d.dueDate}` : ""}`, link: "/account?tab=invoices" }),
  paymentReceived: (d) => ({ type: "invoice.payment", title: `Payment received for ${d.invoiceNumber}`, body: `${money(d.amount)} · balance ${money(d.balance)}`, link: "/account?tab=invoices" }),
  creditNote: (d) => ({ type: "credit_note", title: `Credit note ${d.creditNoteNumber} from ${d.companyName}`, body: money(d.total), link: "/account?tab=invoices" }),
  quoteSent: (d) => ({ type: "quote.sent", title: `Quotation ${d.quoteNumber} from ${d.companyName}`, body: `${money(d.total)}${d.validUntil ? `, valid until ${d.validUntil}` : ""}`, link: "/account?tab=quotes" }),
  quoteRequested: (d) => ({ type: "quote.requested", title: `Quote request ${d.quoteNumber}`, body: `From ${d.customer}`, link: "/business/quotes" }),
  quoteResponse: (d) => ({ type: "quote.response", title: `Quote ${d.quoteNumber} ${d.accepted ? "accepted" : "declined"}`, body: d.accepted ? `Now order ${d.orderNumber}` : `By ${d.customer}`, link: d.accepted ? "/business/orders" : "/business/quotes" }),
  returnRequested: (d) => ({ type: "return.requested", title: `Return request ${d.rmaNumber}`, body: `${d.customer} · order ${d.orderNumber} · ${d.reason}`, link: "/business/returns" }),
  returnUpdate: (d) => ({ type: "return.update", title: `Return ${d.rmaNumber}: ${d.status}`, body: d.companyName, link: "/account?tab=returns" }),
  lowStock: (d) => ({ type: "stock.low", title: `Low stock: ${d.items?.length || 0} item(s)`, body: (d.items || []).slice(0, 3).map((i) => i.title).join(", "), link: "/business/reorder" }),
  leaveRequested: (d) => ({ type: "leave.requested", title: `Leave request from ${d.employee}`, body: `${d.days} day(s) of ${d.leaveType}, ${d.from} to ${d.to}`, link: "/business/leave" }),
  leaveDecision: (d) => ({ type: "leave.decision", title: `Your leave was ${d.status}`, body: `${d.days} day(s) of ${d.leaveType}, ${d.from} to ${d.to}`, link: "/business/my-hr" }),
  payslip: (d) => ({ type: "payslip", title: `Payslip for ${d.period}`, body: `Net pay ${money(d.net)}`, link: "/business/my-hr" }),
  companyStatus: (d) => ({ type: "company.status", title: `${d.companyName} is now ${d.status}`, link: "/business" }),
  newCompanyPending: (d) => ({ type: "company.pending", title: `New company waiting: ${d.companyName}`, body: d.ownerEmail, link: "/admin" }),
  scheduledReport: (d) => ({ type: "report.sent", title: `Report: ${d.title}`, body: `${d.rowCount} row(s)${d.period ? ` · ${d.period}` : ""}`, link: "/business/reports-hub?tab=scheduled" }),
};

const fromEmail = async ({ to, template, data, companyId }) => {
  try {
    const map = FROM_TEMPLATE[template];
    if (!map || !to) return;
    const user = await prisma.users.findFirst({ where: { email: { equals: String(to), mode: "insensitive" } }, select: { id: true } });
    if (!user) return;
    await create([user.id], { ...map(data || {}), companyId });
  } catch (err) {
    console.error("in-app notification failed:", err.message);
  }
};

module.exports = { notifyUsers, notifyStaff, fromEmail, staffWith, FROM_TEMPLATE };
