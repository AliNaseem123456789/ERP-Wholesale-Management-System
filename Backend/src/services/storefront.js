// Company storefronts: predefined sections and themes only (no HTML, scripts or free-form code).
//   config = { theme, colors: { primary, accent }, sections: [{ id, type, enabled, title, subtitle, layout, ...type fields }] }
// Everything a section points at (products, collections, brands, categories, images, links) is validated on save,
// and resolved again on every render, so deleted / hidden / unpublished things are simply skipped.
const crypto = require("crypto");
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");
const { publicWhere, forViewer, decorate } = require("./catalog");
const { getMarketplaceSettings } = require("./marketplaceSettings");

const THEMES = {
  classic: { name: "Classic", primary: "#2563eb", accent: "#f59e0b", background: "#ffffff", text: "#111827", radius: "16px", font: "Inter" },
  modern: { name: "Modern", primary: "#0f172a", accent: "#14b8a6", background: "#f8fafc", text: "#0f172a", radius: "24px", font: "Inter" },
  bold: { name: "Bold", primary: "#7c3aed", accent: "#ec4899", background: "#ffffff", text: "#111827", radius: "12px", font: "Inter" },
  minimal: { name: "Minimal", primary: "#111827", accent: "#6b7280", background: "#ffffff", text: "#111827", radius: "4px", font: "Inter" },
};

const PRODUCT_LAYOUTS = ["grid", "carousel", "list"];
// type -> { label, layouts, fields }  (fields beyond the common ones)
const SECTIONS = {
  hero: { label: "Hero banner", layouts: ["full", "split"], fields: ["image_url", "image_alt", "text", "link", "link_label"] },
  promo_banners: { label: "Promotional banners", layouts: ["row", "stack"], fields: ["items"] },
  featured_products: { label: "Featured products", layouts: PRODUCT_LAYOUTS, fields: ["product_ids", "limit"] },
  product_grid: { label: "Product grid", layouts: PRODUCT_LAYOUTS, fields: ["category_id", "brand_id", "sort", "limit"] },
  collection: { label: "Collection", layouts: PRODUCT_LAYOUTS, fields: ["collection_id", "limit"] },
  featured_brands: { label: "Featured brands", layouts: ["logos", "list"], fields: ["brand_ids"] },
  category_tiles: { label: "Category tiles", layouts: ["tiles", "list"], fields: ["category_ids"] },
  announcement: { label: "Announcement", layouts: ["bar", "card"], fields: ["text", "link", "link_label"] },
  about: { label: "About us", layouts: ["text", "split"], fields: ["text", "image_url", "image_alt"] },
  contact: { label: "Contact & terms", layouts: ["card"], fields: [] },
  deals: { label: "Wholesale offers", layouts: PRODUCT_LAYOUTS, fields: ["limit"] },
};
const MAX_SECTIONS = 30;

const fail = (msg) => { throw new HttpError(400, msg); };
const text = (v, max, label) => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" && typeof v !== "number") fail(`${label} must be text`);
  const s = String(v).replace(/<[^>]*>/g, "").trim(); // plain text only
  if (s.length > max) fail(`${label} is too long (max ${max} characters)`);
  return s;
};
/** Internal path ("/products/x") or http(s) address. */
const link = (v, label) => {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\/(?!\/)[\w\-./?=&%#~+:]*$/.test(s)) return s.slice(0, 500);
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString().slice(0, 1000);
  } catch { /* fall through */ }
  fail(`${label}: use a page on this site (starting with /) or a web address starting with https://`);
};
const image = (v, label) => {
  if (!v) return "";
  const s = String(v).trim();
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return s.slice(0, 1000);
  } catch { /* fall through */ }
  fail(`${label}: image must be a web address starting with https://`);
};
const ids = (v, label, max = 48) => {
  if (v === undefined || v === null || v === "") return [];
  if (!Array.isArray(v)) fail(`${label} must be a list`);
  if (v.length > max) fail(`${label}: at most ${max}`);
  return [...new Set(v.map((x) => { if (!/^\d+$/.test(String(x))) fail(`${label}: invalid id`); return String(x); }))];
};
const oneId = (v, label) => (v === undefined || v === null || v === "" ? null : (/^\d+$/.test(String(v)) ? String(v) : fail(`${label}: invalid id`)));
const hex = (v, label) => (v === undefined || v === null || v === "" ? null : (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v).toLowerCase() : fail(`${label} must be a colour like #2563eb`)));

