// Quotes: building quote lines/totals and turning an accepted quote into an order.
const { HttpError, toId } = require("../utils/http");
const { round2, num } = require("./money");
const { priceEntries } = require("./pricing");
const { getSalesSettings } = require("./salesSettings");
const { paymentOptionsFor, choosePaymentMethod, assertPaymentAllowed } = require("./checkout");
const { createOrderRecord } = require("./orders");
const inv = require("./inventory");
const { today } = require("./invoicing");

// Lazily marks sent quotes past their validity as expired.
const expireQuotes = (db, where) =>
  db.quotes.updateMany({ where: { ...where, status: "sent", valid_until: { lt: today() } }, data: { status: "expired", updated_at: new Date() } });

/**
 * Validates lines and fills in prices. lines: [{ product_id, quantity, unit_price?, description? }]
 * Missing unit prices use the customer's current price (price lists / group discount).
 */
const buildLines = async (db, companyId, userId, lines) => {
  if (!Array.isArray(lines) || !lines.length) throw new HttpError(400, "Add at least one product");
  if (lines.length > 200) throw new HttpError(400, "A quote can have at most 200 lines");
  const ids = lines.map((l, i) => {
    const q = Number(l.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 100000) throw new HttpError(400, `Line ${i + 1}: quantity must be a positive whole number`);
    return toId(l.product_id, `Line ${i + 1} product`);
  });
  const products = await db.products.findMany({
    where: { id: { in: ids }, company_id: BigInt(companyId) },
    select: { id: true, title: true, sku: true, price: true, company_id: true, is_active: true, flavors: true },
  });
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const missing = ids.find((id) => !byId.has(String(id)));
  if (missing) throw new HttpError(400, "One of the products doesn't exist or isn't sold by this company");

  // volume tiers count the product's whole quantity on the quote, across flavours
  const qtyBy = new Map();
  ids.forEach((id, i) => qtyBy.set(String(id), (qtyBy.get(String(id)) || 0) + Number(lines[i].quantity)));
  const priced = await priceEntries(userId, ids.map((id) => ({ product: byId.get(String(id)), quantity: qtyBy.get(String(id)) })), db);
  return lines.map((l, i) => {
    const p = byId.get(String(ids[i]));
    let unit;
    if (l.unit_price === undefined || l.unit_price === null || l.unit_price === "") {
      unit = priced[i].unit;
      if (unit === null) throw new HttpError(400, `"${p.title}" has no price. Enter one.`);
    } else {
      unit = Number(l.unit_price);
      if (!Number.isFinite(unit) || unit < 0) throw new HttpError(400, `Line ${i + 1}: price can't be negative`);
    }
    const quantity = Number(l.quantity);
    return {
      product_id: p.id,
      flavor: inv.resolveFlavor(p, l.flavor),
      description: l.description ? String(l.description).slice(0, 500) : null,
      quantity,
      unit_price: round2(unit * 10000) / 10000,
      line_total: round2(unit * quantity),
      list_price: priced[i].list,
      title: inv.label(p.title, inv.resolveFlavor(p, l.flavor)),
    };
  });
};

const quoteTotals = (company, customer, lines, { discount = 0, shipping = null } = {}) => {
  const settings = getSalesSettings(company);
  const subtotal = round2(lines.reduce((s, l) => s + num(l.line_total), 0));
  const disc = round2(Math.min(subtotal, Math.max(0, Number(discount) || 0)));
  const afterDiscount = round2(subtotal - disc);
  let ship;
  if (shipping === null || shipping === undefined || shipping === "") {
    ship = settings.freeShippingOver !== null && afterDiscount >= settings.freeShippingOver ? 0 : round2(settings.shippingFee);
  } else {
    ship = round2(Number(shipping));
    if (!Number.isFinite(ship) || ship < 0) throw new HttpError(400, "Shipping can't be negative");
  }
  const tax = customer?.tax_exempt ? 0 : round2(afterDiscount * (settings.taxRate / 100));
  return { subtotal, discount_amount: disc, shipping_amount: ship, tax_amount: tax, total_amount: round2(afterDiscount + ship + tax) };
};

/**
 * Customer accepts a sent quote -> one order at the quoted prices.
 * body: { shipping_address_id, billing_address_id?, payment_method?, business_name? }
 */
