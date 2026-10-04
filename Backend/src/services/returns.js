// Returns (RMA): shared by the customer side (request) and the company side (staff-created returns).
const { HttpError, toId } = require("../utils/http");
const { round2, num } = require("./money");
const { nextNumber } = require("./sequences");
const { getSalesSettings } = require("./salesSettings");

const REASONS = {
  damaged: "Damaged",
  wrong_item: "Wrong item sent",
  expired: "Expired or short-dated",
  not_as_described: "Not as described",
  no_longer_needed: "No longer needed",
  other: "Other",
};
const CONDITIONS = ["resellable", "damaged", "expired"];
// Returns that still "hold" quantity (a rejected/cancelled one frees it again).
const ACTIVE = ["requested", "approved", "received", "closed"];

// How many of each order line can still be returned.
const returnableFor = async (tx, order) => {
  const used = await tx.return_items.groupBy({
    by: ["order_item_id"],
    where: { return_requests: { order_id: order.id, status: { in: ACTIVE } } },
    _sum: { quantity: true },
  });
  const usedMap = new Map(used.map((u) => [String(u.order_item_id), u._sum.quantity || 0]));
  return order.order_items.map((i) => ({ ...i, returned: usedMap.get(String(i.id)) || 0, returnable: i.quantity - (usedMap.get(String(i.id)) || 0) }));
};

/**
 * Creates a return for an order. byStaff: skips the return window and starts as "approved".
 * body: { reason, notes, items: [{ order_item_id, quantity }] }
 */
const createReturn = async (tx, { order, company, body, byStaff = false }) => {
  const status = order.status || "pending";
  if (!["shipped", "delivered"].includes(status)) throw new HttpError(400, "Only shipped or delivered orders can be returned");
  if (!byStaff) {
    if (status !== "delivered") throw new HttpError(400, "You can request a return once the order is delivered");
    const { returnWindowDays } = getSalesSettings(company);
    if (!returnWindowDays) throw new HttpError(400, `${company.name} doesn't accept online return requests. Please contact them.`);
    const since = order.shipped_at || order.created_at;
    if (since && Date.now() - new Date(since).getTime() > returnWindowDays * 86400000) {
      throw new HttpError(400, `The ${returnWindowDays}-day return window for this order has passed`);
    }
  }
  const reason = String(body.reason || "");
  if (!REASONS[reason]) throw new HttpError(400, `Reason must be one of: ${Object.keys(REASONS).join(", ")}`);
  if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, "Choose at least one item to return");

  const lines = await returnableFor(tx, order);
  const items = [];
  for (const it of body.items) {
    const line = lines.find((l) => String(l.id) === String(it.order_item_id));
    if (!line) throw new HttpError(400, "One of the items isn't part of this order");
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty < 0) throw new HttpError(400, "Quantities must be whole numbers");
    if (qty === 0) continue;
    if (qty > line.returnable) throw new HttpError(400, `You can return at most ${line.returnable} of "${line.products?.title || "this item"}"`);
    if (items.some((x) => x.order_item_id === line.id)) throw new HttpError(400, "Each item can only be listed once");
    items.push({ order_item_id: line.id, product_id: line.product_id, quantity: qty });
  }
  if (!items.length) throw new HttpError(400, "Choose at least one item to return");

  return tx.return_requests.create({
    data: {
      company_id: company.id,
      order_id: order.id,
      user_id: order.user_id,
      rma_number: await nextNumber(tx, company.id, "return", "RMA"),
      status: byStaff ? "approved" : "requested",
      approved_at: byStaff ? new Date() : null,
      reason,
      customer_notes: body.notes ? String(body.notes).slice(0, 2000) : null,
      staff_notes: byStaff && body.staff_notes ? String(body.staff_notes).slice(0, 2000) : null,
      warehouse_id: order.warehouse_id || null,
      return_items: { create: items },
    },
    include: { return_items: true },
  });
};

// What a received return is worth: the price paid, less the order's discount share, plus its tax share.
const creditLinesFor = (order, returnItems) => {
  const subtotal = order.subtotal_amount !== null ? num(order.subtotal_amount) : order.order_items.reduce((s, i) => s + num(i.price_at_time) * i.quantity, 0);
  const discount = num(order.discount_amount);
  const net = subtotal - discount;
  const factor = subtotal > 0 ? net / subtotal : 1;
  const taxRate = net > 0 ? num(order.tax_amount) / net : 0;
  const items = [];
  for (const ri of returnItems) {
    if (!ri.quantity_received) continue;
    const line = order.order_items.find((i) => String(i.id) === String(ri.order_item_id));
    if (!line) continue;
    items.push({
      product_id: line.product_id,
      description: `Return: ${line.products?.title || "Item"}${line.flavor ? ` - ${line.flavor}` : ""}${ri.condition && ri.condition !== "resellable" ? ` (${ri.condition})` : ""}`,
      quantity: ri.quantity_received,
      unit_price: round2(num(line.price_at_time) * factor * 10000) / 10000,
    });
  }
  const sub = round2(items.reduce((s, i) => s + i.unit_price * i.quantity, 0));
  return { items, tax: round2(sub * taxRate) };
};

module.exports = { REASONS, CONDITIONS, ACTIVE, returnableFor, createReturn, creditLinesFor, toId };
