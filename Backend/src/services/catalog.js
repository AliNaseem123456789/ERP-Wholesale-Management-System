// What customers can see in the storefront, and how products are shaped for them.
//   - only published products of active companies, and only the ones visible to this viewer
//     (products limited to customer groups are shown to members of those groups only)
//   - only public fields: costs, reorder levels, suppliers and other internal data never leave the API
//   - prices only for logged-in customers
const prisma = require("../prisma");

// Kept for code that has no request at hand (public products only, no group-only ones).
const publicProductWhere = {
  status: "published",
  is_active: true,
  visibility: "public",
  companies: { is: { status: "active", storefront_published: true } },
};

/** Storefront filter for this viewer: published + active seller + (public or one of the viewer's customer groups). */
const publicWhere = (req) => {
  const userId = req?.user?.id;
  // approved seller whose storefront isn't unpublished by a platform admin
  const base = { status: "published", is_active: true, companies: { is: { status: "active", storefront_published: true } } };
  if (!userId) return { ...base, visibility: "public" };
  return {
    ...base,
    OR: [
      { visibility: "public" },
      {
        visibility: "groups",
        product_visible_groups: { some: { customer_groups: { company_customers: { some: { user_id: BigInt(userId), status: "active" } } } } },
      },
    ],
  };
};

const companyBrief = { select: { id: true, name: true, slug: true, logo_url: true } };

// Product columns customers may see. Anything not listed here (cost_price, reorder levels,
// preferred supplier, alert timestamps, visibility settings...) is dropped.
const PUBLIC_FIELDS = [
  "id", "title", "brand", "brand_id", "description", "short_description", "sku", "barcode", "categories", "flavors",
  "url", "created_at", "updated_at", "company_id", "is_active", "status", "unit", "slug", "min_order_qty", "order_multiple",
  "pack_size", "is_featured", "published_at", "compliance_category", "nicotine_ml", "is_flavored", "allow_preorder",
];
const PUBLIC_VARIANT_FIELDS = ["id", "flavor", "name", "sku", "barcode", "status", "min_order_qty", "image_url", "sort_order"];

const pick = (obj, fields) => {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
};

// Shapes a product row for a customer. Also renames the Prisma relation `companies` to `company`.
const forViewer = (req) => (product) => {
  if (!product) return product;
  const out = pick(product, PUBLIC_FIELDS);
  out.company = product.companies ?? product.company ?? null;
  if (req?.user) out.price = product.price;
  // a running sale is public (the sale price itself is added for signed-in buyers by the pricing step)
  const { saleActive } = require("./pricing");
  if (saleActive(product)) out.sale = { percent: Number(product.sale_percent), label: product.sale_label || null, ends_at: product.sale_ends_at || null };
  return out;
};

// Average rating and count of published reviews: product.rating = { average, count } (only when reviewed).
const withRatings = async (products) => {
  const list = products.filter(Boolean);
  if (!list.length) return;
  const rows = await prisma.reviews.groupBy({
    by: ["product_id"], where: { product_id: { in: list.map((p) => BigInt(p.id)) }, status: "published" },
    _avg: { rating: true }, _count: true,
  });
  const by = new Map(rows.map((r) => [String(r.product_id), r]));
  for (const p of list) {
    const r = by.get(String(p.id));
    if (r) p.rating = { average: Math.round(r._avg.rating * 10) / 10, count: r._count };
  }
};

// Adds stock info for products of companies that track inventory:
//   stock_status: "in_stock" | "out_of_stock"  (everyone)
//   available: number                          (logged-in customers only)
//   flavor_stock: { [variant]: number }        (logged-in customers, products with variants)
// Products of companies that don't track inventory get stock_status: null (always buyable).
// Available = on hand - reserved - ordered but not yet confirmed.
const withStock = async (req, products) => {
  const list = products.filter(Boolean);
  if (!list.length) return products;
  const inv = require("./inventory");
  const companyIds = [...new Set(list.map((p) => String(p.company_id ?? p.company?.id ?? "")).filter(Boolean))];
  const tracked = await trackedCompanyIds(prisma, companyIds);
  const trackedProducts = list.filter((p) => tracked.has(String(p.company_id ?? p.company?.id)));
  const ids = trackedProducts.map((p) => p.id);
  const preIds = trackedProducts.filter((p) => p.allow_preorder).map((p) => p.id);
  const [avail, byFlavor, incoming] = await Promise.all([
    inv.availabilityFor(ids), req?.user || preIds.length ? inv.availabilityByFlavor(ids) : new Map(), inv.incomingFromSuppliers(preIds),
  ]);
  for (const p of list) {
    if (!tracked.has(String(p.company_id ?? p.company?.id))) {
      p.stock_status = null;
      continue;
    }
    const a = Math.max(0, avail.get(String(p.id)) ?? 0);
    p.stock_status = a > 0 ? "in_stock" : "out_of_stock";
    // pre-orders: products that may be ordered ahead of stock already ordered from suppliers.
    // What earlier pre-orders took (availability below zero) is taken off the incoming quantity,
    // so the same incoming units can't be pre-ordered twice.
    if (p.allow_preorder) {
      const keys = inv.hasFlavors(p) ? inv.flavorsOf(p) : [""];
      const net = (k) => {
        const inc = incoming.get(inv.flavorKey(p.id, k))?.qty || 0;
        const raw = byFlavor.get(inv.flavorKey(p.id, k)) ?? 0;
        return Math.max(0, inc + Math.min(0, raw));
      };
      const inc = keys.map((k) => incoming.get(inv.flavorKey(p.id, k))).filter(Boolean);
      if (inc.length) {
        const left = keys.reduce((s, k) => s + net(k), 0);
        if (a <= 0 && left > 0) p.stock_status = "preorder";
        p.expected_date = inc.map((x) => x.expected).filter(Boolean).sort()[0] || null;
        if (req?.user) p.incoming_stock = Object.fromEntries(keys.map((k) => [k, net(k)]));
      }
    }
    if (req?.user) {
      p.available = a;
      if (inv.hasFlavors(p)) {
        p.flavor_stock = Object.fromEntries(inv.flavorsOf(p).map((f) => [f, Math.max(0, byFlavor.get(inv.flavorKey(p.id, f)) ?? 0)]));
      }
    }
  }
  return products;
};

