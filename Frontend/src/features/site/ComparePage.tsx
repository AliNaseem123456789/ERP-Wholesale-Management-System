// /compare: up to four products side by side (picked with "Compare" on product cards and pages; kept in this browser).
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { X, GitCompareArrows } from "lucide-react";
import type { Product } from "../products/types/product.types";
import { getProductById } from "../products/api/productApi";
import { useAuth } from "../auth/context/AuthContext";
import { ProductImage } from "../products/components/ProductImage";
import { AddToCartButton } from "../products/components/AddToCartButton";
import { useCompare } from "./browserLists";
import { PageShell, Crumbs, Loading, Empty } from "../marketplace/components";
import { useSeo } from "../insights/seo";

const money = (n?: number | null) => (n === null || n === undefined ? "—" : `$${Number(n).toFixed(2)}`);

export const ComparePage: React.FC = () => {
  const { ids, remove, clear } = useCompare();
  const { user } = useAuth();
  const [products, setProducts] = useState<(Product & { _missing?: boolean })[] | null>(null);
  const key = ids.join(",");
  useSeo({ title: "Compare products", noindex: true });

  useEffect(() => {
    let live = true;
    Promise.all(ids.map((id) => getProductById(id).catch(() => ({ id: Number(id), title: "No longer available", _missing: true } as any))))
      .then((rows) => live && setProducts(rows));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // one row per specification that any of the products has
  const specRows = useMemo(() => {
    const names = new Map<string, string>();
    (products || []).forEach((p) => (p.specifications || []).forEach((s) => s.value && names.set(s.key, s.name)));
    return [...names.entries()];
  }, [products]);

  if (!ids.length) {
    return (
      <PageShell>
        <Crumbs items={[{ label: "Home", to: "/" }, { label: "Compare" }]} />
        <Empty title="Nothing to compare yet" text="Use “Compare” on up to four products, then come back here." action={<Link to="/products" className="text-blue-600 font-bold">Browse products</Link>} />
      </PageShell>
    );
  }
  if (!products) return <PageShell><Loading /></PageShell>;

  const live = products.filter((p) => !p._missing);
  const row = (label: string, cell: (p: Product) => React.ReactNode, show = true, key: string = label) =>
    show ? (
      <tr key={key}>
        <th scope="row" className="text-left align-top px-3 py-2.5 text-xs font-bold uppercase text-gray-500 bg-gray-50 sticky left-0 w-40">{label}</th>
        {products.map((p) => <td key={p.id} className="px-3 py-2.5 align-top text-sm text-gray-900">{p._missing ? "" : cell(p)}</td>)}
      </tr>
    ) : null;

  return (
    <PageShell>
      <Crumbs items={[{ label: "Home", to: "/" }, { label: "Compare" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-3xl font-black text-gray-900 flex items-center gap-2"><GitCompareArrows /> Compare products</h1>
        <button onClick={clear} className="text-sm font-semibold text-gray-500 hover:underline">Clear all</button>
      </div>
      <div className="overflow-x-auto bg-white border border-gray-200 rounded-2xl">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white w-40" />
              {products.map((p) => (
                <th key={p.id} className="px-3 pt-4 pb-3 align-top text-left font-normal w-[22%]">
                  <div className="relative">
                    <button onClick={() => remove(p.id)} aria-label={`Remove ${p.title}`} className="absolute -top-1 -right-1 z-10 w-7 h-7 rounded-full bg-white border border-gray-200 shadow flex items-center justify-center text-gray-500 hover:text-red-600"><X size={14} /></button>
                    <Link to={p._missing ? "#" : `/product/${p.slug || p.id}`} className="block aspect-square rounded-xl overflow-hidden bg-gray-50"><ProductImage product={p} /></Link>
                    <Link to={p._missing ? "#" : `/product/${p.slug || p.id}`} className="block mt-2 font-bold text-gray-900 hover:text-blue-600 line-clamp-2">{p.title}</Link>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {row("Price", (p) => (user ? <span className="font-black">{money(p.price as any)}{p.list_price && Number(p.list_price) > Number(p.price) ? <span className="ml-1 text-xs text-gray-400 line-through">{money(p.list_price)}</span> : null}</span> : <Link to="/login" className="text-blue-600 font-semibold">Log in to see prices</Link>))}
            {row("Offer", (p) => (p.sale ? `${p.sale.percent}% off${p.sale.label ? ` · ${p.sale.label}` : ""}` : "—"), live.some((p) => p.sale))}
            {row("Volume prices", (p) => (p.price_tiers?.length ? p.price_tiers.map((t) => <span key={t.min_quantity} className="block">{t.min_quantity}+ : {money(t.price)}</span>) : "—"), !!user && live.some((p) => p.price_tiers?.length))}
            {row("Brand", (p) => p.brand || "—")}
            {row("Sold by", (p) => (p.company ? <Link to={`/companies/${p.company.slug}`} className="text-blue-600 hover:underline">{p.company.name}</Link> : "—"))}
            {row("Category", (p) => p.category_list?.map((c) => c.name).join(", ") || "—")}
            {row("Rating", (p) => (p.rating?.count ? `${p.rating.average} ★ (${p.rating.count})` : "No reviews yet"))}
            {row("Availability", (p) => (p.stock_status === "out_of_stock" ? "Out of stock" : p.stock_status === "preorder" ? "Pre-order" : user && p.available != null ? `${p.available} available` : "In stock"))}
            {row("Minimum order", (p) => (p.min_order_qty && p.min_order_qty > 1 ? `${p.min_order_qty}` : "—"), live.some((p) => (p.min_order_qty || 1) > 1))}
            {row("Sold in multiples of", (p) => (p.order_multiple && p.order_multiple > 1 ? `${p.order_multiple}` : "—"), live.some((p) => (p.order_multiple || 1) > 1))}
            {row("Pack size", (p) => (p.pack_size ? `${p.pack_size} per ${p.unit || "pack"}` : "—"), live.some((p) => p.pack_size))}
            {row("Options", (p) => (p.variants?.length ? `${p.variants.length} options` : p.flavors?.length ? `${p.flavors.length} flavours` : "—"), live.some((p) => p.variants?.length || p.flavors?.length))}
            {specRows.map(([k, name]) => row(name, (p) => { const s = (p.specifications || []).find((x) => x.key === k); return s?.value ? `${s.value}${s.unit ? ` ${s.unit}` : ""}` : "—"; }, true, `spec-${k}`))}
            {user && row("", (p) => (p.variants?.length || p.flavors?.length ? <Link to={`/product/${p.slug || p.id}`} className="inline-block px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold">Choose options</Link> : <AddToCartButton productId={Number(p.id)} quantity={Math.max(1, p.min_order_qty || 1)} />))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
};
