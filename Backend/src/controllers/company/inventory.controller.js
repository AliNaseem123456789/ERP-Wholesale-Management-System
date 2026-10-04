// Warehouses, bins, stock levels, adjustments, transfers and inventory reports for one company.
const { Prisma } = require("@prisma/client");
const prisma = require("../../prisma");
const { HttpError, toId, toPositiveInt } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { nextNumber } = require("../../services/sequences");
const inv = require("../../services/inventory");
const gl = require("../../services/postings");

const userId = (req) => BigInt(req.user.id);
const text = (v, max = 255) => (v === undefined ? undefined : v === null || v === "" ? null : String(v).trim().slice(0, max));

// ---- settings ------------------------------------------------------------------------

const getSettings = async (req, res) => {
  const s = req.company.settings?.inventory || {};
  res.json({ data: { tracking: s.tracking === true, lowStockEmails: s.lowStockEmails !== false } });
};

// PATCH /company/inventory/settings { tracking?, lowStockEmails? }
const updateSettings = async (req, res) => {
  const current = req.company.settings || {};
  const inventory = { ...(current.inventory || {}) };
  if (req.body.tracking !== undefined) inventory.tracking = !!req.body.tracking;
  if (req.body.lowStockEmails !== undefined) inventory.lowStockEmails = !!req.body.lowStockEmails;
  await prisma.companies.update({
    where: { id: req.company.id },
    data: { settings: { ...current, inventory }, updated_at: new Date() },
  });
  await audit(req, "inventory.settings", { entity: "company", entityId: req.company.id, changes: inventory });
  res.json({
    message: inventory.tracking
      ? "Inventory tracking is ON: orders now reserve and deduct stock."
      : "Inventory tracking is OFF: orders don't change stock.",
    data: { tracking: inventory.tracking === true, lowStockEmails: inventory.lowStockEmails !== false },
  });
};

// ---- warehouses & bins -----------------------------------------------------------------

const WAREHOUSE_FIELDS = ["name", "code", "address_line1", "address_line2", "city", "state", "postal_code", "country", "phone"];
const warehouseData = (body) => {
  const data = {};
  for (const f of WAREHOUSE_FIELDS) if (body[f] !== undefined) data[f] = text(body[f]);
  if (data.code) data.code = data.code.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
  if (data.name === null || data.code === null || data.code === "") throw new HttpError(400, "Name and code are required");
  return data;
};

const listWarehouses = async (req, res) => {
  await inv.getDefaultWarehouse(prisma, req.company.id); // make sure there is at least one
  const warehouses = await prisma.warehouses.findMany({
    where: { company_id: req.company.id, ...(req.query.active === "true" ? { is_active: true } : {}) },
    orderBy: [{ is_default: "desc" }, { name: "asc" }],
    include: { _count: { select: { warehouse_bins: true } } },
  });
  const totals = await prisma.inventory_levels.groupBy({
    by: ["warehouse_id"],
    where: { company_id: req.company.id },
    _sum: { on_hand: true, reserved: true },
    _count: { _all: true },
  });
  const byWh = new Map(totals.map((t) => [String(t.warehouse_id), t]));
  res.json({
    data: warehouses.map(({ _count, ...w }) => {
      const t = byWh.get(String(w.id));
      return { ...w, binCount: _count.warehouse_bins, units: t?._sum.on_hand || 0, reserved: t?._sum.reserved || 0 };
    }),
  });
};

const createWarehouse = async (req, res) => {
  const data = warehouseData(req.body);
  if (!data.name || !data.code) throw new HttpError(400, "Name and code are required");
  const wh = await prisma.$transaction(async (tx) => {
    if (req.body.is_default) await tx.warehouses.updateMany({ where: { company_id: req.company.id }, data: { is_default: false } });
    return tx.warehouses.create({ data: { ...data, company_id: req.company.id, is_default: !!req.body.is_default } });
  });
  await audit(req, "warehouse.create", { entity: "warehouse", entityId: wh.id, changes: data });
  res.status(201).json({ message: "Warehouse created", data: wh });
};

const findOwnWarehouse = async (req, id = req.params.id) => {
  const wh = await prisma.warehouses.findFirst({ where: { id: toId(id), company_id: req.company.id } });
  if (!wh) throw new HttpError(404, "Warehouse not found");
  return wh;
};

const updateWarehouse = async (req, res) => {
  const wh = await findOwnWarehouse(req);
  const data = warehouseData(req.body);
  if (req.body.is_active === false || req.body.is_active === "false") {
    if (wh.is_default) throw new HttpError(400, "Make another warehouse the default before deactivating this one");
    const stock = await prisma.inventory_levels.aggregate({ where: { warehouse_id: wh.id }, _sum: { on_hand: true } });
    if ((stock._sum.on_hand || 0) > 0) throw new HttpError(400, "Move or adjust out all stock before deactivating this warehouse");
    data.is_active = false;
  } else if (req.body.is_active === true) {
    data.is_active = true;
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (req.body.is_default === true) {
      if (wh.is_active === false && data.is_active !== true) throw new HttpError(400, "An inactive warehouse can't be the default");
      await tx.warehouses.updateMany({ where: { company_id: req.company.id }, data: { is_default: false } });
      data.is_default = true;
    }
    return tx.warehouses.update({ where: { id: wh.id }, data: { ...data, updated_at: new Date() } });
  });
  await audit(req, "warehouse.update", { entity: "warehouse", entityId: wh.id, changes: data });
  res.json({ message: "Warehouse updated", data: updated });
};

