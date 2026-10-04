import { useState, useEffect } from "react";
import { Product } from "../types/product.types";
import { getProductsByBrand } from "../api/productApi";

export function useBrandProducts(brandName?: string) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!brandName) return;

    const fetchProducts = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await getProductsByBrand(brandName);
        setProducts(data);
      } catch (err: any) {
        console.error("Fetch error:", err);
        setError(err.message || "Network error");
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [brandName]);

  return { products, loading, error };
}
