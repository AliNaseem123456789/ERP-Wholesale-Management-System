// Marketplace product search: filters, sorting, pagination and facet counts, all enforced on the server
// on top of the storefront rules in catalog.publicWhere (published, active seller, visible to this viewer).
const prisma = require("../prisma");
const { publicWhere, forViewer, decorate } = require("./catalog");

const SORTS = {
  relevance: [{ is_featured: "desc" }, { published_at: "desc" }, { id: "desc" }],
  newest: [{ published_at: "desc" }, { id: "desc" }],
  title: [{ title: "asc" }, { id: "asc" }],
  price_asc: [{ price: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  price_desc: [{ price: { sort: "desc", nulls: "last" } }, { id: "desc" }],
  featured: [{ is_featured: "desc" }, { title: "asc" }],
};

let catCache = { at: 0, rows: [] };
const activeCategories = async () => {
  if (Date.now() - catCache.at < 30000) return catCache.rows;
  const rows = await prisma.categories.findMany({ where: { status: "active" }, select: { id: true, name: true, slug: true, parent_id: true, image_url: true, is_featured: true, description: true, sort_order: true } });
  catCache = { at: Date.now(), rows };
  return rows;
};
const clearCategoryCache = () => { catCache = { at: 0, rows: [] }; };

/** A category id and all ids below it. */
const descendants = (rows, rootId) => {
  const out = [String(rootId)];
  for (let i = 0; i < out.length; i++) for (const c of rows) if (String(c.parent_id) === out[i] && !out.includes(String(c.id))) out.push(String(c.id));
  return out.map((x) => BigInt(x));
};

/** Breadcrumb from the top category down to this one. */
const trail = (rows, id) => {
  const out = [];
  let cur = rows.find((c) => String(c.id) === String(id));
  for (let i = 0; cur && i < 20; i++) {
    out.unshift({ id: cur.id, name: cur.name, slug: cur.slug });
    cur = rows.find((c) => String(c.id) === String(cur.parent_id));
  }
  return out;
};

/** Products on offer: a running sale, or volume prices on the seller's standard price list. */
const dealsWhere = (now = new Date()) => ({
  OR: [
    { sale_percent: { not: null }, AND: [{ OR: [{ sale_starts_at: null }, { sale_starts_at: { lte: now } }] }, { OR: [{ sale_ends_at: null }, { sale_ends_at: { gte: now } }] }] },
    { price_list_items: { some: { min_quantity: { gt: 1 }, price_lists: { is_default: true, is_active: true } } } },
  ],
});

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean);

/**
 * Builds the Prisma filter from query parameters:
 *   q, category (slug), brand (slug, several comma separated), company (slug), featured=1, in_stock=1,
 *   min_price / max_price (logged-in only), attr_<key>=v1,v2 (any of the values), collection (id, internal)
 * Returns { where, category }.
 */
const buildWhere = async (req, query, { exclude = null } = {}) => {
  const and = [publicWhere(req)];
  let category = null;
  const q = String(query.q || "").trim().slice(0, 120);
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        { short_description: { contains: q, mode: "insensitive" } },
        { product_variants: { some: { OR: [{ sku: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } } },
        { product_categories: { some: { categories: { name: { contains: q, mode: "insensitive" } } } } },
      ],
    });
  }
  if (query.category && exclude !== "category") {
    const rows = await activeCategories();
    category = rows.find((c) => c.slug === String(query.category).toLowerCase()) || null;
    and.push(category ? { product_categories: { some: { category_id: { in: descendants(rows, category.id) } } } } : { id: -1n });
  }
  const brands = list(query.brand);
  if (brands.length && exclude !== "brand") and.push({ brands: { is: { slug: { in: brands.map((b) => b.toLowerCase()) } } } });
  const companies = list(query.company);
  if (companies.length && exclude !== "company") and.push({ companies: { is: { slug: { in: companies.map((c) => c.toLowerCase()) } } } });
  if (query.featured === "1" || query.featured === "true") and.push({ is_featured: true });
  if (query.deals === "1" || query.deals === "true") and.push(dealsWhere());
  if (query.collection) and.push(/^\d+$/.test(String(query.collection)) ? { collection_products: { some: { collection_id: BigInt(query.collection) } } } : { id: -1n });
  // specific products (recently viewed, compare): ?ids=1,2,3
  if (query.ids) {
    const wanted = list(query.ids).filter((x) => /^\d+$/.test(x)).slice(0, 24);
    and.push(wanted.length ? { id: { in: wanted.map((x) => BigInt(x)) } } : { id: -1n });
  }
  if (query.in_stock === "1" || query.in_stock === "true") {
    // sellers that don't track stock are always orderable; tracked ones need stock on hand not reserved
    and.push({
      OR: [
        { NOT: { companies: { is: { settings: { path: ["inventory", "tracking"], equals: true } } } } },
        { inventory_levels: { some: { on_hand: { gt: 0 } } } },
      ],
    });
  }
  if (req?.user) {
    const min = Number(query.min_price);
    const max = Number(query.max_price);
    if (query.min_price !== undefined && query.min_price !== "" && Number.isFinite(min)) and.push({ price: { gte: min } });
    if (query.max_price !== undefined && query.max_price !== "" && Number.isFinite(max)) and.push({ price: { lte: max } });
  }
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith("attr_") || exclude === k) continue;
    const key = k.slice(5).slice(0, 64);
    const values = list(v).slice(0, 20);
    if (!values.length) continue;
    and.push({
      product_attribute_values: {
        some: {
          attribute_definitions: { key, is_public: true, company_id: null },
          OR: [
            { attribute_options: { value: { in: values, mode: "insensitive" } } },
            { value_text: { in: values, mode: "insensitive" } },
            ...values.filter((x) => Number.isFinite(Number(x))).map((x) => ({ value_number: Number(x) })),
          ],
        },
      },
    });
  }
  return { where: { AND: and }, category };
};

