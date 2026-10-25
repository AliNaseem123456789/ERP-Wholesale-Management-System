// Requests for quotation sent to several sellers at once, compared side by side, and awarded to one.
// Each seller gets its own quote (status "requested", linked by rfq_id) and answers it as usual;
// sellers never see each other's offers. Accepting one offer declines the others.
const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const { num } = require("../services/money");
const inv = require("../services/inventory");
const { publicWhere } = require("../services/catalog");
const { buildLines, quoteTotals, acceptQuote, expireQuotes } = require("../services/quotes");
const { getSalesSettings } = require("../services/salesSettings");
const { nextNumber } = require("../services/sequences");
const billing = require("../services/invoicing");
const { notifyCompany } = require("../services/notify");
const { queueEmail } = require("../services/email/outbox");
const { displayName } = require("../services/users");
const mk = require("../services/marketplace");
const flow = require("../services/quoteFlow");

const TX = { timeout: 30000, maxWait: 10000 };
const MAX_SELLERS = 10;
const me = (req) => BigInt(req.user.id);
const customerName = (u) => u.business_name || displayName(u) || u.email;

/**
 * POST /account/rfqs
 *   { title, notes?, needed_by?, items: [{ description, quantity, product_id?, flavor? }],
 *     company_ids?: [...], category?: slug (send to sellers of that category) }
 */
const createRfq = async (req, res) => {
  const b = req.body;
  const title = String(b.title || "").trim().slice(0, 255);
  if (!title) throw new HttpError(400, "Give your request a title");
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw new HttpError(400, "Add at least one item");
  if (items.length > 100) throw new HttpError(400, "At most 100 items");
  const clean = [];
  for (const [i, it] of items.entries()) {
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) throw new HttpError(400, `Item ${i + 1}: quantity must be a whole number`);
    let product = null;
    let flavor = "";
    if (it.product_id) {
      product = await prisma.products.findFirst({ where: { ...publicWhere(req), id: toId(it.product_id, "product_id") }, select: { id: true, title: true, company_id: true, flavors: true } });
      if (!product) throw new HttpError(400, `Item ${i + 1}: that product isn't available`);
      flavor = inv.resolveFlavor(product, it.flavor);
    }
    const description = String(it.description || (product ? inv.label(product.title, flavor) : "")).trim().slice(0, 500);
    if (!description) throw new HttpError(400, `Item ${i + 1}: describe what you need`);
    clean.push({ description, quantity: qty, product, flavor, sort_order: i });
  }
  let neededBy = null;
  if (b.needed_by) {
    neededBy = new Date(`${String(b.needed_by).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(neededBy.getTime())) throw new HttpError(400, "Needed-by date isn't valid");
  }

  // who receives it: chosen sellers, or the sellers of a category
  let companyIds = (Array.isArray(b.company_ids) ? b.company_ids : []).map((x) => String(toId(x, "company_ids")));
  if (!companyIds.length && b.category) {
    const rows = await mk.activeCategories();
    const c = rows.find((x) => x.slug === String(b.category).toLowerCase());
    if (!c) throw new HttpError(400, "Category not found");
    const sellers = await prisma.products.groupBy({ by: ["company_id"], where: { ...publicWhere(req), product_categories: { some: { category_id: { in: mk.descendants(rows, c.id) } } } }, _count: true, orderBy: { _count: { company_id: "desc" } }, take: MAX_SELLERS });
    companyIds = sellers.map((s) => String(s.company_id));
  }
  companyIds = [...new Set(companyIds)];
  if (!companyIds.length) throw new HttpError(400, "Choose at least one seller");
  if (companyIds.length > MAX_SELLERS) throw new HttpError(400, `Send to at most ${MAX_SELLERS} sellers`);
  const companies = await prisma.companies.findMany({ where: { id: { in: companyIds.map((x) => BigInt(x)) }, status: "active", storefront_published: true } });
  if (companies.length !== companyIds.length) throw new HttpError(400, "One of the sellers isn't available");

  const notes = b.notes ? String(b.notes).slice(0, 4000) : null;
  const { rfq, quotes } = await prisma.$transaction(async (tx) => {
    const count = await tx.rfqs.count();
    const rfq = await tx.rfqs.create({
      data: {
        user_id: me(req), rfq_number: `RFQ-${String(count + 1).padStart(5, "0")}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
        title, notes, needed_by: neededBy,
        rfq_items: { create: clean.map((c) => ({ description: c.description, quantity: c.quantity, product_id: c.product?.id || null, flavor: c.flavor, sort_order: c.sort_order })) },
      },
    });
    const quotes = [];
    for (const company of companies) {
      const customer = await tx.company_customers.upsert({
        where: { company_id_user_id: { company_id: company.id, user_id: me(req) } },
        create: { company_id: company.id, user_id: me(req) }, update: {},
      });
      if (customer.status === "blocked") continue;
      // lines the seller already sells (the buyer picked one of its products) are filled in at the buyer's price
      const own = clean.filter((c) => c.product && c.product.company_id === company.id);
      const lines = own.length ? await buildLines(tx, company.id, req.user.id, own.map((c) => ({ product_id: c.product.id, flavor: c.flavor, quantity: c.quantity }))) : [];
      const totals = quoteTotals(company, customer, lines);
      const listText = clean.map((c) => `${c.quantity} x ${c.description}`).join("\n");
      const q = await tx.quotes.create({
        data: {
          company_id: company.id, user_id: me(req), rfq_id: rfq.id,
          quote_number: await nextNumber(tx, company.id, "quote", "Q"), status: "requested",
          customer_notes: [`Request ${rfq.rfq_number}: ${title}`, listText, neededBy ? `Needed by ${flow.iso(neededBy)}` : null, notes].filter(Boolean).join("\n\n").slice(0, 5000),
          valid_until: billing.addDays(billing.today(), getSalesSettings(company).quoteValidityDays),
          ...totals,
          quote_items: { create: lines.map((l) => ({ product_id: l.product_id, flavor: l.flavor, quantity: l.quantity, unit_price: l.unit_price, line_total: l.line_total })) },
        },
      });
      quotes.push({ q, company });
    }
    if (!quotes.length) throw new HttpError(403, "None of these sellers can take your request");
    return { rfq, quotes };
  }, TX);

  const user = await prisma.users.findUnique({ where: { id: me(req) } });
  for (const { q, company } of quotes) {
    await notifyCompany(company.id, "quotes.manage", {
      template: "quoteRequested",
      data: { companyName: company.name, quoteNumber: q.quote_number, customer: customerName(user), items: clean.map((c) => ({ title: c.description, quantity: c.quantity, price: 0 })), notes: `Competitive request (${quotes.length} sellers)${neededBy ? `, needed by ${flow.iso(neededBy)}` : ""}${notes ? `. ${notes}` : ""}` },
    });
  }
  res.status(201).json({ message: `Request ${rfq.rfq_number} sent to ${quotes.length} seller(s)`, data: { id: rfq.id, rfq_number: rfq.rfq_number } });
};

