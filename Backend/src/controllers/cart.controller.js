// Live carts (several per user), cart lines, saved carts (templates, shareable with sub-accounts) and "buy again".
// Every line endpoint works on ?cart=<id> (or body.cart_id); without it the user's default cart is used.
const prisma = require("../prisma");
const { HttpError, toId, toPositiveInt } = require("../utils/http");
const { cartItemSelect, getCart, shapeItem, priceCartItems } = require("../services/cart");
const { priceEntries } = require("../services/pricing");
const { publicWhere, withStock, withMainImage } = require("../services/catalog");
const inv = require("../services/inventory");
const { loadRules, lineProblem, linesProblems } = require("../services/orderRules");
const carts = require("../services/carts");

// The product's total quantity in this cart (all variants), for volume pricing of one line.
const productTotal = async (cartId, productId) => {
  const agg = await prisma.cart_items.aggregate({ where: { cart_id: cartId, product_id: productId }, _sum: { quantity: true } });
  return new Map([[String(productId), agg._sum.quantity || 0]]);
};

// GET /cart?cart= -> cart lines. Each line also gets `problem` (e.g. below the minimum order) when it can't be checked out as is.
const fetchCartProducts = async (req, res) => {
  const cart = await carts.resolveCart(req.user.id, carts.cartIdOf(req));
  const items = await getCart(req.user.id, cart.id);
  await withStock(req, items.map((i) => i.products).filter(Boolean));
  await withMainImage(items.map((i) => i.products).filter(Boolean));
  await priceCartItems(req.user.id, items);
  const rules = await loadRules(items.map((i) => i.product_id));
  const problems = linesProblems(rules, items.map((i) => ({ product_id: i.product_id, flavor: i.flavor, quantity: i.quantity })));
  for (const i of items) {
    const rule = rules.products.get(String(i.product_id));
    if (i.products && rule) {
      i.products.min_order_qty = rule.min_order_qty;
      i.products.order_multiple = rule.order_multiple;
    }
    i.cart_id = cart.id;
    const pr = problems.find((x) => String(x.product_id) === String(i.product_id) && (!x.flavor || x.flavor === i.flavor));
    if (pr) i.problem = pr.message;
  }
  res.status(200).json(items);
};

// Only published products of active companies, visible to this customer, can be bought.
const assertProductExists = async (req, productId) => {
  const exists = await prisma.products.findFirst({
    where: { ...publicWhere(req), id: productId },
    select: { id: true, title: true, company_id: true, flavors: true, allow_preorder: true },
  });
  if (!exists) throw new HttpError(404, "Product not found or no longer available");
  return exists;
};

// Variant still on sale, quantity a multiple of the pack size.
const assertLineRules = async (productId, flavor, quantity) => {
  const msg = lineProblem(await loadRules([productId]), productId, flavor, quantity);
  if (msg) throw new HttpError(400, msg);
};

/**
 * What one line may hold for sellers that track inventory: available now, plus stock already ordered from
 * suppliers when the product takes pre-orders. Returns null when the seller doesn't track stock.
 */
const lineLimit = async (req, product, flavor) => {
  const [p] = await withStock({ user: req.user }, [{ ...product }]);
  if (p.stock_status === null) return null;
  const available = Math.max(0, (flavor ? p.flavor_stock?.[flavor] : p.available) ?? 0);
  const incoming = p.allow_preorder ? p.incoming_stock?.[flavor || ""] || 0 : 0;
  return { available, incoming, total: available + incoming };
};

const assertStock = async (req, product, flavor, wantedTotal) => {
  const lim = await lineLimit(req, product, flavor);
  if (!lim) return;
  const name = inv.label(product.title, flavor);
  if (lim.total <= 0) throw new HttpError(409, `"${name}" is out of stock`);
  if (wantedTotal > lim.total) throw new HttpError(409, lim.incoming ? `Only ${lim.total} of "${name}" can be ordered (${lim.available} in stock, ${lim.incoming} arriving)` : `Only ${lim.total} of "${name}" available`);
};