/** Facet counts for the current result (each facet ignores its own filter so other values stay selectable). */
const facets = async (req, query, category) => {
  const rows = await activeCategories();
  // the products each facet counts (each ignores its own filter); filters that are the same are looked up once
  const wheres = await Promise.all(["category", "brand", "company", null].map(async (exclude) => (await buildWhere(req, query, { exclude })).where));
  const unique = new Map();
  for (const w of wheres) { const k = JSON.stringify(w, (_, v) => (typeof v === "bigint" ? `${v}n` : v)); if (!unique.has(k)) unique.set(k, w); }
  const keys = [...unique.keys()];
  const found = await Promise.all([...unique.values()].map(async (w) => (await prisma.products.findMany({ where: w, select: { id: true }, take: 5000 })).map((p) => p.id)));
  const [catIds, brandIds, companyIds, allIds] = wheres.map((w) => found[keys.indexOf(JSON.stringify(w, (_, v) => (typeof v === "bigint" ? `${v}n` : v)))]);

  // everything below needs only those ids, so it is looked up in one go
  const [links, brandGroups, companyGroups, brandRows, companyRows, vals] = await Promise.all([
    catIds.length ? prisma.product_categories.findMany({ where: { product_id: { in: catIds } }, select: { product_id: true, category_id: true } }) : [],
    brandIds.length ? prisma.products.groupBy({ by: ["brand_id"], where: { id: { in: brandIds }, brand_id: { not: null } }, _count: true }) : [],
    companyIds.length ? prisma.products.groupBy({ by: ["company_id"], where: { id: { in: companyIds } }, _count: true }) : [],
    brandIds.length ? prisma.brands.findMany({ where: { products: { some: { id: { in: brandIds } } } }, select: { id: true, name: true, slug: true } }) : [],
    companyIds.length ? prisma.companies.findMany({ where: { products: { some: { id: { in: companyIds } } } }, select: { id: true, name: true, slug: true } }) : [],
    allIds.length ? prisma.product_attribute_values.findMany({
      where: { product_id: { in: allIds }, attribute_definitions: { is_filterable: true, is_public: true, company_id: null } },
      select: { product_id: true, value_text: true, value_number: true, attribute_definitions: { select: { key: true, name: true, unit: true, sort_order: true } }, attribute_options: { select: { value: true } } },
    }) : [],
  ]);

  // categories: children of the current category (or top level), counted with their sub-categories
  const level = rows.filter((c) => String(c.parent_id || "") === String(category?.id || ""));
  const catFacet = level
    .map((c) => {
      const ids = new Set(descendants(rows, c.id).map(String));
      const n = new Set(links.filter((l) => ids.has(String(l.category_id))).map((l) => String(l.product_id))).size;
      return { id: c.id, name: c.name, slug: c.slug, count: n };
    })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const brandFacet = brandGroups
    .map((g) => ({ ...brandRows.find((b) => b.id === g.brand_id), count: g._count }))
    .filter((b) => b.slug)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 50);
  const companyFacet = companyGroups
    .map((g) => ({ ...companyRows.find((c) => c.id === g.company_id), count: g._count }))
    .filter((c) => c.slug)
    .sort((a, b) => b.count - a.count);

  // attributes: platform attributes marked filterable that have values among these products
  let attrFacet = [];
  if (allIds.length) {
    const byKey = new Map();
    for (const v of vals) {
      const value = v.attribute_options?.value ?? v.value_text ?? (v.value_number !== null ? String(Number(v.value_number)) : null);
      if (value === null) continue;
      const a = v.attribute_definitions;
      if (!byKey.has(a.key)) byKey.set(a.key, { key: a.key, name: a.name, unit: a.unit, sort: a.sort_order, values: new Map() });
      const m = byKey.get(a.key).values;
      if (!m.has(value)) m.set(value, new Set());
      m.get(value).add(String(v.product_id));
    }
    attrFacet = [...byKey.values()]
      .map((a) => ({ key: a.key, name: a.name, unit: a.unit, sort: a.sort, values: [...a.values].map(([value, ids]) => ({ value, count: ids.size })).sort((x, y) => y.count - x.count || x.value.localeCompare(y.value, undefined, { numeric: true })).slice(0, 30) }))
      .filter((a) => a.values.length > 1 || query[`attr_${a.key}`])
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      .map(({ sort, ...a }) => a);
  }
  return { categories: catFacet, brands: brandFacet, companies: companyFacet, attributes: attrFacet };
};