// GET /account/rfqs
const listRfqs = async (req, res) => {
  const rows = await prisma.rfqs.findMany({
    where: { user_id: me(req) }, orderBy: { created_at: "desc" }, take: 100,
    include: { _count: { select: { rfq_items: true } }, quotes: { select: { id: true, status: true, total_amount: true } } },
  });
  res.json({
    data: rows.map(({ _count, quotes, ...r }) => ({
      ...r, item_count: _count.rfq_items, seller_count: quotes.length,
      offers: quotes.filter((q) => ["sent", "accepted"].includes(q.status)).length,
      best_total: quotes.filter((q) => q.status === "sent").reduce((m, q) => (m === null || num(q.total_amount) < m ? num(q.total_amount) : m), null),
    })),
  });
};

/**
 * GET /account/rfqs/:id -> the request and every seller's answer, ready to compare:
 * totals, validity, delivery time, and each line. Only sent / accepted quotes show prices.
 */
const getRfq = async (req, res) => {
  await expireQuotes(prisma, { user_id: me(req) });
  const r = await prisma.rfqs.findFirst({
    where: { id: toId(req.params.id), user_id: me(req) },
    include: {
      rfq_items: { orderBy: { sort_order: "asc" }, include: { products: { select: { id: true, title: true, slug: true } } } },
      quotes: {
        include: {
          companies: { select: { id: true, name: true, slug: true, logo_url: true, lead_time_days: true } },
          quote_items: { orderBy: { id: "asc" }, include: { products: { select: { id: true, title: true, slug: true, brand: true } } } },
        },
      },
    },
  });
  if (!r) throw new HttpError(404, "Request not found");
  const priced = (q) => ["sent", "accepted", "expired", "declined"].includes(q.status) && q.version > 0;
  const offers = r.quotes.map((q) => ({
    quote_id: q.id, quote_number: q.quote_number, status: q.status, company: q.companies, version: q.version,
    valid_until: flow.iso(q.valid_until), lead_time_days: q.lead_time_days ?? q.companies.lead_time_days ?? null, notes: priced(q) ? q.notes : null,
    ...(priced(q)
      ? {
          subtotal: num(q.subtotal), discount: num(q.discount_amount), shipping: num(q.shipping_amount), tax: num(q.tax_amount), total: num(q.total_amount),
          lines: q.quote_items.map((i) => ({ title: inv.label(i.products?.title || "Item", i.flavor), brand: i.products?.brand, product_slug: i.products?.slug, quantity: i.quantity, unit_price: num(i.unit_price), line_total: num(i.line_total) })),
          units: q.quote_items.reduce((s, i) => s + i.quantity, 0),
        }
      : {}),
    can_accept: q.status === "sent",
  }));
  // cheapest first among priced offers; then the ones still waiting
  offers.sort((a, b) => (a.total === undefined) - (b.total === undefined) || (a.total ?? 0) - (b.total ?? 0));
  const best = offers.find((o) => o.status === "sent");
  const requested = r.rfq_items.reduce((s, i) => s + i.quantity, 0);
  res.json({
    data: {
      id: r.id, rfq_number: r.rfq_number, title: r.title, notes: r.notes, needed_by: flow.iso(r.needed_by), status: r.status, awarded_quote_id: r.awarded_quote_id, created_at: r.created_at,
      items: r.rfq_items.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, product: i.products })),
      requested_units: requested,
      offers: offers.map((o) => ({ ...o, best: best && o.quote_id === best.quote_id, covers_all: o.units !== undefined ? o.units >= requested : undefined })),
    },
  });
};

