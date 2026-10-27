// The marketplace homepage, built from sections an admin arranges (Admin → Site → Homepage).
// Stored in site_settings "site_homepage": { draft, published, published_at, versions: [{ at, by, config }] }.
// Only predefined section types; what a section points at is resolved on every render (hidden products,
// categories or collections are simply skipped), with the same visibility and price rules as everywhere else.
const prisma = require("../prisma");
const { publicWhere, forViewer, decorate } = require("./catalog");
const mk = require("./marketplace");
const sf = require("./storefront");
const { getMarketplaceSettings, str, pathOrUrl, fail } = require("./marketplaceSettings");
const content = require("./siteContent");

const ICONS = ["headphones", "gift", "star", "truck", "shield", "clock", "tag", "users", "package", "credit-card", "globe", "award"];
const SECTIONS = {
  hero: { label: "Hero (slides)", fields: [] },
  banners: { label: "Homepage banners", fields: [] },
  categories: { label: "Category tiles", fields: ["source", "category_ids", "limit"], sources: ["featured", "top", "manual"] },
  products: { label: "Product row", fields: ["source", "category_id", "collection_id", "product_ids", "limit", "layout", "link"], sources: ["featured", "new", "best_sellers", "deals", "category", "collection", "manual"] },
  collections: { label: "Platform collections", fields: ["limit"] },
  brands: { label: "Brands", fields: ["source", "brand_ids", "limit"], sources: ["featured", "top", "manual"] },
  suppliers: { label: "Suppliers", fields: ["source", "company_ids", "limit"], sources: ["featured", "top", "manual"] },
  feature_tiles: { label: "Feature tiles (Site features)", fields: [] },
  text: { label: "Text block", fields: ["text", "image_url", "image_alt", "link", "link_label", "layout"] },
  features: { label: "Why choose us", fields: ["image_url", "items"] },
  logos: { label: "Logo strip", fields: ["items"] },
  recently_viewed: { label: "Recently viewed (per visitor)", fields: [] },
};
const LIMITS = { categories: 16, products: 24, collections: 4, brands: 24, suppliers: 12 };

const DEFAULT_FEATURES = [
  { icon: "headphones", title: "Best customer service", text: "Our support team is always ready to help you with quick and friendly service." },
  { icon: "gift", title: "Great offers & rewards", text: "Enjoy exclusive deals, discounts, and rewards designed for loyal customers." },
  { icon: "star", title: "Premium quality products", text: "We deliver only high-quality products crafted with care and precision." },
  { icon: "truck", title: "Fast & reliable delivery", text: "Your order reaches you safely and on time, every single time." },
];
const s = (id, type, title, extra = {}) => ({ id, type, enabled: true, title, subtitle: "", ...extra });
const DEFAULT_CONFIG = {
  sections: [
    s("hero", "hero", ""),
    s("categories", "categories", "Shop by category", { source: "featured", category_ids: [], limit: 8, link: "/categories" }),
    s("banners", "banners", ""),
    s("featured", "products", "Featured products", { source: "featured", limit: 12, layout: "grid", link: "/products?featured=1" }),
    s("collections", "collections", "", { limit: 4 }),
    s("brands", "brands", "Featured brands", { source: "featured", brand_ids: [], limit: 12, link: "/brands" }),
    s("suppliers", "suppliers", "Suppliers", { source: "featured", company_ids: [], limit: 8, link: "/companies" }),
    s("tiles", "feature_tiles", ""),
    s("new", "products", "New arrivals", { source: "new", limit: 10, layout: "grid", link: "/products?sort=newest" }),
    s("best", "products", "Best sellers", { source: "best_sellers", limit: 10, layout: "grid", link: "" }),
    s("recent", "recently_viewed", "Recently viewed"),
    s("why", "features", "Why our customers choose us again", { image_url: "/logos/Hookah.png", image_alt: "", items: DEFAULT_FEATURES }),
    s("logos", "logos", "", { items: Array.from({ length: 12 }, (_, i) => ({ image_url: `/logos/logo${i + 1}.jpg`, link: "", alt: "" })) }),
  ],
};

