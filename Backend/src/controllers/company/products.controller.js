// A company's own catalogue: products, variants, images, specifications, categories and brands.
const { Prisma } = require("@prisma/client");
const prisma = require("../../prisma");
const inv = require("../../services/inventory");
const { HttpError, toId } = require("../../utils/http");
const { productData, STATUSES } = require("../../services/productInput");
const { audit } = require("../../services/audit");
const cat = require("../../services/productCatalog");
const attrs = require("../../services/attributes");
const variants = require("../../services/variants");
const images = require("../../services/productImages");
const { num, round2 } = require("../../services/money");

const TX = { timeout: 30000, maxWait: 10000 };

// Kept for older callers (CSV import, admin): records that the company sells this brand.
// A brand can be sold by any number of companies, so this never refuses.
const ensureCompanyBrand = async (companyId, name, db = prisma) => {
  await cat.linkCompanyBrand(db, companyId, name);
};

const findOwnProduct = async (req, db = prisma) => {
  const product = await db.products.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!product) throw new HttpError(404, "Product not found");
  return product;
};

// GET /company/products?page&limit&search&status&category_id&brand_id&featured
//   status: draft | published | hidden | discontinued | archived (or the older active | inactive)
const listProducts = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const search = String(req.query.search || "").trim();
  const st = String(req.query.status || "");
  const where = {
    company_id: req.company.id,
    ...(st === "active" ? { is_active: true } : st === "inactive" ? { is_active: false } : STATUSES.includes(st) ? { status: st } : {}),
    ...(req.query.category_id ? { product_categories: { some: { category_id: toId(req.query.category_id, "category_id") } } } : {}),
    ...(req.query.brand_id ? { brand_id: toId(req.query.brand_id, "brand_id") } : {}),
    ...(req.query.featured === "true" ? { is_featured: true } : {}),
    ...(search
      ? { OR: [
          { title: { contains: search, mode: "insensitive" } },
          { brand: { contains: search, mode: "insensitive" } },
          { sku: { contains: search, mode: "insensitive" } },
          { barcode: search },
          { product_variants: { some: { OR: [{ sku: { contains: search, mode: "insensitive" } }, { barcode: search }] } } },
        ] }
      : {}),
  };
  const [products, totalCount, counts] = await Promise.all([
    prisma.products.findMany({
      where, orderBy: { created_at: "desc" }, skip: (page - 1) * limit, take: limit,
      include: {
        product_categories: { orderBy: { sort_order: "asc" }, select: { category_id: true } },
        product_images: { orderBy: [{ sort_order: "asc" }, { id: "asc" }], take: 1, select: { url: true } },
        _count: { select: { product_images: true } },
      },
    }),
    prisma.products.count({ where }),
    prisma.products.groupBy({ by: ["status"], where: { company_id: req.company.id }, _count: true }),
  ]);
  res.json({
    products: products.map(({ product_categories, product_images, _count, ...p }) => ({
      ...p, category_ids: product_categories.map((c) => c.category_id), image_count: _count.product_images,
      image: product_images[0]?.url || (cat.isImageUrl(p.url) ? p.url : null),
    })),
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
    statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  });
};

