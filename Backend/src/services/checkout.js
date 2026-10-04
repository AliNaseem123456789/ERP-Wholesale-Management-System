// Builds the per-seller checkout: customer prices, promo codes, shipping, tax and payment options.
// Used both for the checkout summary (preview) and for placing the order (commit, inside a transaction).
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");
const { round2, num } = require("./money");
const { priceEntries } = require("./pricing");
const { getSalesSettings } = require("./salesSettings");
const { outstandingFor } = require("./receivables");
const compliance = require("./compliance");

const PAYMENT_METHODS = ["cash_on_delivery", "on_account"];

// Checks a promotion for this customer & subtotal. Returns an error message, or null if it can be used.
const promoProblem = async (db, promo, userId, subtotal) => {
  const now = new Date();
  if (!promo.is_active) return "This code is no longer active";
  if (promo.starts_at && promo.starts_at > now) return "This code isn't active yet";
  if (promo.ends_at && promo.ends_at < now) return "This code has expired";
  if (promo.max_uses !== null && promo.uses_count >= promo.max_uses) return "This code has been fully used";
  if (subtotal < num(promo.min_order_amount)) return `Spend at least $${num(promo.min_order_amount).toFixed(2)} with this seller to use this code`;
  if (promo.max_uses_per_customer !== null && userId) {
    const used = await db.promotion_redemptions.count({ where: { promotion_id: promo.id, user_id: BigInt(userId) } });
    if (used >= promo.max_uses_per_customer) return "You've already used this code";
  }
  return null;
};

const promoDiscount = (promo, subtotal) => {
  if (promo.type === "percent") return round2(Math.min(subtotal, subtotal * (num(promo.value) / 100)));
  if (promo.type === "fixed") return round2(Math.min(subtotal, num(promo.value)));
  return 0; // free_shipping
};

// What a customer may use to pay one seller: cash on delivery and/or their account (terms + credit limit).
const paymentOptionsFor = async (db, settings, customer, companyId, userId) => {
  const termsDays = customer?.payment_terms_days || 0;
  const canOnAccount = !!customer && customer.status === "active" && termsDays > 0 && customer.credit_limit !== null;
  let creditAvailable = null;
  if (canOnAccount && userId) {
    creditAvailable = round2(num(customer.credit_limit) - (await outstandingFor(db, companyId, userId)));
  }
  return {
    cash_on_delivery: settings.allowCashOnDelivery !== false,
    on_account: canOnAccount ? { terms_days: termsDays, credit_limit: num(customer.credit_limit), credit_available: creditAvailable } : null,
  };
};

const choosePaymentMethod = (options, requested) =>
  requested && PAYMENT_METHODS.includes(requested)
    ? requested
    : options.cash_on_delivery ? "cash_on_delivery" : options.on_account ? "on_account" : null;

/**
 * items: cart-like rows { product_id, quantity, products: { id, title, price, company_id, company, is_active } }
 * options: { promoCodes: string[], paymentMethods: { [companyId]: method }, shippingState: "TX" | null, db, commit }
 */
