// Invoices, customer payments, credit notes and receivables (A/R aging).
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { round2, num } = require("../../services/money");
const billing = require("../../services/invoicing");
const { sendPdf } = require("../../services/documents");
const { emailInvoice, emailPaymentReceived, emailCreditNote } = require("../../services/salesEmails");

const TX = { timeout: 20000, maxWait: 10000 };
const userSelect = { id: true, email: true, first_name: true, last_name: true, business_name: true, phone: true };

const shapeInvoice = ({ users, orders, ...inv }) => ({
  ...inv,
  customer: users,
  order: orders,
  balance: inv.status === "void" ? 0 : billing.invoiceBalance(inv),
  overdue: billing.isOverdue(inv),
  days_overdue: billing.isOverdue(inv) ? Math.floor((billing.today() - new Date(inv.due_date)) / 86400000) : 0,
});

const shapeCreditNote = ({ users, invoices, return_requests, ...cn }) => ({
  ...cn,
  customer: users,
  invoice: invoices,
  return_request: return_requests,
  remaining: cn.status === "void" ? 0 : billing.creditRemaining(cn),
});

// ---- invoices -------------------------------------------------------------------------

// GET /company/invoices?status=open|overdue|paid|void|issued|partially_paid&search&customer_id&page&limit
const listInvoices = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const status = String(req.query.status || "");
  const search = String(req.query.search || "").trim();
  const where = {
    company_id: req.company.id,
    ...(status === "open" ? { status: { in: ["issued", "partially_paid"] } } : {}),
    ...(status === "overdue" ? { status: { in: ["issued", "partially_paid"] }, due_date: { lt: billing.today() } } : {}),
    ...(["issued", "partially_paid", "paid", "void"].includes(status) ? { status } : {}),
    ...(req.query.customer_id ? { user_id: toId(req.query.customer_id, "customer_id") } : {}),
    ...(search
      ? { OR: [
          { invoice_number: { contains: search, mode: "insensitive" } },
          { orders: { is: { order_number: { contains: search, mode: "insensitive" } } } },
          { users: { is: { email: { contains: search, mode: "insensitive" } } } },
          { users: { is: { business_name: { contains: search, mode: "insensitive" } } } },
        ] }
      : {}),
  };
  const todayStr = billing.today().toISOString().slice(0, 10);
  const [rows, totalCount, [sums]] = await Promise.all([
    prisma.invoices.findMany({
      where,
      orderBy: [{ issue_date: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: { users: { select: userSelect }, orders: { select: { id: true, order_number: true } } },
    }),
    prisma.invoices.count({ where }),
    prisma.$queryRaw`
      SELECT COALESCE(SUM(total_amount - amount_paid - amount_credited) FILTER (WHERE status IN ('issued','partially_paid')), 0)::float AS outstanding,
             COALESCE(SUM(total_amount - amount_paid - amount_credited) FILTER (WHERE status IN ('issued','partially_paid') AND due_date < ${todayStr}::date), 0)::float AS overdue,
             COUNT(*) FILTER (WHERE status IN ('issued','partially_paid') AND due_date < ${todayStr}::date)::int AS overdue_count
      FROM invoices WHERE company_id = ${req.company.id}`,
  ]);
  res.json({
    data: rows.map(shapeInvoice),
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
    summary: { outstanding: round2(sums.outstanding), overdue: round2(sums.overdue), overdue_count: sums.overdue_count },
  });
};

const loadInvoice = async (req, id = req.params.id) => {
  const inv = await prisma.invoices.findFirst({
    where: { id: toId(id), company_id: req.company.id },
    include: {
      users: { select: userSelect },
      orders: { select: { id: true, order_number: true, status: true, payment_method: true } },
      invoice_items: { orderBy: { id: "asc" } },
      invoice_payments: { orderBy: [{ paid_at: "asc" }, { id: "asc" }] },
      credit_notes: { where: { status: { not: "void" } }, select: { id: true, credit_note_number: true, total_amount: true, amount_applied: true, status: true, created_at: true } },
    },
  });
  if (!inv) throw new HttpError(404, "Invoice not found");
  // credits applied to this invoice may come from credit notes raised against another invoice
  const shaped = shapeInvoice(inv);
  if (inv.user_id) {
    shaped.available_credits = (
      await prisma.credit_notes.findMany({
        where: { company_id: req.company.id, user_id: inv.user_id, status: "issued" },
        select: { id: true, credit_note_number: true, total_amount: true, amount_applied: true, amount_refunded: true, status: true },
      })
    ).map((c) => ({ ...c, remaining: billing.creditRemaining(c) }));
  }
  return shaped;
};

const getInvoice = async (req, res) => {
  res.json({ data: await loadInvoice(req) });
};

// POST /company/invoices { order_id, send? }
const createInvoice = async (req, res) => {
  const orderId = toId(req.body.order_id, "order_id");
  const { invoice, created } = await prisma.$transaction(
    (tx) => billing.createInvoiceForOrder(tx, { company: req.company, orderId, userId: req.user.id }),
    TX,
  );
  if (!created) throw new HttpError(409, `This order already has invoice ${invoice.invoice_number}`);
  await audit(req, "invoice.create", { entity: "invoice", entityId: invoice.id, changes: { invoice_number: invoice.invoice_number, order_id: orderId } });
  if (req.body.send !== false) await emailInvoice(invoice.id);
  res.status(201).json({ message: `Invoice ${invoice.invoice_number} created`, data: await loadInvoice(req, invoice.id) });
};

const invoicePdf = async (req, res) => {
  await sendPdf(res, "invoice", toId(req.params.id), req.company.id);
};

// POST /company/invoices/:id/send { to? }
const sendInvoice = async (req, res) => {
  const inv = await loadInvoice(req);
  if (inv.status === "void") throw new HttpError(400, "A void invoice can't be sent");
  const to = req.body?.to ? String(req.body.to).trim().toLowerCase() : null;
  if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new HttpError(400, "Enter a valid email address");
  if (!(await emailInvoice(inv.id, { to }))) throw new HttpError(400, "This invoice has no customer email");
  await audit(req, "invoice.send", { entity: "invoice", entityId: inv.id, changes: { to: to || inv.customer?.email } });
  res.json({ message: `Invoice ${inv.invoice_number} emailed to ${to || inv.customer?.email}`, data: await loadInvoice(req) });
};

// POST /company/invoices/:id/payments { amount, method, reference?, paid_at?, notes?, notify? }
const addPayment = async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount)) throw new HttpError(400, "Amount is required");
  const { payment, invoice } = await prisma.$transaction(
    (tx) =>
      billing.recordPayment(tx, {
        companyId: req.company.id,
        invoiceId: toId(req.params.id),
        amount,
        method: String(req.body.method || "bank_transfer"),
        reference: req.body.reference,
        paidAt: billing.parseDate(req.body.paid_at, "Payment date"),
        notes: req.body.notes,
        userId: req.user.id,
        accountId: req.body.account_id ? toId(req.body.account_id, "account_id") : null,
      }),
    TX,
  );
  await audit(req, "invoice.payment", { entity: "invoice", entityId: invoice.id, changes: { amount: num(payment.amount), method: payment.method, reference: payment.reference } });
  if (req.body.notify !== false) await emailPaymentReceived(invoice.id, num(payment.amount));
  res.status(201).json({ message: `Payment of ${num(payment.amount).toFixed(2)} recorded`, data: await loadInvoice(req) });
};

