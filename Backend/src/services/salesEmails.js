// Customer emails for sales documents, each with its PDF attached.
// Call these after the transaction that created/changed the document has committed.
const prisma = require("../prisma");
const { queueEmail } = require("./email/outbox");
const { displayName } = require("./users");
const { invoiceBalance, creditRemaining } = require("./invoicing");

const userSelect = { email: true, first_name: true, last_name: true, business_name: true };
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

const emailInvoice = async (invoiceId, { to } = {}) => {
  const inv = await prisma.invoices.findUnique({
    where: { id: BigInt(invoiceId) },
    include: { users: { select: userSelect }, companies: { select: { name: true } }, orders: { select: { order_number: true } } },
  });
  const recipient = to || inv?.users?.email;
  if (!inv || !recipient) return false;
  await queueEmail({
    to: recipient,
    template: "invoice",
    companyId: inv.company_id,
    attachments: [{ kind: "invoice", id: inv.id }],
    data: {
      name: displayName(inv.users || {}),
      companyName: inv.companies.name,
      invoiceNumber: inv.invoice_number,
      orderNumber: inv.orders?.order_number,
      total: Number(inv.total_amount),
      balance: inv.status === "void" ? 0 : invoiceBalance(inv),
      dueDate: fmtDate(inv.due_date),
      onAccount: inv.payment_method === "on_account",
    },
  });
  await prisma.invoices.update({ where: { id: inv.id }, data: { sent_at: new Date() } });
  return true;
};

const emailPaymentReceived = async (invoiceId, amount) => {
  const inv = await prisma.invoices.findUnique({
    where: { id: BigInt(invoiceId) },
    include: { users: { select: userSelect }, companies: { select: { name: true } } },
  });
  if (!inv?.users?.email) return;
  await queueEmail({
    to: inv.users.email,
    template: "paymentReceived",
    companyId: inv.company_id,
    data: { name: displayName(inv.users), companyName: inv.companies.name, invoiceNumber: inv.invoice_number, amount, balance: invoiceBalance(inv) },
  });
};

const emailCreditNote = async (creditNoteId, { applied = 0, refunded = 0, invoiceNumber = null } = {}) => {
  const cn = await prisma.credit_notes.findUnique({
    where: { id: BigInt(creditNoteId) },
    include: { users: { select: userSelect }, companies: { select: { name: true } }, invoices: { select: { invoice_number: true } } },
  });
  if (!cn?.users?.email) return false;
  await queueEmail({
    to: cn.users.email,
    template: "creditNote",
    companyId: cn.company_id,
    attachments: [{ kind: "credit_note", id: cn.id }],
    data: {
      name: displayName(cn.users),
      companyName: cn.companies.name,
      creditNoteNumber: cn.credit_note_number,
      total: Number(cn.total_amount),
      remaining: creditRemaining(cn),
      invoiceNumber: invoiceNumber || cn.invoices?.invoice_number,
      applied,
      refunded,
      reason: cn.reason,
    },
  });
  return true;
};

const emailQuote = async (quoteId) => {
  const q = await prisma.quotes.findUnique({
    where: { id: BigInt(quoteId) },
    include: { users: { select: userSelect }, companies: { select: { name: true } } },
  });
  if (!q?.users?.email) return false;
  await queueEmail({
    to: q.users.email,
    template: "quoteSent",
    companyId: q.company_id,
    attachments: [{ kind: "quote", id: q.id }],
    data: { name: displayName(q.users), companyName: q.companies.name, quoteNumber: q.quote_number, total: Number(q.total_amount), validUntil: fmtDate(q.valid_until) },
  });
  return true;
};

module.exports = { emailInvoice, emailPaymentReceived, emailCreditNote, emailQuote };
