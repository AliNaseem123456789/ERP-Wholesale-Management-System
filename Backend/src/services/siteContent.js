// Platform content managed in Admin → Site, stored in site_settings (no tables of its own):
//   site_hero        homepage hero: layout, slides, buttons for visitors / signed-in buyers
//   site_notices     the announcement bar, and notices shown with the products of a category (e.g. a nicotine warning)
//   site_appearance  the marketplace look ("neon" or "clean") and the default light / dark mode
//   site_homepage    the homepage sections: { draft, published, published_at, versions: [{ at, by, config }] }
// Every value is validated here; only plain text, site paths and http(s) addresses are stored (no HTML).
const prisma = require("../prisma");
const { str, pathOrUrl, fail } = require("./marketplaceSettings");

const KEYS = { hero: "site_hero", notices: "site_notices", appearance: "site_appearance", homepage: "site_homepage" };

const cache = new Map();
const read = async (name) => {
  const c = cache.get(name);
  if (c && Date.now() - c.at < 15000) return c.value;
  const row = await prisma.site_settings.findUnique({ where: { key: KEYS[name] } });
  const value = row?.value && typeof row.value === "object" ? row.value : null;
  cache.set(name, { at: Date.now(), value });
  return value;
};
const write = async (name, value) => {
  await prisma.site_settings.upsert({ where: { key: KEYS[name] }, create: { key: KEYS[name], value, updated_at: new Date() }, update: { value, updated_at: new Date() } });
  cache.delete(name);
};

const newId = () => Math.random().toString(36).slice(2, 10);
const idOf = (v) => (/^[a-z0-9-]{4,40}$/.test(String(v || "")) ? String(v) : newId());
const image = (v, label, { required = false } = {}) => {
  const s = pathOrUrl(v, label);
  if (required && !s) fail(`${label}: add an image`);
  return s;
};
const date = (v, label) => {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) fail(`${label} isn't a valid date`);
  return d.toISOString();
};
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const live = (x, now = new Date()) => x && x.enabled !== false && (!x.starts_at || new Date(x.starts_at) <= now) && (!x.ends_at || new Date(x.ends_at) >= now);
const forAudience = (x, req) => !x.audience || x.audience === "all" || (x.audience === "buyers" ? !!req?.user : !req?.user);

// ---- hero ----------------------------------------------------------------------------------------
const HERO_DEFAULT = {
  layout: "full", interval: 6, thumbnails: true,
  visitor_buttons: [{ label: "Get started", link: "/register", style: "primary" }, { label: "Log in", link: "/login", style: "secondary" }],
  buyer_buttons: [{ label: "View my cart", link: "/cart", style: "primary" }, { label: "Browse categories", link: "/categories", style: "secondary" }],
  slides: [
    ["/logos/banner5.jpeg", "THE FUTURE OF", "WHOLESALE", "Modern tooling, rapid fulfillment and pricing that keeps you ahead of the market."],
    ["/logos/banner6.jpeg", "ONE CART", "EVERY SUPPLIER", "Browse approved wholesalers side by side and check out once — each seller still gets their own order."],
    ["/logos/banner7.jpeg", "BUILT TO", "MOVE FAST", "From quote to invoice in minutes, not days. Every workflow tuned for speed, accuracy and growth."],
    ["/logos/banner8.jpeg", "ORDER TO", "DELIVERY", "Live stock, real-time tracking and a supply chain that runs end-to-end without the guesswork."],
    ["/logos/banner9.jpeg", "WHOLESALE", "REDEFINED", "Your price list, volume tiers and credit terms load automatically — no quote emails, no waiting."],
  ].map(([img, title, highlight, subtitle], i) => ({
    id: `slide-${i + 1}`, enabled: true, image_url: img, mobile_image_url: "", image_alt: "", title, highlight, subtitle, buttons: [], audience: "all", starts_at: null, ends_at: null,
  })),
};