// GET /company/products/:id -> everything the product form needs
const getProduct = async (req, res) => {
  const product = await prisma.products.findFirst({
    where: { id: toId(req.params.id), company_id: req.company.id },
    include: {
      product_categories: { orderBy: { sort_order: "asc" }, include: { categories: { select: { id: true, name: true, slug: true, parent_id: true } } } },
      product_images: { orderBy: [{ sort_order: "asc" }, { id: "asc" }] },
      product_visible_groups: { include: { customer_groups: { select: { id: true, name: true } } } },
      brands: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!product) throw new HttpError(404, "Product not found");
  const { product_categories, product_images, product_visible_groups, brands, ...p } = product;
  res.json({
    data: {
      ...p,
      categories_list: product_categories.map((pc) => pc.categories),
      category_ids: product_categories.map((pc) => pc.categories.id),
      images: product_images,
      visible_groups: product_visible_groups.map((g) => g.customer_groups),
      brand_info: brands,
      specifications: await attrs.specificationsFor(product.id),
      variants: await variants.listForCompany(prisma, product),
      publish_problems: await cat.publishProblems(prisma, product.id),
    },
  });
};

// preferred_supplier_id must be one of this company's suppliers.
const supplierField = async (req, data) => {
  if (req.body.preferred_supplier_id === undefined) return;
  if (!req.body.preferred_supplier_id) {
    data.preferred_supplier_id = null;
    return;
  }
  const s = await prisma.suppliers.findFirst({
    where: { id: toId(req.body.preferred_supplier_id, "preferred_supplier_id"), company_id: req.company.id },
  });
  if (!s) throw new HttpError(400, "Preferred supplier not found");
  data.preferred_supplier_id = s.id;
};

const assertSlugFree = async (db, slug, exceptId = null) => {
  if (!slug) return;
  const taken = await db.products.findFirst({ where: { slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
  if (taken) throw new HttpError(409, "That web address is already used by another product");
};

/**
 * Writes the parts of the product form that live in other tables:
 * categories (category_ids, or the older category names), brand link, visible groups, specifications.
 */
const writeRelated = async (tx, req, product, data) => {
  const b = req.body;
  if (b.category_ids !== undefined) {
    await cat.setProductCategories(tx, product.id, Array.isArray(b.category_ids) ? b.category_ids : String(b.category_ids || "").split(",").filter(Boolean));
  } else if (data.categories !== undefined) {
    await cat.syncCategoriesFromNames(tx, product.id, data.categories, { companyId: req.company.id, userId: req.user.id });
  }
  if (data.brand !== undefined || b.brand_relationship !== undefined) {
    const brand = await cat.linkCompanyBrand(tx, req.company.id, data.brand ?? product.brand, b.brand_relationship || null);
    if (brand) await tx.products.update({ where: { id: product.id }, data: { brand_id: brand.id } });
  }
  if (b.visible_group_ids !== undefined) {
    const ids = (Array.isArray(b.visible_group_ids) ? b.visible_group_ids : []).map((x) => toId(x, "visible_group_ids"));
    const groups = await tx.customer_groups.findMany({ where: { id: { in: ids }, company_id: req.company.id }, select: { id: true } });
    if (groups.length !== ids.length) throw new HttpError(400, "One of the customer groups doesn't exist");
    await tx.product_visible_groups.deleteMany({ where: { product_id: product.id } });
    if (ids.length) await tx.product_visible_groups.createMany({ data: ids.map((g) => ({ product_id: product.id, customer_group_id: g })) });
  }
  if (b.specifications !== undefined) {
    await attrs.setProductValues(tx, { companyId: req.company.id, productId: product.id, values: b.specifications });
  }
  if (data.flavors) await variants.linkFlavourOptions(tx, product.id, data.flavors);
};

// Publishing (or saving while published) needs a price, an active variant if it has variants, and the required details.
const assertPublishable = async (tx, productId, wasPublished) => {
  const p = await tx.products.findUnique({ where: { id: productId }, select: { status: true } });
  if (p.status !== "published" || wasPublished) return;
  const problems = await cat.publishProblems(tx, productId);
  if (problems.length) throw new HttpError(400, `To publish, add ${problems.join("; ")}. You can save it as a draft meanwhile.`);
};

const createProduct = async (req, res) => {
  const data = productData(req.body);
  await supplierField(req, data);
  if (!data.title || !data.brand) throw new HttpError(400, "Title and brand are required");
  if (req.body.status === undefined && req.body.is_active === undefined) data.status = "published"; // older forms
  const product = await prisma.$transaction(async (tx) => {
    await assertSlugFree(tx, data.slug);
    const p = await tx.products.create({
      data: { categories: [], flavors: [], ...data, company_id: req.company.id, updated_at: new Date() },
    });
    if (data.flavors) await inv.syncVariants(tx, { id: p.id, flavors: [] }, data.flavors);
    await writeRelated(tx, req, p, data);
    await assertPublishable(tx, p.id, false);
    return tx.products.findUnique({ where: { id: p.id } });
  }, TX);
  await audit(req, "product.create", { entity: "product", entityId: product.id, changes: data });
  res.status(201).json(product);
};

const updateProduct = async (req, res) => {
  const existing = await findOwnProduct(req);
  const data = productData(req.body);
  await supplierField(req, data);
  const product = await prisma.$transaction(async (tx) => {
    await assertSlugFree(tx, data.slug, existing.id);
    // Refuses to drop a flavour that still has stock.
    if (data.flavors) await inv.syncVariants(tx, existing, data.flavors);
    await tx.products.update({ where: { id: existing.id }, data: { ...data, updated_at: new Date() } });
    await writeRelated(tx, req, existing, data);
    await assertPublishable(tx, existing.id, existing.status === "published");
    return tx.products.findUnique({ where: { id: existing.id } });
  }, TX);
  await audit(req, "product.update", { entity: "product", entityId: product.id, changes: { ...data, ...(req.body.category_ids ? { category_ids: req.body.category_ids } : {}) } });
  res.json(product);
};

// Products with any history (orders, stock, purchases, quotes...) are archived instead of deleted,
// so old documents keep pointing at them.
const deleteProduct = async (req, res) => {
  const product = await findOwnProduct(req);
  let archive = await cat.productHasHistory(prisma, product.id);
  if (!archive) {
    try {
      await prisma.$transaction([
        prisma.cart_items.deleteMany({ where: { product_id: product.id } }),
        prisma.wishlist_items.deleteMany({ where: { product_id: product.id } }),
        prisma.products.delete({ where: { id: product.id } }),
      ]);
    } catch (err) {
      // history written between the check and the delete
      if (!(err?.code === "P2003" || /foreign key/i.test(String(err?.message)))) throw err;
      archive = true;
    }
  }
  if (archive) {
    await prisma.$transaction([
      prisma.products.update({ where: { id: product.id }, data: { status: "archived", updated_at: new Date() } }),
      prisma.cart_items.deleteMany({ where: { product_id: product.id } }),
    ]);
    await audit(req, "product.archive", { entity: "product", entityId: product.id });
    return res.json({ message: "This product has history (orders, stock or documents), so it was archived instead of deleted.", deactivated: true, archived: true });
  }
  await audit(req, "product.delete", { entity: "product", entityId: product.id, changes: { title: product.title } });
  res.json({ message: "Product deleted" });
};

// ---- images ------------------------------------------------------------------------------------

// POST /company/products/:id/image (multipart "image") -> replaces the first gallery image (older form)
const uploadProductImage = async (req, res) => {
  const product = await findOwnProduct(req);
  const url = await images.replaceMain(product, req.file);
  await audit(req, "product.image", { entity: "product", entityId: product.id });
  res.json({ url });
};

// POST /company/products/:id/images  multipart "images" (up to 6 files), or JSON { url, alt_text?, variant_key? }
const addImages = async (req, res) => {
  const product = await findOwnProduct(req);
  const { added, images: data } = await images.add(product, { files: req.files || [], ...req.body });
  await audit(req, "product.images.add", { entity: "product", entityId: product.id, changes: { added } });
  res.status(201).json({ data });
};

// PATCH /company/products/:id/images { images: [{ id, alt_text?, variant_key? }] } -> order = list order
const updateImages = async (req, res) => {
  const product = await findOwnProduct(req);
  res.json({ data: await images.update(product, req.body.images) });
};

// DELETE /company/products/:id/images/:imageId
const deleteImage = async (req, res) => {
  const product = await findOwnProduct(req);
  const data = await images.remove(product, toId(req.params.imageId));
  await audit(req, "product.images.delete", { entity: "product", entityId: product.id });
  res.json({ data });
};

// ---- variants ----------------------------------------------------------------------------------

// GET /company/products/:id/variants -> variants with options, prices, costs and stock
const listVariants = async (req, res) => {
  const product = await findOwnProduct(req);
  await inv.syncVariants(prisma, product, product.flavors);
  res.json(await variants.listForCompany(prisma, product));
};

/**
 * PUT /company/products/:id/variants
 *   { option_attribute_ids, variants: [{ id?, name?, options, sku?, barcode?, price?, status?, min_order_qty?, image_url? }] }
 *   or the older { variants: [{ flavor, sku?, barcode? }] } (codes of existing flavours only)
 */
const saveVariants = async (req, res) => {
  const product = await findOwnProduct(req);
  if (req.body.option_attribute_ids !== undefined) {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.products.findUnique({ where: { id: product.id } });
      await variants.saveVariants(tx, { companyId: req.company.id, product: fresh, body: req.body });
      const after = await tx.products.findUnique({ where: { id: product.id }, select: { status: true } });
      if (after.status === "published") {
        const problems = await cat.publishProblems(tx, product.id);
        if (problems.length) throw new HttpError(400, `The product is published, so it needs ${problems.join("; ")}`);
      }
    }, TX);
    await audit(req, "product.variants", { entity: "product", entityId: product.id, changes: { variants: (req.body.variants || []).length } });
    const updated = await prisma.products.findUnique({ where: { id: product.id } });
    return res.json({ message: "Variants saved", ...(await variants.listForCompany(prisma, updated)) });
  }
  const rows = Array.isArray(req.body.variants) ? req.body.variants : [];
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      const flavor = inv.resolveFlavor(product, r.flavor);
      const sku = r.sku ? String(r.sku).trim().slice(0, 255) : null;
      const barcode = r.barcode ? String(r.barcode).trim().slice(0, 64) : null;
      if (barcode) {
        const clash = await tx.product_variants.findFirst({
          where: { barcode, NOT: { product_id: product.id, flavor }, products: { is: { company_id: req.company.id } } },
          include: { products: { select: { title: true } } },
        });
        const productClash = await tx.products.findFirst({ where: { company_id: req.company.id, barcode } });
        if (clash || productClash) throw new HttpError(409, `Barcode ${barcode} is already used by ${clash ? `${clash.products.title} (${clash.flavor})` : productClash.title}`);
      }
      await tx.product_variants.upsert({
        where: { product_id_flavor: { product_id: product.id, flavor } },
        create: { product_id: product.id, flavor, sku, barcode },
        update: { sku, barcode, updated_at: new Date() },
      });
    }
  });
  await audit(req, "product.variants", { entity: "product", entityId: product.id, changes: { variants: rows } });
  res.json({ message: "Flavour codes saved" });
};

