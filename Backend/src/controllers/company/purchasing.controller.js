// Suppliers, supplier price lists, purchase orders and goods receiving.
const { Prisma } = require("@prisma/client");
const prisma = require("../../prisma");
const { HttpError, toId, toPositiveInt } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { nextNumber } = require("../../services/sequences");
const { queueEmail } = require("../../services/email/outbox");
const inv = require("../../services/inventory");
const gl = require("../../services/postings");

const text = (v, max = 255) => (v === undefined ? undefined : v === null || v === "" ? null : String(v).trim().slice(0, max));
const money2 = (n) => new Prisma.Decimal((Math.round(Number(n || 0) * 100) / 100).toFixed(2));
const cost4 = (n) => new Prisma.Decimal(Number(n || 0).toFixed(4));
const dateOrNull = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`) : null);

// ---- suppliers -----------------------------------------------------------------------------

const SUPPLIER_FIELDS = [
  "name", "code", "contact_name", "email", "phone", "website", "address_line1", "address_line2",
  "city", "state", "postal_code", "country", "tax_id", "currency", "notes",
];
const supplierData = (body) => {
  const data = {};
  for (const f of SUPPLIER_FIELDS) if (body[f] !== undefined) data[f] = text(body[f], f === "notes" ? 5000 : 255);
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new HttpError(400, "Invalid supplier email");
  if (data.currency) data.currency = data.currency.toUpperCase().slice(0, 3);
  if (body.payment_terms_days !== undefined) {
    const d = Number(body.payment_terms_days);
    if (!Number.isInteger(d) || d < 0 || d > 365) throw new HttpError(400, "Payment terms must be 0 to 365 days");
    data.payment_terms_days = d;
  }
  if (body.is_active !== undefined) data.is_active = !!body.is_active;
  if (data.name === null) throw new HttpError(400, "Supplier name is required");
  return data;
};

const findOwnSupplier = async (req, id = req.params.id) => {
  const s = await prisma.suppliers.findFirst({ where: { id: toId(id, "supplier_id"), company_id: req.company.id } });
  if (!s) throw new HttpError(404, "Supplier not found");
  return s;
};

const listSuppliers = async (req, res) => {
  const search = String(req.query.search || "").trim();
  const suppliers = await prisma.suppliers.findMany({
    where: {
      company_id: req.company.id,
      ...(req.query.active === "true" ? { is_active: true } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { code: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ is_active: "desc" }, { name: "asc" }],
    include: { _count: { select: { supplier_products: true, purchase_orders: true } } },
  });
  const open = await prisma.purchase_orders.groupBy({
    by: ["supplier_id"],
    where: { company_id: req.company.id, status: { in: ["sent", "partially_received"] } },
    _count: { _all: true },
    _sum: { total_amount: true },
  });
  const openBy = new Map(open.map((o) => [String(o.supplier_id), o]));
  res.json({
    data: suppliers.map(({ _count, ...s }) => ({
      ...s,
      productCount: _count.supplier_products,
      poCount: _count.purchase_orders,
      openPoCount: openBy.get(String(s.id))?._count._all || 0,
      openPoValue: Number(openBy.get(String(s.id))?._sum.total_amount || 0),
    })),
  });
};

const getSupplier = async (req, res) => {
  const supplier = await findOwnSupplier(req);
  const [products, orders] = await Promise.all([
    prisma.supplier_products.findMany({
      where: { supplier_id: supplier.id },
      include: { products: { select: { id: true, title: true, sku: true, cost_price: true } } },
      orderBy: { id: "asc" },
    }),
    prisma.purchase_orders.findMany({
      where: { supplier_id: supplier.id },
      orderBy: { id: "desc" },
      take: 20,
      select: { id: true, po_number: true, status: true, order_date: true, total_amount: true },
    }),
  ]);
  res.json({ data: { ...supplier, products: products.map(({ products: p, ...sp }) => ({ ...sp, product: p })), orders } });
};

const createSupplier = async (req, res) => {
  const data = supplierData(req.body);
  if (!data.name) throw new HttpError(400, "Supplier name is required");
  const supplier = await prisma.suppliers.create({ data: { ...data, company_id: req.company.id } });
  await audit(req, "supplier.create", { entity: "supplier", entityId: supplier.id, changes: { name: supplier.name } });
  res.status(201).json({ message: "Supplier added", data: supplier });
};

const updateSupplier = async (req, res) => {
  const supplier = await findOwnSupplier(req);
  const data = supplierData(req.body);
  const updated = await prisma.suppliers.update({ where: { id: supplier.id }, data: { ...data, updated_at: new Date() } });
  await audit(req, "supplier.update", { entity: "supplier", entityId: supplier.id, changes: data });
  res.json({ message: "Supplier saved", data: updated });
};

// Suppliers with purchase history are deactivated instead of deleted.
const deleteSupplier = async (req, res) => {
  const supplier = await findOwnSupplier(req);
  const pos = await prisma.purchase_orders.count({ where: { supplier_id: supplier.id } });
  if (pos) {
    await prisma.suppliers.update({ where: { id: supplier.id }, data: { is_active: false, updated_at: new Date() } });
    await audit(req, "supplier.deactivate", { entity: "supplier", entityId: supplier.id });
    return res.json({ message: "This supplier has purchase orders, so it was deactivated instead of deleted.", deactivated: true });
  }
  await prisma.$transaction([
    prisma.products.updateMany({ where: { preferred_supplier_id: supplier.id }, data: { preferred_supplier_id: null } }),
    prisma.suppliers.delete({ where: { id: supplier.id } }),
  ]);
  await audit(req, "supplier.delete", { entity: "supplier", entityId: supplier.id, changes: { name: supplier.name } });
  res.json({ message: "Supplier deleted" });
};

// PUT /company/suppliers/:id/products  { product_id, supplier_sku?, unit_cost?, lead_time_days?, preferred? }
const upsertSupplierProduct = async (req, res) => {
  const supplier = await findOwnSupplier(req);
  const product = await inv.assertProduct(prisma, req.company.id, toId(req.body.product_id, "product_id"));
  const unitCost = Number(req.body.unit_cost ?? 0);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new HttpError(400, "Unit cost must be 0 or more");
  const lead = req.body.lead_time_days === undefined || req.body.lead_time_days === "" ? null : Number(req.body.lead_time_days);
  const data = { supplier_sku: text(req.body.supplier_sku), unit_cost: cost4(unitCost), lead_time_days: Number.isInteger(lead) ? lead : null, updated_at: new Date() };
  const row = await prisma.supplier_products.upsert({
    where: { supplier_id_product_id: { supplier_id: supplier.id, product_id: product.id } },
    create: { ...data, supplier_id: supplier.id, product_id: product.id },
    update: data,
  });
  if (req.body.preferred) {
    await prisma.products.update({ where: { id: product.id }, data: { preferred_supplier_id: supplier.id } });
  }
  res.json({ message: "Supplier price saved", data: row });
};

const removeSupplierProduct = async (req, res) => {
  const supplier = await findOwnSupplier(req);
  await prisma.supplier_products.deleteMany({ where: { supplier_id: supplier.id, product_id: toId(req.params.productId, "product_id") } });
  res.json({ message: "Removed from supplier" });
};

// ---- purchase orders ---------------------------------------------------------------------

const PO_INCLUDE = {
  suppliers: { select: { id: true, name: true, email: true, contact_name: true, phone: true, payment_terms_days: true } },
  warehouses: { select: { id: true, name: true, code: true, address_line1: true, city: true, state: true, postal_code: true } },
  users: { select: { email: true } },
  purchase_order_items: {
    orderBy: { id: "asc" },
    include: { products: { select: { id: true, title: true, sku: true, barcode: true, unit: true } } },
  },
};

const shapePo = (po) => {
  const { suppliers, warehouses, users, purchase_order_items, ...rest } = po;
  const items = (purchase_order_items || []).map(({ products, ...i }) => ({
    ...i, product: products, outstanding: i.quantity_ordered - i.quantity_received,
  }));
  return {
    ...rest,
    supplier: suppliers,
    warehouse: warehouses,
    created_by_email: users?.email || null,
    items,
    units_ordered: items.reduce((s, i) => s + i.quantity_ordered, 0),
    units_received: items.reduce((s, i) => s + i.quantity_received, 0),
  };
};

const findOwnPo = async (req, db = prisma) => {
  const po = await db.purchase_orders.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id }, include: PO_INCLUDE });
  if (!po) throw new HttpError(404, "Purchase order not found");
  return po;
};

// Validates line input and fills in default costs from the supplier price list / product cost.
const buildLines = async (companyId, supplierId, items) => {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, "Add at least one product");
  const lines = [];
  for (const raw of items) {
    const product = await inv.assertProduct(prisma, companyId, toId(raw.product_id, "product_id"));
    const flavor = inv.resolveFlavor(product, raw.flavor);
    const quantity = toPositiveInt(raw.quantity);
    let unitCost = raw.unit_cost === undefined || raw.unit_cost === "" || raw.unit_cost === null ? null : Number(raw.unit_cost);
    if (unitCost === null) {
      const sp = await prisma.supplier_products.findUnique({
        where: { supplier_id_product_id: { supplier_id: BigInt(supplierId), product_id: product.id } },
      });
      unitCost = Number(sp?.unit_cost ?? product.cost_price ?? 0);
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new HttpError(400, "Unit cost must be 0 or more");
    lines.push({
      product_id: product.id,
      flavor,
      description: text(raw.description, 500) || inv.label(product.title, flavor),
      quantity_ordered: quantity,
      unit_cost: cost4(unitCost),
      line_total: money2(quantity * unitCost),
    });
  }
  return lines;
};

const totalsFor = (lines, tax, shipping) => {
  const subtotal = lines.reduce((s, l) => s + Number(l.line_total), 0);
  const t = Number(tax || 0);
  const sh = Number(shipping || 0);
  if (t < 0 || sh < 0) throw new HttpError(400, "Tax and shipping can't be negative");
  return { subtotal: money2(subtotal), tax_amount: money2(t), shipping_amount: money2(sh), total_amount: money2(subtotal + t + sh) };
};

// GET /company/purchase-orders?status&supplier_id&search&page
const listPos = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = 20;
  const search = String(req.query.search || "").trim();
  const where = {
    company_id: req.company.id,
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    ...(req.query.supplier_id ? { supplier_id: toId(req.query.supplier_id, "supplier_id") } : {}),
    ...(search ? { OR: [{ po_number: { contains: search, mode: "insensitive" } }, { supplier_reference: { contains: search, mode: "insensitive" } }, { suppliers: { is: { name: { contains: search, mode: "insensitive" } } } }] } : {}),
  };
  const [rows, totalCount] = await Promise.all([
    prisma.purchase_orders.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        suppliers: { select: { name: true } },
        warehouses: { select: { code: true } },
        purchase_order_items: { select: { quantity_ordered: true, quantity_received: true } },
      },
    }),
    prisma.purchase_orders.count({ where }),
  ]);
  res.json({
    data: rows.map(({ suppliers, warehouses, purchase_order_items, ...po }) => ({
      ...po,
      supplier_name: suppliers.name,
      warehouse_code: warehouses.code,
      units_ordered: purchase_order_items.reduce((s, i) => s + i.quantity_ordered, 0),
      units_received: purchase_order_items.reduce((s, i) => s + i.quantity_received, 0),
    })),
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
  });
};

const getPo = async (req, res) => {
  const po = await findOwnPo(req);
  const receipts = await prisma.goods_receipts.findMany({
    where: { purchase_order_id: po.id },
    orderBy: { id: "asc" },
    include: {
      users: { select: { email: true } },
      goods_receipt_items: { include: { products: { select: { title: true } }, inventory_lots: { select: { lot_number: true, expiry_date: true } } } },
    },
  });
  const landedAllocated = receipts.reduce((sum, r) => sum + Number(r.landed_cost || 0), 0);
  res.json({ data: { ...shapePo(po), receipts, landed_allocated: Math.round(landedAllocated * 100) / 100 } });
};

// POST /company/purchase-orders
const createPo = async (req, res) => {
  const companyId = req.company.id;
  const supplier = await findOwnSupplier(req, req.body.supplier_id);
  if (!supplier.is_active) throw new HttpError(400, "This supplier is inactive");
  const warehouse = req.body.warehouse_id
    ? await inv.assertWarehouse(prisma, companyId, toId(req.body.warehouse_id, "warehouse_id"))
    : await inv.getDefaultWarehouse(prisma, companyId);
  const lines = await buildLines(companyId, supplier.id, req.body.items);
  const totals = totalsFor(lines, req.body.tax_amount, req.body.shipping_amount);

  const po = await prisma.$transaction(async (tx) =>
    tx.purchase_orders.create({
      data: {
        company_id: companyId,
        supplier_id: supplier.id,
        warehouse_id: warehouse.id,
        po_number: await nextNumber(tx, companyId, "PO"),
        currency: supplier.currency || "USD",
        expected_date: dateOrNull(req.body.expected_date),
        supplier_reference: text(req.body.supplier_reference),
        notes: text(req.body.notes, 5000),
        created_by: BigInt(req.user.id),
        ...totals,
        purchase_order_items: { create: lines },
      },
      include: PO_INCLUDE,
    }),
  );
  await audit(req, "po.create", { entity: "purchase_order", entityId: po.id, changes: { number: po.po_number, supplier: supplier.name, total: Number(po.total_amount) } });
  res.status(201).json({ message: `Purchase order ${po.po_number} created`, data: shapePo(po) });
};

// PATCH /company/purchase-orders/:id  (drafts only)
const updatePo = async (req, res) => {
  const po = await findOwnPo(req);
  if (po.status !== "draft") throw new HttpError(400, "Only draft purchase orders can be edited");
  const data = { updated_at: new Date() };
  if (req.body.supplier_id && String(req.body.supplier_id) !== String(po.supplier_id)) {
    const s = await findOwnSupplier(req, req.body.supplier_id);
    data.supplier_id = s.id;
    data.currency = s.currency;
  }
  if (req.body.warehouse_id) data.warehouse_id = (await inv.assertWarehouse(prisma, req.company.id, toId(req.body.warehouse_id, "warehouse_id"))).id;
  if (req.body.expected_date !== undefined) data.expected_date = dateOrNull(req.body.expected_date);
  if (req.body.supplier_reference !== undefined) data.supplier_reference = text(req.body.supplier_reference);
  if (req.body.notes !== undefined) data.notes = text(req.body.notes, 5000);

  const supplierId = data.supplier_id || po.supplier_id;
  const lines = req.body.items ? await buildLines(req.company.id, supplierId, req.body.items) : null;
  const currentLines = lines || po.purchase_order_items;
  Object.assign(
    data,
    totalsFor(currentLines, req.body.tax_amount ?? po.tax_amount, req.body.shipping_amount ?? po.shipping_amount),
  );

  await prisma.$transaction(async (tx) => {
    if (lines) {
      await tx.purchase_order_items.deleteMany({ where: { purchase_order_id: po.id } });
      await tx.purchase_order_items.createMany({ data: lines.map((l) => ({ ...l, purchase_order_id: po.id })) });
    }
    await tx.purchase_orders.update({ where: { id: po.id }, data });
  });
  await audit(req, "po.update", { entity: "purchase_order", entityId: po.id });
  res.json({ message: "Purchase order saved", data: shapePo(await findOwnPo(req)) });
};

// POST /company/purchase-orders/:id/send { email?: boolean }
const sendPo = async (req, res) => {
  const po = await findOwnPo(req);
  if (!["draft", "sent"].includes(po.status)) throw new HttpError(400, `A ${po.status} purchase order can't be sent`);
  const wantsEmail = req.body.email !== false;
  if (wantsEmail && !po.suppliers.email) throw new HttpError(400, "This supplier has no email address. Add one, or mark the PO as sent without emailing.");

  const updated = await prisma.purchase_orders.update({
    where: { id: po.id },
    data: { status: "sent", sent_at: new Date(), updated_at: new Date() },
  });

  if (wantsEmail) {
    const prices = await prisma.supplier_products.findMany({ where: { supplier_id: po.supplier_id } });
    const skuFor = (pid) => prices.find((p) => String(p.product_id) === String(pid))?.supplier_sku || null;
    const c = req.company;
    const w = po.warehouses;
    await queueEmail({
      to: po.suppliers.email,
      template: "purchaseOrder",
      companyId: c.id,
      data: {
        companyName: c.name, companyEmail: c.email, companyPhone: c.phone,
        companyAddress: [c.address_line1, c.city, c.state, c.postal_code].filter(Boolean).join(", "),
        supplierName: po.suppliers.contact_name || po.suppliers.name,
        poNumber: po.po_number,
        orderDate: po.order_date.toISOString().slice(0, 10),
        expectedDate: po.expected_date ? po.expected_date.toISOString().slice(0, 10) : null,
        warehouse: [w.name, w.address_line1, w.city, w.state, w.postal_code].filter(Boolean).join(", "),
        items: po.purchase_order_items.map((i) => ({
          title: i.description || i.products.title, supplierSku: skuFor(i.product_id),
          quantity: i.quantity_ordered, unitCost: Number(i.unit_cost), lineTotal: Number(i.line_total),
        })),
        subtotal: Number(po.subtotal), tax: Number(po.tax_amount), shipping: Number(po.shipping_amount), total: Number(po.total_amount),
        notes: po.notes,
      },
    });
  }
  await audit(req, "po.send", { entity: "purchase_order", entityId: po.id, changes: { emailed: wantsEmail ? po.suppliers.email : null } });
  res.json({
    message: wantsEmail ? `${po.po_number} emailed to ${po.suppliers.email}` : `${po.po_number} marked as sent`,
    data: updated,
  });
};

