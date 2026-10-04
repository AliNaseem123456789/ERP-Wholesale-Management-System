// Stock engine. EVERY stock change goes through receive() / issue() / reserve() / release(),
// always inside a transaction, so that:
//   - inventory_levels.on_hand == sum(inventory_lots.quantity) for each warehouse+product+flavour
// Stock is kept per flavour for products that have flavours ('' = no flavour / not assigned to one).
//   - every change is written to the stock_movements ledger
//   - the level row is locked (SELECT ... FOR UPDATE) so concurrent orders can't oversell
const { Prisma } = require("@prisma/client");
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");
const { notifyCompany } = require("./notify");

class StockError extends HttpError {
  constructor(message) {
    super(409, message);
  }
}

const isInventoryTracked = (company) => company?.settings?.inventory?.tracking === true;

// Returns the company's default warehouse, creating "Main warehouse" if it has none.
const getDefaultWarehouse = async (db, companyId) => {
  const cid = BigInt(companyId);
  const existing =
    (await db.warehouses.findFirst({ where: { company_id: cid, is_default: true, is_active: true } })) ||
    (await db.warehouses.findFirst({ where: { company_id: cid, is_active: true }, orderBy: { id: "asc" } }));
  if (existing) return existing;
  return db.warehouses.upsert({
    where: { company_id_code: { company_id: cid, code: "MAIN" } },
    create: { company_id: cid, name: "Main warehouse", code: "MAIN", is_default: true },
    update: { is_active: true, is_default: true },
  });
};

const assertWarehouse = async (db, companyId, warehouseId) => {
  const wh = await db.warehouses.findFirst({ where: { id: BigInt(warehouseId), company_id: BigInt(companyId) } });
  if (!wh) throw new HttpError(404, "Warehouse not found");
  if (!wh.is_active) throw new HttpError(400, `Warehouse "${wh.name}" is inactive`);
  return wh;
};

const assertProduct = async (db, companyId, productId) => {
  const p = await db.products.findFirst({ where: { id: BigInt(productId), company_id: BigInt(companyId) } });
  if (!p) throw new HttpError(404, "Product not found");
  return p;
};

// ---- flavours ----
const normFlavor = (f) => (f === undefined || f === null ? "" : String(f).trim().slice(0, 255));
const flavorsOf = (product) => [...new Set((product?.flavors || []).map((f) => String(f).trim()).filter(Boolean))];
const hasFlavors = (product) => flavorsOf(product).length > 0;
const label = (title, flavor) => (flavor ? `${title} (${flavor})` : title);

/**
 * Turns user input into the stored flavour key for a product.
 *  - products without flavours: always ""
 *  - products with flavours: one of its flavours (matched ignoring case);
 *    "" only when allowUnassigned (to move or write off stock recorded before flavours were tracked)
 */
const resolveFlavor = (product, flavor, { allowUnassigned = false } = {}) => {
  const list = flavorsOf(product);
  const f = normFlavor(flavor);
  if (!list.length) return "";
  if (!f) {
    if (allowUnassigned) return "";
    throw new HttpError(400, `Choose a flavour of "${product.title}"`);
  }
  const match = list.find((x) => x.toLowerCase() === f.toLowerCase());
  if (!match) throw new HttpError(400, `"${product.title}" has no flavour "${f}"`);
  return match;
};

// Keeps product_variants (per-flavour SKU / barcode) in step with products.flavors.
// Refuses to drop a flavour that still has stock.
const syncVariants = async (db, product, newFlavors) => {
  const next = [...new Set((newFlavors || []).map((f) => String(f).trim()).filter(Boolean))];
  const old = flavorsOf(product);
  const removed = old.filter((f) => !next.some((n) => n.toLowerCase() === f.toLowerCase()));
  if (removed.length) {
    const stocked = await db.inventory_levels.findMany({
      where: { product_id: BigInt(product.id), flavor: { in: removed }, OR: [{ on_hand: { gt: 0 } }, { reserved: { gt: 0 } }] },
      select: { flavor: true, on_hand: true },
    });
    if (stocked.length) {
      throw new HttpError(400, `Flavour "${stocked[0].flavor}" still has ${stocked[0].on_hand} in stock. Move or write off that stock before removing the flavour.`);
    }
  }
  for (const f of next) {
    await db.product_variants.upsert({
      where: { product_id_flavor: { product_id: BigInt(product.id), flavor: f } },
      create: { product_id: BigInt(product.id), flavor: f },
      update: {},
    });
  }
};

