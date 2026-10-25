// Public marketplace: home, product search, categories, brands, companies (storefronts) and collections.
// Visibility, prices and stock rules all come from services/catalog (enforced here, not in the browser).
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");
const { publicWhere, forViewer, decorate } = require("../services/catalog");
const mk = require("../services/marketplace");
const sf = require("../services/storefront");
const { getMarketplaceSettings } = require("../services/marketplaceSettings");

const companyCard = { id: true, name: true, slug: true, logo_url: true, tagline: true, city: true, state: true, country: true, is_featured: true, banner_url: true };
const liveCompany = { status: "active", storefront_published: true };
const include = { companies: { select: { id: true, name: true, slug: true, logo_url: true } } };

const navHref = (n) => ({ category: `/categories/${n.ref}`, brand: `/brands/${n.ref}`, company: `/companies/${n.ref}`, collection: `/collections/${n.ref}`, link: n.ref }[n.type]);

// GET /marketplace/settings -> navigation and banners for the header / homepage
const settings = async (req, res) => {
  const s = await getMarketplaceSettings();
  res.json({ data: { nav: s.nav.map((n) => ({ label: n.label, href: navHref(n), external: n.type === "link" && /^https?:/.test(n.ref) })), banners: s.banners } });
};

const byIdsInOrder = (rows, ids) => {
  const o = new Map(ids.map((x, i) => [String(x), i]));
  return rows.sort((a, b) => (o.get(String(a.id)) ?? 999) - (o.get(String(b.id)) ?? 999));
};

// GET /marketplace/home
const home = async (req, res) => {
  const s = await getMarketplaceSettings();
  const now = new Date();
  const pw = publicWhere(req);
  const big = (a) => a.map((x) => BigInt(x));
  const [cats, brands, companies, featured, newest, collections, counts] = await Promise.all([
    prisma.categories.findMany({ where: { status: "active", ...(s.featured.category_ids.length ? { id: { in: big(s.featured.category_ids) } } : { is_featured: true }) }, select: { id: true, name: true, slug: true, image_url: true } }),
    prisma.brands.findMany({ where: s.featured.brand_ids.length ? { id: { in: big(s.featured.brand_ids) } } : { is_featured: true }, select: { id: true, name: true, slug: true, logo_url: true }, take: 24 }),
    prisma.companies.findMany({ where: { ...liveCompany, ...(s.featured.company_ids.length ? { id: { in: big(s.featured.company_ids) } } : {}) }, select: { ...companyCard, _count: { select: { products: { where: pw }, company_brands: true } } }, orderBy: [{ is_featured: "desc" }, { name: "asc" }], take: 12 }),
    prisma.products.findMany({ where: { ...pw, is_featured: true }, include, orderBy: { published_at: "desc" }, take: 12 }),
    prisma.products.findMany({ where: pw, include, orderBy: [{ published_at: "desc" }, { id: "desc" }], take: 12 }),
    prisma.collections.findMany({ where: { company_id: null, ...sf.liveCollection(now) }, orderBy: [{ sort_order: "asc" }, { name: "asc" }], take: 4 }),
    prisma.product_categories.groupBy({ by: ["category_id"], where: { products: pw }, _count: true, orderBy: { _count: { category_id: "desc" } }, take: 8 }),
  ]);
  // no featured categories chosen yet: the busiest ones
  let categories = byIdsInOrder(cats, s.featured.category_ids);
  if (!categories.length) {
    categories = byIdsInOrder(await prisma.categories.findMany({ where: { id: { in: counts.map((c) => c.category_id) }, status: "active" }, select: { id: true, name: true, slug: true, image_url: true } }), counts.map((c) => c.category_id));
  }
  const view = forViewer(req);
  const featuredProducts = await decorate(req, featured.map(view), { variants: false });
  const newArrivals = await decorate(req, newest.map(view), { variants: false });
  const cols = [];
  for (const c of collections) {
    const products = await sf.collectionProducts(req, c.id, null, 8);
    if (products.length) cols.push({ id: c.id, name: c.name, slug: c.slug, description: c.description, cover_image_url: c.cover_image_url, products });
  }
  res.json({
    data: {
      banners: s.banners,
      categories,
      brands: byIdsInOrder(brands, s.featured.brand_ids),
      companies: byIdsInOrder(companies, s.featured.company_ids).map(({ _count, ...c }) => ({ ...c, product_count: _count.products, brand_count: _count.company_brands })),
      featured: featuredProducts,
      new_arrivals: newArrivals,
      collections: cols,
    },
  });
};