/** Validates and cleans a storefront config. Unknown keys are dropped. */
const sanitize = async (input, { allowed } = {}) => {
  const settings = allowed || (await getMarketplaceSettings()).storefront;
  const cfg = input && typeof input === "object" ? input : {};
  const theme = cfg.theme || settings.themes[0] || "classic";
  if (!THEMES[theme] || !settings.themes.includes(theme)) fail(`Theme must be one of: ${settings.themes.join(", ")}`);
  const colors = {};
  if (settings.custom_colors) {
    const c = cfg.colors || {};
    if (hex(c.primary, "Main colour")) colors.primary = hex(c.primary, "Main colour");
    if (hex(c.accent, "Accent colour")) colors.accent = hex(c.accent, "Accent colour");
  }
  const raw = Array.isArray(cfg.sections) ? cfg.sections : [];
  if (raw.length > MAX_SECTIONS) fail(`At most ${MAX_SECTIONS} sections`);
  const sections = raw.map((s, i) => {
    const n = `Section ${i + 1}`;
    const def = SECTIONS[s?.type];
    if (!def) fail(`${n}: unknown section type`);
    if (!settings.sections.includes(s.type)) fail(`${n}: ${def.label} sections aren't available`);
    const out = {
      id: /^[a-z0-9-]{4,40}$/.test(String(s.id || "")) ? String(s.id) : crypto.randomUUID().slice(0, 12),
      type: s.type,
      enabled: s.enabled !== false,
      title: text(s.title, 120, `${n} title`),
      subtitle: text(s.subtitle, 240, `${n} subtitle`),
      layout: def.layouts.includes(s.layout) ? s.layout : def.layouts[0],
    };
    for (const f of def.fields) {
      if (f === "image_url") out.image_url = image(s.image_url, `${n} image`);
      if (f === "image_alt") out.image_alt = text(s.image_alt, 200, `${n} image description`);
      if (f === "text") out.text = text(s.text, 4000, `${n} text`);
      if (f === "link") out.link = link(s.link, `${n} link`);
      if (f === "link_label") out.link_label = text(s.link_label, 60, `${n} button text`);
      if (f === "product_ids") out.product_ids = ids(s.product_ids, `${n} products`);
      if (f === "brand_ids") out.brand_ids = ids(s.brand_ids, `${n} brands`, 40);
      if (f === "category_ids") out.category_ids = ids(s.category_ids, `${n} categories`, 24);
      if (f === "collection_id") out.collection_id = oneId(s.collection_id, `${n} collection`);
      if (f === "category_id") out.category_id = oneId(s.category_id, `${n} category`);
      if (f === "brand_id") out.brand_id = oneId(s.brand_id, `${n} brand`);
      if (f === "sort") out.sort = ["newest", "featured", "title"].includes(s.sort) ? s.sort : "newest";
      if (f === "limit") out.limit = Math.min(48, Math.max(1, parseInt(s.limit, 10) || 8));
      if (f === "items") {
        const items = Array.isArray(s.items) ? s.items : [];
        if (items.length > 6) fail(`${n}: at most 6 banners`);
        out.items = items.map((it, j) => {
          const m = `${n} banner ${j + 1}`;
          const img = image(it?.image_url, m);
          if (!img) fail(`${m}: add an image`);
          return { image_url: img, image_alt: text(it.image_alt, 200, `${m} description`), title: text(it.title, 120, `${m} title`), link: link(it.link, `${m} link`) };
        });
      }
    }
    if (s.type === "collection" && !out.collection_id) fail(`${n}: choose a collection`);
    return out;
  });
  return { theme, colors, sections };
};

