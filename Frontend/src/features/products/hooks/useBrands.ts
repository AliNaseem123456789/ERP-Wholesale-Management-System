import { useState, useEffect } from "react";
import { Brand } from "../types/brand.types";
import { getBrands } from "../api/brandApi";

export function useBrands() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getBrands()
      .then((data) => setBrands(data))
      .catch((err: any) => setError(err.message || "Failed to fetch brands"))
      .finally(() => setLoading(false));
  }, []);

  return { brands, loading, error };
}