// POST /account/rfqs/:id/award { quote_id, shipping_address_id, billing_address_id?, payment_method? } -> accepts that offer
const awardRfq = async (req, res) => {
  const r = await prisma.rfqs.findFirst({ where: { id: toId(req.params.id), user_id: me(req) } });
  if (!r) throw new HttpError(404, "Request not found");
  if (r.status !== "open") throw new HttpError(400, `This request is ${r.status}`);
  const quoteId = toId(req.body.quote_id, "quote_id");
  const q = await prisma.quotes.findFirst({ where: { id: quoteId, rfq_id: r.id } });
  if (!q) throw new HttpError(400, "That offer isn't part of this request");
  await expireQuotes(prisma, { user_id: me(req), id: quoteId });
  const { order, quote, company } = await prisma.$transaction((tx) => acceptQuote(tx, { quoteId, userId: req.user.id, body: req.body }), TX);
  await flow.closeRfq(r.id, quote.id);
  const user = await prisma.users.findUnique({ where: { id: me(req) } });
  await queueEmail({
    to: user.email, template: "notice",
    data: { type: "rfq.awarded", title: `Order ${order.order_number} placed with ${company.name}`, lines: [`You accepted ${company.name}'s offer for "${r.title}". The other sellers were told.`], link: "/account?tab=orders", linkLabel: "View the order" },
  });
  await notifyCompany(company.id, "orders.view", {
    template: "quoteResponse",
    data: { companyName: company.name, quoteNumber: quote.quote_number, customer: customerName(user), accepted: true, orderNumber: order.order_number },
  });
  res.status(201).json({ message: `${company.name}'s offer accepted. Order ${order.order_number} placed 📦`, order: { id: order.id, orderNumber: order.order_number } });
};

// POST /account/rfqs/:id/cancel -> withdraws the request (open quotes are cancelled)
const cancelRfq = async (req, res) => {
  const r = await prisma.rfqs.findFirst({ where: { id: toId(req.params.id), user_id: me(req) } });
  if (!r) throw new HttpError(404, "Request not found");
  if (r.status !== "open") throw new HttpError(400, `This request is ${r.status}`);
  const open = await prisma.quotes.findMany({ where: { rfq_id: r.id, status: { in: ["requested", "draft", "sent", "countered"] } }, select: { id: true, company_id: true, quote_number: true } });
  await prisma.$transaction([
    prisma.quotes.updateMany({ where: { id: { in: open.map((q) => q.id) } }, data: { status: "cancelled", updated_at: new Date() } }),
    prisma.rfqs.update({ where: { id: r.id }, data: { status: "cancelled", updated_at: new Date() } }),
  ]);
  for (const q of open) await require("../services/inapp").notifyStaff(q.company_id, "quotes.manage", { type: "quote.withdrawn", title: `Request withdrawn: ${q.quote_number}`, body: r.title, link: "/business/quotes" });
  res.json({ message: "Request withdrawn" });
};

module.exports = { createRfq, listRfqs, getRfq, awardRfq, cancelRfq };