const acceptQuote = async (tx, { quoteId, userId, body }) => {
  const [row] = await tx.$queryRaw`SELECT id, status, valid_until FROM quotes WHERE id = ${BigInt(quoteId)} AND user_id = ${BigInt(userId)} FOR UPDATE`;
  if (!row) throw new HttpError(404, "Quote not found");
  // (callers run expireQuotes() before the transaction, so an expired quote is already marked)
  if (row.status === "expired" || (row.status === "sent" && row.valid_until && new Date(row.valid_until) < today())) {
    throw new HttpError(400, "This quote has expired. Ask the seller for a new one.");
  }
  if (row.status !== "sent") throw new HttpError(400, `This quote is ${row.status} and can't be accepted`);

  const quote = await tx.quotes.findUnique({
    where: { id: row.id },
    include: { quote_items: { orderBy: { id: "asc" }, include: { products: { select: { id: true, title: true, is_active: true, price: true, company_id: true, flavors: true } } } }, companies: true },
  });
  const company = quote.companies;
  if (company.status !== "active") throw new HttpError(400, `${company.name} isn't taking orders right now`);
  for (const i of quote.quote_items) {
    if (!i.products?.is_active) throw new HttpError(400, `"${i.products?.title || "A product"}" is no longer available. Ask the seller to update the quote.`);
  }

  // addresses
  const shippingId = toId(body.shipping_address_id, "Shipping address");
  const billingId = body.billing_address_id ? toId(body.billing_address_id, "Billing address") : shippingId;
  const addressIds = [...new Set([shippingId, billingId])];
  if ((await tx.addresses.count({ where: { user_id: BigInt(userId), id: { in: addressIds } } })) !== addressIds.length) {
    throw new HttpError(400, "Please choose one of your saved addresses");
  }

  // stock (sellers that track inventory), per flavour
  if (inv.isInventoryTracked(company)) {
    const need = new Map();
    for (const i of quote.quote_items) {
      const k = inv.flavorKey(i.product_id, i.flavor);
      need.set(k, (need.get(k) || 0) + i.quantity);
    }
    const byFlavor = await inv.availabilityByFlavor([...new Set(quote.quote_items.map((i) => String(i.product_id)))]);
    for (const i of quote.quote_items) {
      const a = Math.max(0, byFlavor.get(inv.flavorKey(i.product_id, i.flavor)) ?? 0);
      const name = inv.label(i.products.title, i.flavor);
      if (need.get(inv.flavorKey(i.product_id, i.flavor)) > a) {
        throw new HttpError(409, a > 0 ? `Only ${a} of "${name}" available right now. Ask the seller to update the quote.` : `"${name}" is out of stock right now.`);
      }
    }
  }

  // payment
  const customer = await tx.company_customers.findUnique({ where: { company_id_user_id: { company_id: company.id, user_id: BigInt(userId) } } });
  const settings = getSalesSettings(company);
  const options = await paymentOptionsFor(tx, settings, customer, company.id, userId);
  // state tobacco rules for the delivery address (bans, licences, excise on top of the quoted total)
  const addr = await tx.addresses.findUnique({ where: { id: shippingId }, select: { state: true } });
  const comp = await require("./compliance").evaluate(tx, {
    companyId: company.id, companyName: company.name, userId, state: require("./compliance").normalizeState(addr?.state),
    lines: quote.quote_items.map((i) => ({ product_id: i.product_id, title: i.products.title, quantity: i.quantity, line_total: num(i.line_total) })),
  });
  require("./compliance").assertNoProblems(comp);
  const total = round2(num(quote.total_amount) + comp.excise);
  const group = {
    company: { id: company.id, name: company.name },
    customer,
    blocked: customer?.status === "blocked",
    payment_options: options,
    payment_method: choosePaymentMethod(options, body.payment_method),
    total,
  };
  await assertPaymentAllowed(tx, group, userId);

  const order = await createOrderRecord(tx, {
    userId,
    companyId: company.id,
    shippingId,
    billingId,
    businessName: body.business_name,
    items: quote.quote_items.map((i) => ({ product_id: i.product_id, flavor: i.flavor || null, quantity: i.quantity, unit_price: num(i.unit_price), list_price: i.products.price ?? num(i.unit_price) })),
    subtotal: num(quote.subtotal),
    discount: num(quote.discount_amount),
    tax: num(quote.tax_amount),
    shipping: num(quote.shipping_amount),
    excise: comp.excise,
    compliance: { state: comp.state, lines: comp.lines, flags: comp.flags },
    total,
    paymentMethod: group.payment_method,
    termsDays: options.on_account?.terms_days ?? null,
    quoteId: quote.id,
    notes: `From quote ${quote.quote_number}`,
  });
  await tx.quotes.update({ where: { id: quote.id }, data: { status: "accepted", accepted_at: new Date(), order_id: order.id, updated_at: new Date() } });
  return { order, quote, company };
};

module.exports = { expireQuotes, buildLines, quoteTotals, acceptQuote };
