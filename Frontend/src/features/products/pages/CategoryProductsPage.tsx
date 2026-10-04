import React, { useState } from "react";
import { useProductsByCategory } from "../hooks/useProductsByCategory";
import { getProductImage } from "../utils/getProductImage";

// Import Shared Components
import ProductCard from "../components/ProductCard";
import QuickOrderModal from "../../../app/components/home/QuickOrderModal";
import { Product } from "../types/product.types";

interface CategoryProductsPageProps {
  categoryName?: string;
  onNavigate: (path: string) => void;
}

export const CategoryProductsPage: React.FC<CategoryProductsPageProps> = ({
  categoryName,
  onNavigate,
}) => {
  const { products, loading, error } = useProductsByCategory(
    categoryName || "",
  );

  // Modal State - Uses base Product type now
  const [quickOpen, setQuickOpen] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse font-medium text-gray-500">
          Loading {categoryName}...
        </div>
      </div>
    );

  if (error)
    return (
      <div className="min-h-screen text-red-500 p-6 flex items-center justify-center">
        {error}
      </div>
    );

  if (!products.length)
    return (
      <div className="min-h-screen text-gray-400 p-6 flex flex-col items-center justify-center gap-4">
        <p>No products found in this category.</p>
        <button
          onClick={() => onNavigate("/")}
          className="text-cyan-500 underline"
        >
          Go Home
        </button>
      </div>
    );

  return (
    <div className="min-h-screen p-6 bg-white dark:bg-[#191919] text-black dark:text-gray-200">
      <button
        className="text-cyan-400 hover:text-cyan-300 mb-6 flex items-center gap-2 transition-colors"
        onClick={() => onNavigate("/")}
      >
        ← Back to Home
      </button>

      <h1 className="text-3xl font-black mb-8 text-center capitalize tracking-tight">
        {categoryName} Products
      </h1>

      <div className="max-w-[1400px] mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onQuickOrder={(prod) => {
                setSelected(prod);
                setQuickOpen(true);
              }}
            />
          ))}
        </div>
      </div>

      {/* Modal Layer */}
      {selected && (
        <QuickOrderModal
          isOpen={quickOpen}
          onClose={() => setQuickOpen(false)}
          product={{
            title: selected.title,
            brand: selected.brand,
            imageUrl: getProductImage(selected.id), // Direct ID call
            variants: selected.flavors?.length ? selected.flavors : ["Standard"],
            id: Number(selected.id),
            hasFlavors: !!selected.flavors?.length,
            flavorStock: (selected as any).flavor_stock,
          }}
        />
      )}
    </div>
  );
};