/** One page of products for a query, with optional facets. */
const searchProducts = async (req, query, { withFacets = true, limitMax = 60 } = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(limitMax, Math.max(1, parseInt(query.limit, 10) || 24));
  const sortKey = SORTS[query.sort] ? query.sort : "relevance";
  if ((sortKey === "price_asc" || sortKey === "price_desc") && !req?.user) query = { ...query, sort: "relevance" };
  const { where, category } = await buildWhere(req, query);
  // the page of products and the filter counts don't depend on each other: look them up at the same time
  const [[data, total], facetData, rowsCat] = await Promise.all([
    Promise.all([
      prisma.products.findMany({
        where, orderBy: SORTS[query.sort] || SORTS.relevance, skip: (page - 1) * limit, take: limit,
        include: { companies: { select: { id: true, name: true, slug: true, logo_url: true } } },
      }).then((rows) => decorate(req, rows.map(forViewer(req)), { variants: false })),
      prisma.products.count({ where }),
    ]),
    withFacets ? facets(req, query, category) : undefined,
    activeCategories(),
  ]);
  return {
    data,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    category: category ? { ...category, trail: trail(rowsCat, category.id), children: rowsCat.filter((c) => String(c.parent_id) === String(category.id)).map(({ id, name, slug, image_url }) => ({ id, name, slug, image_url })) } : null,
    facets: facetData,
    sorts: Object.keys(SORTS).filter((s) => req?.user || !s.startsWith("price")),
  };
};

module.exports = { SORTS, activeCategories, clearCategoryCache, descendants, trail, buildWhere, searchProducts, dealsWhere };
