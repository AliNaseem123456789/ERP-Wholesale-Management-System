// Product variants (purchasable configurations).
//
// Every stock table, cart, order, quote, purchase order and price list already identifies a variant by
// (product_id, variant key). The key is the text in the `flavor` column; products.flavors lists the keys.
// Here a variant is described by option values (e.g. Size = 100 ml, Colour = Black), and its key is the
// readable label made from them ("Black / 128 GB"). A key never changes once the variant has stock or
// history; its display name can. Variants with history are archived instead of deleted.
const { Prisma } = require("@prisma/client");
const { HttpError } = require("../utils/http");
const { num } = require("./money");
const attrs = require("./attributes");

const STATUSES = ["active", "discontinued", "archived"];

// Tables that point at a variant key. Any row means the variant has history and its key is fixed.
const historyCount = async (db, productId, key) => {
  const pid = BigInt(productId);
  const [r] = await db.$queryRaw`
    SELECT
      (SELECT count(*) FROM inventory_levels WHERE product_id = ${pid} AND flavor = ${key})
    + (SELECT count(*) FROM inventory_lots WHERE product_id = ${pid} AND flavor = ${key})
    + (SELECT count(*) FROM stock_movements WHERE product_id = ${pid} AND flavor = ${key})
    + (SELECT count(*) FROM order_items WHERE product_id = ${pid} AND COALESCE(flavor, '') = ${key})
    + (SELECT count(*) FROM quote_items WHERE product_id = ${pid} AND flavor = ${key})
    + (SELECT count(*) FROM purchase_order_items WHERE product_id = ${pid} AND flavor = ${key})
    + (SELECT count(*) FROM goods_receipt_items WHERE product_id = ${pid} AND flavor = ${key})
    + (SELECT count(*) FROM stock_transfer_items WHERE product_id = ${pid} AND flavor = ${key})
    + (SELECT count(*) FROM supplier_return_items WHERE product_id = ${pid} AND flavor = ${key}) AS n`;
  return Number(r.n);
};

const optionLabel = (attr, row) => {
  if (row.option_id) return attr.attribute_options.find((o) => String(o.id) === String(row.option_id))?.value;
  if (row.value_number !== undefined && row.value_number !== null) return `${Number(row.value_number)}${attr.unit ? ` ${attr.unit}` : ""}`;
  return row.value_text;
};
const signatureOf = (rows) =>
  rows.map((r) => `${r.attribute_id}:${r.option_id ?? r.value_number ?? String(r.value_text || "").toLowerCase()}`).sort().join("|");

/** Company view of a product's variants: options, prices, costs, stock, history. */
const listForCompany = async (db, product) => {
  const [variants, stock] = await Promise.all([
    db.product_variants.findMany({
      where: { product_id: product.id },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      include: { product_attribute_values: { include: { attribute_definitions: true, attribute_options: true } } },
    }),
    db.inventory_levels.groupBy({ by: ["flavor"], where: { product_id: product.id }, _sum: { on_hand: true, reserved: true } }),
  ]);
  const keys = new Set((product.flavors || []).map((f) => String(f).trim()));
  const stockBy = new Map(stock.map((s) => [s.flavor, s._sum]));
  const optionAttrIds = [];
  const data = [];
  for (const v of variants.filter((x) => keys.has(x.flavor))) {
    const options = {};
    for (const av of v.product_attribute_values) {
      if (!av.attribute_definitions.is_variant_option) continue;
      if (!optionAttrIds.includes(String(av.attribute_id))) optionAttrIds.push(String(av.attribute_id));
      options[String(av.attribute_id)] = av.attribute_options?.value ?? (av.value_number !== null ? Number(av.value_number) : av.value_text);
    }
    data.push({
      id: v.id, key: v.flavor, flavor: v.flavor, name: v.name || v.flavor, sku: v.sku, barcode: v.barcode,
      price: v.price === null ? null : num(v.price), cost_price: v.cost_price === null ? null : num(v.cost_price),
      status: v.status, min_order_qty: v.min_order_qty, image_url: v.image_url, sort_order: v.sort_order, options,
      on_hand: stockBy.get(v.flavor)?.on_hand || 0, reserved: stockBy.get(v.flavor)?.reserved || 0,
      has_history: (await historyCount(db, product.id, v.flavor)) > 0,
    });
  }
  return { data, option_attribute_ids: optionAttrIds, unassigned: stockBy.get("")?.on_hand || 0 };
};