const listBins = async (req, res) => {
  const wh = await findOwnWarehouse(req);
  const bins = await prisma.warehouse_bins.findMany({ where: { warehouse_id: wh.id }, orderBy: { code: "asc" } });
  res.json({ data: bins });
};

const createBin = async (req, res) => {
  const wh = await findOwnWarehouse(req);
  const code = text(req.body.code, 64);
  if (!code) throw new HttpError(400, "Bin code is required");
  const bin = await prisma.warehouse_bins.create({
    data: { warehouse_id: wh.id, code: code.toUpperCase(), description: text(req.body.description) },
  });
  await audit(req, "bin.create", { entity: "bin", entityId: bin.id, changes: { warehouse: wh.code, code: bin.code } });
  res.status(201).json({ message: "Bin created", data: bin });
};

const updateBin = async (req, res) => {
  const bin = await prisma.warehouse_bins.findFirst({
    where: { id: toId(req.params.binId), warehouses: { is: { company_id: req.company.id } } },
  });
  if (!bin) throw new HttpError(404, "Bin not found");
  const data = {};
  if (req.body.code !== undefined) data.code = String(text(req.body.code, 64) || "").toUpperCase() || bin.code;
  if (req.body.description !== undefined) data.description = text(req.body.description);
  if (req.body.is_active !== undefined) data.is_active = !!req.body.is_active;
  const updated = await prisma.warehouse_bins.update({ where: { id: bin.id }, data });
  res.json({ message: "Bin updated", data: updated });
};

// ---- stock overview ----------------------------------------------------------------------

// GET /company/inventory?warehouse_id&search&filter=all|low|out|in&page&limit
// One row per product; products with flavours also get a per-flavour breakdown (variants).
const stockList = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const search = String(req.query.search || "").trim();
  const warehouseId = req.query.warehouse_id ? toId(req.query.warehouse_id, "warehouse_id") : null;
  const filter = String(req.query.filter || "all");

  const whFilter = warehouseId ? Prisma.sql`AND l.warehouse_id = ${warehouseId}` : Prisma.empty;
  const searchFilter = search
    ? Prisma.sql`AND (p.title ILIKE ${`%${search}%`} OR p.brand ILIKE ${`%${search}%`} OR p.sku ILIKE ${`%${search}%`} OR p.barcode = ${search}
        OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND (v.barcode = ${search} OR v.sku ILIKE ${search} OR v.flavor ILIKE ${`%${search}%`})))`
    : Prisma.empty;

  const products = await prisma.$queryRaw`
    SELECT p.id, p.title, p.brand, p.sku, p.barcode, p.unit, p.is_active, p.price, p.flavors,
           p.cost_price, p.reorder_point, p.reorder_quantity, p.preferred_supplier_id
    FROM products p
    WHERE p.company_id = ${req.company.id} ${searchFilter}
    ORDER BY p.title ASC`;
  const levels = products.length
    ? await prisma.$queryRaw`
        SELECT l.product_id, l.flavor, SUM(l.on_hand)::int AS on_hand, SUM(l.reserved)::int AS reserved
        FROM inventory_levels l
        WHERE l.company_id = ${req.company.id} ${whFilter}
        GROUP BY l.product_id, l.flavor`
    : [];
  const byProduct = new Map();
  for (const l of levels) {
    const k = String(l.product_id);
    if (!byProduct.has(k)) byProduct.set(k, []);
    byProduct.get(k).push(l);
  }

  let items = products.map((r) => {
    const rows = byProduct.get(String(r.id)) || [];
    const flavors = inv.flavorsOf(r);
    const on_hand = rows.reduce((s, x) => s + x.on_hand, 0);
    const reserved = rows.reduce((s, x) => s + x.reserved, 0);
    const cost = Number(r.cost_price || 0);
    let variants = null;
    let unassigned = 0;
    let available;
    let low;
    if (flavors.length) {
      variants = flavors.map((f) => {
        const x = rows.find((y) => y.flavor === f) || { on_hand: 0, reserved: 0 };
        return { flavor: f, on_hand: x.on_hand, reserved: x.reserved, available: x.on_hand - x.reserved };
      });
      unassigned = rows.filter((y) => y.flavor === "").reduce((s, y) => s + y.on_hand, 0);
      available = variants.reduce((s, v) => s + v.available, 0);
      low = r.reorder_point > 0 && variants.some((v) => v.available <= r.reorder_point);
    } else {
      available = on_hand - reserved;
      low = r.reorder_point > 0 && available <= r.reorder_point;
    }
    const { flavors: _f, ...rest } = r;
    return {
      ...rest,
      on_hand,
      reserved,
      available,
      variants,
      unassigned,
      stock_value: Math.round(on_hand * cost * 100) / 100,
      status: on_hand <= 0 ? "out" : low ? "low" : "ok",
    };
  });
  if (filter === "low") items = items.filter((i) => i.status === "low" || (i.status === "out" && i.reorder_point > 0));
  if (filter === "out") items = items.filter((i) => i.status === "out");
  if (filter === "in") items = items.filter((i) => i.on_hand > 0);

  const summary = items.reduce(
    (s, i) => ({
      products: s.products + 1,
      units: s.units + i.on_hand,
      value: s.value + i.stock_value,
      low: s.low + (i.status === "low" ? 1 : 0),
      out: s.out + (i.status === "out" ? 1 : 0),
    }),
    { products: 0, units: 0, value: 0, low: 0, out: 0 },
  );
  summary.value = Math.round(summary.value * 100) / 100;

  res.json({
    data: items.slice((page - 1) * limit, page * limit),
    summary,
    totalCount: items.length,
    totalPages: Math.ceil(items.length / limit),
    currentPage: page,
  });
};

