// Returns to suppliers (RTV): send faulty, expired or excess stock back and track the supplier's credit.
// draft -> shipped (stock leaves, supplier emailed) -> credited (supplier credit recorded) | closed (no credit)
const { Prisma } = require("@prisma/client");
const prisma = require("../../prisma");
const { HttpError, toId, toPositiveInt } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { nextNumber } = require("../../services/sequences");
const { queueEmail } = require("../../services/email/outbox");
const inv = require("../../services/inventory");
const gl = require("../../services/postings");
const payables = require("../../services/payables");

// Value at which the return left the books (what was posted when it shipped), else its cost value.
const returnValue = async (tx, rtv) => {
  const e = await tx.journal_entries.findFirst({ where: { company_id: rtv.company_id, source_type: "supplier_return", source_id: String(rtv.id), reversal_of_id: null } });
  return e ? Number(e.total) : Number(rtv.total_amount);
};

const REASONS = {
  damaged: "Damaged in delivery",
  defective: "Defective",
  expired: "Expired / short-dated",
  wrong_item: "Wrong item delivered",
  overstock: "Overstock",
  recall: "Recall",
  other: "Other",
};
const text = (v, max = 255) => (v === undefined ? undefined : v === null || v === "" ? null : String(v).trim().slice(0, max));
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const TX = { timeout: 30000, maxWait: 10000 };

const include = {
  suppliers: { select: { id: true, name: true, email: true, contact_name: true } },
  warehouses: { select: { id: true, name: true, code: true } },
  purchase_orders: { select: { id: true, po_number: true } },
  supplier_return_items: {
    orderBy: { id: "asc" },
    include: { products: { select: { id: true, title: true, sku: true } }, inventory_lots: { select: { lot_number: true, expiry_date: true } } },
  },
};

const shape = ({ suppliers, warehouses, purchase_orders, supplier_return_items, ...r }) => ({
  ...r,
  reason_label: REASONS[r.reason] || r.reason,
  supplier: suppliers,
  warehouse: warehouses,
  purchase_order: purchase_orders,
  items: supplier_return_items?.map(({ products, inventory_lots, ...i }) => ({
    ...i,
    product: products,
    title: inv.label(products?.title, i.flavor),
    lot_number: inventory_lots?.lot_number || null,
    expiry_date: inventory_lots?.expiry_date || null,
  })),
});

const load = async (req, id = req.params.id, db = prisma) => {
  const r = await db.supplier_returns.findFirst({ where: { id: toId(id), company_id: req.company.id }, include });
  if (!r) throw new HttpError(404, "Supplier return not found");
  return r;
};

// Validates lines; default cost = the PO line cost, else the supplier price, else the product's average cost.
const buildLines = async (db, req, supplierId, warehouseId, poId, items) => {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, "Add at least one product");
  const poItems = poId ? await db.purchase_order_items.findMany({ where: { purchase_order_id: poId } }) : [];
  const lines = [];
  for (const raw of items) {
    const product = await inv.assertProduct(db, req.company.id, toId(raw.product_id, "product_id"));
    const flavor = inv.resolveFlavor(product, raw.flavor, { allowUnassigned: true });
    const quantity = toPositiveInt(raw.quantity);
    let lotId = null;
    if (raw.lot_id) {
      const lot = await db.inventory_lots.findFirst({ where: { id: toId(raw.lot_id, "lot_id"), warehouse_id: warehouseId, product_id: product.id, flavor } });
      if (!lot) throw new HttpError(400, "That lot isn't in this warehouse for this product");
      lotId = lot.id;
    }
    let unitCost = raw.unit_cost === undefined || raw.unit_cost === "" || raw.unit_cost === null ? null : Number(raw.unit_cost);
    if (unitCost === null) {
      const poLine = poItems.find((i) => String(i.product_id) === String(product.id) && i.flavor === flavor);
      const sp = poLine ? null : await db.supplier_products.findUnique({ where: { supplier_id_product_id: { supplier_id: supplierId, product_id: product.id } } });
      unitCost = Number(poLine?.unit_cost ?? sp?.unit_cost ?? product.cost_price ?? 0);
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new HttpError(400, "Unit cost must be 0 or more");
    lines.push({
      product_id: product.id, flavor, lot_id: lotId, quantity,
      unit_cost: new Prisma.Decimal(unitCost.toFixed(4)),
      line_total: new Prisma.Decimal(round2(unitCost * quantity).toFixed(2)),
    });
  }
  return lines;
};

// GET /company/supplier-returns?status&supplier_id
const listReturns = async (req, res) => {
  const rows = await prisma.supplier_returns.findMany({
    where: {
      company_id: req.company.id,
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(req.query.supplier_id ? { supplier_id: toId(req.query.supplier_id, "supplier_id") } : {}),
    },
    orderBy: { id: "desc" },
    take: 300,
    include,
  });
  res.json({ data: rows.map(shape), reasons: REASONS });
};

