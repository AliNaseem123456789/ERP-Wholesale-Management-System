import { useEffect, useState } from "react";
import { getHomeProducts } from "../api/productApi";
import { Product } from "../types/product.types";

export function useHomeProducts() {
  const [featured, setFeatured] = useState<Product[]>([]);
  const [newArrivals, setNewArrivals] = useState<Product[]>([]);
  const [bestSellers, setBestSellers] = useState<Product[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchHomeProducts() {
      try {
        setLoading(true);
        const data = await getHomeProducts();

        if (!mounted) return;

        setFeatured(data.featured);
        setNewArrivals(data.newArrivals);
        setBestSellers(data.bestSellers);
      } catch (err: any) {
        console.error("Home products error:", err);
        setError(err.message || "Something went wrong");
      } finally {
        mounted && setLoading(false);
      }
    }

    fetchHomeProducts();
    return () => {
      mounted = false;
    };
  }, []);

  return {
    featured,
    newArrivals,
    bestSellers,
    loading,
    error,
  };
}
