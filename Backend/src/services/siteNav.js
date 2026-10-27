// The public top menu: the admin's menu (or, until one is saved, one built from the categories), with the
// dropdowns filled in: a category's sub-categories, every top-level category, or hand-picked links, and for
// mega menus the category's top brands. Cached briefly; nothing here is per-user.
const prisma = require("../prisma");
const mk = require("./marketplace");
const { getMarketplaceSettings } = require("./marketplaceSettings");

const hrefOf = (n) => ({ category: `/categories/${n.ref}`, brand: `/brands/${n.ref}`, company: `/companies/${n.ref}`, collection: `/collections/${n.ref}`, link: n.ref, menu: null }[n.type]);
const isExternal = (n) => n.type === "link" && /^https?:/.test(n.ref);

const sortCats = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name);

/** The menu used until an admin saves one: every top-level category with a dropdown, then brands, suppliers, deals. */
const defaultNav = async () => {
  const cats = await mk.activeCategories();
  const tops = cats.filter((c) => !c.parent_id).sort(sortCats);
  const withKids = tops.filter((t) => cats.some((c) => String(c.parent_id) === String(t.id)));
  return [
    { id: "nav-categories", label: "Categories", type: "link", ref: "/categories", hidden: false, dropdown: tops.length ? "categories" : "none", children: [], mega: true, brands: false, promo: null },
    ...withKids.slice(0, 4).map((t) => ({ id: `nav-${t.slug}`.slice(0, 40), label: t.name.slice(0, 40), type: "category", ref: t.slug, hidden: false, dropdown: "subcategories", children: [], mega: true, brands: true, promo: null })),
    { id: "nav-brands", label: "Brands", type: "link", ref: "/brands", hidden: false, dropdown: "none", children: [], mega: false, brands: false, promo: null },
    { id: "nav-suppliers", label: "Suppliers", type: "link", ref: "/companies", hidden: false, dropdown: "none", children: [], mega: false, brands: false, promo: null },
    { id: "nav-deals", label: "Deals", type: "link", ref: "/deals", hidden: false, dropdown: "none", children: [], mega: false, brands: false, promo: null },
  ];
};

/** Top brands among the published products of a category (and its sub-categories). */
const topBrands = async (catRows, categoryId, limit = 8) => {
  const ids = mk.descendants(catRows, categoryId).map((x) => BigInt(x));
  const rows = await prisma.products.groupBy({
    by: ["brand_id"],
    where: { status: "published", is_active: true, visibility: "public", brand_id: { not: null }, companies: { is: { status: "active", storefront_published: true } }, product_categories: { some: { category_id: { in: ids } } } },
    _count: true, orderBy: { _count: { brand_id: "desc" } }, take: limit,
  });
  if (!rows.length) return [];
  const brands = await prisma.brands.findMany({ where: { id: { in: rows.map((r) => r.brand_id) }, slug: { not: null } }, select: { id: true, name: true, slug: true } });
  return rows.map((r) => brands.find((b) => b.id === r.brand_id)).filter(Boolean).map((b) => ({ label: b.name, href: `/brands/${b.slug}` }));
};

/** Public shape of a menu: [{ id, label, href, external, mega, columns?, children?, brands?, promo? }] (hidden items left out). */
const resolveNav = async (nav) => {
  const cats = await mk.activeCategories();
  const bySlug = new Map(cats.map((c) => [c.slug, c]));
  const kidsOf = (id) => cats.filter((c) => String(c.parent_id) === String(id)).sort(sortCats);
  // items are resolved at the same time (each mega menu's top brands is its own lookup)
  const one = async (n) => {
    const item = { id: n.id, label: n.label, href: hrefOf(n), external: isExternal(n), mega: !!n.mega, children: [], columns: [], brands: [], promo: n.promo || null };
    if (n.dropdown === "subcategories") {
      const c = bySlug.get(n.ref);
      if (c) item.children = kidsOf(c.id).map((k) => ({ label: k.name, href: `/categories/${k.slug}` }));
      if (c && n.brands) item.brands = await topBrands(cats, c.id);
    } else if (n.dropdown === "categories") {
      // every top-level category; in a mega menu each is a column with its sub-categories
      item.columns = cats.filter((c) => !c.parent_id).sort(sortCats).map((t) => ({
        label: t.name, href: `/categories/${t.slug}`, children: kidsOf(t.id).slice(0, 12).map((k) => ({ label: k.name, href: `/categories/${k.slug}` })),
      }));
    } else if (n.dropdown === "manual") {
      item.children = (n.children || []).map((c) => ({ label: c.label, href: hrefOf(c), external: isExternal(c) }));
    }
    if (n.dropdown !== "none" && !item.children.length && !item.columns.length) { item.mega = false; item.promo = null; }
    return item;
  };
  return Promise.all(nav.filter((n) => !n.hidden).map(one));
};

let cache = { at: 0, value: null };
/** The live menu (cached 30 s; saving the menu clears it). */
const publicNav = async () => {
  if (cache.value && Date.now() - cache.at < 30000) return cache.value;
  const s = await getMarketplaceSettings();
  const value = await resolveNav(s.nav || (await defaultNav()));
  cache = { at: Date.now(), value };
  return value;
};
const clearNavCache = () => { cache = { at: 0, value: null }; };
/** After categories change (added, renamed, moved, hidden...): menus and category lists pick it up at once. */
const categoriesChanged = () => { mk.clearCategoryCache(); clearNavCache(); require("./homepage").clearHomepageCache(); };
/** Express middleware: clears the caches once a changing request on categories has finished. */
const onCategoryChange = (req, res, next) => { if (req.method !== "GET") res.on("finish", categoriesChanged); next(); };

module.exports = { defaultNav, resolveNav, publicNav, clearNavCache, categoriesChanged, onCategoryChange, hrefOf };
