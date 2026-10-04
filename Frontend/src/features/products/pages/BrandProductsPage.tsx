import React from "react";
import { useBrandProducts } from "../hooks/useBrandProducts";
import ProductCard from "../components/ProductCard";

interface BrandProductsPageProps {
  brandName?: string;
  onNavigate: (path: string) => void;
}

export const BrandProductsPage: React.FC<BrandProductsPageProps> = ({
  brandName,
  onNavigate,
}) => {
  const { products, loading, error } = useBrandProducts(brandName);

  // We no longer need useProductImageGallery or generateImageUrls here
  // because the ProductCard handles the ID-based image logic internally.

  if (loading)
    return (
      <div className="min-h-screen p-6 text-center">Loading products...</div>
    );

  if (error)
    return (
      <div className="min-h-screen p-6 text-red-500 text-center">{error}</div>
    );

  if (!products.length)
    return (
      <div className="min-h-screen p-6 text-gray-400 text-center">
        No products found for {brandName}
      </div>
    );

  return (
    <div className="min-h-screen p-6 bg-white dark:bg-[#191919] text-gray-900 dark:text-gray-200">
      <button
        onClick={() => onNavigate("/")}
        className="text-cyan-400 hover:text-cyan-300 mb-6 flex items-center gap-2 transition-colors"
      >
        <span>←</span> Back to Home
      </button>

      <h1 className="text-3xl font-black mb-8 text-center uppercase tracking-tight">
        {brandName} Products
      </h1>

      <div className="max-w-[1400px] mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              // QuickOrder is empty for now as per your original code
             
            />
          ))}
        </div>
      </div>
    </div>
  );
};
