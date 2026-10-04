// Quotes (quotations) prepared by a company for a customer.
// requested (by the customer) / draft (by staff) -> sent -> accepted (becomes an order) | declined | expired | cancelled
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { num } = require("../../services/money");
const { sendPdf } = require("../../services/documents");
const { emailQuote } = require("../../services/salesEmails");
const { expireQuotes, buildLines, quoteTotals } = require("../../services/quotes");
const { getSalesSettings } = require("../../services/salesSettings");
const { today, addDays, parseDate } = require("../../services/invoicing");
const { nextNumber } = require("../../services/sequences");

const TX = { timeout: 20000, maxWait: 10000 };
const EDITABLE = ["requested", "draft", "sent"];
const userSelect = { id: true, email: true, first_name: true, last_name: true, business_name: true, phone: true };

const shape = ({ users, orders, quote_items, ...q }) => ({
  ...q,
  customer: users,
  order: orders,
  items: quote_items?.map(({ products, ...i }) => ({ ...i, title: products?.title, sku: products?.sku, flavors: products?.flavors, list_price: products?.price })),
});

const include = {
  users: { select: userSelect },
  orders: { select: { id: true, order_number: true, status: true } },
  quote_items: { orderBy: { id: "asc" }, include: { products: { select: { title: true, sku: true, price: true, flavors: true } } } },
};

const load = async (req, id = req.params.id) => {
  const q = await prisma.quotes.findFirst({ where: { id: toId(id), company_id: req.company.id }, include });
  if (!q) throw new HttpError(404, "Quote not found");
  return shape(q);
};

const lockQuote = async (tx, req, allowed) => {
  const [row] = await tx.$queryRaw`SELECT id, status FROM quotes WHERE id = ${toId(req.params.id)} AND company_id = ${req.company.id} FOR UPDATE`;
  if (!row) throw new HttpError(404, "Quote not found");
  if (!allowed.includes(row.status)) throw new HttpError(400, `A ${row.status} quote can't be changed`);
  return tx.quotes.findUnique({ where: { id: row.id } });
};

