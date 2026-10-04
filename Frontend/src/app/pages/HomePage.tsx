import React, { useState, Suspense, lazy } from "react";
import { useHomeProducts } from "../../features/products/hooks/useHomeProducts";
import { Product } from "../../features/products/types/product.types";

import { HeroSection } from "../components/home/HeroSection";
import FourFeatureSection from "../components/home/FourFeatures";
import QuickOrderModal from "../components/home/QuickOrderModal";
import ProductCard from "../../features/products/components/ProductCard";
import { getProductImage } from "../../features/products/utils/getProductImage";

const WhyChooseUs = lazy(() => import("../components/home/WhyChoseUS"));
const LogoMarquee = lazy(() => import("../components/home/LogoMarquee"));

export const HomePage: React.FC = () => {
  const { featured, newArrivals, bestSellers, loading, error } =
    useHomeProducts();

  const [quickOpen, setQuickOpen] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);

  const renderGrid = (products: Product[]) => (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {products.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          // Note: currentImage and onImageError are now handled
          // internally by ProductCard using the ID logic.
          onQuickOrder={(prod) => {
            setSelected(prod);
            setQuickOpen(true);
          }}
        />
      ))}
    </div>
  );

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading products...
      </div>
    );

  if (error)
    return (
      <div className="min-h-screen flex items-center justify-center text-red-500">
        {error}
      </div>
    );

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0f]">
      <HeroSection />

      <section className="max-w-7xl mx-auto px-6 py-10">
        <h2 className="text-4xl font-black mb-6">Featured Products</h2>
        {renderGrid(featured)}

        <FourFeatureSection />

        <h2 className="text-4xl font-black my-6">New Arrivals</h2>
        {renderGrid(newArrivals)}

        <h2 className="text-4xl font-black my-6">Best Sellers</h2>
        {renderGrid(bestSellers)}
      </section>

      {selected && (
        <QuickOrderModal
          isOpen={quickOpen}
          onClose={() => setQuickOpen(false)}
          product={{
            title: selected.title,
            brand: selected.brand,
            // Use the same utility for the modal image
            imageUrl: getProductImage(selected.id),
            variants: selected.flavors?.length ? selected.flavors : ["Standard"],
            id: Number(selected.id),
            hasFlavors: !!selected.flavors?.length,
            flavorStock: (selected as any).flavor_stock,
          }}
        />
      )}

      <Suspense fallback={<div className="py-10 text-center">Loading…</div>}>
        <WhyChooseUs />
        <LogoMarquee />
      </Suspense>
    </div>
  );
};
