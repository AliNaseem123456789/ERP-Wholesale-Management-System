import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Product } from "../types/product.types"; // Use standard Product
import { useAuth } from "../../auth/context/AuthContext";
import { Lock } from "lucide-react";
import { getProductImage } from "../utils/getProductImage";
import QuickOrderModal from "../../../app/components/home/QuickOrderModal";

interface ProductCardProps {
  product: Product; // Changed from ProductWithImages
  /** optional: pages with their own quick-order modal; otherwise the card opens one itself */
  onQuickOrder?: (p: Product) => void;
}

const ProductCard: React.FC<ProductCardProps> = ({ product, onQuickOrder }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quickOpen, setQuickOpen] = useState(false);

  return (
    <div className="group border rounded bg-white p-3 hover:shadow-md transition-shadow">
      {quickOpen && (
        <QuickOrderModal
          isOpen
          onClose={() => setQuickOpen(false)}
          product={{
            title: product.title,
            brand: product.brand,
            imageUrl: getProductImage(product.id),
            variants: product.flavors?.length ? product.flavors : ["Standard"],
            id: Number(product.id),
            hasFlavors: !!product.flavors?.length,
            flavorStock: product.flavor_stock,
          }}
        />
      )}
      <div
        className="relative aspect-[4/3] cursor-pointer overflow-hidden rounded bg-gray-50"
        onClick={() => navigate(`/product/${product.id}`)}
      >
        {product.stock_status === "out_of_stock" && (
          <span className="absolute top-2 left-2 z-10 bg-gray-900/80 text-white text-[10px] font-bold uppercase px-2 py-0.5 rounded">
            Out of stock
          </span>
        )}
        <img
          src={getProductImage(product.id)}
          alt={product.title}
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/placeholder-image.png";
          }}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </div>

      <p className="text-xs text-cyan-500 uppercase font-bold mt-2">
        {product.brand}
      </p>
      <h3 className="text-sm font-bold line-clamp-1">{product.title}</h3>
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
          onClick={() => navigate(`/product/${product.id}`)}
          className="bg-cyan-500 text-white text-xs py-1 rounded hover:bg-cyan-600 transition-colors"
        >
          View
        </button>
        <button
          onClick={() => (onQuickOrder ? onQuickOrder(product) : setQuickOpen(true))}
          className="bg-pink-500 text-white text-xs py-1 rounded hover:bg-pink-600 transition-colors"
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
