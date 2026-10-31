// A product's picture, with a tidy placeholder when it has none or the image can't load (no broken-image icons).
import React, { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { productImage } from "../utils/getProductImage";

const TINTS = ["text-sky-500", "text-violet-500", "text-emerald-500", "text-amber-500", "text-rose-500", "text-blue-500"];
const tintOf = (s: string) => TINTS[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

export const ImagePlaceholder: React.FC<{ title?: string; brand?: string | null; className?: string; small?: boolean }> = ({ title = "", brand, className = "", small }) => (
  <div className={`relative w-full h-full flex flex-col items-center justify-center bg-raised overflow-hidden ${className}`} aria-hidden="true">
    {!small && <span className="absolute inset-0 opacity-[.5]" style={{ backgroundImage: "radial-gradient(var(--line-strong) 1px, transparent 1px)", backgroundSize: "14px 14px" }} />}
    <span className={`relative ${tintOf(brand || title || "x")} opacity-70`}><Package size={small ? 18 : 36} strokeWidth={1.4} /></span>
    {!small && brand && <span className="relative mt-2 px-3 font-display text-sm font-bold text-ink-3 line-clamp-1 text-center">{brand}</span>}
  </div>
);

/** product: anything with id and optionally image (the gallery's first image). src overrides the image. */
export const ProductImage: React.FC<{
  product?: { id: number | string; image?: string | null; title?: string; brand?: string | null } | null;
  src?: string | null;
  alt?: string;
  className?: string;
  small?: boolean;
}> = ({ product, src, alt, className = "w-full h-full object-cover", small }) => {
  const url = src ?? (product ? productImage(product) : "");
  const [failed, setFailed] = useState(!url);
  useEffect(() => setFailed(!url), [url]);
  if (failed) return <ImagePlaceholder title={product?.title || alt} brand={product?.brand} small={small} />;
  return <img src={url} alt={alt ?? product?.title ?? ""} loading="lazy" onError={() => setFailed(true)} className={className} />;
};
