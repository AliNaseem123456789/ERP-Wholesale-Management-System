// Company catalogue: products, variants, images, specifications, categories, brands.
import { apiClient } from "../../../api/apiClient";

const co = (companyId: string, extra: Record<string, unknown> = {}) => ({
  ...extra,
  headers: { "X-Company-Id": companyId, ...((extra.headers as object) || {}) },
});

export type ProductStatus = "draft" | "published" | "hidden" | "discontinued" | "archived";
export const PRODUCT_STATUSES: { value: ProductStatus; label: string; hint: string }[] = [
  { value: "draft", label: "Draft", hint: "Not visible to customers yet" },
  { value: "published", label: "Published", hint: "Visible and orderable" },
  { value: "hidden", label: "Hidden", hint: "Temporarily off the store" },
  { value: "discontinued", label: "Discontinued", hint: "No longer sold; history kept" },
  { value: "archived", label: "Archived", hint: "Out of the way; history kept" },
];

export type Category = { id: number; name: string; slug: string; parent_id: number | null; product_count?: number; own?: boolean };
export type AttributeOption = { id: number; value: string; sort_order: number };
export type Attribute = {
  id: number; key: string; name: string; data_type: "text" | "number" | "boolean" | "date" | "select" | "multiselect";
  unit?: string | null; scope: "product" | "variant" | "both"; is_variant_option: boolean; is_filterable: boolean; is_public: boolean;
  validation?: { min?: number; max?: number; maxLength?: number; pattern?: string; open?: boolean };
  company_id?: number | null; own?: boolean; attribute_options: AttributeOption[]; is_required?: boolean; value?: unknown;
};
export type CompanyVariant = {
  id: number; key: string; flavor: string; name: string; sku?: string | null; barcode?: string | null; price?: number | null;
  cost_price?: number | null; status: "active" | "discontinued" | "archived"; min_order_qty?: number | null; image_url?: string | null;
  options: Record<string, string | number>; on_hand: number; reserved: number; has_history: boolean;
};
export type ProductImage = { id: number; url: string; alt_text?: string | null; variant_key?: string | null; sort_order: number };
export type CompanyBrand = { id: number; name: string; slug: string; logo_url?: string | null; relationship: string; product_count: number };

export const RELATIONSHIPS: Record<string, string> = {
  manufacturer: "Manufacturer (we make it)",
  authorized_distributor: "Authorized distributor",
  distributor: "Distributor",
  reseller: "Reseller",
};

export const catalogApi = {
  products: async (c: string, params: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams();
    const all: Record<string, string | number | undefined> = { limit: 20, ...params };
    for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== "") q.set(k, String(v));
    return (await apiClient.get(`/company/products?${q}`, co(c))).data;
  },
  product: async (c: string, id: number | string) => (await apiClient.get(`/company/products/${id}`, co(c))).data.data,
  create: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/products", body, co(c))).data,
  update: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.patch(`/company/products/${id}`, body, co(c))).data,
  remove: async (c: string, id: number) => (await apiClient.delete(`/company/products/${id}`, co(c))).data,
  bulk: async (c: string, body: { ids: number[]; action: string; value?: unknown; preview?: boolean }) =>
    (await apiClient.post("/company/products/bulk", body, co(c))).data,

  uploadImages: async (c: string, id: number, files: File[], variantKey?: string) => {
    const form = new FormData();
    files.forEach((f) => form.append("images", f));
    if (variantKey) form.append("variant_key", variantKey);
    return (await apiClient.post(`/company/products/${id}/images`, form, co(c))).data.data as ProductImage[];
  },
  addImageUrl: async (c: string, id: number, url: string, variantKey?: string) =>
    (await apiClient.post(`/company/products/${id}/images`, { url, variant_key: variantKey || undefined }, co(c))).data.data as ProductImage[],
  updateImages: async (c: string, id: number, images: { id: number; alt_text?: string | null; variant_key?: string | null }[]) =>
    (await apiClient.patch(`/company/products/${id}/images`, { images }, co(c))).data.data as ProductImage[],
  deleteImage: async (c: string, id: number, imageId: number) =>
    (await apiClient.delete(`/company/products/${id}/images/${imageId}`, co(c))).data.data as ProductImage[],

  variants: async (c: string, id: number) =>
    (await apiClient.get(`/company/products/${id}/variants`, co(c))).data as { data: CompanyVariant[]; option_attribute_ids: string[]; unassigned: number },
  saveVariants: async (c: string, id: number, body: { option_attribute_ids: (number | string)[]; variants: Record<string, unknown>[] }) =>
    (await apiClient.put(`/company/products/${id}/variants`, body, co(c))).data,

  productAttributes: async (c: string, id: number, categoryIds?: number[]) =>
    (await apiClient.get(`/company/products/${id}/attributes${categoryIds ? `?category_ids=${categoryIds.join(",")}` : ""}`, co(c))).data.data as Attribute[],
  saveProductAttributes: async (c: string, id: number, values: { attribute_id: number; value: unknown }[]) =>
    (await apiClient.put(`/company/products/${id}/attributes`, { values }, co(c))).data,

  categories: async (c: string) => (await apiClient.get("/company/categories", co(c))).data.data as Category[],
  createCategory: async (c: string, name: string, parentId?: number | null) =>
    (await apiClient.post("/company/categories", { name, parent_id: parentId || undefined }, co(c))).data,

  attributes: async (c: string, params: { category_ids?: number[]; variant_options?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (params.category_ids?.length) q.set("category_ids", params.category_ids.join(","));
    if (params.variant_options) q.set("variant_options", "true");
    return (await apiClient.get(`/company/attributes?${q}`, co(c))).data.data as Attribute[];
  },
  createAttribute: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/attributes", body, co(c))).data.data as Attribute,
  addAttributeOption: async (c: string, id: number, value: string) =>
    (await apiClient.post(`/company/attributes/${id}/options`, { value }, co(c))).data.data as AttributeOption[],

  brands: async (c: string) => (await apiClient.get("/company/brands", co(c))).data.data as CompanyBrand[],
  searchBrands: async (c: string, q: string) =>
    (await apiClient.get(`/company/brands/search?q=${encodeURIComponent(q)}`, co(c))).data.data as { id: number; name: string; slug: string }[],
  addBrand: async (c: string, name: string, relationship?: string) => (await apiClient.post("/company/brands", { name, relationship }, co(c))).data,
  setBrandRelationship: async (c: string, brandId: number, relationship: string) =>
    (await apiClient.patch(`/company/brands/${brandId}`, { relationship }, co(c))).data,
  removeBrand: async (c: string, brandId: number) => (await apiClient.delete(`/company/brands/${brandId}`, co(c))).data,

  customerGroups: async (c: string) => (await apiClient.get("/company/customer-groups", co(c))).data.data as { id: number; name: string }[],
};

/** Categories as an indented list (parents first). */
export const categoryTree = (cats: Category[]) => {
  const out: (Category & { depth: number; path: string })[] = [];
  const walk = (parent: number | null, depth: number, prefix: string) => {
    for (const c of cats.filter((x) => (x.parent_id ?? null) === parent).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix} › ${c.name}` : c.name;
      out.push({ ...c, depth, path });
      walk(c.id, depth + 1, path);
    }
  };
  walk(null, 0, "");
  // categories whose parent is hidden/missing
  for (const c of cats) if (!out.some((o) => o.id === c.id)) out.push({ ...c, depth: 0, path: c.name });
  return out;
};