const getReturn = async (req, res) => {
  res.json({ data: shape(await load(req)), reasons: REASONS });
};

// POST /company/supplier-returns { supplier_id, warehouse_id?, purchase_order_id?, reason, notes?, items: [{ product_id, flavor?, quantity, unit_cost?, lot_id? }] }
const createReturn = async (req, res) => {
  const b = req.body;
  const supplier = await prisma.suppliers.findFirst({ where: { id: toId(b.supplier_id, "supplier_id"), company_id: req.company.id } });
  if (!supplier) throw new HttpError(404, "Supplier not found");
  if (!REASONS[b.reason]) throw new HttpError(400, `Reason must be one of: ${Object.keys(REASONS).join(", ")}`);
  let poId = null;
  if (b.purchase_order_id) {
    const po = await prisma.purchase_orders.findFirst({ where: { id: toId(b.purchase_order_id, "purchase_order_id"), company_id: req.company.id, supplier_id: supplier.id } });
    if (!po) throw new HttpError(400, "That purchase order isn't from this supplier");
    poId = po.id;
  }
  const warehouse = b.warehouse_id
    ? await inv.assertWarehouse(prisma, req.company.id, toId(b.warehouse_id, "warehouse_id"))
    : await inv.getDefaultWarehouse(prisma, req.company.id);
  const r = await prisma.$transaction(async (tx) => {
    const lines = await buildLines(tx, req, supplier.id, warehouse.id, poId, b.items);
    return tx.supplier_returns.create({
      data: {
        company_id: req.company.id, supplier_id: supplier.id, warehouse_id: warehouse.id, purchase_order_id: poId,
        return_number: await nextNumber(tx, req.company.id, "RTV"),
        reason: b.reason, notes: text(b.notes, 5000), created_by: BigInt(req.user.id),
        total_amount: new Prisma.Decimal(round2(lines.reduce((s, l) => s + Number(l.line_total), 0)).toFixed(2)),
        supplier_return_items: { create: lines },
      },
    });
  }, TX);
  await audit(req, "supplier_return.create", { entity: "supplier_return", entityId: r.id, changes: { number: r.return_number, supplier: supplier.name } });
  res.status(201).json({ message: `Supplier return ${r.return_number} saved as draft`, data: shape(await load(req, r.id)) });
};

const lockReturn = async (tx, req, allowed) => {
  const [row] = await tx.$queryRaw`SELECT id, status FROM supplier_returns WHERE id = ${toId(req.params.id)} AND company_id = ${req.company.id} FOR UPDATE`;
  if (!row) throw new HttpError(404, "Supplier return not found");
  if (!allowed.includes(row.status)) throw new HttpError(400, `A ${row.status} supplier return can't be changed like this`);
  return load(req, row.id, tx);
};

// PATCH /company/supplier-returns/:id  (drafts) { reason?, notes?, warehouse_id?, items? }
const updateReturn = async (req, res) => {
  const b = req.body;
  await prisma.$transaction(async (tx) => {
    const r = await lockReturn(tx, req, ["draft"]);
    const data = { updated_at: new Date() };
    if (b.reason !== undefined) {
      if (!REASONS[b.reason]) throw new HttpError(400, "Unknown reason");
      data.reason = b.reason;
    }
    if (b.notes !== undefined) data.notes = text(b.notes, 5000);
    if (b.warehouse_id) data.warehouse_id = (await inv.assertWarehouse(tx, req.company.id, toId(b.warehouse_id, "warehouse_id"))).id;
    if (b.items) {
      const lines = await buildLines(tx, req, r.supplier_id, data.warehouse_id || r.warehouse_id, r.purchase_order_id, b.items);
      await tx.supplier_return_items.deleteMany({ where: { supplier_return_id: r.id } });
      await tx.supplier_return_items.createMany({ data: lines.map((l) => ({ ...l, supplier_return_id: r.id })) });
      data.total_amount = new Prisma.Decimal(round2(lines.reduce((s, l) => s + Number(l.line_total), 0)).toFixed(2));
    }
    await tx.supplier_returns.update({ where: { id: r.id }, data });
  }, TX);
  res.json({ message: "Supplier return saved", data: shape(await load(req)) });
};