const buttons = (list, label) => (Array.isArray(list) ? list : []).slice(0, 2).map((b, i) => {
  const l = str(b?.label, 40, `${label} button ${i + 1}`);
  const link = pathOrUrl(b?.link, `${label} button ${i + 1}`);
  if (!l || !link) fail(`${label} button ${i + 1}: add a label and a link`);
  return { label: l, link, style: oneOf(b.style, ["primary", "secondary"], i ? "secondary" : "primary") };
});

const sanitizeHero = (v) => {
  const h = v || {};
  const slides = (Array.isArray(h.slides) ? h.slides : []).slice(0, 8).map((s, i) => {
    const n = `Slide ${i + 1}`;
    const out = {
      id: idOf(s.id), enabled: s.enabled !== false,
      image_url: image(s.image_url, `${n} image`, { required: true }), mobile_image_url: image(s.mobile_image_url, `${n} phone image`),
      image_alt: str(s.image_alt, 200, `${n} image description`),
      title: str(s.title, 80, `${n} headline`), highlight: str(s.highlight, 80, `${n} highlighted words`), subtitle: str(s.subtitle, 300, `${n} text`),
      buttons: buttons(s.buttons, n), audience: oneOf(s.audience, ["all", "visitors", "buyers"], "all"),
      starts_at: date(s.starts_at, `${n} start`), ends_at: date(s.ends_at, `${n} end`),
    };
    if (out.starts_at && out.ends_at && out.ends_at < out.starts_at) fail(`${n} ends before it starts`);
    return out;
  });
  if (!slides.length) fail("Add at least one slide");
  return {
    layout: oneOf(h.layout, ["full", "split", "search"], "full"),
    interval: Math.min(20, Math.max(3, parseInt(h.interval, 10) || 6)),
    thumbnails: h.thumbnails !== false,
    visitor_buttons: buttons(h.visitor_buttons, "Visitor"), buyer_buttons: buttons(h.buyer_buttons, "Buyer"),
    slides,
  };
};
const getHero = async () => (await read("hero")) || HERO_DEFAULT;
/** The hero as this viewer sees it: live slides for their audience; each slide gets its buttons. */
const heroFor = async (req) => {
  const h = await getHero();
  const now = new Date();
  const defaults = req?.user ? h.buyer_buttons : h.visitor_buttons;
  const slides = h.slides.filter((s) => live(s, now) && forAudience(s, req)).map(({ audience, starts_at, ends_at, enabled, ...s }) => ({ ...s, buttons: s.buttons.length ? s.buttons : defaults }));
  return { layout: h.layout, interval: h.interval, thumbnails: h.thumbnails, slides };
};

// ---- notices -------------------------------------------------------------------------------------
const NOTICE_STYLES = ["info", "warning", "promo", "dark"];
const NOTICES_DEFAULT = {
  bar: { enabled: false, items: [], link: "", link_label: "", style: "dark", scrolling: false, audience: "all", starts_at: null, ends_at: null },
  // filled with the old site-wide nicotine warning for the smoking category when there is one (see noticesForCategories)
  category_notices: null,
};
const SMOKING_WARNING = {
  title: "Warning",
  text: "Some products contain nicotine. Nicotine is an addictive chemical. Sale restricted to adults 21 years of age or older.",
  style: "warning", on_product: true, on_category: true, on_checkout: true,
};

