import { Product, HomeProductsResponse } from "../types/product.types";
import { apiClient } from "../../../api/apiClient";

// Catalogue endpoints are public; prices are only included when logged in.
const publicGet = async <T,>(url: string): Promise<T> => {
  try {
    const { data } = await apiClient.get(url, { _public: true } as any);
    return data.data as T;
  } catch (err: any) {
    throw new Error(err.response?.data?.message || "Request failed");
  }
};

export const getHomeProducts = () =>
  publicGet<HomeProductsResponse>("/products/home");

export const getProductsByBrand = (brand: string) =>
  publicGet<Product[]>(`/products/brand/${encodeURIComponent(brand)}`);

export const getProductsByCategory = (category: string) =>
  publicGet<Product[]>(`/products/category/${encodeURIComponent(category)}`);

export const getProductById = (id: string | number) =>
  publicGet<Product>(`/products/product/${id}`);

export const getAllProducts = () => publicGet<Product[]>("/products/display");