// GET /company/inventory/products/:id -> levels per warehouse, lots, recent movements, incoming POs
const productStock = async (req, res) => {
  const product = await inv.assertProduct(prisma, req.company.id, toId(req.params.id));
  const [levels, lots, movements, incoming] = await Promise.all([
    prisma.inventory_levels.findMany({
      where: { product_id: product.id, company_id: req.company.id },
      include: { warehouses: { select: { id: true, name: true, code: true } } },
      orderBy: [{ warehouse_id: "asc" }, { flavor: "asc" }],
    }),
    prisma.inventory_lots.findMany({
      where: { product_id: product.id, company_id: req.company.id, quantity: { gt: 0 } },
      include: { warehouses: { select: { code: true, name: true } }, warehouse_bins: { select: { code: true } } },
      orderBy: [{ expiry_date: { sort: "asc", nulls: "last" } }, { received_at: "asc" }],
    }),
    prisma.stock_movements.findMany({
      where: { product_id: product.id, company_id: req.company.id },
      orderBy: { id: "desc" },
      take: 50,
      include: { warehouses: { select: { code: true } }, users: { select: { email: true } }, inventory_lots: { select: { lot_number: true } } },
    }),
    prisma.purchase_order_items.findMany({
      where: { product_id: product.id, purchase_orders: { is: { company_id: req.company.id, status: { in: ["sent", "partially_received"] } } } },
      select: {
        quantity_ordered: true, quantity_received: true, flavor: true,
        purchase_orders: { select: { id: true, po_number: true, expected_date: true, suppliers: { select: { name: true } } } },
      },
    }),
  ]);
  const variants = await prisma.product_variants.findMany({ where: { product_id: product.id } });
  res.json({
    data: {
      product,
      flavors: inv.flavorsOf(product),
      variants,
      levels: levels.map(({ warehouses, ...l }) => ({ ...l, warehouse: warehouses, available: l.on_hand - l.reserved })),
      lots: lots.map(({ warehouses, warehouse_bins, ...l }) => ({ ...l, warehouse: warehouses, bin: warehouse_bins?.code || null })),
      movements: movements.map(({ warehouses, users, inventory_lots, ...m }) => ({
        ...m, warehouse: warehouses.code, user: users?.email || null, lot_number: inventory_lots?.lot_number || null,
      })),
      incoming: incoming.map((i) => ({
        po_id: i.purchase_orders.id,
        po_number: i.purchase_orders.po_number,
        supplier: i.purchase_orders.suppliers.name,
        expected_date: i.purchase_orders.expected_date,
        flavor: i.flavor || null,
        outstanding: i.quantity_ordered - i.quantity_received,
      })),
    },
  });
};

// GET /company/inventory/lookup?code=  (barcode or SKU of a product or of one of its flavours, for scanners)
const lookup = async (req, res) => {
  const code = String(req.query.code || "").trim();
  if (!code) throw new HttpError(400, "Code is required");
  const product = await prisma.products.findFirst({
    where: { company_id: req.company.id, OR: [{ barcode: code }, { sku: { equals: code, mode: "insensitive" } }] },
  });
  if (product) return res.json({ data: { ...product, flavor: null } });
  const variant = await prisma.product_variants.findFirst({
    where: { products: { is: { company_id: req.company.id } }, OR: [{ barcode: code }, { sku: { equals: code, mode: "insensitive" } }] },
    include: { products: true },
  });
  if (!variant) throw new HttpError(404, `No product with barcode or SKU "${code}"`);
  res.json({ data: { ...variant.products, flavor: variant.flavor } });
};

// ---- adjustments & stock counts ------------------------------------------------------------

const ADJUST_REASONS = ["opening_balance", "stock_count", "received", "damaged", "expired", "lost", "found", "returned", "sample", "other"];

