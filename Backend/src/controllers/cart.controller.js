const prisma = require("../prisma");
const { HttpError, toId, toPositiveInt } = require("../utils/http");
const { cartItemSelect, getCart, shapeItem, priceCartItems } = require("../services/cart");

// The product's total quantity in this user's cart (all flavours), for volume pricing of one line.
const productTotal = async (userId, productId) => {
  const agg = await prisma.cart_items.aggregate({ where: { user_id: userId, product_id: productId }, _sum: { quantity: true } });
  return new Map([[String(productId), agg._sum.quantity || 0]]);
};
const { priceEntries } = require("../services/pricing");
const { publicProductWhere, withStock } = require("../services/catalog");
const inv = require("../services/inventory");

const fetchCartProducts = async (req, res) => {
  const items = await getCart(req.user.id);
  await withStock(req, items.map((i) => i.products).filter(Boolean));
  await priceCartItems(req.user.id, items);
  res.status(200).json(items);
};

// Only active products of active companies can be bought.
const assertProductExists = async (productId) => {
  const exists = await prisma.products.findFirst({
    where: { ...publicProductWhere, id: productId },
    select: { id: true, title: true, company_id: true, flavors: true },
  });
  if (!exists) throw new HttpError(404, "Product not found or no longer available");
  return exists;
};

// For sellers that track inventory, the cart can't hold more than is available (per flavour).
const assertStock = async (req, product, flavor, wantedTotal) => {
  const [p] = await withStock({ user: req.user }, [{ ...product }]);
  if (p.stock_status === null) return;
  const name = inv.label(product.title, flavor);
  const available = flavor ? p.flavor_stock?.[flavor] ?? 0 : p.available ?? 0;
  if (available <= 0) throw new HttpError(409, `"${name}" is out of stock`);
  if (wantedTotal > available) throw new HttpError(409, `Only ${available} of "${name}" available`);
};

const lineKey = (userId, productId, flavor) => ({ user_id_product_id_flavor: { user_id: userId, product_id: productId, flavor } });

// POST /cart/add  { productId, quantity, flavor? } -> adds quantity to what's already in the cart
// Products with flavours need a flavour; each flavour is its own cart line.
const addToCart = async (req, res) => {
  const userId = BigInt(req.user.id);
  const productId = toId(req.body.productId, "productId");
  const quantity = toPositiveInt(req.body.quantity, "quantity", 1);
  const product = await assertProductExists(productId);
  const flavor = inv.resolveFlavor(product, req.body.flavor);
  const inCart = await prisma.cart_items.findUnique({ where: lineKey(userId, productId, flavor), select: { quantity: true } });
  await assertStock(req, product, flavor, (inCart?.quantity || 0) + quantity);

  const item = await prisma.cart_items.upsert({
    where: lineKey(userId, productId, flavor),
    create: { user_id: userId, product_id: productId, flavor, quantity },
    update: { quantity: { increment: quantity }, updated_at: new Date() },
    select: cartItemSelect,
  });
  const [priced] = await priceCartItems(req.user.id, [shapeItem(item)], await productTotal(userId, productId));
  res.status(201).json(priced);
};

// PATCH /cart/:productId  { quantity, flavor? } -> sets an exact quantity
const updateQuantity = async (req, res) => {
  const userId = BigInt(req.user.id);
  const productId = toId(req.params.productId, "productId");
  const quantity = toPositiveInt(req.body.quantity);
  const flavor = inv.normFlavor(req.body.flavor ?? req.query.flavor);
  const product = await prisma.products.findUnique({ where: { id: productId }, select: { id: true, title: true, company_id: true, flavors: true } });
  if (product) await assertStock(req, product, flavor, quantity);

  const item = await prisma.cart_items.update({
    where: lineKey(userId, productId, flavor),
    data: { quantity, updated_at: new Date() },
    select: cartItemSelect,
  });
  const [priced] = await priceCartItems(req.user.id, [shapeItem(item)], await productTotal(userId, productId));
  res.status(200).json(priced);
};

// DELETE /cart/:productId?flavor=  (no flavor param = every line of the product)
const removeFromCart = async (req, res) => {
  const flavor = req.query.flavor;
  await prisma.cart_items.deleteMany({
    where: {
      user_id: BigInt(req.user.id),
      product_id: toId(req.params.productId, "productId"),
      ...(flavor !== undefined ? { flavor: inv.normFlavor(flavor) } : {}),
    },
  });
  res.status(204).send();
};

// ---- saved cart templates ---------------------------------------------------

const parseItems = (items) => {
  const list = typeof items === "string" ? JSON.parse(items) : items;
  return Array.isArray(list) ? list : [];
};

const findOwnTemplate = async (req) => {
  const template = await prisma.saved_carts.findFirst({
    where: { id: toId(req.params.id), user_id: BigInt(req.user.id) },
  });
  if (!template) throw new HttpError(404, "Template not found");
  return template;
};

