// The buyer's side of sales documents: invoices, credit notes, quotes and returns.
const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const { round2 } = require("../services/money");
const billing = require("../services/invoicing");
const { sendPdf } = require("../services/documents");
const { queueEmail } = require("../services/email/outbox");
const { notifyCompany } = require("../services/notify");
const { displayName } = require("../services/users");
const { expireQuotes, buildLines, quoteTotals, acceptQuote } = require("../services/quotes");
const { getSalesSettings } = require("../services/salesSettings");
const { nextNumber } = require("../services/sequences");
const { REASONS, createReturn, returnableFor } = require("../services/returns");

const TX = { timeout: 30000, maxWait: 10000 };
const companySelect = { id: true, name: true, slug: true, logo_url: true };
const me = (req) => BigInt(req.user.id);
const customerName = (u) => u.business_name || displayName(u) || u.email;

// ---- invoices & credit notes ----------------------------------------------------------

// GET /account/invoices?status=open|paid|overdue&company_id
const listInvoices = async (req, res) => {
  const status = String(req.query.status || "");
  const rows = await prisma.invoices.findMany({
    where: {
      user_id: me(req),
      status: { not: "void" },
      ...(status === "open" ? { status: { in: ["issued", "partially_paid"] } } : {}),
      ...(status === "overdue" ? { status: { in: ["issued", "partially_paid"] }, due_date: { lt: billing.today() } } : {}),
      ...(status === "paid" ? { status: "paid" } : {}),
      ...(req.query.company_id ? { company_id: toId(req.query.company_id, "company_id") } : {}),
    },
    orderBy: [{ issue_date: "desc" }, { id: "desc" }],
    take: 500,
    include: { companies: { select: companySelect }, orders: { select: { id: true, order_number: true } } },
  });
  const data = rows.map(({ companies, orders, billing_snapshot, ...i }) => ({
    ...i,
    company: companies,
    order: orders,
    balance: billing.invoiceBalance(i),
    overdue: billing.isOverdue(i),
  }));
  const credits = await prisma.credit_notes.findMany({
    where: { user_id: me(req), status: { not: "void" } },
    orderBy: { created_at: "desc" },
    take: 200,
    include: { companies: { select: companySelect }, invoices: { select: { id: true, invoice_number: true } } },
  });
  res.json({
    data,
    credit_notes: credits.map(({ companies, invoices, ...c }) => ({ ...c, company: companies, invoice: invoices, remaining: billing.creditRemaining(c) })),
    summary: {
      outstanding: round2(data.filter((i) => ["issued", "partially_paid"].includes(i.status)).reduce((s, i) => s + i.balance, 0)),
      overdue: round2(data.filter((i) => i.overdue).reduce((s, i) => s + i.balance, 0)),
    },
  });
};

const getInvoice = async (req, res) => {
  const inv = await prisma.invoices.findFirst({
    where: { id: toId(req.params.id), user_id: me(req), status: { not: "void" } },
    include: {
      companies: { select: { ...companySelect, email: true, phone: true } },
      orders: { select: { id: true, order_number: true } },
      invoice_items: { orderBy: { id: "asc" } },
      invoice_payments: { orderBy: { paid_at: "asc" }, select: { id: true, amount: true, method: true, reference: true, paid_at: true } },
      credit_notes: { where: { status: { not: "void" } }, select: { id: true, credit_note_number: true, total_amount: true, status: true } },
    },
  });
  if (!inv) throw new HttpError(404, "Invoice not found");
  const { companies, orders, ...rest } = inv;
  res.json({ data: { ...rest, company: companies, order: orders, balance: billing.invoiceBalance(inv), overdue: billing.isOverdue(inv) } });
};

const invoicePdf = async (req, res) => {
  const inv = await prisma.invoices.findFirst({ where: { id: toId(req.params.id), user_id: me(req), status: { not: "void" } }, select: { id: true } });
  if (!inv) throw new HttpError(404, "Invoice not found");
  await sendPdf(res, "invoice", inv.id);
};

const creditNotePdf = async (req, res) => {
  const cn = await prisma.credit_notes.findFirst({ where: { id: toId(req.params.id), user_id: me(req), status: { not: "void" } }, select: { id: true } });
  if (!cn) throw new HttpError(404, "Credit note not found");
  await sendPdf(res, "credit_note", cn.id);
};

