// src/features/products/hooks/useProductsByCategory.ts
import { useState, useEffect } from "react";
import { Product } from "../types/product.types";
import { getProductsByCategory } from "../api/productApi";

export function useProductsByCategory(category: string) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!category) return;

    setLoading(true);
    getProductsByCategory(category)
      .then((res) => setProducts(res))
      .catch((err: any) => setError(err.message || "Failed to fetch category products"))
      .finally(() => setLoading(false));
  }, [category]);

  return { products, loading, error };
}
