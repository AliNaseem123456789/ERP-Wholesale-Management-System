// A company's incoming orders and fulfilment workflow.
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { queueEmail } = require("../../services/email/outbox");
const { displayName } = require("../../services/users");
const { audit } = require("../../services/audit");
const inv = require("../../services/inventory");
const billing = require("../../services/invoicing");
const gl = require("../../services/postings");
const { getSalesSettings } = require("../../services/salesSettings");
const { emailInvoice } = require("../../services/salesEmails");

// Allowed status changes.
const TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "shipped", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};
// Warehouse staff (orders.fulfil) may move orders through fulfilment; confirming/cancelling needs orders.manage.
const FULFIL_STATUSES = ["processing", "shipped", "delivered"];
const NOTIFY_CUSTOMER = ["confirmed", "shipped", "delivered", "cancelled"];

const orderSelect = {
  id: true, order_number: true, status: true, total_amount: true, shipping_amount: true,
  business_name: true, tracking_number: true, notes: true, created_at: true, updated_at: true, shipped_at: true,
  checkout_group: true, warehouse_id: true,
  subtotal_amount: true, discount_amount: true, tax_amount: true, excise_amount: true, compliance: true, payment_method: true, payment_terms_days: true, promo_code: true, quote_id: true,
  invoices: {
    where: { status: { not: "void" } },
    select: { id: true, invoice_number: true, status: true, total_amount: true, amount_paid: true, amount_credited: true, due_date: true },
  },
  return_requests: { select: { id: true, rma_number: true, status: true, created_at: true }, orderBy: { created_at: "desc" } },
  warehouses: { select: { id: true, name: true, code: true } },
  users: { select: { id: true, email: true, first_name: true, last_name: true, business_name: true, phone: true } },
  addresses_orders_shipping_address_idToaddresses: true,
  addresses_orders_billing_address_idToaddresses: true,
  order_items: {
    select: { id: true, quantity: true, reserved_quantity: true, price_at_time: true, flavor: true, product_id: true, products: { select: { title: true, sku: true, brand: true, barcode: true } } },
  },
  payment_history: { select: { id: true, amount: true, status: true, payment_method: true, created_at: true } },
};

const shape = ({
  users,
  warehouses,
  addresses_orders_shipping_address_idToaddresses: shipping_address,
  addresses_orders_billing_address_idToaddresses: billing_address,
  ...o
}) => ({ ...o, warehouse: warehouses, customer: users, shipping_address, billing_address, allowedTransitions: TRANSITIONS[o.status] || [] });

// GET /company/orders?status&search&page&limit
const listOrders = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const search = String(req.query.search || "").trim();
  const where = {
    company_id: req.company.id,
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    ...(search
      ? { OR: [
          { order_number: { contains: search, mode: "insensitive" } },
          { business_name: { contains: search, mode: "insensitive" } },
          { users: { is: { email: { contains: search, mode: "insensitive" } } } },
        ] }
      : {}),
  };
  const [orders, totalCount] = await Promise.all([
    prisma.orders.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, order_number: true, status: true, total_amount: true, business_name: true, created_at: true,
        users: { select: { email: true } },
        _count: { select: { order_items: true } },
      },
    }),
    prisma.orders.count({ where }),
  ]);
  res.json({
    orders: orders.map(({ users, _count, ...o }) => ({ ...o, customer_email: users?.email, item_count: _count.order_items })),
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
  });
};

const findOwnOrder = async (req) => {
  const order = await prisma.orders.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id }, select: orderSelect });
  if (!order) throw new HttpError(404, "Order not found");
  return order;
};

// GET /company/orders/:id
const getOrder = async (req, res) => {
  res.json({ data: { ...shape(await findOwnOrder(req)), inventoryTracked: inv.isInventoryTracked(req.company) } });
};

