const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const { publicProductWhere, companyBrief, forViewer, decorate } = require("../services/catalog");

const normalizeText = (text) =>
  String(text)
    .toLowerCase()
    .trim()
    .replace(/[\/#&,+._-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");

const include = { companies: companyBrief };

const fetchBrands = async (req, res) => {
  const data = await prisma.brands.findMany({
    where: { OR: [{ company_id: null }, { companies: { is: { status: "active" } } }] },
    orderBy: { name: "asc" },
    include: { companies: companyBrief },
  });
  res.json({
    message: "Brands fetched",
    data: data.map(({ companies, ...b }) => ({ ...b, company: companies })),
  });
};

const fetchProductsByBrand = async (req, res) => {
  const brand = decodeURIComponent(req.params.brand);
  const data = await prisma.products.findMany({
    where: { ...publicProductWhere, brand: { equals: brand, mode: "insensitive" } },
    orderBy: { title: "asc" },
    include,
  });
  res.json({ message: "Products fetched", data: await decorate(req, data.map(forViewer(req))) });
};

const fetchProductsByCategory = async (req, res) => {
  const rawCategory = decodeURIComponent(req.params.category || "");
  if (!rawCategory) throw new HttpError(400, "Category is required");
  const normalizedInput = normalizeText(rawCategory);

  // Categories are free-text arrays with inconsistent punctuation, so we keep the
  // original fuzzy matching but only load the columns needed to do it.
  const candidates = await prisma.products.findMany({
    where: { ...publicProductWhere, NOT: { categories: { isEmpty: true } } },
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
  res.json({ message: "Products fetched by category", data: await decorate(req, data.map(forViewer(req))) });
};

const fetchHomeProducts = async (req, res) => {
  const where = publicProductWhere;
  const [featured, newArrivals, bestSellers] = await Promise.all([
    prisma.products.findMany({ where, orderBy: { id: "asc" }, take: 15, include }),
    prisma.products.findMany({ where, orderBy: { created_at: "desc" }, take: 10, include }),
    prisma.products.findMany({ where, orderBy: { id: "asc" }, skip: 15, take: 10, include }),
  ]);
  const view = forViewer(req);
  const data = { featured: featured.map(view), newArrivals: newArrivals.map(view), bestSellers: bestSellers.map(view) };
  await decorate(req, [...data.featured, ...data.newArrivals, ...data.bestSellers]);
  res.json({ message: "Home products fetched", data });
};

const fetchProductById = async (req, res) => {
  const product = await prisma.products.findFirst({
    where: { ...publicProductWhere, id: toId(req.params.id) },
    include,
  });
  if (!product) return res.status(404).json({ message: "Product not found" });
  const [data] = await decorate(req, [forViewer(req)(product)]);
  res.json({ message: "Product fetched", data });
};

// GET /products/search?q=...  (title, brand or SKU)
const searchProducts = async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json({ data: [] });
  const data = await prisma.products.findMany({
    where: {
      ...publicProductWhere,
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
  res.json({ data: await decorate(req, data.map(forViewer(req))) });
};

module.exports = {
  fetchBrands,
  fetchProductsByBrand,
  fetchProductsByCategory,
  fetchHomeProducts,
  fetchProductById,
  searchProducts,
};