const ids = (v, label, max = 48) => {
  if (v === undefined || v === null || v === "") return [];
  if (!Array.isArray(v)) fail(`${label} must be a list`);
  return [...new Set(v.slice(0, max).map((x) => { if (!/^\d+$/.test(String(x))) fail(`${label}: invalid id`); return String(x); }))];
};
const oneId = (v, label) => (v === undefined || v === null || v === "" ? null : /^\d+$/.test(String(v)) ? String(v) : fail(`${label}: invalid id`));

/** Validates a homepage layout. Unknown keys are dropped. */
const sanitize = (input) => {
  const raw = Array.isArray(input?.sections) ? input.sections : [];
  if (raw.length > 30) fail("At most 30 sections");
  const seen = new Set();
  const sections = raw.map((x, i) => {
    const n = `Section ${i + 1}`;
    const def = SECTIONS[x?.type];
    if (!def) fail(`${n}: unknown section type`);
    if (x.type === "hero" && seen.has("hero")) fail("Only one hero section");
    seen.add(x.type);
    const out = { id: content.idOf(x.id), type: x.type, enabled: x.enabled !== false, title: str(x.title, 120, `${n} title`), subtitle: str(x.subtitle, 240, `${n} subtitle`) };
    for (const f of def.fields) {
      if (f === "source") out.source = def.sources.includes(x.source) ? x.source : def.sources[0];
      if (f === "limit") out.limit = Math.min(LIMITS[x.type] || 12, Math.max(1, parseInt(x.limit, 10) || 8));
      if (f === "layout") out.layout = x.type === "text" ? (["text", "split", "banner"].includes(x.layout) ? x.layout : "text") : ["grid", "carousel"].includes(x.layout) ? x.layout : "grid";
      if (f === "link") out.link = pathOrUrl(x.link, `${n} "see all" link`);
      if (f === "category_ids") out.category_ids = ids(x.category_ids, `${n} categories`, 24);
      if (f === "brand_ids") out.brand_ids = ids(x.brand_ids, `${n} brands`);
      if (f === "company_ids") out.company_ids = ids(x.company_ids, `${n} suppliers`, 24);
      if (f === "product_ids") out.product_ids = ids(x.product_ids, `${n} products`);
      if (f === "category_id") out.category_id = oneId(x.category_id, `${n} category`);
      if (f === "collection_id") out.collection_id = oneId(x.collection_id, `${n} collection`);
      if (f === "text") out.text = str(x.text, 4000, `${n} text`);
      if (f === "image_url") out.image_url = pathOrUrl(x.image_url, `${n} image`);
      if (f === "image_alt") out.image_alt = str(x.image_alt, 200, `${n} image description`);
      if (f === "link_label") out.link_label = str(x.link_label, 40, `${n} button text`);
      if (f === "items" && x.type === "features") {
        out.items = (Array.isArray(x.items) ? x.items : []).slice(0, 6).map((it, j) => {
          const t = str(it?.title, 80, `${n} item ${j + 1} title`);
          if (!t) fail(`${n} item ${j + 1}: add a title`);
          return { icon: ICONS.includes(it.icon) ? it.icon : "star", title: t, text: str(it.text, 300, `${n} item ${j + 1} text`) };
        });
      }
      if (f === "items" && x.type === "logos") {
        out.items = (Array.isArray(x.items) ? x.items : []).slice(0, 24).map((it, j) => {
          const img = pathOrUrl(it?.image_url, `${n} logo ${j + 1}`);
          if (!img) fail(`${n} logo ${j + 1}: add an image`);
          return { image_url: img, link: pathOrUrl(it.link, `${n} logo ${j + 1} link`), alt: str(it.alt, 120, `${n} logo ${j + 1} description`) };
        });
      }
    }
    if (out.type === "products" && out.source === "category" && !out.category_id) fail(`${n}: choose the category`);
    if (out.type === "products" && out.source === "collection" && !out.collection_id) fail(`${n}: choose the collection`);
    if (out.type === "products" && out.source === "manual" && !out.product_ids.length) fail(`${n}: choose the products`);
    return out;
  });
  return { sections };
};

