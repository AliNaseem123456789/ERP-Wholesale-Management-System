// A product's picture, with a tidy placeholder when it has none or the image can't load (no broken-image icons).
import React, { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { productImage } from "../utils/getProductImage";

const TINTS = ["from-sky-50 to-sky-100 text-sky-300", "from-violet-50 to-violet-100 text-violet-300", "from-emerald-50 to-emerald-100 text-emerald-300", "from-amber-50 to-amber-100 text-amber-300", "from-rose-50 to-rose-100 text-rose-300", "from-slate-50 to-slate-100 text-slate-300"];
const tintOf = (s: string) => TINTS[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

export const ImagePlaceholder: React.FC<{ title?: string; brand?: string | null; className?: string; small?: boolean }> = ({ title = "", brand, className = "", small }) => (
  <div className={`w-full h-full flex flex-col items-center justify-center bg-gradient-to-br ${tintOf(brand || title || "x")} ${className}`} aria-hidden="true">
    <Package size={small ? 18 : 34} strokeWidth={1.5} />
    {!small && brand && <span className="mt-2 px-2 text-[11px] font-bold uppercase tracking-wide text-gray-400 line-clamp-1 text-center">{brand}</span>}
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