// ---- specifications ----------------------------------------------------------------------------

// GET /company/products/:id/attributes -> the attributes that apply (its categories' + already filled) with values
const getProductAttributes = async (req, res) => {
  const product = await findOwnProduct(req);
  const extra = req.query.category_ids ? String(req.query.category_ids).split(",").filter((x) => /^\d+$/.test(x)).map((x) => BigInt(x)) : null;
  const categoryIds = extra || (await prisma.product_categories.findMany({ where: { product_id: product.id }, select: { category_id: true } })).map((c) => c.category_id);
  const [linked, values] = await Promise.all([
    prisma.category_attributes.findMany({ where: { category_id: { in: categoryIds } }, orderBy: { sort_order: "asc" }, include: { attribute_definitions: { include: { attribute_options: { orderBy: { sort_order: "asc" } } } } } }),
    attrs.specificationsFor(product.id),
  ]);
  const map = new Map();
  for (const l of linked) {
    const a = l.attribute_definitions;
    if (a.company_id !== null && a.company_id !== req.company.id) continue;
    const prev = map.get(String(a.id));
    map.set(String(a.id), { ...a, is_required: (prev?.is_required || false) || l.is_required });
  }
  const filledIds = values.filter((v) => !map.has(String(v.attribute_id))).map((v) => v.attribute_id);
  if (filledIds.length) {
    for (const a of await prisma.attribute_definitions.findMany({ where: { id: { in: filledIds } }, include: { attribute_options: { orderBy: { sort_order: "asc" } } } })) {
      map.set(String(a.id), { ...a, is_required: false });
    }
  }
  const valueOf = new Map(values.map((v) => [String(v.attribute_id), v.raw]));
  res.json({ data: [...map.values()].map((a) => ({ ...a, value: valueOf.get(String(a.id)) ?? null })) });
};