// ---- quotes ---------------------------------------------------------------------------

const quoteInclude = {
  companies: { select: companySelect },
  orders: { select: { id: true, order_number: true, status: true } },
  quote_items: { orderBy: { id: "asc" }, include: { products: { select: { title: true, sku: true, url: true } } } },
};
// Quotes staff started themselves stay internal until they are first sent.
const visibleQuote = { NOT: { created_by: { not: null }, sent_at: null } };

const shapeQuote = ({ companies, orders, quote_items, created_by, ...q }) => ({
  ...q,
  company: companies,
  order: orders,
  items: quote_items?.map(({ products, ...i }) => ({ ...i, title: products?.title, sku: products?.sku, image: products?.url })),
  can_accept: q.status === "sent",
});

const listQuotes = async (req, res) => {
  await expireQuotes(prisma, { user_id: me(req) });
  const rows = await prisma.quotes.findMany({
    where: { user_id: me(req), ...visibleQuote },
    orderBy: { created_at: "desc" },
    take: 200,
    include: quoteInclude,
  });
  res.json({ data: rows.map(shapeQuote) });
};

const loadQuote = async (req, id = req.params.id) => {
  const q = await prisma.quotes.findFirst({ where: { id: toId(id), user_id: me(req), ...visibleQuote }, include: quoteInclude });
  if (!q) throw new HttpError(404, "Quote not found");
  return shapeQuote(q);
};

const getQuote = async (req, res) => {
  await expireQuotes(prisma, { user_id: me(req), id: toId(req.params.id) });
  res.json({ data: await loadQuote(req) });
};

const quotePdf = async (req, res) => {
  const q = await loadQuote(req);
  await sendPdf(res, "quote", q.id);
};

/**
 * POST /account/quotes { company_id, items?: [{ product_id, quantity }], notes? }
 * Without items, the cart's products from that company are used.
 */
const requestQuote = async (req, res) => {
  const companyId = toId(req.body.company_id, "company_id");
  const company = await prisma.companies.findFirst({ where: { id: companyId, status: "active" } });
  if (!company) throw new HttpError(404, "Seller not found");
  let items = req.body.items;
  if (!Array.isArray(items) || !items.length) {
    const cart = await prisma.cart_items.findMany({ where: { user_id: me(req), products: { is: { company_id: companyId } } }, select: { product_id: true, flavor: true, quantity: true } });
    items = cart.map((c) => ({ product_id: c.product_id, flavor: c.flavor, quantity: c.quantity }));
    if (!items.length) throw new HttpError(400, `Your cart has no products from ${company.name}`);
  }
  // customers can't set their own prices
  items = items.map((i) => ({ product_id: i.product_id, flavor: i.flavor, quantity: i.quantity }));

  const q = await prisma.$transaction(async (tx) => {
    const lines = await buildLines(tx, companyId, req.user.id, items);
    const customer = await tx.company_customers.upsert({
      where: { company_id_user_id: { company_id: companyId, user_id: me(req) } },
      create: { company_id: companyId, user_id: me(req) },
      update: {},
    });
    if (customer.status === "blocked") throw new HttpError(403, `Your account with ${company.name} is on hold. Please contact them.`);
    const totals = quoteTotals(company, customer, lines);
    return tx.quotes.create({
      data: {
        company_id: companyId,
        user_id: me(req),
        quote_number: await nextNumber(tx, companyId, "quote", "Q"),
        status: "requested",
        customer_notes: req.body.notes ? String(req.body.notes).slice(0, 2000) : null,
        valid_until: billing.addDays(billing.today(), getSalesSettings(company).quoteValidityDays),
        ...totals,
        quote_items: { create: lines.map((l) => ({ product_id: l.product_id, flavor: l.flavor, quantity: l.quantity, unit_price: l.unit_price, line_total: l.line_total })) },
      },
      include: { quote_items: { include: { products: { select: { title: true } } } } },
    });
  }, TX);

  const user = await prisma.users.findUnique({ where: { id: me(req) } });
  await notifyCompany(companyId, "quotes.manage", {
    template: "quoteRequested",
    data: {
      companyName: company.name,
      quoteNumber: q.quote_number,
      customer: customerName(user),
      items: q.quote_items.map((i) => ({ title: i.flavor ? `${i.products.title} (${i.flavor})` : i.products.title, quantity: i.quantity, price: Number(i.unit_price) })),
      notes: q.customer_notes,
    },
  });
  res.status(201).json({ message: `Quote request ${q.quote_number} sent to ${company.name}`, data: await loadQuote(req, q.id) });
};

