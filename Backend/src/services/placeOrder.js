// Placing orders from a set of lines (a cart, or a recurring order): one order per seller, all in one transaction.
// Checks, in order: still visible & on sale, buying rules (minimums, multiples), stock (with pre-orders),
// prices, state compliance, promo codes, payment terms / credit. Then writes the orders.
const crypto = require("crypto");
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");
const { shapeItem, cartItemSelect, productSelect } = require("./cart");
const { createOrderRecord } = require("./orders");
const { buildCheckout, assertPaymentAllowed } = require("./checkout");
const { withStock, publicWhere } = require("./catalog");
const { loadRules, linesProblems } = require("./orderRules");
const inv = require("./inventory");
const compliance = require("./compliance");
const { queueEmail } = require("./email/outbox");
const { notifyCompany } = require("./notify");
const { displayName } = require("./users");

// Destination state of an address (for state compliance rules).
const stateOf = async (db, userId, addressId) => {
  const a = addressId
    ? await db.addresses.findFirst({ where: { id: BigInt(addressId), user_id: BigInt(userId) }, select: { id: true, state: true } })
    : (await db.addresses.findFirst({ where: { user_id: BigInt(userId), is_default: true }, select: { id: true, state: true } }))
      || (await db.addresses.findFirst({ where: { user_id: BigInt(userId) }, orderBy: { id: "asc" }, select: { id: true, state: true } }));
  return { addressId: a?.id || null, state: compliance.normalizeState(a?.state) };
};

/** Cart-shaped lines for recurring orders and similar: [{ product_id, flavor, quantity }] -> same shape as cart lines. */
const linesToItems = async (db, lines) => {
  const products = await db.products.findMany({ where: { id: { in: [...new Set(lines.map((l) => BigInt(l.product_id)))] } }, select: productSelect });
  const byId = new Map(products.map((p) => [String(p.id), p]));
  return lines.map((l, i) => shapeItem({ id: BigInt(-(i + 1)), product_id: BigInt(l.product_id), flavor: l.flavor || "", quantity: Number(l.quantity), products: byId.get(String(l.product_id)) || null }));
};

/**
 * o = { user (req.user-like: { id, role }), loadItems: async (tx) => items, shippingId, billingId, businessName,
 *       promoCodes, paymentMethods, recurringOrderId?, afterCreate?: async (tx) => {} }
 * Returns [{ order, group }].
 */