// PATCH /company/orders/:id/status { status, tracking_number?, notes? }
const updateOrderStatus = async (req, res) => {
  const order = await findOwnOrder(req);
  const next = String(req.body.status || "");
  const current = order.status || "pending";

  if (!(TRANSITIONS[current] || []).includes(next)) {
    throw new HttpError(400, `An order that is "${current}" can't be changed to "${next}"`);
  }
  const allowed = req.can("orders.manage") || (FULFIL_STATUSES.includes(next) && req.can("orders.fulfil"));
  if (!allowed) throw new HttpError(403, "You don't have permission to do this");

  const data = { status: next, updated_at: new Date() };
  if (req.body.tracking_number !== undefined) data.tracking_number = req.body.tracking_number ? String(req.body.tracking_number).slice(0, 255) : null;
  if (req.body.notes !== undefined) data.notes = req.body.notes ? String(req.body.notes).slice(0, 5000) : null;
  if (next === "shipped") data.shipped_at = new Date();

  const tracked = inv.isInventoryTracked(req.company);
  const touched = [];
  let newInvoiceId = null;

  await prisma.$transaction(async (tx) => {
    // Lock the order so a double-click / two staff can't apply the same change twice.
    const [fresh] = await tx.$queryRaw`SELECT status, warehouse_id FROM orders WHERE id = ${order.id} FOR UPDATE`;
    if ((fresh.status || "pending") !== current) {
      throw new HttpError(409, "This order was just changed by someone else. Please reload it.");
    }

    // Pick the fulfilment warehouse when stock first gets involved.
    let warehouseId = fresh.warehouse_id;
    if (tracked && !warehouseId && ["confirmed", "processing", "shipped"].includes(next)) {
      const wh = req.body.warehouse_id
        ? await inv.assertWarehouse(tx, req.company.id, toId(req.body.warehouse_id, "warehouse_id"))
        : await inv.getDefaultWarehouse(tx, req.company.id);
      warehouseId = wh.id;
      data.warehouse_id = wh.id;
    }

    const items = await tx.order_items.findMany({
      where: { order_id: order.id, product_id: { not: null } },
      include: { products: { select: { title: true, cost_price: true } } },
    });
    let costOfGoods = 0;

    for (const item of items) {
      const flavor = inv.normFlavor(item.flavor);
      const base = { companyId: req.company.id, productId: item.product_id, flavor, productName: item.products?.title };
      if (next === "confirmed" && tracked) {
        const need = item.quantity - item.reserved_quantity;
        if (need > 0) await inv.reserve(tx, { ...base, warehouseId, quantity: need });
        await tx.order_items.update({ where: { id: item.id }, data: { reserved_quantity: item.quantity } });
        touched.push(item.product_id);
      }
      if (next === "shipped") {
        if (tracked) {
          const chunks = await inv.issue(tx, {
            ...base, warehouseId, quantity: item.quantity, type: "sale", reason: "order",
            referenceType: "order", referenceId: order.id, notes: order.order_number,
            userId: req.user.id, releaseReserved: item.reserved_quantity,
          });
          costOfGoods += gl.chunksValue(chunks, item.products?.cost_price);
          touched.push(item.product_id);
        } else if (item.reserved_quantity && fresh.warehouse_id) {
          // Tracking was switched off after this order reserved stock: just free the reservation.
          await inv.release(tx, { warehouseId: fresh.warehouse_id, productId: item.product_id, flavor, quantity: item.reserved_quantity });
        }
        await tx.order_items.update({ where: { id: item.id }, data: { reserved_quantity: 0 } });
      }
      if (next === "cancelled" && item.reserved_quantity && fresh.warehouse_id) {
        await inv.release(tx, { warehouseId: fresh.warehouse_id, productId: item.product_id, flavor, quantity: item.reserved_quantity });
        await tx.order_items.update({ where: { id: item.id }, data: { reserved_quantity: 0 } });
      }
    }

    await tx.orders.update({ where: { id: order.id }, data });
    if (costOfGoods > 0) await gl.postShipment(tx, { companyId: req.company.id, order, value: costOfGoods, userId: req.user.id });

    // Invoice automatically when the goods leave.
    if (next === "shipped" && getSalesSettings(req.company).autoInvoice) {
      const r = await billing.createInvoiceForOrder(tx, { company: req.company, orderId: order.id, userId: req.user.id });
      if (r.created) newInvoiceId = r.invoice.id;
    }
    // Cash on delivery: the payment is collected on delivery (and settles the invoice).
    // On-account orders stay unpaid until their invoice is paid.
    if (next === "delivered" && (order.payment_method || "cash_on_delivery") === "cash_on_delivery") {
      await tx.payment_history.updateMany({ where: { order_id: order.id, status: "pending" }, data: { status: "completed" } });
      const open = await tx.invoices.findFirst({ where: { order_id: order.id, status: { in: ["issued", "partially_paid"] } } });
      const balance = open ? billing.invoiceBalance(open) : 0;
      if (balance > 0) {
        await billing.recordPayment(tx, {
          companyId: req.company.id, invoiceId: open.id, amount: balance, method: "cash_on_delivery",
          reference: order.order_number, userId: req.user.id, notes: "Collected on delivery",
        });
      }
    }
    if (next === "cancelled") {
      await tx.payment_history.updateMany({ where: { order_id: order.id, status: "pending" }, data: { status: "cancelled" } });
      for (const i of await tx.invoices.findMany({ where: { order_id: order.id, status: { not: "void" } } })) {
        await billing.voidInvoice(tx, { companyId: req.company.id, invoiceId: i.id });
      }
    }
  });
  if (newInvoiceId) await emailInvoice(newInvoiceId);
  if (touched.length) await inv.checkLowStock(req.company.id, touched);
  await audit(req, "order.status", { entity: "order", entityId: order.id, changes: { from: current, to: next, ...data } });

  if (NOTIFY_CUSTOMER.includes(next) && order.users?.email) {
    await queueEmail({
      to: order.users.email,
      template: "orderStatus",
      companyId: req.company.id,
      data: {
        name: displayName(order.users),
        orderNumber: order.order_number,
        companyName: req.company.name,
        status: next,
        trackingNumber: data.tracking_number ?? order.tracking_number,
      },
    });
  }

  res.json({ message: `Order ${order.order_number} is now ${next}`, data: shape(await findOwnOrder(req)) });
};

