// Shared marketplace building blocks: product grid with filters, pagination, company and brand cards.
import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, SlidersHorizontal, X, Search, Loader2, MapPin, PackageSearch, BadgeCheck } from "lucide-react";
import { track } from "../insights/api";
import ProductCard from "../products/components/ProductCard";
import { Product } from "../products/types/product.types";
import { SearchResult, SORT_LABELS, CompanyCardT, Facets } from "./api";

export const PageShell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`min-h-screen bg-page ${className}`}>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</div>
  </div>
);

export const Crumbs: React.FC<{ items: { label: string; to?: string }[] }> = ({ items }) => (
  <nav aria-label="Breadcrumb" className="text-[13px] text-ink-3 mb-4 flex flex-wrap items-center gap-1.5">
    {items.map((c, i) => (
      <React.Fragment key={i}>
        {i > 0 && <ChevronRight size={13} className="text-ink-3/60" aria-hidden="true" />}
        {c.to ? <Link to={c.to} className="hover:text-ink">{c.label}</Link> : <span className="text-ink font-medium" aria-current="page">{c.label}</span>}
      </React.Fragment>
    ))}
  </nav>
);

export const Loading: React.FC<{ label?: string }> = ({ label = "Loading…" }) => (
  <div className="flex items-center justify-center gap-2 py-20 text-ink-3"><Loader2 className="animate-spin text-brand" size={20} /> {label}</div>
);

export const Empty: React.FC<{ title: string; text?: string; action?: React.ReactNode }> = ({ title, text, action }) => (
  <div className="bg-surface rounded-xl border border-dashed border-line-strong py-16 px-6 text-center">
    <span className="mx-auto mb-4 w-12 h-12 rounded-full bg-raised grid place-items-center text-ink-3"><PackageSearch size={22} /></span>
    <p className="font-semibold text-ink">{title}</p>
    {text && <p className="text-sm text-ink-3 mt-1">{text}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ProductGrid: React.FC<{ products: Product[]; cols?: string }> = ({ products, cols = "grid-cols-2 md:grid-cols-3 xl:grid-cols-4" }) => (
  <div className={`grid ${cols} gap-3 sm:gap-4`}>
    {products.map((p) => <ProductCard key={p.id} product={p} />)}
  </div>
);

const pageList = (page: number, pages: number): (number | "…")[] => {
  const out: (number | "…")[] = [];
  const add = (x: number | "…") => out[out.length - 1] !== x && out.push(x);
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) add(p);
    else add("…");
  }
  return out;
};

export const Pager: React.FC<{ page: number; pages: number; onChange: (p: number) => void }> = ({ page, pages, onChange }) =>
  pages > 1 ? (
    <nav className="flex items-center justify-center gap-1 mt-10" aria-label="Pages">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="h-10 px-3 inline-flex items-center gap-1 rounded-lg text-sm font-medium text-ink-2 hover:bg-surface hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent" aria-label="Previous page"><ChevronLeft size={17} /><span className="hidden sm:inline">Previous</span></button>
      {pageList(page, pages).map((p, i) =>
        p === "…" ? <span key={`e${i}`} className="w-8 text-center text-ink-3">…</span> : (
          <button key={p} onClick={() => onChange(p)} aria-current={p === page ? "page" : undefined}
            className={`min-w-10 h-10 px-2 rounded-lg text-sm font-semibold ${p === page ? "bg-solid text-white" : "text-ink-2 hover:bg-surface hover:text-ink"} ${Math.abs(p - page) > 1 && p !== 1 && p !== pages ? "hidden sm:block" : ""}`}>{p}</button>
        ))}
      <button disabled={page >= pages} onClick={() => onChange(page + 1)} className="h-10 px-3 inline-flex items-center gap-1 rounded-lg text-sm font-medium text-ink-2 hover:bg-surface hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent" aria-label="Next page"><span className="hidden sm:inline">Next</span><ChevronRight size={17} /></button>
    </nav>
  ) : null;

const FacetGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border-b border-line pb-4 mb-4 last:border-0 last:mb-0 last:pb-0">
    <p className="text-sm font-semibold text-ink mb-2.5">{title}</p>
    <div className="space-y-0.5 max-h-64 overflow-y-auto pr-1 -mx-1">{children}</div>
  </div>
);

