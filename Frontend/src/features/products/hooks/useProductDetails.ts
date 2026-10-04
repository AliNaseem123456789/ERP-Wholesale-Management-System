import { useState, useEffect } from "react";
import { Product } from "../types/product.types";
import { getProductById } from "../api/productApi";

export function useProductDetail(id?: string | number) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    getProductById(id)
      .then((res) => setProduct(res))
      .catch((err: any) => setError(err.message || "Failed to fetch product"))
      .finally(() => setLoading(false));
  }, [id]);

  return { product, loading, error };
}
