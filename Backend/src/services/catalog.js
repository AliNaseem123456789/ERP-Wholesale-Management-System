// What customers can see in the storefront: active products of active companies.
const publicProductWhere = {
  is_active: true,
  companies: { is: { status: "active" } },
};

const companyBrief = { select: { id: true, name: true, slug: true, logo_url: true } };

// Wholesale prices are only visible to logged-in customers.
// Also renames the Prisma relation `companies` to `company` for the frontend.
const forViewer = (req) => (product) => {
  if (!product) return product;
  const { companies, price, ...rest } = product;
  const out = { ...rest, company: companies ?? null };
  if (req.user) out.price = price;
  return out;
};

// Adds stock info for products of companies that track inventory:
//   stock_status: "in_stock" | "out_of_stock"  (everyone)
//   available: number                          (logged-in customers only)
//   flavor_stock: { [flavour]: number }        (logged-in customers, products with flavours)
// Products of companies that don't track inventory get stock_status: null (always buyable).
const withStock = async (req, products) => {
  const list = products.filter(Boolean);
  if (!list.length) return products;
  const prisma = require("../prisma");
  const inv = require("./inventory");
  const companyIds = [...new Set(list.map((p) => String(p.company_id ?? p.company?.id ?? "")).filter(Boolean))];
  const tracked = await trackedCompanyIds(prisma, companyIds);
  const trackedProducts = list.filter((p) => tracked.has(String(p.company_id ?? p.company?.id)));
  const ids = trackedProducts.map((p) => p.id);
  const [avail, byFlavor] = await Promise.all([inv.availabilityFor(ids), req.user ? inv.availabilityByFlavor(ids) : new Map()]);
  for (const p of list) {
    if (!tracked.has(String(p.company_id ?? p.company?.id))) {
      p.stock_status = null;
      continue;
    }
    const a = Math.max(0, avail.get(String(p.id)) ?? 0);
    p.stock_status = a > 0 ? "in_stock" : "out_of_stock";
    if (req.user) {
      p.available = a;
      if (inv.hasFlavors(p)) {
        p.flavor_stock = Object.fromEntries(inv.flavorsOf(p).map((f) => [f, Math.max(0, byFlavor.get(inv.flavorKey(p.id, f)) ?? 0)]));
      }
    }
  }
  return products;
};

const trackedCompanyIds = async (prisma, companyIds) => {
  if (!companyIds.length) return new Set();
  const rows = await prisma.companies.findMany({
    where: { id: { in: companyIds.map((id) => BigInt(id)) }, settings: { path: ["inventory", "tracking"], equals: true } },
    select: { id: true },
  });
  return new Set(rows.map((r) => String(r.id)));
};

// Stock status + the logged-in customer's own prices (group price lists, volume tiers, discounts).
const decorate = async (req, products) => {
  await withStock(req, products);
  const { applyCustomerPricing } = require("./pricing");
  await applyCustomerPricing(req, products);
  return products;
};

module.exports = { publicProductWhere, companyBrief, forViewer, withStock, decorate, trackedCompanyIds };
