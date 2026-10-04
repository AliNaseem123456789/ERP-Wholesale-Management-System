// Warehouse scan station: look up a barcode/SKU, count stock, verify picks before shipping, and get the
// codes a purchase order expects (receiving itself uses the purchase order receive endpoint).
// Works with USB/Bluetooth scanners (they type the code + Enter) and phone cameras (in the browser).
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { audit } = require("../../services/audit");
const inv = require("../../services/inventory");
const { applyCount } = require("../../services/stockcount");

// Every code that identifies a product (and flavour): product SKU/barcode and each flavour's own SKU/barcode.
const codesFor = async (productIds) => {
  const ids = [...new Set(productIds.map(String))].map(BigInt);
  const [products, variants] = await Promise.all([
    prisma.products.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, barcode: true } }),
    prisma.product_variants.findMany({ where: { product_id: { in: ids } }, select: { product_id: true, flavor: true, sku: true, barcode: true } }),
  ]);
  const map = new Map(); // `${productId}:${flavor}` -> [codes]; `${productId}:*` -> product-level codes
  for (const p of products) map.set(`${p.id}:*`, [p.sku, p.barcode].filter(Boolean));
  for (const v of variants) map.set(`${v.product_id}:${v.flavor}`, [v.sku, v.barcode].filter(Boolean));
  return (productId, flavor) => [...(map.get(`${productId}:${flavor || ""}`) || []), ...(map.get(`${productId}:*`) || [])];
};

const resolveCode = async (companyId, code) => {
  const c = String(code || "").trim();
  if (!c) throw new HttpError(400, "Scan or type a code");
  const product = await prisma.products.findFirst({ where: { company_id: companyId, OR: [{ barcode: c }, { sku: { equals: c, mode: "insensitive" } }] } });
  if (product) return { product, flavor: null };
  const v = await prisma.product_variants.findFirst({
    where: { products: { is: { company_id: companyId } }, OR: [{ barcode: c }, { sku: { equals: c, mode: "insensitive" } }] },
    include: { products: true },
  });
  if (!v) throw new HttpError(404, `No product with barcode or SKU "${c}"`);
  return { product: v.products, flavor: v.flavor };
};