const lineKey = (cartId, productId, flavor) => ({ cart_id_product_id_flavor: { cart_id: cartId, product_id: productId, flavor } });

// POST /cart/add  { productId, quantity, flavor?, cart_id? } -> adds quantity to what's already in the cart
const addToCart = async (req, res) => {
  const cart = await carts.resolveCart(req.user.id, carts.cartIdOf(req));
  const productId = toId(req.body.productId, "productId");
  const quantity = toPositiveInt(req.body.quantity, "quantity", 1);
  const product = await assertProductExists(req, productId);
  const flavor = inv.resolveFlavor(product, req.body.flavor);
  const inCart = await prisma.cart_items.findUnique({ where: lineKey(cart.id, productId, flavor), select: { quantity: true } });
  await assertLineRules(productId, flavor, (inCart?.quantity || 0) + quantity);
  await assertStock(req, product, flavor, (inCart?.quantity || 0) + quantity);

  const item = await prisma.cart_items.upsert({
    where: lineKey(cart.id, productId, flavor),
    create: { user_id: cart.user_id, cart_id: cart.id, product_id: productId, flavor, quantity },
    update: { quantity: { increment: quantity }, updated_at: new Date() },
    select: cartItemSelect,
  });
  const [priced] = await priceCartItems(req.user.id, [shapeItem(item)], await productTotal(cart.id, productId));
  res.status(201).json({ ...priced, cart_id: cart.id });
};

// PATCH /cart/:productId  { quantity, flavor?, cart_id? } -> sets an exact quantity
const updateQuantity = async (req, res) => {
  const cart = await carts.resolveCart(req.user.id, carts.cartIdOf(req));
  const productId = toId(req.params.productId, "productId");
  const quantity = toPositiveInt(req.body.quantity);
  const flavor = inv.normFlavor(req.body.flavor ?? req.query.flavor);
  const product = await prisma.products.findUnique({ where: { id: productId }, select: { id: true, title: true, company_id: true, flavors: true, allow_preorder: true } });
  if (product) {
    await assertLineRules(productId, flavor, quantity);
    await assertStock(req, product, flavor, quantity);
  }
  const line = await prisma.cart_items.findUnique({ where: lineKey(cart.id, productId, flavor) });
  if (!line) throw new HttpError(404, "That item isn't in this cart");
  const item = await prisma.cart_items.update({ where: { id: line.id }, data: { quantity, updated_at: new Date() }, select: cartItemSelect });
  const [priced] = await priceCartItems(req.user.id, [shapeItem(item)], await productTotal(cart.id, productId));
  res.status(200).json({ ...priced, cart_id: cart.id });
};

// DELETE /cart/:productId?flavor=&cart=  (no flavor param = every line of the product)
const removeFromCart = async (req, res) => {
  const cart = await carts.resolveCart(req.user.id, carts.cartIdOf(req));
  const flavor = req.query.flavor;
  await prisma.cart_items.deleteMany({
    where: { cart_id: cart.id, product_id: toId(req.params.productId, "productId"), ...(flavor !== undefined ? { flavor: inv.normFlavor(flavor) } : {}) },
  });
  res.status(204).send();
};

// ---- carts --------------------------------------------------------------------------------------

// GET /cart/carts -> the user's carts with line counts
const listCarts = async (req, res) => {
  await carts.defaultCart(req.user.id);
  const rows = await prisma.carts.findMany({
    where: { user_id: BigInt(req.user.id) },
    orderBy: [{ is_default: "desc" }, { name: "asc" }],
    include: { _count: { select: { cart_items: true } } },
  });
  const qty = await prisma.cart_items.groupBy({ by: ["cart_id"], where: { user_id: BigInt(req.user.id) }, _sum: { quantity: true } });
  res.json({ data: rows.map(({ _count, ...c }) => ({ ...c, line_count: _count.cart_items, item_count: qty.find((q) => q.cart_id === c.id)?._sum.quantity || 0 })) });
};

