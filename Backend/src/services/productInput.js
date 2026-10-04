// Validates/whitelists product fields coming from admin or company forms.
const { HttpError } = require("../utils/http");

const toList = (v) => {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
};

const productData = (body) => {
  const data = {};
  if (body.title !== undefined) data.title = String(body.title).trim().slice(0, 255);
  if (body.brand !== undefined) data.brand = String(body.brand).trim().slice(0, 255);
  if (body.description !== undefined) data.description = body.description || null;
  if (body.sku !== undefined) data.sku = body.sku ? String(body.sku).trim() : null;
  if (body.price !== undefined && body.price !== "" && body.price !== null) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, "Price must be a positive number");
    data.price = price;
  } else if (body.price === null || body.price === "") {
    data.price = null;
  }
  const categories =
    body.categories !== undefined ? toList(body.categories) : body.category !== undefined ? toList(body.category) : undefined;
  if (categories !== undefined) data.categories = categories;
  if (body.flavors !== undefined) data.flavors = toList(body.flavors);
  const url = body.url ?? body.image_url;
  if (url !== undefined) data.url = url ? String(url).slice(0, 255) : null;
  if (body.is_active !== undefined) data.is_active = !!body.is_active;
  for (const f of ["reorder_point", "reorder_quantity"]) {
    if (body[f] !== undefined && body[f] !== "" && body[f] !== null) {
      const n = Number(body[f]);
      if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `${f.replace("_", " ")} must be a whole number, 0 or more`);
      data[f] = n;
    }
  }
  if (body.barcode !== undefined) data.barcode = body.barcode ? String(body.barcode).trim().slice(0, 64) : null;
  if (body.unit !== undefined && body.unit) data.unit = String(body.unit).trim().slice(0, 32);
  // Starting cost; afterwards it's maintained automatically from purchase receipts (moving average).
  if (body.cost_price !== undefined && body.cost_price !== "" && body.cost_price !== null) {
    const c = Number(body.cost_price);
    if (!Number.isFinite(c) || c < 0) throw new HttpError(400, "Cost must be 0 or more");
    data.cost_price = c;
  }
  // tobacco / vapor compliance
  if (body.compliance_category !== undefined) {
    const { CATEGORIES } = require("./compliance");
    const c = String(body.compliance_category || "none");
    if (!CATEGORIES[c]) throw new HttpError(400, `Compliance category must be one of: ${Object.keys(CATEGORIES).join(", ")}`);
    data.compliance_category = c;
  }
  if (body.nicotine_ml !== undefined) {
    if (body.nicotine_ml === "" || body.nicotine_ml === null) data.nicotine_ml = null;
    else {
      const ml = Number(body.nicotine_ml);
      if (!Number.isFinite(ml) || ml < 0) throw new HttpError(400, "Liquid volume (ml) must be 0 or more");
      data.nicotine_ml = ml;
    }
  }
  if (body.is_flavored !== undefined) data.is_flavored = body.is_flavored === true || body.is_flavored === "true" || body.is_flavored === "yes" || body.is_flavored === "1" || body.is_flavored === 1;
  if (data.title === "" || data.brand === "") throw new HttpError(400, "Title and brand can't be empty");
  return data;
};

module.exports = { productData, toList };