const buildCheckout = async (userId, items, { promoCodes = [], paymentMethods = {}, shippingState = null, db = prisma, commit = false } = {}) => {
  const codes = [...new Set(promoCodes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];

  // 1) customer prices
  // Volume tiers count the product's whole quantity across flavours ("mix and match").
  const qtyByProduct = new Map();
  for (const i of items) qtyByProduct.set(String(i.product_id), (qtyByProduct.get(String(i.product_id)) || 0) + Number(i.quantity || 0));
  const priced = await priceEntries(userId, items.map((i) => ({ product: i.products, quantity: qtyByProduct.get(String(i.product_id)) || i.quantity })), db);
  priced.forEach((p, idx) => {
    items[idx].unit_price = p.unit;
    items[idx].list_price = p.list;
    items[idx].line_total = p.unit === null ? null : round2(p.unit * items[idx].quantity);
    if (items[idx].products) {
      items[idx].products.price = p.unit;
      if (p.list !== null && p.list !== p.unit) items[idx].products.list_price = p.list;
      if (p.tiers.length) items[idx].products.price_tiers = p.tiers;
    }
  });

  // 2) group by seller
  const byCompany = new Map();
  for (const item of items) {
    const company = item.products?.company;
    const key = company ? String(company.id) : "none";
    if (!byCompany.has(key)) byCompany.set(key, { company: company || null, items: [] });
    byCompany.get(key).items.push(item);
  }
  const companyIds = [...byCompany.keys()].filter((k) => k !== "none").map((k) => BigInt(k));
  const companies = await db.companies.findMany({ where: { id: { in: companyIds } } });
  const customers = userId
    ? await db.company_customers.findMany({ where: { user_id: BigInt(userId), company_id: { in: companyIds } } })
    : [];
  const promos = codes.length
    ? await db.promotions.findMany({ where: { company_id: { in: companyIds }, code: { in: codes, mode: "insensitive" } } })
    : [];
  const promoErrors = [];
  for (const code of codes) {
    if (!promos.some((p) => p.code.toUpperCase() === code)) promoErrors.push({ code, message: "This code isn't valid for the sellers in your cart" });
  }

  // 3) totals per seller
  const groups = [];
  for (const [key, g] of byCompany) {
    const company = companies.find((c) => String(c.id) === key) || null;
    const settings = getSalesSettings(company);
    const customer = customers.find((c) => String(c.company_id) === key) || null;
    const subtotal = round2(g.items.reduce((s, i) => s + num(i.line_total), 0));

    let promo = promos.find((p) => String(p.company_id) === key) || null;
    let discount = 0;
    let promoInfo = null;
    if (promo) {
      if (commit) {
        // lock the promotion so its usage limit can't be exceeded by parallel checkouts
        const [locked] = await db.$queryRaw`SELECT * FROM promotions WHERE id = ${promo.id} FOR UPDATE`;
        promo = { ...promo, uses_count: locked.uses_count };
      }
      const problem = await promoProblem(db, promo, userId, subtotal);
      if (problem) {
        promoErrors.push({ code: promo.code, message: problem });
        promo = null;
      } else {
        discount = promoDiscount(promo, subtotal);
        promoInfo = { id: promo.id, code: promo.code, type: promo.type, description: promo.description, discount };
      }
    }

    const afterDiscount = round2(subtotal - discount);
    const freeShipping =
      promo?.type === "free_shipping" || (settings.freeShippingOver !== null && afterDiscount >= settings.freeShippingOver);
    const shipping = g.items.length && !freeShipping ? round2(settings.shippingFee) : 0;
    const tax = customer?.tax_exempt ? 0 : round2(afterDiscount * (settings.taxRate / 100));
    // tobacco / vapor excise and state rules (bans, licences) for the destination state
    const comp = company
      ? await compliance.evaluate(db, {
          companyId: company.id, companyName: company.name, userId, state: shippingState,
          lines: g.items.map((i) => ({ product_id: i.product_id, title: i.products?.title, quantity: i.quantity, line_total: num(i.line_total) })),
        })
      : { excise: 0, lines: [], problems: [], flags: [], state: shippingState };
    const excise = comp.excise;
    const total = round2(afterDiscount + shipping + tax + excise);

    const options = await paymentOptionsFor(db, settings, customer, key, userId);
    const method = choosePaymentMethod(options, paymentMethods[key]);

    groups.push({
      company: g.company,
      items: g.items,
      customer,
      settings,
      subtotal,
      discount,
      promo: promoInfo,
      shipping,
      tax,
      tax_rate: customer?.tax_exempt ? 0 : settings.taxRate,
      excise,
      compliance: comp,
      total,
      payment_options: options,
      payment_method: method,
      blocked: customer?.status === "blocked",
    });
  }

  const totals = groups.reduce(
    (t, g) => ({
      subtotal: round2(t.subtotal + g.subtotal),
      discount: round2(t.discount + g.discount),
      shipping: round2(t.shipping + g.shipping),
      tax: round2(t.tax + g.tax),
      excise: round2(t.excise + g.excise),
      total: round2(t.total + g.total),
    }),
    { subtotal: 0, discount: 0, shipping: 0, tax: 0, excise: 0, total: 0 },
  );
  return { groups, ...totals, promoErrors };
};

// Validates a group's chosen payment method before an order is created (inside the transaction).
const assertPaymentAllowed = async (db, group, userId) => {
  const name = group.company?.name || "this seller";
  if (group.blocked) throw new HttpError(403, `Your account with ${name} is on hold. Please contact them.`);
  if (!group.payment_method) throw new HttpError(400, `Choose how to pay ${name}`);
  if (group.payment_method === "cash_on_delivery" && !group.payment_options.cash_on_delivery) {
    throw new HttpError(400, `${name} doesn't accept cash on delivery`);
  }
  if (group.payment_method === "on_account") {
    if (!group.payment_options.on_account) throw new HttpError(400, `You don't have payment terms with ${name}`);
    // Lock the customer account row so two checkouts can't both use the same credit.
    await db.$queryRaw`SELECT id FROM company_customers WHERE id = ${group.customer.id} FOR UPDATE`;
    const outstanding = await outstandingFor(db, group.company.id, userId);
    const available = round2(num(group.customer.credit_limit) - outstanding);
    if (group.total > available) {
      throw new HttpError(409, `This order (${group.total.toFixed(2)}) is over your available credit with ${name} (${Math.max(0, available).toFixed(2)}). Pay an open invoice or choose cash on delivery.`);
    }
  }
};

module.exports = { buildCheckout, assertPaymentAllowed, paymentOptionsFor, choosePaymentMethod, promoProblem, promoDiscount, PAYMENT_METHODS };