// POST /company/inventory/adjust
// { warehouse_id, product_id, mode: "add"|"remove"|"set", quantity, reason, notes?, lot_number?, expiry_date?, bin_id?, unit_cost?, lot_id? }
const adjust = async (req, res) => {
  const companyId = req.company.id;
  const mode = String(req.body.mode || "add");
  if (!["add", "remove", "set"].includes(mode)) throw new HttpError(400, "Mode must be add, remove or set");
  const reason = String(req.body.reason || (mode === "set" ? "stock_count" : "other"));
  if (!ADJUST_REASONS.includes(reason)) throw new HttpError(400, `Reason must be one of: ${ADJUST_REASONS.join(", ")}`);
  const warehouse = await inv.assertWarehouse(prisma, companyId, toId(req.body.warehouse_id, "warehouse_id"));
  const product = await inv.assertProduct(prisma, companyId, toId(req.body.product_id, "product_id"));
  // Adding stock needs a flavour; removing/counting may target stock not yet assigned to one.
  const flavor = inv.resolveFlavor(product, req.body.flavor, { allowUnassigned: mode !== "add" });
  const quantity = mode === "set" ? Number(req.body.quantity) : toPositiveInt(req.body.quantity);
  if (mode === "set" && (!Number.isInteger(quantity) || quantity < 0)) throw new HttpError(400, "Counted quantity must be 0 or more");

  let binId = null;
  if (req.body.bin_id) {
    const bin = await prisma.warehouse_bins.findFirst({ where: { id: toId(req.body.bin_id, "bin_id"), warehouse_id: warehouse.id } });
    if (!bin) throw new HttpError(400, "That bin isn't in this warehouse");
    binId = bin.id;
  }
  const unitCost = req.body.unit_cost !== undefined && req.body.unit_cost !== "" && req.body.unit_cost !== null ? Number(req.body.unit_cost) : null;
  if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) throw new HttpError(400, "Unit cost must be 0 or more");

  const common = {
    companyId, warehouseId: warehouse.id, productId: product.id, flavor, type: "adjustment", reason,
    referenceType: "adjustment", notes: text(req.body.notes, 2000), userId: userId(req), productName: product.title,
  };

  const result = await prisma.$transaction(async (tx) => {
    let delta = quantity;
    if (mode === "set") {
      const level = await inv.lockLevel(tx, companyId, warehouse.id, product.id, flavor);
      delta = quantity - level.on_hand;
    } else if (mode === "remove") {
      delta = -quantity;
    }
    let value = 0;
    if (delta > 0) {
      if (!flavor && inv.hasFlavors(product)) throw new HttpError(400, `Choose a flavour of "${product.title}"`);
      await inv.receive(tx, {
        ...common, quantity: delta, unitCost, lotNumber: text(req.body.lot_number, 64), expiryDate: req.body.expiry_date || null,
        binId, updateCost: unitCost !== null,
      });
      value = delta * Number(unitCost ?? product.cost_price ?? 0);
    } else if (delta < 0) {
      const chunks = await inv.issue(tx, { ...common, quantity: -delta, lotId: req.body.lot_id ? toId(req.body.lot_id, "lot_id") : null });
      value = -gl.chunksValue(chunks, product.cost_price);
    }
    await gl.postStockAdjustment(tx, { companyId, value: Math.round(value * 100) / 100, reason, productTitle: inv.label(product.title, flavor), userId: userId(req) });
    const level = await tx.inventory_levels.findUnique({
      where: { warehouse_id_product_id_flavor: { warehouse_id: warehouse.id, product_id: product.id, flavor } },
    });
    return { delta, level };
  });

  await audit(req, "inventory.adjust", {
    entity: "product", entityId: product.id,
    changes: { warehouse: warehouse.code, flavor: flavor || null, mode, quantity, delta: result.delta, reason },
  });
  if (result.delta < 0) await inv.checkLowStock(companyId, [product.id]);
  else await inv.resetLowStockFlags([product.id]);

  res.json({
    message: result.delta === 0 ? "No change: the count matches the system" : `Stock ${result.delta > 0 ? "increased" : "decreased"} by ${Math.abs(result.delta)}`,
    data: { ...result.level, available: (result.level?.on_hand || 0) - (result.level?.reserved || 0) },
  });
};