const removePayment = async (req, res) => {
  const { payment, invoice } = await prisma.$transaction(
    (tx) => billing.deletePayment(tx, { companyId: req.company.id, invoiceId: toId(req.params.id), paymentId: toId(req.params.paymentId, "payment id") }),
    TX,
  );
  await audit(req, "invoice.payment.delete", { entity: "invoice", entityId: invoice.id, changes: { amount: num(payment.amount), method: payment.method } });
  res.json({ message: "Payment removed", data: await loadInvoice(req) });
};

const voidInvoice = async (req, res) => {
  const inv = await prisma.$transaction((tx) => billing.voidInvoice(tx, { companyId: req.company.id, invoiceId: toId(req.params.id) }), TX);
  await audit(req, "invoice.void", { entity: "invoice", entityId: inv.id, changes: { invoice_number: inv.invoice_number, reason: req.body?.reason || null } });
  res.json({ message: `Invoice ${inv.invoice_number} voided`, data: await loadInvoice(req) });
};

// ---- credit notes ---------------------------------------------------------------------

const listCreditNotes = async (req, res) => {
  const status = String(req.query.status || "");
  const rows = await prisma.credit_notes.findMany({
    where: {
      company_id: req.company.id,
      ...(["issued", "applied", "refunded", "void"].includes(status) ? { status } : {}),
      ...(req.query.customer_id ? { user_id: toId(req.query.customer_id, "customer_id") } : {}),
    },
    orderBy: { created_at: "desc" },
    take: 500,
    include: {
      users: { select: userSelect },
      invoices: { select: { id: true, invoice_number: true } },
      return_requests: { select: { id: true, rma_number: true } },
    },
  });
  res.json({ data: rows.map(shapeCreditNote) });
};

