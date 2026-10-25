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
    { label: "Deals", type: "link", ref: "/products?featured=1" },
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
    nav: Array.isArray(v.nav) ? v.nav : DEFAULTS.nav,
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

/** Validates every part, and checks that featured / navigation targets exist. */
const sanitizeSettings = async (input) => {
  const v = input || {};
  const nav = (Array.isArray(v.nav) ? v.nav : []).slice(0, 12).map((n, i) => {
    const label = str(n?.label, 40, `Menu item ${i + 1}`);
    if (!label) fail(`Menu item ${i + 1}: add a label`);
    const type = ["category", "brand", "company", "collection", "link"].includes(n.type) ? n.type : fail(`Menu item ${i + 1}: unknown type`);
    const ref = type === "link" ? pathOrUrl(n.ref, `Menu item ${i + 1}`) : String(n.ref || "").trim().toLowerCase();
    if (!ref) fail(`Menu item ${i + 1}: choose where it goes`);
    if (type !== "link" && !/^[a-z0-9-]+$/.test(ref)) fail(`Menu item ${i + 1}: invalid web address`);
    return { label, type, ref };
  });
  // destinations must exist
  for (const n of nav) {
    const exists =
      n.type === "category" ? await prisma.categories.findFirst({ where: { slug: n.ref, status: "active" } })
        : n.type === "brand" ? await prisma.brands.findFirst({ where: { slug: n.ref } })
          : n.type === "company" ? await prisma.companies.findFirst({ where: { slug: n.ref, status: "active" } })
            : n.type === "collection" ? await prisma.collections.findFirst({ where: { slug: n.ref, company_id: null } })
              : true;
    if (!exists) fail(`Menu item "${n.label}": ${n.type} "${n.ref}" doesn't exist`);
  }
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
};

module.exports = { ALL_THEMES, ALL_SECTIONS, DEFAULTS, getMarketplaceSettings, sanitizeSettings, saveMarketplaceSettings };
