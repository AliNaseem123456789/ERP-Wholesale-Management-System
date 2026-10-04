import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ProductCard from "../components/ProductCard";
import { searchProducts } from "../api/companyApi";
import { Product } from "../types/product.types";

export const SearchPage: React.FC = () => {
  const [params] = useSearchParams();
  const q = params.get("q") || "";
  const [results, setResults] = useState<Product[] | null>(null);

  useEffect(() => {
    setResults(null);
    searchProducts(q).then(setResults).catch(() => setResults([]));
  }, [q]);

  return (
    <div className="min-h-screen p-6 bg-white dark:bg-[#191919] text-gray-900 dark:text-gray-200">
      <div className="max-w-[1400px] mx-auto">
        <h1 className="text-2xl font-black mb-6">
          {q.length < 2 ? "Type at least 2 characters to search" : `Results for “${q}”`}
        </h1>
        {q.length >= 2 && !results && <p className="text-gray-500">Searching...</p>}
        {results && results.length === 0 && q.length >= 2 && <p className="text-gray-500">No products match your search.</p>}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
          {results?.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </div>
    </div>
  );
};
