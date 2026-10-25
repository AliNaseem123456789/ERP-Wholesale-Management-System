// Public marketplace API. Works logged out; logged-in buyers also get their prices and stock numbers.
import { apiClient } from "../../api/apiClient";
import { Product } from "../products/types/product.types";

const pub = { _public: true } as any;
const get = async <T,>(url: string): Promise<T> => {
  try {
    return (await apiClient.get(url, pub)).data as T;
  } catch (err: any) {
    const e = new Error(err?.response?.data?.message || "Something went wrong") as Error & { status?: number };
    e.status = err?.response?.status;
    throw e;
  }
};

export type Facets = {
  categories: { id: number; name: string; slug: string; count: number }[];
  brands: { id: number; name: string; slug: string; count: number }[];
  companies: { id: number; name: string; slug: string; count: number }[];
  attributes: { key: string; name: string; unit?: string | null; values: { value: string; count: number }[] }[];
};
export type CategoryNode = { id: number; name: string; slug: string; parent_id: number | null; image_url?: string | null; is_featured?: boolean; description?: string | null; product_count: number; children?: CategoryNode[] };
export type SearchResult = {
  data: Product[]; total: number; page: number; pages: number; sorts: string[]; facets?: Facets;
  category: (CategoryNode & { trail: { id: number; name: string; slug: string }[]; children: { id: number; name: string; slug: string; image_url?: string | null }[] }) | null;
};
export type CompanyCardT = {
  id: number; name: string; slug: string; logo_url?: string | null; banner_url?: string | null; tagline?: string | null;
  city?: string | null; state?: string | null; country?: string | null; is_featured?: boolean; product_count?: number; brand_count?: number;
  top_categories?: { name: string; slug: string }[];
  rating?: { average: number | null; count: number } | null;
};
export type Contact = {
  email: string | null; phone: string | null; website: string | null; city: string | null; state: string | null; country: string | null;
  delivery_info: string | null; payment_info: string | null; min_order_value: number | null; lead_time_days: number | null;
};
export type Theme = { key: string; name: string; primary: string; accent: string; background: string; text: string; radius: string; font: string };
export type Section = {
  id: string; type: string; enabled: boolean; title: string; subtitle: string; layout: string;
  image_url?: string; image_alt?: string; text?: string; link?: string; link_label?: string;
  products?: Product[]; brands?: { id: number; name: string; slug: string; logo_url?: string | null; relationship?: string }[];
  categories?: { id: number; name: string; slug: string; image_url?: string | null }[];
  collection?: { id: number; name: string; slug: string; description?: string | null; cover_image_url?: string | null };
  items?: { image_url: string; image_alt?: string; title?: string; link?: string }[];
  contact?: Contact;
};
export type Storefront = CompanyCardT & {
  description?: string | null; website?: string | null; contact: Contact; theme: Theme; sections: Section[];
  categories: { id: number; name: string; slug: string; count: number }[];
  brands: { id: number; name: string; slug: string; logo_url?: string | null; relationship?: string }[];
  collections: { id: number; name: string; slug: string; description?: string | null; cover_image_url?: string | null }[];
  rating?: { average: number | null; count: number } | null;
  promotions?: { code: string; description: string | null; type: "percent" | "fixed" | "free_shipping"; value: number; min_order_amount: number; ends_at: string | null }[];
};
export type NavItem = { label: string; href: string; external?: boolean };
export type Banner = { image_url: string; image_alt?: string; title?: string; subtitle?: string; link?: string };

/** Query string from a params object (empty values left out). */
export const qs = (params: Record<string, unknown>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

export const marketplaceApi = {
  settings: () => get<{ data: { nav: NavItem[]; banners: Banner[] } }>("/marketplace/settings").then((r) => r.data),
  home: () => get<{ data: { banners: Banner[]; categories: CategoryNode[]; brands: any[]; companies: CompanyCardT[]; featured: Product[]; new_arrivals: Product[]; collections: { id: number; name: string; slug: string; description?: string | null; products: Product[] }[] } }>("/marketplace/home").then((r) => r.data),
  products: (params: Record<string, string>) => get<SearchResult>(`/marketplace/products${qs(params)}`),
  categories: (q = "") => get<{ data: CategoryNode[] }>(`/marketplace/categories${qs({ q })}`).then((r) => r.data),
  category: (slug: string, params: Record<string, string>) => get<SearchResult>(`/marketplace/categories/${encodeURIComponent(slug)}${qs(params)}`),
  brands: (params: Record<string, string | number>) => get<{ data: any[]; total: number; page: number; pages: number }>(`/marketplace/brands${qs(params)}`),
  brand: (slug: string, params: Record<string, string>) => get<SearchResult & { brand: any }>(`/marketplace/brands/${encodeURIComponent(slug)}${qs(params)}`),
  companies: (params: Record<string, string | number>) => get<{ data: CompanyCardT[]; total: number; page: number; pages: number }>(`/marketplace/companies${qs(params)}`),
  company: (slug: string) => get<{ data: Storefront }>(`/marketplace/companies/${encodeURIComponent(slug)}`).then((r) => r.data),
  companyProducts: (slug: string, params: Record<string, string>) => get<SearchResult>(`/marketplace/companies/${encodeURIComponent(slug)}/products${qs(params)}`),
  companyCollection: (slug: string, col: string) => get<{ data: { collection: any; company: any; products: Product[] } }>(`/marketplace/companies/${encodeURIComponent(slug)}/collections/${encodeURIComponent(col)}`).then((r) => r.data),
  collection: (slug: string) => get<{ data: { collection: any; products: Product[] } }>(`/marketplace/collections/${encodeURIComponent(slug)}`).then((r) => r.data),
};

export const SORT_LABELS: Record<string, string> = {
  relevance: "Recommended", newest: "Newest", title: "Name A–Z", price_asc: "Price: low to high", price_desc: "Price: high to low", featured: "Featured first",
};