// GET /marketplace/products?q&category&brand&company&featured&in_stock&min_price&max_price&attr_<key>&sort&page&limit
const products = async (req, res) => {
  res.json(await mk.searchProducts(req, req.query));
};

// GET /marketplace/categories -> the tree, with product counts (sub-categories included)
const categories = async (req, res) => {
  const rows = await mk.activeCategories();
  const links = await prisma.product_categories.findMany({ where: { products: publicWhere(req) }, select: { product_id: true, category_id: true } });
  const nodes = rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug, parent_id: c.parent_id, image_url: c.image_url, is_featured: c.is_featured, description: c.description, sort_order: c.sort_order }));
  for (const n of nodes) {
    const ids = new Set(mk.descendants(rows, n.id).map(String));
    n.product_count = new Set(links.filter((l) => ids.has(String(l.category_id))).map((l) => String(l.product_id))).size;
  }
  const build = (parent) => nodes
    .filter((n) => String(n.parent_id || "") === String(parent || ""))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((n) => ({ ...n, children: build(n.id) }));
  const q = String(req.query.q || "").trim().toLowerCase();
  res.json({ data: q ? nodes.filter((n) => n.name.toLowerCase().includes(q) && n.product_count) : build(null).filter((n) => n.product_count || n.children.length) });
};

// GET /marketplace/categories/:slug -> the category, its trail and children, and its products (same filters as /products)
const category = async (req, res) => {
  const slug = String(req.params.slug).toLowerCase();
  const rows = await mk.activeCategories();
  const c = rows.find((x) => x.slug === slug);
  if (!c) throw new HttpError(404, "Category not found");
  res.json(await mk.searchProducts(req, { ...req.query, category: slug }));
};

