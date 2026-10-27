// Platform-wide marketplace settings (site_settings key "marketplace"), managed by platform admins:
//   nav:        the top navigation: [{ label, type: category|brand|company|collection|link, ref }] (ref = slug or path/URL)
//   featured:   { brand_ids, category_ids, company_ids }
//   banners:    homepage banners [{ image_url, image_alt, title, subtitle, link }]
//   storefront: what companies may use: { themes: [...], custom_colors, sections: [...] }
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");

const KEY = "marketplace";
const ALL_THEMES = ["classic", "modern", "bold", "minimal"];
const ALL_SECTIONS = ["hero", "promo_banners", "featured_products", "product_grid", "collection", "featured_brands", "category_tiles", "announcement", "about", "contact", "deals"];

const DEFAULTS = {
  nav: [
    { label: "Categories", type: "link", ref: "/categories" },
    { label: "Brands", type: "link", ref: "/brands" },
    { label: "Suppliers", type: "link", ref: "/companies" },
    { label: "Deals", type: "link", ref: "/deals" },
  ],
  featured: { brand_ids: [], category_ids: [], company_ids: [] },
  banners: [],
  storefront: { themes: ALL_THEMES, custom_colors: true, sections: ALL_SECTIONS },
};

let cache = { at: 0, value: null };

const getMarketplaceSettings = async () => {
  if (cache.value && Date.now() - cache.at < 15000) return cache.value;
  const row = await prisma.site_settings.findUnique({ where: { key: KEY } });
  const v = row?.value && typeof row.value === "object" ? row.value : {};
  const value = {
    // not set up yet: null, and the menu is built from the categories (services/siteNav)
    nav: Array.isArray(v.nav) ? v.nav : null,
    featured: { ...DEFAULTS.featured, ...(v.featured || {}) },
    banners: Array.isArray(v.banners) ? v.banners : [],
    storefront: { ...DEFAULTS.storefront, ...(v.storefront || {}) },
  };
  cache = { at: Date.now(), value };
  return value;
};

