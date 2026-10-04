// Sets a stock level to a counted quantity (cycle counts from the scan station and CSV stock imports).
// Same rules as a "set" adjustment: increases are received at the given/average cost, decreases leave
// earliest-expiry lots first, and the difference posts to the books when accounting is on.
const { HttpError } = require("../utils/http");
const inv = require("./inventory");
const gl = require("./postings");

const applyCount = async (tx, { companyId, warehouse, product, flavor, counted, unitCost = null, userId = null, notes = null, reason = "stock_count" }) => {
  if (!Number.isInteger(counted) || counted < 0) throw new HttpError(400, `Counted quantity for "${product.title}" must be a whole number, 0 or more`);
  const level = await inv.lockLevel(tx, companyId, warehouse.id, product.id, flavor);
  const delta = counted - level.on_hand;
  if (!delta) return { delta: 0, before: level.on_hand };
  const common = {
    companyId, warehouseId: warehouse.id, productId: product.id, flavor, type: "adjustment", reason,
    referenceType: "adjustment", notes, userId, productName: product.title,
  };
  let value;
  if (delta > 0) {
    if (!flavor && inv.hasFlavors(product)) throw new HttpError(400, `Choose a flavour of "${product.title}" to add stock`);
    await inv.receive(tx, { ...common, quantity: delta, unitCost, updateCost: unitCost !== null });
    value = delta * Number(unitCost ?? product.cost_price ?? 0);
  } else {
    const chunks = await inv.issue(tx, { ...common, quantity: -delta });
    value = -gl.chunksValue(chunks, product.cost_price);
  }
  await gl.postStockAdjustment(tx, { companyId, value: Math.round(value * 100) / 100, reason, productTitle: inv.label(product.title, flavor), userId });
  return { delta, before: level.on_hand };
};

module.exports = { applyCount };
