import { apiClient } from "../../../api/apiClient";
import { CompanyBrief, Product } from "../types/product.types";

export interface PublicCompany extends CompanyBrief {
  description?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  productCount?: number;
  brands: { id: number; name: string }[];
  products?: Product[];
}

export const getCompanies = async (q = ""): Promise<PublicCompany[]> =>
  (await apiClient.get(`/companies${q ? `?q=${encodeURIComponent(q)}` : ""}`, { _public: true } as any)).data.data;

export const getCompany = async (slug: string): Promise<PublicCompany> =>
  (await apiClient.get(`/companies/${encodeURIComponent(slug)}`, { _public: true } as any)).data.data;

export const searchProducts = async (q: string): Promise<Product[]> =>
  (await apiClient.get(`/products/search?q=${encodeURIComponent(q)}`, { _public: true } as any)).data.data;