const saveCartTemplate = async (req, res) => {
  const cartName = String(req.body.cartName || "").trim();
  if (!cartName) throw new HttpError(400, "Cart name is required");

  const items = parseItems(req.body.items)
    .map((i) => ({ product_id: Number(i.product_id), quantity: Number(i.quantity), ...(i.flavor ? { flavor: inv.normFlavor(i.flavor) } : {}) }))
    .filter((i) => Number.isInteger(i.product_id) && Number.isInteger(i.quantity) && i.quantity > 0);
  if (!items.length) throw new HttpError(400, "Cart is empty");

  // Compute the total from current prices instead of trusting the browser.
  const products = await prisma.products.findMany({
    where: { id: { in: items.map((i) => BigInt(i.product_id)) } },
    select: { id: true, price: true, company_id: true },
  });
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  const entries = items.filter((i) => byId.has(i.product_id)).map((i) => ({ product: byId.get(i.product_id), quantity: i.quantity }));
  const priced = await priceEntries(req.user.id, entries);
  const totalAmount = priced.reduce((s, r) => s + Number(r.unit ?? 0) * r.quantity, 0);

  const savedCart = await prisma.saved_carts.create({
    data: {
      user_id: BigInt(req.user.id),
      cart_name: cartName,
      items,
      total_amount: Math.round(totalAmount * 100) / 100,
    },
  });
  res.status(201).json({ message: "Saved!", savedCart });
};

const fetchSavedTemplates = async (req, res) => {
  const data = await prisma.saved_carts.findMany({
    where: { user_id: BigInt(req.user.id) },
    orderBy: { created_at: "desc" },
  });
  res.status(200).json({ data });
};

const fetchSavedTemplateDetails = async (req, res) => {
  const template = await findOwnTemplate(req);
  const items = parseItems(template.items);

  const products = await prisma.products.findMany({
    where: { id: { in: items.map((i) => BigInt(i.product_id)) } },
    select: { id: true, title: true, brand: true, price: true, company_id: true },
  });
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  const priced = await priceEntries(
    req.user.id,
    items.filter((i) => byId.has(Number(i.product_id))).map((i) => ({ product: byId.get(Number(i.product_id)), quantity: i.quantity })),
  );
  const unitOf = new Map(priced.map((r) => [Number(r.product.id), r.unit]));

  const detailedItems = items.map((item) => {
    const p = byId.get(Number(item.product_id));
    return {
      product_id: item.product_id,
      flavor: item.flavor || null,
      quantity: item.quantity,
      title: p?.title ?? null,
      brand: p?.brand ?? null,
      price: unitOf.get(Number(item.product_id)) ?? 0,
      available: !!p,
    };
  });

  res.status(200).json({
    data: { ...template, items: detailedItems, products_details: detailedItems },
  });
};

const deleteSavedTemplate = async (req, res) => {
  const template = await findOwnTemplate(req);
  await prisma.saved_carts.delete({ where: { id: template.id } });
  res.status(200).json({ message: "Saved cart deleted" });
};

// Adds every (still existing) product of a template to the active cart.
const restoreSavedTemplate = async (req, res) => {
  const template = await findOwnTemplate(req);
  const userId = BigInt(req.user.id);
  const items = parseItems(template.items);

  const existing = await prisma.products.findMany({
    where: { ...publicProductWhere, id: { in: items.map((i) => BigInt(i.product_id)) } },
    select: { id: true, title: true, flavors: true },
  });
  const byId = new Map(existing.map((p) => [Number(p.id), p]));
  // Lines whose flavour no longer exists (or that need one) are skipped.
  const toAdd = items
    .filter((i) => byId.has(Number(i.product_id)) && Number(i.quantity) > 0)
    .map((i) => {
      try {
        return { ...i, flavor: inv.resolveFlavor(byId.get(Number(i.product_id)), i.flavor) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  await prisma.$transaction(
    toAdd.map((i) =>
      prisma.cart_items.upsert({
        where: lineKey(userId, BigInt(i.product_id), i.flavor),
        create: { user_id: userId, product_id: BigInt(i.product_id), flavor: i.flavor, quantity: Number(i.quantity) },
        update: { quantity: { increment: Number(i.quantity) }, updated_at: new Date() },
      }),
    ),
  );

  res.status(200).json({
    message: items.length - toAdd.length
      ? `Saved cart restored. ${items.length - toAdd.length} line(s) skipped: no longer available, or a flavour must be chosen.`
      : "Saved cart restored",
    added: toAdd.length,
    skipped: items.length - toAdd.length,
  });
};

module.exports = {
  fetchCartProducts,
  addToCart,
  updateQuantity,
  removeFromCart,
  saveCartTemplate,
  fetchSavedTemplates,
  fetchSavedTemplateDetails,
  deleteSavedTemplate,
  restoreSavedTemplate,
};
