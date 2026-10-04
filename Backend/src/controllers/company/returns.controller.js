// Returns (RMA) for a company: approve / reject, receive (restock), resolve with a credit note.
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { num } = require("../../services/money");
const { queueEmail } = require("../../services/email/outbox");
const { displayName } = require("../../services/users");
const inv = require("../../services/inventory");
const billing = require("../../services/invoicing");
const gl = require("../../services/postings");
const { emailCreditNote } = require("../../services/salesEmails");
const { REASONS, CONDITIONS, createReturn, creditLinesFor, returnableFor } = require("../../services/returns");

const TX = { timeout: 30000, maxWait: 10000 };
const userSelect = { id: true, email: true, first_name: true, last_name: true, business_name: true, phone: true };
const orderInclude = { order_items: { orderBy: { id: "asc" }, include: { products: { select: { title: true, sku: true, cost_price: true } } } } };

const shape = ({ users, orders, warehouses, return_items, credit_notes, ...r }) => ({
  ...r,
  reason_label: REASONS[r.reason] || r.reason,
  customer: users,
  order: orders,
  warehouse: warehouses,
  credit_note: credit_notes?.[0] || null,
  items: return_items?.map(({ order_items, products, ...i }) => ({
    ...i,
    title: products?.title || order_items?.products?.title,
    sku: products?.sku || order_items?.products?.sku,
    ordered: order_items?.quantity,
    unit_price: order_items?.price_at_time,
  })),
});

const detailInclude = {
  users: { select: userSelect },
  orders: { select: { id: true, order_number: true, status: true, payment_method: true, total_amount: true } },
  warehouses: { select: { id: true, name: true, code: true } },
  return_items: {
    orderBy: { id: "asc" },
    include: {
      products: { select: { title: true, sku: true } },
      order_items: { select: { quantity: true, price_at_time: true, products: { select: { title: true, sku: true } } } },
    },
  },
  credit_notes: { where: { status: { not: "void" } }, select: { id: true, credit_note_number: true, total_amount: true, amount_applied: true, amount_refunded: true, status: true } },
};

const load = async (req, id = req.params.id) => {
  const r = await prisma.return_requests.findFirst({ where: { id: toId(id), company_id: req.company.id }, include: detailInclude });
  if (!r) throw new HttpError(404, "Return not found");
  return shape(r);
};

// Locks the return and checks its status.
const lockReturn = async (tx, req, allowed) => {
  const [row] = await tx.$queryRaw`SELECT id, status FROM return_requests WHERE id = ${toId(req.params.id)} AND company_id = ${req.company.id} FOR UPDATE`;
  if (!row) throw new HttpError(404, "Return not found");
  if (!allowed.includes(row.status)) throw new HttpError(400, `A return that is "${row.status}" can't be changed like this`);
  return tx.return_requests.findUnique({ where: { id: row.id }, include: { return_items: true } });
};

const notifyCustomer = async (req, id, extra = {}) => {
  const r = await prisma.return_requests.findUnique({
    where: { id: BigInt(id) },
    include: { users: { select: userSelect }, orders: { select: { order_number: true } } },
  });
  if (!r?.users?.email) return;
  await queueEmail({
    to: r.users.email,
    template: "returnUpdate",
    companyId: req.company.id,
    data: { name: displayName(r.users), companyName: req.company.name, rmaNumber: r.rma_number, orderNumber: r.orders.order_number, status: r.status, staffNotes: r.staff_notes, ...extra },
  });
};

// GET /company/returns?status&search
const listReturns = async (req, res) => {
  const search = String(req.query.search || "").trim();
  const rows = await prisma.return_requests.findMany({
    where: {
      company_id: req.company.id,
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(search
        ? { OR: [
            { rma_number: { contains: search, mode: "insensitive" } },
            { orders: { is: { order_number: { contains: search, mode: "insensitive" } } } },
            { users: { is: { email: { contains: search, mode: "insensitive" } } } },
          ] }
        : {}),
    },
    orderBy: { created_at: "desc" },
    take: 300,
    include: { ...detailInclude },
  });
  const counts = await prisma.return_requests.groupBy({ by: ["status"], where: { company_id: req.company.id }, _count: true });
  res.json({ data: rows.map(shape), counts: Object.fromEntries(counts.map((c) => [c.status, c._count])), reasons: REASONS });
};

const getReturn = async (req, res) => {
  res.json({ data: await load(req), reasons: REASONS, conditions: CONDITIONS, inventoryTracked: inv.isInventoryTracked(req.company) });
};

// GET /company/orders/:id/returnable -> lines and how many can still be returned
const returnableLines = async (req, res) => {
  const order = await prisma.orders.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id }, include: orderInclude });
  if (!order) throw new HttpError(404, "Order not found");
  const lines = await returnableFor(prisma, order);
  res.json({ data: lines.map((l) => ({ order_item_id: l.id, title: l.products?.title, sku: l.products?.sku, quantity: l.quantity, returned: l.returned, returnable: l.returnable, price: l.price_at_time })), reasons: REASONS });
};