const sanitizeNotices = async (v) => {
  const b = v?.bar || {};
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 6).map((t, i) => str(t, 200, `Announcement ${i + 1}`)).filter(Boolean);
  const bar = {
    enabled: !!b.enabled && items.length > 0, items, link: pathOrUrl(b.link, "Announcement link"), link_label: str(b.link_label, 40, "Announcement link text"),
    style: oneOf(b.style, NOTICE_STYLES, "dark"), scrolling: !!b.scrolling, audience: oneOf(b.audience, ["all", "visitors", "buyers"], "all"),
    starts_at: date(b.starts_at, "Announcement start"), ends_at: date(b.ends_at, "Announcement end"),
  };
  if (b.enabled && !items.length) fail("Write the announcement, or turn it off");
  const list = (Array.isArray(v?.category_notices) ? v.category_notices : []).slice(0, 30);
  const ids = list.map((n) => String(n.category_id || ""));
  if (ids.some((x) => !/^\d+$/.test(x))) fail("Choose a category for every notice");
  const found = await prisma.categories.findMany({ where: { id: { in: ids.map((x) => BigInt(x)) } }, select: { id: true } });
  const category_notices = list.map((n, i) => {
    const label = `Notice ${i + 1}`;
    if (!found.some((c) => String(c.id) === String(n.category_id))) fail(`${label}: that category doesn't exist`);
    const text = str(n.text, 1000, `${label} text`);
    if (!text) fail(`${label}: write the notice`);
    return {
      id: idOf(n.id), category_id: String(n.category_id), title: str(n.title, 80, `${label} title`), text, style: oneOf(n.style, NOTICE_STYLES, "warning"),
      on_product: n.on_product !== false, on_category: n.on_category !== false, on_checkout: n.on_checkout !== false,
    };
  });
  return { bar, category_notices };
};

const getNotices = async () => {
  const v = (await read("notices")) || NOTICES_DEFAULT;
  if (v.category_notices) return v;
  // nothing saved yet: the old site-wide nicotine warning, shown only with smoking products
  const smoking = await prisma.categories.findFirst({ where: { slug: { in: ["smoking-vape", "smoking", "smoke-shop"] }, status: "active" }, orderBy: { id: "asc" }, select: { id: true } });
  return { ...v, category_notices: smoking ? [{ id: "notice-smoking", category_id: String(smoking.id), ...SMOKING_WARNING }] : [] };
};
const barFor = async (req) => {
  const { bar } = await getNotices();
  if (!bar.enabled || !live(bar) || !forAudience(bar, req)) return null;
  const { enabled, audience, starts_at, ends_at, ...out } = bar;
  return out;
};

/** Notices for the given category ids (a notice on a category also covers its sub-categories). where: product | category | checkout */
const noticesForCategories = async (categoryIds, where) => {
  const { category_notices } = await getNotices();
  const list = category_notices.filter((n) => n[`on_${where}`]);
  if (!list.length || !categoryIds.length) return [];
  const { activeCategories } = require("./marketplace");
  const cats = await activeCategories();
  const parent = new Map(cats.map((c) => [String(c.id), c.parent_id ? String(c.parent_id) : null]));
  const covered = new Set();
  for (const id of categoryIds.map(String)) {
    for (let c = id, guard = 0; c && guard < 20; c = parent.get(c), guard++) covered.add(c);
  }
  return list.filter((n) => covered.has(String(n.category_id))).map(({ on_product, on_category, on_checkout, category_id, ...n }) => n);
};

// ---- appearance ----------------------------------------------------------------------------------
const APPEARANCE_DEFAULT = { style: "neon", default_mode: "dark", allow_toggle: true };
const sanitizeAppearance = (v) => ({
  style: oneOf(v?.style, ["neon", "clean"], "neon"),
  default_mode: oneOf(v?.default_mode, ["dark", "light"], "dark"),
  allow_toggle: v?.allow_toggle !== false,
});
const getAppearance = async () => ({ ...APPEARANCE_DEFAULT, ...((await read("appearance")) || {}) });

module.exports = {
  KEYS, read, write, live, forAudience, newId, idOf, image, date, oneOf,
  HERO_DEFAULT, sanitizeHero, getHero, heroFor,
  NOTICES_DEFAULT, sanitizeNotices, getNotices, barFor, noticesForCategories,
  APPEARANCE_DEFAULT, sanitizeAppearance, getAppearance,
};
