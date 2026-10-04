// Public company directory for customers.
const prisma = require("../prisma");
const { publicProductWhere, forViewer, decorate } = require("../services/catalog");

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
      _count: { select: { products: { where: { is_active: true } } } },
      brands: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    },
    orderBy: { name: "asc" },
  });
  res.json({
    data: companies.map(({ _count, ...c }) => ({ ...c, productCount: _count.products })),
  });
};

const getCompany = async (req, res) => {
  const company = await prisma.companies.findFirst({
    where: { slug: String(req.params.slug), status: "active" },
    select: { ...publicCompanyFields, brands: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
  });
  if (!company) return res.status(404).json({ message: "Company not found" });

  const products = await prisma.products.findMany({
    where: { ...publicProductWhere, company_id: company.id },
    orderBy: [{ brand: "asc" }, { title: "asc" }],
  });
  const view = forViewer(req);
  res.json({
    data: {
      ...company,
      products: await decorate(req, products.map((p) => view({ ...p, companies: { id: company.id, name: company.name, slug: company.slug, logo_url: company.logo_url } }))),
    },
  });
};

module.exports = { listCompanies, getCompany };