// Creates the level row if needed and locks it for the rest of the transaction.
const lockLevel = async (tx, companyId, warehouseId, productId, flavor = "") => {
  const fl = normFlavor(flavor);
  await tx.$executeRaw`
    INSERT INTO inventory_levels (company_id, warehouse_id, product_id, flavor)
    VALUES (${BigInt(companyId)}, ${BigInt(warehouseId)}, ${BigInt(productId)}, ${fl})
    ON CONFLICT (warehouse_id, product_id, flavor) DO NOTHING`;
  const rows = await tx.$queryRaw`
    SELECT id, on_hand, reserved FROM inventory_levels
    WHERE warehouse_id = ${BigInt(warehouseId)} AND product_id = ${BigInt(productId)} AND flavor = ${fl}
    FOR UPDATE`;
  return rows[0];
};

const toDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`) : null);

/**
 * Adds stock. Creates or tops up the matching lot (same lot number, expiry and bin).
 * When `updateCost` is true and a unit cost is given, the product's moving average cost is updated.
 */
const receive = async (tx, {
  companyId, warehouseId, productId, flavor = "", quantity, unitCost = null, lotNumber = null, expiryDate = null,
  binId = null, type = "receipt", reason = null, referenceType = null, referenceId = null, notes = null,
  userId = null, updateCost = true,
}) => {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, "Quantity must be a positive whole number");
  const fl = normFlavor(flavor);
  const level = await lockLevel(tx, companyId, warehouseId, productId, fl);

  if (updateCost && unitCost != null) {
    // Moving average across all warehouses of the company.
    const [{ total }] = await tx.$queryRaw`
      SELECT COALESCE(SUM(on_hand), 0)::int AS total FROM inventory_levels
      WHERE company_id = ${BigInt(companyId)} AND product_id = ${BigInt(productId)}`;
    const product = await tx.products.findUnique({ where: { id: BigInt(productId) }, select: { cost_price: true } });
    const oldQty = Math.max(0, Number(total));
    const oldCost = Number(product.cost_price || 0);
    const newCost = oldQty === 0 ? Number(unitCost) : (oldQty * oldCost + qty * Number(unitCost)) / (oldQty + qty);
    await tx.products.update({
      where: { id: BigInt(productId) },
      data: { cost_price: new Prisma.Decimal(newCost.toFixed(4)) },
    });
  }

  const lotWhere = {
    company_id: BigInt(companyId),
    warehouse_id: BigInt(warehouseId),
    product_id: BigInt(productId),
    flavor: fl,
    lot_number: lotNumber || null,
    expiry_date: toDate(expiryDate),
    bin_id: binId ? BigInt(binId) : null,
  };
  const existingLot = await tx.inventory_lots.findFirst({ where: lotWhere });
  const lot = existingLot
    ? await tx.inventory_lots.update({ where: { id: existingLot.id }, data: { quantity: { increment: qty } } })
    : await tx.inventory_lots.create({
        data: { ...lotWhere, quantity: qty, unit_cost: unitCost != null ? new Prisma.Decimal(Number(unitCost).toFixed(4)) : null },
      });

  const balance = level.on_hand + qty;
  await tx.inventory_levels.update({ where: { id: level.id }, data: { on_hand: balance, updated_at: new Date() } });
  await tx.stock_movements.create({
    data: {
      company_id: BigInt(companyId), warehouse_id: BigInt(warehouseId), product_id: BigInt(productId), flavor: fl,
      lot_id: lot.id, quantity: qty, type, reason, reference_type: referenceType,
      reference_id: referenceId != null ? String(referenceId) : null,
      unit_cost: unitCost != null ? new Prisma.Decimal(Number(unitCost).toFixed(4)) : null,
      balance_after: balance, notes, user_id: userId ? BigInt(userId) : null,
    },
  });
  return lot;
};

/**
 * Removes stock, consuming lots first-expiry-first-out (or a specific lot).
 * `releaseReserved` also lowers the reservation (used when shipping a reserved order).
 * Returns the consumed chunks: [{ lot, quantity }].
 */
const issue = async (tx, {
  companyId, warehouseId, productId, flavor = "", quantity, lotId = null, type = "adjustment", reason = null,
  referenceType = null, referenceId = null, notes = null, userId = null, releaseReserved = 0, productName = null,
}) => {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, "Quantity must be a positive whole number");
  const fl = normFlavor(flavor);
  const level = await lockLevel(tx, companyId, warehouseId, productId, fl);
  if (level.on_hand < qty) {
    const name = productName || (await tx.products.findUnique({ where: { id: BigInt(productId) }, select: { title: true } }))?.title;
    throw new StockError(`Not enough stock of "${label(name, fl)}": ${level.on_hand} on hand, ${qty} needed`);
  }

  const lots = lotId
    ? await tx.$queryRaw`SELECT * FROM inventory_lots WHERE id = ${BigInt(lotId)} AND warehouse_id = ${BigInt(warehouseId)}
        AND product_id = ${BigInt(productId)} AND flavor = ${fl} FOR UPDATE`
    : await tx.$queryRaw`SELECT * FROM inventory_lots WHERE warehouse_id = ${BigInt(warehouseId)}
        AND product_id = ${BigInt(productId)} AND flavor = ${fl} AND quantity > 0
        ORDER BY expiry_date ASC NULLS LAST, received_at ASC, id ASC FOR UPDATE`;
  if (lotId && (!lots.length || lots[0].quantity < qty)) {
    throw new StockError(`That lot only has ${lots[0]?.quantity ?? 0} units`);
  }

  let remaining = qty;
  let balance = level.on_hand;
  const consumed = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.quantity);
    if (take <= 0) continue;
    await tx.inventory_lots.update({ where: { id: lot.id }, data: { quantity: { decrement: take } } });
    balance -= take;
    remaining -= take;
    consumed.push({ lot, quantity: take });
    await tx.stock_movements.create({
      data: {
        company_id: BigInt(companyId), warehouse_id: BigInt(warehouseId), product_id: BigInt(productId), flavor: fl,
        lot_id: lot.id, quantity: -take, type, reason, reference_type: referenceType,
        reference_id: referenceId != null ? String(referenceId) : null, unit_cost: lot.unit_cost,
        balance_after: balance, notes, user_id: userId ? BigInt(userId) : null,
      },
    });
  }
  if (remaining > 0) {
    // Only possible if levels and lots got out of sync; never silently lose track.
    throw new StockError("Stock records are inconsistent for this product. Please run a stock count.");
  }

  const newReserved = Math.max(0, level.reserved - Number(releaseReserved || 0));
  await tx.inventory_levels.update({
    where: { id: level.id },
    data: { on_hand: balance, reserved: newReserved, updated_at: new Date() },
  });
  return consumed;
};

// Holds stock for a confirmed order (fails if not enough is available).
const reserve = async (tx, { companyId, warehouseId, productId, flavor = "", quantity, productName }) => {
  const fl = normFlavor(flavor);
  const level = await lockLevel(tx, companyId, warehouseId, productId, fl);
  const available = level.on_hand - level.reserved;
  if (available < quantity) {
    throw new StockError(`Not enough stock of "${label(productName || "product", fl)}": ${Math.max(0, available)} available, ${quantity} needed`);
  }
  await tx.inventory_levels.update({
    where: { id: level.id },
    data: { reserved: level.reserved + quantity, updated_at: new Date() },
  });
};

const release = async (tx, { warehouseId, productId, flavor = "", quantity }) => {
  if (!quantity) return;
  await tx.$executeRaw`UPDATE inventory_levels SET reserved = GREATEST(reserved - ${Number(quantity)}, 0), updated_at = now()
    WHERE warehouse_id = ${BigInt(warehouseId)} AND product_id = ${BigInt(productId)} AND flavor = ${normFlavor(flavor)}`;
};

// Available-to-sell per product across all warehouses of a company.
// For products with flavours only stock assigned to a flavour counts (unassigned stock can't be ordered).
const availabilityFor = async (productIds, db = prisma) => {
  if (!productIds.length) return new Map();
  const ids = productIds.map((id) => BigInt(id));
  const rows = await db.$queryRaw`
    SELECT l.product_id, COALESCE(SUM(l.on_hand - l.reserved), 0)::int AS available
    FROM inventory_levels l JOIN products p ON p.id = l.product_id
    WHERE l.product_id IN (${Prisma.join(ids)})
      AND (l.flavor <> '' OR COALESCE(cardinality(p.flavors), 0) = 0)
    GROUP BY l.product_id`;
  return new Map(rows.map((r) => [String(r.product_id), Number(r.available)]));
};

// Available-to-sell per product + flavour. Key: `${productId}|${flavor}`.
const flavorKey = (productId, flavor) => `${productId}|${normFlavor(flavor)}`;
const availabilityByFlavor = async (productIds, db = prisma) => {
  if (!productIds.length) return new Map();
  const rows = await db.inventory_levels.groupBy({
    by: ["product_id", "flavor"],
    where: { product_id: { in: productIds.map((id) => BigInt(id)) } },
    _sum: { on_hand: true, reserved: true },
  });
  return new Map(rows.map((r) => [flavorKey(r.product_id, r.flavor), (r._sum.on_hand || 0) - (r._sum.reserved || 0)]));
};

// Available quantity of one product line (flavour-aware) from the two maps above.
const availableOf = (product, flavor, byFlavor) =>
  hasFlavors(product) ? Math.max(0, byFlavor.get(flavorKey(product.id, flavor)) ?? 0) : Math.max(0, byFlavor.get(flavorKey(product.id, "")) ?? 0);

// What is at/below its reorder point. For products with flavours the reorder point applies to each flavour.
const lowLines = async (products) => {
  const byFlavor = await availabilityByFlavor(products.map((p) => p.id));
  const total = await availabilityFor(products.map((p) => p.id));
  const out = [];
  for (const p of products) {
    if (hasFlavors(p)) {
      for (const f of flavorsOf(p)) {
        const a = byFlavor.get(flavorKey(p.id, f)) ?? 0;
        if (a <= p.reorder_point) out.push({ product: p, flavor: f, available: a });
      }
    } else {
      const a = total.get(String(p.id)) ?? 0;
      if (a <= p.reorder_point) out.push({ product: p, flavor: "", available: a });
    }
  }
  return out;
};

// Emails inventory staff about products at/below their reorder point (at most once per product per day).
const checkLowStock = async (companyId, productIds) => {
  try {
    const ids = [...new Set(productIds.map(String))].map((id) => BigInt(id));
    if (!ids.length) return;
    const company = await prisma.companies.findUnique({ where: { id: BigInt(companyId) } });
    if (!isInventoryTracked(company) || company.settings?.inventory?.lowStockEmails === false) return;

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const products = (
      await prisma.products.findMany({
        where: { id: { in: ids }, reorder_point: { gt: 0 } },
        select: { id: true, title: true, sku: true, flavors: true, reorder_point: true, low_stock_alerted_at: true },
      })
    ).filter((p) => !p.low_stock_alerted_at || p.low_stock_alerted_at.getTime() < dayAgo);
    const low = await lowLines(products);
    if (!low.length) return;
    await prisma.products.updateMany({ where: { id: { in: [...new Set(low.map((l) => l.product.id))] } }, data: { low_stock_alerted_at: new Date() } });
    await notifyCompany(companyId, "inventory.view", {
      template: "lowStock",
      data: {
        companyName: company.name,
        items: low.map((l) => ({ title: label(l.product.title, l.flavor), sku: l.product.sku, available: l.available, reorderPoint: l.product.reorder_point })),
      },
    });
  } catch (err) {
    console.error("low stock check failed:", err.message);
  }
};

// Clears the "already alerted" flag once stock is back above the reorder point.
const resetLowStockFlags = async (productIds) => {
  const ids = [...new Set(productIds.map(String))].map((id) => BigInt(id));
  if (!ids.length) return;
  const products = await prisma.products.findMany({
    where: { id: { in: ids }, low_stock_alerted_at: { not: null } },
    select: { id: true, flavors: true, reorder_point: true },
  });
  const low = new Set((await lowLines(products)).map((l) => String(l.product.id)));
  const recovered = products.filter((p) => !low.has(String(p.id))).map((p) => p.id);
  if (recovered.length) await prisma.products.updateMany({ where: { id: { in: recovered } }, data: { low_stock_alerted_at: null } });
};

module.exports = {
  lockLevel,
  StockError,
  isInventoryTracked,
  getDefaultWarehouse,
  assertWarehouse,
  assertProduct,
  receive,
  issue,
  reserve,
  release,
  availabilityFor,
  availabilityByFlavor,
  availableOf,
  flavorKey,
  normFlavor,
  flavorsOf,
  hasFlavors,
  resolveFlavor,
  syncVariants,
  label,
  lowLines,
  checkLowStock,
  resetLowStockFlags,
};