// POST /company/inventory/reassign { warehouse_id, product_id, from_flavor?, to_flavor, quantity }
// Moves stock between flavours in one warehouse, e.g. stock counted before flavours were tracked ("" -> "Mango").
const reassignFlavor = async (req, res) => {
  const companyId = req.company.id;
  const warehouse = await inv.assertWarehouse(prisma, companyId, toId(req.body.warehouse_id, "warehouse_id"));
  const product = await inv.assertProduct(prisma, companyId, toId(req.body.product_id, "product_id"));
  if (!inv.hasFlavors(product)) throw new HttpError(400, `"${product.title}" has no flavours`);
  const from = inv.resolveFlavor(product, req.body.from_flavor, { allowUnassigned: true });
  const to = inv.resolveFlavor(product, req.body.to_flavor);
  if (from === to) throw new HttpError(400, "Choose a different flavour");
  const quantity = toPositiveInt(req.body.quantity);
  await prisma.$transaction(async (tx) => {
    const ref = { referenceType: "adjustment", userId: userId(req), reason: "flavour_reassign", notes: `${from || "unassigned"} -> ${to}` };
    const chunks = await inv.issue(tx, { ...ref, companyId, warehouseId: warehouse.id, productId: product.id, flavor: from, quantity, type: "adjustment", productName: product.title });
    for (const c of chunks) {
      await inv.receive(tx, {
        ...ref, companyId, warehouseId: warehouse.id, productId: product.id, flavor: to, quantity: c.quantity, type: "adjustment",
        lotNumber: c.lot.lot_number, expiryDate: c.lot.expiry_date ? c.lot.expiry_date.toISOString().slice(0, 10) : null,
        binId: c.lot.bin_id, unitCost: c.lot.unit_cost != null ? Number(c.lot.unit_cost) : null, updateCost: false,
      });
    }
  });
  await audit(req, "inventory.reassign", { entity: "product", entityId: product.id, changes: { warehouse: warehouse.code, from: from || null, to, quantity } });
  res.json({ message: `${quantity} moved to ${to}` });
};

// ---- transfers ------------------------------------------------------------------------------

const lotChunk = (c) => ({
  lot_number: c.lot.lot_number,
  expiry_date: c.lot.expiry_date ? c.lot.expiry_date.toISOString().slice(0, 10) : null,
  unit_cost: c.lot.unit_cost != null ? Number(c.lot.unit_cost) : null,
  quantity: c.quantity,
});

// Puts the given lot chunks (or the first `limit` units of them) into a warehouse, keeping lot number, expiry and cost.
const putLots = async (tx, { companyId, warehouseId, productId, flavor, chunks, limit = Infinity, binId = null, ref, type = "transfer_in" }) => {
  let left = limit;
  for (const c of chunks) {
    if (left <= 0) break;
    const q = Math.min(left, c.quantity);
    if (q <= 0) continue;
    await inv.receive(tx, {
      ...ref, companyId, warehouseId, productId, flavor, quantity: q, type,
      lotNumber: c.lot_number, expiryDate: c.expiry_date, binId, unitCost: c.unit_cost, updateCost: false,
    });
    left -= q;
  }
};

/**
 * POST /company/inventory/transfers
 * { from_warehouse_id, to_warehouse_id, items: [{ product_id, flavor?, quantity }], notes?,
 *   in_transit?: true, expected_date?, carrier?, tracking_number? }
 * Without in_transit the stock moves at once ("completed").
 * With in_transit the stock leaves the source now and arrives when the destination receives it.
 */
const createTransfer = async (req, res) => {
  const companyId = req.company.id;
  const from = await inv.assertWarehouse(prisma, companyId, toId(req.body.from_warehouse_id, "from_warehouse_id"));
  const to = await inv.assertWarehouse(prisma, companyId, toId(req.body.to_warehouse_id, "to_warehouse_id"));
  if (from.id === to.id) throw new HttpError(400, "Choose two different warehouses");
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw new HttpError(400, "Add at least one product");
  const inTransit = req.body.in_transit === true || req.body.in_transit === "true";
  const lines = [];
  for (const i of items) {
    const product = await inv.assertProduct(prisma, companyId, toId(i.product_id, "product_id"));
    lines.push({ product, flavor: inv.resolveFlavor(product, i.flavor, { allowUnassigned: true }), quantity: toPositiveInt(i.quantity) });
  }

  const transfer = await prisma.$transaction(async (tx) => {
    const t = await tx.stock_transfers.create({
      data: {
        company_id: companyId,
        transfer_number: await nextNumber(tx, companyId, "TR"),
        from_warehouse_id: from.id,
        to_warehouse_id: to.id,
        status: inTransit ? "in_transit" : "completed",
        shipped_at: new Date(),
        received_at: inTransit ? null : new Date(),
        expected_date: req.body.expected_date ? new Date(`${String(req.body.expected_date).slice(0, 10)}T00:00:00Z`) : null,
        carrier: text(req.body.carrier),
        tracking_number: text(req.body.tracking_number),
        notes: text(req.body.notes, 2000),
        created_by: userId(req),
      },
    });
    for (const l of lines) {
      const ref = { referenceType: "transfer", referenceId: t.id, userId: userId(req), notes: t.transfer_number };
      const chunks = (
        await inv.issue(tx, {
          ...ref, companyId, warehouseId: from.id, productId: l.product.id, flavor: l.flavor, quantity: l.quantity,
          type: "transfer_out", productName: l.product.title,
        })
      ).map(lotChunk);
      if (!inTransit) {
        await putLots(tx, { companyId, warehouseId: to.id, productId: l.product.id, flavor: l.flavor, chunks, ref });
      }
      await tx.stock_transfer_items.create({
        data: {
          stock_transfer_id: t.id, product_id: l.product.id, flavor: l.flavor, quantity: l.quantity,
          quantity_received: inTransit ? null : l.quantity, lots: chunks,
        },
      });
    }
    return t;
  });

  await audit(req, "inventory.transfer", {
    entity: "transfer", entityId: transfer.id,
    changes: { number: transfer.transfer_number, from: from.code, to: to.code, in_transit: inTransit, lines: lines.map((l) => ({ product: l.product.id, flavor: l.flavor || null, qty: l.quantity })) },
  });
  res.status(201).json({
    message: inTransit ? `Transfer ${transfer.transfer_number} shipped: in transit to ${to.code}` : `Transfer ${transfer.transfer_number} completed`,
    data: transfer,
  });
};