// Spreads an extra cost (freight, duty...) over received lines, by line value or by quantity.
// Returns the extra cost per unit for each line (same order as `lines`).
const allocateLanded = (lines, amount, method) => {
  const total = Number(amount || 0);
  if (!(total > 0)) return lines.map(() => 0);
  const byValue = method !== "quantity" && lines.some((l) => l.qty * l.unitCost > 0);
  const weights = lines.map((l) => (byValue ? l.qty * l.unitCost : l.qty));
  const sum = weights.reduce((a, b) => a + b, 0);
  let left = Math.round(total * 100) / 100;
  return lines.map((l, i) => {
    const share = i === lines.length - 1 ? left : Math.round(((total * weights[i]) / sum) * 100) / 100;
    left = Math.round((left - share) * 100) / 100;
    return share / l.qty;
  });
};

// POST /company/purchase-orders/:id/receive
// { lines: [{ item_id, quantity, lot_number?, expiry_date?, bin_id? }], notes?,
//   landed_cost?: number, landed_allocation?: "value" | "quantity", landed_notes? }
// Landed costs (freight, duty, ...) are added to the cost of the received units, so stock value and margins include them.
const receivePo = async (req, res) => {
  const companyId = req.company.id;
  const lines = Array.isArray(req.body.lines) ? req.body.lines.filter((l) => Number(l.quantity) > 0) : [];
  if (!lines.length) throw new HttpError(400, "Enter the quantity received for at least one line");
  const landed = req.body.landed_cost === undefined || req.body.landed_cost === "" || req.body.landed_cost === null ? 0 : Number(req.body.landed_cost);
  if (!Number.isFinite(landed) || landed < 0) throw new HttpError(400, "Landed cost must be 0 or more");
  const allocation = req.body.landed_allocation === "quantity" ? "quantity" : "value";

  const result = await prisma.$transaction(async (tx) => {
    // Lock the PO so two people can't receive the same lines at once.
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${toId(req.params.id)} FOR UPDATE`;
    const po = await findOwnPo(req, tx);
    if (!["sent", "partially_received", "draft"].includes(po.status)) {
      throw new HttpError(400, `A ${po.status} purchase order can't be received`);
    }

    const receipt = await tx.goods_receipts.create({
      data: {
        company_id: companyId,
        purchase_order_id: po.id,
        warehouse_id: po.warehouse_id,
        receipt_number: await nextNumber(tx, companyId, "GRN"),
        received_by: BigInt(req.user.id),
        notes: text(req.body.notes, 2000),
        landed_cost: money2(landed),
        landed_allocation: landed > 0 ? allocation : null,
        landed_notes: text(req.body.landed_notes),
      },
    });

    const prepared = [];
    for (const l of lines) {
      const item = po.purchase_order_items.find((i) => String(i.id) === String(l.item_id));
      if (!item) throw new HttpError(400, "A line doesn't belong to this purchase order");
      const qty = toPositiveInt(l.quantity);
      const outstanding = item.quantity_ordered - item.quantity_received;
      if (qty > outstanding) {
        throw new HttpError(400, `Only ${outstanding} more of "${inv.label(item.products.title, item.flavor)}" are expected on this order`);
      }
      if (!item.flavor && inv.hasFlavors(await tx.products.findUnique({ where: { id: item.product_id }, select: { flavors: true } }))) {
        throw new HttpError(400, `Line "${item.products.title}" has no flavour. Edit the purchase order line to choose one.`);
      }
      let binId = null;
      if (l.bin_id) {
        const bin = await tx.warehouse_bins.findFirst({ where: { id: toId(l.bin_id, "bin_id"), warehouse_id: po.warehouse_id } });
        if (!bin) throw new HttpError(400, "That bin isn't in the receiving warehouse");
        binId = bin.id;
      }
      prepared.push({ l, item, qty, binId, unitCost: Number(item.unit_cost) });
    }
    const extra = allocateLanded(prepared, landed, allocation);

    for (const [idx, p] of prepared.entries()) {
      const unitCost = Math.round((p.unitCost + extra[idx]) * 10000) / 10000;
      const lot = await inv.receive(tx, {
        companyId, warehouseId: po.warehouse_id, productId: p.item.product_id, flavor: p.item.flavor, quantity: p.qty,
        unitCost, lotNumber: text(p.l.lot_number, 64), expiryDate: p.l.expiry_date || null, binId: p.binId,
        type: "receipt", reason: "purchase", referenceType: "purchase_order", referenceId: po.id,
        notes: `${po.po_number} / ${receipt.receipt_number}`, userId: req.user.id, updateCost: true,
      });
      await tx.goods_receipt_items.create({
        data: {
          goods_receipt_id: receipt.id, purchase_order_item_id: p.item.id, product_id: p.item.product_id, flavor: p.item.flavor,
          quantity: p.qty, unit_cost: p.item.unit_cost, landed_unit_cost: cost4(unitCost), lot_id: lot.id,
        },
      });
      await tx.purchase_order_items.update({ where: { id: p.item.id }, data: { quantity_received: { increment: p.qty } } });
    }

    // exact value: line costs + the landed cost entered (no rounding drift)
    await gl.postGoodsReceipt(tx, {
      companyId, receipt, poNumber: po.po_number, supplierId: po.supplier_id, userId: req.user.id,
      value: Math.round(prepared.reduce((sum, p) => sum + p.qty * p.unitCost, 0) * 100) / 100 + Math.round(landed * 100) / 100,
    });
    const after = await tx.purchase_order_items.findMany({ where: { purchase_order_id: po.id } });
    const complete = after.every((i) => i.quantity_received >= i.quantity_ordered);
    const status = complete ? "received" : "partially_received";
    await tx.purchase_orders.update({ where: { id: po.id }, data: { status, updated_at: new Date() } });
    return { receipt, status, productIds: after.map((i) => i.product_id) };
  });

  await inv.resetLowStockFlags(result.productIds);
  await audit(req, "po.receive", {
    entity: "purchase_order", entityId: req.params.id,
    changes: { receipt: result.receipt.receipt_number, status: result.status, landed_cost: landed, lines: lines.map((l) => ({ item: l.item_id, qty: Number(l.quantity) })) },
  });
  res.json({
    message: `Received into stock (${result.receipt.receipt_number})${landed > 0 ? ` with ${landed.toFixed(2)} landed cost` : ""}. Order is now ${result.status.replace("_", " ")}.`,
    data: shapePo(await findOwnPo(req)),
  });
};