const placeOrders = async (o) => {
  const userId = BigInt(o.user.id);
  const viewer = { user: o.user };
  const checkoutGroup = crypto.randomUUID();
  return prisma.$transaction(async (tx) => {
    const items = await o.loadItems(tx);
    if (!items.length) throw new HttpError(400, "Cart is empty");

    // Still published, and visible to this customer (group-only products).
    const visible = new Set(
      (await tx.products.findMany({ where: { ...publicWhere(viewer), id: { in: items.map((i) => BigInt(i.product_id)) } }, select: { id: true } })).map((p) => String(p.id)),
    );
    for (const item of items) {
      const p = item.products;
      if (!p || !p.is_active || !p.company || !visible.has(String(item.product_id))) {
        throw new HttpError(400, `"${p?.title || "A product"}" is no longer available. Please remove it from your cart.`);
      }
    }
    const companyIds = [...new Set(items.map((i) => i.products.company_id))];
    const activeCompanies = await tx.companies.count({ where: { id: { in: companyIds }, status: "active" } });
    if (activeCompanies !== companyIds.length) throw new HttpError(400, "A seller in your cart is not available right now. Please remove their products.");

    // Products with variants need one (lines from before variants were tracked must be re-added).
    for (const item of items) {
      if (inv.hasFlavors(item.products) && !item.flavor) {
        throw new HttpError(400, `Choose an option for "${item.products.title}": remove it from your cart and add it again.`);
      }
    }
    // Minimum order quantities, order multiples, variants no longer on sale.
    const problems = linesProblems(await loadRules(items.map((i) => i.product_id), tx), items.map((i) => ({ product_id: i.product_id, flavor: i.flavor, quantity: i.quantity })));
    if (problems.length) throw new HttpError(400, `${problems[0].message}. Please update your cart.`);

    // Stock (sellers that track inventory). Orders not yet confirmed count as taken; parallel checkouts of the same
    // products wait for each other here. Pre-order products may also use stock already ordered from suppliers.
    await inv.lockProductsForSale(tx, items.map((i) => i.product_id));
    const stocked = await withStock(viewer, items.map((i) => ({ ...i.products })));
    const asked = new Map();
    for (const it of items) asked.set(inv.flavorKey(it.product_id, it.flavor), (asked.get(inv.flavorKey(it.product_id, it.flavor)) || 0) + it.quantity);
    for (const [idx, p] of stocked.entries()) {
      const item = items[idx];
      item.preorder_quantity = 0;
      if (p.stock_status === null) continue;
      const available = Math.max(0, (inv.hasFlavors(p) ? p.flavor_stock?.[item.flavor] : p.available) ?? 0);
      const incoming = p.allow_preorder ? p.incoming_stock?.[item.flavor || ""] || 0 : 0;
      const name = inv.label(p.title, item.flavor);
      if (item.quantity > available + incoming) {
        throw new HttpError(409, available + incoming > 0 ? `Only ${available + incoming} of "${name}" available. Please update your cart.` : `"${name}" is out of stock. Please remove it from your cart.`);
      }
      item.preorder_quantity = Math.max(0, item.quantity - available);
    }

    const dest = await stateOf(tx, userId, o.shippingId);
    const co = await buildCheckout(o.user.id, items, { promoCodes: o.promoCodes, paymentMethods: o.paymentMethods, shippingState: dest.state, db: tx, commit: true });
    for (const item of items) {
      if (item.unit_price === null || item.unit_price === undefined) {
        throw new HttpError(400, `"${inv.label(item.products.title, item.flavor)}" has no price yet. Please remove it or contact us.`);
      }
    }
    for (const g of co.groups) compliance.assertNoProblems(g.compliance);
    if (co.promoErrors.length) throw new HttpError(400, `Promo code ${co.promoErrors[0].code}: ${co.promoErrors[0].message}`);

    const created = [];
    for (const group of co.groups) {
      await assertPaymentAllowed(tx, group, o.user.id);
      const onAccount = group.payment_method === "on_account";
      const preorders = group.items.filter((i) => i.preorder_quantity > 0);
      const order = await createOrderRecord(tx, {
        userId, companyId: group.company.id, checkoutGroup, shippingId: o.shippingId, billingId: o.billingId, businessName: o.businessName,
        items: group.items, subtotal: group.subtotal, discount: group.discount, tax: group.tax, shipping: group.shipping, excise: group.excise,
        compliance: { state: group.compliance.state, lines: group.compliance.lines, flags: group.compliance.flags },
        total: group.total, paymentMethod: group.payment_method, termsDays: onAccount ? group.payment_options.on_account.terms_days : null,
        promoCode: group.promo?.code, recurringOrderId: o.recurringOrderId,
        notes: preorders.length ? `Pre-order: ${preorders.map((i) => `${i.preorder_quantity} x ${inv.label(i.products.title, i.flavor)}`).join(", ")} waiting for incoming stock` : null,
      });
      if (group.promo) {
        await tx.promotion_redemptions.create({ data: { promotion_id: group.promo.id, order_id: order.id, user_id: userId, amount: group.discount } });
        await tx.promotions.update({ where: { id: group.promo.id }, data: { uses_count: { increment: 1 } } });
      }
      created.push({ order, group });
    }
    if (o.afterCreate) await o.afterCreate(tx, created);
    return created;
  }, { timeout: 30000, maxWait: 10000 });
};

/** Confirmation email to the buyer and new-order notices to each seller (after the transaction committed). */
const sendOrderEmails = async (userId, created, { recurringName = null } = {}) => {
  const customer = await prisma.users.findUnique({ where: { id: BigInt(userId) } });
  const emailItems = (group) => group.items.map((i) => ({ title: inv.label(i.products.title, i.flavor), quantity: i.quantity, price: Number(i.unit_price) }));
  await queueEmail({
    to: customer.email,
    template: "orderConfirmation",
    data: {
      name: displayName(customer),
      orders: created.map(({ order, group }) => ({
        orderNumber: order.order_number, companyName: group.company.name, items: emailItems(group), shipping: group.shipping,
        discount: group.discount, tax: group.tax, paymentMethod: group.payment_method, total: group.total,
      })),
    },
  });
  for (const { order, group } of created) {
    await notifyCompany(group.company.id, "orders.view", {
      template: "newOrderForCompany",
      data: {
        companyName: group.company.name, orderNumber: order.order_number, customerEmail: customer.email,
        businessName: order.business_name || customer.business_name, items: emailItems(group), total: group.total,
        ...(recurringName ? { note: `Recurring order "${recurringName}"` } : {}),
      },
    });
  }
};

module.exports = { stateOf, linesToItems, placeOrders, sendOrderEmails };