/**
 * Checks that everything the config points at belongs to (or may be used by) this company.
 * Returns warnings for things that exist but won't show (unpublished products, draft collections).
 */
const checkReferences = async (db, companyId, cfg) => {
  const cid = BigInt(companyId);
  const want = { products: new Set(), collections: new Set(), brands: new Set(), categories: new Set() };
  for (const s of cfg.sections) {
    (s.product_ids || []).forEach((x) => want.products.add(x));
    if (s.collection_id) want.collections.add(s.collection_id);
    (s.brand_ids || []).forEach((x) => want.brands.add(x));
    if (s.brand_id) want.brands.add(s.brand_id);
    (s.category_ids || []).forEach((x) => want.categories.add(x));
    if (s.category_id) want.categories.add(s.category_id);
  }
  const big = (set) => [...set].map((x) => BigInt(x));
  const [products, collections, brands, categories] = await Promise.all([
    want.products.size ? db.products.findMany({ where: { id: { in: big(want.products) } }, select: { id: true, company_id: true, status: true, title: true } }) : [],
    want.collections.size ? db.collections.findMany({ where: { id: { in: big(want.collections) } }, select: { id: true, company_id: true, status: true, is_enabled: true, name: true } }) : [],
    want.brands.size ? db.company_brands.findMany({ where: { company_id: cid, brand_id: { in: big(want.brands) } }, select: { brand_id: true } }) : [],
    want.categories.size ? db.categories.findMany({ where: { id: { in: big(want.categories) } }, select: { id: true, status: true } }) : [],
  ]);
  const warnings = [];
  for (const id of want.products) {
    const p = products.find((x) => String(x.id) === id);
    if (!p || p.company_id !== cid) fail("One of the chosen products isn't one of yours");
    if (p.status !== "published") warnings.push(`"${p.title}" isn't published, so it won't show`);
  }
  for (const id of want.collections) {
    const c = collections.find((x) => String(x.id) === id);
    if (!c || (c.company_id !== null && c.company_id !== cid)) fail("One of the chosen collections isn't one of yours");
    if (c.status !== "published" || !c.is_enabled) warnings.push(`Collection "${c.name}" isn't published, so it won't show`);
  }
  for (const id of want.brands) if (!brands.some((b) => String(b.brand_id) === id)) fail("One of the chosen brands isn't in your brand list");
  for (const id of want.categories) {
    const c = categories.find((x) => String(x.id) === id);
    if (!c) fail("One of the chosen categories doesn't exist");
    if (c.status !== "active") warnings.push("A chosen category is hidden, so it won't show");
  }
  return warnings;
};

/** A sensible first layout built from the company's own data. */
const defaultConfig = (company) => ({
  theme: "classic",
  colors: {},
  sections: [
    { id: "hero-1", type: "hero", enabled: true, title: company.name, subtitle: company.tagline || "", layout: "full", image_url: company.banner_url || "", image_alt: "", text: "", link: "", link_label: "" },
    { id: "featured-1", type: "featured_products", enabled: true, title: "Featured products", subtitle: "", layout: "grid", product_ids: [], limit: 8 },
    { id: "cats-1", type: "category_tiles", enabled: true, title: "Shop by category", subtitle: "", layout: "tiles", category_ids: [] },
    { id: "grid-1", type: "product_grid", enabled: true, title: "New arrivals", subtitle: "", layout: "grid", category_id: null, brand_id: null, sort: "newest", limit: 12 },
    { id: "brands-1", type: "featured_brands", enabled: true, title: "Brands we supply", subtitle: "", layout: "logos", brand_ids: [] },
    { id: "about-1", type: "about", enabled: !!company.description, title: "About us", subtitle: "", layout: "text", text: company.description || "", image_url: "", image_alt: "" },
    { id: "contact-1", type: "contact", enabled: true, title: "Contact & terms", subtitle: "", layout: "card" },
  ],
});

