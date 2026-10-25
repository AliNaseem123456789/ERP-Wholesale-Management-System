// Several live carts per user (e.g. one per store). Every user has one default cart ("Main cart").
// Requests pick a cart with ?cart=<id> or body.cart_id; without one the default cart is used.
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");
const inv = require("./inventory");
const { publicWhere, withStock } = require("./catalog");
const { loadRules, lineProblem } = require("./orderRules");

const MAX_CARTS = 20;

/** The user's default cart, created if needed. Lines saved without a cart (older code) are adopted into it. */
const defaultCart = async (userId, db = prisma) => {
  const uid = BigInt(userId);
  let cart = await db.carts.findFirst({ where: { user_id: uid, is_default: true } });
  if (!cart) {
    try {
      cart = await db.carts.create({ data: { user_id: uid, name: "Main cart", is_default: true } });
    } catch {
      cart = await db.carts.findFirst({ where: { user_id: uid, is_default: true } }); // created in parallel
    }
  }
  await db.cart_items.updateMany({ where: { user_id: uid, cart_id: null }, data: { cart_id: cart.id } });
  return cart;
};

/** The cart a request works on (must be the user's own). */
const resolveCart = async (userId, cartId, db = prisma) => {
  if (cartId === undefined || cartId === null || cartId === "" || cartId === "default") return defaultCart(userId, db);
  if (!/^\d+$/.test(String(cartId))) throw new HttpError(400, "Invalid cart");
  const cart = await db.carts.findFirst({ where: { id: BigInt(cartId), user_id: BigInt(userId) } });
  if (!cart) throw new HttpError(404, "Cart not found");
  return cart;
};
const cartIdOf = (req) => req.query.cart ?? req.body?.cart_id;

/**
 * Adds lines to a cart, skipping what can't be bought (hidden, discontinued, needs another variant).
 * Quantities are capped to what's available for sellers that track stock, and rounded to order multiples.
 * lines: [{ product_id, flavor, quantity }]. Returns { added: [...], skipped: [{ title, reason }] }.
 */
const addLines = async (req, cart, lines) => {
  const ids = [...new Set(lines.map((l) => String(l.product_id)))].map((x) => BigInt(x));
  const products = await prisma.products.findMany({ where: { ...publicWhere(req), id: { in: ids } }, select: { id: true, title: true, company_id: true, flavors: true } });
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const rules = await loadRules(ids);
  const stocked = await withStock(req, products.map((p) => ({ ...p })));
  const stockOf = new Map(stocked.map((p) => [String(p.id), p]));
  const existing = await prisma.cart_items.findMany({ where: { cart_id: cart.id, product_id: { in: ids } } });
  const added = [];
  const skipped = [];
  for (const l of lines) {
    const p = byId.get(String(l.product_id));
    if (!p) { skipped.push({ title: l.title || `Product #${l.product_id}`, reason: "no longer available" }); continue; }
    let flavor;
    try { flavor = inv.resolveFlavor(p, l.flavor); } catch { skipped.push({ title: inv.label(p.title, l.flavor), reason: "that option is no longer sold" }); continue; }
    const rule = rules.products.get(String(p.id));
    const step = rule?.order_multiple || 1;
    const inCart = existing.find((e) => String(e.product_id) === String(p.id) && e.flavor === flavor)?.quantity || 0;
    let qty = Math.ceil(Number(l.quantity) / step) * step;
    const s = stockOf.get(String(p.id));
    if (s && s.stock_status !== null) {
      const avail = Math.max(0, (flavor ? s.flavor_stock?.[flavor] : s.available) ?? 0) - inCart;
      if (avail <= 0) {
        // pre-order products can still be added; everything else is skipped
        const pre = await prisma.products.findUnique({ where: { id: p.id }, select: { allow_preorder: true } });
        if (!pre?.allow_preorder) { skipped.push({ title: inv.label(p.title, flavor), reason: "out of stock" }); continue; }
      } else if (qty > avail) {
        qty = Math.floor(avail / step) * step;
        if (qty <= 0) { skipped.push({ title: inv.label(p.title, flavor), reason: "not enough stock" }); continue; }
        skipped.push({ title: inv.label(p.title, flavor), reason: `only ${qty} added (stock)` });
      }
    }
    const msg = lineProblem(rules, p.id, flavor, inCart + qty);
    if (msg) { skipped.push({ title: inv.label(p.title, flavor), reason: msg.replace(/^".*?" /, "") }); continue; }
    await prisma.cart_items.upsert({
      where: { cart_id_product_id_flavor: { cart_id: cart.id, product_id: p.id, flavor } },
      create: { user_id: cart.user_id, cart_id: cart.id, product_id: p.id, flavor, quantity: qty },
      update: { quantity: { increment: qty }, updated_at: new Date() },
    });
    added.push({ product_id: p.id, flavor, quantity: qty, title: inv.label(p.title, flavor) });
  }
  await prisma.carts.update({ where: { id: cart.id }, data: { updated_at: new Date() } });
  return { added, skipped };
};

module.exports = { MAX_CARTS, defaultCart, resolveCart, cartIdOf, addLines };