// PUT /company/products/:id/attributes { values: [{ attribute_id, value }] }
const saveProductAttributes = async (req, res) => {
  const product = await findOwnProduct(req);
  await prisma.$transaction(async (tx) => {
    await attrs.setProductValues(tx, { companyId: req.company.id, productId: product.id, values: req.body.values });
    if (product.status === "published") {
      const missing = await attrs.missingRequired(tx, product.id);
      if (missing.length) throw new HttpError(400, `This product is published, so these details are required: ${missing.join(", ")}`);
    }
  }, TX);
  await audit(req, "product.attributes", { entity: "product", entityId: product.id });
  res.json({ message: "Details saved", data: await attrs.specificationsFor(product.id) });
};

// ---- bulk edit ---------------------------------------------------------------------------------

/**
 * POST /company/products/bulk { ids: [...], action, value, preview? }
 *   action: status (value = status) | featured (true/false) | add_category / remove_category (value = category id)
 *         | brand (value = brand name) | price_percent (value = +/- %) | price_amount (value = +/- amount)
 *         | min_order_qty (value) | visibility (public | groups)
 * preview: true returns what would change without saving.
 */
const bulkUpdate = async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map((x) => String(toId(x, "ids"))))].map((x) => BigInt(x));
  if (!ids.length) throw new HttpError(400, "Choose at least one product");
  if (ids.length > 1000) throw new HttpError(400, "At most 1000 products at a time");
  const action = String(req.body.action || "");
  const value = req.body.value;
  const products = await prisma.products.findMany({ where: { id: { in: ids }, company_id: req.company.id }, select: { id: true, title: true, price: true, status: true, categories: true } });
  if (products.length !== ids.length) throw new HttpError(404, "One of the products wasn't found");

  const changes = [];
  if (action === "price_percent" || action === "price_amount") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new HttpError(400, "Enter a number");
    if (action === "price_percent" && (n <= -100 || n > 1000)) throw new HttpError(400, "Percentage must be between -99 and 1000");
    for (const p of products) {
      if (p.price === null) continue;
      const before = num(p.price);
      const after = round2(action === "price_percent" ? before * (1 + n / 100) : before + n);
      if (after < 0) throw new HttpError(400, `"${p.title}" would get a negative price`);
      changes.push({ id: p.id, title: p.title, before, after });
    }
  } else if (action === "status") {
    if (!STATUSES.includes(value)) throw new HttpError(400, `Status must be one of: ${STATUSES.join(", ")}`);
    for (const p of products) if (p.status !== value) changes.push({ id: p.id, title: p.title, before: p.status, after: value });
  } else if (["featured", "add_category", "remove_category", "brand", "min_order_qty", "visibility"].includes(action)) {
    for (const p of products) changes.push({ id: p.id, title: p.title });
  } else {
    throw new HttpError(400, "Unknown bulk action");
  }
  if (req.body.preview) return res.json({ preview: true, count: changes.length, changes: changes.slice(0, 200) });

  const skipped = [];
  await prisma.$transaction(async (tx) => {
    if (action === "price_percent" || action === "price_amount") {
      for (const c of changes) await tx.products.update({ where: { id: c.id }, data: { price: new Prisma.Decimal(c.after.toFixed(2)), updated_at: new Date() } });
    } else if (action === "status") {
      for (const c of changes) {
        if (value === "published") {
          const problems = await cat.publishProblems(tx, c.id);
          if (problems.length) { skipped.push({ id: c.id, title: c.title, reason: `needs ${problems.join("; ")}` }); continue; }
        }
        await tx.products.update({ where: { id: c.id }, data: { status: value, updated_at: new Date() } });
      }
    } else if (action === "featured") {
      await tx.products.updateMany({ where: { id: { in: ids } }, data: { is_featured: !!value && value !== "false", updated_at: new Date() } });
    } else if (action === "visibility") {
      if (!["public", "groups"].includes(value)) throw new HttpError(400, "Visibility must be public or groups");
      await tx.products.updateMany({ where: { id: { in: ids } }, data: { visibility: value, updated_at: new Date() } });
    } else if (action === "min_order_qty") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "Minimum order must be a whole number, 1 or more");
      await tx.products.updateMany({ where: { id: { in: ids } }, data: { min_order_qty: n, updated_at: new Date() } });
    } else if (action === "brand") {
      const brand = await cat.linkCompanyBrand(tx, req.company.id, value);
      if (!brand) throw new HttpError(400, "Enter a brand name");
      await tx.products.updateMany({ where: { id: { in: ids } }, data: { brand: brand.name, brand_id: brand.id, updated_at: new Date() } });
    } else {
      const category = await tx.categories.findUnique({ where: { id: toId(value, "category") } });
      if (!category) throw new HttpError(400, "Category not found");
      for (const p of products) {
        const current = (await tx.product_categories.findMany({ where: { product_id: p.id }, orderBy: { sort_order: "asc" } })).map((c) => String(c.category_id));
        const next = action === "add_category" ? [...new Set([...current, String(category.id)])] : current.filter((c) => c !== String(category.id));
        await cat.setProductCategories(tx, p.id, next);
      }
    }
  }, TX);
  await audit(req, "product.bulk", { entity: "product", changes: { action, value, count: changes.length - skipped.length, skipped: skipped.length } });
  res.json({ message: `${changes.length - skipped.length} product(s) updated${skipped.length ? `, ${skipped.length} skipped` : ""}`, updated: changes.length - skipped.length, skipped });
};