const cartFields = async (req, body) => {
  const d = {};
  if (body.name !== undefined) {
    d.name = String(body.name || "").trim().slice(0, 120);
    if (!d.name) throw new HttpError(400, "Give the cart a name");
  }
  if (body.notes !== undefined) d.notes = body.notes ? String(body.notes).slice(0, 500) : null;
  if (body.address_id !== undefined) {
    if (!body.address_id) d.address_id = null;
    else {
      const a = await prisma.addresses.findFirst({ where: { id: toId(body.address_id, "address_id"), user_id: BigInt(req.user.id) } });
      if (!a) throw new HttpError(400, "Choose one of your saved addresses");
      d.address_id = a.id;
    }
  }
  return d;
};

// POST /cart/carts { name, address_id?, notes? }
const createCart = async (req, res) => {
  await carts.defaultCart(req.user.id);
  if ((await prisma.carts.count({ where: { user_id: BigInt(req.user.id) } })) >= carts.MAX_CARTS) throw new HttpError(400, `You can have up to ${carts.MAX_CARTS} carts`);
  const d = await cartFields(req, { name: "New cart", ...req.body });
  const cart = await prisma.carts.create({ data: { ...d, user_id: BigInt(req.user.id) } });
  res.status(201).json({ data: cart, message: `Cart "${cart.name}" created` });
};

// PATCH /cart/carts/:id { name?, address_id?, notes?, is_default? }
const updateCart = async (req, res) => {
  const cart = await carts.resolveCart(req.user.id, req.params.id);
  const d = await cartFields(req, req.body);
  const updated = await prisma.$transaction(async (tx) => {
    if (req.body.is_default === true && !cart.is_default) {
      await tx.carts.updateMany({ where: { user_id: cart.user_id, is_default: true }, data: { is_default: false } });
      d.is_default = true;
    }
    return tx.carts.update({ where: { id: cart.id }, data: { ...d, updated_at: new Date() } });
  });
  res.json({ data: updated, message: "Cart saved" });
};

// DELETE /cart/carts/:id -> deletes the cart and its lines (the default cart can only be emptied)
const deleteCart = async (req, res) => {
  const cart = await carts.resolveCart(req.user.id, req.params.id);
  if (cart.is_default) {
    await prisma.cart_items.deleteMany({ where: { cart_id: cart.id } });
    return res.json({ message: "Your main cart was emptied (it can't be deleted)" });
  }
  await prisma.carts.delete({ where: { id: cart.id } });
  res.json({ message: `Cart "${cart.name}" deleted` });
};

// POST /cart/carts/:id/move { to_cart_id, product_id?, flavor? } -> moves one line (or all lines) to another cart
const moveLines = async (req, res) => {
  const from = await carts.resolveCart(req.user.id, req.params.id);
  const to = await carts.resolveCart(req.user.id, req.body.to_cart_id);
  if (from.id === to.id) throw new HttpError(400, "Choose a different cart");
  const lines = await prisma.cart_items.findMany({
    where: { cart_id: from.id, ...(req.body.product_id ? { product_id: toId(req.body.product_id, "product_id") } : {}), ...(req.body.flavor !== undefined ? { flavor: inv.normFlavor(req.body.flavor) } : {}) },
  });
  await prisma.$transaction(async (tx) => {
    for (const l of lines) {
      await tx.cart_items.upsert({
        where: lineKey(to.id, l.product_id, l.flavor),
        create: { user_id: to.user_id, cart_id: to.id, product_id: l.product_id, flavor: l.flavor, quantity: l.quantity },
        update: { quantity: { increment: l.quantity }, updated_at: new Date() },
      });
      await tx.cart_items.delete({ where: { id: l.id } });
    }
  });
  res.json({ message: `${lines.length} line(s) moved to "${to.name}"` });
};

