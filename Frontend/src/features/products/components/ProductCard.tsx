import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Product } from "../types/product.types"; // Use standard Product
import { useAuth } from "../../auth/context/AuthContext";
import { Lock, GitCompareArrows, Check } from "lucide-react";
import { toast } from "sonner";
import { ProductImage } from "./ProductImage";
import { useLook } from "../../site/SiteContext";
import { useCompare, COMPARE_MAX } from "../../site/browserLists";
import { productImage } from "../utils/getProductImage";
import QuickOrderModal from "../../../app/components/home/QuickOrderModal";
import { RatingBadge, SaleBadge } from "../../insights/components";

interface ProductCardProps {
  product: Product; // Changed from ProductWithImages
  /** optional: pages with their own quick-order modal; otherwise the card opens one itself */
  onQuickOrder?: (p: Product) => void;
}

const ProductCard: React.FC<ProductCardProps> = ({ product, onQuickOrder }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quickOpen, setQuickOpen] = useState(false);
  const look = useLook();
  const compare = useCompare();
  const comparing = compare.has(product.id);

  return (
    <div className="group border rounded bg-white p-3 hover:shadow-md transition-shadow">
      {quickOpen && (
        <QuickOrderModal
          isOpen
          onClose={() => setQuickOpen(false)}
          product={{
            title: product.title,
            brand: product.brand,
            imageUrl: productImage(product),
            variants: product.flavors?.length ? product.flavors : ["Standard"],
            id: Number(product.id),
            hasFlavors: !!product.flavors?.length,
            flavorStock: product.flavor_stock,
          }}
        />
      )}
      <div
        className="relative aspect-[4/3] cursor-pointer overflow-hidden rounded bg-gray-50"
        onClick={() => navigate(`/product/${product.slug || product.id}`)}
      >
        {product.stock_status === "out_of_stock" && (
          <span className="absolute top-2 left-2 z-10 bg-gray-900/80 text-white text-[10px] font-bold uppercase px-2 py-0.5 rounded">
            Out of stock
          </span>
        )}
        {product.stock_status === "preorder" && (
          <span className="absolute top-2 left-2 z-10 bg-blue-600 text-white text-[10px] font-bold uppercase px-2 py-0.5 rounded" title={(product as any).expected_date ? `Expected around ${new Date((product as any).expected_date).toLocaleDateString()}` : undefined}>
            Pre-order
          </span>
        )}
        {product.sale && <SaleBadge sale={product.sale} className="absolute top-2 right-2 z-10" />}
        <ProductImage product={product} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!compare.toggle(product.id)) toast.error(`You can compare up to ${COMPARE_MAX} products. Remove one first.`);
          }}
          aria-pressed={comparing}
          title={comparing ? "Remove from compare" : "Add to compare"}
          className={`absolute bottom-2 right-2 z-10 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold shadow transition-opacity ${comparing ? "bg-blue-600 text-white opacity-100" : "bg-white/90 text-gray-700 opacity-100 md:opacity-0 md:group-hover:opacity-100"}`}
        >
          {comparing ? <Check size={11} /> : <GitCompareArrows size={11} />} {comparing ? "Comparing" : "Compare"}
        </button>
      </div>

      <p className={`text-xs uppercase font-bold mt-2 ${look.cardBrand}`}>
        {product.brand}
      </p>
      <h3 className="text-sm font-bold line-clamp-1">{product.title}</h3>
      <RatingBadge rating={product.rating} />
      {product.company && (
        <button
          onClick={() => navigate(`/companies/${product.company!.slug}`)}
          className="text-[11px] text-gray-500 hover:text-blue-600 hover:underline line-clamp-1 text-left"
          title="View seller"
        >
          Sold by {product.company.name}
        </button>
      )}

      <div className="grid grid-cols-2 gap-2 mt-2">
        <button
          onClick={() => navigate(`/product/${product.slug || product.id}`)}
          className={`text-xs py-1 rounded transition-colors ${look.cardView}`}
        >
          View
        </button>
        <button
          onClick={() => (onQuickOrder ? onQuickOrder(product) : setQuickOpen(true))}
          className={`text-xs py-1 rounded transition-colors ${look.cardQuick}`}
        >
          Quick Order
        </button>
      </div>

      {user && product.price != null && (
        <p className="mt-2 pt-2 border-t border-gray-100 text-center text-sm font-black text-gray-900">
          ${Number(product.price).toFixed(2)}
          {product.list_price != null && product.list_price > Number(product.price) && (
            <span className="ml-1 text-xs font-medium text-gray-400 line-through">${Number(product.list_price).toFixed(2)}</span>
          )}
          {product.price_tiers && product.price_tiers.length > 1 && (
            <span className="block text-[10px] font-bold text-blue-600">Volume pricing available</span>
          )}
        </p>
      )}

      {!user && (
        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-center gap-1.5 opacity-70">
          <Lock size={10} className="text-gray-400" />
          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">
            Login to see prices
          </span>
        </div>
      )}
    </div>
  );
};

export default ProductCard;
