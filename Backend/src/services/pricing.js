// Customer-specific pricing.
// For a customer buying product P (sold by company C) in quantity Q, the unit price is:
//   1. the best volume tier (highest min_quantity <= Q) on the customer's GROUP price list, else
//   2. the best tier on C's DEFAULT price list, else
//   3. the product's base price minus the customer group's discount %.
const prisma = require("../prisma");
const { round2, num } = require("./money");

// Loads, per company, what is needed to price products for one user.
const loadContexts = async (userId, companyIds, db = prisma) => {
  const ids = [...new Set(companyIds.map(String))].filter(Boolean).map((id) => BigInt(id));
  const contexts = new Map();
  if (!ids.length) return contexts;

  const [customers, defaultLists] = await Promise.all([
    userId
      ? db.company_customers.findMany({
          where: { user_id: BigInt(userId), company_id: { in: ids } },
          include: { customer_groups: { include: { price_lists: { select: { id: true, is_active: true } } } } },
        })
      : [],
    db.price_lists.findMany({ where: { company_id: { in: ids }, is_default: true, is_active: true }, select: { id: true, company_id: true } }),
  ]);

  for (const id of ids) {
    const customer = customers.find((c) => c.company_id === id) || null;
    const group = customer?.customer_groups || null;
    const groupList = group?.price_lists?.is_active ? group.price_lists.id : null;
    const defaultList = defaultLists.find((l) => l.company_id === id)?.id || null;
    contexts.set(String(id), {
      customer,
      group,
      listIds: [groupList, defaultList].filter(Boolean),
      discountPercent: num(group?.discount_percent),
      taxExempt: !!customer?.tax_exempt,
    });
  }
  return contexts;
};

const loadListItems = async (listIds, productIds, db = prisma) => {
  if (!listIds.length || !productIds.length) return [];
  return db.price_list_items.findMany({
    where: { price_list_id: { in: listIds }, product_id: { in: productIds.map((id) => BigInt(id)) } },
    orderBy: { min_quantity: "asc" },
  });
};

// Unit price for one product at one quantity. Returns null if the product has no price at all.
const priceOne = (product, quantity, ctx, items) => {
  const base = product.base_price ?? product.price;
  for (const listId of ctx?.listIds || []) {
    const tiers = items.filter((i) => String(i.price_list_id) === String(listId) && String(i.product_id) === String(product.id));
    if (!tiers.length) continue;
    const applicable = tiers.filter((t) => t.min_quantity <= quantity);
    if (applicable.length) {
      const best = applicable.reduce((a, b) => (b.min_quantity > a.min_quantity ? b : a));
      return {
        unit: round2(best.price),
        source: "price_list",
        tiers: tiers.map((t) => ({ min_quantity: t.min_quantity, price: round2(t.price) })),
      };
    }
    // tiers exist but start above this quantity: keep looking, fall back to base
    const rest = priceOne({ ...product, base_price: base }, quantity, { ...ctx, listIds: ctx.listIds.filter((l) => l !== listId) }, items);
    return { ...rest, tiers: tiers.map((t) => ({ min_quantity: t.min_quantity, price: round2(t.price) })) };
  }
  if (base === null || base === undefined) return { unit: null, source: "none", tiers: [] };
  const discount = ctx?.discountPercent || 0;
  return {
    unit: round2(num(base) * (1 - discount / 100)),
    source: discount ? "group_discount" : "base",
    tiers: [],
  };
};

/**
 * Prices a list of products for a user. Each entry: { product, quantity }.
 * product needs: id, price (base), company_id.
 * Returns the same entries with { unit, list, source, tiers } added.
 */
const priceEntries = async (userId, entries, db = prisma) => {
  const companyIds = entries.map((e) => e.product.company_id ?? e.product.company?.id);
  const contexts = await loadContexts(userId, companyIds, db);
  const listIds = [...new Set([...contexts.values()].flatMap((c) => c.listIds.map(String)))].map((id) => BigInt(id));
  const items = await loadListItems(listIds, entries.map((e) => e.product.id), db);
  return entries.map((e) => {
    const ctx = contexts.get(String(e.product.company_id ?? e.product.company?.id));
    const r = priceOne(e.product, e.quantity || 1, ctx, items);
    const list = e.product.price === null || e.product.price === undefined ? null : round2(e.product.price);
    return { ...e, ...r, list, ctx };
  });
};

// Storefront: replace `price` with the logged-in customer's price (quantity 1) and add
// list_price (if different) and price_tiers. Anonymous visitors never see prices.
const applyCustomerPricing = async (req, products) => {
  if (!req.user) return products;
  const list = products.filter((p) => p && p.price !== undefined);
  if (!list.length) return products;
  const priced = await priceEntries(req.user.id, list.map((p) => ({ product: p, quantity: 1 })));
  priced.forEach((r, i) => {
    const p = list[i];
    p.price = r.unit;
    if (r.list !== null && r.unit !== null && r.list !== r.unit) p.list_price = r.list;
    if (r.tiers.length) p.price_tiers = r.tiers;
  });
  return products;
};

module.exports = { loadContexts, priceEntries, applyCustomerPricing, priceOne };