// POST /company/purchase-orders/:id/close  -> stop expecting the rest of a partially received order
const closePo = async (req, res) => {
  const po = await findOwnPo(req);
  if (!["sent", "partially_received"].includes(po.status)) throw new HttpError(400, `A ${po.status} purchase order can't be closed`);
  await prisma.purchase_orders.update({ where: { id: po.id }, data: { status: "closed", updated_at: new Date() } });
  await audit(req, "po.close", { entity: "purchase_order", entityId: po.id });
  res.json({ message: `${po.po_number} closed`, data: shapePo(await findOwnPo(req)) });
};

// POST /company/purchase-orders/:id/cancel -> only if nothing was received yet
const cancelPo = async (req, res) => {
  const po = await findOwnPo(req);
  if (!["draft", "sent"].includes(po.status)) {
    throw new HttpError(400, po.status === "partially_received" ? "Part of this order was received. Close it instead." : `A ${po.status} purchase order can't be cancelled`);
  }
  await prisma.purchase_orders.update({ where: { id: po.id }, data: { status: "cancelled", updated_at: new Date() } });
  await audit(req, "po.cancel", { entity: "purchase_order", entityId: po.id });
  res.json({ message: `${po.po_number} cancelled`, data: shapePo(await findOwnPo(req)) });
};

