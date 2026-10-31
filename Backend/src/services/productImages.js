// A product's image gallery (product_images), shared by the seller's catalogue and the admin panel.
// The first image (lowest sort_order) is the product's main image: cards, lists, the landing page and the
// top of the product page all use it, and products.url is kept in step with it (syncMainImage).
const crypto = require("crypto");
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");
const { supabaseAdmin } = require("../lib/supabaseAdmin");
const cat = require("./productCatalog");
const inv = require("./inventory");

const IMAGE_BUCKET = "product-images";
const MAX_IMAGES = 12;

const extFor = (mime) => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" }[mime] || "img");

// The landing page keeps its sections for 30 s; drop that copy so a new main image shows right away.
const refreshPages = () => {
  try {
    require("./homepage").clearHomepageCache();
  } catch {
    /* homepage cache not loaded */
  }
};

// Files are stored under companies/<companyId>/products/<productId>/ so one company can never overwrite another's.
const storeImage = async (companyId, productId, file) => {
  if (!supabaseAdmin) throw new HttpError(503, "Image storage is not configured on the server");
  if (!file?.mimetype?.startsWith("image/") || file.mimetype === "image/svg+xml") throw new HttpError(400, "Please upload a JPG, PNG, WebP or GIF image");
  const path = `companies/${companyId}/products/${productId}/${crypto.randomUUID()}.${extFor(file.mimetype)}`;
  const { error } = await supabaseAdmin.storage.from(IMAGE_BUCKET).upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) throw error;
  const { data: { publicUrl } } = supabaseAdmin.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return { url: publicUrl, path };
};

const removeStored = async (path) => {
  if (!supabaseAdmin || !path) return;
  try {
    await supabaseAdmin.storage.from(IMAGE_BUCKET).remove([path]);
  } catch (err) {
    console.error("image delete failed:", err.message);
  }
};

const list = (productId) => prisma.product_images.findMany({ where: { product_id: BigInt(productId) }, orderBy: [{ sort_order: "asc" }, { id: "asc" }] });

/** Replaces the main (first) image, or adds it when the product has none. Returns the new address. */
const replaceMain = async (product, file) => {
  const stored = await storeImage(product.company_id, product.id, file);
  await prisma.$transaction(async (tx) => {
    const first = await tx.product_images.findFirst({ where: { product_id: product.id }, orderBy: [{ sort_order: "asc" }, { id: "asc" }] });
    if (first) {
      await tx.product_images.update({ where: { id: first.id }, data: { url: stored.url, storage_path: stored.path } });
    } else {
      await tx.product_images.create({ data: { product_id: product.id, url: stored.url, storage_path: stored.path, sort_order: 0 } });
    }
    await cat.syncMainImage(tx, product.id);
  });
  refreshPages();
  return stored.url;
};

/** Adds uploaded files (or one web address) to the end of the gallery. Returns the gallery. */
const add = async (product, { files = [], url, alt_text, variant_key } = {}) => {
  const count = await prisma.product_images.count({ where: { product_id: product.id } });
  const toAdd = [];
  if (files.length) {
    if (count + files.length > MAX_IMAGES) throw new HttpError(400, `A product can have at most ${MAX_IMAGES} images (it has ${count})`);
    for (const f of files) toAdd.push(await storeImage(product.company_id, product.id, f));
  } else {
    if (!cat.isHttpUrl(url)) throw new HttpError(400, "Upload an image or give its web address (https://...)");
    if (count + 1 > MAX_IMAGES) throw new HttpError(400, `A product can have at most ${MAX_IMAGES} images`);
    toAdd.push({ url: String(url).slice(0, 1000), path: null });
  }
  const variantKey = variant_key ? inv.resolveFlavor(product, variant_key) || null : null;
  await prisma.$transaction(async (tx) => {
    for (const [i, img] of toAdd.entries()) {
      await tx.product_images.create({
        data: { product_id: product.id, url: img.url, storage_path: img.path, alt_text: alt_text ? String(alt_text).slice(0, 255) : null, variant_key: variantKey, sort_order: count + i },
      });
    }
    await cat.syncMainImage(tx, product.id);
  });
  refreshPages();
  return { added: toAdd.length, images: await list(product.id) };
};

/** New order (and optional alt text / variant) for every image: [{ id, alt_text?, variant_key? }]. */
const update = async (product, images) => {
  const wanted = Array.isArray(images) ? images : [];
  const current = await list(product.id);
  const ids = new Set(current.map((i) => String(i.id)));
  if (wanted.length !== current.length || wanted.some((i) => !ids.has(String(i.id)))) throw new HttpError(400, "Send every image of the product once, in the new order");
  await prisma.$transaction(async (tx) => {
    for (const [i, img] of wanted.entries()) {
      const data = { sort_order: i };
      if (img.alt_text !== undefined) data.alt_text = img.alt_text ? String(img.alt_text).slice(0, 255) : null;
      if (img.variant_key !== undefined) data.variant_key = img.variant_key ? inv.resolveFlavor(product, img.variant_key) || null : null;
      await tx.product_images.update({ where: { id: BigInt(img.id) }, data });
    }
    await cat.syncMainImage(tx, product.id);
  });
  refreshPages();
  return list(product.id);
};

const remove = async (product, imageId) => {
  const img = await prisma.product_images.findFirst({ where: { id: imageId, product_id: product.id } });
  if (!img) throw new HttpError(404, "Image not found");
  await prisma.$transaction(async (tx) => {
    await tx.product_images.delete({ where: { id: img.id } });
    await cat.syncMainImage(tx, product.id);
  });
  // only files this app stored for the product's own company are removed from storage
  if (img.storage_path?.startsWith(`companies/${product.company_id}/`)) await removeStored(img.storage_path);
  refreshPages();
  return list(product.id);
};

module.exports = { IMAGE_BUCKET, MAX_IMAGES, storeImage, removeStored, list, replaceMain, add, update, remove };
