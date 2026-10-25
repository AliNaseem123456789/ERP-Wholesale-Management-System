// A company's collections and storefront editor (draft -> preview -> publish, with version history).
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { audit } = require("../../services/audit");
const sf = require("../../services/storefront");
const col = require("../../services/collections");
const { getMarketplaceSettings } = require("../../services/marketplaceSettings");
const { storefrontPayload } = require("../marketplace.controller");

const TX = { timeout: 30000, maxWait: 10000 };

// ---- collections -------------------------------------------------------------------------------

const findOwnCollection = async (req) => {
  const c = await prisma.collections.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!c) throw new HttpError(404, "Collection not found");
  return c;
};

// GET /company/collections
const listCollections = async (req, res) => {
  const rows = await prisma.collections.findMany({
    where: { company_id: req.company.id }, orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    include: { _count: { select: { collection_products: true } } },
  });
  res.json({ data: rows.map(({ _count, ...c }) => ({ ...c, product_count: _count.collection_products, live: col.live(c) })) });
};

const getCollection = async (req, res) => {
  res.json({ data: await col.detail(prisma, await findOwnCollection(req)) });
};

// POST /company/collections { name, slug?, description?, cover_image_url?, status?, is_enabled?, starts_at?, ends_at?, product_ids? }
const createCollection = async (req, res) => {
  const c = await prisma.$transaction((tx) => col.create(tx, { companyId: req.company.id, userId: req.user.id, body: req.body }), TX);
  await audit(req, "collection.create", { entity: "collection", entityId: c.id, changes: { name: c.name } });
  res.status(201).json({ data: await col.detail(prisma, c) });
};

const updateCollection = async (req, res) => {
  const current = await findOwnCollection(req);
  const c = await prisma.$transaction((tx) => col.update(tx, { collection: current, body: req.body }), TX);
  await audit(req, "collection.update", { entity: "collection", entityId: c.id, changes: { ...req.body, product_ids: req.body.product_ids ? req.body.product_ids.length : undefined } });
  res.json({ data: await col.detail(prisma, c) });
};

const deleteCollection = async (req, res) => {
  const c = await findOwnCollection(req);
  await prisma.collections.delete({ where: { id: c.id } });
  await audit(req, "collection.delete", { entity: "collection", entityId: c.id, changes: { name: c.name } });
  res.json({ message: `Collection "${c.name}" deleted. Storefront sections that showed it are skipped until you change them.` });
};

// ---- storefront --------------------------------------------------------------------------------

const getStore = (companyId) => prisma.storefronts.findUnique({ where: { company_id: companyId } });

// GET /company/storefront -> draft (or the default layout), what's published, and what may be used
const getStorefront = async (req, res) => {
  const [store, settings] = await Promise.all([getStore(req.company.id), getMarketplaceSettings()]);
  const draft = store?.draft?.sections ? store.draft : sf.defaultConfig(req.company);
  res.json({
    data: {
      draft,
      published: store?.published || null,
      published_version: store?.published_version || 0,
      published_at: store?.published_at || null,
      has_unpublished_changes: !store?.published || JSON.stringify(store.published) !== JSON.stringify(draft),
      storefront_published: req.company.storefront_published,
      company_live: req.company.status === "active",
      slug: req.company.slug,
      themes: settings.storefront.themes.map((k) => ({ key: k, ...sf.THEMES[k] })),
      custom_colors: settings.storefront.custom_colors,
      section_types: settings.storefront.sections.map((t) => ({ type: t, label: sf.SECTIONS[t].label, layouts: sf.SECTIONS[t].layouts, fields: sf.SECTIONS[t].fields })),
    },
  });
};

// PUT /company/storefront { config } -> saves the draft (the public storefront doesn't change)
const saveDraft = async (req, res) => {
  const cfg = await sf.sanitize(req.body.config);
  const warnings = await sf.checkReferences(prisma, req.company.id, cfg);
  await prisma.storefronts.upsert({
    where: { company_id: req.company.id },
    create: { company_id: req.company.id, draft: cfg, updated_by: BigInt(req.user.id) },
    update: { draft: cfg, updated_at: new Date(), updated_by: BigInt(req.user.id) },
  });
  await audit(req, "storefront.draft", { entity: "storefront", entityId: req.company.id, changes: { sections: cfg.sections.length } });
  res.json({ message: "Draft saved. Customers see it once you publish.", data: cfg, warnings });
};

