// Marketplace pages: /products, /categories, /categories/:slug, /brands, /brands/:slug, /companies, and homepage sections.
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Search, ChevronRight, Globe } from "lucide-react";
import { marketplaceApi, CategoryNode, CompanyCardT, SearchResult, Banner } from "./api";
import { PageShell, Crumbs, CatalogBrowser, Loading, Empty, CompanyCard, BrandTile, CategoryTile, ProductGrid, SectionTitle, Pager } from "./components";

const RELATION: Record<string, string> = { manufacturer: "Manufacturer", authorized_distributor: "Authorized distributor", distributor: "Distributor", reseller: "Reseller" };

/** /products */
export const ProductsPage: React.FC = () => {
  const [params] = useSearchParams();
  const q = params.get("q");
  return (
    <PageShell>
      <Crumbs items={[{ label: "Home", to: "/" }, { label: q ? `Search: ${q}` : "All products" }]} />
      <h1 className="text-3xl font-black text-gray-900 mb-5">{q ? `Results for “${q}”` : "All products"}</h1>
      <CatalogBrowser fetcher={(p) => marketplaceApi.products(p)} />
    </PageShell>
  );
};

/** /categories */
export const CategoriesPage: React.FC = () => {
  const [tree, setTree] = useState<CategoryNode[] | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<CategoryNode[] | null>(null);
  useEffect(() => { marketplaceApi.categories().then(setTree).catch(() => setTree([])); }, []);
  useEffect(() => {
    if (!q.trim()) return setFound(null);
    const t = setTimeout(() => marketplaceApi.categories(q.trim()).then(setFound).catch(() => setFound([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <PageShell>
      <Crumbs items={[{ label: "Home", to: "/" }, { label: "Categories" }]} />
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <h1 className="text-3xl font-black text-gray-900">Categories</h1>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a category" aria-label="Find a category"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-900 text-sm" />
        </div>
      </div>
      {!tree ? <Loading /> : found ? (
        found.length ? <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{found.map((c) => <CategoryTile key={c.id} c={c} />)}</div> : <Empty title="No category with that name" />
      ) : tree.length === 0 ? <Empty title="No categories yet" /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tree.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl border border-gray-200 p-4">
              <Link to={`/categories/${c.slug}`} className="flex items-center justify-between font-bold text-gray-900 hover:text-blue-600">
                <span>{c.name}</span><span className="text-xs font-normal text-gray-400">{c.product_count}</span>
              </Link>
              {!!c.children?.length && (
                <ul className="mt-2 space-y-1">
                  {c.children.filter((x) => x.product_count).slice(0, 8).map((ch) => (
                    <li key={ch.id}><Link to={`/categories/${ch.slug}`} className="flex justify-between text-sm text-gray-600 hover:text-blue-600"><span>{ch.name}</span><span className="text-xs text-gray-400">{ch.product_count}</span></Link></li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
};

/** /categories/:slug */
export const CategoryPage: React.FC = () => {
  const { slug = "" } = useParams();
  const [info, setInfo] = useState<SearchResult["category"]>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { setInfo(null); setMissing(false); }, [slug]);
  return (
    <PageShell>
      {missing ? <Empty title="This category doesn't exist" action={<Link to="/categories" className="text-blue-600 font-bold">All categories</Link>} /> : (
        <>
          <Crumbs items={[{ label: "Categories", to: "/categories" }, ...(info?.trail || []).map((t, i, a) => ({ label: t.name, to: i < a.length - 1 ? `/categories/${t.slug}` : undefined }))]} />
          <h1 className="text-3xl font-black text-gray-900">{info?.name || "…"}</h1>
          {info?.description && <p className="text-gray-600 mt-1 max-w-3xl">{info.description}</p>}
          {!!info?.children?.length && (
            <div className="flex flex-wrap gap-2 mt-4">
              {info.children.map((c) => <Link key={c.id} to={`/categories/${c.slug}`} className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-3 py-1 text-sm hover:border-gray-400">{c.name} <ChevronRight size={14} /></Link>)}
            </div>
          )}
          <div className="mt-5">
            <CatalogBrowser
              fetcher={(p) => marketplaceApi.category(slug, p).catch((e) => { if (e.status === 404) setMissing(true); throw e; })}
              onResult={(r) => setInfo(r.category)}
              deps={[slug]}
            />
          </div>
        </>
      )}
    </PageShell>
  );
};

const LETTERS = ["", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "#"];

/** /brands */
export const BrandsPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ data: any[]; page: number; pages: number; total: number } | null>(null);
  const [q, setQ] = useState(params.get("q") || "");
  const letter = params.get("letter") || "";
  const page = Number(params.get("page") || 1);
  useEffect(() => {
    const t = setTimeout(() => marketplaceApi.brands({ q: params.get("q") || "", letter, page, limit: 120 }).then(setData).catch(() => setData({ data: [], page: 1, pages: 1, total: 0 })), 150);
    return () => clearTimeout(t);
  }, [params.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); v ? n.set(k, v) : n.delete(k); if (k !== "page") n.delete("page"); setParams(n, { replace: true }); };
  return (
    <PageShell>
      <Crumbs items={[{ label: "Home", to: "/" }, { label: "Brands" }]} />
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <h1 className="text-3xl font-black text-gray-900">Brands {data && <span className="text-base font-semibold text-gray-400">{data.total}</span>}</h1>
        <form onSubmit={(e) => { e.preventDefault(); set("q", q.trim()); }} className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) set("q", ""); }} placeholder="Find a brand" aria-label="Find a brand"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-900 text-sm" />
        </form>
      </div>
      <div className="flex flex-wrap gap-1 mb-5">
        {LETTERS.map((l) => (
          <button key={l || "all"} onClick={() => set("letter", l)} className={`min-w-8 px-2 py-1 rounded-md text-xs font-bold ${letter === l ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-100"}`}>{l || "All"}</button>
        ))}
      </div>
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="No brands found" /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">{data.data.map((b) => <BrandTile key={b.id} b={b} />)}</div>
          <Pager page={data.page} pages={data.pages} onChange={(p) => set("page", String(p))} />
        </>
      )}
    </PageShell>
  );
};

/** /brands/:slug */
export const BrandPage: React.FC = () => {
  const { slug = "" } = useParams();
  const [brand, setBrand] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { setBrand(null); setMissing(false); }, [slug]);
  if (missing) return <PageShell><Empty title="This brand isn't on the marketplace" action={<Link to="/brands" className="text-blue-600 font-bold">All brands</Link>} /></PageShell>;
  return (
    <PageShell>
      <Crumbs items={[{ label: "Brands", to: "/brands" }, { label: brand?.name || "…" }]} />
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6 flex flex-wrap gap-5 items-start">
        <div className="w-20 h-20 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden">
          {brand?.logo_url ? <img src={brand.logo_url} alt={`${brand.name} logo`} className="w-full h-full object-contain" /> : <span className="text-3xl font-black text-gray-300">{brand?.name?.[0]}</span>}
        </div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-3xl font-black text-gray-900">{brand?.name}</h1>
          {brand?.description && <p className="text-gray-600 mt-1 max-w-3xl whitespace-pre-line">{brand.description}</p>}
          {brand?.website && <a href={brand.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-sm text-blue-600 mt-2 hover:underline"><Globe size={14} /> {brand.website.replace(/^https?:\/\//, "")}</a>}
        </div>
        {!!brand?.sellers?.length && (
          <div className="w-full lg:w-auto lg:max-w-sm">
            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Sold by</p>
            <div className="space-y-1.5">
              {brand.sellers.map((s: CompanyCardT & { relationship: string }) => (
                <Link key={s.id} to={`/companies/${s.slug}`} className="flex items-center justify-between gap-3 text-sm hover:text-blue-600">
                  <span className="font-semibold">{s.name}</span><span className="text-xs text-gray-500">{RELATION[s.relationship] || s.relationship}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
      <CatalogBrowser
        fetcher={(p) => marketplaceApi.brand(slug, p).catch((e) => { if (e.status === 404) setMissing(true); throw e; }) as any}
        onResult={(r: any) => setBrand(r.brand)}
        hide={["brand"]}
        placeholder={`Search ${brand?.name || "this brand"}'s products`}
        deps={[slug]}
      />
    </PageShell>
  );
};

/** /companies */
export const CompaniesDirectoryPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ data: CompanyCardT[]; page: number; pages: number; total: number } | null>(null);
  const [q, setQ] = useState(params.get("q") || "");
  const [cats, setCats] = useState<CategoryNode[]>([]);
  useEffect(() => { marketplaceApi.categories().then(setCats).catch(() => {}); }, []);
  useEffect(() => {
    marketplaceApi.companies({ q: params.get("q") || "", category: params.get("category") || "", page: params.get("page") || 1 }).then(setData).catch(() => setData({ data: [], page: 1, pages: 1, total: 0 }));
  }, [params.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); v ? n.set(k, v) : n.delete(k); if (k !== "page") n.delete("page"); setParams(n, { replace: true }); };
  return (
    <PageShell>
      <Crumbs items={[{ label: "Home", to: "/" }, { label: "Suppliers" }]} />
      <h1 className="text-3xl font-black text-gray-900 mb-1">Suppliers</h1>
      <p className="text-gray-500 mb-5">Approved wholesale companies on the marketplace. Order from several in one cart.</p>
      <div className="flex flex-wrap gap-2 mb-5">
        <form onSubmit={(e) => { e.preventDefault(); set("q", q.trim()); }} className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) set("q", ""); }} placeholder="Search by name or city" aria-label="Search suppliers"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-900 text-sm" />
        </form>
        <select value={params.get("category") || ""} onChange={(e) => set("category", e.target.value)} aria-label="Category" className="px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-700">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </select>
      </div>
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="No suppliers found" /> : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">{data.data.map((c) => <CompanyCard key={c.id} c={c} />)}</div>
          <Pager page={data.page} pages={data.pages} onChange={(p) => set("page", String(p))} />
        </>
      )}
    </PageShell>
  );
};

/** Banners set by platform admins (homepage). */
export const BannerStrip: React.FC<{ banners: Banner[] }> = ({ banners }) => {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (banners.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % banners.length), 6000);
    return () => clearInterval(t);
  }, [banners.length]);
  if (!banners.length) return null;
  const b = banners[i % banners.length];
  const inner = (
    <div className="relative aspect-[16/6] sm:aspect-[16/5] rounded-2xl overflow-hidden bg-gray-900">
      <img src={b.image_url} alt={b.image_alt || b.title || ""} className="absolute inset-0 w-full h-full object-cover" />
      {(b.title || b.subtitle) && (
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent flex flex-col justify-center p-6 sm:p-10 text-white max-w-xl">
          {b.title && <p className="text-2xl sm:text-4xl font-black">{b.title}</p>}
          {b.subtitle && <p className="mt-2 text-white/90">{b.subtitle}</p>}
        </div>
      )}
      {banners.length > 1 && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
          {banners.map((_, j) => <button key={j} onClick={(e) => { e.preventDefault(); setI(j); }} aria-label={`Banner ${j + 1}`} className={`w-2 h-2 rounded-full ${j === i ? "bg-white" : "bg-white/40"}`} />)}
        </div>
      )}
    </div>
  );
  return b.link ? (b.link.startsWith("/") ? <Link to={b.link}>{inner}</Link> : <a href={b.link} target="_blank" rel="noopener noreferrer nofollow">{inner}</a>) : inner;
};

/** Marketplace sections on the homepage (featured categories, brands, suppliers, collections, new products). */
export const MarketplaceHome: React.FC = () => {
  const [home, setHome] = useState<Awaited<ReturnType<typeof marketplaceApi.home>> | null>(null);
  useEffect(() => { marketplaceApi.home().then(setHome).catch(() => {}); }, []);
  const hasAny = useMemo(() => home && (home.categories.length || home.brands.length || home.companies.length || home.collections.length || home.featured.length), [home]);
  if (!home || !hasAny) return null;
  return (
    <div className="space-y-12">
      {home.banners.length > 0 && <BannerStrip banners={home.banners} />}
      {home.categories.length > 0 && (
        <section>
          <SectionTitle onDark title="Shop by category" to="/categories" linkLabel="All categories" />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">{home.categories.map((c) => <CategoryTile key={c.id} c={c} />)}</div>
        </section>
      )}
      {home.featured.length > 0 && (
        <section><SectionTitle onDark title="Featured products" to="/products?featured=1" /><ProductGrid products={home.featured} cols="grid-cols-2 md:grid-cols-4 lg:grid-cols-6" /></section>
      )}
      {home.collections.map((c) => (
        <section key={c.id}><SectionTitle onDark title={c.name} subtitle={c.description || undefined} to={`/collections/${c.slug}`} /><ProductGrid products={c.products} cols="grid-cols-2 md:grid-cols-4" /></section>
      ))}
      {home.brands.length > 0 && (
        <section><SectionTitle onDark title="Featured brands" to="/brands" linkLabel="All brands" /><div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{home.brands.map((b) => <BrandTile key={b.id} b={b} />)}</div></section>
      )}
      {home.companies.length > 0 && (
        <section><SectionTitle onDark title="Suppliers" to="/companies" linkLabel="All suppliers" /><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{home.companies.slice(0, 8).map((c) => <CompanyCard key={c.id} c={c} />)}</div></section>
      )}
    </div>
  );
};