// POST /company/supplier-returns/:id/ship { email?: true } -> takes the stock out and (optionally) emails the supplier
const shipReturn = async (req, res) => {
  const tracked = inv.isInventoryTracked(req.company);
  const r = await prisma.$transaction(async (tx) => {
    const ret = await lockReturn(tx, req, ["draft"]);
    let value = Number(ret.total_amount);
    if (tracked) {
      value = 0;
      for (const i of ret.supplier_return_items) {
        const product = await tx.products.findUnique({ where: { id: i.product_id }, select: { cost_price: true } });
        const chunks = await inv.issue(tx, {
          companyId: req.company.id, warehouseId: ret.warehouse_id, productId: i.product_id, flavor: i.flavor, quantity: i.quantity,
          lotId: i.lot_id, type: "supplier_return", reason: ret.reason, referenceType: "supplier_return", referenceId: ret.id,
          notes: ret.return_number, userId: req.user.id, productName: i.products?.title,
        });
        value += gl.chunksValue(chunks, product?.cost_price);
      }
    }
    await gl.postSupplierReturnShipped(tx, { companyId: req.company.id, rtv: ret, value: Math.round(value * 100) / 100, userId: req.user.id });
    await tx.supplier_returns.update({ where: { id: ret.id }, data: { status: "shipped", shipped_at: new Date(), updated_at: new Date() } });
    return ret;
  }, TX);
  if (tracked) await inv.checkLowStock(req.company.id, r.supplier_return_items.map((i) => i.product_id));

  const wantsEmail = req.body.email !== false && r.suppliers.email;
  if (wantsEmail) {
    const c = req.company;
    await queueEmail({
      to: r.suppliers.email,
      template: "supplierReturn",
      companyId: c.id,
      data: {
        companyName: c.name, companyEmail: c.email, companyPhone: c.phone,
        supplierName: r.suppliers.contact_name || r.suppliers.name,
        returnNumber: r.return_number, poNumber: r.purchase_orders?.po_number, reason: REASONS[r.reason], notes: r.notes,
        items: r.supplier_return_items.map((i) => ({
          title: inv.label(i.products.title, i.flavor), lot: i.inventory_lots?.lot_number, quantity: i.quantity,
          unitCost: Number(i.unit_cost), lineTotal: Number(i.line_total),
        })),
        total: Number(r.total_amount),
      },
    });
  }
  await audit(req, "supplier_return.ship", { entity: "supplier_return", entityId: r.id, changes: { number: r.return_number, emailed: wantsEmail ? r.suppliers.email : null } });
  res.json({
    message: `${r.return_number} shipped${tracked ? ": stock removed" : ""}${wantsEmail ? ` and emailed to ${r.suppliers.email}` : ""}`,
    data: shape(await load(req)),
  });
};

// POST /company/supplier-returns/:id/credit { credit_amount, credit_reference? } -> the supplier's credit note / refund
const recordCredit = async (req, res) => {
  const amount = Number(req.body.credit_amount);
  if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, "Enter the amount the supplier credited");
  const r = await prisma.$transaction(async (tx) => {
    const ret = await lockReturn(tx, req, ["shipped"]);
    // The credit reduces what we owe the supplier (applied to their open bills automatically).
    if (amount > 0) {
      await payables.createVendorCredit(tx, {
        companyId: req.company.id, supplierId: ret.supplier_id, amount, reference: text(req.body.credit_reference),
        supplierReturnId: ret.id, notes: `For return ${ret.return_number}`, userId: req.user.id,
      });
    }
    await gl.postSupplierReturnSettled(tx, { companyId: req.company.id, rtv: ret, value: await returnValue(tx, ret), credit: round2(amount), userId: req.user.id });
    return tx.supplier_returns.update({
      where: { id: ret.id },
      data: {
        status: "credited", credit_amount: new Prisma.Decimal(round2(amount).toFixed(2)), credit_reference: text(req.body.credit_reference),
        credited_at: new Date(), updated_at: new Date(),
      },
    });
  }, TX);
  await audit(req, "supplier_return.credit", { entity: "supplier_return", entityId: r.id, changes: { amount, reference: r.credit_reference } });
  res.json({ message: `Credit of ${amount.toFixed(2)} recorded on ${r.return_number}`, data: shape(await load(req)) });
};

// POST /company/supplier-returns/:id/close -> shipped, but no credit is expected
const closeReturn = async (req, res) => {
  const r = await prisma.$transaction(async (tx) => {
    const ret = await lockReturn(tx, req, ["shipped"]);
    await gl.postSupplierReturnSettled(tx, { companyId: req.company.id, rtv: ret, value: await returnValue(tx, ret), credit: 0, userId: req.user.id });
    return tx.supplier_returns.update({ where: { id: ret.id }, data: { status: "closed", updated_at: new Date() } });
  }, TX);
  await audit(req, "supplier_return.close", { entity: "supplier_return", entityId: r.id });
  res.json({ message: `${r.return_number} closed`, data: shape(await load(req)) });
};

const cancelReturn = async (req, res) => {
  const r = await prisma.$transaction(async (tx) => {
    const ret = await lockReturn(tx, req, ["draft"]);
    return tx.supplier_returns.update({ where: { id: ret.id }, data: { status: "cancelled", updated_at: new Date() } });
  }, TX);
  await audit(req, "supplier_return.cancel", { entity: "supplier_return", entityId: r.id });
  res.json({ message: `${r.return_number} cancelled`, data: shape(await load(req)) });
};

module.exports = { listReturns, getReturn, createReturn, updateReturn, shipReturn, recordCredit, closeReturn, cancelReturn, REASONS };