// GET /marketplace/brands?q&letter&featured&page -> brands with products on sale
const brands = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 120));
  const q = String(req.query.q || "").trim();
  const letter = String(req.query.letter || "").trim();
  const where = {
    products: { some: publicWhere(req) },
    ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    ...(letter === "#" ? { NOT: { name: { gte: "A", lt: "[" } } } : /^[a-z]$/i.test(letter) ? { name: { startsWith: letter, mode: "insensitive" } } : {}),
    ...(req.query.featured === "1" ? { is_featured: true } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.brands.findMany({
      where, orderBy: [{ is_featured: "desc" }, { name: "asc" }], skip: (page - 1) * limit, take: limit,
      select: { id: true, name: true, slug: true, logo_url: true, is_featured: true, _count: { select: { products: { where: publicWhere(req) }, company_brands: true } } },
    }),
    prisma.brands.count({ where }),
  ]);
  res.json({ data: rows.map(({ _count, ...b }) => ({ ...b, product_count: _count.products, seller_count: _count.company_brands })), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
};

// GET /marketplace/brands/:slug -> brand page: details, who sells it, its products (with filters)
const brand = async (req, res) => {
  const b = await prisma.brands.findFirst({
    where: { slug: String(req.params.slug).toLowerCase() },
    select: { id: true, name: true, slug: true, logo_url: true, description: true, website: true, is_featured: true,
      company_brands: { where: { companies: { is: liveCompany } }, select: { relationship: true, companies: { select: companyCard } } } },
  });
  if (!b) throw new HttpError(404, "Brand not found");
  const result = await mk.searchProducts(req, { ...req.query, brand: b.slug });
  const { company_brands, ...brandInfo } = b;
  // the brand's maker comes first, then authorised distributors
  const rank = { manufacturer: 0, authorized_distributor: 1, distributor: 2, reseller: 3 };
  res.json({ ...result, brand: { ...brandInfo, sellers: company_brands.map((l) => ({ ...l.companies, relationship: l.relationship })).sort((x, y) => (rank[x.relationship] ?? 9) - (rank[y.relationship] ?? 9)) } });
};

// GET /marketplace/companies?q&category&brand&page -> approved, published sellers
const companies = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 24));
  const q = String(req.query.q || "").trim();
  const pw = publicWhere(req);
  const productFilter = { ...pw };
  if (req.query.category) {
    const rows = await mk.activeCategories();
    const c = rows.find((x) => x.slug === String(req.query.category).toLowerCase());
    productFilter.product_categories = { some: { category_id: { in: c ? mk.descendants(rows, c.id) : [-1n] } } };
  }
  if (req.query.brand) productFilter.brands = { is: { slug: String(req.query.brand).toLowerCase() } };
  const where = {
    ...liveCompany,
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { tagline: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] } : {}),
    ...(req.query.category || req.query.brand ? { products: { some: productFilter } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.companies.findMany({
      where, orderBy: [{ is_featured: "desc" }, { name: "asc" }], skip: (page - 1) * limit, take: limit,
      select: { ...companyCard, _count: { select: { products: { where: pw }, company_brands: true } } },
    }),
    prisma.companies.count({ where }),
  ]);
  // top categories per company (for the cards)
  const ids = rows.map((r) => r.id);
  const links = ids.length
    ? await prisma.$queryRaw`SELECT p.company_id, c.name, c.slug, count(*)::int AS n FROM product_categories pc
        JOIN products p ON p.id = pc.product_id JOIN categories c ON c.id = pc.category_id
        WHERE p.company_id = ANY(${ids}) AND p.status = 'published' AND p.visibility = 'public' AND c.status = 'active' AND c.parent_id IS NULL
        GROUP BY 1, 2, 3 ORDER BY n DESC`
    : [];
  const ratings = await require("../services/reviews").companyRatings(ids);
  res.json({
    data: rows.map(({ _count, ...c }) => ({
      ...c, product_count: _count.products, brand_count: _count.company_brands, rating: ratings.get(String(c.id)) || null,
      top_categories: links.filter((l) => l.company_id === c.id).slice(0, 4).map((l) => ({ name: l.name, slug: l.slug })),
    })),
    total, page, pages: Math.max(1, Math.ceil(total / limit)),
  });
};

const loadLiveCompany = async (slug) => {
  const c = await prisma.companies.findFirst({ where: { slug: String(slug).toLowerCase(), ...liveCompany } });
  if (!c) throw new HttpError(404, "Company not found");
  return c;
};

// What's public about a company (never settings, tax ids, commission...)
const publicCompany = (c) => ({
  id: c.id, name: c.name, slug: c.slug, logo_url: c.logo_url, banner_url: c.banner_url, tagline: c.tagline, description: c.description,
  website: c.website, city: c.city, state: c.state, country: c.country, is_featured: c.is_featured, contact: sf.publicContact(c),
});

/**
 * GET /marketplace/companies/:slug -> storefront: company profile, theme, the resolved published sections
 * (or the default layout), the categories and brands it supplies, and its published collections.
 */
const company = async (req, res) => {
  const c = await loadLiveCompany(req.params.slug);
  const store = await prisma.storefronts.findUnique({ where: { company_id: c.id } });
  const cfg = store?.published && store.published.sections ? store.published : sf.defaultConfig(c);
  res.json({ data: await storefrontPayload(req, c, cfg) });
};