const lockTransfer = async (tx, req) => {
  const [row] = await tx.$queryRaw`SELECT id, status FROM stock_transfers WHERE id = ${toId(req.params.id)} AND company_id = ${req.company.id} FOR UPDATE`;
  if (!row) throw new HttpError(404, "Transfer not found");
  if (row.status !== "in_transit") throw new HttpError(400, `This transfer is ${row.status.replace("_", " ")}`);
  return tx.stock_transfers.findUnique({ where: { id: row.id }, include: { stock_transfer_items: { include: { products: { select: { title: true } } } } } });
};

/**
 * POST /company/inventory/transfers/:id/receive { lines?: [{ item_id, quantity_received }], bin_id?, notes? }
 * Default: everything arrived. Units not received are recorded as lost in transit.
 */
const receiveTransfer = async (req, res) => {
  const companyId = req.company.id;
  const result = await prisma.$transaction(async (tx) => {
    const t = await lockTransfer(tx, req);
    let binId = null;
    if (req.body.bin_id) {
      const bin = await tx.warehouse_bins.findFirst({ where: { id: toId(req.body.bin_id, "bin_id"), warehouse_id: t.to_warehouse_id } });
      if (!bin) throw new HttpError(400, "That bin isn't in the receiving warehouse");
      binId = bin.id;
    }
    const input = Array.isArray(req.body.lines) ? req.body.lines : [];
    let lost = 0;
    let lostValue = 0;
    for (const item of t.stock_transfer_items) {
      const given = input.find((l) => String(l.item_id) === String(item.id));
      const qty = given ? Number(given.quantity_received) : item.quantity;
      if (!Number.isInteger(qty) || qty < 0 || qty > item.quantity) throw new HttpError(400, `Received quantity of "${item.products.title}" must be between 0 and ${item.quantity}`);
      const ref = { referenceType: "transfer", referenceId: t.id, userId: userId(req), notes: t.transfer_number };
      await putLots(tx, { companyId, warehouseId: t.to_warehouse_id, productId: item.product_id, flavor: item.flavor, chunks: item.lots || [], limit: qty, binId, ref });
      await tx.stock_transfer_items.update({ where: { id: item.id }, data: { quantity_received: qty } });
      lost += item.quantity - qty;
      // value of the units that never arrived: the last lots shipped beyond what was received
      let skip = qty;
      for (const c of item.lots || []) {
        const take = Math.max(0, c.quantity - skip);
        skip = Math.max(0, skip - c.quantity);
        lostValue += take * Number(c.unit_cost || 0);
      }
    }
    if (lostValue > 0) await gl.postTransferLoss(tx, { companyId, transfer: t, value: Math.round(lostValue * 100) / 100, userId: userId(req) });
    const notes = req.body.notes ? [t.notes, `Received: ${text(req.body.notes, 1000)}`].filter(Boolean).join("\n") : t.notes;
    const updated = await tx.stock_transfers.update({
      where: { id: t.id },
      data: { status: "received", received_at: new Date(), received_by: userId(req), notes },
    });
    return { t: updated, lost, productIds: t.stock_transfer_items.map((i) => i.product_id) };
  }, { timeout: 30000 });
  await inv.resetLowStockFlags(result.productIds);
  await audit(req, "inventory.transfer.receive", { entity: "transfer", entityId: result.t.id, changes: { number: result.t.transfer_number, lost: result.lost } });
  res.json({ message: `Transfer ${result.t.transfer_number} received${result.lost ? `. ${result.lost} unit(s) recorded as lost in transit.` : ""}`, data: result.t });
};

// POST /company/inventory/transfers/:id/cancel -> an in-transit transfer goes back to the source warehouse
const cancelTransfer = async (req, res) => {
  const companyId = req.company.id;
  const t = await prisma.$transaction(async (tx) => {
    const tr = await lockTransfer(tx, req);
    for (const item of tr.stock_transfer_items) {
      const ref = { referenceType: "transfer", referenceId: tr.id, userId: userId(req), notes: `${tr.transfer_number} cancelled`, reason: "transfer_cancelled" };
      await putLots(tx, { companyId, warehouseId: tr.from_warehouse_id, productId: item.product_id, flavor: item.flavor, chunks: item.lots || [], ref });
    }
    return tx.stock_transfers.update({ where: { id: tr.id }, data: { status: "cancelled", received_at: new Date(), received_by: userId(req) } });
  }, { timeout: 30000 });
  await audit(req, "inventory.transfer.cancel", { entity: "transfer", entityId: t.id, changes: { number: t.transfer_number } });
  res.json({ message: `Transfer ${t.transfer_number} cancelled; the stock is back in the source warehouse`, data: t });
};

