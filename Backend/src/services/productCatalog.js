// Shared catalogue helpers: categories, brands, images and the publish check.
// Used by the company back office, the platform admin and CSV import so every path keeps the
// new records and the older text columns (products.categories, products.brand, products.url) in step.
const crypto = require("crypto");
const { HttpError } = require("../utils/http");

const RELATIONSHIPS = ["manufacturer", "authorized_distributor", "distributor", "reseller"];
const PRODUCT_STATUSES = ["draft", "published", "hidden", "discontinued", "archived"];

const slugOf = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "item";

// ---- categories --------------------------------------------------------------------------------

/** Unique category slug (appends -2, -3... when taken). */
const uniqueCategorySlug = async (db, name, exceptId = null) => {
  const base = slugOf(name).slice(0, 120);
  for (let i = 1; i < 500; i++) {
    const s = i === 1 ? base : `${base}-${i}`;
    const taken = await db.categories.findFirst({ where: { slug: s, ...(exceptId ? { NOT: { id: BigInt(exceptId) } } : {}) }, select: { id: true } });
    if (!taken) return s;
  }
  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
};

/** Finds a category by name under a parent (ignoring case) or creates it. */
const findOrCreateCategory = async (db, { name, parentId = null, companyId = null, userId = null }) => {
  const clean = String(name || "").trim().slice(0, 255);
  if (!clean) throw new HttpError(400, "Category name is required");
  const existing = await db.categories.findFirst({ where: { parent_id: parentId ? BigInt(parentId) : null, name: { equals: clean, mode: "insensitive" } } });
  if (existing) return existing;
  return db.categories.create({
    data: {
      name: clean, slug: await uniqueCategorySlug(db, clean), parent_id: parentId ? BigInt(parentId) : null,
      created_by_company_id: companyId ? BigInt(companyId) : null, created_by: userId ? BigInt(userId) : null,
    },
  });
};

/** Sets a product's categories (ordered ids) and mirrors their names into products.categories. */
const setProductCategories = async (db, productId, categoryIds) => {
  const ids = [...new Set((categoryIds || []).map(String))].filter((x) => /^\d+$/.test(x));
  if (ids.length > 20) throw new HttpError(400, "A product can be in at most 20 categories");
  const cats = await db.categories.findMany({ where: { id: { in: ids.map((x) => BigInt(x)) } } });
  if (cats.length !== ids.length) throw new HttpError(400, "One of the categories doesn't exist");
  const ordered = ids.map((id) => cats.find((c) => String(c.id) === id));
  await db.product_categories.deleteMany({ where: { product_id: BigInt(productId) } });
  if (ordered.length) {
    await db.product_categories.createMany({ data: ordered.map((c, i) => ({ product_id: BigInt(productId), category_id: c.id, sort_order: i })) });
  }
  await db.products.update({ where: { id: BigInt(productId) }, data: { categories: ordered.map((c) => c.name) } });
  return ordered;
};

/** For code that writes category NAMES (old forms, CSV): links matching categories, creating missing ones. */
const syncCategoriesFromNames = async (db, productId, names, { companyId = null, userId = null } = {}) => {
  const list = [...new Set((names || []).map((n) => String(n).trim()).filter(Boolean))];
  const ids = [];
  for (const name of list) ids.push((await findOrCreateCategory(db, { name, companyId, userId })).id);
  await db.product_categories.deleteMany({ where: { product_id: BigInt(productId) } });
  if (ids.length) await db.product_categories.createMany({ data: ids.map((id, i) => ({ product_id: BigInt(productId), category_id: id, sort_order: i })), skipDuplicates: true });
};

// ---- brands ------------------------------------------------------------------------------------

/**
 * Finds a brand by name (ignoring case) or creates it, and records that the company sells it.
 * Any number of companies can sell the same brand.
 */
