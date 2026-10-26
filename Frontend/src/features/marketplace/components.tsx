// Shared marketplace building blocks: product grid with filters, pagination, company and brand cards.
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, SlidersHorizontal, X, Search, Loader2, MapPin, PackageSearch } from "lucide-react";
import { RatingBadge } from "../insights/components";
import { track } from "../insights/api";
import ProductCard from "../products/components/ProductCard";
import { Product } from "../products/types/product.types";
import { SearchResult, SORT_LABELS, CompanyCardT, Facets } from "./api";

export const PageShell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`min-h-screen bg-gray-50 ${className}`}>
    <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">{children}</div>
  </div>
);

export const Crumbs: React.FC<{ items: { label: string; to?: string }[] }> = ({ items }) => (
  <nav aria-label="Breadcrumb" className="text-xs text-gray-500 mb-3 flex flex-wrap items-center gap-1">
    {items.map((c, i) => (
      <React.Fragment key={i}>
        {i > 0 && <span className="text-gray-300">/</span>}
        {c.to ? <Link to={c.to} className="hover:text-blue-600 hover:underline">{c.label}</Link> : <span className="text-gray-700 font-semibold">{c.label}</span>}
      </React.Fragment>
    ))}
  </nav>
);

export const Loading: React.FC<{ label?: string }> = ({ label = "Loading…" }) => (
  <div className="flex items-center justify-center gap-2 py-20 text-gray-500"><Loader2 className="animate-spin text-blue-600" size={22} /> {label}</div>
);

