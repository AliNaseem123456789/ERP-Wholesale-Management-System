// Creates one customer order (used by checkout and by accepting a quote). Runs inside a transaction.
const orderNumberFor = (id) => `ORD-${String(id).padStart(6, "0")}`;

/**
 * o = { userId, companyId, checkoutGroup, shippingId, billingId, businessName,
 *       items: [{ product_id, flavor?, quantity, unit_price, list_price }],
 *       subtotal, discount, tax, shipping, total, paymentMethod, termsDays, promoCode, quoteId, notes }
 */
const createOrderRecord = async (tx, o) => {
  const order = await tx.orders.create({
    data: {
      user_id: BigInt(o.userId),
      company_id: BigInt(o.companyId),
      checkout_group: o.checkoutGroup || null,
      shipping_address_id: o.shippingId,
      billing_address_id: o.billingId,
      business_name: o.businessName || null,
      subtotal_amount: o.subtotal,
      discount_amount: o.discount || 0,
      tax_amount: o.tax || 0,
      shipping_amount: o.shipping || 0,
      excise_amount: o.excise || 0,
      compliance: o.compliance ? JSON.parse(JSON.stringify(o.compliance)) : undefined,
      total_amount: o.total,
      payment_method: o.paymentMethod,
      payment_terms_days: o.paymentMethod === "on_account" ? o.termsDays : null,
      promo_code: o.promoCode || null,
      quote_id: o.quoteId ? BigInt(o.quoteId) : null,
      notes: o.notes || null,
      status: "pending",
      updated_at: new Date(),
      order_items: {
        create: o.items.map((item) => ({
          product_id: BigInt(item.product_id),
          flavor: item.flavor || null,
          quantity: item.quantity,
          price_at_time: item.unit_price,
          list_price: item.list_price ?? item.unit_price,
        })),
      },
    },
  });
  const withNumber = await tx.orders.update({ where: { id: order.id }, data: { order_number: orderNumberFor(order.id) } });

  await tx.payment_history.create({
    data: {
      order_id: order.id,
      user_id: BigInt(o.userId),
      company_id: BigInt(o.companyId),
      amount: o.total,
      payment_method: o.paymentMethod,
      status: "pending",
    },
  });

  // The buyer now has an account with this seller.
  await tx.company_customers.upsert({
    where: { company_id_user_id: { company_id: BigInt(o.companyId), user_id: BigInt(o.userId) } },
    create: { company_id: BigInt(o.companyId), user_id: BigInt(o.userId) },
    update: {},
  });
  return withNumber;
};

module.exports = { createOrderRecord, orderNumberFor };