const linkCompanyBrand = async (db, companyId, name, relationship = null) => {
  const clean = String(name || "").trim().slice(0, 255);
  if (!clean) return null;
  let brand = await db.brands.findFirst({ where: { name: { equals: clean, mode: "insensitive" } } });
  if (!brand) brand = await db.brands.create({ data: { name: clean } });
  if (companyId) {
    if (relationship && !RELATIONSHIPS.includes(relationship)) throw new HttpError(400, `Relationship must be one of: ${RELATIONSHIPS.join(", ")}`);
    await db.company_brands.upsert({
      where: { company_id_brand_id: { company_id: BigInt(companyId), brand_id: brand.id } },
      create: { company_id: BigInt(companyId), brand_id: brand.id, relationship: relationship || "reseller" },
      update: relationship ? { relationship } : {},
    });
  }
  return brand;
};

// ---- images ------------------------------------------------------------------------------------

// An uploaded image address (not a link to a web page).
const isImageUrl = (u) => !!u && (/\/storage\/v1\/object\/public\//.test(u) || /\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(u));

/**
 * Older code reads products.url as the main image after an upload. Keep it equal to the first gallery image,
 * but never overwrite a non-image link (imported products keep the address of their source page there).
 */
const syncMainImage = async (db, productId) => {
  const p = await db.products.findUnique({ where: { id: BigInt(productId) }, select: { url: true } });
  if (p.url && !isImageUrl(p.url)) return;
  const first = await db.product_images.findFirst({ where: { product_id: BigInt(productId) }, orderBy: [{ sort_order: "asc" }, { id: "asc" }] });
  await db.products.update({ where: { id: BigInt(productId) }, data: { url: first ? first.url.slice(0, 255) : null } });
};

const isHttpUrl = (u) => {
  try {
    const x = new URL(String(u));
    return x.protocol === "https:" || x.protocol === "http:";
  } catch {
    return false;
  }
};

// ---- history -----------------------------------------------------------------------------------

// Tables whose rows block deleting a product (foreign keys without ON DELETE CASCADE / SET NULL), read once from the catalog.
let blockingRefs = null;
const loadBlockingRefs = async (db) => {
  if (blockingRefs) return blockingRefs;
  blockingRefs = await db.$queryRaw`
    SELECT cl.relname::text AS table_name, att.attname::text AS column_name
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f' AND con.confrelid = 'products'::regclass AND con.confdeltype IN ('a', 'r') AND array_length(con.conkey, 1) = 1`;
  return blockingRefs;
};

/** True when orders, stock movements, documents... point at the product (so it must be archived, not deleted). */
const productHasHistory = async (db, productId) => {
  for (const r of await loadBlockingRefs(db)) {
    const t = String(r.table_name).replace(/"/g, "");
    const c = String(r.column_name).replace(/"/g, "");
    const [row] = await db.$queryRawUnsafe(`SELECT EXISTS (SELECT 1 FROM "${t}" WHERE "${c}" = $1) AS used`, BigInt(productId));
    if (row.used) return true;
  }
  return false;
};

// ---- publishing --------------------------------------------------------------------------------

/** Reasons a product can't be published yet (empty list = ok). */
const publishProblems = async (db, productId) => {
  const { missingRequired } = require("./attributes");
  const p = await db.products.findUnique({
    where: { id: BigInt(productId) },
    include: { product_variants: { select: { flavor: true, price: true, status: true } } },
  });
  const out = [];
  if (!p.title?.trim()) out.push("a title");
  const keys = new Set((p.flavors || []).map((f) => String(f).trim()));
  const active = p.product_variants.filter((v) => keys.has(v.flavor) && v.status === "active");
  if (p.price === null && !(active.length && active.every((v) => v.price !== null))) out.push("a price (for the product or every variant)");
  if (keys.size && !active.length) out.push("at least one active variant");
  const missing = await missingRequired(db, productId);
  if (missing.length) out.push(`required details: ${missing.join(", ")}`);
  return out;
};

module.exports = {
  RELATIONSHIPS, PRODUCT_STATUSES, slugOf, uniqueCategorySlug, findOrCreateCategory, setProductCategories, syncCategoriesFromNames,
  linkCompanyBrand, syncMainImage, isHttpUrl, isImageUrl, publishProblems, productHasHistory,
};
