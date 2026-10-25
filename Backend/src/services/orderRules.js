// Buying rules for cart lines, checked when adding to the cart and again at checkout:
//   - the variant must still be on sale (not discontinued / archived)
//   - each line must be a multiple of the product's order multiple (e.g. sold in cases of 10)
//   - the product's minimum order quantity counts all its variants together ("mix and match");
//     a variant's own minimum applies to that variant's line
const prisma = require("../prisma");
const inv = require("./inventory");

/** Loads what the rules need for these product ids. */
const loadRules = async (productIds, db = prisma) => {
  const ids = [...new Set(productIds.map(String))].map((id) => BigInt(id));
  if (!ids.length) return { products: new Map(), variants: new Map() };
  const [products, variants] = await Promise.all([
    db.products.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, min_order_qty: true, order_multiple: true, flavors: true } }),
    db.product_variants.findMany({ where: { product_id: { in: ids } }, select: { product_id: true, flavor: true, name: true, status: true, min_order_qty: true } }),
  ]);
  return {
    products: new Map(products.map((p) => [String(p.id), p])),
    variants: new Map(variants.map((v) => [`${v.product_id}|${v.flavor}`, v])),
  };
};

/** Problem with one line on its own (variant on sale, order multiple). Returns a message or null. */
const lineProblem = (rules, productId, flavor, quantity) => {
  const p = rules.products.get(String(productId));
  if (!p) return null;
  const v = flavor ? rules.variants.get(`${productId}|${flavor}`) : null;
  const name = inv.label(p.title, v?.name || flavor);
  if (v && v.status !== "active") return `"${name}" is no longer available`;
  const multiple = p.order_multiple || 1;
  if (multiple > 1 && quantity % multiple !== 0) return `"${name}" is sold in multiples of ${multiple}`;
  return null;
};

/**
 * Every problem in a set of lines [{ product_id, flavor, quantity }]: line rules plus minimum quantities.
 * Returns [{ product_id, flavor, message }].
 */
const linesProblems = (rules, lines) => {
  const out = [];
  const totals = new Map();
  for (const l of lines) totals.set(String(l.product_id), (totals.get(String(l.product_id)) || 0) + Number(l.quantity));
  for (const l of lines) {
    const msg = lineProblem(rules, l.product_id, l.flavor || "", Number(l.quantity));
    if (msg) out.push({ product_id: l.product_id, flavor: l.flavor || "", message: msg });
    const v = l.flavor ? rules.variants.get(`${l.product_id}|${l.flavor}`) : null;
    const p = rules.products.get(String(l.product_id));
    if (v?.min_order_qty && Number(l.quantity) < v.min_order_qty) {
      out.push({ product_id: l.product_id, flavor: l.flavor, message: `The minimum order for "${inv.label(p?.title, v.name || l.flavor)}" is ${v.min_order_qty}` });
    }
  }
  for (const [pid, total] of totals) {
    const p = rules.products.get(pid);
    if (p && p.min_order_qty > 1 && total < p.min_order_qty) {
      out.push({ product_id: p.id, flavor: "", message: `The minimum order for "${p.title}" is ${p.min_order_qty}${inv.hasFlavors(p) ? " (all variants together)" : ""}` });
    }
  }
  return out;
};

module.exports = { loadRules, lineProblem, linesProblems };