// ---- buy again ----------------------------------------------------------------------------------

// POST /cart/reorder/:orderId { cart_id? } -> adds a past order's lines to a cart (what can still be bought)
const reorder = async (req, res) => {
  const order = await prisma.orders.findFirst({
    where: { id: toId(req.params.orderId), user_id: BigInt(req.user.id) },
    include: { order_items: { include: { products: { select: { title: true } } } } },
  });
  if (!order) throw new HttpError(404, "Order not found");
  const cart = await carts.resolveCart(req.user.id, carts.cartIdOf(req));
  const lines = order.order_items.filter((i) => i.product_id).map((i) => ({ product_id: i.product_id, flavor: i.flavor || "", quantity: i.quantity, title: i.products?.title }));
  const r = await carts.addLines(req, cart, lines);
  res.json({
    message: r.added.length ? `${r.added.length} item(s) from ${order.order_number} added to "${cart.name}"${r.skipped.length ? `; ${r.skipped.length} need attention` : ""}` : "Nothing could be added: these items aren't available right now",
    cart_id: cart.id, ...r,
  });
};

// ---- saved cart templates ---------------------------------------------------

const parseItems = (items) => {
  const list = typeof items === "string" ? JSON.parse(items) : items;
  return Array.isArray(list) ? list : [];
};

// The people whose shared saved carts this user can use: their account owner, or their sub-accounts.
const teamUserIds = async (userId) => {
  const uid = BigInt(userId);
  const [asSub, subs] = await Promise.all([
    prisma.sub_accounts.findUnique({ where: { user_id: uid }, select: { parent_id: true } }),
    prisma.sub_accounts.findMany({ where: { parent_id: uid }, select: { user_id: true } }),
  ]);
  const ids = subs.map((s) => s.user_id);
  if (asSub) {
    ids.push(asSub.parent_id);
    const siblings = await prisma.sub_accounts.findMany({ where: { parent_id: asSub.parent_id, NOT: { user_id: uid } }, select: { user_id: true } });
    ids.push(...siblings.map((s) => s.user_id));
  }
  return ids;
};

const findOwnTemplate = async (req) => {
  const template = await prisma.saved_carts.findFirst({ where: { id: toId(req.params.id), user_id: BigInt(req.user.id) } });
  if (!template) throw new HttpError(404, "Template not found");
  return template;
};
// Own templates, or ones a team member shared.
const findVisibleTemplate = async (req) => {
  const team = await teamUserIds(req.user.id);
  const template = await prisma.saved_carts.findFirst({
    where: { id: toId(req.params.id), OR: [{ user_id: BigInt(req.user.id) }, { user_id: { in: team }, shared_with_team: true }] },
  });
  if (!template) throw new HttpError(404, "Template not found");
  return template;
};

// POST /cart/save-cart-template { cartName, items, shared_with_team? }
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
  const entries = items.filter((i) => byId.has(i.product_id)).map((i) => ({ product: byId.get(i.product_id), flavor: i.flavor || "", quantity: i.quantity }));
  const priced = await priceEntries(req.user.id, entries);
  const totalAmount = priced.reduce((s, r) => s + Number(r.unit ?? 0) * r.quantity, 0);

  const savedCart = await prisma.saved_carts.create({
    data: {
      user_id: BigInt(req.user.id),
      cart_name: cartName.slice(0, 255),
      items,
      total_amount: Math.round(totalAmount * 100) / 100,
      shared_with_team: !!req.body.shared_with_team,
    },
  });
  res.status(201).json({ message: "Saved!", savedCart });
};

