// Quotes (quotations) prepared by a company for a customer.
// requested (by the customer) / draft (by staff) -> sent -> accepted (becomes an order) | declined | expired | cancelled
//   sent -> countered (the customer asked for changes) -> edited and sent again (a new version)
// Quotes from a request sent to several sellers carry rfq_id; sellers see the request but not the other offers.
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
const flow = require("../../services/quoteFlow");
const { round2: r2 } = require("../../services/money");

const TX = { timeout: 20000, maxWait: 10000 };
const EDITABLE = ["requested", "draft", "sent", "countered"];
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
  const q = await prisma.quotes.findFirst({
    where: { id: toId(id), company_id: req.company.id },
    include: { ...include, rfqs: { select: { id: true, rfq_number: true, title: true, notes: true, needed_by: true, status: true, rfq_items: { orderBy: { sort_order: "asc" } } } } },
  });
  if (!q) throw new HttpError(404, "Quote not found");
  const { rfqs, ...rest } = q;
  const margin = await flow.marginFor(prisma, q, req.company);
  return {
    ...shape(rest),
    rfq: rfqs ? { ...rfqs, competitive: true } : null,
    margin,
    margin_warnings: flow.marginWarnings(margin, q.quote_items),
    messages: await flow.messagesOf(prisma, q.id),
    versions: await flow.versionsOf(prisma, q.id),
  };
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

const leadTime = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 365) throw new HttpError(400, "Delivery time must be 0 to 365 days");
  return n;
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
        lead_time_days: leadTime(b.lead_time_days) ?? null,
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
    if (b.lead_time_days !== undefined) data.lead_time_days = leadTime(b.lead_time_days);
    if (quote.status === "sent" || quote.status === "countered") data.status = "draft";
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

// Sending checks margins (lines below cost are refused when the company says so, unless a pricing manager
// overrides with { override_margin: true }) and stores what was sent as a new version.
const sendQuoteNow = async (req, res, id, status = 200) => {
  let warnings = [];
  const q = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw`SELECT id, status FROM quotes WHERE id = ${BigInt(id)} AND company_id = ${req.company.id} FOR UPDATE`;
    if (!row) throw new HttpError(404, "Quote not found");
    if (!EDITABLE.includes(row.status)) throw new HttpError(400, `A ${row.status} quote can't be sent`);
    const quote = await tx.quotes.findUnique({ where: { id: row.id }, include: { quote_items: { orderBy: { id: "asc" }, include: { products: { select: { title: true } } } } } });
    if (!quote.quote_items.length) throw new HttpError(400, "Add at least one product before sending");
    const margin = await flow.marginFor(tx, quote, req.company);
    warnings = flow.marginWarnings(margin, quote.quote_items);
    if (margin.below_cost && margin.block_below_cost && !(req.body?.override_margin === true && req.can("pricing.manage"))) {
      throw new HttpError(400, `Not sent: ${warnings.filter((w) => /below cost/.test(w)).join("; ")}. Raise the price, or (as a pricing manager) send anyway.`);
    }
    const validUntil = quote.valid_until && quote.valid_until >= today() ? quote.valid_until : addDays(today(), getSalesSettings(req.company).quoteValidityDays);
    const version = (quote.version || 0) + 1;
    const updated = await tx.quotes.update({
      where: { id: quote.id },
      data: { status: "sent", sent_at: new Date(), valid_until: validUntil, version, follow_up_sent_at: null, expiry_reminder_sent_at: null, updated_at: new Date() },
    });
    await tx.quote_versions.create({ data: { quote_id: quote.id, version, snapshot: flow.snapshotOf(updated, quote.quote_items), created_by: BigInt(req.user.id) } });
    return updated;
  }, TX);
  await emailQuote(q.id);
  await audit(req, "quote.send", { entity: "quote", entityId: q.id, changes: { number: q.quote_number } });
  res.status(status).json({ message: `Quote ${q.quote_number} sent to the customer${q.version > 1 ? ` (version ${q.version})` : ""}`, warnings, data: await load(req, q.id) });
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

// POST /company/quotes/:id/messages { body } -> message to the customer
const postMessage = async (req, res) => {
  const quote = await prisma.quotes.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id }, include: { users: { select: { email: true } } } });
  if (!quote) throw new HttpError(404, "Quote not found");
  const body = String(req.body.body || "").trim().slice(0, 4000);
  if (!body) throw new HttpError(400, "Write a message");
  await prisma.quote_messages.create({ data: { quote_id: quote.id, author_side: "seller", author_id: BigInt(req.user.id), body, version: quote.version } });
  const { queueEmail } = require("../../services/email/outbox");
  await queueEmail({ to: quote.users.email, template: "notice", companyId: req.company.id, data: { type: "quote.message", title: `${req.company.name} wrote about quote ${quote.quote_number}`, lines: [body], link: "/account?tab=quotes", linkLabel: "Open the quote" } });
  res.status(201).json({ message: "Message sent", data: await load(req) });
};

/**
 * POST /company/quotes/:id/apply-counter { message_id } -> puts the customer's proposed prices / quantities into the
 * quote (as a draft to review and send). A target total becomes a quote-level discount.
 */
const applyCounter = async (req, res) => {
  await prisma.$transaction(async (tx) => {
    const quote = await lockQuote(tx, req, EDITABLE);
    const msg = await tx.quote_messages.findFirst({ where: { id: toId(req.body.message_id, "message_id"), quote_id: quote.id, author_side: "customer", proposal: { not: null } } });
    if (!msg) throw new HttpError(404, "Counter-offer not found");
    const items = await tx.quote_items.findMany({ where: { quote_id: quote.id }, orderBy: { id: "asc" } });
    const lines = items.map((i) => {
      const p = (msg.proposal.lines || []).find((l) => String(l.item_id) === String(i.id));
      return { product_id: i.product_id, flavor: i.flavor, description: i.description, quantity: p?.quantity ?? i.quantity, unit_price: p?.unit_price ?? num(i.unit_price) };
    });
    const b = { items: lines };
    if (msg.proposal.total !== undefined) {
      const sub = lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);
      b.discount_amount = Math.max(0, r2(sub + num(quote.shipping_amount) - msg.proposal.total));
    }
    const totals = await writeLinesAndTotals(tx, req, quote.id, quote.user_id, b, quote);
    await tx.quotes.update({ where: { id: quote.id }, data: { ...totals, status: "draft", updated_at: new Date() } });
  }, TX);
  await audit(req, "quote.apply_counter", { entity: "quote", entityId: toId(req.params.id) });
  res.json({ message: "The customer's proposal is in the quote. Check it and send it again.", data: await load(req) });
};

module.exports = { listQuotes, getQuote, createQuote, updateQuote, sendQuote, cancelQuote, quotePdf, postMessage, applyCounter };