export const Empty: React.FC<{ title: string; text?: string; action?: React.ReactNode }> = ({ title, text, action }) => (
  <div className="bg-white rounded-2xl border border-gray-200 py-16 px-6 text-center">
    <PackageSearch className="mx-auto text-gray-300 mb-3" size={40} />
    <p className="font-bold text-gray-900">{title}</p>
    {text && <p className="text-sm text-gray-500 mt-1">{text}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ProductGrid: React.FC<{ products: Product[]; cols?: string }> = ({ products, cols = "grid-cols-2 md:grid-cols-3 lg:grid-cols-4" }) => (
  <div className={`grid ${cols} gap-3 sm:gap-4`}>
    {products.map((p) => <ProductCard key={p.id} product={p} />)}
  </div>
);

export const Pager: React.FC<{ page: number; pages: number; onChange: (p: number) => void }> = ({ page, pages, onChange }) =>
  pages > 1 ? (
    <div className="flex items-center justify-center gap-3 mt-8">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="p-2 rounded-lg bg-white border border-gray-200 disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={18} /></button>
      <span className="text-sm text-gray-600">Page <b>{page}</b> of {pages}</span>
      <button disabled={page >= pages} onClick={() => onChange(page + 1)} className="p-2 rounded-lg bg-white border border-gray-200 disabled:opacity-30" aria-label="Next page"><ChevronRight size={18} /></button>
    </div>
  ) : null;

const FacetGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border-b border-gray-100 pb-4 mb-4 last:border-0">
    <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">{title}</p>
    <div className="space-y-1 max-h-64 overflow-y-auto pr-1">{children}</div>
  </div>
);

const Check: React.FC<{ checked: boolean; onChange: () => void; label: string; count?: number }> = ({ checked, onChange, label, count }) => (
  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-gray-900">
    <input type="checkbox" checked={checked} onChange={onChange} className="rounded" />
    <span className="flex-1 truncate">{label}</span>
    {count !== undefined && <span className="text-xs text-gray-400">{count}</span>}
  </label>
);

const listOf = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

/** Filters for the current results: categories (links), brands, sellers, details, stock. URL-driven. */
const FacetPanel: React.FC<{ facets: Facets; hide: string[]; params: URLSearchParams; set: (k: string, v: string | null) => void; categoryLink: (slug: string) => string }> = ({ facets, hide, params, set, categoryLink }) => {
  const toggle = (key: string, value: string) => {
    const cur = listOf(params.get(key));
    const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    set(key, next.length ? next.join(",") : null);
  };
  return (
    <div>
      {!hide.includes("category") && facets.categories.length > 0 && (
        <FacetGroup title="Category">
          {facets.categories.map((c) => (
            <Link key={c.id} to={categoryLink(c.slug)} className="flex justify-between text-sm text-gray-700 hover:text-blue-600 py-0.5">
              <span className="truncate">{c.name}</span><span className="text-xs text-gray-400">{c.count}</span>
            </Link>
          ))}
        </FacetGroup>
      )}
      {!hide.includes("brand") && facets.brands.length > 0 && (
        <FacetGroup title="Brand">
          {facets.brands.map((b) => <Check key={b.slug} label={b.name} count={b.count} checked={listOf(params.get("brand")).includes(b.slug)} onChange={() => toggle("brand", b.slug)} />)}
        </FacetGroup>
      )}
      {!hide.includes("company") && facets.companies.length > 1 && (
        <FacetGroup title="Seller">
          {facets.companies.map((c) => <Check key={c.slug} label={c.name} count={c.count} checked={listOf(params.get("company")).includes(c.slug)} onChange={() => toggle("company", c.slug)} />)}
        </FacetGroup>
      )}
      {facets.attributes.map((a) => (
        <FacetGroup key={a.key} title={a.name}>
          {a.values.map((v) => <Check key={v.value} label={v.value} count={v.count} checked={listOf(params.get(`attr_${a.key}`)).includes(v.value)} onChange={() => toggle(`attr_${a.key}`, v.value)} />)}
        </FacetGroup>
      ))}
      <FacetGroup title="Availability">
        <Check label="In stock" checked={params.get("in_stock") === "1"} onChange={() => set("in_stock", params.get("in_stock") === "1" ? null : "1")} />
        <Check label="Featured" checked={params.get("featured") === "1"} onChange={() => set("featured", params.get("featured") === "1" ? null : "1")} />
        <Check label="On offer (sales & volume prices)" checked={params.get("deals") === "1"} onChange={() => set("deals", params.get("deals") === "1" ? null : "1")} />
      </FacetGroup>
    </div>
  );
};

/**
 * Search box + filters + sort + grid + pagination, kept in the address bar so results can be shared.
 * fetcher gets the filter params; hide lists facets that are fixed by the page (e.g. the brand on a brand page).
 */
export const CatalogBrowser: React.FC<{
  fetcher: (params: Record<string, string>) => Promise<SearchResult>;
  hide?: string[];
  categoryLink?: (slug: string) => string;
  placeholder?: string;
  onResult?: (r: SearchResult) => void;
  deps?: unknown[];
}> = ({ fetcher, hide = [], categoryLink = (s) => `/categories/${s}`, placeholder = "Search products, brands, SKUs…", onResult, deps = [] }) => {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(params.get("q") || "");
  const [showFilters, setShowFilters] = useState(false);
  const key = params.toString();

  useEffect(() => {
    let live = true;
    setBusy(true);
    setError(null);
    const p: Record<string, string> = {};
    params.forEach((v, k) => { if (k !== "tab") p[k] = v; });
    fetcher({ limit: "24", ...p })
      .then((r) => {
        if (!live) return;
        setResult(r);
        onResult?.(r);
        // searches count for the sellers whose products came up (first page only)
        if (p.q && (!p.page || p.page === "1") && r.data.length) track({ kind: "search", query: p.q, product_ids: r.data.map((x) => x.id) });
      })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [key, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setQ(params.get("q") || ""), [params]);

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null || v === "") next.delete(k); else next.set(k, v);
    if (k !== "page") next.delete("page");
    setParams(next, { replace: k === "page" ? false : true });
  };
  const active = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    params.forEach((v, k) => {
      if (["q", "sort", "page", "tab", "limit"].includes(k)) return;
      if (k === "in_stock") out.push({ key: k, label: "In stock" });
      else if (k === "featured") out.push({ key: k, label: "Featured" });
      else if (k === "deals") out.push({ key: k, label: "On offer" });
      else out.push({ key: k, label: v.split(",").join(", ") });
    });
    return out;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const panel = result?.facets ? <FacetPanel facets={result.facets} hide={hide} params={params} set={set} categoryLink={categoryLink} /> : null;

  return (
    <div>
      {/* on phones the search / filter / sort bar stays at the top while scrolling */}
      <div className="flex flex-wrap gap-2 items-center mb-4 sticky top-14 z-30 -mx-4 px-4 py-2 bg-gray-50/95 backdrop-blur md:static md:mx-0 md:px-0 md:py-0 md:bg-transparent md:backdrop-blur-none">
        <form onSubmit={(e) => { e.preventDefault(); set("q", q.trim() || null); }} className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </form>
        <button onClick={() => setShowFilters(true)} className="lg:hidden inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700">
          <SlidersHorizontal size={16} /> Filters{active.length ? ` (${active.length})` : ""}
        </button>
        <select value={params.get("sort") || "relevance"} onChange={(e) => set("sort", e.target.value === "relevance" ? null : e.target.value)} aria-label="Sort"
          className="px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-700">
          {(result?.sorts || ["relevance", "newest", "title", "featured"]).map((s) => <option key={s} value={s}>{SORT_LABELS[s] || s}</option>)}
        </select>
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {active.map((a) => (
            <button key={a.key} onClick={() => set(a.key, null)} className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 border border-blue-100 rounded-full px-3 py-1 text-xs font-semibold">
              {a.label} <X size={12} />
            </button>
          ))}
          <button onClick={() => { const n = new URLSearchParams(); if (params.get("q")) n.set("q", params.get("q")!); setParams(n); }} className="text-xs text-gray-500 hover:underline">Clear all</button>
        </div>
      )}

      <div className="grid lg:grid-cols-[230px_1fr] gap-6">
        <aside className="hidden lg:block">
          <div className="bg-white rounded-2xl border border-gray-200 p-4 sticky top-32 max-h-[calc(100vh-9rem)] overflow-y-auto overscroll-contain">{panel || <p className="text-sm text-gray-400">…</p>}</div>
        </aside>
        <div>
          {error ? <Empty title="Couldn't load products" text={error} /> : !result ? <Loading /> : (
            <>
              <p className={`text-sm text-gray-500 mb-3 ${busy ? "opacity-50" : ""}`}>{result.total} product{result.total === 1 ? "" : "s"}</p>
              {result.data.length === 0 ? (
                <Empty title="No products match" text="Try fewer filters or another search." />
              ) : (
                <div className={busy ? "opacity-60 transition-opacity" : ""}><ProductGrid products={result.data} /></div>
              )}
              <Pager page={result.page} pages={result.pages} onChange={(p) => { set("page", String(p)); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
            </>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="fixed inset-0 z-[90] bg-black/40 lg:hidden" onClick={() => setShowFilters(false)}>
          <div className="absolute right-0 top-0 bottom-0 w-80 max-w-[85%] bg-white p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4"><p className="font-bold text-gray-900">Filters</p><button onClick={() => setShowFilters(false)} aria-label="Close"><X size={20} /></button></div>
            {panel}
          </div>
        </div>
      )}
    </div>
  );
};

export const CompanyCard: React.FC<{ c: CompanyCardT }> = ({ c }) => {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(`/companies/${c.slug}`)} className="text-left bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      <div className="h-20 bg-gradient-to-r from-slate-800 to-slate-600 relative">
        {c.banner_url && <img src={c.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      </div>
      <div className="p-4 pt-0 flex-1 flex flex-col">
        <div className="-mt-7 mb-2 w-14 h-14 rounded-xl bg-white border border-gray-200 shadow-sm flex items-center justify-center overflow-hidden relative">
          {c.logo_url ? <img src={c.logo_url} alt="" className="w-full h-full object-contain" /> : <span className="text-xl font-black text-gray-400">{c.name[0]}</span>}
        </div>
        <p className="font-bold text-gray-900">{c.name}{c.is_featured && <span className="ml-2 text-[10px] uppercase bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">Featured</span>}</p>
        {c.tagline && <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{c.tagline}</p>}
        {(c.city || c.state) && <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><MapPin size={11} /> {[c.city, c.state].filter(Boolean).join(", ")}</p>}
        <div className="flex flex-wrap gap-1 mt-2">
          {(c.top_categories || []).map((t) => <span key={t.slug} className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{t.name}</span>)}
        </div>
        <p className="text-xs text-gray-500 mt-auto pt-3 flex flex-wrap items-center gap-x-2">{c.product_count ?? 0} products{c.brand_count ? ` · ${c.brand_count} brands` : ""}<RatingBadge rating={c.rating} /></p>
      </div>
    </button>
  );
};

export const BrandTile: React.FC<{ b: { name: string; slug: string; logo_url?: string | null; product_count?: number; relationship?: string } }> = ({ b }) => (
  <Link to={`/brands/${b.slug}`} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3 hover:shadow-md transition-shadow min-w-0">
    <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
      {b.logo_url ? <img src={b.logo_url} alt="" className="w-full h-full object-contain" /> : <span className="font-black text-gray-400">{b.name[0]}</span>}
    </div>
    <div className="min-w-0">
      <p className="font-semibold text-sm text-gray-900 truncate">{b.name}</p>
      {b.product_count !== undefined && <p className="text-xs text-gray-400">{b.product_count} products</p>}
      {b.relationship && b.relationship !== "reseller" && <p className="text-[10px] text-blue-700 font-bold uppercase">{b.relationship.replace(/_/g, " ")}</p>}
    </div>
  </Link>
);

export const CategoryTile: React.FC<{ c: { name: string; slug: string; image_url?: string | null; product_count?: number } }> = ({ c }) => (
  <Link to={`/categories/${c.slug}`} className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
    <div className="aspect-[4/3] bg-gradient-to-br from-blue-50 to-gray-100 flex items-center justify-center overflow-hidden">
      {c.image_url ? <img src={c.image_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" /> : <span className="text-3xl font-black text-blue-200">{c.name[0]}</span>}
    </div>
    <div className="p-2.5">
      <p className="font-semibold text-sm text-gray-900 line-clamp-1">{c.name}</p>
      {c.product_count !== undefined && <p className="text-xs text-gray-400">{c.product_count} products</p>}
    </div>
  </Link>
);

export const SectionTitle: React.FC<{ title: string; subtitle?: string; to?: string; linkLabel?: string; onDark?: boolean }> = ({ title, subtitle, to, linkLabel = "See all", onDark }) => (
  <div className="flex items-end justify-between gap-4 mb-4">
    <div>
      <h2 className={`text-2xl font-black ${onDark ? "text-gray-900 dark:text-white" : "text-gray-900"}`}>{title}</h2>
      {subtitle && <p className={`text-sm mt-0.5 ${onDark ? "text-gray-500 dark:text-gray-400" : "text-gray-500"}`}>{subtitle}</p>}
    </div>
    {to && <Link to={to} className="text-sm font-bold text-blue-600 hover:underline shrink-0">{linkLabel} →</Link>}
  </div>
);