// POST /account/quotes/:id/accept { shipping_address_id, billing_address_id?, payment_method?, business_name? }
const acceptQuoteHandler = async (req, res) => {
  await expireQuotes(prisma, { user_id: me(req), id: toId(req.params.id) });
  const { order, quote, company } = await prisma.$transaction((tx) => acceptQuote(tx, { quoteId: toId(req.params.id), userId: req.user.id, body: req.body }), TX);
  const user = await prisma.users.findUnique({ where: { id: me(req) } });
  const items = await prisma.order_items.findMany({ where: { order_id: order.id }, include: { products: { select: { title: true } } } });
  const emailItems = items.map((i) => ({ title: i.products?.title, quantity: i.quantity, price: Number(i.price_at_time) }));
  await queueEmail({
    to: user.email,
    template: "orderConfirmation",
    data: {
      name: displayName(user),
      orders: [{
        orderNumber: order.order_number, companyName: company.name, items: emailItems,
        shipping: Number(order.shipping_amount), discount: Number(order.discount_amount), tax: Number(order.tax_amount),
        paymentMethod: order.payment_method, total: Number(order.total_amount),
      }],
    },
  });
  await notifyCompany(company.id, "orders.view", {
    template: "quoteResponse",
    data: { companyName: company.name, quoteNumber: quote.quote_number, customer: customerName(user), accepted: true, orderNumber: order.order_number },
  });
  res.status(201).json({
    message: `Quote accepted. Order ${order.order_number} placed 📦`,
    order: { id: order.id, orderNumber: order.order_number, total: order.total_amount, payment_method: order.payment_method },
    data: await loadQuote(req),
  });
};

const declineQuote = async (req, res) => {
  const q = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw`SELECT id, status FROM quotes WHERE id = ${toId(req.params.id)} AND user_id = ${me(req)} FOR UPDATE`;
    if (!row) throw new HttpError(404, "Quote not found");
    if (!["sent", "requested"].includes(row.status)) throw new HttpError(400, `This quote is ${row.status}`);
    return tx.quotes.update({
      where: { id: row.id },
      data: { status: row.status === "requested" ? "cancelled" : "declined", updated_at: new Date(), ...(req.body?.reason ? { customer_notes: String(req.body.reason).slice(0, 2000) } : {}) },
      include: { companies: { select: { id: true, name: true } } },
    });
  }, TX);
  if (q.status === "declined") {
    const user = await prisma.users.findUnique({ where: { id: me(req) } });
    await notifyCompany(q.company_id, "quotes.manage", {
      template: "quoteResponse",
      data: { companyName: q.companies.name, quoteNumber: q.quote_number, customer: customerName(user), accepted: false },
    });
  }
  res.json({ message: q.status === "declined" ? `Quote ${q.quote_number} declined` : `Quote request ${q.quote_number} withdrawn`, data: q.status === "declined" ? await loadQuote(req) : null });
};

// ---- returns --------------------------------------------------------------------------

const returnInclude = {
  companies: { select: companySelect },
  orders: { select: { id: true, order_number: true } },
  return_items: { orderBy: { id: "asc" }, include: { order_items: { select: { quantity: true, price_at_time: true, products: { select: { title: true, sku: true } } } } } },
  credit_notes: { where: { status: { not: "void" } }, select: { id: true, credit_note_number: true, total_amount: true, status: true } },
};
const shapeReturn = ({ companies, orders, return_items, credit_notes, warehouse_id, ...r }) => ({
  ...r,
  reason_label: REASONS[r.reason] || r.reason,
  company: companies,
  order: orders,
  credit_note: credit_notes?.[0] || null,
  items: return_items?.map(({ order_items, ...i }) => ({ ...i, title: order_items?.products?.title, sku: order_items?.products?.sku, unit_price: order_items?.price_at_time })),
});