const assertCodeFree = async (tx, companyId, { sku, barcode, productId, key }) => {
  if (sku) {
    const v = await tx.product_variants.findFirst({
      where: { sku: { equals: sku, mode: "insensitive" }, NOT: { product_id: BigInt(productId), flavor: key }, products: { is: { company_id: BigInt(companyId) } } },
      include: { products: { select: { title: true } } },
    });
    const p = await tx.products.findFirst({ where: { company_id: BigInt(companyId), sku: { equals: sku, mode: "insensitive" }, NOT: { id: BigInt(productId) } }, select: { title: true } });
    if (v || p) throw new HttpError(409, `SKU ${sku} is already used by ${v ? `${v.products.title} (${v.name || v.flavor})` : p.title}`);
  }
  if (barcode) {
    const v = await tx.product_variants.findFirst({
      where: { barcode, NOT: { product_id: BigInt(productId), flavor: key }, products: { is: { company_id: BigInt(companyId) } } },
      include: { products: { select: { title: true } } },
    });
    const p = await tx.products.findFirst({ where: { company_id: BigInt(companyId), barcode }, select: { title: true } });
    if (v || p) throw new HttpError(409, `Barcode ${barcode} is already used by ${v ? `${v.products.title} (${v.name || v.flavor})` : p.title}`);
  }
};

const text = (v, max) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));

/**
 * Saves the full variant list of a product.
 * body: { option_attribute_ids: [id...], variants: [{ id?, name?, options: { [attribute_id]: value }, sku?, barcode?,
 *         price?, status?, min_order_qty?, image_url? }] }
 * Variants left out are deleted, or archived when they have history.
 */
