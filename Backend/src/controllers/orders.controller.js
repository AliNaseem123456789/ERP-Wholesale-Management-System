const crypto = require("crypto");
const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const { getCart, shapeItem, cartItemSelect } = require("../services/cart");
const { createOrderRecord } = require("../services/orders");
const { getPermissions, displayName } = require("../services/users");
const { queueEmail } = require("../services/email/outbox");
const { notifyCompany } = require("../services/notify");
const { withStock } = require("../services/catalog");
const carts = require("../services/carts");
const { placeOrders, sendOrderEmails, stateOf } = require("../services/placeOrder");
const { loadRules, linesProblems } = require("../services/orderRules");
const { buildCheckout, assertPaymentAllowed } = require("../services/checkout");
const inv = require("../services/inventory");
const compliance = require("../services/compliance");

const assertCanOrder = async (reqUser) => {
  if (reqUser.role !== "SUBACCOUNT") return;
  const permissions = await getPermissions(reqUser);
  if (!permissions?.can_place_order) {
    throw new HttpError(403, "Your account owner hasn't enabled ordering for you yet");
  }
};

// Accepts promo codes as ?promo=A,B and payment choices as ?pm_<companyId>=on_account
const checkoutOptions = (src) => {
  const raw = src.promo_codes ?? src.promo ?? src.promo_code ?? [];
  const promoCodes = Array.isArray(raw) ? raw : String(raw).split(",");
  const paymentMethods = { ...(typeof src.payment_methods === "object" && src.payment_methods ? src.payment_methods : {}) };
  for (const [k, v] of Object.entries(src)) if (k.startsWith("pm_")) paymentMethods[k.slice(3)] = v;
  return { promoCodes, paymentMethods };
};

const shapeGroup = (g) => ({
  company: g.company,
  items: g.items,
  subtotal: g.subtotal,
  discount: g.discount,
  promo: g.promo,
  shipping: g.shipping,
  tax: g.tax,
  tax_rate: g.tax_rate,
  excise: g.excise,
  compliance: { state: g.compliance.state, lines: g.compliance.lines, problems: g.compliance.problems, flags: g.compliance.flags },
  total: g.total,
  payment_options: g.payment_options,
  payment_method: g.payment_method,
  blocked: g.blocked,
  free_shipping_over: g.settings.freeShippingOver,
});

// GET /orders/checkout-summary?cart= -> server-calculated totals per seller (customer prices, promos, shipping, tax)
const checkoutSummary = async (req, res) => {
  const cart = await carts.resolveCart(req.user.id, req.query.cart);
  const items = await getCart(req.user.id, cart.id);
  await withStock(req, items.map((i) => i.products).filter(Boolean));
  const dest = await stateOf(prisma, req.user.id, /^\d+$/.test(String(req.query.address_id || "")) ? req.query.address_id : cart.address_id);
  const co = await buildCheckout(req.user.id, items, { ...checkoutOptions(req.query), shippingState: dest.state });
  res.json({
    cart: { id: cart.id, name: cart.name, address_id: cart.address_id },
    shipping_state: dest.state,
    address_id: dest.addressId,
    items,
    groups: co.groups.map(shapeGroup),
    subtotal: co.subtotal,
    discount: co.discount,
    shipping: co.shipping,
    tax: co.tax,
    excise: co.excise,
    total: co.total,
    promoErrors: co.promoErrors,
    problems: linesProblems(await loadRules(items.map((i) => i.product_id)), items.map((i) => ({ product_id: i.product_id, flavor: i.flavor, quantity: i.quantity }))),
  });
};

const assertOwnAddresses = async (userId, shippingId, billingId) => {
  const addressIds = [...new Set([shippingId, billingId])];
  const own = await prisma.addresses.count({ where: { user_id: BigInt(userId), id: { in: addressIds } } });
  if (own !== addressIds.length) throw new HttpError(400, "Please choose one of your saved addresses");
};

// POST /orders/checkout { cart_id?, shipping_address_id, billing_address_id?, promo_codes?, payment_methods? }
// -> one order per company, all in one transaction; the cart is emptied.
const checkout = async (req, res) => {
  await assertCanOrder(req.user);
  const cart = await carts.resolveCart(req.user.id, req.body.cart_id);
  const shippingId = toId(req.body.shipping_address_id, "Shipping address");
  const billingId = req.body.billing_address_id ? toId(req.body.billing_address_id, "Billing address") : shippingId;
  await assertOwnAddresses(req.user.id, shippingId, billingId);
  const { promoCodes, paymentMethods } = checkoutOptions(req.body);

  const created = await placeOrders({
    user: req.user,
    loadItems: async (tx) => (await tx.cart_items.findMany({ where: { cart_id: cart.id }, select: cartItemSelect })).map(shapeItem),
    shippingId, billingId, businessName: req.body.business_name, promoCodes, paymentMethods,
    afterCreate: (tx) => tx.cart_items.deleteMany({ where: { cart_id: cart.id } }),
  });
  await sendOrderEmails(req.user.id, created);

  res.status(201).json({
    message: created.length > 1 ? `${created.length} orders placed (one per seller) 📦` : "Order placed successfully! 📦",
    orderId: created[0].order.id.toString(),
    orders: created.map(({ order, group }) => ({
      id: order.id,
      orderNumber: order.order_number,
      company: group.company,
      total: group.total,
      payment_method: group.payment_method,
      preorder: group.items.some((i) => i.preorder_quantity > 0),
    })),
  });
};

const getUserOrders = async (req, res) => {
  const orders = await prisma.orders.findMany({
    where: { user_id: BigInt(req.user.id) },
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      order_number: true,
      status: true,
      total_amount: true,
      shipping_amount: true,
      subtotal_amount: true,
      discount_amount: true,
      tax_amount: true,
      excise_amount: true,
      payment_method: true,
      promo_code: true,
      tracking_number: true,
      created_at: true,
      business_name: true,
      companies: { select: { id: true, name: true, slug: true } },
      invoices: { where: { status: { not: "void" } }, select: { id: true, invoice_number: true, status: true } },
      addresses_orders_shipping_address_idToaddresses: true,
      addresses_orders_billing_address_idToaddresses: true,
      order_items: {
        select: {
          quantity: true,
          price_at_time: true,
          flavor: true,
          id: true,
          products: { select: { title: true, url: true } },
        },
      },
    },
  });

  const data = orders.map(
    ({
      addresses_orders_shipping_address_idToaddresses: shipping_address,
      addresses_orders_billing_address_idToaddresses: billing_address,
      companies,
      ...o
    }) => ({ ...o, company: companies, shipping_address, billing_address }),
  );
  res.status(200).json({ data });
};

const fetchPaymentHistory = async (req, res) => {
  const data = await prisma.payment_history.findMany({
    where: { user_id: BigInt(req.user.id) },
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      amount: true,
      transaction_id: true,
      payment_method: true,
      status: true,
      created_at: true,
      order_id: true,
      orders: { select: { id: true, status: true, order_number: true } },
      companies: { select: { id: true, name: true } },
    },
  });
  res.status(200).json({
    data: data.map(({ companies, ...p }) => ({ ...p, company: companies })),
  });
};

module.exports = { checkout, checkoutSummary, getUserOrders, fetchPaymentHistory };
