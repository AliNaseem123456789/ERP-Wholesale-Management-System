import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { TriangleAlert, Plus, Minus, Lock, Info, BellRing, Store, Check, GitCompareArrows } from "lucide-react";
import { Crumbs } from "../../marketplace/components";
import { buyingApi, buyingError } from "../../account/api/buying.api";
import { track } from "../../insights/api";
import { useSeo } from "../../insights/seo";
import { ProductImage } from "../components/ProductImage";
import { Notices } from "../../site/widgets";
import { RecentlyViewed } from "../../site/HomeSections";
import { rememberViewed, useCompare, COMPARE_MAX } from "../../site/browserLists";
import { ReviewsSection, RatingBadge, ReportButton, SaleBadge } from "../../insights/components";
import { toast } from "sonner";
import { useProductDetail } from "../hooks/useProductDetails";
import { useAuth } from "../../auth/context/AuthContext";
import { AddToCartButton } from "../components/AddToCartButton";
import { getProductImage } from "../utils/getProductImage";
import { ProductVariant } from "../types/product.types";


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

/** "Notify me when it's back": a back-in-stock alert for the signed-in buyer. */
const NotifyMeButton: React.FC<{ productId: number | string; flavor?: string | null }> = ({ productId, flavor }) => {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  useEffect(() => setState("idle"), [productId, flavor]);
  return (
    <button
      disabled={state !== "idle"}
      onClick={async () => {
        setState("busy");
        try {
          toast.success((await buyingApi.createAlert(productId, flavor)).message);
          setState("done");
        } catch (e) {
          toast.error(buyingError(e));
          setState("idle");
        }
      }}
      className="w-full h-12 flex items-center justify-center gap-2 border border-line-strong bg-surface text-ink rounded-lg font-semibold hover:bg-raised disabled:opacity-60"
    >
      <BellRing size={16} /> {state === "done" ? "We'll email you when it's back" : state === "busy" ? "Saving…" : "Notify me when it's back"}
    </button>
  );
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

  // page title / description, and a product view for the seller's analytics
  useSeo(product ? { title: `${product.title}${product.company ? ` | ${product.company.name}` : ""}`, description: (product as any).short_description || product.description || `${product.title} by ${product.brand}`, image: (product as any).image || null, path: `/product/${(product as any).slug || product.id}` } : null);
  useEffect(() => { if (product?.id) { track({ kind: "product", product_id: product.id }); rememberViewed(product.id); } }, [product?.id]);
  const compare = useCompare();

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-page">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-2 gap-10" aria-busy="true" aria-label="Loading product">
          <div className="aspect-square rounded-2xl bg-raised animate-pulse" />
          <div className="space-y-4">
            <div className="h-4 w-24 rounded bg-raised animate-pulse" />
            <div className="h-10 w-4/5 rounded bg-raised animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-raised animate-pulse" />
            <div className="h-56 rounded-2xl bg-raised animate-pulse mt-8" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-24 min-h-[60vh] flex items-center justify-center bg-page">
        <div className="text-center max-w-sm">
          <span className="mx-auto mb-4 w-12 h-12 rounded-full bg-raised grid place-items-center text-danger"><TriangleAlert size={22} /></span>
          <p className="font-semibold text-ink text-lg">This product couldn't be loaded</p>
          <p className="text-sm text-ink-3 mt-1">{error}</p>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={() => navigate(-1)} className="h-10 px-4 rounded-lg border border-line text-ink font-semibold hover:bg-raised">Go back</button>
            <Link to="/products" className="h-10 px-4 inline-flex items-center rounded-lg bg-brand text-white font-semibold hover:bg-brand-hover">Browse products</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!product) return null;

  // Stock limit for what's being added: the chosen variant's stock when the seller tracks stock per variant.
  const limit = product.flavor_stock && variantKey ? product.flavor_stock[variantKey] ?? 0 : product.available;
  // pre-orders: stock already on order from the seller's suppliers that buyers may reserve
  const incoming = (product as any).allow_preorder ? Number((product as any).incoming_stock?.[variantKey || ""] || 0) : 0;
  const expected = (product as any).expected_date as string | null | undefined;
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

  const unitLabel = product.unit || "unit";
  const basePrice = priceSource.price != null ? Number(priceSource.price) : null;
  const tiers = (priceSource.price_tiers || []).slice().sort((a, b) => a.min_quantity - b.min_quantity);
  const activeTier = tiers.filter((t) => quantity >= t.min_quantity).pop();
  const lineTotal = basePrice != null ? (activeTier ? Number(activeTier.price) : basePrice) * quantity : null;
  const compliance = String((product as any).compliance_category || "");
  const sectionTitle = "font-display text-xl font-extrabold text-ink mb-4";

  return (
    <div className="min-h-screen bg-page">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Crumbs items={[
          { label: "Home", to: "/" },
          ...(product.category_list?.[0] ? [{ label: product.category_list[0].name, to: `/categories/${product.category_list[0].slug}` }] : [{ label: "Products", to: "/products" }]),
          { label: product.title },
        ]} />

        <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-6 lg:gap-10 items-start">
          {/* gallery */}
          <div className="lg:sticky lg:top-24">
            <div className="relative aspect-square bg-surface rounded-2xl overflow-hidden border border-line">
              <ProductImage key={mainImage} src={mainImage} product={product} alt={gallery[imageIdx]?.alt_text || product.title} className="w-full h-full object-cover" />
              {(product as any).sale && <SaleBadge sale={(product as any).sale} className="absolute top-4 left-4 text-sm" />}
            </div>
            <div className="no-scrollbar flex gap-2.5 mt-2 overflow-x-auto p-1 -mx-1">
              {gallery.length
                ? gallery.map((img, i) => (
                    <button
                      key={img.id}
                      onClick={() => setImageIdx(i)}
                      aria-label={`Show picture ${i + 1}`}
                      aria-current={imageIdx === i}
                      className={`w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-surface ring-2 ring-offset-2 ring-offset-page ${imageIdx === i ? "ring-brand" : "ring-transparent opacity-70 hover:opacity-100"}`}
                    >
                      <img src={img.url} alt={img.alt_text || `View ${i + 1}`} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
                    </button>
                  ))
                : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                    <button
                      key={num}
                      onClick={() => setLegacyImageNum(num)}
                      aria-label={`Show picture ${num}`}
                      className={`w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-surface ring-2 ring-offset-2 ring-offset-page ${legacyImageNum === num ? "ring-brand" : "ring-transparent opacity-70 hover:opacity-100"}`}
                    >
                      <img src={getProductImage(product.id, num)} alt={`View ${num}`} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
                    </button>
                  ))}
            </div>
          </div>

          {/* title, options and the buy box */}
          <div className="min-w-0">
            {product.brand_info?.slug ? (
              <Link to={`/brands/${product.brand_info.slug}`} className="text-sm font-semibold text-brand-text hover:underline">{product.brand}</Link>
            ) : (
              <p className="text-sm font-semibold text-brand-text">{product.brand}</p>
            )}
            <h1 className="font-display text-[1.9rem] md:text-[2.4rem] font-extrabold text-ink mt-1 leading-[1.08]">{product.title}</h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-sm">
              {(product as any).rating && <a href="#reviews-title" className="hover:underline"><RatingBadge rating={(product as any).rating} className="text-sm" /></a>}
              {product.company && (
                <button onClick={() => navigate(`/companies/${product.company!.slug}`)} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
                  <Store size={15} className="text-ink-3" /> Sold by <b className="font-semibold text-ink">{product.company.name}</b>
                </button>
              )}
              {variant?.sku && <span className="text-ink-3">SKU <span className="text-ink-2">{variant.sku}</span></span>}
              <button
                type="button"
                onClick={() => { if (!compare.toggle(product.id)) toast.error(`You can compare up to ${COMPARE_MAX} products. Remove one first.`); }}
                aria-pressed={compare.has(product.id)}
                className={`inline-flex items-center gap-1.5 font-medium ${compare.has(product.id) ? "text-brand-text" : "text-ink-2 hover:text-ink"}`}
              >
                {compare.has(product.id) ? <Check size={15} /> : <GitCompareArrows size={15} />} {compare.has(product.id) ? "In compare list" : "Compare"}
              </button>
              {compare.has(product.id) && compare.ids.length > 1 && <Link to="/compare" className="font-semibold text-brand-text hover:underline">Compare {compare.ids.length} products</Link>}
            </div>

            {product.short_description && <p className="mt-4 text-[17px] text-ink-2 leading-relaxed">{product.short_description}</p>}

            {(product as any).sale && (
              <p className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-signal-ink bg-signal/25 rounded-lg px-3 py-1.5">
                {(product as any).sale.percent}% off{(product as any).sale.ends_at ? ` until ${new Date((product as any).sale.ends_at).toLocaleDateString()}` : ""}{!user ? ". Sign in to see your price." : ""}
              </p>
            )}

            {/* options */}
            <div className="mt-6 space-y-5">
              {usesOptions
                ? groups.map((g) => (
                    <div key={g.key}>
                      <p className="text-sm font-semibold text-ink mb-2.5">
                        {g.name}{selected[g.key] ? <span className="ml-2 font-normal text-ink-3">{selected[g.key]}</span> : null}
                      </p>
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
                              aria-pressed={active}
                              title={state === "discontinued" ? "No longer available" : state === "soldout" ? "Out of stock" : state === "none" ? "Not sold with the other options you chose" : undefined}
                              className={`h-10 px-4 text-sm font-medium rounded-lg border ${
                                active
                                  ? "bg-brand-soft border-brand text-ink ring-1 ring-brand"
                                  : state === "ok"
                                    ? "bg-surface border-line text-ink-2 hover:border-ink-3 hover:text-ink"
                                    : "bg-raised border-line text-ink-3 line-through decoration-ink-3/60"
                              }`}
                            >
                              {value}
                              {left !== undefined && user && <span className="ml-1.5 text-xs text-ink-3 no-underline">{left}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                : product.flavors && product.flavors.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-ink mb-2.5">Flavour{legacyFlavor ? <span className="ml-2 font-normal text-ink-3">{legacyFlavor}</span> : null}</p>
                      <div className="flex flex-wrap gap-2">
                        {product.flavors.map((flavor) => {
                          const left = product.flavor_stock?.[flavor];
                          const soldOut = left !== undefined && left <= 0;
                          return (
                            <button
                              key={flavor}
                              onClick={() => setLegacyFlavor(flavor)}
                              aria-pressed={legacyFlavor === flavor}
                              className={`h-10 px-4 text-sm font-medium rounded-lg border ${
                                legacyFlavor === flavor
                                  ? "bg-brand-soft border-brand text-ink ring-1 ring-brand"
                                  : soldOut ? "bg-raised border-line text-ink-3 line-through decoration-ink-3/60" : "bg-surface border-line text-ink-2 hover:border-ink-3 hover:text-ink"
                              }`}
                            >
                              {flavor}
                              {left !== undefined && <span className="ml-1.5 text-xs text-ink-3">{left}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
            </div>

            {/* buy box */}
            <div className="mt-6 bg-surface border border-line rounded-2xl overflow-hidden">
              {(product.min_order_qty || 1) > 1 || step > 1 || product.pack_size ? (
                <div className="flex flex-wrap gap-x-6 gap-y-1.5 px-5 py-3 bg-raised border-b border-line text-sm text-ink-2">
                  <Info size={16} className="text-ink-3 mt-0.5 -mr-4" />
                  {product.pack_size ? <span><b className="font-semibold text-ink">{product.pack_size}</b> units per {product.unit || "pack"}</span> : null}
                  {(product.min_order_qty || 1) > 1 && <span>Minimum order <b className="font-semibold text-ink">{product.min_order_qty}</b>{variants.length > 1 ? " (all options together)" : ""}</span>}
                  {step > 1 && <span>Sold in multiples of <b className="font-semibold text-ink">{step}</b></span>}
                  {variant?.min_order_qty ? <span>Minimum for {variant.name} <b className="font-semibold text-ink">{variant.min_order_qty}</b></span> : null}
                </div>
              ) : null}

              <div className="p-5 md:p-6">
                {user ? (
                  <div className="space-y-5">
                    {basePrice != null && (
                      <div className="flex items-end justify-between gap-4">
                        <div>
                          <p className="text-sm text-ink-3">Your price{variant ? ` · ${variant.name}` : ""}</p>
                          <p className="flex items-baseline gap-2 mt-0.5">
                            <span className="font-display text-[2.4rem] leading-none font-extrabold text-ink">${basePrice.toFixed(2)}</span>
                            <span className="text-ink-3">/ {unitLabel}</span>
                            {priceSource.list_price != null && priceSource.list_price > basePrice && (
                              <span className="text-ink-3 line-through">${Number(priceSource.list_price).toFixed(2)}</span>
                            )}
                          </p>
                        </div>
                      </div>
                    )}

                    {tiers.length > 0 && basePrice != null && (
                      <div className="rounded-xl border border-line overflow-hidden">
                        <table className="w-full text-sm">
                          <caption className="sr-only">Volume prices</caption>
                          <thead className="bg-raised text-ink-3">
                            <tr><th className="text-left font-medium px-4 py-2">Quantity</th><th className="text-right font-medium px-4 py-2">Price per {unitLabel}</th><th className="text-right font-medium px-4 py-2">You save</th></tr>
                          </thead>
                          <tbody>
                            {tiers.map((t) => {
                              const on = activeTier?.min_quantity === t.min_quantity;
                              const save = basePrice > 0 ? Math.round((1 - Number(t.price) / basePrice) * 100) : 0;
                              return (
                                <tr key={t.min_quantity} className={`border-t border-line ${on ? "bg-brand-soft" : ""}`}>
                                  <td className="px-4 py-2.5 text-ink font-medium">{on && <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand mr-2 align-middle" />}{t.min_quantity}+</td>
                                  <td className="px-4 py-2.5 text-right font-semibold text-ink">${Number(t.price).toFixed(2)}</td>
                                  <td className={`px-4 py-2.5 text-right ${save > 0 ? "text-success font-medium" : "text-ink-3"}`}>{save > 0 ? `${save}%` : "–"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="inline-flex items-center rounded-xl border border-line bg-raised p-1">
                        <button
                          onClick={() => setQuantity(Math.max(allowedQty(1, minQty, step), quantity - step))}
                          className="w-11 h-11 grid place-items-center rounded-lg text-ink hover:bg-surface"
                          aria-label="Less"
                        >
                          <Minus size={18} />
                        </button>
                        <span className="min-w-14 text-center font-display text-xl font-bold text-ink" aria-live="polite">{quantity}</span>
                        <button
                          onClick={() => { const cap = limit != null ? Math.max(0, limit) + incoming : null; setQuantity(cap != null ? Math.min(Math.max(quantity, Math.floor(cap / step) * step), quantity + step) : quantity + step); }}
                          className="w-11 h-11 grid place-items-center rounded-lg text-ink hover:bg-surface"
                          aria-label="More"
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                      {lineTotal != null && (
                        <p className="text-right">
                          <span className="block text-sm text-ink-3">Line total</span>
                          <span className="font-display text-2xl font-extrabold text-ink">${lineTotal.toFixed(2)}</span>
                        </p>
                      )}
                    </div>

                    {unavailableReason ? (
                      <div className="w-full text-center bg-raised text-ink-3 py-3 rounded-lg font-semibold">{unavailableReason}</div>
                    ) : (product.stock_status === "out_of_stock" || (limit != null && limit <= 0)) && incoming <= 0 ? (
                      <div className="space-y-2">
                        <div className="w-full text-center bg-raised text-ink-2 py-3 rounded-lg font-semibold">
                          {product.stock_status !== "out_of_stock" && variantKey ? `${variant?.name || variantKey} is out of stock` : "Out of stock"}
                        </div>
                        <NotifyMeButton productId={product.id} flavor={variantKey} />
                      </div>
                    ) : (
                      <>
                        {limit != null && limit > 0 && (
                          <p className={`flex items-center gap-2 text-sm font-medium ${limit <= 10 ? "text-amber-700" : "text-success"}`}>
                            <span className={`w-2 h-2 rounded-full ${limit <= 10 ? "bg-amber-500" : "bg-success"}`} />
                            {limit.toLocaleString()} available{variantKey && product.flavor_stock ? ` in ${variant?.name || variantKey}` : ""}
                            {incoming > 0 && <span className="text-brand-text">, {incoming} more arriving{expected ? ` around ${new Date(expected).toLocaleDateString()}` : ""}</span>}
                          </p>
                        )}
                        {(limit == null || limit <= 0) && incoming > 0 && (
                          <p className="text-sm font-medium text-brand-text bg-brand-soft rounded-lg px-3 py-2">
                            Pre-order: {incoming} on the way{expected ? `, expected around ${new Date(expected).toLocaleDateString()}` : ""}. Your order ships when it arrives.
                          </p>
                        )}
                        <AddToCartButton productId={Number(product.id)} quantity={quantity} flavor={variantKey} />
                      </>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-start gap-3">
                      <span className="w-10 h-10 rounded-lg bg-brand-soft text-brand-text grid place-items-center shrink-0"><Lock size={18} /></span>
                      <div>
                        <p className="font-semibold text-ink text-lg">Sign in to see trade prices</p>
                        <p className="text-sm text-ink-2 mt-1 leading-relaxed">Prices, volume tiers and stock levels are shown to approved business accounts.</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-5">
                      <button onClick={() => navigate("/login")} className="h-12 rounded-lg bg-brand text-white font-semibold hover:bg-brand-hover">Sign in</button>
                      <button onClick={() => navigate("/register")} className="h-12 rounded-lg border border-line-strong text-ink font-semibold hover:bg-raised">Open an account</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {regulated && (
              <div className="mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <TriangleAlert className="text-amber-600 shrink-0 mt-0.5" size={18} />
                <p className="text-sm text-amber-900 leading-snug">
                  {/nicotine|vape|tobacco/i.test(compliance)
                    ? <><b className="font-semibold">Contains nicotine.</b> Nicotine is an addictive chemical. Not for sale to minors.</>
                    : <><b className="font-semibold">Age-restricted product.</b> Sold only to licensed businesses.</>}
                </p>
              </div>
            )}
            <Notices productIds={[product.id]} where="product" className="mt-4" />
          </div>
        </div>

        {/* details */}
        {(product.description || product.specifications?.length || product.category_list?.length) ? (
          <div className="mt-12 grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-6">
            {product.description ? (
              <section className="bg-surface border border-line rounded-2xl p-6 md:p-8">
                <h2 className={sectionTitle}>About this product</h2>
                <p className="text-ink-2 leading-relaxed whitespace-pre-line max-w-[70ch]">{product.description}</p>
                {!!product.category_list?.length && (
                  <div className="flex flex-wrap gap-2 mt-6">
                    {product.category_list.map((c) => (
                      <Link key={c.id} to={`/categories/${c.slug}`} className="text-sm bg-raised border border-line hover:border-line-strong text-ink-2 px-3 py-1 rounded-full">{c.name}</Link>
                    ))}
                  </div>
                )}
              </section>
            ) : <div />}
            {(!!product.specifications?.length || variant?.sku) && (
              <section className="bg-surface border border-line rounded-2xl p-6 md:p-8 self-start">
                <h2 className={sectionTitle}>Specifications</h2>
                <dl className="divide-y divide-line text-sm">
                  {(product.specifications || []).filter((s) => s.value).map((s) => (
                    <div key={s.key} className="flex justify-between gap-4 py-2.5">
                      <dt className="text-ink-3">{s.name}</dt>
                      <dd className="text-ink font-medium text-right">{s.value}{s.unit ? ` ${s.unit}` : ""}</dd>
                    </div>
                  ))}
                  {variant?.sku && (
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-ink-3">SKU</dt>
                      <dd className="text-ink font-medium text-right">{variant.sku}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}
          </div>
        ) : null}

        <div className="mt-12 space-y-3">
          <ReviewsSection productId={product.id} companyName={product.company?.name} title="Customer reviews" />
          <div className="text-right"><ReportButton target={{ kind: "listing", product_id: product.id }} label="Report this listing" /></div>
        </div>
        <div className="mt-12"><RecentlyViewed exclude={product.id} /></div>
      </div>
    </div>
  );
};
