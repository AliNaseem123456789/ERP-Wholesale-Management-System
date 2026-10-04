import { Brand } from "../types/brand.types";
import { apiClient } from "../../../api/apiClient";

export async function getBrands(): Promise<Brand[]> {
  const { data } = await apiClient.get("/products/brands", { _public: true } as any);
  return data.data || [];
}
