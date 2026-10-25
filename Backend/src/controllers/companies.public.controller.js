// Public company directory for customers.
const prisma = require("../prisma");
const { publicWhere, forViewer, decorate } = require("../services/catalog");

const publicCompanyFields = {
  id: true, name: true, slug: true, logo_url: true, description: true,
  website: true, city: true, state: true, country: true,
};

const listCompanies = async (req, res) => {
  const q = String(req.query.q || "").trim();
  const companies = await prisma.companies.findMany({
    where: { status: "active", ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
    select: {
      ...publicCompanyFields,
      _count: { select: { products: { where: { status: "published", visibility: "public" } } } },
      company_brands: { select: { brands: { select: { id: true, name: true, slug: true } } } },
    },
    orderBy: { name: "asc" },
  });
  res.json({
    data: companies.map(({ _count, company_brands, ...c }) => ({ ...c, brands: company_brands.map((l) => l.brands).sort((a, b) => a.name.localeCompare(b.name)), productCount: _count.products })),
  });
};

const getCompany = async (req, res) => {
  const company = await prisma.companies.findFirst({
    where: { slug: String(req.params.slug), status: "active" },
    select: { ...publicCompanyFields, company_brands: { select: { relationship: true, brands: { select: { id: true, name: true, slug: true, logo_url: true } } } } },
  });
  if (!company) return res.status(404).json({ message: "Company not found" });
  company.brands = company.company_brands.map((l) => ({ ...l.brands, relationship: l.relationship })).sort((a, b) => a.name.localeCompare(b.name));
  delete company.company_brands;

  const products = await prisma.products.findMany({
    where: { ...publicWhere(req), company_id: company.id },
    orderBy: [{ brand: "asc" }, { title: "asc" }],
  });
  const view = forViewer(req);
  res.json({
    data: {
      ...company,
      products: await decorate(req, products.map((p) => view({ ...p, companies: { id: company.id, name: company.name, slug: company.slug, logo_url: company.logo_url } })), { variants: false }),
    },
  });
};

module.exports = { listCompanies, getCompany };
