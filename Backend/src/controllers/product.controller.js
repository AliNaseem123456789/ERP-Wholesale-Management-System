const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const { publicWhere, companyBrief, forViewer, decorate } = require("../services/catalog");
const { specificationsFor } = require("../services/attributes");

const normalizeText = (text) =>
  String(text)
    .toLowerCase()
    .trim()
    .replace(/[\/#&,+._-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");

const include = { companies: companyBrief };

// GET /products/brands -> brands with at least one product on sale (plus featured ones)
const fetchBrands = async (req, res) => {
  const data = await prisma.brands.findMany({
    where: { OR: [{ is_featured: true }, { products: { some: publicWhere(req) } }] },
    orderBy: { name: "asc" },
    include: { companies: companyBrief, _count: { select: { products: { where: publicWhere(req) } } } },
  });
  res.json({
    message: "Brands fetched",
    data: data.map(({ companies, _count, ...b }) => ({ ...b, company: companies, product_count: _count.products })),
  });
};

// GET /products/brand/:brand (slug or name)
const fetchProductsByBrand = async (req, res) => {
  const brand = decodeURIComponent(req.params.brand);
  const record = await prisma.brands.findFirst({ where: { OR: [{ slug: brand.toLowerCase() }, { name: { equals: brand, mode: "insensitive" } }] }, select: { id: true } });
  const data = await prisma.products.findMany({
    where: { ...publicWhere(req), ...(record ? { OR: [{ brand_id: record.id }, { brand: { equals: brand, mode: "insensitive" } }] } : { brand: { equals: brand, mode: "insensitive" } }) },
    orderBy: { title: "asc" },
    include,
  });
  res.json({ message: "Products fetched", data: await decorate(req, data.map(forViewer(req)), { variants: false }) });
};

// GET /products/categories -> active categories (flat, with parent ids) and how many products are on sale in each
const fetchCategories = async (req, res) => {
  const [rows, counts] = await Promise.all([
    prisma.categories.findMany({ where: { status: "active" }, orderBy: [{ sort_order: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true, parent_id: true, image_url: true, is_featured: true, description: true } }),
    prisma.product_categories.groupBy({ by: ["category_id"], where: { products: publicWhere(req) }, _count: true }),
  ]);
  const countBy = new Map(counts.map((c) => [String(c.category_id), c._count]));
  res.json({ data: rows.map((c) => ({ ...c, product_count: countBy.get(String(c.id)) || 0 })) });
};

// A category and every category below it.
const withDescendants = async (rootId) => {
  const all = await prisma.categories.findMany({ where: { status: "active" }, select: { id: true, parent_id: true } });
  const out = [rootId];
  for (let i = 0; i < out.length; i++) for (const c of all) if (c.parent_id === out[i] && !out.includes(c.id)) out.push(c.id);
  return out;
};

const fetchProductsByCategory = async (req, res) => {
  const rawCategory = decodeURIComponent(req.params.category || "");
  if (!rawCategory) throw new HttpError(400, "Category is required");
  // a category record (by slug or name): its products and those of its sub-categories
  const record = await prisma.categories.findFirst({
    where: { status: "active", OR: [{ slug: rawCategory.toLowerCase() }, { name: { equals: rawCategory, mode: "insensitive" } }] },
    select: { id: true },
  });
  if (record) {
    const data = await prisma.products.findMany({
      where: { ...publicWhere(req), product_categories: { some: { category_id: { in: await withDescendants(record.id) } } } },
      orderBy: { title: "asc" },
      include,
    });
    return res.json({ message: "Products fetched by category", data: await decorate(req, data.map(forViewer(req)), { variants: false }) });
  }
  const normalizedInput = normalizeText(rawCategory);

  // Categories are free-text arrays with inconsistent punctuation, so we keep the
  // original fuzzy matching but only load the columns needed to do it.
  const candidates = await prisma.products.findMany({
    where: { ...publicWhere(req), NOT: { categories: { isEmpty: true } } },
    select: { id: true, categories: true },
  });
  const ids = candidates
    .filter((p) =>
      p.categories.some((cat) => {
        const c = normalizeText(cat);
        return c && (c === normalizedInput || c.includes(normalizedInput) || normalizedInput.includes(c));
      }),
    )
    .map((p) => p.id);

  const data = await prisma.products.findMany({
    where: { id: { in: ids } },
    orderBy: { title: "asc" },
    include,
  });
  res.json({ message: "Products fetched by category", data: await decorate(req, data.map(forViewer(req)), { variants: false }) });
};

const fetchHomeProducts = async (req, res) => {
  const where = publicWhere(req);
  const [featured, newArrivals, bestSellers] = await Promise.all([
    prisma.products.findMany({ where, orderBy: { id: "asc" }, take: 15, include }),
    prisma.products.findMany({ where, orderBy: { created_at: "desc" }, take: 10, include }),
    prisma.products.findMany({ where, orderBy: { id: "asc" }, skip: 15, take: 10, include }),
  ]);
  const view = forViewer(req);
  const data = { featured: featured.map(view), newArrivals: newArrivals.map(view), bestSellers: bestSellers.map(view) };
  await decorate(req, [...data.featured, ...data.newArrivals, ...data.bestSellers], { variants: false });
  res.json({ message: "Home products fetched", data });
};

// GET /products/product/:idOrSlug -> one product with variants, images, specifications, categories and brand.
const fetchProductById = async (req, res) => {
  const key = String(req.params.id || "");
  const product = await prisma.products.findFirst({
    where: { ...publicWhere(req), ...(/^\d+$/.test(key) ? { id: BigInt(key) } : { slug: key }) },
    include: {
      ...include,
      brands: { select: { id: true, name: true, slug: true, logo_url: true } },
      product_categories: { orderBy: { sort_order: "asc" }, include: { categories: { select: { id: true, name: true, slug: true, status: true } } } },
    },
  });
  if (!product) return res.status(404).json({ message: "Product not found" });
  const [data] = await decorate(req, [forViewer(req)(product)]);
  data.brand_info = product.brands || null;
  data.category_list = product.product_categories.map((pc) => pc.categories).filter((c) => c.status === "active").map(({ status, ...c }) => c);
  data.specifications = await specificationsFor(product.id, { publicOnly: true });
  res.json({ message: "Product fetched", data });
};

// GET /products/search?q=...  (title, brand or SKU)
const searchProducts = async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json({ data: [] });
  const data = await prisma.products.findMany({
    where: {
      ...publicWhere(req),
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { title: "asc" },
    take: 50,
    include,
  });
  res.json({ data: await decorate(req, data.map(forViewer(req)), { variants: false }) });
};

module.exports = {
  fetchCategories,
  fetchBrands,
  fetchProductsByBrand,
  fetchProductsByCategory,
  fetchHomeProducts,
  fetchProductById,
  searchProducts,
};