const Check: React.FC<{ checked: boolean; onChange: () => void; label: string; count?: number }> = ({ checked, onChange, label, count }) => (
  <label className={`flex items-center gap-2.5 text-sm cursor-pointer rounded-md px-1 py-1 hover:bg-raised ${checked ? "text-ink font-medium" : "text-ink-2"}`}>
    <input type="checkbox" checked={checked} onChange={onChange} className="w-4 h-4 rounded border-line-strong" />
    <span className="flex-1 truncate">{label}</span>
    {count !== undefined && <span className="text-xs text-ink-3">{count}</span>}
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
            <Link key={c.id} to={categoryLink(c.slug)} className="flex justify-between gap-2 text-sm text-ink-2 hover:text-ink hover:bg-raised rounded-md px-1 py-1">
              <span className="truncate">{c.name}</span><span className="text-xs text-ink-3">{c.count}</span>
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
      <div className="flex flex-wrap gap-2 items-center mb-4 sticky top-14 z-30 -mx-4 px-4 py-2 bg-page/95 backdrop-blur md:static md:mx-0 md:px-0 md:py-0 md:bg-transparent md:backdrop-blur-none">
        <form onSubmit={(e) => { e.preventDefault(); set("q", q.trim() || null); }} className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" size={16} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search"
            className="w-full h-11 pl-10 pr-3 rounded-lg border border-line bg-surface text-ink text-sm placeholder:text-ink-3 focus:border-brand focus:ring-4 focus:ring-brand/15 outline-none" />
        </form>
        <button onClick={() => setShowFilters(true)} className="lg:hidden inline-flex items-center gap-2 h-11 px-3.5 rounded-lg border border-line bg-surface text-sm font-semibold text-ink">
          <SlidersHorizontal size={16} /> Filters{active.length ? ` (${active.length})` : ""}
        </button>
        <select value={params.get("sort") || "relevance"} onChange={(e) => set("sort", e.target.value === "relevance" ? null : e.target.value)} aria-label="Sort"
          className="h-11 px-3 rounded-lg border border-line bg-surface text-sm text-ink font-medium">
          {(result?.sorts || ["relevance", "newest", "title", "featured"]).map((s) => <option key={s} value={s}>{SORT_LABELS[s] || s}</option>)}
        </select>
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {active.map((a) => (
            <button key={a.key} onClick={() => set(a.key, null)} className="inline-flex items-center gap-1.5 bg-surface text-ink border border-line-strong hover:border-ink-3 rounded-full pl-3 pr-2 py-1 text-[13px] font-medium" aria-label={`Remove filter ${a.label}`}>
              {a.label} <X size={12} />
            </button>
          ))}
          <button onClick={() => { const n = new URLSearchParams(); if (params.get("q")) n.set("q", params.get("q")!); setParams(n); }} className="text-[13px] font-medium text-brand-text hover:underline px-2">Clear all</button>
        </div>
      )}

      <div className="grid lg:grid-cols-[248px_1fr] gap-6 xl:gap-8">
        <aside className="hidden lg:block">
          <div className="bg-surface rounded-xl border border-line p-4 sticky top-32 max-h-[calc(100vh-9rem)] overflow-y-auto overscroll-contain">{panel || <div className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-4 rounded bg-raised animate-pulse" />)}</div>}</div>
        </aside>
        <div>
          {error ? <Empty title="Couldn't load products" text={error} /> : !result ? <GridSkeleton /> : (
            <>
              <p className={`text-sm text-ink-3 mb-3 ${busy ? "opacity-50" : ""}`}><b className="text-ink font-semibold">{result.total.toLocaleString()}</b> product{result.total === 1 ? "" : "s"}</p>
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
        <div className="fixed inset-0 z-[90] bg-night/60 lg:hidden" onClick={() => setShowFilters(false)}>
          <div className="absolute right-0 top-0 bottom-0 w-80 max-w-[88%] bg-surface p-4 overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Filters">
            <div className="flex justify-between items-center mb-4"><p className="font-display font-bold text-lg text-ink">Filters</p><button onClick={() => setShowFilters(false)} aria-label="Close filters" className="p-2 -mr-2 text-ink-2"><X size={20} /></button></div>
            {panel}
          </div>
        </div>
      )}
    </div>
  );
};

export const CompanyCard: React.FC<{ c: CompanyCardT }> = ({ c }) => (
  <Link to={`/companies/${c.slug}`} className="group text-left bg-surface rounded-xl border border-line overflow-hidden hover:border-line-strong hover:shadow-md flex flex-col">
    <div className="h-20 relative bg-night overflow-hidden">
      {c.banner_url ? <img src={c.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover" /> : (
        <div className="absolute inset-0 opacity-50" style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 14px, rgb(255 255 255 / .06) 14px 15px)" }} aria-hidden="true" />
      )}
    </div>
    <div className="px-4 pb-4 flex-1 flex flex-col">
      <div className="-mt-7 mb-3 w-14 h-14 rounded-lg bg-[#fff] ring-4 ring-surface shadow-sm grid place-items-center overflow-hidden relative">
        {c.logo_url ? <img src={c.logo_url} alt="" className="w-full h-full object-contain p-1" /> : <span className="font-display text-xl font-extrabold text-[#0F1B2D]">{c.name[0]}</span>}
      </div>
      <p className="font-semibold text-ink flex items-center gap-1.5 group-hover:text-brand-text">
        <span className="truncate">{c.name}</span>
        {c.is_featured && <BadgeCheck size={16} className="text-brand shrink-0" aria-label="Featured supplier" />}
      </p>
      {c.tagline && <p className="text-sm text-ink-2 mt-1 line-clamp-2">{c.tagline}</p>}
      {(c.city || c.state) && <p className="text-[13px] text-ink-3 mt-2 flex items-center gap-1"><MapPin size={13} /> {[c.city, c.state].filter(Boolean).join(", ")}</p>}
      {!!c.top_categories?.length && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {c.top_categories.map((t) => <span key={t.slug} className="text-xs bg-raised text-ink-2 border border-line rounded-md px-2 py-0.5">{t.name}</span>)}
        </div>
      )}
      <div className="mt-auto pt-4 grid grid-cols-3 gap-2 text-center border-t border-line -mx-4 px-4 mt-4">
        <div className="pt-3"><p className="font-display font-bold text-ink text-lg leading-none">{(c.product_count ?? 0).toLocaleString()}</p><p className="text-xs text-ink-3 mt-1">products</p></div>
        <div className="pt-3"><p className="font-display font-bold text-ink text-lg leading-none">{c.brand_count ?? 0}</p><p className="text-xs text-ink-3 mt-1">brands</p></div>
        <div className="pt-3">{c.rating?.average != null && c.rating.count > 0 ? <><p className="font-display font-bold text-ink text-lg leading-none">{c.rating.average.toFixed(1)}</p><p className="text-xs text-ink-3 mt-1">{c.rating.count} reviews</p></> : <><p className="font-display font-bold text-ink-3 text-lg leading-none">–</p><p className="text-xs text-ink-3 mt-1">no reviews</p></>}</div>
      </div>
    </div>
  </Link>
);

