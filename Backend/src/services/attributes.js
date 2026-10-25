// Category attributes / product specifications.
//   attribute_definitions: what can be described (global ones from the platform, or a company's own)
//   category_attributes:   which attributes a category uses, and which are required
//   product_attribute_values: typed values per product (or per variant), so filters can use indexes
// Some attributes may also define purchasable variants (is_variant_option), e.g. Size or Colour.
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");

const TYPES = ["text", "number", "boolean", "date", "select", "multiselect"];
const SCOPES = ["product", "variant", "both"];
const OPTION_TYPES = ["select", "number", "text"]; // types that may be used as variant options

// Starting points a platform admin can apply to a category. Attributes are created (by key) if missing.
const TEMPLATES = {
  general: {
    name: "General",
    attributes: [
      { key: "manufacturer", name: "Manufacturer", data_type: "text", is_searchable: true },
      { key: "country_of_origin", name: "Country of origin", data_type: "text", is_filterable: true },
      { key: "weight_kg", name: "Weight", data_type: "number", unit: "kg", scope: "both" },
      { key: "dimensions", name: "Dimensions", data_type: "text" },
    ],
  },
  perfume: {
    name: "Perfumes & fragrances",
    attributes: [
      { key: "size_ml", name: "Size", data_type: "number", unit: "ml", scope: "variant", is_variant_option: true, is_filterable: true },
      { key: "concentration", name: "Concentration", data_type: "select", options: ["Parfum", "Eau de Parfum", "Eau de Toilette", "Eau de Cologne", "Body Mist"], scope: "both", is_variant_option: true, is_filterable: true },
      { key: "fragrance_family", name: "Fragrance family", data_type: "select", options: ["Floral", "Woody", "Oriental", "Fresh", "Citrus", "Gourmand", "Aromatic", "Chypre", "Fougère"], is_filterable: true },
      { key: "fragrance_notes", name: "Fragrance notes", data_type: "text", is_searchable: true },
      { key: "target_gender", name: "For", data_type: "select", options: ["Men", "Women", "Unisex"], is_filterable: true },
      { key: "manufacturer", name: "Manufacturer", data_type: "text", is_searchable: true },
      { key: "country_of_origin", name: "Country of origin", data_type: "text", is_filterable: true },
    ],
  },
  smoking: {
    name: "Smoking & vape products",
    attributes: [
      { key: "product_type", name: "Product type", data_type: "select", options: ["Disposable", "Pod system", "E-liquid", "Coil", "Battery", "Device", "Cigar", "Cigarette", "Pouch", "Accessory"], is_filterable: true },
      { key: "flavour", name: "Flavour", data_type: "select", scope: "variant", is_variant_option: true, is_filterable: true, validation: { open: true } },
      { key: "pack_size", name: "Pack size", data_type: "number", unit: "pcs", scope: "variant", is_variant_option: true },
      { key: "nicotine_strength", name: "Nicotine strength", data_type: "number", unit: "mg", scope: "both", is_variant_option: true, is_filterable: true },
      { key: "puff_count", name: "Puffs", data_type: "number", is_filterable: true },
      { key: "manufacturer", name: "Manufacturer", data_type: "text", is_searchable: true },
    ],
  },
  electronics: {
    name: "Electronics",
    attributes: [
      { key: "colour", name: "Colour", data_type: "select", options: ["Black", "White", "Silver", "Grey", "Gold", "Blue", "Red", "Green"], scope: "variant", is_variant_option: true, is_filterable: true, validation: { open: true } },
      { key: "storage_capacity", name: "Storage", data_type: "select", options: ["32 GB", "64 GB", "128 GB", "256 GB", "512 GB", "1 TB", "2 TB"], scope: "variant", is_variant_option: true, is_filterable: true },
      { key: "ram_gb", name: "RAM", data_type: "number", unit: "GB", scope: "both", is_filterable: true },
      { key: "processor", name: "Processor", data_type: "text", is_searchable: true },
      { key: "display_size_in", name: "Display size", data_type: "number", unit: "in", is_filterable: true },
      { key: "operating_system", name: "Operating system", data_type: "text", is_filterable: true },
      { key: "battery_mah", name: "Battery capacity", data_type: "number", unit: "mAh" },
      { key: "connectivity", name: "Connectivity", data_type: "multiselect", options: ["Wi-Fi", "Bluetooth", "5G", "4G LTE", "NFC", "USB-C", "Ethernet"], is_filterable: true },
      { key: "warranty", name: "Warranty", data_type: "text" },
      { key: "manufacturer", name: "Manufacturer", data_type: "text", is_searchable: true },
    ],
  },
  clothing: {
    name: "Clothing",
    attributes: [
      { key: "size", name: "Size", data_type: "select", options: ["XS", "S", "M", "L", "XL", "XXL", "3XL"], scope: "variant", is_variant_option: true, is_filterable: true },
      { key: "colour", name: "Colour", data_type: "select", options: ["Black", "White", "Silver", "Grey", "Gold", "Blue", "Red", "Green"], scope: "variant", is_variant_option: true, is_filterable: true, validation: { open: true } },
      { key: "material", name: "Material", data_type: "text", is_filterable: true },
      { key: "fit", name: "Fit", data_type: "select", options: ["Slim", "Regular", "Relaxed", "Oversized"], is_filterable: true },
      { key: "care_instructions", name: "Care instructions", data_type: "text" },
      { key: "target_gender", name: "For", data_type: "select", options: ["Men", "Women", "Unisex"], is_filterable: true },
    ],
  },
};