/** Things a layout points at that won't show (deleted, hidden...), as readable warnings. */
const checkReferences = async (cfg) => {
  const warnings = [];
  const want = (k) => [...new Set(cfg.sections.flatMap((x) => (Array.isArray(x[k]) ? x[k] : x[k] ? [x[k]] : [])))].map((x) => BigInt(x));
  const [cats, prods, cols, brands, comps] = await Promise.all([
    prisma.categories.findMany({ where: { id: { in: [...want("category_ids"), ...want("category_id")] } }, select: { id: true, name: true, status: true } }),
    prisma.products.findMany({ where: { id: { in: want("product_ids") } }, select: { id: true, title: true, status: true } }),
    prisma.collections.findMany({ where: { id: { in: want("collection_id") } }, select: { id: true, name: true, company_id: true, status: true } }),
    prisma.brands.findMany({ where: { id: { in: want("brand_ids") } }, select: { id: true } }),
    prisma.companies.findMany({ where: { id: { in: want("company_ids") } }, select: { id: true, name: true, status: true, storefront_published: true } }),
  ]);
  for (const id of [...want("category_ids"), ...want("category_id")]) { const c = cats.find((x) => x.id === id); if (!c) warnings.push("A chosen category no longer exists"); else if (c.status !== "active") warnings.push(`Category "${c.name}" is hidden, so it won't show`); }
  for (const id of want("product_ids")) { const p = prods.find((x) => x.id === id); if (!p) warnings.push("A chosen product no longer exists"); else if (p.status !== "published") warnings.push(`"${p.title}" isn't published, so it won't show`); }
  for (const id of want("collection_id")) { const c = cols.find((x) => x.id === id); if (!c || c.company_id !== null) fail("Choose one of the platform collections"); if (c.status !== "published") warnings.push(`Collection "${c.name}" isn't published`); }
  if (brands.length < want("brand_ids").length) warnings.push("A chosen brand no longer exists");
  for (const c of comps) if (c.status !== "active" || !c.storefront_published) warnings.push(`Supplier "${c.name}" isn't on the marketplace right now`);
  return [...new Set(warnings)];
};

// ---- render ----------------------------------------------------------------------------------------
const include = { companies: { select: { id: true, name: true, slug: true, logo_url: true } } };
const companyCard = { id: true, name: true, slug: true, logo_url: true, tagline: true, city: true, state: true, country: true, is_featured: true, banner_url: true };
const liveCompany = { status: "active", storefront_published: true };
const inOrder = (rows, order) => { const o = new Map(order.map((x, i) => [String(x), i])); return rows.sort((a, b) => (o.get(String(a.id)) ?? 999) - (o.get(String(b.id)) ?? 999)); };
const big = (a) => a.map((x) => BigInt(x));

