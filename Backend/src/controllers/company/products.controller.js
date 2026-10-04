// A company's own catalogue: products and brands.
const prisma = require("../../prisma");
const inv = require("../../services/inventory");
const { HttpError, toId } = require("../../utils/http");
const { productData } = require("../../services/productInput");
const { audit } = require("../../services/audit");
const { supabaseAdmin } = require("../../lib/supabaseAdmin");

// Brand names are globally unique: a company can use its own brands or create new ones,
// but not a brand that belongs to another company.
const ensureCompanyBrand = async (companyId, name) => {
  if (!name) return;
  const brand = await prisma.brands.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (!brand) {
    await prisma.brands.create({ data: { name, company_id: companyId } });
    return;
  }
  if (brand.company_id === null) {
    await prisma.brands.update({ where: { id: brand.id }, data: { company_id: companyId } });
    return;
  }
  if (brand.company_id !== companyId) {
    throw new HttpError(409, `The brand "${brand.name}" belongs to another company`);
  }
};

const findOwnProduct = async (req) => {
  const product = await prisma.products.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!product) throw new HttpError(404, "Product not found");
  return product;
};

// GET /company/products?page&limit&search&status=active|inactive
const listProducts = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const search = String(req.query.search || "").trim();
  const where = {
    company_id: req.company.id,
    ...(req.query.status === "active" ? { is_active: true } : req.query.status === "inactive" ? { is_active: false } : {}),
    ...(search
      ? { OR: [
          { title: { contains: search, mode: "insensitive" } },
          { brand: { contains: search, mode: "insensitive" } },
          { sku: { contains: search, mode: "insensitive" } },
          { barcode: search },
        ] }
      : {}),
  };
  const [products, totalCount] = await Promise.all([
    prisma.products.findMany({ where, orderBy: { created_at: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.products.count({ where }),
  ]);
  res.json({ products, totalCount, totalPages: Math.ceil(totalCount / limit), currentPage: page });
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

const createProduct = async (req, res) => {
  const data = productData(req.body);
  await supplierField(req, data);
  if (!data.title || !data.brand) throw new HttpError(400, "Title and brand are required");
  await ensureCompanyBrand(req.company.id, data.brand);
  const product = await prisma.$transaction(async (tx) => {
    const p = await tx.products.create({
      data: { categories: [], flavors: [], ...data, company_id: req.company.id, updated_at: new Date() },
    });
    if (data.flavors) await inv.syncVariants(tx, { id: p.id, flavors: [] }, data.flavors);
    return p;
  });
  await audit(req, "product.create", { entity: "product", entityId: product.id, changes: data });
  res.status(201).json(product);
};

const updateProduct = async (req, res) => {
  const existing = await findOwnProduct(req);
  const data = productData(req.body);
  await supplierField(req, data);
  if (data.brand && data.brand !== existing.brand) await ensureCompanyBrand(req.company.id, data.brand);
  const product = await prisma.$transaction(async (tx) => {
    // Refuses to drop a flavour that still has stock.
    if (data.flavors) await inv.syncVariants(tx, existing, data.flavors);
    return tx.products.update({ where: { id: existing.id }, data: { ...data, updated_at: new Date() } });
  });
  await audit(req, "product.update", { entity: "product", entityId: product.id, changes: data });
  res.json(product);
};

// Products with order history are deactivated (hidden) instead of deleted, to keep records intact.
const deleteProduct = async (req, res) => {
  const product = await findOwnProduct(req);
  const ordered = await prisma.order_items.count({ where: { product_id: product.id } });
  if (ordered) {
    await prisma.$transaction([
      prisma.products.update({ where: { id: product.id }, data: { is_active: false, updated_at: new Date() } }),
      prisma.cart_items.deleteMany({ where: { product_id: product.id } }),
    ]);
    await audit(req, "product.deactivate", { entity: "product", entityId: product.id });
    return res.json({ message: "This product has past orders, so it was hidden from the store instead of deleted.", deactivated: true });
  }
  await prisma.$transaction([
    prisma.cart_items.deleteMany({ where: { product_id: product.id } }),
    prisma.wishlist_items.deleteMany({ where: { product_id: product.id } }),
    prisma.products.delete({ where: { id: product.id } }),
  ]);
  await audit(req, "product.delete", { entity: "product", entityId: product.id, changes: { title: product.title } });
  res.json({ message: "Product deleted" });
};

// POST /company/products/:id/image (multipart "image")
const uploadProductImage = async (req, res) => {
  const product = await findOwnProduct(req);
  if (!supabaseAdmin) throw new HttpError(503, "Image storage is not configured on the server");
  if (!req.file?.mimetype?.startsWith("image/")) throw new HttpError(400, "Please upload an image");
  const filePath = `${product.id}/1.webp`;
  const { error } = await supabaseAdmin.storage
    .from("product-images")
    .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = supabaseAdmin.storage.from("product-images").getPublicUrl(filePath);
  const url = `${publicUrl}?t=${Date.now()}`;
  await prisma.products.update({ where: { id: product.id }, data: { url, updated_at: new Date() } });
  await audit(req, "product.image", { entity: "product", entityId: product.id });
  res.json({ url });
};

// GET /company/products/:id/variants -> each flavour with its SKU, barcode and stock
const listVariants = async (req, res) => {
  const product = await findOwnProduct(req);
  await inv.syncVariants(prisma, product, product.flavors);
  const [variants, stock] = await Promise.all([
    prisma.product_variants.findMany({ where: { product_id: product.id } }),
    prisma.inventory_levels.groupBy({ by: ["flavor"], where: { product_id: product.id }, _sum: { on_hand: true, reserved: true } }),
  ]);
  const order = inv.flavorsOf(product);
  const stockBy = new Map(stock.map((s) => [s.flavor, s._sum]));
  res.json({
    data: variants
      .filter((v) => order.includes(v.flavor))
      .sort((a, b) => order.indexOf(a.flavor) - order.indexOf(b.flavor))
      .map((v) => ({ ...v, on_hand: stockBy.get(v.flavor)?.on_hand || 0, reserved: stockBy.get(v.flavor)?.reserved || 0 })),
    unassigned: stockBy.get("")?.on_hand || 0,
  });
};

// PUT /company/products/:id/variants { variants: [{ flavor, sku?, barcode? }] }
const saveVariants = async (req, res) => {
  const product = await findOwnProduct(req);
  const rows = Array.isArray(req.body.variants) ? req.body.variants : [];
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      const flavor = inv.resolveFlavor(product, r.flavor);
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
        create: { product_id: product.id, flavor, sku: r.sku ? String(r.sku).trim().slice(0, 255) : null, barcode },
        update: { sku: r.sku ? String(r.sku).trim().slice(0, 255) : null, barcode, updated_at: new Date() },
      });
    }
  });
  await audit(req, "product.variants", { entity: "product", entityId: product.id, changes: { variants: rows } });
  res.json({ message: "Flavour codes saved" });
};

// GET /company/brands
const listBrands = async (req, res) => {
  const brands = await prisma.brands.findMany({ where: { company_id: req.company.id }, orderBy: { name: "asc" } });
  res.json({ data: brands });
};

// POST /company/brands { name }
const createBrand = async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) throw new HttpError(400, "Brand name is required");
  await ensureCompanyBrand(req.company.id, name);
  await audit(req, "brand.create", { entity: "brand", changes: { name } });
  res.status(201).json({ message: "Brand saved" });
};

module.exports = { listProducts, createProduct, updateProduct, deleteProduct, uploadProductImage, listBrands, createBrand, ensureCompanyBrand, listVariants, saveVariants };
