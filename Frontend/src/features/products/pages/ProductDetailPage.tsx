import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { TriangleAlert, Plus, Minus, Lock, ArrowLeft, Info } from "lucide-react";
import { useProductDetail } from "../hooks/useProductDetails";
import { useAuth } from "../../auth/context/AuthContext";
import { AddToCartButton } from "../components/AddToCartButton";
import { getProductImage } from "../utils/getProductImage";
import { ProductVariant } from "../types/product.types";

const PLACEHOLDER_IMAGE = "/product-placeholder.png";

type OptionGroup = { key: string; name: string; values: string[] };

// Option groups (e.g. Size, Colour) in the order they first appear, from the variants that are listed.
const optionGroups = (variants: ProductVariant[]): OptionGroup[] => {
  const groups: OptionGroup[] = [];
  for (const v of variants) {
    for (const o of v.options) {
      if (o.value == null) continue;
      let g = groups.find((x) => x.key === o.key);
      if (!g) groups.push((g = { key: o.key, name: o.name, values: [] }));
      if (!g.values.includes(o.value)) g.values.push(o.value);
    }
  }
  return groups;
};
const optionValue = (v: ProductVariant, key: string) => v.options.find((o) => o.key === key)?.value ?? null;

// Rounds a quantity up to the next allowed amount (multiple of the pack, at least the minimum).
const allowedQty = (q: number, min: number, step: number) => {
  const atLeast = Math.max(q, min, 1);
  return Math.ceil(atLeast / step) * step;
};