const productsFor = async (req, x) => {
  const pw = publicWhere(req);
  const take = x.limit || 8;
  let rows = [];
  if (x.source === "featured") rows = await prisma.products.findMany({ where: { ...pw, is_featured: true }, include, orderBy: [{ published_at: "desc" }, { id: "desc" }], take });
  else if (x.source === "new") rows = await prisma.products.findMany({ where: pw, include, orderBy: [{ published_at: "desc" }, { id: "desc" }], take });
  else if (x.source === "deals") rows = await prisma.products.findMany({ where: { AND: [pw, mk.dealsWhere()] }, include, orderBy: [{ sale_percent: { sort: "desc", nulls: "last" } }, { published_at: "desc" }], take });
  else if (x.source === "category") {
    const cats = await mk.activeCategories();
    if (!cats.some((c) => String(c.id) === String(x.category_id))) return [];
    rows = await prisma.products.findMany({ where: { ...pw, product_categories: { some: { category_id: { in: big(mk.descendants(cats, x.category_id)) } } } }, include, orderBy: [{ is_featured: "desc" }, { published_at: "desc" }], take });
  } else if (x.source === "collection") {
    return sf.collectionProducts(req, x.collection_id, null, take);
  } else if (x.source === "manual") {
    rows = inOrder(await prisma.products.findMany({ where: { ...pw, id: { in: big(x.product_ids) } }, include }), x.product_ids).slice(0, take);
  } else if (x.source === "best_sellers") {
    // most units ordered in the last 90 days; newest products fill the rest
    const since = new Date(Date.now() - 90 * 86400000);
    const top = await prisma.order_items.groupBy({ by: ["product_id"], where: { product_id: { not: null }, orders: { is: { created_at: { gte: since }, status: { not: "cancelled" } } } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: take * 2 });
    const order = top.map((t) => String(t.product_id));
    rows = inOrder(await prisma.products.findMany({ where: { ...pw, id: { in: big(order) } }, include }), order).slice(0, take);
    if (rows.length < take) rows.push(...(await prisma.products.findMany({ where: { ...pw, id: { notIn: rows.map((r) => r.id) } }, include, orderBy: [{ published_at: "desc" }, { id: "desc" }], take: take - rows.length })));
  }
  return decorate(req, rows.map(forViewer(req)), { variants: false });
};

const categoriesFor = async (x, settings) => {
  const cats = await mk.activeCategories();
  if (x.source === "manual") return inOrder(cats.filter((c) => x.category_ids.includes(String(c.id))), x.category_ids);
  if (x.source === "featured") {
    const chosen = settings.featured.category_ids.length ? inOrder(cats.filter((c) => settings.featured.category_ids.includes(String(c.id))), settings.featured.category_ids) : cats.filter((c) => c.is_featured);
    if (chosen.length) return chosen.slice(0, x.limit);
  }
  // the busiest categories
  const counts = await prisma.product_categories.groupBy({ by: ["category_id"], where: { products: { status: "published" }, categories: { status: "active" } }, _count: true, orderBy: { _count: { category_id: "desc" } }, take: x.limit });
  return inOrder(cats.filter((c) => counts.some((k) => k.category_id === c.id)), counts.map((k) => String(k.category_id)));
};

const brandsFor = async (req, x, settings) => {
  const sel = { id: true, name: true, slug: true, logo_url: true };
  const onSale = { products: { some: publicWhere(req) } };
  if (x.source === "manual") return inOrder(await prisma.brands.findMany({ where: { id: { in: big(x.brand_ids) }, ...onSale }, select: sel }), x.brand_ids);
  if (x.source === "featured") {
    const where = settings.featured.brand_ids.length ? { id: { in: big(settings.featured.brand_ids) } } : { is_featured: true };
    const rows = await prisma.brands.findMany({ where: { ...where, ...onSale }, select: sel, take: x.limit });
    if (rows.length) return inOrder(rows, settings.featured.brand_ids);
  }
  return prisma.brands.findMany({ where: onSale, select: sel, orderBy: { products: { _count: "desc" } }, take: x.limit });
};

const suppliersFor = async (req, x, settings) => {
  const pw = publicWhere(req);
  const select = { ...companyCard, _count: { select: { products: { where: pw }, company_brands: true } } };
  let rows;
  if (x.source === "manual") rows = inOrder(await prisma.companies.findMany({ where: { ...liveCompany, id: { in: big(x.company_ids) } }, select }), x.company_ids);
  else if (x.source === "featured") {
    const where = settings.featured.company_ids.length ? { id: { in: big(settings.featured.company_ids) } } : { is_featured: true };
    rows = inOrder(await prisma.companies.findMany({ where: { ...liveCompany, ...where }, select, take: x.limit }), settings.featured.company_ids);
    if (!rows.length) rows = await prisma.companies.findMany({ where: liveCompany, select, orderBy: [{ is_featured: "desc" }, { name: "asc" }], take: x.limit });
  } else rows = await prisma.companies.findMany({ where: liveCompany, select, orderBy: { products: { _count: "desc" } }, take: x.limit });
  const ratings = await require("./reviews").companyRatings(rows.map((r) => r.id));
  return rows.slice(0, x.limit).map(({ _count, ...c }) => ({ ...c, product_count: _count.products, brand_count: _count.company_brands, rating: ratings.get(String(c.id)) || null }));
};

/** What one section shows, or null when it would be empty. */
const renderSection = async (req, x, settings) => {
  const r = { ...x };
  if (x.type === "hero") { r.hero = await content.heroFor(req); return r.hero.slides.length ? r : null; }
  if (x.type === "banners") { r.banners = settings.banners; return r.banners.length ? r : null; }
  if (x.type === "categories") { r.categories = (await categoriesFor(x, settings)).map(({ id, name, slug, image_url }) => ({ id, name, slug, image_url })); return r.categories.length ? r : null; }
  if (x.type === "products") { r.products = await productsFor(req, x); return r.products.length ? r : null; }
  if (x.type === "collections") {
    const cols = await prisma.collections.findMany({ where: { company_id: null, ...sf.liveCollection(new Date()) }, orderBy: [{ sort_order: "asc" }, { name: "asc" }], take: x.limit || 4 });
    const lists = await Promise.all(cols.map((c) => sf.collectionProducts(req, c.id, null, 8)));
    r.collections = cols.map((c, i) => ({ id: c.id, name: c.name, slug: c.slug, description: c.description, cover_image_url: c.cover_image_url, products: lists[i] })).filter((c) => c.products.length);
    return r.collections.length ? r : null;
  }
  if (x.type === "brands") { r.brands = await brandsFor(req, x, settings); return r.brands.length ? r : null; }
  if (x.type === "suppliers") { r.companies = await suppliersFor(req, x, settings); return r.companies.length ? r : null; }
  if (x.type === "feature_tiles") {
    const rows = await prisma.site_settings.findMany({ where: { key: { startsWith: "feature_" } }, orderBy: { key: "asc" } });
    r.tiles = rows.map((t) => ({ key: t.key, image: t.value?.image || null, link: t.value?.link || "" })).filter((t) => t.image);
    return r.tiles.length ? r : null;
  }
  return r; // text, features, logos, recently viewed: nothing to look up
};

/** Every enabled section with what it shows, built at the same time (in their order). Empty sections are left out. */
const render = async (req, cfg) => {
  const settings = await getMarketplaceSettings();
  const built = await Promise.all(cfg.sections.filter((x) => x.enabled).map((x) => renderSection(req, x, settings)));
  return built.filter(Boolean);
};

// Visitors who aren't signed in all see the same homepage, so it is kept for 30 s (signed-in buyers get their
// own prices and are always built fresh). A newly published layout has a different key, so it shows at once.
let visitorCache = { at: 0, key: null, value: null };
const renderCached = async (req, cfg, key) => {
  if (req.user) return render(req, cfg);
  if (visitorCache.value && visitorCache.key === key && Date.now() - visitorCache.at < 30000) return visitorCache.value;
  const value = await render(req, cfg);
  visitorCache = { at: Date.now(), key, value };
  return value;
};
const clearHomepageCache = () => { visitorCache = { at: 0, key: null, value: null }; };

// ---- storage ---------------------------------------------------------------------------------------
const getStored = async () => (await content.read("homepage")) || { draft: null, published: null, published_at: null, versions: [] };
const publishedConfig = async () => (await getStored()).published || DEFAULT_CONFIG;
const draftConfig = async () => { const st = await getStored(); return st.draft || st.published || DEFAULT_CONFIG; };

const saveDraft = async (input) => {
  const cfg = sanitize(input);
  const warnings = await checkReferences(cfg);
  const st = await getStored();
  await content.write("homepage", { ...st, draft: cfg });
  return { cfg, warnings };
};
const publish = async (userId) => {
  const st = await getStored();
  const cfg = sanitize(st.draft || st.published || DEFAULT_CONFIG);
  const warnings = await checkReferences(cfg);
  const versions = [{ at: new Date().toISOString(), by: userId ? String(userId) : null, config: cfg }, ...(st.versions || [])].slice(0, 10);
  await content.write("homepage", { draft: cfg, published: cfg, published_at: new Date().toISOString(), versions });
  return { warnings, version: versions.length };
};
const resetDraft = async () => { const st = await getStored(); await content.write("homepage", { ...st, draft: DEFAULT_CONFIG }); return DEFAULT_CONFIG; };
const restore = async (index) => {
  const st = await getStored();
  const v = (st.versions || [])[index];
  if (!v) fail("Version not found");
  const cfg = sanitize(v.config);
  await content.write("homepage", { ...st, draft: cfg });
  return cfg;
};

module.exports = { SECTIONS, ICONS, LIMITS, DEFAULT_CONFIG, sanitize, checkReferences, render, renderCached, clearHomepageCache, getStored, publishedConfig, draftConfig, saveDraft, publish, resetDraft, restore };
