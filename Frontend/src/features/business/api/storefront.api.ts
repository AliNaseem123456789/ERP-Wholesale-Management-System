// Company collections and storefront editor.
import { apiClient } from "../../../api/apiClient";
import type { Storefront } from "../../marketplace/api";

const co = (companyId: string, extra: Record<string, unknown> = {}) => ({
  ...extra,
  headers: { "X-Company-Id": companyId, ...((extra.headers as object) || {}) },
});

export type PickedProduct = { id: number | string; title: string; brand?: string | null; sku?: string | null; status?: string; image?: string | null; company?: string | null };
export type Collection = {
  id: number; name: string; slug: string; description: string | null; cover_image_url: string | null;
  status: "draft" | "published"; is_enabled: boolean; starts_at: string | null; ends_at: string | null; sort_order: number;
  product_count?: number; live?: boolean; products?: PickedProduct[]; company_id?: number | null;
};
export type SectionConfig = {
  id: string; type: string; enabled: boolean; title: string; subtitle: string; layout: string;
  image_url?: string; image_alt?: string; text?: string; link?: string; link_label?: string;
  product_ids?: string[]; brand_ids?: string[]; category_ids?: string[];
  collection_id?: string | null; category_id?: string | null; brand_id?: string | null;
  sort?: string; limit?: number;
  items?: { image_url: string; image_alt?: string; title?: string; link?: string }[];
};
export type StoreConfig = { theme: string; colors?: { primary?: string; accent?: string }; sections: SectionConfig[] };
export type SectionType = { type: string; label: string; layouts: string[]; fields: string[] };
export type StorefrontState = {
  draft: StoreConfig; published: StoreConfig | null; published_version: number; published_at: string | null;
  has_unpublished_changes: boolean; storefront_published: boolean; company_live: boolean; slug: string;
  themes: { key: string; name: string; primary: string; accent: string; radius: string }[];
  custom_colors: boolean; section_types: SectionType[];
};

export const storefrontApi = {
  collections: async (c: string) => (await apiClient.get("/company/collections", co(c))).data.data as Collection[],
  collection: async (c: string, id: number) => (await apiClient.get(`/company/collections/${id}`, co(c))).data.data as Collection,
  createCollection: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/collections", body, co(c))).data.data as Collection,
  updateCollection: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.patch(`/company/collections/${id}`, body, co(c))).data.data as Collection,
  deleteCollection: async (c: string, id: number) => (await apiClient.delete(`/company/collections/${id}`, co(c))).data as { message: string },

  get: async (c: string) => (await apiClient.get("/company/storefront", co(c))).data.data as StorefrontState,
  save: async (c: string, config: StoreConfig) => (await apiClient.put("/company/storefront", { config }, co(c))).data as { message: string; data: StoreConfig; warnings: string[] },
  preview: async (c: string, source: "draft" | "published" = "draft") => (await apiClient.get(`/company/storefront/preview?source=${source}`, co(c))).data.data as Storefront,
  publish: async (c: string) => (await apiClient.post("/company/storefront/publish", {}, co(c))).data as { message: string; warnings: string[] },
  unpublish: async (c: string) => (await apiClient.post("/company/storefront/unpublish", {}, co(c))).data as { message: string },
  reset: async (c: string) => (await apiClient.post("/company/storefront/reset", {}, co(c))).data as { message: string; data: StoreConfig },
  versions: async (c: string) => (await apiClient.get("/company/storefront/versions", co(c))).data.data as { version: number; published_at: string; published_by: { email: string; first_name?: string } | null }[],
  restore: async (c: string, v: number) => (await apiClient.post(`/company/storefront/versions/${v}/restore`, {}, co(c))).data as { message: string; data: StoreConfig },
  uploadImage: async (c: string, file: File) => {
    const form = new FormData();
    form.append("image", file);
    return (await apiClient.post("/company/storefront/images", form, co(c))).data.url as string;
  },
};
