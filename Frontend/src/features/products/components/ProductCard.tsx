import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Product } from "../types/product.types";
import { useAuth } from "../../auth/context/AuthContext";
import { Lock, GitCompareArrows, Check, Store, Zap } from "lucide-react";
import { toast } from "sonner";
import { ProductImage } from "./ProductImage";
import { useCompare, COMPARE_MAX } from "../../site/browserLists";
import { productImage } from "../utils/getProductImage";
import QuickOrderModal from "../../../app/components/home/QuickOrderModal";
import { RatingBadge, SaleBadge } from "../../insights/components";

interface ProductCardProps {
  product: Product;
  /** optional: pages with their own quick-order modal; otherwise the card opens one itself */
  onQuickOrder?: (p: Product) => void;
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A product in a grid. Buyers scan for price and pack, so those come straight after the name;
 * the picture and the name both open the product.
 */
const ProductCard: React.FC<ProductCardProps> = ({ product, onQuickOrder }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quickOpen, setQuickOpen] = useState(false);
  const compare = useCompare();
  const comparing = compare.has(product.id);
  const href = `/product/${product.slug || product.id}`;
  const out = product.stock_status === "out_of_stock";
  const price = product.price != null ? Number(product.price) : null;
  const tiers = (product.price_tiers || []).filter((t) => t.min_quantity > 1).sort((a, b) => b.min_quantity - a.min_quantity);
  const best = tiers[0];
  const packLabel = product.pack_size ? `${product.unit ? product.unit[0].toUpperCase() + product.unit.slice(1) : "Pack"} of ${product.pack_size}` : null;
  const minLabel = (product.min_order_qty || 1) > 1 ? `Min ${product.min_order_qty}` : null;

  return (
    <div className={`group relative flex flex-col h-full bg-surface rounded-xl border border-line hover:border-line-strong hover:shadow-md ${out ? "opacity-[.85]" : ""}`}>
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

      <div className="relative p-2 pb-0">
        <Link to={href} className="block relative aspect-square overflow-hidden rounded-lg bg-raised" tabIndex={-1} aria-hidden="true">
          <ProductImage product={product} className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${out ? "grayscale-[.6]" : ""}`} />
        </Link>
        <div className="absolute z-10 top-4 left-4 flex flex-col items-start gap-1.5 pointer-events-none">
          {out && <span className="bg-solid text-white text-xs font-semibold px-2 py-0.5 rounded-md">Out of stock</span>}
          {product.stock_status === "preorder" && (
            <span className="bg-brand text-white text-xs font-semibold px-2 py-0.5 rounded-md" title={product.expected_date ? `Expected around ${new Date(product.expected_date).toLocaleDateString()}` : undefined}>Pre-order</span>
          )}
          {product.sale && <SaleBadge sale={product.sale} />}
        </div>
        <button
          type="button"
          onClick={() => { if (!compare.toggle(product.id)) toast.error(`You can compare up to ${COMPARE_MAX} products. Remove one first.`); }}
          aria-pressed={comparing}
          aria-label={comparing ? "Remove from compare" : "Add to compare"}
          title={comparing ? "Remove from compare" : "Add to compare"}
          className={`absolute z-10 top-4 right-4 w-8 h-8 rounded-full grid place-items-center shadow-sm ${comparing ? "bg-brand text-white" : "bg-[#fff]/95 text-[#0F1B2D] md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"}`}
        >
          {comparing ? <Check size={15} /> : <GitCompareArrows size={15} />}
        </button>
      </div>

      <div className="flex flex-col flex-1 p-3 pt-2.5">
        <div className="flex items-center justify-between gap-2 min-h-5">
          <p className="text-[13px] font-medium text-ink-3 truncate">{product.brand}</p>
          <RatingBadge rating={product.rating} className="shrink-0" />
        </div>
        <h3 className="mt-0.5 text-[15px] font-semibold leading-snug text-ink line-clamp-2 min-h-[2.6em]">
          <Link to={href} className="hover:text-brand-text focus-visible:outline-none after:absolute after:inset-0 after:content-[''] after:rounded-xl">{product.title}</Link>
        </h3>
        {product.company && (
          <button
            onClick={() => navigate(`/companies/${product.company!.slug}`)}
            className="relative z-10 mt-1 flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink truncate text-left max-w-full"
            title="View supplier"
          >
            <Store size={13} className="shrink-0" /> <span className="truncate">{product.company.name}</span>
          </button>
        )}

        {(packLabel || minLabel) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {packLabel && <span className="text-xs text-ink-2 bg-raised border border-line rounded px-1.5 py-px">{packLabel}</span>}
            {minLabel && <span className="text-xs text-ink-2 bg-raised border border-line rounded px-1.5 py-px">{minLabel}</span>}
          </div>
        )}

        <div className="mt-auto pt-3">
          {user && price != null ? (
            <div className="mb-3">
              <p className="flex items-baseline gap-1.5 flex-wrap">
                <span className="font-display text-xl font-extrabold text-ink leading-none">{money(price)}</span>
                {product.unit && <span className="text-[13px] text-ink-3">/ {product.unit}</span>}
                {product.list_price != null && product.list_price > price && <span className="text-[13px] text-ink-3 line-through">{money(Number(product.list_price))}</span>}
              </p>
              {best && Number(best.price) < price ? (
                <p className="mt-1 text-[13px] text-success font-medium">{money(Number(best.price))} at {best.min_quantity}+</p>
              ) : <p className="mt-1 text-[13px] text-ink-3">&nbsp;</p>}
            </div>
          ) : !user ? (
            <Link to="/login" className="relative z-10 mb-3 flex items-center gap-2 rounded-lg bg-raised border border-dashed border-line-strong px-2.5 py-2 text-[13px] font-medium text-ink-2 hover:text-ink hover:border-ink-3">
              <Lock size={14} className="shrink-0 text-ink-3" /> <span className="truncate">Sign in<span className="hidden sm:inline"> for trade prices</span><span className="sm:hidden"> for prices</span></span>
            </Link>
          ) : null}

          <button
            onClick={() => (onQuickOrder ? onQuickOrder(product) : setQuickOpen(true))}
            className={`relative z-10 w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-semibold ${out ? "bg-raised text-ink-2 border border-line hover:text-ink" : "bg-solid text-white hover:bg-solid-hover"}`}
          >
            <Zap size={15} /> Quick order
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