// ---- categories --------------------------------------------------------------------------------

// GET /company/categories -> every active category (flat, with parent ids) + this company's product counts
const listCategories = async (req, res) => {
  const [rows, counts] = await Promise.all([
    prisma.categories.findMany({ where: { status: "active" }, orderBy: [{ sort_order: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true, parent_id: true, created_by_company_id: true } }),
    prisma.product_categories.groupBy({ by: ["category_id"], where: { products: { company_id: req.company.id } }, _count: true }),
  ]);
  const countBy = new Map(counts.map((c) => [String(c.category_id), c._count]));
  res.json({ data: rows.map((c) => ({ ...c, product_count: countBy.get(String(c.id)) || 0, own: c.created_by_company_id === req.company.id })) });
};

// POST /company/categories { name, parent_id? } -> companies may add categories (shared with the whole marketplace)
const createCategory = async (req, res) => {
  const parentId = req.body.parent_id ? toId(req.body.parent_id, "parent_id") : null;
  if (parentId && !(await prisma.categories.findUnique({ where: { id: parentId } }))) throw new HttpError(400, "Parent category not found");
  const before = await prisma.categories.count();
  const c = await cat.findOrCreateCategory(prisma, { name: req.body.name, parentId, companyId: req.company.id, userId: req.user.id });
  const created = (await prisma.categories.count()) > before;
  if (created) await audit(req, "category.create", { entity: "category", entityId: c.id, changes: { name: c.name } });
  res.status(created ? 201 : 200).json({ data: c, created, message: created ? `Category "${c.name}" added` : `"${c.name}" already exists, so it was used` });
};

// ---- attributes --------------------------------------------------------------------------------

// GET /company/attributes?category_ids=1,2 -> attributes this company can use (global + own), with values
const listAttributes = async (req, res) => {
  const catIds = req.query.category_ids ? String(req.query.category_ids).split(",").filter((x) => /^\d+$/.test(x)).map((x) => BigInt(x)) : null;
  const rows = await prisma.attribute_definitions.findMany({
    where: { ...attrs.visibleTo(req.company.id), ...(req.query.variant_options === "true" ? { is_variant_option: true } : {}) },
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    include: { attribute_options: { orderBy: [{ sort_order: "asc" }, { value: "asc" }] }, category_attributes: catIds ? { where: { category_id: { in: catIds } } } : false },
  });
  res.json({
    data: rows.map(({ category_attributes, ...a }) => ({
      ...a, own: a.company_id === req.company.id,
      ...(catIds ? { in_categories: !!category_attributes?.length, is_required: !!category_attributes?.some((c) => c.is_required) } : {}),
    })),
  });
};

// POST /company/attributes { name, key?, data_type, unit?, options?: [], is_variant_option?, scope? } -> the company's own attribute
const createAttribute = async (req, res) => {
  const d = attrs.definitionData(req.body, { creating: true });
  const clash = await prisma.attribute_definitions.findFirst({ where: { key: d.key, OR: [{ company_id: null }, { company_id: req.company.id }] } });
  if (clash) throw new HttpError(409, `An attribute with the key "${d.key}" already exists (${clash.name}). Use that one.`);
  const a = await prisma.$transaction(async (tx) => {
    const created = await tx.attribute_definitions.create({ data: { ...d, company_id: req.company.id } });
    for (const [i, v] of (Array.isArray(req.body.options) ? req.body.options : []).map((x) => String(x).trim()).filter(Boolean).entries()) {
      await tx.attribute_options.create({ data: { attribute_id: created.id, value: v.slice(0, 255), sort_order: i } }).catch(() => null);
    }
    return tx.attribute_definitions.findUnique({ where: { id: created.id }, include: { attribute_options: true } });
  });
  await audit(req, "attribute.create", { entity: "attribute", entityId: a.id, changes: { key: a.key } });
  res.status(201).json({ data: a });
};

// POST /company/attributes/:id/options { value } -> new value for an open list (or the company's own attribute)
const addAttributeOption = async (req, res) => {
  const a = await prisma.attribute_definitions.findFirst({ where: { id: toId(req.params.id), ...attrs.visibleTo(req.company.id) }, include: { attribute_options: true } });
  if (!a) throw new HttpError(404, "Attribute not found");
  if (!["select", "multiselect"].includes(a.data_type)) throw new HttpError(400, "Only list attributes have values");
  const open = a.validation?.open === true || a.company_id === req.company.id;
  if (!open) throw new HttpError(403, "The values of this attribute are managed by the platform. Ask an administrator to add it.");
  await attrs.ensureOptions(prisma, a, String(req.body.value || "").trim(), req.company.id);
  res.status(201).json({ data: await prisma.attribute_options.findMany({ where: { attribute_id: a.id }, orderBy: [{ sort_order: "asc" }, { value: "asc" }] }) });
};

// ---- brands ------------------------------------------------------------------------------------

// GET /company/brands -> brands this company sells (with how), plus product counts
const listBrands = async (req, res) => {
  const [links, counts] = await Promise.all([
    prisma.company_brands.findMany({ where: { company_id: req.company.id }, include: { brands: true }, orderBy: { brands: { name: "asc" } } }),
    prisma.products.groupBy({ by: ["brand_id"], where: { company_id: req.company.id }, _count: true }),
  ]);
  const countBy = new Map(counts.map((c) => [String(c.brand_id), c._count]));
  res.json({ data: links.map((l) => ({ ...l.brands, relationship: l.relationship, product_count: countBy.get(String(l.brand_id)) || 0 })) });
};

// GET /company/brands/search?q= -> any brand on the marketplace (to sell an existing brand instead of creating a duplicate)
const searchBrands = async (req, res) => {
  const q = String(req.query.q || "").trim();
  const rows = await prisma.brands.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" } } : {},
    orderBy: { name: "asc" }, take: 30, select: { id: true, name: true, slug: true, logo_url: true },
  });
  res.json({ data: rows });
};