const cleanKey = (k) => String(k || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);

/** Validates and normalises an attribute definition from a form (create or update). */
const definitionData = (body, { creating = false } = {}) => {
  const d = {};
  if (creating || body.key !== undefined) {
    d.key = cleanKey(body.key || body.name);
    if (!d.key) throw new HttpError(400, "Key is required (letters, numbers and _)");
  }
  if (creating || body.name !== undefined) {
    d.name = String(body.name || "").trim().slice(0, 255);
    if (!d.name) throw new HttpError(400, "Name is required");
  }
  if (creating || body.data_type !== undefined) {
    d.data_type = String(body.data_type || "text");
    if (!TYPES.includes(d.data_type)) throw new HttpError(400, `Type must be one of: ${TYPES.join(", ")}`);
  }
  if (body.scope !== undefined) {
    if (!SCOPES.includes(body.scope)) throw new HttpError(400, `Scope must be one of: ${SCOPES.join(", ")}`);
    d.scope = body.scope;
  }
  if (body.description !== undefined) d.description = body.description ? String(body.description).slice(0, 500) : null;
  if (body.unit !== undefined) d.unit = body.unit ? String(body.unit).trim().slice(0, 32) : null;
  for (const f of ["is_variant_option", "is_filterable", "is_searchable", "is_public"]) if (body[f] !== undefined) d[f] = !!body[f];
  if (body.sort_order !== undefined) d.sort_order = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0;
  if (body.validation !== undefined) {
    const v = body.validation || {};
    const out = {};
    for (const f of ["min", "max", "maxLength"]) if (v[f] !== undefined && v[f] !== null && v[f] !== "") {
      if (!Number.isFinite(Number(v[f]))) throw new HttpError(400, `Validation ${f} must be a number`);
      out[f] = Number(v[f]);
    }
    if (v.open !== undefined) out.open = !!v.open; // list attributes: companies may add new values
    if (v.pattern) {
      try { new RegExp(String(v.pattern)); } catch { throw new HttpError(400, "Validation pattern isn't a valid regular expression"); }
      out.pattern = String(v.pattern).slice(0, 200);
    }
    d.validation = out;
  }
  if (d.is_variant_option && d.data_type && !OPTION_TYPES.includes(d.data_type)) {
    throw new HttpError(400, "Only list, number or text attributes can define variants");
  }
  return d;
};

/** Attributes a company may use: global ones plus its own. */
const visibleTo = (companyId) => ({ OR: [{ company_id: null }, ...(companyId ? [{ company_id: BigInt(companyId) }] : [])] });

const findOption = (attr, raw) => {
  const v = String(raw).trim().toLowerCase();
  return (attr.attribute_options || []).find((o) => o.value.toLowerCase() === v || String(o.id) === String(raw));
};

/**
 * Turns one submitted value into rows for product_attribute_values (without product/variant ids).
 * attr must include attribute_options. Returns [] for an empty value.
 */