// POST /company/returns { order_id, reason, notes?, staff_notes?, items: [{ order_item_id, quantity }] } -> created already approved
const createReturnForOrder = async (req, res) => {
  const orderId = toId(req.body.order_id, "order_id");
  const created = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} AND company_id = ${req.company.id} FOR UPDATE`;
    if (!locked) throw new HttpError(404, "Order not found");
    const order = await tx.orders.findUnique({ where: { id: locked.id }, include: orderInclude });
    return createReturn(tx, { order, company: req.company, body: req.body, byStaff: true });
  }, TX);
  await audit(req, "return.create", { entity: "return", entityId: created.id, changes: { rma: created.rma_number, order_id: orderId } });
  await notifyCustomer(req, created.id);
  res.status(201).json({ message: `Return ${created.rma_number} created`, data: await load(req, created.id) });
};

// POST /company/returns/:id/approve { staff_notes?, warehouse_id? }
const approveReturn = async (req, res) => {
  const r = await prisma.$transaction(async (tx) => {
    const ret = await lockReturn(tx, req, ["requested"]);
    const data = { status: "approved", approved_at: new Date(), updated_at: new Date() };
    if (req.body.staff_notes !== undefined) data.staff_notes = req.body.staff_notes ? String(req.body.staff_notes).slice(0, 2000) : null;
    if (req.body.warehouse_id) data.warehouse_id = (await inv.assertWarehouse(tx, req.company.id, toId(req.body.warehouse_id, "warehouse_id"))).id;
    return tx.return_requests.update({ where: { id: ret.id }, data });
  }, TX);
  await audit(req, "return.approve", { entity: "return", entityId: r.id, changes: { rma: r.rma_number } });
  await notifyCustomer(req, r.id);
  res.json({ message: `Return ${r.rma_number} approved`, data: await load(req) });
};

// POST /company/returns/:id/reject { staff_notes }
const rejectReturn = async (req, res) => {
  const r = await prisma.$transaction(async (tx) => {
    const ret = await lockReturn(tx, req, ["requested", "approved"]);
    return tx.return_requests.update({
      where: { id: ret.id },
      data: { status: "rejected", closed_at: new Date(), updated_at: new Date(), staff_notes: req.body.staff_notes ? String(req.body.staff_notes).slice(0, 2000) : ret.staff_notes },
    });
  }, TX);
  await audit(req, "return.reject", { entity: "return", entityId: r.id, changes: { rma: r.rma_number, notes: r.staff_notes } });
  await notifyCustomer(req, r.id);
  res.json({ message: `Return ${r.rma_number} rejected`, data: await load(req) });
};

/**
 * POST /company/returns/:id/receive
 *   { items: [{ id, quantity_received, condition, restock }], warehouse_id?, staff_notes? }
 * Resellable items marked "restock" go back into stock (when the company tracks inventory).
 */
const receiveReturn = async (req, res) => {
  const tracked = inv.isInventoryTracked(req.company);
  const touched = [];
  const r = await prisma.$transaction(async (tx) => {
    const ret = await lockReturn(tx, req, ["approved"]);
    const input = Array.isArray(req.body.items) ? req.body.items : [];
    let warehouseId = null;
    if (tracked) {
      const wh = req.body.warehouse_id
        ? await inv.assertWarehouse(tx, req.company.id, toId(req.body.warehouse_id, "warehouse_id"))
        : ret.warehouse_id
          ? await tx.warehouses.findUnique({ where: { id: ret.warehouse_id } })
          : await inv.getDefaultWarehouse(tx, req.company.id);
      warehouseId = wh.id;
    }
    let any = 0;
    let restockValue = 0;
    for (const item of ret.return_items) {
      const given = input.find((i) => String(i.id) === String(item.id));
      const qty = given ? Number(given.quantity_received) : item.quantity;
      if (!Number.isInteger(qty) || qty < 0 || qty > item.quantity) throw new HttpError(400, `Received quantity must be between 0 and ${item.quantity}`);
      const condition = given?.condition ? String(given.condition) : "resellable";
      if (!CONDITIONS.includes(condition)) throw new HttpError(400, `Condition must be one of: ${CONDITIONS.join(", ")}`);
      const restock = given?.restock === undefined ? condition === "resellable" : !!given.restock && condition === "resellable";
      await tx.return_items.update({ where: { id: item.id }, data: { quantity_received: qty, condition, restock } });
      any += qty;
      if (tracked && restock && qty > 0 && item.product_id) {
        const orderLine = await tx.order_items.findUnique({ where: { id: item.order_item_id }, select: { flavor: true } });
        const product = await tx.products.findUnique({ where: { id: item.product_id }, select: { cost_price: true } });
        await inv.receive(tx, {
          companyId: req.company.id, warehouseId, productId: item.product_id, flavor: orderLine?.flavor || "", quantity: qty,
          unitCost: product?.cost_price ?? null, updateCost: false, type: "return", reason: "customer_return",
          referenceType: "return", referenceId: ret.id, notes: ret.rma_number, userId: req.user.id,
        });
        restockValue += qty * Number(product?.cost_price || 0);
        touched.push(item.product_id);
      }
    }
    if (!any) throw new HttpError(400, "Nothing was received. Reject the return instead.");
    if (restockValue > 0) await gl.postCustomerReturn(tx, { companyId: req.company.id, ret, value: Math.round(restockValue * 100) / 100, userId: req.user.id });
    return tx.return_requests.update({
      where: { id: ret.id },
      data: {
        status: "received", received_at: new Date(), updated_at: new Date(), warehouse_id: warehouseId ?? ret.warehouse_id,
        ...(req.body.staff_notes !== undefined ? { staff_notes: req.body.staff_notes ? String(req.body.staff_notes).slice(0, 2000) : null } : {}),
      },
    });
  }, TX);
  if (touched.length) await inv.resetLowStockFlags(touched);
  await audit(req, "return.receive", { entity: "return", entityId: r.id, changes: { rma: r.rma_number, restocked: touched.length } });
  await notifyCustomer(req, r.id);
  res.json({ message: `Return ${r.rma_number} received${touched.length ? " and restocked" : ""}`, data: await load(req) });
};

/**
 * POST /company/returns/:id/resolve { resolution: credit_invoice | refund | no_credit, staff_notes? }
 *   credit_invoice: credit note applied to the order's open invoice (anything left stays as open credit)
 *   refund:         credit note marked as refunded (pay the customer back outside the system)
 *   no_credit:      close without credit (e.g. replaced)
 */
const resolveReturn = async (req, res) => {
  const resolution = String(req.body.resolution || "");
  if (!["credit_invoice", "refund", "no_credit"].includes(resolution)) throw new HttpError(400, "Resolution must be credit_invoice, refund or no_credit");
  const result = await prisma.$transaction(async (tx) => {
    const ret = await lockReturn(tx, req, ["received"]);
    let cn = null;
    let applied = 0;
    let invoiceNumber = null;
    if (resolution !== "no_credit") {
      const order = await tx.orders.findUnique({ where: { id: ret.order_id }, include: orderInclude });
      const { items, tax } = creditLinesFor(order, ret.return_items);
      if (!items.length) throw new HttpError(400, "Nothing was received, so there is nothing to credit");
      const invoice = await tx.invoices.findFirst({ where: { order_id: order.id, status: { not: "void" } } });
      cn = await billing.createCreditNote(tx, {
        companyId: req.company.id, userId: order.user_id, invoiceId: invoice?.id || null, returnId: ret.id,
        reason: `Return ${ret.rma_number} (${REASONS[ret.reason] || ret.reason})`, items, tax, createdBy: req.user.id,
      });
      if (resolution === "credit_invoice" && invoice && ["issued", "partially_paid"].includes(invoice.status) && billing.invoiceBalance(invoice) > 0) {
        const a = await billing.applyCreditNote(tx, { companyId: req.company.id, creditNoteId: cn.id, invoiceId: invoice.id });
        applied = a.amount;
        invoiceNumber = invoice.invoice_number;
      }
      if (resolution === "refund") await billing.refundCreditNote(tx, { companyId: req.company.id, creditNoteId: cn.id });
    }
    const updated = await tx.return_requests.update({
      where: { id: ret.id },
      data: {
        status: "closed", resolution, closed_at: new Date(), updated_at: new Date(), credit_note_id: cn?.id || null,
        ...(req.body.staff_notes !== undefined ? { staff_notes: req.body.staff_notes ? String(req.body.staff_notes).slice(0, 2000) : null } : {}),
      },
    });
    return { ret: updated, cn, applied, invoiceNumber };
  }, TX);
  await audit(req, "return.resolve", { entity: "return", entityId: result.ret.id, changes: { rma: result.ret.rma_number, resolution, credit_note: result.cn?.credit_note_number, total: result.cn ? num(result.cn.total_amount) : 0 } });
  await notifyCustomer(req, result.ret.id, { creditTotal: result.cn ? num(result.cn.total_amount) : 0 });
  if (result.cn) {
    await emailCreditNote(result.cn.id, {
      applied: result.applied,
      refunded: resolution === "refund" ? num(result.cn.total_amount) : 0,
      invoiceNumber: result.invoiceNumber,
    });
  }
  res.json({
    message: result.cn
      ? `Return closed. Credit note ${result.cn.credit_note_number} for ${num(result.cn.total_amount).toFixed(2)} issued${result.applied ? ` (${result.applied.toFixed(2)} applied to ${result.invoiceNumber})` : ""}.`
      : "Return closed without credit",
    data: await load(req),
  });
};

module.exports = { listReturns, getReturn, returnableLines, createReturnForOrder, approveReturn, rejectReturn, receiveReturn, resolveReturn };