/** Promo codes the seller chose to advertise, currently valid. */
const publicPromotions = async (companyId, now = new Date()) => {
  const rows = await prisma.promotions.findMany({
    where: { company_id: BigInt(companyId), is_active: true, show_on_storefront: true, AND: [{ OR: [{ starts_at: null }, { starts_at: { lte: now } }] }, { OR: [{ ends_at: null }, { ends_at: { gte: now } }] }] },
    orderBy: { created_at: "desc" }, take: 6,
  });
  return rows.filter((p) => p.max_uses === null || p.uses_count < p.max_uses)
    .map((p) => ({ code: p.code, description: p.description, type: p.type, value: Number(p.value), min_order_amount: Number(p.min_order_amount), ends_at: p.ends_at }));
};

const liveCollection = (now) => ({ status: "published", is_enabled: true, AND: [{ OR: [{ starts_at: null }, { starts_at: { lte: now } }] }, { OR: [{ ends_at: null }, { ends_at: { gte: now } }] }] });

/** Products of a collection, in its order, that this viewer may see. */
const collectionProducts = async (req, collectionId, companyId, limit) => {
  const links = await prisma.collection_products.findMany({ where: { collection_id: BigInt(collectionId) }, orderBy: { sort_order: "asc" }, select: { product_id: true } });
  if (!links.length) return [];
  const rows = await prisma.products.findMany({
    where: { ...publicWhere(req), id: { in: links.map((l) => l.product_id) }, ...(companyId ? { company_id: BigInt(companyId) } : {}) },
    include: { companies: { select: { id: true, name: true, slug: true, logo_url: true } } },
  });
  const order = new Map(links.map((l, i) => [String(l.product_id), i]));
  rows.sort((a, b) => order.get(String(a.id)) - order.get(String(b.id)));
  return decorate(req, rows.slice(0, limit).map(forViewer(req)), { variants: false });
};

/**
 * Resolves a config into what the page shows. Sections with nothing to show are left out.
 * company: full company row.
 */
