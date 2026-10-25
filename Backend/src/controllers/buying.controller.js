// Buyer tools: recurring orders and back-in-stock alerts (/account/...).
const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const inv = require("../services/inventory");
const { publicWhere } = require("../services/catalog");
const rec = require("../services/recurring");
const carts = require("../services/carts");

const me = (req) => BigInt(req.user.id);
const include = {
  recurring_order_items: { orderBy: { id: "asc" }, include: { products: { select: { id: true, title: true, slug: true, status: true, company_id: true, companies: { select: { id: true, name: true } } } } } },
};
const shape = ({ recurring_order_items, ...r }) => ({
  ...r,
  next_run_on: rec.iso(r.next_run_on),
  items: recurring_order_items.map(({ products, ...i }) => ({ ...i, title: inv.label(products.title, i.flavor), product: { id: products.id, slug: products.slug, status: products.status, company: products.companies } })),
});
const findOwn = async (req) => {
  const r = await prisma.recurring_orders.findFirst({ where: { id: toId(req.params.id), user_id: me(req), status: { not: "cancelled" } }, include });
  if (!r) throw new HttpError(404, "Recurring order not found");
  return r;
};

// GET /account/recurring-orders
const listRecurring = async (req, res) => {
  const rows = await prisma.recurring_orders.findMany({ where: { user_id: me(req), status: { not: "cancelled" } }, orderBy: { created_at: "desc" }, include });
  res.json({ data: rows.map(shape) });
};

const getRecurring = async (req, res) => res.json({ data: shape(await findOwn(req)) });

/**
 * POST /account/recurring-orders
 *   { name, frequency, day_of_week | day_of_month, mode, start_on?, shipping_address_id, billing_address_id?, payment_methods?,
 *     items? | from_order_id? | from_cart_id? }
 */
const createRecurring = async (req, res) => {
  let items = req.body.items;
  if (req.body.from_order_id) {
    const o = await prisma.orders.findFirst({ where: { id: toId(req.body.from_order_id), user_id: me(req) }, include: { order_items: true } });
    if (!o) throw new HttpError(404, "Order not found");
    items = o.order_items.filter((i) => i.product_id).map((i) => ({ product_id: i.product_id, flavor: i.flavor || "", quantity: i.quantity }));
  } else if (req.body.from_cart_id) {
    const cart = await carts.resolveCart(req.user.id, req.body.from_cart_id);
    items = (await prisma.cart_items.findMany({ where: { cart_id: cart.id } })).map((i) => ({ product_id: i.product_id, flavor: i.flavor, quantity: i.quantity }));
  }
  const data = await rec.recurringData(req, req.body);
  const lines = await rec.linesData(req, items);
  const r = await prisma.recurring_orders.create({
    data: { ...data, user_id: me(req), recurring_order_items: { create: lines.map((l) => ({ product_id: l.product_id, flavor: l.flavor, quantity: l.quantity })) } },
    include,
  });
  res.status(201).json({ message: `Recurring order created. First run on ${rec.iso(r.next_run_on)}.`, data: shape(r) });
};

// PATCH /account/recurring-orders/:id (same fields; items replaces the lines)
const updateRecurring = async (req, res) => {
  const current = await findOwn(req);
  const data = await rec.recurringData(req, req.body, current);
  const lines = req.body.items !== undefined ? await rec.linesData(req, req.body.items) : null;
  const r = await prisma.$transaction(async (tx) => {
    if (lines) {
      await tx.recurring_order_items.deleteMany({ where: { recurring_order_id: current.id } });
      await tx.recurring_order_items.createMany({ data: lines.map((l) => ({ recurring_order_id: current.id, product_id: l.product_id, flavor: l.flavor, quantity: l.quantity })) });
    }
    return tx.recurring_orders.update({ where: { id: current.id }, data: { ...data, updated_at: new Date() }, include });
  });
  res.json({ message: "Saved", data: shape(r) });
};

// DELETE /account/recurring-orders/:id -> cancelled (kept for order history)
const cancelRecurring = async (req, res) => {
  const r = await findOwn(req);
  await prisma.recurring_orders.update({ where: { id: r.id }, data: { status: "cancelled", updated_at: new Date() } });
  res.json({ message: `"${r.name}" stopped` });
};

// POST /account/recurring-orders/:id/run -> run it once now (the schedule doesn't change)
const runNow = async (req, res) => {
  const r = await findOwn(req);
  const result = await rec.runOne(r);
  await prisma.recurring_orders.update({ where: { id: r.id }, data: { last_run_at: new Date(), last_result: { ...result, ran_on: rec.iso(new Date()), manual: true } } });
  res.json({ message: result.message, data: result });
};

// ---- back-in-stock alerts ------------------------------------------------------------------------

// GET /account/stock-alerts
const listAlerts = async (req, res) => {
  const rows = await prisma.stock_alerts.findMany({
    where: { user_id: me(req) }, orderBy: { created_at: "desc" },
    include: { products: { select: { id: true, title: true, slug: true, companies: { select: { name: true } } } } },
  });
  res.json({ data: rows.map(({ products, ...a }) => ({ ...a, title: inv.label(products.title, a.flavor), product: { id: products.id, slug: products.slug, company: products.companies?.name } })) });
};

// POST /account/stock-alerts { product_id, flavor? }
const createAlert = async (req, res) => {
  const p = await prisma.products.findFirst({ where: { ...publicWhere(req), id: toId(req.body.product_id, "product_id") }, select: { id: true, title: true, flavors: true } });
  if (!p) throw new HttpError(404, "Product not found");
  const flavor = inv.resolveFlavor(p, req.body.flavor);
  await prisma.stock_alerts.upsert({
    where: { user_id_product_id_flavor: { user_id: me(req), product_id: p.id, flavor } },
    create: { user_id: me(req), product_id: p.id, flavor },
    update: { notified_at: null, created_at: new Date() },
  });
  res.status(201).json({ message: `We'll let you know when ${inv.label(p.title, flavor)} is back in stock` });
};

// DELETE /account/stock-alerts/:id
const deleteAlert = async (req, res) => {
  await prisma.stock_alerts.deleteMany({ where: { id: toId(req.params.id), user_id: me(req) } });
  res.json({ message: "Alert removed" });
};

module.exports = { listRecurring, getRecurring, createRecurring, updateRecurring, cancelRecurring, runNow, listAlerts, createAlert, deleteAlert };