// GET /company/scan/lookup?code&warehouse_id
const lookup = async (req, res) => {
  const { product, flavor } = await resolveCode(req.company.id, req.query.code);
  const [levels, lots] = await Promise.all([
    prisma.inventory_levels.findMany({
      where: { product_id: product.id, ...(flavor !== null ? { flavor } : {}) },
      include: { warehouses: { select: { id: true, code: true, name: true } } },
      orderBy: [{ warehouse_id: "asc" }, { flavor: "asc" }],
    }),
    prisma.inventory_lots.findMany({
      where: { product_id: product.id, quantity: { gt: 0 }, ...(flavor !== null ? { flavor } : {}), ...(req.query.warehouse_id ? { warehouse_id: toId(req.query.warehouse_id, "warehouse_id") } : {}) },
      include: { warehouse_bins: { select: { code: true } }, warehouses: { select: { code: true } } },
      orderBy: [{ expiry_date: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: 50,
    }),
  ]);
  res.json({
    data: {
      product: { id: product.id, title: product.title, sku: product.sku, barcode: product.barcode, flavors: inv.flavorsOf(product), unit: product.unit, price: product.price, reorder_point: product.reorder_point, is_active: product.is_active },
      flavor,
      levels: levels.map((l) => ({ warehouse: l.warehouses, flavor: l.flavor, on_hand: l.on_hand, reserved: l.reserved, available: l.on_hand - l.reserved })),
      lots: lots.map((l) => ({ id: l.id, warehouse: l.warehouses?.code, bin: l.warehouse_bins?.code || null, lot_number: l.lot_number, expiry_date: l.expiry_date, flavor: l.flavor, quantity: l.quantity })),
    },
  });
};

// POST /company/scan/count { warehouse_id, lines: [{ product_id, flavor?, counted }], notes? }
// Sets each counted product/flavour to the counted quantity (only what was scanned).
const count = async (req, res) => {
  if (!inv.isInventoryTracked(req.company)) throw new HttpError(400, "Turn on inventory tracking first");
  const warehouse = await inv.assertWarehouse(prisma, req.company.id, toId(req.body.warehouse_id, "warehouse_id"));
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!lines.length) throw new HttpError(400, "Nothing counted yet");
  const results = await prisma.$transaction(async (tx) => {
    const out = [];
    const seen = new Set();
    for (const l of lines) {
      const product = await inv.assertProduct(tx, req.company.id, toId(l.product_id, "product_id"));
      const flavor = inv.resolveFlavor(product, l.flavor, { allowUnassigned: true });
      const key = `${product.id}:${flavor}`;
      if (seen.has(key)) throw new HttpError(400, `"${inv.label(product.title, flavor)}" is listed twice`);
      seen.add(key);
      const r = await applyCount(tx, {
        companyId: req.company.id, warehouse, product, flavor, counted: Number(l.counted), userId: req.user.id,
        notes: req.body.notes ? `Scan count: ${String(req.body.notes).slice(0, 200)}` : "Scan count",
      });
      out.push({ product_id: product.id, title: inv.label(product.title, flavor), before: r.before, counted: Number(l.counted), delta: r.delta });
    }
    return out;
  }, { timeout: 60000, maxWait: 10000 });
  const ids = results.map((r) => r.product_id);
  await inv.checkLowStock(req.company.id, ids);
  await inv.resetLowStockFlags(ids);
  const changed = results.filter((r) => r.delta);
  await audit(req, "inventory.scan_count", { entity: "warehouse", entityId: warehouse.id, changes: { lines: results.length, changed: changed.length } });
  res.json({ message: `Count saved for ${warehouse.code}: ${results.length} item(s), ${changed.length} adjusted`, data: results });
};

// GET /company/scan/orders/:id -> lines to pick with every code that matches each line
const orderForPacking = async (req, res) => {
  const order = await prisma.orders.findFirst({
    where: { id: toId(req.params.id), company_id: req.company.id },
    include: { order_items: { orderBy: { id: "asc" }, include: { products: { select: { id: true, title: true, sku: true } } } }, users: { select: { email: true } } },
  });
  if (!order) throw new HttpError(404, "Order not found");
  const codes = await codesFor(order.order_items.map((i) => i.product_id));
  res.json({
    data: {
      id: order.id, order_number: order.order_number, status: order.status, customer: order.business_name || order.users?.email, compliance: order.compliance,
      lines: order.order_items.map((i) => ({ order_item_id: i.id, product_id: i.product_id, title: inv.label(i.products?.title, i.flavor), sku: i.products?.sku, flavor: i.flavor || "", quantity: i.quantity, codes: codes(i.product_id, i.flavor) })),
    },
  });
};

// POST /company/scan/orders/:id/verify { scanned: [{ order_item_id, quantity }] } -> records a verified pack (all lines complete)
const verifyPack = async (req, res) => {
  const order = await prisma.orders.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id }, include: { order_items: true } });
  if (!order) throw new HttpError(404, "Order not found");
  const scanned = new Map((Array.isArray(req.body.scanned) ? req.body.scanned : []).map((s) => [String(s.order_item_id), Number(s.quantity) || 0]));
  const problems = order.order_items
    .filter((i) => (scanned.get(String(i.id)) || 0) !== i.quantity)
    .map((i) => ({ order_item_id: i.id, expected: i.quantity, scanned: scanned.get(String(i.id)) || 0 }));
  if (problems.length) return res.status(409).json({ message: `${problems.length} line(s) don't match the order`, problems });
  await audit(req, "order.pack_verified", { entity: "order", entityId: order.id, changes: { lines: order.order_items.length } });
  res.json({ message: `${order.order_number} verified: every item scanned` });
};

// GET /company/scan/purchase-orders/:id -> lines still expected, with their codes
const poForReceiving = async (req, res) => {
  const po = await prisma.purchase_orders.findFirst({
    where: { id: toId(req.params.id), company_id: req.company.id },
    include: { purchase_order_items: { orderBy: { id: "asc" }, include: { products: { select: { id: true, title: true, sku: true } } } }, suppliers: { select: { name: true } }, warehouses: { select: { id: true, code: true } } },
  });
  if (!po) throw new HttpError(404, "Purchase order not found");
  const codes = await codesFor(po.purchase_order_items.map((i) => i.product_id));
  res.json({
    data: {
      id: po.id, po_number: po.po_number, status: po.status, supplier: po.suppliers?.name, warehouse: po.warehouses,
      lines: po.purchase_order_items.map((i) => ({
        item_id: i.id, product_id: i.product_id, title: inv.label(i.products?.title, i.flavor), flavor: i.flavor, sku: i.products?.sku,
        ordered: i.quantity_ordered, received: i.quantity_received, outstanding: Math.max(0, i.quantity_ordered - i.quantity_received), codes: codes(i.product_id, i.flavor),
      })),
    },
  });
};

module.exports = { lookup, count, orderForPacking, verifyPack, poForReceiving };