const loadCreditNote = async (req, id = req.params.id) => {
  const cn = await prisma.credit_notes.findFirst({
    where: { id: toId(id), company_id: req.company.id },
    include: {
      users: { select: userSelect },
      invoices: { select: { id: true, invoice_number: true } },
      return_requests: { select: { id: true, rma_number: true } },
      credit_note_items: { orderBy: { id: "asc" } },
    },
  });
  if (!cn) throw new HttpError(404, "Credit note not found");
  const shaped = shapeCreditNote(cn);
  shaped.open_invoices = cn.user_id
    ? (
        await prisma.invoices.findMany({
          where: { company_id: req.company.id, user_id: cn.user_id, status: { in: ["issued", "partially_paid"] } },
          orderBy: { due_date: "asc" },
          select: { id: true, invoice_number: true, total_amount: true, amount_paid: true, amount_credited: true, due_date: true, status: true },
        })
      ).map((i) => ({ ...i, balance: billing.invoiceBalance(i) }))
    : [];
  return shaped;
};

const getCreditNote = async (req, res) => {
  res.json({ data: await loadCreditNote(req) });
};

/**
 * POST /company/credit-notes
 *   { invoice_id, reason, amount?  (a single adjustment line, tax-inclusive)
 *     items?: [{ description, quantity, unit_price, product_id? }], tax?, notes?, apply?: true, notify?: true }
 */
const createCreditNote = async (req, res) => {
  const b = req.body;
  const invoiceId = toId(b.invoice_id, "invoice_id");
  const result = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoices.findFirst({ where: { id: invoiceId, company_id: req.company.id } });
    if (!inv) throw new HttpError(404, "Invoice not found");
    if (inv.status === "void") throw new HttpError(400, "That invoice is void");
    let items;
    let tax = 0;
    if (Array.isArray(b.items) && b.items.length) {
      items = b.items.map((i, idx) => {
        const quantity = Number(i.quantity);
        const unit = Number(i.unit_price);
        if (!Number.isInteger(quantity) || quantity < 1) throw new HttpError(400, `Line ${idx + 1}: quantity must be a whole number`);
        if (!Number.isFinite(unit) || unit <= 0) throw new HttpError(400, `Line ${idx + 1}: price must be more than 0`);
        return { description: String(i.description || "Credit").trim(), quantity, unit_price: unit, product_id: i.product_id || null };
      });
      tax = Math.max(0, Number(b.tax) || 0);
    } else {
      const amount = Number(b.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Enter the credit amount or the lines to credit");
      items = [{ description: String(b.reason || "Credit adjustment").trim(), quantity: 1, unit_price: round2(amount) }];
    }
    const total = round2(items.reduce((s, i) => s + i.unit_price * i.quantity, 0) + tax);
    // Never credit more than was invoiced (minus credits already raised against it).
    const [{ credited }] = await tx.$queryRaw`
      SELECT COALESCE(SUM(total_amount), 0)::float AS credited FROM credit_notes WHERE invoice_id = ${inv.id} AND status <> 'void'`;
    const max = round2(num(inv.total_amount) - credited);
    if (total > max + 0.004) throw new HttpError(400, `You can credit at most ${max.toFixed(2)} on this invoice`);

    const cn = await billing.createCreditNote(tx, {
      companyId: req.company.id, userId: inv.user_id, invoiceId: inv.id, reason: b.reason, items, tax, notes: b.notes, createdBy: req.user.id,
    });
    let applied = 0;
    if (b.apply !== false && billing.invoiceBalance(inv) > 0 && ["issued", "partially_paid"].includes(inv.status)) {
      applied = (await billing.applyCreditNote(tx, { companyId: req.company.id, creditNoteId: cn.id, invoiceId: inv.id })).amount;
    }
    return { cn, applied, invoiceNumber: inv.invoice_number };
  }, TX);
  await audit(req, "credit_note.create", { entity: "credit_note", entityId: result.cn.id, changes: { number: result.cn.credit_note_number, total: num(result.cn.total_amount), applied: result.applied } });
  if (b.notify !== false) await emailCreditNote(result.cn.id, { applied: result.applied, invoiceNumber: result.invoiceNumber });
  res.status(201).json({
    message: `Credit note ${result.cn.credit_note_number} issued${result.applied ? ` and ${result.applied.toFixed(2)} applied to ${result.invoiceNumber}` : ""}`,
    data: await loadCreditNote(req, result.cn.id),
  });
};

