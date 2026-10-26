// Platform admin: categories, attributes (and category templates), brands.
const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const { audit } = require("../services/audit");
const cat = require("../services/productCatalog");
const attrs = require("../services/attributes");

const TX = { timeout: 60000, maxWait: 10000 };

// ---- categories --------------------------------------------------------------------------------

// GET /admin/categories -> all categories (flat, parent ids) with product counts and who added them
const listCategories = async (req, res) => {
  const [rows, counts] = await Promise.all([
    prisma.categories.findMany({
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
      include: { companies: { select: { id: true, name: true } }, _count: { select: { category_attributes: true } } },
    }),
    prisma.product_categories.groupBy({ by: ["category_id"], _count: true }),
  ]);
  const countBy = new Map(counts.map((c) => [String(c.category_id), c._count]));
  res.json({
    data: rows.map(({ companies, _count, ...c }) => ({ ...c, created_by_company: companies, product_count: countBy.get(String(c.id)) || 0, attribute_count: _count.category_attributes })),
  });
};

const categoryData = async (body, id = null) => {
  const d = {};
  if (body.name !== undefined) {
    d.name = String(body.name || "").trim().slice(0, 255);
    if (!d.name) throw new HttpError(400, "Name is required");
  }
  if (body.slug !== undefined && body.slug !== "") {
    const s = String(body.slug).trim().toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) throw new HttpError(400, "Web address can only use lowercase letters, numbers and dashes");
    const taken = await prisma.categories.findFirst({ where: { slug: s, ...(id ? { NOT: { id } } : {}) } });
    if (taken) throw new HttpError(409, "That web address is already used by another category");
    d.slug = s;
  }
  if (body.parent_id !== undefined) {
    d.parent_id = body.parent_id ? toId(body.parent_id, "parent_id") : null;
    if (d.parent_id) {
      // no loops: the new parent can't be this category or one of its descendants
      let cursor = d.parent_id;
      for (let i = 0; i < 50 && cursor; i++) {
        if (id && cursor === id) throw new HttpError(400, "A category can't be placed inside itself");
        const p = await prisma.categories.findUnique({ where: { id: cursor }, select: { parent_id: true } });
        if (!p) throw new HttpError(400, "Parent category not found");
        cursor = p.parent_id;
      }
    }
  }
  if (body.description !== undefined) d.description = body.description ? String(body.description).slice(0, 5000) : null;
  if (body.image_url !== undefined) {
    if (body.image_url && !cat.isHttpUrl(body.image_url)) throw new HttpError(400, "Image must be a web address (https://...)");
    d.image_url = body.image_url || null;
  }
  if (body.is_featured !== undefined) d.is_featured = !!body.is_featured;
  if (body.sort_order !== undefined) d.sort_order = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0;
  if (body.status !== undefined) {
    if (!["active", "hidden"].includes(body.status)) throw new HttpError(400, "Status must be active or hidden");
    d.status = body.status;
  }
  // where the address of a hidden category sends visitors: a page on this site
  if (body.redirect_to !== undefined) {
    const r = String(body.redirect_to || "").trim();
    if (r && !/^\/(?!\/)[\w\-./?=&%#~+:]*$/.test(r)) throw new HttpError(400, "Send visitors to a page on this site (starting with /), e.g. /brands/zippo");
    d.redirect_to = r ? r.slice(0, 500) : null;
  }
  return d;
};

const nameClash = async (name, parentId, exceptId = null) =>
  prisma.categories.findFirst({ where: { parent_id: parentId ?? null, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });

// POST /admin/categories { name, parent_id?, slug?, description?, image_url?, is_featured?, sort_order?, template? }
const createCategory = async (req, res) => {
  const d = await categoryData(req.body);
  if (!d.name) throw new HttpError(400, "Name is required");
  if (await nameClash(d.name, d.parent_id)) throw new HttpError(409, "A category with this name already exists here");
  const c = await prisma.$transaction(async (tx) => {
    const created = await tx.categories.create({ data: { ...d, slug: d.slug || (await cat.uniqueCategorySlug(tx, d.name)), created_by: BigInt(req.user.id) } });
    if (req.body.template) await attrs.applyTemplate(tx, { categoryId: created.id, template: req.body.template });
    return created;
  }, TX);
  await audit(req, "admin.category.create", { entity: "category", entityId: c.id, changes: { name: c.name } });
  res.status(201).json({ data: c });
};

// PATCH /admin/categories/:id
const updateCategory = async (req, res) => {
  const id = toId(req.params.id);
  const current = await prisma.categories.findUnique({ where: { id } });
  if (!current) throw new HttpError(404, "Category not found");
  const d = await categoryData(req.body, id);
  const name = d.name ?? current.name;
  const parent = d.parent_id !== undefined ? d.parent_id : current.parent_id;
  if ((d.name || d.parent_id !== undefined) && (await nameClash(name, parent, id))) throw new HttpError(409, "A category with this name already exists here");
  const c = await prisma.$transaction(async (tx) => {
    const u = await tx.categories.update({ where: { id }, data: { ...d, updated_at: new Date() } });
    if (d.name && d.name !== current.name) {
      // keep the older text list on products in step with the new name
      await tx.$executeRaw`UPDATE products SET categories = array_replace(categories, ${current.name}, ${d.name})
        WHERE id IN (SELECT product_id FROM product_categories WHERE category_id = ${id})`;
    }
    return u;
  }, TX);
  await audit(req, "admin.category.update", { entity: "category", entityId: id, changes: d });
  res.json({ data: c });
};

/**
 * POST /admin/categories/:id/merge { into_id }
 * Moves every product, sub-category and attribute of this category into another one, then deletes it.
 */
const mergeCategory = async (req, res) => {
  const id = toId(req.params.id);
  const intoId = toId(req.body.into_id, "into_id");
  if (id === intoId) throw new HttpError(400, "Choose a different category to merge into");
  const [from, into] = await Promise.all([prisma.categories.findUnique({ where: { id } }), prisma.categories.findUnique({ where: { id: intoId } })]);
  if (!from || !into) throw new HttpError(404, "Category not found");
  const moved = await prisma.$transaction(async (tx) => {
    const links = await tx.product_categories.findMany({ where: { category_id: id } });
    for (const l of links) {
      await tx.product_categories.upsert({
        where: { product_id_category_id: { product_id: l.product_id, category_id: intoId } },
        create: { product_id: l.product_id, category_id: intoId, sort_order: l.sort_order },
        update: {},
      });
    }
    await tx.product_categories.deleteMany({ where: { category_id: id } });
    if (links.length) {
      await tx.$executeRaw`UPDATE products SET categories = (
          SELECT COALESCE(array_agg(c.name ORDER BY pc.sort_order), '{}') FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = products.id)
        WHERE id IN (SELECT product_id FROM product_categories WHERE category_id = ${intoId})`;
    }
    await tx.categories.updateMany({ where: { parent_id: id }, data: { parent_id: intoId } });
    const ca = await tx.category_attributes.findMany({ where: { category_id: id } });
    for (const a of ca) {
      await tx.category_attributes.upsert({
        where: { category_id_attribute_id: { category_id: intoId, attribute_id: a.attribute_id } },
        create: { category_id: intoId, attribute_id: a.attribute_id, is_required: a.is_required, sort_order: a.sort_order },
        update: {},
      });
    }
    await tx.categories.delete({ where: { id } });
    return links.length;
  }, TX);
  await audit(req, "admin.category.merge", { entity: "category", entityId: intoId, changes: { from: from.name, into: into.name, products: moved } });
  res.json({ message: `"${from.name}" merged into "${into.name}" (${moved} product(s) moved)` });
};

// DELETE /admin/categories/:id -> only when no product uses it (merge it otherwise)
const deleteCategory = async (req, res) => {
  const id = toId(req.params.id);
  const used = await prisma.product_categories.count({ where: { category_id: id } });
  if (used) throw new HttpError(400, `${used} product(s) are in this category. Merge it into another category instead.`);
  await prisma.$transaction([
    prisma.categories.updateMany({ where: { parent_id: id }, data: { parent_id: null } }),
    prisma.categories.delete({ where: { id } }),
  ]);
  await audit(req, "admin.category.delete", { entity: "category", entityId: id });
  res.json({ message: "Category deleted" });
};

// GET /admin/categories/:id/attributes
const getCategoryAttributes = async (req, res) => {
  const rows = await prisma.category_attributes.findMany({
    where: { category_id: toId(req.params.id) }, orderBy: { sort_order: "asc" },
    include: { attribute_definitions: { include: { attribute_options: { orderBy: { sort_order: "asc" } } } } },
  });
  res.json({ data: rows.map((r) => ({ ...r.attribute_definitions, is_required: r.is_required, sort_order: r.sort_order })) });
};

// PUT /admin/categories/:id/attributes { attributes: [{ attribute_id, is_required }] } (order = list order)
const setCategoryAttributes = async (req, res) => {
  const id = toId(req.params.id);
  if (!(await prisma.categories.findUnique({ where: { id } }))) throw new HttpError(404, "Category not found");
  const list = Array.isArray(req.body.attributes) ? req.body.attributes : [];
  const ids = list.map((a) => toId(a.attribute_id, "attribute_id"));
  const found = await prisma.attribute_definitions.count({ where: { id: { in: ids }, company_id: null } });
  if (found !== new Set(ids.map(String)).size) throw new HttpError(400, "Only platform attributes can be linked to categories");
  await prisma.$transaction(async (tx) => {
    await tx.category_attributes.deleteMany({ where: { category_id: id } });
    if (list.length) await tx.category_attributes.createMany({ data: list.map((a, i) => ({ category_id: id, attribute_id: ids[i], is_required: !!a.is_required, sort_order: i })), skipDuplicates: true });
  });
  await audit(req, "admin.category.attributes", { entity: "category", entityId: id, changes: { attributes: list.length } });
  res.json({ message: "Saved" });
};

// POST /admin/categories/:id/apply-template { template }
const applyTemplate = async (req, res) => {
  const id = toId(req.params.id);
  if (!(await prisma.categories.findUnique({ where: { id } }))) throw new HttpError(404, "Category not found");
  const t = await prisma.$transaction((tx) => attrs.applyTemplate(tx, { categoryId: id, template: req.body.template }), TX);
  await audit(req, "admin.category.template", { entity: "category", entityId: id, changes: { template: req.body.template } });
  res.json({ message: `"${t.name}" details added to the category` });
};

// GET /admin/attribute-templates
const listTemplates = (req, res) => {
  res.json({ data: Object.entries(attrs.TEMPLATES).map(([key, t]) => ({ key, name: t.name, attributes: t.attributes.map((a) => ({ key: a.key, name: a.name, data_type: a.data_type, is_variant_option: !!a.is_variant_option })) })) });
};

// ---- attributes --------------------------------------------------------------------------------

// GET /admin/attributes?scope=global|all
const listAttributes = async (req, res) => {
  const rows = await prisma.attribute_definitions.findMany({
    where: req.query.scope === "all" ? {} : { company_id: null },
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    include: { attribute_options: { orderBy: [{ sort_order: "asc" }, { value: "asc" }] }, companies: { select: { id: true, name: true } }, _count: { select: { product_attribute_values: true, category_attributes: true } } },
  });
  res.json({ data: rows.map(({ _count, companies, ...a }) => ({ ...a, company: companies, value_count: _count.product_attribute_values, category_count: _count.category_attributes })) });
};

// POST /admin/attributes { key?, name, data_type, unit?, scope?, is_variant_option?, is_filterable?, is_searchable?, is_public?, validation?, options? }
const createAttribute = async (req, res) => {
  const d = attrs.definitionData(req.body, { creating: true });
  if (await prisma.attribute_definitions.findFirst({ where: { company_id: null, key: d.key } })) throw new HttpError(409, `An attribute with the key "${d.key}" already exists`);
  const a = await prisma.$transaction(async (tx) => {
    const created = await tx.attribute_definitions.create({ data: d });
    for (const [i, v] of (Array.isArray(req.body.options) ? req.body.options : []).map((x) => String(x).trim()).filter(Boolean).entries()) {
      if (!(await tx.attribute_options.findFirst({ where: { attribute_id: created.id, value: { equals: v, mode: "insensitive" } } }))) {
        await tx.attribute_options.create({ data: { attribute_id: created.id, value: v.slice(0, 255), sort_order: i } });
      }
    }
    return tx.attribute_definitions.findUnique({ where: { id: created.id }, include: { attribute_options: true } });
  });
  await audit(req, "admin.attribute.create", { entity: "attribute", entityId: a.id, changes: { key: a.key } });
  res.status(201).json({ data: a });
};

// PATCH /admin/attributes/:id -> the key and type can't change once values exist
const updateAttribute = async (req, res) => {
  const id = toId(req.params.id);
  const current = await prisma.attribute_definitions.findUnique({ where: { id }, include: { _count: { select: { product_attribute_values: true } } } });
  if (!current) throw new HttpError(404, "Attribute not found");
  const d = attrs.definitionData(req.body);
  if (current._count.product_attribute_values) {
    if (d.key && d.key !== current.key) throw new HttpError(400, "The key can't change once products use this attribute");
    if (d.data_type && d.data_type !== current.data_type) throw new HttpError(400, "The type can't change once products use this attribute");
  }
  if (d.key && d.key !== current.key && (await prisma.attribute_definitions.findFirst({ where: { company_id: current.company_id, key: d.key, NOT: { id } } }))) {
    throw new HttpError(409, `An attribute with the key "${d.key}" already exists`);
  }
  const type = d.data_type || current.data_type;
  if ((d.is_variant_option ?? current.is_variant_option) && !attrs.OPTION_TYPES.includes(type)) throw new HttpError(400, "Only list, number or text attributes can define variants");
  const a = await prisma.attribute_definitions.update({ where: { id }, data: { ...d, updated_at: new Date() }, include: { attribute_options: true } });
  await audit(req, "admin.attribute.update", { entity: "attribute", entityId: id, changes: d });
  res.json({ data: a });
};

// DELETE /admin/attributes/:id -> only when no product uses it
const deleteAttribute = async (req, res) => {
  const id = toId(req.params.id);
  const used = await prisma.product_attribute_values.count({ where: { attribute_id: id } });
  if (used) throw new HttpError(400, `${used} product value(s) use this attribute, so it can't be deleted`);
  await prisma.attribute_definitions.delete({ where: { id } });
  await audit(req, "admin.attribute.delete", { entity: "attribute", entityId: id });
  res.json({ message: "Attribute deleted" });
};

// POST /admin/attributes/:id/options { value }
const addOption = async (req, res) => {
  const a = await prisma.attribute_definitions.findUnique({ where: { id: toId(req.params.id) }, include: { attribute_options: true } });
  if (!a) throw new HttpError(404, "Attribute not found");
  if (!["select", "multiselect"].includes(a.data_type)) throw new HttpError(400, "Only list attributes have values");
  const value = String(req.body.value || "").trim().slice(0, 255);
  if (!value) throw new HttpError(400, "Enter a value");
  if (attrs.findOption(a, value)) throw new HttpError(409, "This value already exists");
  const o = await prisma.attribute_options.create({ data: { attribute_id: a.id, value, sort_order: a.attribute_options.length } });
  res.status(201).json({ data: o });
};

// PATCH /admin/attribute-options/:optionId { value?, sort_order? } -> renaming changes it everywhere it's used
const updateOption = async (req, res) => {
  const o = await prisma.attribute_options.findUnique({ where: { id: toId(req.params.optionId) }, include: { attribute_definitions: { include: { attribute_options: true } } } });
  if (!o) throw new HttpError(404, "Value not found");
  const data = {};
  if (req.body.value !== undefined) {
    const v = String(req.body.value).trim().slice(0, 255);
    if (!v) throw new HttpError(400, "Enter a value");
    const clash = attrs.findOption(o.attribute_definitions, v);
    if (clash && clash.id !== o.id) throw new HttpError(409, "This value already exists");
    data.value = v;
  }
  if (req.body.sort_order !== undefined) data.sort_order = Number(req.body.sort_order) || 0;
  res.json({ data: await prisma.attribute_options.update({ where: { id: o.id }, data }) });
};

// DELETE /admin/attribute-options/:optionId -> only when unused
const deleteOption = async (req, res) => {
  const id = toId(req.params.optionId);
  const used = await prisma.product_attribute_values.count({ where: { option_id: id } });
  if (used) throw new HttpError(400, `${used} product(s) use this value, so it can't be deleted`);
  await prisma.attribute_options.delete({ where: { id } });
  res.json({ message: "Value deleted" });
};

// ---- brands ------------------------------------------------------------------------------------

// PATCH /admin/brands/:id { name?, slug?, logo_url?, description?, website?, is_featured? }
const updateBrand = async (req, res) => {
  const id = toId(req.params.id);
  const current = await prisma.brands.findUnique({ where: { id } });
  if (!current) throw new HttpError(404, "Brand not found");
  const b = req.body;
  const d = {};
  if (b.name !== undefined) {
    d.name = String(b.name || "").trim().slice(0, 255);
    if (!d.name) throw new HttpError(400, "Name is required");
    if (await prisma.brands.findFirst({ where: { name: { equals: d.name, mode: "insensitive" }, NOT: { id } } })) {
      throw new HttpError(409, "Another brand already has this name. Merge the two brands instead.");
    }
  }
  if (b.slug !== undefined && b.slug !== "") {
    const s = String(b.slug).trim().toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) throw new HttpError(400, "Web address can only use lowercase letters, numbers and dashes");
    if (await prisma.brands.findFirst({ where: { slug: s, NOT: { id } } })) throw new HttpError(409, "That web address is already used");
    d.slug = s;
  }
  for (const f of ["logo_url", "website"]) {
    if (b[f] !== undefined) {
      if (b[f] && !cat.isHttpUrl(b[f])) throw new HttpError(400, `${f === "logo_url" ? "Logo" : "Website"} must be a web address (https://...)`);
      d[f] = b[f] || null;
    }
  }
  if (b.description !== undefined) d.description = b.description ? String(b.description).slice(0, 5000) : null;
  if (b.is_featured !== undefined) d.is_featured = !!b.is_featured;
  const brand = await prisma.$transaction(async (tx) => {
    const u = await tx.brands.update({ where: { id }, data: { ...d, updated_at: new Date() } });
    if (d.name && d.name !== current.name) {
      // products keep the brand text too
      await tx.products.updateMany({ where: { brand_id: id }, data: { brand: d.name } });
    }
    return u;
  });
  await audit(req, "admin.brand.update", { entity: "brand", entityId: id, changes: d });
  res.json({ data: brand });
};

/**
 * POST /admin/brands/:id/merge { into_id }
 * Moves products and company links of a duplicate brand to the brand to keep, then deletes the duplicate.
 */
const mergeBrand = async (req, res) => {
  const id = toId(req.params.id);
  const intoId = toId(req.body.into_id, "into_id");
  if (id === intoId) throw new HttpError(400, "Choose a different brand to merge into");
  const [from, into] = await Promise.all([prisma.brands.findUnique({ where: { id } }), prisma.brands.findUnique({ where: { id: intoId } })]);
  if (!from || !into) throw new HttpError(404, "Brand not found");
  const moved = await prisma.$transaction(async (tx) => {
    const r = await tx.products.updateMany({
      where: { OR: [{ brand_id: id }, { brand: { equals: from.name, mode: "insensitive" } }] },
      data: { brand_id: intoId, brand: into.name, updated_at: new Date() },
    });
    for (const l of await tx.company_brands.findMany({ where: { brand_id: id } })) {
      await tx.company_brands.upsert({
        where: { company_id_brand_id: { company_id: l.company_id, brand_id: intoId } },
        create: { company_id: l.company_id, brand_id: intoId, relationship: l.relationship },
        update: {},
      });
    }
    await tx.company_brands.deleteMany({ where: { brand_id: id } });
    if (!into.company_id && from.company_id) await tx.brands.update({ where: { id: intoId }, data: { company_id: from.company_id } });
    await tx.brands.delete({ where: { id } });
    return r.count;
  }, TX);
  await audit(req, "admin.brand.merge", { entity: "brand", entityId: intoId, changes: { from: from.name, into: into.name, products: moved } });
  res.json({ message: `"${from.name}" merged into "${into.name}" (${moved} product(s) updated)` });
};

// GET /admin/catalogue/health -> data issues worth fixing: duplicate SKUs, brands differing only in case, empty categories
const catalogueHealth = async (req, res) => {
  const [dupSkus, dupBrands, emptyCats, noCategory] = await Promise.all([
    prisma.$queryRaw`SELECT p.company_id, c.name AS company, lower(p.sku) AS sku, count(*)::int AS n,
        array_agg(p.id ORDER BY p.id) AS product_ids, array_agg(p.title ORDER BY p.id) AS titles
      FROM products p JOIN companies c ON c.id = p.company_id
      WHERE p.sku IS NOT NULL AND btrim(p.sku) <> '' GROUP BY 1, 2, 3 HAVING count(*) > 1 ORDER BY n DESC, sku LIMIT 500`,
    prisma.$queryRaw`SELECT lower(btrim(name)) AS name, array_agg(id ORDER BY id) AS ids, array_agg(name ORDER BY id) AS names
      FROM brands GROUP BY 1 HAVING count(*) > 1`,
    prisma.$queryRaw`SELECT c.id, c.name FROM categories c WHERE c.status = 'active' AND NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.category_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = c.id) ORDER BY c.name`,
    prisma.products.count({ where: { product_categories: { none: {} }, status: { in: ["published", "draft"] } } }),
  ]);
  res.json({ data: { duplicate_skus: dupSkus, duplicate_brands: dupBrands, empty_categories: emptyCats, products_without_category: noCategory } });
};

module.exports = {
  listCategories, createCategory, updateCategory, mergeCategory, deleteCategory, getCategoryAttributes, setCategoryAttributes, applyTemplate, listTemplates,
  listAttributes, createAttribute, updateAttribute, deleteAttribute, addOption, updateOption, deleteOption,
  updateBrand, mergeBrand, catalogueHealth,
};

// ---- marketplace settings, platform collections, storefront previews --------------------------------
const mset = require("../services/marketplaceSettings");
const colSvc = require("../services/collections");
const sfSvc = require("../services/storefront");

// GET /admin/marketplace -> settings + what can be chosen
const getMarketplace = async (req, res) => {
  const s = await mset.getMarketplaceSettings();
  const big = (a) => a.map((x) => BigInt(x));
  const [brands, categories, companies] = await Promise.all([
    prisma.brands.findMany({ where: { id: { in: big(s.featured.brand_ids) } }, select: { id: true, name: true, slug: true } }),
    prisma.categories.findMany({ where: { id: { in: big(s.featured.category_ids) } }, select: { id: true, name: true, slug: true } }),
    prisma.companies.findMany({ where: { id: { in: big(s.featured.company_ids) } }, select: { id: true, name: true, slug: true } }),
  ]);
  res.json({ data: s, chosen: { brands, categories, companies }, all_themes: Object.entries(sfSvc.THEMES).map(([k, t]) => ({ key: k, name: t.name })), all_sections: Object.entries(sfSvc.SECTIONS).map(([k, t]) => ({ type: k, label: t.label })) });
};

// PUT /admin/marketplace { nav, featured, banners, storefront }
const saveMarketplace = async (req, res) => {
  // the menu is edited in Admin → Site; saving these settings keeps it unless a menu is sent
  const value = await mset.sanitizeSettings({ ...req.body, nav: req.body.nav !== undefined ? req.body.nav : (await mset.getMarketplaceSettings()).nav });
  await mset.saveMarketplaceSettings(value);
  await audit(req, "admin.marketplace", { entity: "site_settings", changes: { nav: value.nav ? value.nav.length : "default", banners: value.banners.length } });
  require("../services/siteNav").clearNavCache();
  res.json({ message: "Marketplace settings saved", data: value });
};

// platform collections (company_id NULL)
const findGlobalCollection = async (req) => {
  const c = await prisma.collections.findFirst({ where: { id: toId(req.params.id), company_id: null } });
  if (!c) throw new HttpError(404, "Collection not found");
  return c;
};
const listGlobalCollections = async (req, res) => {
  const rows = await prisma.collections.findMany({ where: { company_id: null }, orderBy: [{ sort_order: "asc" }, { name: "asc" }], include: { _count: { select: { collection_products: true } } } });
  res.json({ data: rows.map(({ _count, ...c }) => ({ ...c, product_count: _count.collection_products, live: colSvc.live(c) })) });
};
const getGlobalCollection = async (req, res) => res.json({ data: await colSvc.detail(prisma, await findGlobalCollection(req)) });
const createGlobalCollection = async (req, res) => {
  const c = await prisma.$transaction((tx) => colSvc.create(tx, { companyId: null, userId: req.user.id, body: req.body }), TX);
  await audit(req, "admin.collection.create", { entity: "collection", entityId: c.id, changes: { name: c.name } });
  res.status(201).json({ data: await colSvc.detail(prisma, c) });
};
const updateGlobalCollection = async (req, res) => {
  const current = await findGlobalCollection(req);
  const c = await prisma.$transaction((tx) => colSvc.update(tx, { collection: current, body: req.body }), TX);
  res.json({ data: await colSvc.detail(prisma, c) });
};
const deleteGlobalCollection = async (req, res) => {
  const c = await findGlobalCollection(req);
  await prisma.collections.delete({ where: { id: c.id } });
  res.json({ message: "Collection deleted" });
};

// GET /admin/products/search?q -> any published product (for platform collections)
const searchAllProducts = async (req, res) => {
  const q = String(req.query.q || "").trim();
  const rows = await prisma.products.findMany({
    where: { status: "published", ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { brand: { contains: q, mode: "insensitive" } }] } : {}) },
    take: 30, orderBy: { title: "asc" }, select: { id: true, title: true, brand: true, sku: true, companies: { select: { name: true } } },
  });
  res.json({ data: rows.map(({ companies, ...p }) => ({ ...p, company: companies?.name })) });
};

// GET /admin/companies/:id/storefront?source=draft|published -> preview any company's storefront
const previewStorefront = async (req, res) => {
  const company = await prisma.companies.findUnique({ where: { id: toId(req.params.id) } });
  if (!company) throw new HttpError(404, "Company not found");
  const store = await prisma.storefronts.findUnique({ where: { company_id: company.id } });
  const cfg = req.query.source === "draft" && store?.draft?.sections ? store.draft : store?.published?.sections ? store.published : sfSvc.defaultConfig(company);
  const { storefrontPayload } = require("./marketplace.controller");
  res.json({ data: await storefrontPayload(req, company, cfg), preview: true, has_published: !!store?.published, storefront_published: company.storefront_published });
};

Object.assign(module.exports, {
  getMarketplace, saveMarketplace, listGlobalCollections, getGlobalCollection, createGlobalCollection, updateGlobalCollection, deleteGlobalCollection,
  searchAllProducts, previewStorefront,
});