const listTransfers = async (req, res) => {
  const transfers = await prisma.stock_transfers.findMany({
    where: { company_id: req.company.id, ...(req.query.status ? { status: String(req.query.status) } : {}) },
    orderBy: { id: "desc" },
    take: 100,
    include: {
      from_warehouse: { select: { id: true, code: true, name: true } },
      to_warehouse: { select: { id: true, code: true, name: true } },
      users: { select: { email: true } },
      stock_transfer_items: { include: { products: { select: { title: true, sku: true } } } },
    },
  });
  res.json({
    data: transfers.map((t) => ({
      ...t,
      value: Math.round(
        t.stock_transfer_items.reduce((s, i) => s + (i.lots || []).reduce((a, c) => a + c.quantity * Number(c.unit_cost || 0), 0), 0) * 100,
      ) / 100,
      lost_units: t.status === "received" ? t.stock_transfer_items.reduce((s, i) => s + (i.quantity - (i.quantity_received ?? i.quantity)), 0) : 0,
    })),
  });
};

// ---- reports ----------------------------------------------------------------------------------

// GET /company/inventory/movements?product_id&warehouse_id&type&from&to&page
const movements = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const take = 100;
  const where = {
    company_id: req.company.id,
    ...(req.query.product_id ? { product_id: toId(req.query.product_id, "product_id") } : {}),
    ...(req.query.warehouse_id ? { warehouse_id: toId(req.query.warehouse_id, "warehouse_id") } : {}),
    ...(req.query.type ? { type: String(req.query.type) } : {}),
    ...(req.query.from || req.query.to
      ? { created_at: { ...(req.query.from ? { gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { lte: new Date(`${req.query.to}T23:59:59Z`) } : {}) } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.stock_movements.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * take,
      take,
      include: {
        products: { select: { title: true, sku: true } },
        warehouses: { select: { code: true } },
        users: { select: { email: true } },
        inventory_lots: { select: { lot_number: true, expiry_date: true } },
      },
    }),
    prisma.stock_movements.count({ where }),
  ]);
  res.json({
    data: rows.map(({ products, warehouses, users, inventory_lots, ...m }) => ({
      ...m, product: products, warehouse: warehouses.code, user: users?.email || null,
      lot_number: inventory_lots?.lot_number || null, expiry_date: inventory_lots?.expiry_date || null,
    })),
    total,
    totalPages: Math.ceil(total / take),
    page,
  });
};

// GET /company/inventory/expiring?days=60  (includes already expired stock)
const expiring = async (req, res) => {
  const days = Math.min(3650, Math.max(0, parseInt(req.query.days, 10) || 60));
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const lots = await prisma.inventory_lots.findMany({
    where: { company_id: req.company.id, quantity: { gt: 0 }, expiry_date: { not: null, lte: until } },
    orderBy: { expiry_date: "asc" },
    include: {
      products: { select: { id: true, title: true, sku: true, cost_price: true } },
      warehouses: { select: { code: true, name: true } },
      warehouse_bins: { select: { code: true } },
    },
  });
  const today = new Date(new Date().toISOString().slice(0, 10));
  res.json({
    data: lots.map(({ products, warehouses, warehouse_bins, ...l }) => ({
      ...l,
      product: products,
      warehouse: warehouses,
      bin: warehouse_bins?.code || null,
      days_left: Math.round((l.expiry_date.getTime() - today.getTime()) / 86400000),
      value: Math.round(l.quantity * Number(l.unit_cost ?? products.cost_price ?? 0) * 100) / 100,
    })),
  });
};