const fail = (m) => { throw new HttpError(400, m); };
const str = (v, max, label) => {
  const s = String(v ?? "").replace(/<[^>]*>/g, "").trim();
  if (s.length > max) fail(`${label} is too long`);
  return s;
};
const pathOrUrl = (v, label) => {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\/(?!\/)[\w\-./?=&%#~+:]*$/.test(s)) return s;
  try { const u = new URL(s); if (["http:", "https:"].includes(u.protocol)) return u.toString(); } catch { /* invalid */ }
  fail(`${label}: use a page on this site (starting with /) or a web address`);
};
const idList = (v, label) => (Array.isArray(v) ? v : []).map((x) => { if (!/^\d+$/.test(String(x))) fail(`${label}: invalid id`); return String(x); }).slice(0, 50);

const NAV_TYPES = ["category", "brand", "company", "collection", "link", "menu"];
const DROPDOWNS = ["none", "subcategories", "categories", "manual"];

/** One menu destination { label, type, ref }; checks it exists. */
const navTarget = async (n, label, { allowMenu = true } = {}) => {
  const name = str(n?.label, 40, label);
  if (!name) fail(`${label}: add a label`);
  const type = NAV_TYPES.includes(n?.type) && (allowMenu || n.type !== "menu") ? n.type : fail(`${label}: unknown type`);
  if (type === "menu") return { label: name, type, ref: "" };
  const ref = type === "link" ? pathOrUrl(n.ref, label) : String(n.ref || "").trim().toLowerCase();
  if (!ref) fail(`${label}: choose where it goes`);
  if (type !== "link" && !/^[a-z0-9-]+$/.test(ref)) fail(`${label}: invalid web address`);
  const exists =
    type === "category" ? await prisma.categories.findFirst({ where: { slug: ref, status: "active" } })
      : type === "brand" ? await prisma.brands.findFirst({ where: { slug: ref } })
        : type === "company" ? await prisma.companies.findFirst({ where: { slug: ref, status: "active" } })
          : type === "collection" ? await prisma.collections.findFirst({ where: { slug: ref, company_id: null } })
            : true;
  if (!exists) fail(`${label} ("${name}"): ${type} "${ref}" doesn't exist`);
  return { label: name, type, ref };
};

/**
 * The top menu. Each item: { id, label, type, ref, hidden, dropdown, children, mega, brands, promo }
 *   dropdown: none | subcategories (of a category item) | categories (every top-level category) | manual (children)
 *   mega: show the dropdown as wide columns; brands: add the top brands of that category; promo: an image tile in the mega menu
 * null = not set up yet (the menu is built from the categories).
 */
const sanitizeNav = async (input) => {
  if (input === null || input === undefined) return null;
  if (!Array.isArray(input)) fail("The menu must be a list");
  const out = [];
  for (const [i, n] of input.slice(0, 12).entries()) {
    const label = `Menu item ${i + 1}`;
    const base = await navTarget(n, label);
    const dropdown = DROPDOWNS.includes(n.dropdown) ? n.dropdown : "none";
    if (dropdown === "subcategories" && base.type !== "category") fail(`${label}: only a category can list its sub-categories`);
    if (base.type === "menu" && dropdown === "none") fail(`${label}: a menu heading needs a dropdown`);
    const children = [];
    if (dropdown === "manual") {
      for (const [j, c] of (Array.isArray(n.children) ? n.children : []).slice(0, 24).entries()) children.push(await navTarget(c, `${label}, link ${j + 1}`, { allowMenu: false }));
      if (!children.length) fail(`${label}: add at least one link to its dropdown`);
    }
    let promo = null;
    if (n.promo && (n.promo.image_url || n.promo.title)) {
      const img = pathOrUrl(n.promo.image_url, `${label} promo image`);
      if (!img) fail(`${label}: the promo tile needs an image`);
      promo = { image_url: img, title: str(n.promo.title, 80, `${label} promo title`), link: pathOrUrl(n.promo.link, `${label} promo link`) };
    }
    out.push({
      id: /^[a-z0-9-]{4,40}$/.test(String(n.id || "")) ? String(n.id) : Math.random().toString(36).slice(2, 10),
      ...base, hidden: !!n.hidden, dropdown, children,
      mega: dropdown !== "none" && !!n.mega, brands: dropdown !== "none" && !!n.brands && base.type === "category", promo: dropdown !== "none" ? promo : null,
    });
  }
  return out;
};

/** Validates every part, and checks that featured / navigation targets exist. */
const sanitizeSettings = async (input) => {
  const v = input || {};
  const nav = await sanitizeNav(v.nav);
  const featured = {
    brand_ids: idList(v.featured?.brand_ids, "Featured brands"),
    category_ids: idList(v.featured?.category_ids, "Featured categories"),
    company_ids: idList(v.featured?.company_ids, "Featured companies"),
  };
  const banners = (Array.isArray(v.banners) ? v.banners : []).slice(0, 8).map((b, i) => {
    const img = pathOrUrl(b?.image_url, `Banner ${i + 1} image`);
    if (!img) fail(`Banner ${i + 1}: add an image`);
    return { image_url: img, image_alt: str(b.image_alt, 200, `Banner ${i + 1} description`), title: str(b.title, 120, `Banner ${i + 1} title`), subtitle: str(b.subtitle, 240, `Banner ${i + 1} subtitle`), link: pathOrUrl(b.link, `Banner ${i + 1} link`) };
  });
  const sf = v.storefront || {};
  const themes = (Array.isArray(sf.themes) ? sf.themes : ALL_THEMES).filter((t) => ALL_THEMES.includes(t));
  if (!themes.length) fail("Allow at least one storefront theme");
  const sections = (Array.isArray(sf.sections) ? sf.sections : ALL_SECTIONS).filter((t) => ALL_SECTIONS.includes(t));
  if (!sections.length) fail("Allow at least one storefront section");
  return { nav, featured, banners, storefront: { themes, custom_colors: sf.custom_colors !== false, sections } };
};

const saveMarketplaceSettings = async (value) => {
  await prisma.site_settings.upsert({ where: { key: KEY }, create: { key: KEY, value, updated_at: new Date() }, update: { value, updated_at: new Date() } });
  cache = { at: 0, value: null };
  require("./homepage").clearHomepageCache();
};

module.exports = { ALL_THEMES, ALL_SECTIONS, DEFAULTS, getMarketplaceSettings, sanitizeSettings, saveMarketplaceSettings, sanitizeNav, str, pathOrUrl, fail };