// POST /company/purchase-orders/from-suggestions
// { orders: [{ supplier_id, warehouse_id?, items: [{ product_id, quantity, unit_cost? }] }] } -> draft POs
const createFromSuggestions = async (req, res) => {
  const orders = Array.isArray(req.body.orders) ? req.body.orders : [];
  if (!orders.length) throw new HttpError(400, "Nothing to order");
  const created = [];
  for (const o of orders) {
    const supplier = await findOwnSupplier(req, o.supplier_id);
    const warehouse = o.warehouse_id
      ? await inv.assertWarehouse(prisma, req.company.id, toId(o.warehouse_id, "warehouse_id"))
      : await inv.getDefaultWarehouse(prisma, req.company.id);
    const lines = await buildLines(req.company.id, supplier.id, o.items);
    const po = await prisma.$transaction(async (tx) =>
      tx.purchase_orders.create({
        data: {
          company_id: req.company.id, supplier_id: supplier.id, warehouse_id: warehouse.id,
          po_number: await nextNumber(tx, req.company.id, "PO"), currency: supplier.currency || "USD",
          created_by: BigInt(req.user.id), notes: "Created from reorder suggestions",
          ...totalsFor(lines, 0, 0), purchase_order_items: { create: lines },
        },
      }),
    );
    created.push({ id: po.id, po_number: po.po_number, supplier: supplier.name, total: Number(po.total_amount) });
    await audit(req, "po.create", { entity: "purchase_order", entityId: po.id, changes: { number: po.po_number, from: "reorder" } });
  }
  res.status(201).json({ message: `${created.length} draft purchase order(s) created`, data: created });
};

module.exports = {
  listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier, upsertSupplierProduct, removeSupplierProduct,
  listPos, getPo, createPo, updatePo, sendPo, receivePo, closePo, cancelPo, createFromSuggestions,
};
