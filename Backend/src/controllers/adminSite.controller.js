// Admin → Site: the top menu, homepage hero, announcement bar and category notices, the homepage layout, the look.
// Everything is stored in site_settings (see services/siteContent, services/homepage, services/marketplaceSettings).
const crypto = require("crypto");
const { HttpError } = require("../utils/http");
const { audit } = require("../services/audit");
const { supabaseAdmin } = require("../lib/supabaseAdmin");
const mset = require("../services/marketplaceSettings");
const siteNav = require("../services/siteNav");
const content = require("../services/siteContent");
const hp = require("../services/homepage");

// GET /admin/site -> everything the Site screens edit
const getSite = async (req, res) => {
  const s = await mset.getMarketplaceSettings();
  const stored = await hp.getStored();
  const draft = await hp.draftConfig();
  res.json({
    data: {
      nav: s.nav || (await siteNav.defaultNav()), nav_is_default: !s.nav,
      hero: await content.getHero(), hero_is_default: !(await content.read("hero")),
      notices: await content.getNotices(),
      appearance: await content.getAppearance(),
      homepage: {
        draft, published_at: stored.published_at, is_default: !stored.published,
        has_unpublished_changes: JSON.stringify(draft) !== JSON.stringify(stored.published || hp.DEFAULT_CONFIG),
        versions: (stored.versions || []).map((v, i) => ({ index: i, at: v.at, by: v.by, sections: v.config.sections.length })),
      },
      section_types: Object.entries(hp.SECTIONS).map(([type, d]) => ({ type, label: d.label, fields: d.fields, sources: d.sources || [], limit: hp.LIMITS[type] || null })),
      icons: hp.ICONS,
    },
  });
};

// PUT /admin/site/nav { nav } (nav: null goes back to the menu built from the categories)
const saveNav = async (req, res) => {
  const nav = await mset.sanitizeNav(req.body.nav);
  const s = await mset.getMarketplaceSettings();
  await mset.saveMarketplaceSettings({ ...s, nav });
  siteNav.clearNavCache();
  await audit(req, "admin.site.nav", { entity: "site_settings", changes: { items: nav ? nav.length : "default" } });
  res.json({ message: nav ? "Menu saved" : "Menu reset: it's built from the categories again", data: nav || (await siteNav.defaultNav()) });
};

// POST /admin/site/nav/preview { nav } -> the menu as visitors would see it (not saved)
const previewNav = async (req, res) => {
  const nav = await mset.sanitizeNav(req.body.nav);
  res.json({ data: await siteNav.resolveNav(nav || (await siteNav.defaultNav())) });
};

const saveHero = async (req, res) => {
  const hero = content.sanitizeHero(req.body.hero);
  await content.write("hero", hero);
  await audit(req, "admin.site.hero", { entity: "site_settings", changes: { slides: hero.slides.length } });
  res.json({ message: "Hero saved", data: hero });
};
const resetHero = async (req, res) => {
  await content.write("hero", content.HERO_DEFAULT);
  res.json({ message: "Hero reset to the original slides", data: content.HERO_DEFAULT });
};

const saveNotices = async (req, res) => {
  const notices = await content.sanitizeNotices(req.body.notices);
  await content.write("notices", notices);
  await audit(req, "admin.site.notices", { entity: "site_settings", changes: { bar: notices.bar.enabled, category_notices: notices.category_notices.length } });
  res.json({ message: "Notices saved", data: notices });
};

const saveAppearance = async (req, res) => {
  const a = content.sanitizeAppearance(req.body.appearance);
  await content.write("appearance", a);
  await audit(req, "admin.site.appearance", { entity: "site_settings", changes: a });
  res.json({ message: "Look saved", data: a });
};

// homepage: draft -> preview (GET /marketplace/homepage?preview=draft) -> publish
const saveHomepage = async (req, res) => {
  const { cfg, warnings } = await hp.saveDraft(req.body.config);
  res.json({ message: "Draft saved. Visitors see it once you publish.", data: cfg, warnings });
};
const publishHomepage = async (req, res) => {
  const r = await hp.publish(req.user.id);
  await audit(req, "admin.site.homepage.publish", { entity: "site_settings" });
  res.json({ message: "Homepage published", warnings: r.warnings });
};
const resetHomepage = async (req, res) => res.json({ message: "Draft reset to the standard homepage", data: await hp.resetDraft() });
const restoreHomepage = async (req, res) => res.json({ message: "That version is now the draft. Publish to make it live.", data: await hp.restore(Number(req.params.index)) });

// POST /admin/site/images (multipart "image") -> an image address for slides, banners, logos
const uploadImage = async (req, res) => {
  if (!supabaseAdmin) throw new HttpError(503, "Image storage is not configured on the server");
  if (!req.file?.mimetype?.startsWith("image/") || req.file.mimetype === "image/svg+xml") throw new HttpError(400, "Please upload a JPG, PNG, WebP or GIF image");
  const path = `site/${crypto.randomUUID()}`;
  const { error } = await supabaseAdmin.storage.from("site-assets").upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (error) throw error;
  res.status(201).json({ url: supabaseAdmin.storage.from("site-assets").getPublicUrl(path).data.publicUrl });
};

module.exports = { getSite, saveNav, previewNav, saveHero, resetHero, saveNotices, saveAppearance, saveHomepage, publishHomepage, resetHomepage, restoreHomepage, uploadImage };