const saveVariants = async (tx, { companyId, product, body }) => {
  const optionIds = (Array.isArray(body.option_attribute_ids) ? body.option_attribute_ids : []).map(String);
  const submitted = Array.isArray(body.variants) ? body.variants : [];
  if (submitted.length > 500) throw new HttpError(400, "A product can have at most 500 variants");
  if (submitted.length && !optionIds.length) throw new HttpError(400, "Choose at least one option (e.g. Size or Colour) that the variants differ by");

  const optionAttrs = await tx.attribute_definitions.findMany({
    where: { id: { in: optionIds.filter((x) => /^\d+$/.test(x)).map((x) => BigInt(x)) }, is_variant_option: true, ...attrs.visibleTo(companyId) },
    include: { attribute_options: true },
  });
  if (optionAttrs.length !== optionIds.length) throw new HttpError(400, "One of the options can't be used for variants");
  const attrById = new Map(optionAttrs.map((a) => [String(a.id), a]));

  const existing = await tx.product_variants.findMany({ where: { product_id: product.id } });
  const byId = new Map(existing.map((v) => [String(v.id), v]));

  // 1) validate and describe every submitted variant
  const planned = [];
  const signatures = new Set();
  const keysLower = new Set();
  for (const [idx, s] of submitted.entries()) {
    const rows = [];
    const labels = [];
    for (const aid of optionIds) {
      const attr = attrById.get(aid);
      const raw = s.options?.[aid];
      if (raw === undefined || raw === null || raw === "") throw new HttpError(400, `Variant ${idx + 1}: choose its ${attr.name}`);
      await attrs.ensureOptions(tx, attr, raw, companyId);
      const r = attrs.valueRows(attr, raw);
      if (r.length !== 1) throw new HttpError(400, `Variant ${idx + 1}: ${attr.name} needs exactly one value`);
      rows.push({ attribute_id: attr.id, ...r[0] });
      labels.push(optionLabel(attr, r[0]));
    }
    const sig = signatureOf(rows);
    if (signatures.has(sig)) throw new HttpError(400, `Two variants have the same options (${labels.join(" / ")})`);
    signatures.add(sig);

    const current = s.id ? byId.get(String(s.id)) : null;
    if (s.id && !current) throw new HttpError(400, "One of the variants doesn't belong to this product");
    const label = labels.join(" / ").slice(0, 255);
    let key = current ? current.flavor : label;
    if (current && current.flavor !== label && (await historyCount(tx, product.id, current.flavor)) === 0) key = label; // no history: key follows the options
    if (keysLower.has(key.toLowerCase())) throw new HttpError(400, `Two variants would both be called "${key}"`);
    keysLower.add(key.toLowerCase());

    const status = s.status === undefined ? current?.status || "active" : String(s.status);
    if (!STATUSES.includes(status)) throw new HttpError(400, `Variant status must be one of: ${STATUSES.join(", ")}`);
    let price = null;
    if (s.price !== undefined && s.price !== null && s.price !== "") {
      price = Number(s.price);
      if (!Number.isFinite(price) || price < 0) throw new HttpError(400, `Variant ${label}: price must be 0 or more`);
    }
    let moq = null;
    if (s.min_order_qty !== undefined && s.min_order_qty !== null && s.min_order_qty !== "") {
      moq = Number(s.min_order_qty);
      if (!Number.isInteger(moq) || moq < 1) throw new HttpError(400, `Variant ${label}: minimum order must be a whole number, 1 or more`);
    }
    const sku = text(s.sku, 255);
    const barcode = text(s.barcode, 64);
    planned.push({ current, key, rows, data: { name: text(s.name, 255) || label, sku, barcode, price, status, min_order_qty: moq, image_url: text(s.image_url, 1000), sort_order: idx } });
  }

  // 2) a new key must not clash with a variant that stays (e.g. an archived one with history)
  const keptIds = new Set(planned.filter((p) => p.current).map((p) => String(p.current.id)));
  const leaving = existing.filter((v) => !keptIds.has(String(v.id)));
  const leavingWithHistory = [];
  for (const v of leaving) if ((await historyCount(tx, product.id, v.flavor)) > 0) leavingWithHistory.push(v);
  for (const p of planned) {
    const clash = leavingWithHistory.find((v) => v.flavor.toLowerCase() === p.key.toLowerCase());
    if (clash && !p.current) throw new HttpError(400, `A variant called "${clash.flavor}" already exists with stock or orders. Keep it in the list (you can mark it discontinued) instead of adding it again.`);
  }

  // 3) remove or archive the ones that were left out
  for (const v of leaving) {
    if (leavingWithHistory.includes(v)) {
      const stock = await tx.inventory_levels.aggregate({ where: { product_id: product.id, flavor: v.flavor }, _sum: { on_hand: true, reserved: true } });
      if ((stock._sum.on_hand || 0) > 0 || (stock._sum.reserved || 0) > 0) {
        throw new HttpError(400, `"${v.name || v.flavor}" still has ${stock._sum.on_hand || 0} in stock. Move or write off that stock first, or mark the variant discontinued.`);
      }
      await tx.product_variants.update({ where: { id: v.id }, data: { status: "archived", updated_at: new Date() } });
    } else {
      await tx.cart_items.deleteMany({ where: { product_id: product.id, flavor: v.flavor } });
      await tx.price_list_items.deleteMany({ where: { product_id: product.id, flavor: v.flavor } });
      await tx.product_images.updateMany({ where: { product_id: product.id, variant_key: v.flavor }, data: { variant_key: null } });
      await tx.product_variants.delete({ where: { id: v.id } });
    }
  }

  // 4) write the variants
  for (const p of planned) {
    await assertCodeFree(tx, companyId, { sku: p.data.sku, barcode: p.data.barcode, productId: product.id, key: p.current?.flavor ?? p.key });
    let variant;
    if (p.current) {
      if (p.current.flavor !== p.key) {
        // no history: the key follows the new options; move the few rows that may point at the old key
        await tx.cart_items.deleteMany({ where: { product_id: product.id, flavor: p.current.flavor } });
        await tx.price_list_items.updateMany({ where: { product_id: product.id, flavor: p.current.flavor }, data: { flavor: p.key } });
        await tx.product_images.updateMany({ where: { product_id: product.id, variant_key: p.current.flavor }, data: { variant_key: p.key } });
      }
      variant = await tx.product_variants.update({
        where: { id: p.current.id },
        data: { ...p.data, flavor: p.key, price: p.data.price === null ? null : new Prisma.Decimal(p.data.price.toFixed(2)), updated_at: new Date() },
      });
    } else {
      variant = await tx.product_variants.create({
        data: { product_id: product.id, flavor: p.key, ...p.data, price: p.data.price === null ? null : new Prisma.Decimal(p.data.price.toFixed(2)) },
      });
    }
    await tx.product_attribute_values.deleteMany({ where: { product_id: product.id, variant_id: variant.id, attribute_definitions: { is_variant_option: true } } });
    await tx.product_attribute_values.createMany({ data: p.rows.map((r) => ({ product_id: product.id, variant_id: variant.id, ...r })) });
  }

  // 5) products.flavors = every variant key still in use (archived ones too, so their history stays reachable)
  const archivedKeys = leavingWithHistory.map((v) => v.flavor);
  const flavors = [...planned.map((p) => p.key), ...archivedKeys];
  await tx.products.update({ where: { id: product.id }, data: { flavors, updated_at: new Date() } });
  return flavors;
};

/**
 * Old-style flavour lists (product form, CSV import): makes sure each flavour key has its "Flavour" option value,
 * so it shows as a variant option everywhere.
 */
const linkFlavourOptions = async (tx, productId, keys) => {
  const list = (keys || []).map((k) => String(k).trim()).filter(Boolean);
  if (!list.length) return;
  const attr = await tx.attribute_definitions.findFirst({ where: { company_id: null, key: "flavour" }, include: { attribute_options: true } });
  if (!attr) return;
  const variants = await tx.product_variants.findMany({
    where: { product_id: BigInt(productId), flavor: { in: list } },
    include: { product_attribute_values: { where: { attribute_definitions: { is_variant_option: true } }, select: { id: true } } },
  });
  for (const v of variants) {
    if (v.product_attribute_values.length) continue; // already described by options
    await attrs.ensureOptions(tx, attr, v.flavor, null);
    const o = attrs.findOption(attr, v.flavor);
    if (o) await tx.product_attribute_values.create({ data: { product_id: BigInt(productId), variant_id: v.id, attribute_id: attr.id, option_id: o.id } });
  }
};

module.exports = { STATUSES, historyCount, listForCompany, saveVariants, linkFlavourOptions };