// GET /cart/saved-cart-templates -> own templates + ones team members shared
const fetchSavedTemplates = async (req, res) => {
  const team = await teamUserIds(req.user.id);
  const data = await prisma.saved_carts.findMany({
    where: { OR: [{ user_id: BigInt(req.user.id) }, ...(team.length ? [{ user_id: { in: team }, shared_with_team: true }] : [])] },
    orderBy: { created_at: "desc" },
    include: { users: { select: { id: true, email: true, first_name: true, last_name: true } } },
  });
  res.status(200).json({
    data: data.map(({ users, ...t }) => ({ ...t, own: String(t.user_id) === String(req.user.id), owner: users ? { id: users.id, name: [users.first_name, users.last_name].filter(Boolean).join(" ") || users.email } : null })),
  });
};

const fetchSavedTemplateDetails = async (req, res) => {
  const template = await findVisibleTemplate(req);
  const items = parseItems(template.items);

  const products = await prisma.products.findMany({
    where: { id: { in: items.map((i) => BigInt(i.product_id)) } },
    select: { id: true, title: true, brand: true, price: true, company_id: true },
  });
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  const priced = await priceEntries(
    req.user.id,
    items.filter((i) => byId.has(Number(i.product_id))).map((i) => ({ product: byId.get(Number(i.product_id)), flavor: i.flavor || "", quantity: i.quantity })),
  );
  const unitOf = new Map(priced.map((r) => [`${Number(r.product.id)}|${r.flavor}`, r.unit]));

  const detailedItems = items.map((item) => {
    const p = byId.get(Number(item.product_id));
    return {
      product_id: item.product_id,
      flavor: item.flavor || null,
      quantity: item.quantity,
      title: p?.title ?? null,
      brand: p?.brand ?? null,
      price: unitOf.get(`${Number(item.product_id)}|${item.flavor || ""}`) ?? 0,
      available: !!p,
    };
  });

  res.status(200).json({
    data: { ...template, own: String(template.user_id) === String(req.user.id), items: detailedItems, products_details: detailedItems },
  });
};

// PATCH /cart/saved-cart-templates/:id { cart_name?, shared_with_team? }
const updateSavedTemplate = async (req, res) => {
  const t = await findOwnTemplate(req);
  const data = {};
  if (req.body.cart_name !== undefined) {
    data.cart_name = String(req.body.cart_name || "").trim().slice(0, 255);
    if (!data.cart_name) throw new HttpError(400, "Cart name is required");
  }
  if (req.body.shared_with_team !== undefined) data.shared_with_team = !!req.body.shared_with_team;
  res.json({ data: await prisma.saved_carts.update({ where: { id: t.id }, data }), message: "Saved" });
};

const deleteSavedTemplate = async (req, res) => {
  const template = await findOwnTemplate(req);
  await prisma.saved_carts.delete({ where: { id: template.id } });
  res.status(200).json({ message: "Saved cart deleted" });
};

// POST /cart/saved-cart-templates/:id/restore { cart_id? } -> adds what can still be bought to a cart
const restoreSavedTemplate = async (req, res) => {
  const template = await findVisibleTemplate(req);
  const cart = await carts.resolveCart(req.user.id, carts.cartIdOf(req));
  const items = parseItems(template.items);
  const r = await carts.addLines(req, cart, items.map((i) => ({ product_id: i.product_id, flavor: i.flavor || "", quantity: Number(i.quantity) })));
  res.status(200).json({
    message: r.skipped.length ? `Saved cart restored. ${r.skipped.length} line(s) need attention.` : "Saved cart restored",
    added: r.added.length,
    skipped: r.skipped.length,
    skipped_lines: r.skipped,
    cart_id: cart.id,
  });
};

module.exports = {
  fetchCartProducts, addToCart, updateQuantity, removeFromCart,
  listCarts, createCart, updateCart, deleteCart, moveLines, reorder,
  saveCartTemplate, fetchSavedTemplates, fetchSavedTemplateDetails, updateSavedTemplate, deleteSavedTemplate, restoreSavedTemplate,
};