// PATCH /company/orders/:id  { notes?, tracking_number? }
const updateOrderDetails = async (req, res) => {
  const order = await findOwnOrder(req);
  const data = { updated_at: new Date() };
  if (req.body.tracking_number !== undefined) data.tracking_number = req.body.tracking_number ? String(req.body.tracking_number).slice(0, 255) : null;
  if (req.body.notes !== undefined) data.notes = req.body.notes ? String(req.body.notes).slice(0, 5000) : null;
  await prisma.orders.update({ where: { id: order.id }, data });
  await audit(req, "order.update", { entity: "order", entityId: order.id, changes: data });
  res.json({ message: "Order updated", data: shape(await findOwnOrder(req)) });
};

// GET /company/orders/:id/pick-list -> where to pick each line (bins & lots, earliest expiry first)
const pickList = async (req, res) => {
  const order = await findOwnOrder(req);
  const warehouse = order.warehouse_id
    ? await prisma.warehouses.findUnique({ where: { id: order.warehouse_id } })
    : await inv.getDefaultWarehouse(prisma, req.company.id);
  const lines = [];
  for (const item of order.order_items) {
    const lots = item.product_id
      ? await prisma.inventory_lots.findMany({
          where: { warehouse_id: warehouse.id, product_id: item.product_id, flavor: inv.normFlavor(item.flavor), quantity: { gt: 0 } },
          orderBy: [{ expiry_date: { sort: "asc", nulls: "last" } }, { received_at: "asc" }, { id: "asc" }],
          include: { warehouse_bins: { select: { code: true } } },
        })
      : [];
    let remaining = item.quantity;
    const picks = [];
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.quantity);
      picks.push({ bin: lot.warehouse_bins?.code || null, lot_number: lot.lot_number, expiry_date: lot.expiry_date, quantity: take });
      remaining -= take;
    }
    lines.push({
      title: inv.label(item.products?.title, item.flavor), flavor: item.flavor || null, sku: item.products?.sku, barcode: item.products?.barcode,
      quantity: item.quantity, picks, short: Math.max(0, remaining),
    });
  }
  res.json({
    data: {
      order: shape(order),
      company: { name: req.company.name, phone: req.company.phone, email: req.company.email, address: [req.company.address_line1, req.company.city, req.company.state, req.company.postal_code].filter(Boolean).join(", ") },
      warehouse: { id: warehouse.id, name: warehouse.name, code: warehouse.code },
      lines,
    },
  });
};

module.exports = { listOrders, getOrder, updateOrderStatus, updateOrderDetails, pickList, TRANSITIONS };
