// Collections: hand-picked, ordered product lists. A company's collections only contain its own products;
// platform collections (company_id NULL) may contain any published product. Rule-based collections are reserved (mode).
const { HttpError, toId } = require("../utils/http");
const { slugOf, isHttpUrl } = require("./productCatalog");

const MAX_PRODUCTS = 500;

const dateOrNull = (v, label) => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} isn't a valid date`);
  return d;
};

const uniqueSlug = async (db, companyId, base, exceptId) => {
  const root = slugOf(base).slice(0, 100);
  for (let i = 1; i < 300; i++) {
    const slug = i === 1 ? root : `${root}-${i}`;
    const taken = await db.collections.findFirst({ where: { company_id: companyId, slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
    if (!taken) return slug;
  }
  throw new HttpError(409, "Choose a different web address");
};

/** Validated fields from a form. */
const collectionData = (b, { creating }) => {
  const d = {};
  if (creating || b.name !== undefined) {
    d.name = String(b.name || "").trim().slice(0, 255);
    if (!d.name) throw new HttpError(400, "Name is required");
  }
  if (b.slug !== undefined && b.slug !== "") {
    const s = String(b.slug).trim().toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) throw new HttpError(400, "Web address can only use lowercase letters, numbers and dashes");
    d.slug = s;
  }
  if (b.description !== undefined) d.description = b.description ? String(b.description).slice(0, 5000) : null;
  if (b.cover_image_url !== undefined) {
    if (b.cover_image_url && !isHttpUrl(b.cover_image_url)) throw new HttpError(400, "Cover image must be a web address (https://...)");
    d.cover_image_url = b.cover_image_url || null;
  }
  if (b.status !== undefined) {
    if (!["draft", "published"].includes(b.status)) throw new HttpError(400, "Status must be draft or published");
    d.status = b.status;
  }
  if (b.is_enabled !== undefined) d.is_enabled = !!b.is_enabled;
  if (b.sort_order !== undefined) d.sort_order = Number.isInteger(Number(b.sort_order)) ? Number(b.sort_order) : 0;
  const s = dateOrNull(b.starts_at, "Start date");
  const e = dateOrNull(b.ends_at, "End date");
  if (s !== undefined) d.starts_at = s;
  if (e !== undefined) d.ends_at = e;
  if (d.starts_at && d.ends_at && d.ends_at < d.starts_at) throw new HttpError(400, "The end date is before the start date");
  return d;
};

/** Sets the products (in order). companyId null = platform collection (any product). */
const setProducts = async (db, collection, productIds) => {
  const ids = [...new Set((productIds || []).map((x) => String(toId(x, "product"))))];
  if (ids.length > MAX_PRODUCTS) throw new HttpError(400, `A collection can have at most ${MAX_PRODUCTS} products`);
  if (ids.length) {
    const found = await db.products.findMany({
      where: { id: { in: ids.map((x) => BigInt(x)) }, ...(collection.company_id ? { company_id: collection.company_id } : {}) },
      select: { id: true },
    });
    if (found.length !== ids.length) throw new HttpError(400, collection.company_id ? "Collections can only contain your own products" : "One of the products doesn't exist");
  }
  await db.collection_products.deleteMany({ where: { collection_id: collection.id } });
  if (ids.length) await db.collection_products.createMany({ data: ids.map((pid, i) => ({ collection_id: collection.id, product_id: BigInt(pid), sort_order: i })) });
};

const create = async (db, { companyId, userId, body }) => {
  const d = collectionData(body, { creating: true });
  const cid = companyId ? BigInt(companyId) : null;
  d.slug = d.slug ? d.slug : await uniqueSlug(db, cid, d.name);
  if (await db.collections.findFirst({ where: { company_id: cid, slug: d.slug } })) throw new HttpError(409, "That web address is already used by another collection");
  const c = await db.collections.create({ data: { ...d, company_id: cid, created_by: userId ? BigInt(userId) : null } });
  if (body.product_ids !== undefined) await setProducts(db, c, body.product_ids);
  return c;
};

const update = async (db, { collection, body }) => {
  const d = collectionData(body, { creating: false });
  if (d.slug && d.slug !== collection.slug && (await db.collections.findFirst({ where: { company_id: collection.company_id, slug: d.slug, NOT: { id: collection.id } } }))) {
    throw new HttpError(409, "That web address is already used by another collection");
  }
  const c = await db.collections.update({ where: { id: collection.id }, data: { ...d, updated_at: new Date() } });
  if (body.product_ids !== undefined) await setProducts(db, c, body.product_ids);
  return c;
};

/** Collection with its products (company view: every status, so staff see what won't show). */
const detail = async (db, collection) => {
  const links = await db.collection_products.findMany({
    where: { collection_id: collection.id }, orderBy: { sort_order: "asc" },
    include: { products: { select: { id: true, title: true, brand: true, sku: true, status: true, price: true, url: true, company_id: true, product_images: { take: 1, orderBy: { sort_order: "asc" }, select: { url: true } } } } },
  });
  return {
    ...collection,
    products: links.map((l) => {
      const { product_images, ...p } = l.products;
      return { ...p, image: product_images[0]?.url || null };
    }),
  };
};

const live = (c, now = new Date()) => c.status === "published" && c.is_enabled && (!c.starts_at || c.starts_at <= now) && (!c.ends_at || c.ends_at >= now);

module.exports = { collectionData, setProducts, create, update, detail, live };