export const BrandTile: React.FC<{ b: { name: string; slug: string; logo_url?: string | null; product_count?: number; relationship?: string } }> = ({ b }) => (
  <Link to={`/brands/${b.slug}`} className="group bg-surface rounded-xl border border-line p-3 flex items-center gap-3 hover:border-line-strong hover:shadow-md min-w-0">
    <div className="w-14 h-14 rounded-lg bg-[#fff] ring-1 ring-line grid place-items-center overflow-hidden shrink-0">
      {b.logo_url ? <img src={b.logo_url} alt="" className="w-full h-full object-contain p-1.5" /> : <span className="font-display text-lg font-extrabold text-[#0F1B2D]">{b.name[0]}</span>}
    </div>
    <div className="min-w-0">
      <p className="font-semibold text-sm text-ink truncate group-hover:text-brand-text">{b.name}</p>
      {b.product_count !== undefined && <p className="text-[13px] text-ink-3">{b.product_count} products</p>}
      {b.relationship && b.relationship !== "reseller" && <p className="text-xs text-brand-text font-medium capitalize">{b.relationship.replace(/_/g, " ")}</p>}
    </div>
  </Link>
);

export const CategoryTile: React.FC<{ c: { name: string; slug: string; image_url?: string | null; product_count?: number } }> = ({ c }) => (
  <Link to={`/categories/${c.slug}`} className="group block">
    <div className={`aspect-square rounded-xl border overflow-hidden grid place-items-center group-hover:shadow-md ${c.image_url ? "bg-surface border-line group-hover:border-line-strong" : "bg-brand-soft border-transparent"}`}>
      {c.image_url ? <img src={c.image_url} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-300" /> : (
        <span className="font-display text-5xl font-extrabold text-brand-text/80 group-hover:scale-110 transition-transform" style={{ fontStretch: "125%" }} aria-hidden="true">{c.name.trim()[0]?.toUpperCase()}</span>
      )}
    </div>
    <p className="mt-2 font-semibold text-sm text-ink line-clamp-1 group-hover:text-brand-text">{c.name}</p>
    {c.product_count !== undefined && <p className="text-[13px] text-ink-3">{c.product_count.toLocaleString()} products</p>}
  </Link>
);

export const SectionTitle: React.FC<{ title: string; subtitle?: string; to?: string; linkLabel?: string; onDark?: boolean }> = ({ title, subtitle, to, linkLabel = "See all" }) => (
  <div className="flex items-end justify-between gap-4 mb-5">
    <div className="min-w-0">
      <h2 className="font-display text-[1.6rem] md:text-[1.9rem] font-extrabold text-ink leading-tight">{title}</h2>
      {subtitle && <p className="text-[15px] text-ink-2 mt-1">{subtitle}</p>}
    </div>
    {to && (
      <Link to={to} className="inline-flex items-center gap-1 h-9 pl-3 pr-2 rounded-lg text-sm font-semibold text-ink border border-line bg-surface hover:border-line-strong shrink-0">
        {linkLabel} <ChevronRight size={16} />
      </Link>
    )}
  </div>
);

export const GridSkeleton: React.FC<{ count?: number; cols?: string }> = ({ count = 8, cols = "grid-cols-2 md:grid-cols-3 xl:grid-cols-4" }) => (
  <div className={`grid ${cols} gap-3 sm:gap-4`} aria-busy="true" aria-label="Loading products">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="rounded-xl border border-line bg-surface p-3">
        <div className="aspect-square rounded-lg bg-raised animate-pulse" />
        <div className="h-3 w-1/3 rounded bg-raised animate-pulse mt-3" />
        <div className="h-4 w-4/5 rounded bg-raised animate-pulse mt-2" />
        <div className="h-5 w-1/2 rounded bg-raised animate-pulse mt-3" />
      </div>
    ))}
  </div>
);