const trackedCompanyIds = async (db, companyIds) => {
  if (!companyIds.length) return new Set();
  const rows = await db.companies.findMany({
    where: { id: { in: companyIds.map((id) => BigInt(id)) }, settings: { path: ["inventory", "tracking"], equals: true } },
    select: { id: true },
  });
  return new Set(rows.map((r) => String(r.id)));
};

/**
 * Adds `variants` (public fields, option values, and for logged-in customers their price) and
 * `images` (the gallery) to products. Archived variants are left out; discontinued ones are listed
 * with status "discontinued" so the page can show them as unavailable.
 */
const withVariantsAndImages = async (req, products) => {
  const list = products.filter(Boolean);
  if (!list.length) return products;
  const ids = list.map((p) => BigInt(p.id));
  const [variants, images] = await Promise.all([
    prisma.product_variants.findMany({
      where: { product_id: { in: ids }, status: { not: "archived" } },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      include: {
        product_attribute_values: {
          where: { attribute_definitions: { is_public: true } },
          include: { attribute_definitions: { select: { key: true, name: true, unit: true } }, attribute_options: { select: { value: true } } },
        },
      },
    }),
    prisma.product_images.findMany({ where: { product_id: { in: ids } }, orderBy: [{ sort_order: "asc" }, { id: "asc" }] }),
  ]);
  for (const p of list) {
    const keys = new Set((p.flavors || []).map((f) => String(f).trim()));
    p.variants = variants
      .filter((v) => String(v.product_id) === String(p.id) && keys.has(v.flavor))
      .map((v) => {
        const out = { ...pick(v, PUBLIC_VARIANT_FIELDS), name: v.name || v.flavor };
        out.options = v.product_attribute_values.map((av) => ({
          key: av.attribute_definitions.key,
          name: av.attribute_definitions.name,
          value: av.attribute_options?.value ?? av.value_text ?? (av.value_number !== null ? `${Number(av.value_number)}${av.attribute_definitions.unit ? ` ${av.attribute_definitions.unit}` : ""}` : null),
        }));
        if (req?.user) out.price = v.price ?? p.price ?? null;
        return out;
      });
    p.images = images
      .filter((i) => String(i.product_id) === String(p.id))
      .map((i) => ({ id: i.id, url: i.url, alt_text: i.alt_text, variant_key: i.variant_key }));
  }
  return products;
};

/**
 * `image`: the product's main image for cards and lists: its first gallery image, else an uploaded image
 * address in products.url, else null (the page then uses the original image path product-images/<id>/1.webp).
 */
const withMainImage = async (products) => {
  const list = products.filter(Boolean);
  if (!list.length) return;
  const { isImageUrl } = require("./productCatalog");
  const rows = await prisma.product_images.findMany({
    where: { product_id: { in: list.map((p) => BigInt(p.id)) } },
    orderBy: [{ product_id: "asc" }, { sort_order: "asc" }, { id: "asc" }],
    distinct: ["product_id"],
    select: { product_id: true, url: true },
  });
  const first = new Map(rows.map((r) => [String(r.product_id), r.url]));
  for (const p of list) p.image = first.get(String(p.id)) || (isImageUrl(p.url) ? p.url : null);
};

// Customers only pick variants that are on sale: discontinued and archived ones are taken out of `flavors`.
const hideInactiveVariants = async (products) => {
  const list = products.filter((p) => p && (p.flavors || []).length);
  if (!list.length) return;
  const off = await prisma.product_variants.findMany({
    where: { product_id: { in: list.map((p) => BigInt(p.id)) }, status: { not: "active" } },
    select: { product_id: true, flavor: true },
  });
  if (!off.length) return;
  const offSet = new Set(off.map((v) => `${v.product_id}|${v.flavor}`));
  for (const p of list) {
    p.flavors = p.flavors.filter((f) => !offSet.has(`${p.id}|${f}`));
    if (p.flavor_stock) for (const k of Object.keys(p.flavor_stock)) if (offSet.has(`${p.id}|${k}`)) delete p.flavor_stock[k];
  }
};

// Stock status + the logged-in customer's own prices (group price lists, volume tiers, discounts).
// `variants: true` also adds the variant list and image gallery (product pages).
const decorate = async (req, products, { variants = true } = {}) => {
  await withStock(req, products);
  if (variants) await withVariantsAndImages(req, products);
  await withMainImage(products);
  await hideInactiveVariants(products);
  await withRatings(products);
  const { applyCustomerPricing } = require("./pricing");
  await applyCustomerPricing(req, products);
  return products;
};

module.exports = {
  publicProductWhere, publicWhere, companyBrief, forViewer, withStock, withVariantsAndImages, withMainImage, decorate, trackedCompanyIds, withRatings,
  PUBLIC_FIELDS, PUBLIC_VARIANT_FIELDS,
};