const listReturns = async (req, res) => {
  const rows = await prisma.return_requests.findMany({ where: { user_id: me(req) }, orderBy: { created_at: "desc" }, take: 200, include: returnInclude });
  res.json({ data: rows.map(shapeReturn), reasons: REASONS });
};

const getReturn = async (req, res) => {
  const r = await prisma.return_requests.findFirst({ where: { id: toId(req.params.id), user_id: me(req) }, include: returnInclude });
  if (!r) throw new HttpError(404, "Return not found");
  res.json({ data: shapeReturn(r) });
};

// GET /account/orders/:id/returnable
const returnableLines = async (req, res) => {
  const order = await prisma.orders.findFirst({
    where: { id: toId(req.params.id), user_id: me(req) },
    include: { companies: true, order_items: { orderBy: { id: "asc" }, include: { products: { select: { title: true, sku: true } } } } },
  });
  if (!order) throw new HttpError(404, "Order not found");
  const lines = await returnableFor(prisma, order);
  const { returnWindowDays } = getSalesSettings(order.companies);
  const since = order.shipped_at || order.created_at;
  const deadline = returnWindowDays && since ? new Date(new Date(since).getTime() + returnWindowDays * 86400000) : null;
  res.json({
    data: lines.map((l) => ({ order_item_id: l.id, title: l.products?.title, sku: l.products?.sku, quantity: l.quantity, returned: l.returned, returnable: l.returnable, price: l.price_at_time })),
    reasons: REASONS,
    eligible: order.status === "delivered" && !!deadline && deadline > new Date() && lines.some((l) => l.returnable > 0),
    deadline,
  });
};

// POST /account/returns { order_id, reason, notes?, items: [{ order_item_id, quantity }] }
const requestReturn = async (req, res) => {
  const orderId = toId(req.body.order_id, "order_id");
  const ret = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} AND user_id = ${me(req)} FOR UPDATE`;
    if (!locked) throw new HttpError(404, "Order not found");
    const order = await tx.orders.findUnique({
      where: { id: locked.id },
      include: { companies: true, order_items: { orderBy: { id: "asc" }, include: { products: { select: { title: true, sku: true } } } } },
    });
    if (!order.companies) throw new HttpError(400, "This order has no seller");
    const r = await createReturn(tx, { order, company: order.companies, body: req.body });
    return { r, order };
  }, TX);
  const user = await prisma.users.findUnique({ where: { id: me(req) } });
  await notifyCompany(ret.order.company_id, "returns.manage", {
    template: "returnRequested",
    data: {
      companyName: ret.order.companies.name,
      rmaNumber: ret.r.rma_number,
      orderNumber: ret.order.order_number,
      customer: customerName(user),
      reason: REASONS[ret.r.reason],
      notes: ret.r.customer_notes,
      items: ret.r.return_items.map((ri) => {
        const line = ret.order.order_items.find((l) => l.id === ri.order_item_id);
        return { title: line?.products?.title, quantity: ri.quantity, price: Number(line?.price_at_time || 0) };
      }),
    },
  });
  const r = await prisma.return_requests.findUnique({ where: { id: ret.r.id }, include: returnInclude });
  res.status(201).json({ message: `Return request ${ret.r.rma_number} sent to ${ret.order.companies.name}`, data: shapeReturn(r) });
};

const cancelReturn = async (req, res) => {
  const r = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw`SELECT id, status FROM return_requests WHERE id = ${toId(req.params.id)} AND user_id = ${me(req)} FOR UPDATE`;
    if (!row) throw new HttpError(404, "Return not found");
    if (row.status !== "requested") throw new HttpError(400, "Only a return that hasn't been approved yet can be cancelled");
    return tx.return_requests.update({ where: { id: row.id }, data: { status: "cancelled", closed_at: new Date(), updated_at: new Date() } });
  }, TX);
  res.json({ message: `Return ${r.rma_number} cancelled` });
};

module.exports = {
  listInvoices, getInvoice, invoicePdf, creditNotePdf,
  listQuotes, getQuote, quotePdf, requestQuote, acceptQuote: acceptQuoteHandler, declineQuote,
  listReturns, getReturn, returnableLines, requestReturn, cancelReturn,
};