const valueRows = (attr, raw) => {
  const label = attr.name;
  const empty = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && !raw.length);
  if (empty) return [];
  const rules = attr.validation || {};
  switch (attr.data_type) {
    case "text": {
      const t = String(raw).trim();
      if (!t) return [];
      const max = rules.maxLength || 2000;
      if (t.length > max) throw new HttpError(400, `${label}: at most ${max} characters`);
      if (rules.pattern && !new RegExp(rules.pattern).test(t)) throw new HttpError(400, `${label}: "${t}" isn't in the expected format`);
      return [{ value_text: t }];
    }
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number`);
      if (rules.min !== undefined && n < rules.min) throw new HttpError(400, `${label} must be at least ${rules.min}`);
      if (rules.max !== undefined && n > rules.max) throw new HttpError(400, `${label} must be at most ${rules.max}`);
      return [{ value_number: n }];
    }
    case "boolean": {
      const b = raw === true || raw === "true" || raw === "yes" || raw === 1 || raw === "1";
      const f = raw === false || raw === "false" || raw === "no" || raw === 0 || raw === "0";
      if (!b && !f) throw new HttpError(400, `${label} must be yes or no`);
      return [{ value_boolean: b }];
    }
    case "date": {
      const d = new Date(`${String(raw).slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} must be a date (YYYY-MM-DD)`);
      return [{ value_date: d }];
    }
    case "select":
    case "multiselect": {
      const list = attr.data_type === "multiselect" ? (Array.isArray(raw) ? raw : String(raw).split(",")) : [raw];
      const out = [];
      for (const item of list.map((x) => String(x).trim()).filter(Boolean)) {
        const o = findOption(attr, item);
        if (!o) throw new HttpError(400, `${label}: "${item}" isn't one of the allowed values`);
        if (!out.some((r) => r.option_id === o.id)) out.push({ option_id: o.id });
      }
      if (attr.data_type === "select" && out.length > 1) throw new HttpError(400, `${label}: choose one value`);
      return out;
    }
    default:
      return [];
  }
};

/**
 * For list attributes that are open (validation.open, or the company's own attribute), creates values
 * that don't exist yet so they can be used. Mutates attr.attribute_options.
 */
const ensureOptions = async (tx, attr, raw, companyId) => {
  if (!["select", "multiselect"].includes(attr.data_type)) return;
  const open = attr.validation?.open === true || (attr.company_id !== null && String(attr.company_id) === String(companyId));
  if (!open || raw === undefined || raw === null || raw === "") return;
  const list = attr.data_type === "multiselect" ? (Array.isArray(raw) ? raw : String(raw).split(",")) : [raw];
  for (const value of list.map((x) => String(x).trim().slice(0, 255)).filter(Boolean)) {
    if (findOption(attr, value)) continue;
    const created = await tx.attribute_options.create({ data: { attribute_id: attr.id, value, sort_order: (attr.attribute_options || []).length } });
    attr.attribute_options = [...(attr.attribute_options || []), created];
  }
};

/** Readable value of stored rows (all rows of one attribute). */
const displayValue = (attr, rows) => {
  if (!rows.length) return null;
  if (attr.data_type === "select" || attr.data_type === "multiselect") return rows.map((r) => r.attribute_options?.value).filter(Boolean).join(", ");
  const r = rows[0];
  if (attr.data_type === "number") return r.value_number === null ? null : `${Number(r.value_number)}${attr.unit ? ` ${attr.unit}` : ""}`;
  if (attr.data_type === "boolean") return r.value_boolean ? "Yes" : "No";
  if (attr.data_type === "date") return r.value_date ? r.value_date.toISOString().slice(0, 10) : null;
  return r.value_text;
};

// The raw value as a form would send it back.
const formValue = (attr, rows) => {
  if (!rows.length) return null;
  if (attr.data_type === "multiselect") return rows.map((r) => r.attribute_options?.value).filter(Boolean);
  if (attr.data_type === "select") return rows[0].attribute_options?.value ?? null;
  const r = rows[0];
  if (attr.data_type === "number") return r.value_number === null ? null : Number(r.value_number);
  if (attr.data_type === "boolean") return r.value_boolean;
  if (attr.data_type === "date") return r.value_date ? r.value_date.toISOString().slice(0, 10) : null;
  return r.value_text;
};