// POST /company/brands { name, relationship? }
const createBrand = async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) throw new HttpError(400, "Brand name is required");
  const brand = await cat.linkCompanyBrand(prisma, req.company.id, name, req.body.relationship || null);
  await audit(req, "brand.create", { entity: "brand", entityId: brand.id, changes: { name: brand.name, relationship: req.body.relationship } });
  res.status(201).json({ message: "Brand saved", data: brand });
};

// PATCH /company/brands/:brandId { relationship }
const updateBrandLink = async (req, res) => {
  const link = await prisma.company_brands.findUnique({ where: { company_id_brand_id: { company_id: req.company.id, brand_id: toId(req.params.brandId) } } });
  if (!link) throw new HttpError(404, "You don't sell this brand");
  if (!cat.RELATIONSHIPS.includes(req.body.relationship)) throw new HttpError(400, `Relationship must be one of: ${cat.RELATIONSHIPS.join(", ")}`);
  await prisma.company_brands.update({ where: { company_id_brand_id: { company_id: req.company.id, brand_id: link.brand_id } }, data: { relationship: req.body.relationship } });
  res.json({ message: "Saved" });
};

// DELETE /company/brands/:brandId -> stop listing a brand (only when no product of the company uses it)
const removeBrandLink = async (req, res) => {
  const brandId = toId(req.params.brandId);
  const used = await prisma.products.count({ where: { company_id: req.company.id, brand_id: brandId } });
  if (used) throw new HttpError(400, `${used} of your products use this brand. Change them first.`);
  await prisma.company_brands.deleteMany({ where: { company_id: req.company.id, brand_id: brandId } });
  res.json({ message: "Removed" });
};

module.exports = {
  listProducts, getProduct, createProduct, updateProduct, deleteProduct,
  uploadProductImage, addImages, updateImages, deleteImage,
  listVariants, saveVariants, getProductAttributes, saveProductAttributes, bulkUpdate,
  listCategories, createCategory, listAttributes, createAttribute, addAttributeOption,
  listBrands, searchBrands, createBrand, updateBrandLink, removeBrandLink, ensureCompanyBrand,
};
