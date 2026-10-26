// Platform admin: categories, attributes & templates, brands, catalogue health.
import { apiClient } from "../../../api/apiClient";

export type AdminCategory = {
  id: number; name: string; slug: string; parent_id: number | null; description?: string | null; image_url?: string | null;
  is_featured: boolean; sort_order: number; status: "active" | "hidden"; product_count: number; attribute_count: number; redirect_to?: string | null;
  created_by_company?: { id: number; name: string } | null;
};
export type AdminAttribute = {
  id: number; key: string; name: string; description?: string | null; data_type: string; unit?: string | null; scope: string;
  is_variant_option: boolean; is_filterable: boolean; is_searchable: boolean; is_public: boolean; sort_order: number;
  validation: { min?: number; max?: number; maxLength?: number; pattern?: string; open?: boolean };
  attribute_options: { id: number; value: string; sort_order: number }[]; value_count: number; category_count: number;
  company?: { id: number; name: string } | null; is_required?: boolean;
};

export type MarketplaceSettings = {
  nav?: unknown;
  featured: { brand_ids: string[]; category_ids: string[]; company_ids: string[] };
  banners: { image_url: string; image_alt?: string; title?: string; subtitle?: string; link?: string }[];
  storefront: { themes: string[]; custom_colors: boolean; sections: string[] };
};
type Named = { id: number | string; name: string; slug: string };

export const adminCatalogApi = {
  marketplace: async () => (await apiClient.get("/admin/marketplace")).data as {
    data: MarketplaceSettings; chosen: { brands: Named[]; categories: Named[]; companies: Named[] };
    all_themes: { key: string; name: string }[]; all_sections: { type: string; label: string }[];
  },
  saveMarketplace: async (body: MarketplaceSettings) => (await apiClient.put("/admin/marketplace", body)).data as { message: string; data: MarketplaceSettings },
  collections: async () => (await apiClient.get("/admin/collections")).data.data as any[],
  collection: async (id: number) => (await apiClient.get(`/admin/collections/${id}`)).data.data as any,
  createCollection: async (body: Record<string, unknown>) => (await apiClient.post("/admin/collections", body)).data,
  updateCollection: async (id: number, body: Record<string, unknown>) => (await apiClient.patch(`/admin/collections/${id}`, body)).data,
  deleteCollection: async (id: number) => (await apiClient.delete(`/admin/collections/${id}`)).data as { message: string },
  searchProducts: async (q: string) => (await apiClient.get(`/admin/products/search?q=${encodeURIComponent(q)}`)).data.data as any[],
  previewStorefront: async (companyId: number, source: "draft" | "published" = "published") =>
    (await apiClient.get(`/admin/companies/${companyId}/storefront?source=${source}`)).data as { data: any; has_published: boolean; storefront_published: boolean },

  categories: async () => (await apiClient.get("/admin/categories")).data.data as AdminCategory[],
  createCategory: async (body: Record<string, unknown>) => (await apiClient.post("/admin/categories", body)).data,
  updateCategory: async (id: number, body: Record<string, unknown>) => (await apiClient.patch(`/admin/categories/${id}`, body)).data,
  deleteCategory: async (id: number) => (await apiClient.delete(`/admin/categories/${id}`)).data,
  mergeCategory: async (id: number, intoId: number) => (await apiClient.post(`/admin/categories/${id}/merge`, { into_id: intoId })).data,
  categoryAttributes: async (id: number) => (await apiClient.get(`/admin/categories/${id}/attributes`)).data.data as AdminAttribute[],
  setCategoryAttributes: async (id: number, attributes: { attribute_id: number; is_required: boolean }[]) =>
    (await apiClient.put(`/admin/categories/${id}/attributes`, { attributes })).data,
  applyTemplate: async (id: number, template: string) => (await apiClient.post(`/admin/categories/${id}/apply-template`, { template })).data,
  templates: async () => (await apiClient.get("/admin/attribute-templates")).data.data as { key: string; name: string; attributes: { key: string; name: string; data_type: string; is_variant_option: boolean }[] }[],

  attributes: async (scope: "global" | "all" = "global") => (await apiClient.get(`/admin/attributes?scope=${scope}`)).data.data as AdminAttribute[],
  createAttribute: async (body: Record<string, unknown>) => (await apiClient.post("/admin/attributes", body)).data.data as AdminAttribute,
  updateAttribute: async (id: number, body: Record<string, unknown>) => (await apiClient.patch(`/admin/attributes/${id}`, body)).data.data as AdminAttribute,
  deleteAttribute: async (id: number) => (await apiClient.delete(`/admin/attributes/${id}`)).data,
  addOption: async (id: number, value: string) => (await apiClient.post(`/admin/attributes/${id}/options`, { value })).data.data,
  updateOption: async (optionId: number, body: { value?: string; sort_order?: number }) => (await apiClient.patch(`/admin/attribute-options/${optionId}`, body)).data.data,
  deleteOption: async (optionId: number) => (await apiClient.delete(`/admin/attribute-options/${optionId}`)).data,

  brands: async (q = "") => (await apiClient.get(`/admin/brands${q ? `?q=${encodeURIComponent(q)}` : ""}`)).data.data as any[],
  updateBrand: async (id: number, body: Record<string, unknown>) => (await apiClient.patch(`/admin/brands/${id}`, body)).data,
  mergeBrand: async (id: number, intoId: number) => (await apiClient.post(`/admin/brands/${id}/merge`, { into_id: intoId })).data,
  moveBrandProducts: async (id: number, companyId: number, fromCompanyId?: number) =>
    (await apiClient.post(`/admin/brands/${id}/assign`, { company_id: companyId, from_company_id: fromCompanyId })).data,

  health: async () => (await apiClient.get("/admin/catalogue/health")).data.data as {
    duplicate_skus: { company: string; sku: string; n: number; product_ids: number[]; titles: string[] }[];
    duplicate_brands: { name: string; ids: number[]; names: string[] }[];
    empty_categories: { id: number; name: string }[];
    products_without_category: number;
  },
};