/** Product-level specifications (variant values are shown with the variants). */
const specificationsFor = async (productId, { publicOnly = false, db = prisma } = {}) => {
  const rows = await db.product_attribute_values.findMany({
    where: { product_id: BigInt(productId), variant_id: null, ...(publicOnly ? { attribute_definitions: { is_public: true } } : {}) },
    include: { attribute_definitions: true, attribute_options: { select: { value: true } } },
  });
  const byAttr = new Map();
  for (const r of rows) {
    if (!byAttr.has(String(r.attribute_id))) byAttr.set(String(r.attribute_id), { attr: r.attribute_definitions, rows: [] });
    byAttr.get(String(r.attribute_id)).rows.push(r);
  }
  return [...byAttr.values()]
    .sort((a, b) => a.attr.sort_order - b.attr.sort_order || a.attr.name.localeCompare(b.attr.name))
    .map(({ attr, rows: list }) => ({ attribute_id: attr.id, key: attr.key, name: attr.name, unit: attr.unit, data_type: attr.data_type, value: displayValue(attr, list), raw: formValue(attr, list) }));
};

/** Required attributes (by category) that a product is missing. Returns names. */
const missingRequired = async (db, productId) => {
  const required = await db.category_attributes.findMany({
    where: { is_required: true, categories: { product_categories: { some: { product_id: BigInt(productId) } } } },
    include: { attribute_definitions: { select: { id: true, name: true, scope: true } } },
  });
  if (!required.length) return [];
  const have = new Set(
    (await db.product_attribute_values.findMany({ where: { product_id: BigInt(productId) }, select: { attribute_id: true } })).map((r) => String(r.attribute_id)),
  );
  return [...new Map(required.map((r) => [String(r.attribute_id), r.attribute_definitions])).values()].filter((a) => !have.has(String(a.id))).map((a) => a.name);
};

/**
 * Replaces the product-level values of the given attributes.
 * values: [{ attribute_id, value }] (value null/"" clears it). Only attributes visible to the company.
 */
const setProductValues = async (tx, { companyId, productId, values }) => {
  if (!Array.isArray(values)) throw new HttpError(400, "values must be a list");
  const ids = [...new Set(values.map((v) => String(v.attribute_id)))].filter((x) => /^\d+$/.test(x));
  const attrs = await tx.attribute_definitions.findMany({ where: { id: { in: ids.map((x) => BigInt(x)) }, ...visibleTo(companyId) }, include: { attribute_options: true } });
  const byId = new Map(attrs.map((a) => [String(a.id), a]));
  for (const v of values) {
    const attr = byId.get(String(v.attribute_id));
    if (!attr) throw new HttpError(400, "Unknown attribute");
    if (attr.scope === "variant") throw new HttpError(400, `${attr.name} is set per variant`);
    await ensureOptions(tx, attr, v.value, companyId);
    const rows = valueRows(attr, v.value);
    await tx.product_attribute_values.deleteMany({ where: { product_id: BigInt(productId), variant_id: null, attribute_id: attr.id } });
    if (rows.length) {
      await tx.product_attribute_values.createMany({ data: rows.map((r) => ({ product_id: BigInt(productId), attribute_id: attr.id, ...r })) });
    }
  }
};

/** Creates or updates the attributes of a template (by key) and links them to a category. */
const applyTemplate = async (tx, { categoryId, template }) => {
  const t = TEMPLATES[template];
  if (!t) throw new HttpError(400, `Template must be one of: ${Object.keys(TEMPLATES).join(", ")}`);
  let order = 0;
  for (const a of t.attributes) {
    let def = await tx.attribute_definitions.findFirst({ where: { company_id: null, key: a.key } });
    if (!def) {
      const { options, ...rest } = a;
      def = await tx.attribute_definitions.create({ data: { scope: "product", ...rest } });
    }
    for (const [i, value] of (a.options || []).entries()) {
      const exists = await tx.attribute_options.findFirst({ where: { attribute_id: def.id, value: { equals: value, mode: "insensitive" } } });
      if (!exists) await tx.attribute_options.create({ data: { attribute_id: def.id, value, sort_order: i } });
    }
    await tx.category_attributes.upsert({
      where: { category_id_attribute_id: { category_id: BigInt(categoryId), attribute_id: def.id } },
      create: { category_id: BigInt(categoryId), attribute_id: def.id, sort_order: order++ },
      update: {},
    });
  }
  return t;
};

module.exports = {
  TYPES, SCOPES, OPTION_TYPES, TEMPLATES, cleanKey, definitionData, visibleTo, findOption, ensureOptions, valueRows, displayValue, formValue,
  specificationsFor, missingRequired, setProductValues, applyTemplate,
};