// GET /company/quotes?status&search
const listQuotes = async (req, res) => {
  await expireQuotes(prisma, { company_id: req.company.id });
  const search = String(req.query.search || "").trim();
  const rows = await prisma.quotes.findMany({
    where: {
      company_id: req.company.id,
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(search
        ? { OR: [
            { quote_number: { contains: search, mode: "insensitive" } },
            { users: { is: { email: { contains: search, mode: "insensitive" } } } },
            { users: { is: { business_name: { contains: search, mode: "insensitive" } } } },
          ] }
        : {}),
    },
    orderBy: { created_at: "desc" },
    take: 300,
    include: { users: { select: userSelect }, orders: { select: { id: true, order_number: true, status: true } }, _count: { select: { quote_items: true } } },
  });
  const counts = await prisma.quotes.groupBy({ by: ["status"], where: { company_id: req.company.id }, _count: true });
  res.json({
    data: rows.map(({ _count, ...q }) => ({ ...shape(q), item_count: _count.quote_items })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  });
};

const getQuote = async (req, res) => {
  await expireQuotes(prisma, { company_id: req.company.id, id: toId(req.params.id) });
  res.json({ data: await load(req) });
};

const findCustomer = async (b) => {
  if (b.customer_id) {
    const u = await prisma.users.findUnique({ where: { id: toId(b.customer_id, "customer_id") }, select: { id: true } });
    if (!u) throw new HttpError(404, "Customer not found");
    return u.id;
  }
  const email = String(b.customer_email || "").trim().toLowerCase();
  if (!email) throw new HttpError(400, "Choose the customer");
  const u = await prisma.users.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
  if (!u) throw new HttpError(404, "No customer account uses that email. Ask them to sign up first.");
  return u.id;
};

const writeLinesAndTotals = async (tx, req, quoteId, userId, b, existing = null) => {
  const lines = await buildLines(tx, req.company.id, userId, b.items);
  const customer = await tx.company_customers.findUnique({ where: { company_id_user_id: { company_id: req.company.id, user_id: BigInt(userId) } } });
  const totals = quoteTotals(req.company, customer, lines, {
    discount: b.discount_amount !== undefined ? b.discount_amount : existing ? num(existing.discount_amount) : 0,
    shipping: b.shipping_amount !== undefined ? b.shipping_amount : existing ? num(existing.shipping_amount) : null,
  });
  await tx.quote_items.deleteMany({ where: { quote_id: quoteId } });
  await tx.quote_items.createMany({
    data: lines.map((l) => ({ quote_id: quoteId, product_id: l.product_id, flavor: l.flavor, description: l.description, quantity: l.quantity, unit_price: l.unit_price, line_total: l.line_total })),
  });
  return totals;
};

// POST /company/quotes { customer_id | customer_email, items, discount_amount?, shipping_amount?, valid_until?, notes?, send? }
const createQuote = async (req, res) => {
  const b = req.body;
  const userId = await findCustomer(b);
  const validUntil = parseDate(b.valid_until, "Valid until") || addDays(today(), getSalesSettings(req.company).quoteValidityDays);
  const q = await prisma.$transaction(async (tx) => {
    const quote = await tx.quotes.create({
      data: {
        company_id: req.company.id,
        user_id: userId,
        quote_number: await nextNumber(tx, req.company.id, "quote", "Q"),
        status: "draft",
        valid_until: validUntil,
        notes: b.notes ? String(b.notes).slice(0, 5000) : null,
        created_by: BigInt(req.user.id),
      },
    });
    const totals = await writeLinesAndTotals(tx, req, quote.id, userId, b);
    await tx.company_customers.upsert({
      where: { company_id_user_id: { company_id: req.company.id, user_id: userId } },
      create: { company_id: req.company.id, user_id: userId },
      update: {},
    });
    return tx.quotes.update({ where: { id: quote.id }, data: totals });
  }, TX);
  await audit(req, "quote.create", { entity: "quote", entityId: q.id, changes: { number: q.quote_number, total: num(q.total_amount) } });
  if (b.send) return sendQuoteNow(req, res, q.id, 201);
  res.status(201).json({ message: `Quote ${q.quote_number} saved as draft`, data: await load(req, q.id) });
};

// PATCH /company/quotes/:id { items?, discount_amount?, shipping_amount?, valid_until?, notes? }
// Editing a sent quote takes it back to draft (send it again afterwards).
const updateQuote = async (req, res) => {
  const b = req.body;
  const q = await prisma.$transaction(async (tx) => {
    const quote = await lockQuote(tx, req, EDITABLE);
    const data = { updated_at: new Date() };
    if (b.valid_until !== undefined) data.valid_until = parseDate(b.valid_until, "Valid until");
    if (b.notes !== undefined) data.notes = b.notes ? String(b.notes).slice(0, 5000) : null;
    if (quote.status === "sent") data.status = "draft";
    if (b.items !== undefined || b.discount_amount !== undefined || b.shipping_amount !== undefined) {
      const items = b.items !== undefined
        ? b.items
        : (await tx.quote_items.findMany({ where: { quote_id: quote.id }, orderBy: { id: "asc" } })).map((i) => ({ product_id: i.product_id, flavor: i.flavor, quantity: i.quantity, unit_price: num(i.unit_price), description: i.description }));
      Object.assign(data, await writeLinesAndTotals(tx, req, quote.id, quote.user_id, { ...b, items }, quote));
    }
    return tx.quotes.update({ where: { id: quote.id }, data });
  }, TX);
  await audit(req, "quote.update", { entity: "quote", entityId: q.id, changes: { total: num(q.total_amount), status: q.status } });
  res.json({ message: "Quote saved", data: await load(req) });
};

const sendQuoteNow = async (req, res, id, status = 200) => {
  const q = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw`SELECT id, status FROM quotes WHERE id = ${BigInt(id)} AND company_id = ${req.company.id} FOR UPDATE`;
    if (!row) throw new HttpError(404, "Quote not found");
    if (!EDITABLE.includes(row.status)) throw new HttpError(400, `A ${row.status} quote can't be sent`);
    const quote = await tx.quotes.findUnique({ where: { id: row.id }, include: { _count: { select: { quote_items: true } } } });
    if (!quote._count.quote_items) throw new HttpError(400, "Add at least one product before sending");
    const validUntil = quote.valid_until && quote.valid_until >= today() ? quote.valid_until : addDays(today(), getSalesSettings(req.company).quoteValidityDays);
    return tx.quotes.update({ where: { id: quote.id }, data: { status: "sent", sent_at: new Date(), valid_until: validUntil, updated_at: new Date() } });
  }, TX);
  await emailQuote(q.id);
  await audit(req, "quote.send", { entity: "quote", entityId: q.id, changes: { number: q.quote_number } });
  res.status(status).json({ message: `Quote ${q.quote_number} sent to the customer`, data: await load(req, q.id) });
};

const sendQuote = (req, res) => sendQuoteNow(req, res, toId(req.params.id));

const cancelQuote = async (req, res) => {
  const q = await prisma.$transaction(async (tx) => {
    const quote = await lockQuote(tx, req, EDITABLE);
    return tx.quotes.update({ where: { id: quote.id }, data: { status: "cancelled", updated_at: new Date() } });
  }, TX);
  await audit(req, "quote.cancel", { entity: "quote", entityId: q.id, changes: { number: q.quote_number } });
  res.json({ message: `Quote ${q.quote_number} cancelled`, data: await load(req) });
};

const quotePdf = async (req, res) => {
  await sendPdf(res, "quote", toId(req.params.id), req.company.id);
};

module.exports = { listQuotes, getQuote, createQuote, updateQuote, sendQuote, cancelQuote, quotePdf };
