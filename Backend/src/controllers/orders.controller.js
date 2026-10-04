const crypto = require("crypto");
const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const { getCart, shapeItem, cartItemSelect } = require("../services/cart");
const { createOrderRecord } = require("../services/orders");
const { getPermissions, displayName } = require("../services/users");
const { queueEmail } = require("../services/email/outbox");
const { notifyCompany } = require("../services/notify");
const { withStock } = require("../services/catalog");
const { buildCheckout, assertPaymentAllowed } = require("../services/checkout");
const inv = require("../services/inventory");
const compliance = require("../services/compliance");

// Destination state of an address (for state compliance rules).
const stateOf = async (db, userId, addressId) => {
  const a = addressId
    ? await db.addresses.findFirst({ where: { id: BigInt(addressId), user_id: BigInt(userId) }, select: { id: true, state: true } })
    : (await db.addresses.findFirst({ where: { user_id: BigInt(userId), is_default: true }, select: { id: true, state: true } }))
      || (await db.addresses.findFirst({ where: { user_id: BigInt(userId) }, orderBy: { id: "asc" }, select: { id: true, state: true } }));
  return { addressId: a?.id || null, state: compliance.normalizeState(a?.state) };
};

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

// GET /orders/checkout-summary -> server-calculated totals per seller (customer prices, promos, shipping, tax)
const checkoutSummary = async (req, res) => {
  const items = await getCart(req.user.id);
  await withStock(req, items.map((i) => i.products).filter(Boolean));
  const dest = await stateOf(prisma, req.user.id, /^\d+$/.test(String(req.query.address_id || "")) ? req.query.address_id : null);
  const co = await buildCheckout(req.user.id, items, { ...checkoutOptions(req.query), shippingState: dest.state });
  res.json({
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
  });
};