// POST /company/credit-notes/:id/apply { invoice_id, amount? }
const applyCreditNote = async (req, res) => {
  const r = await prisma.$transaction(
    (tx) => billing.applyCreditNote(tx, { companyId: req.company.id, creditNoteId: toId(req.params.id), invoiceId: toId(req.body.invoice_id, "invoice_id"), amount: req.body.amount }),
    TX,
  );
  await audit(req, "credit_note.apply", { entity: "credit_note", entityId: r.creditNote.id, changes: { invoice: r.invoice.invoice_number, amount: r.amount } });
  res.json({ message: `${r.amount.toFixed(2)} applied to ${r.invoice.invoice_number}`, data: await loadCreditNote(req) });
};

// POST /company/credit-notes/:id/refund { amount?, method?, reference? }  (records that the money was paid back)
const refundCreditNote = async (req, res) => {
  const before = await loadCreditNote(req);
  const cn = await prisma.$transaction((tx) => billing.refundCreditNote(tx, {
    companyId: req.company.id, creditNoteId: before.id, amount: req.body.amount, userId: req.user.id,
    accountId: req.body.account_id ? toId(req.body.account_id, "account_id") : null,
  }), TX);
  const amount = round2(num(cn.amount_refunded) - num(before.amount_refunded));
  await audit(req, "credit_note.refund", { entity: "credit_note", entityId: cn.id, changes: { amount, method: req.body.method || null, reference: req.body.reference || null } });
  res.json({ message: `Refund of ${amount.toFixed(2)} recorded`, data: await loadCreditNote(req) });
};

const voidCreditNote = async (req, res) => {
  const cn = await prisma.$transaction((tx) => billing.voidCreditNote(tx, { companyId: req.company.id, creditNoteId: toId(req.params.id) }), TX);
  await audit(req, "credit_note.void", { entity: "credit_note", entityId: cn.id, changes: { number: cn.credit_note_number } });
  res.json({ message: `Credit note ${cn.credit_note_number} voided`, data: await loadCreditNote(req) });
};

const creditNotePdf = async (req, res) => {
  await sendPdf(res, "credit_note", toId(req.params.id), req.company.id);
};

const sendCreditNote = async (req, res) => {
  const cn = await loadCreditNote(req);
  if (!(await emailCreditNote(cn.id))) throw new HttpError(400, "This credit note has no customer email");
  res.json({ message: `Credit note ${cn.credit_note_number} emailed to ${cn.customer?.email}` });
};

// ---- receivables ----------------------------------------------------------------------

// GET /company/reports/ar-aging -> what each customer owes, by how late it is
const arAging = async (req, res) => {
  const todayStr = billing.today().toISOString().slice(0, 10);
  const rows = await prisma.$queryRaw`
    SELECT i.user_id,
           COALESCE(NULLIF(u.business_name, ''), NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS customer,
           u.email,
           COUNT(*)::int AS invoices,
           SUM(i.total_amount - i.amount_paid - i.amount_credited) FILTER (WHERE i.due_date >= ${todayStr}::date)::float AS current,
           SUM(i.total_amount - i.amount_paid - i.amount_credited) FILTER (WHERE (${todayStr}::date - i.due_date) BETWEEN 1 AND 30)::float AS d1_30,
           SUM(i.total_amount - i.amount_paid - i.amount_credited) FILTER (WHERE (${todayStr}::date - i.due_date) BETWEEN 31 AND 60)::float AS d31_60,
           SUM(i.total_amount - i.amount_paid - i.amount_credited) FILTER (WHERE (${todayStr}::date - i.due_date) BETWEEN 61 AND 90)::float AS d61_90,
           SUM(i.total_amount - i.amount_paid - i.amount_credited) FILTER (WHERE (${todayStr}::date - i.due_date) > 90)::float AS d90_plus,
           SUM(i.total_amount - i.amount_paid - i.amount_credited)::float AS total
    FROM invoices i LEFT JOIN users u ON u.id = i.user_id
    WHERE i.company_id = ${req.company.id} AND i.status IN ('issued', 'partially_paid')
    GROUP BY i.user_id, u.business_name, u.first_name, u.last_name, u.email
    HAVING SUM(i.total_amount - i.amount_paid - i.amount_credited) > 0
    ORDER BY total DESC`;
  const keys = ["current", "d1_30", "d31_60", "d61_90", "d90_plus", "total"];
  const data = rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, round2(r[k] || 0)])) }));
  const totals = Object.fromEntries(keys.map((k) => [k, round2(data.reduce((s, r) => s + r[k], 0))]));
  res.json({ data, totals, as_of: billing.today().toISOString().slice(0, 10) });
};

module.exports = {
  listInvoices, getInvoice, createInvoice, invoicePdf, sendInvoice, addPayment, removePayment, voidInvoice,
  listCreditNotes, getCreditNote, createCreditNote, applyCreditNote, refundCreditNote, voidCreditNote, creditNotePdf, sendCreditNote,
  arAging,
};