// GET /company/inventory/valuation -> stock value at moving average cost, per warehouse
const valuation = async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT w.id AS warehouse_id, w.code, w.name,
           COUNT(DISTINCT l.product_id) FILTER (WHERE l.on_hand > 0)::int AS products,
           COALESCE(SUM(l.on_hand), 0)::int AS units,
           COALESCE(SUM(l.on_hand * p.cost_price), 0)::float AS value
    FROM warehouses w
    LEFT JOIN inventory_levels l ON l.warehouse_id = w.id
    LEFT JOIN products p ON p.id = l.product_id
    WHERE w.company_id = ${req.company.id}
    GROUP BY w.id ORDER BY w.is_default DESC, w.name`;
  const totals = rows.reduce((t, r) => ({ units: t.units + r.units, value: t.value + r.value }), { units: 0, value: 0 });
  // Stock on the road between warehouses (left the source, not yet received), at the cost of the lots that left.
  const transit = await prisma.stock_transfer_items.findMany({
    where: { stock_transfers: { is: { company_id: req.company.id, status: "in_transit" } } },
    select: { quantity: true, lots: true },
  });
  const inTransit = transit.reduce(
    (t, i) => ({ units: t.units + i.quantity, value: t.value + (i.lots || []).reduce((a, c) => a + c.quantity * Number(c.unit_cost || 0), 0) }),
    { units: 0, value: 0 },
  );
  res.json({
    data: rows.map((r) => ({ ...r, value: Math.round(r.value * 100) / 100 })),
    in_transit: { units: inTransit.units, value: Math.round(inTransit.value * 100) / 100 },
    totals: { units: totals.units + inTransit.units, value: Math.round((totals.value + inTransit.value) * 100) / 100 },
  });
};

// GET /company/inventory/reorder-suggestions
// Products (or, for products with flavours, each flavour) whose available + incoming stock is at/below
// the reorder point, grouped by preferred supplier. Incoming = open purchase orders + transfers in transit.
const reorderSuggestions = async (req, res) => {
  const products = await prisma.products.findMany({
    where: { company_id: req.company.id, is_active: true, reorder_point: { gt: 0 } },
    select: { id: true, title: true, sku: true, unit: true, cost_price: true, reorder_point: true, reorder_quantity: true, preferred_supplier_id: true, flavors: true },
  });
  const ids = products.map((p) => p.id);
  const [byFlavor, poRows, transitRows] = await Promise.all([
    inv.availabilityByFlavor(ids),
    ids.length
      ? prisma.$queryRaw`
          SELECT i.product_id, i.flavor, SUM(i.quantity_ordered - i.quantity_received)::int AS qty
          FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.purchase_order_id
          WHERE po.company_id = ${req.company.id} AND po.status IN ('draft', 'sent', 'partially_received')
          GROUP BY i.product_id, i.flavor`
      : [],
    ids.length
      ? prisma.$queryRaw`
          SELECT i.product_id, i.flavor, SUM(i.quantity)::int AS qty
          FROM stock_transfer_items i JOIN stock_transfers t ON t.id = i.stock_transfer_id
          WHERE t.company_id = ${req.company.id} AND t.status = 'in_transit'
          GROUP BY i.product_id, i.flavor`
      : [],
  ]);
  const incomingBy = new Map();
  for (const r of [...poRows, ...transitRows]) {
    const k = inv.flavorKey(r.product_id, r.flavor);
    incomingBy.set(k, (incomingBy.get(k) || 0) + Number(r.qty));
  }

  const needed = [];
  for (const p of products) {
    const keys = inv.hasFlavors(p) ? inv.flavorsOf(p) : [""];
    for (const f of keys) {
      const k = inv.flavorKey(p.id, f);
      const available = byFlavor.get(k) ?? 0;
      const incoming = incomingBy.get(k) ?? 0;
      if (available + incoming <= p.reorder_point) needed.push({ ...p, flavor: f, available, incoming });
    }
  }

  const supplierIds = [...new Set(needed.map((r) => r.preferred_supplier_id).filter(Boolean))];
  const [suppliers, supplierPrices] = await Promise.all([
    prisma.suppliers.findMany({ where: { id: { in: supplierIds }, company_id: req.company.id }, select: { id: true, name: true, email: true } }),
    prisma.supplier_products.findMany({ where: { product_id: { in: [...new Set(needed.map((r) => r.id))] } } }),
  ]);
  const priceFor = (supplierId, productId) =>
    supplierPrices.find((sp) => String(sp.supplier_id) === String(supplierId) && String(sp.product_id) === String(productId));

  const groups = new Map();
  for (const r of needed) {
    const key = r.preferred_supplier_id ? String(r.preferred_supplier_id) : "none";
    if (!groups.has(key)) {
      const sup = suppliers.find((s) => String(s.id) === key);
      groups.set(key, { supplier: sup || null, items: [] });
    }
    const sp = r.preferred_supplier_id ? priceFor(r.preferred_supplier_id, r.id) : null;
    const suggested = r.reorder_quantity > 0 ? r.reorder_quantity : Math.max(1, r.reorder_point * 2 - r.available - r.incoming);
    groups.get(key).items.push({
      product_id: r.id, flavor: r.flavor || null, title: inv.label(r.title, r.flavor), sku: r.sku, unit: r.unit,
      available: r.available, incoming: r.incoming, reorder_point: r.reorder_point,
      suggested_quantity: suggested,
      unit_cost: Number(sp?.unit_cost ?? r.cost_price ?? 0),
      supplier_sku: sp?.supplier_sku || null,
    });
  }
  res.json({ data: [...groups.values()] });
};

module.exports = {
  getSettings, updateSettings,
  listWarehouses, createWarehouse, updateWarehouse, listBins, createBin, updateBin,
  stockList, productStock, lookup, adjust, ADJUST_REASONS,
  createTransfer, receiveTransfer, cancelTransfer, listTransfers, reassignFlavor, movements, expiring, valuation, reorderSuggestions,
};