/** Everything a storefront page needs for a company and a config (also used for the editor's preview). */
const storefrontPayload = async (req, c, cfg) => {
  const pw = { ...publicWhere(req), company_id: c.id };
  const now = new Date();
  const [sections, catGroups, brandLinks, cols, productCount] = await Promise.all([
    sf.render(req, c, cfg),
    prisma.product_categories.groupBy({ by: ["category_id"], where: { products: pw }, _count: true }),
    prisma.company_brands.findMany({ where: { company_id: c.id, brands: { products: { some: pw } } }, include: { brands: { select: { id: true, name: true, slug: true, logo_url: true } } } }),
    prisma.collections.findMany({ where: { company_id: c.id, ...sf.liveCollection(now) }, orderBy: [{ sort_order: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true, description: true, cover_image_url: true } }),
    prisma.products.count({ where: pw }),
  ]);
  const rating = (await require("../services/reviews").companyRatings([c.id])).get(String(c.id)) || null;
  const promotions = await sf.publicPromotions(c.id, now);
  const catRows = await prisma.categories.findMany({ where: { id: { in: catGroups.map((g) => g.category_id) }, status: "active" }, select: { id: true, name: true, slug: true, parent_id: true } });
  return {
    ...publicCompany(c),
    product_count: productCount,
    rating,
    promotions,
    theme: sf.themeOf(cfg),
    sections,
    categories: catRows.map((r) => ({ ...r, count: catGroups.find((g) => g.category_id === r.id)?._count || 0 })).sort((a, b) => b.count - a.count),
    brands: brandLinks.map((l) => ({ ...l.brands, relationship: l.relationship })).sort((a, b) => a.name.localeCompare(b.name)),
    collections: cols,
  };
};

// GET /marketplace/companies/:slug/products -> the company's catalogue with the usual filters
const companyProducts = async (req, res) => {
  const c = await loadLiveCompany(req.params.slug);
  res.json(await mk.searchProducts(req, { ...req.query, company: c.slug }));
};

// GET /marketplace/companies/:slug/collections/:collection
const companyCollection = async (req, res) => {
  const c = await loadLiveCompany(req.params.slug);
  const col = await prisma.collections.findFirst({ where: { company_id: c.id, slug: String(req.params.collection).toLowerCase(), ...sf.liveCollection(new Date()) } });
  if (!col) throw new HttpError(404, "Collection not found");
  res.json({ data: { collection: { id: col.id, name: col.name, slug: col.slug, description: col.description, cover_image_url: col.cover_image_url }, company: publicCompany(c), products: await sf.collectionProducts(req, col.id, c.id, 200) } });
};

// GET /marketplace/collections/:slug -> a platform collection (products from any seller)
const collection = async (req, res) => {
  const col = await prisma.collections.findFirst({ where: { company_id: null, slug: String(req.params.slug).toLowerCase(), ...sf.liveCollection(new Date()) } });
  if (!col) throw new HttpError(404, "Collection not found");
  res.json({ data: { collection: { id: col.id, name: col.name, slug: col.slug, description: col.description, cover_image_url: col.cover_image_url }, products: await sf.collectionProducts(req, col.id, null, 200) } });
};

// POST /marketplace/track { kind: storefront|product|search, company_slug?, product_id?, query?, product_ids?, visitor }
const track = async (req, res) => {
  await require("../services/analytics").track(req, req.body || {});
  res.status(204).send();
};

// GET /marketplace/deals/codes -> promo codes sellers advertise, with the seller
const dealCodes = async (req, res) => {
  const now = new Date();
  const rows = await prisma.promotions.findMany({
    where: {
      is_active: true, show_on_storefront: true, companies: liveCompany,
      AND: [{ OR: [{ starts_at: null }, { starts_at: { lte: now } }] }, { OR: [{ ends_at: null }, { ends_at: { gte: now } }] }],
    },
    include: { companies: { select: { id: true, name: true, slug: true, logo_url: true } } },
    orderBy: { created_at: "desc" }, take: 60,
  });
  res.json({
    data: rows.filter((p) => p.max_uses === null || p.uses_count < p.max_uses).map((p) => ({
      code: p.code, description: p.description, type: p.type, value: Number(p.value), min_order_amount: Number(p.min_order_amount), ends_at: p.ends_at, company: p.companies,
    })),
  });
};

module.exports = { track, dealCodes, storefrontPayload, settings, home, products, categories, category, brands, brand, companies, company, companyProducts, companyCollection, collection, publicCompany };