export const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { product, loading, error } = useProductDetail(id);
  const { user, loading: authLoading } = useAuth();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [legacyFlavor, setLegacyFlavor] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [imageIdx, setImageIdx] = useState<number>(0);
  const [legacyImageNum, setLegacyImageNum] = useState<number>(1);

  const variants = useMemo(() => (product?.variants || []).filter((v) => v.status !== "archived"), [product]);
  const groups = useMemo(() => optionGroups(variants), [variants]);
  const usesOptions = variants.length > 0 && groups.length > 0;

  // the variant matching every chosen option
  const variant: ProductVariant | null = useMemo(() => {
    if (!usesOptions) return null;
    return variants.find((v) => groups.every((g) => optionValue(v, g.key) === selected[g.key])) || null;
  }, [usesOptions, variants, groups, selected]);
  const variantKey = usesOptions ? variant?.flavor || "" : legacyFlavor;

  const stockOf = (key: string) => product?.flavor_stock?.[key];
  const sellable = (v: ProductVariant) => v.status === "active" && (stockOf(v.flavor) ?? 1) > 0;

  useEffect(() => {
    if (!product) return;
    if (usesOptions) {
      // first variant on sale and in stock, else the first one
      const first = variants.find(sellable) || variants.find((v) => v.status === "active") || variants[0];
      if (first) setSelected(Object.fromEntries(groups.map((g) => [g.key, optionValue(first, g.key) || ""])));
    } else {
      const stocked = product.flavors?.find((f) => (product.flavor_stock?.[f] ?? 1) > 0);
      setLegacyFlavor(stocked || product.flavors?.[0] || "");
    }
    setImageIdx(0);
    setLegacyImageNum(1);
  }, [product]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = product?.order_multiple || 1;
  const minQty = Math.max(variant?.min_order_qty || 1, 1);
  useEffect(() => {
    setQuantity(allowedQty(1, minQty, step));
  }, [variantKey, minQty, step]);

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 font-medium">Loading Product...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <TriangleAlert className="mx-auto text-red-500 mb-4" size={48} />
          <p className="text-red-600 font-bold">{error}</p>
          <button onClick={() => navigate(-1)} className="mt-4 text-blue-600 underline">Go Back</button>
        </div>
      </div>
    );
  }

  if (!product) return null;

  // Stock limit for what's being added: the chosen variant's stock when the seller tracks stock per variant.
  const limit = product.flavor_stock && variantKey ? product.flavor_stock[variantKey] ?? 0 : product.available;
  const priceSource = variant && variant.price != null ? variant : product;
  const regulated = !!(product as any).compliance_category && (product as any).compliance_category !== "none";

  // gallery: images for the chosen variant first; products without a gallery use the original numbered images
  const gallery = (product.images || []).slice().sort((a, b) => Number(b.variant_key === variantKey && !!variantKey) - Number(a.variant_key === variantKey && !!variantKey));
  const mainImage = gallery.length ? gallery[Math.min(imageIdx, gallery.length - 1)].url : getProductImage(product.id, legacyImageNum);

  // is a value selectable given the other choices?
  const valueState = (g: OptionGroup, value: string) => {
    const matches = variants.filter((v) => optionValue(v, g.key) === value && groups.every((o) => o.key === g.key || !selected[o.key] || optionValue(v, o.key) === selected[o.key]));
    if (!matches.length) return "none";
    if (!matches.some((v) => v.status === "active")) return "discontinued";
    if (!matches.some(sellable)) return "soldout";
    return "ok";
  };
  const choose = (g: OptionGroup, value: string) => {
    const next = { ...selected, [g.key]: value };
    // if that combination doesn't exist, jump to the closest variant that has this value
    if (!variants.some((v) => groups.every((o) => optionValue(v, o.key) === next[o.key]))) {
      const alt = variants.find((v) => optionValue(v, g.key) === value && v.status === "active") || variants.find((v) => optionValue(v, g.key) === value);
      if (alt) {
        setSelected(Object.fromEntries(groups.map((o) => [o.key, optionValue(alt, o.key) || ""])));
        return;
      }
    }
    setSelected(next);
  };

  const unavailableReason =
    usesOptions && !variant ? "This combination isn't sold" : usesOptions && variant && variant.status !== "active" ? `${variant.name} is no longer available` : null;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-blue-600 mb-6 hover:text-blue-800 transition-colors font-medium">
          <ArrowLeft size={18} /> Back to Products
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 grid md:grid-cols-2 gap-12">
          <div>
            <div className="aspect-square bg-gray-50 rounded-xl overflow-hidden border border-gray-100 mb-4">
              <img
                src={mainImage}
                alt={gallery[imageIdx]?.alt_text || product.title}
                onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER_IMAGE; }}
                className="w-full h-full object-cover transition-all duration-500"
              />
            </div>
            <div className="flex gap-3 flex-wrap">
              {gallery.length
                ? gallery.map((img, i) => (
                    <button
                      key={img.id}
                      onClick={() => setImageIdx(i)}
                      className={`w-20 h-20 border-2 rounded-lg overflow-hidden transition-all ${imageIdx === i ? "border-blue-600 scale-105 shadow-md" : "border-gray-100 opacity-70 hover:opacity-100"}`}
                    >
                      <img src={img.url} alt={img.alt_text || `View ${i + 1}`} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
                    </button>
                  ))
                : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                    <button
                      key={num}
                      onClick={() => setLegacyImageNum(num)}
                      className={`w-20 h-20 border-2 rounded-lg overflow-hidden transition-all ${legacyImageNum === num ? "border-blue-600 scale-105 shadow-md" : "border-gray-100 opacity-70 hover:opacity-100"}`}
                    >
                      <img src={getProductImage(product.id, num)} alt={`View ${num}`} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
                    </button>
                  ))}
            </div>
          </div>
          <div className="flex flex-col">
            <div className="mb-6">
              {product.brand_info?.slug ? (
                <Link to={`/brand/${product.brand_info.slug}`} className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2 inline-block hover:underline">{product.brand}</Link>
              ) : (
                <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">{product.brand}</p>
              )}
              <h1 className="text-4xl font-extrabold text-gray-900 mb-2 leading-tight">{product.title}</h1>
              {product.company && (
                <button onClick={() => navigate(`/companies/${product.company!.slug}`)} className="text-sm text-gray-600 mb-3 hover:text-blue-600 hover:underline">
                  Sold by <b>{product.company.name}</b>
                </button>
              )}
              {!!product.category_list?.length && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {product.category_list.map((c) => (
                    <Link key={c.id} to={`/category/${c.slug}`} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full">{c.name}</Link>
                  ))}
                </div>
              )}
              {regulated && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
                  <TriangleAlert className="text-amber-600 shrink-0" size={20} />
                  <p className="text-sm text-amber-900 leading-snug">
                    <strong>Nicotine Warning:</strong> This product contains nicotine. Nicotine is an addictive chemical.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-6 flex-1">
              {product.short_description && <p className="text-gray-800 font-medium">{product.short_description}</p>}
              {product.description && <p className="text-gray-600 leading-relaxed border-l-4 border-gray-100 pl-4 whitespace-pre-line">{product.description}</p>}

              {usesOptions
                ? groups.map((g) => (
                    <div key={g.key}>
                      <h3 className="text-sm font-bold text-gray-900 mb-3 uppercase tracking-wide">
                        {g.name}{selected[g.key] ? <span className="ml-2 normal-case font-semibold text-gray-500">{selected[g.key]}</span> : null}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {g.values.map((value) => {
                          const state = valueState(g, value);
                          const active = selected[g.key] === value;
                          const keyFor = groups.length === 1 ? variants.find((v) => optionValue(v, g.key) === value)?.flavor : undefined;
                          const left = keyFor ? stockOf(keyFor) : undefined;
                          return (
                            <button
                              key={value}
                              onClick={() => choose(g, value)}
                              title={state === "discontinued" ? "No longer available" : state === "soldout" ? "Out of stock" : state === "none" ? "Not sold with the other options you chose" : undefined}
                              className={`px-4 py-2 text-sm font-medium border rounded-lg transition-all ${
                                active
                                  ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100"
                                  : state === "ok"
                                    ? "bg-white border-gray-200 text-gray-600 hover:border-gray-400"
                                    : "bg-gray-50 border-gray-200 text-gray-400 line-through"
                              }`}
                            >
                              {value}
                              {left !== undefined && user && <span className="ml-1 text-xs opacity-75">({left})</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                : product.flavors && product.flavors.length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 mb-3 uppercase tracking-wide">Select Flavor</h3>
                      <div className="flex flex-wrap gap-2">
                        {product.flavors.map((flavor) => {
                          const left = product.flavor_stock?.[flavor];
                          const soldOut = left !== undefined && left <= 0;
                          return (
                            <button
                              key={flavor}
                              onClick={() => setLegacyFlavor(flavor)}
                              className={`px-4 py-2 text-sm font-medium border rounded-lg transition-all ${
                                legacyFlavor === flavor
                                  ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100"
                                  : soldOut ? "bg-gray-50 border-gray-200 text-gray-400 line-through" : "bg-white border-gray-200 text-gray-600 hover:border-gray-400"
                              }`}
                            >
                              {flavor}
                              {left !== undefined && <span className="ml-1 text-xs opacity-75">({left})</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

              {(product.min_order_qty || 1) > 1 || step > 1 || product.pack_size ? (
                <div className="flex gap-2 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <Info size={18} className="text-gray-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    {(product.min_order_qty || 1) > 1 && <p>Minimum order: <b>{product.min_order_qty}</b>{variants.length > 1 ? " (all options together)" : ""}</p>}
                    {step > 1 && <p>Sold in multiples of <b>{step}</b></p>}
                    {product.pack_size ? <p>{product.pack_size} units per {product.unit || "pack"}</p> : null}
                    {variant?.min_order_qty ? <p>Minimum for {variant.name}: <b>{variant.min_order_qty}</b></p> : null}
                  </div>
                </div>
              ) : null}

              {!!product.specifications?.length && (
                <div>
                  <h3 className="text-sm font-bold text-gray-900 mb-2 uppercase tracking-wide">Specifications</h3>
                  <dl className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
                    {product.specifications.filter((s) => s.value).map((s) => (
                      <div key={s.key} className="grid grid-cols-[40%_60%] text-sm">
                        <dt className="bg-gray-50 px-3 py-2 font-semibold text-gray-600">{s.name}</dt>
                        <dd className="px-3 py-2 text-gray-900">{s.value}</dd>
                      </div>
                    ))}
                    {variant?.sku && (
                      <div className="grid grid-cols-[40%_60%] text-sm">
                        <dt className="bg-gray-50 px-3 py-2 font-semibold text-gray-600">SKU</dt>
                        <dd className="px-3 py-2 text-gray-900">{variant.sku}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </div>

            <div className="mt-10 pt-8 border-t border-gray-100">
              {user ? (
                <div className="space-y-6">
                  {priceSource.price != null && (
                    <div className="flex items-baseline justify-between">
                      <span className="font-bold text-gray-900 uppercase text-sm tracking-wide">Wholesale Price{variant ? <span className="ml-2 normal-case font-medium text-gray-500">{variant.name}</span> : null}</span>
                      <span className="text-3xl font-black text-gray-900">
                        {priceSource.list_price != null && priceSource.list_price > Number(priceSource.price) && (
                          <span className="mr-2 text-lg font-medium text-gray-400 line-through">${Number(priceSource.list_price).toFixed(2)}</span>
                        )}
                        ${Number(priceSource.price).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {priceSource.price_tiers && priceSource.price_tiers.length > 0 && (
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-blue-800 mb-2">Your volume prices</p>
                      <div className="flex flex-wrap gap-2">
                        {priceSource.price_tiers.map((t) => (
                          <span
                            key={t.min_quantity}
                            className={`px-3 py-1 rounded-lg text-sm font-bold ${
                              quantity >= t.min_quantity && !priceSource.price_tiers!.some((o) => o.min_quantity > t.min_quantity && quantity >= o.min_quantity)
                                ? "bg-blue-600 text-white"
                                : "bg-white text-blue-900 border border-blue-200"
                            }`}
                          >
                            {t.min_quantity}+ : ${Number(t.price).toFixed(2)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-gray-900 uppercase text-sm tracking-wide">Select Quantity</h3>
                    <div className="flex items-center gap-4 bg-gray-50 p-2 rounded-xl border border-gray-200">
                      <button
                        onClick={() => setQuantity(Math.max(allowedQty(1, minQty, step), quantity - step))}
                        className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors shadow-sm"
                        aria-label="Less"
                      >
                        <Minus size={18} />
                      </button>
                      <span className="text-xl font-black min-w-8 text-center text-gray-900">{quantity}</span>
                      <button
                        onClick={() => setQuantity(limit != null ? Math.min(Math.max(quantity, Math.floor(limit / step) * step), quantity + step) : quantity + step)}
                        className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors shadow-sm"
                        aria-label="More"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>

                  {unavailableReason ? (
                    <div className="w-full text-center bg-gray-100 text-gray-500 py-3 rounded font-semibold">{unavailableReason}</div>
                  ) : product.stock_status === "out_of_stock" || (limit != null && limit <= 0) ? (
                    <div className="w-full text-center bg-gray-100 text-gray-500 py-3 rounded font-semibold">
                      {product.stock_status !== "out_of_stock" && variantKey ? `${variant?.name || variantKey} is out of stock` : "Out of stock"}
                    </div>
                  ) : (
                    <>
                      {limit != null && (
                        <p className={`text-sm font-semibold ${limit <= 10 ? "text-amber-700" : "text-green-700"}`}>
                          {limit} available{variantKey && product.flavor_stock ? ` in ${variant?.name || variantKey}` : ""}
                        </p>
                      )}
                      <AddToCartButton productId={Number(product.id)} quantity={quantity} flavor={variantKey} />
                    </>
                  )}
                </div>
              ) : (
                <div className="bg-gray-900 rounded-2xl p-6 text-white shadow-xl">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-blue-500/20 rounded-lg"><Lock size={20} className="text-blue-400" /></div>
                    <span className="font-bold text-lg">Wholesale Pricing Restricted</span>
                  </div>
                  <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                    Access to pricing and quote requests is restricted to registered wholesale partners. Please sign in to proceed.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => navigate("/login")} className="bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-bold transition-all">Login</button>
                    <button onClick={() => navigate("/register")} className="bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-bold border border-white/10 transition-all">Register</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