const render = async (req, company, cfg) => {
  const cid = company.id;
  const now = new Date();
  const base = { ...publicWhere(req), company_id: cid };
  const include = { companies: { select: { id: true, name: true, slug: true, logo_url: true } } };
  const shape = async (rows) => decorate(req, rows.map(forViewer(req)), { variants: false });
  // every section is looked up at the same time; the page keeps their order
  const one = async (s) => {
    const r = { ...s };
    switch (s.type) {
      case "featured_products": {
        let rows;
        if (s.product_ids?.length) {
          rows = await prisma.products.findMany({ where: { ...base, id: { in: s.product_ids.map((x) => BigInt(x)) } }, include });
          const order = new Map(s.product_ids.map((x, i) => [x, i]));
          rows.sort((a, b) => order.get(String(a.id)) - order.get(String(b.id)));
        } else {
          rows = await prisma.products.findMany({ where: { ...base, is_featured: true }, include, orderBy: { published_at: "desc" }, take: s.limit || 8 });
        }
        r.products = await shape(rows.slice(0, s.limit || 48));
        if (!r.products.length) return null;
        return r;
      }
      case "product_grid": {
        const where = { ...base };
        if (s.category_id) {
          const { activeCategories, descendants } = require("./marketplace");
          where.product_categories = { some: { category_id: { in: descendants(await activeCategories(), s.category_id) } } };
        }
        if (s.brand_id) where.brand_id = BigInt(s.brand_id);
        const orderBy = s.sort === "title" ? { title: "asc" } : s.sort === "featured" ? [{ is_featured: "desc" }, { published_at: "desc" }] : { published_at: "desc" };
        r.products = await shape(await prisma.products.findMany({ where, include, orderBy, take: s.limit || 12 }));
        if (!r.products.length) return null;
        return r;
      }
      case "deals": {
        // this seller's products on sale or with volume prices, plus its advertised promo codes
        const { dealsWhere } = require("./marketplace");
        [r.products, r.promotions] = await Promise.all([
          prisma.products.findMany({ where: { AND: [base, dealsWhere(now)] }, include, orderBy: [{ sale_percent: { sort: "desc", nulls: "last" } }, { published_at: "desc" }], take: s.limit || 8 }).then(shape),
          publicPromotions(cid, now),
        ]);
        if (!r.products.length && !r.promotions.length) return null;
        return r;
      }
      case "collection": {
        const c = await prisma.collections.findFirst({ where: { id: BigInt(s.collection_id), OR: [{ company_id: cid }, { company_id: null }], ...liveCollection(now) } });
        if (!c) return null;
        r.collection = { id: c.id, name: c.name, slug: c.slug, description: c.description, cover_image_url: c.cover_image_url };
        r.products = await collectionProducts(req, c.id, cid, s.limit || 8);
        if (!r.products.length) return null;
        return r;
      }
      case "featured_brands": {
        const links = await prisma.company_brands.findMany({
          where: { company_id: cid, ...(s.brand_ids?.length ? { brand_id: { in: s.brand_ids.map((x) => BigInt(x)) } } : { brands: { products: { some: base } } }) },
          include: { brands: { select: { id: true, name: true, slug: true, logo_url: true } } },
          take: 40,
        });
        r.brands = links.map((l) => ({ ...l.brands, relationship: l.relationship }));
        if (s.brand_ids?.length) { const o = new Map(s.brand_ids.map((x, i) => [x, i])); r.brands.sort((a, b) => o.get(String(a.id)) - o.get(String(b.id))); }
        if (!r.brands.length) return null;
        return r;
      }
      case "category_tiles": {
        let cats;
        if (s.category_ids?.length) {
          cats = await prisma.categories.findMany({ where: { id: { in: s.category_ids.map((x) => BigInt(x)) }, status: "active" }, select: { id: true, name: true, slug: true, image_url: true } });
          const o = new Map(s.category_ids.map((x, i) => [x, i]));
          cats.sort((a, b) => o.get(String(a.id)) - o.get(String(b.id)));
        } else {
          const groups = await prisma.product_categories.groupBy({ by: ["category_id"], where: { products: base }, _count: true, orderBy: { _count: { category_id: "desc" } }, take: 8 });
          cats = await prisma.categories.findMany({ where: { id: { in: groups.map((g) => g.category_id) }, status: "active" }, select: { id: true, name: true, slug: true, image_url: true } });
          const o = new Map(groups.map((g, i) => [String(g.category_id), i]));
          cats.sort((a, b) => o.get(String(a.id)) - o.get(String(b.id)));
        }
        r.categories = cats;
        if (!cats.length) return null;
        return r;
      }
      case "promo_banners":
        if (!s.items?.length) return null;
        return r;
      case "hero":
        r.image_url = s.image_url || company.banner_url || "";
        r.title = s.title || company.name;
        r.subtitle = s.subtitle || company.tagline || "";
        return r;
      case "about":
        r.text = s.text || company.description || "";
        if (!r.text) return null;
        return r;
      case "announcement":
        if (!s.text) return null;
        return r;
      case "contact":
        r.contact = publicContact(company);
        return r;
      default:
        return r;
    }
    return r;
  };
  const built = await Promise.all((cfg.sections || []).filter((s) => s.enabled).map(one));
  return built.filter(Boolean);
};

const publicContact = (c) => ({
  email: c.public_email || c.email || null,
  phone: c.public_phone || c.phone || null,
  website: c.website || null,
  city: c.city || null,
  state: c.state || null,
  country: c.country || null,
  delivery_info: c.delivery_info || null,
  payment_info: c.payment_info || null,
  min_order_value: c.min_order_value === null || c.min_order_value === undefined ? null : Number(c.min_order_value),
  lead_time_days: c.lead_time_days ?? null,
});

/** Theme colours after applying the company's (allowed) overrides. */
const themeOf = (cfg) => ({ key: cfg.theme, ...THEMES[cfg.theme] || THEMES.classic, ...(cfg.colors || {}) });

module.exports = { publicPromotions, THEMES, SECTIONS, sanitize, checkReferences, defaultConfig, render, collectionProducts, liveCollection, publicContact, themeOf };