// GET /company/storefront/preview?source=draft|published -> the page as customers would see it
const preview = async (req, res) => {
  const store = await getStore(req.company.id);
  const cfg = req.query.source === "published" ? store?.published || sf.defaultConfig(req.company) : store?.draft?.sections ? store.draft : sf.defaultConfig(req.company);
  res.json({ data: await storefrontPayload(req, req.company, cfg), preview: true });
};

// POST /company/storefront/publish -> the draft becomes the public storefront (a new version)
const publish = async (req, res) => {
  const store = await getStore(req.company.id);
  const cfg = await sf.sanitize(store?.draft?.sections ? store.draft : sf.defaultConfig(req.company));
  const warnings = await sf.checkReferences(prisma, req.company.id, cfg);
  const version = (store?.published_version || 0) + 1;
  await prisma.$transaction([
    prisma.storefronts.upsert({
      where: { company_id: req.company.id },
      create: { company_id: req.company.id, draft: cfg, published: cfg, published_version: version, published_at: new Date(), published_by: BigInt(req.user.id), updated_by: BigInt(req.user.id) },
      update: { draft: cfg, published: cfg, published_version: version, published_at: new Date(), published_by: BigInt(req.user.id) },
    }),
    prisma.storefront_versions.create({ data: { company_id: req.company.id, version, config: cfg, published_by: BigInt(req.user.id) } }),
  ]);
  await audit(req, "storefront.publish", { entity: "storefront", entityId: req.company.id, changes: { version } });
  res.json({ message: `Storefront published (version ${version})`, version, warnings });
};

// POST /company/storefront/unpublish -> customers see the standard layout again (the draft is kept)
const unpublish = async (req, res) => {
  await prisma.storefronts.updateMany({ where: { company_id: req.company.id }, data: { published: null, published_at: null } });
  await audit(req, "storefront.unpublish", { entity: "storefront", entityId: req.company.id });
  res.json({ message: "Your custom storefront is off; customers see the standard company page." });
};

// POST /company/storefront/reset -> the draft goes back to the standard layout
const resetDraft = async (req, res) => {
  const cfg = sf.defaultConfig(req.company);
  await prisma.storefronts.upsert({
    where: { company_id: req.company.id },
    create: { company_id: req.company.id, draft: cfg, updated_by: BigInt(req.user.id) },
    update: { draft: cfg, updated_at: new Date(), updated_by: BigInt(req.user.id) },
  });
  res.json({ message: "Draft reset to the standard layout", data: cfg });
};

// GET /company/storefront/versions
const versions = async (req, res) => {
  const rows = await prisma.storefront_versions.findMany({ where: { company_id: req.company.id }, orderBy: { version: "desc" }, take: 50, select: { version: true, published_at: true, published_by: true } });
  const users = await prisma.users.findMany({ where: { id: { in: rows.map((r) => r.published_by).filter(Boolean) } }, select: { id: true, email: true, first_name: true } });
  res.json({ data: rows.map((r) => ({ ...r, published_by: users.find((u) => u.id === r.published_by) || null })) });
};

// POST /company/storefront/versions/:version/restore -> that version becomes the draft
const restoreVersion = async (req, res) => {
  const v = await prisma.storefront_versions.findUnique({ where: { company_id_version: { company_id: req.company.id, version: Number(req.params.version) || 0 } } });
  if (!v) throw new HttpError(404, "Version not found");
  // re-validate: themes or sections may have been restricted since
  const cfg = await sf.sanitize(v.config);
  await prisma.storefronts.update({ where: { company_id: req.company.id }, data: { draft: cfg, updated_at: new Date(), updated_by: BigInt(req.user.id) } });
  res.json({ message: `Version ${v.version} copied into the draft. Publish to make it live.`, data: cfg });
};

module.exports = {
  listCollections, getCollection, createCollection, updateCollection, deleteCollection,
  getStorefront, saveDraft, preview, publish, unpublish, resetDraft, versions, restoreVersion,
};