// POST /orders/checkout -> one order per company, all in one transaction.
const checkout = async (req, res) => {
  const userId = BigInt(req.user.id);
  await assertCanOrder(req.user);

  const shippingId = toId(req.body.shipping_address_id, "Shipping address");
  const billingId = req.body.billing_address_id
    ? toId(req.body.billing_address_id, "Billing address")
    : shippingId;

  const addressIds = [...new Set([shippingId, billingId])];
  const ownAddresses = await prisma.addresses.count({ where: { user_id: userId, id: { in: addressIds } } });
  if (ownAddresses !== addressIds.length) {
    throw new HttpError(400, "Please choose one of your saved addresses");
  }

  const checkoutGroup = crypto.randomUUID();
  const { promoCodes, paymentMethods } = checkoutOptions(req.body);

  const created = await prisma.$transaction(async (tx) => {
    const cartItems = (await tx.cart_items.findMany({ where: { user_id: userId }, select: cartItemSelect })).map(shapeItem);
    if (!cartItems.length) throw new HttpError(400, "Cart is empty");

    for (const item of cartItems) {
      const p = item.products;
      if (!p || !p.is_active || !p.company) {
        throw new HttpError(400, `"${p?.title || "A product"}" is no longer available. Please remove it from your cart.`);
      }
      if (p.price == null) {
        throw new HttpError(400, `"${p.title}" has no price yet. Please remove it or contact us.`);
      }
    }
    // Every seller must still be active.
    const companyIds = [...new Set(cartItems.map((i) => i.products.company_id))];
    const activeCompanies = await tx.companies.count({ where: { id: { in: companyIds }, status: "active" } });
    if (activeCompanies !== companyIds.length) {
      throw new HttpError(400, "A seller in your cart is not available right now. Please remove their products.");
    }

    // Products with flavours need one (lines from before flavours were tracked must be re-added).
    for (const item of cartItems) {
      const p = item.products;
      if (inv.hasFlavors(p) && !item.flavor) {
        throw new HttpError(400, `Choose a flavour for "${p.title}": remove it from your cart and add it again with a flavour.`);
      }
    }
    // Sellers that track inventory: don't accept more than is available right now (per flavour).
    // (Stock is reserved when the seller confirms the order.)
    const stocked = await withStock({ user: req.user }, cartItems.map((i) => ({ ...i.products })));
    for (const [idx, p] of stocked.entries()) {
      if (p.stock_status === null) continue;
      const item = cartItems[idx];
      const available = inv.hasFlavors(p) ? p.flavor_stock?.[item.flavor] ?? 0 : p.available ?? 0;
      const name = inv.label(p.title, item.flavor);
      if (item.quantity > available) {
        throw new HttpError(
          409,
          available > 0 ? `Only ${available} of "${name}" available. Please update your cart.` : `"${name}" is out of stock. Please remove it from your cart.`,
        );
      }
    }

    const dest = await stateOf(tx, userId, shippingId);
    const co = await buildCheckout(req.user.id, cartItems, { promoCodes, paymentMethods, shippingState: dest.state, db: tx, commit: true });
    for (const g of co.groups) compliance.assertNoProblems(g.compliance);
    if (co.promoErrors.length) {
      throw new HttpError(400, `Promo code ${co.promoErrors[0].code}: ${co.promoErrors[0].message}`);
    }

    const orders = [];
    for (const group of co.groups) {
      await assertPaymentAllowed(tx, group, req.user.id);
      const onAccount = group.payment_method === "on_account";

      const withNumber = await createOrderRecord(tx, {
        userId,
        companyId: group.company.id,
        checkoutGroup,
        shippingId,
        billingId,
        businessName: req.body.business_name,
        items: group.items,
        subtotal: group.subtotal,
        discount: group.discount,
        tax: group.tax,
        shipping: group.shipping,
        excise: group.excise,
        compliance: { state: group.compliance.state, lines: group.compliance.lines, flags: group.compliance.flags },
        total: group.total,
        paymentMethod: group.payment_method,
        termsDays: onAccount ? group.payment_options.on_account.terms_days : null,
        promoCode: group.promo?.code,
      });
      const order = withNumber;

      if (group.promo) {
        await tx.promotion_redemptions.create({
          data: { promotion_id: group.promo.id, order_id: order.id, user_id: userId, amount: group.discount },
        });
        await tx.promotions.update({ where: { id: group.promo.id }, data: { uses_count: { increment: 1 } } });
      }

      orders.push({ order: withNumber, group });
    }

    await tx.cart_items.deleteMany({ where: { user_id: userId } });
    return orders;
  }, { timeout: 30000, maxWait: 10000 });

  // Emails go out after the transaction committed.
  const customer = await prisma.users.findUnique({ where: { id: userId } });
  const emailItems = (group) =>
    group.items.map((i) => ({ title: inv.label(i.products.title, i.flavor), quantity: i.quantity, price: Number(i.unit_price) }));

  await queueEmail({
    to: customer.email,
    template: "orderConfirmation",
    data: {
      name: displayName(customer),
      orders: created.map(({ order, group }) => ({
        orderNumber: order.order_number,
        companyName: group.company.name,
        items: emailItems(group),
        shipping: group.shipping,
        discount: group.discount,
        tax: group.tax,
        paymentMethod: group.payment_method,
        total: group.total,
      })),
    },
  });
  for (const { order, group } of created) {
    await notifyCompany(group.company.id, "orders.view", {
      template: "newOrderForCompany",
      data: {
        companyName: group.company.name,
        orderNumber: order.order_number,
        customerEmail: customer.email,
        businessName: order.business_name || customer.business_name,
        items: emailItems(group),
        total: group.total,
      },
    });
  }

  res.status(201).json({
    message: created.length > 1 ? `${created.length} orders placed (one per seller) 📦` : "Order placed successfully! 📦",
    orderId: created[0].order.id.toString(),
    orders: created.map(({ order, group }) => ({
      id: order.id,
      orderNumber: order.order_number,
      company: group.company,
      total: group.total,
      payment_method: group.payment_method,
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
