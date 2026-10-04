const prisma = require("../prisma");
const { companyBrief } = require("./catalog");

const productSelect = {
  id: true,
  title: true,
  brand: true,
  price: true,
  description: true,
  url: true,
  flavors: true,
  categories: true,
  is_active: true,
  company_id: true,
  companies: companyBrief,
};

// Same shape the frontend received before, plus products.company.
const cartItemSelect = {
  id: true,
  quantity: true,
  product_id: true,
  flavor: true,
  products: { select: productSelect },
};

const shapeItem = (item) => {
  if (!item?.products) return item;
  const { companies, ...p } = item.products;
  return { ...item, products: { ...p, company: companies ?? null } };
};

const getCart = async (userId) =>
  (
    await prisma.cart_items.findMany({
      where: { user_id: BigInt(userId) },
      select: cartItemSelect,
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    })
  ).map(shapeItem);

const round = (n) => Math.round(n * 100) / 100;

const cartTotals = (items, shippingFee) => {
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.products?.price ?? 0) * item.quantity,
    0,
  );
  const shipping = items.length ? shippingFee : 0;
  return { subtotal: round(subtotal), shipping: round(shipping), total: round(subtotal + shipping) };
};

// Splits cart items by selling company. Each company ships (and charges shipping) separately.
const groupByCompany = (items, shippingFee) => {
  const groups = new Map();
  for (const item of items) {
    const company = item.products?.company;
    const key = company ? String(company.id) : "none";
    if (!groups.has(key)) groups.set(key, { company: company ?? null, items: [] });
    groups.get(key).items.push(item);
  }
  const list = [...groups.values()].map((g) => ({ ...g, ...cartTotals(g.items, shippingFee) }));
  const totals = list.reduce(
    (t, g) => ({ subtotal: t.subtotal + g.subtotal, shipping: t.shipping + g.shipping, total: t.total + g.total }),
    { subtotal: 0, shipping: 0, total: 0 },
  );
  return { groups: list, subtotal: round(totals.subtotal), shipping: round(totals.shipping), total: round(totals.total) };
};

// Sets each cart line's products.price to this customer's unit price.
// Volume tiers count the product's whole quantity in the cart, across flavours ("mix and match").
// qtyByProduct (optional) overrides those totals, e.g. when pricing a single line.
const priceCartItems = async (userId, items, qtyByProduct = null) => {
  const { priceEntries } = require("./pricing");
  const rows = items.filter((i) => i?.products);
  const totals = qtyByProduct || productQuantities(rows);
  const priced = await priceEntries(userId, rows.map((i) => ({ product: i.products, quantity: totals.get(String(i.product_id)) || i.quantity })));
  priced.forEach((r, idx) => {
    const p = rows[idx].products;
    p.price = r.unit;
    if (r.list !== null && r.unit !== null && r.list !== r.unit) p.list_price = r.list;
    if (r.tiers.length) p.price_tiers = r.tiers;
  });
  return items;
};

const productQuantities = (items) => {
  const m = new Map();
  for (const i of items) m.set(String(i.product_id), (m.get(String(i.product_id)) || 0) + Number(i.quantity || 0));
  return m;
};

module.exports = { productSelect, cartItemSelect, shapeItem, getCart, cartTotals, groupByCompany, priceCartItems, productQuantities };
