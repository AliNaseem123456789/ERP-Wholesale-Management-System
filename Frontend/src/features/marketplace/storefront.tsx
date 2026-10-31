// Company storefront: renders a published (or preview) section list with the company's theme,
// plus the company page itself (/companies/:slug) with Products, Collections and About tabs.
import React, { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Mail, Phone, Globe, MapPin, Truck, CreditCard, Clock, ShoppingBag, Megaphone } from "lucide-react";
import { marketplaceApi, Section, Storefront, Contact } from "./api";
import { CatalogBrowser, Crumbs, Empty, Loading, ProductGrid, BrandTile, CategoryTile, SectionTitle } from "./components";
import ProductCard from "../products/components/ProductCard";
import { track, dealText, DealCode } from "../insights/api";
import { useSeo } from "../insights/seo";
import { ReviewsSection, Stars, ReportButton } from "../insights/components";

/** Promo codes a seller advertises (copy to use at checkout). */
export const PromoCodes: React.FC<{ codes: DealCode[]; showCompany?: boolean }> = ({ codes, showCompany }) => (
  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
    {codes.map((c) => (
      <div key={`${c.company?.id || ""}-${c.code}`} className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-black text-gray-900">{dealText(c)}</p>
          {c.description && <p className="text-sm text-gray-600 line-clamp-2">{c.description}</p>}
          <p className="text-xs text-gray-400 mt-1">
            {showCompany && c.company ? <Link to={`/companies/${c.company.slug}`} className="text-blue-600 hover:underline">{c.company.name}</Link> : null}
            {showCompany && c.company && c.ends_at ? " · " : ""}{c.ends_at ? `Ends ${new Date(c.ends_at).toLocaleDateString()}` : ""}
          </p>
        </div>
        <button onClick={() => { navigator.clipboard?.writeText(c.code).catch(() => {}); }} title="Copy the code" className="font-mono font-black text-sm px-3 py-2 rounded-lg bg-solid text-white">{c.code}</button>
      </div>
    ))}
  </div>
);

const isInternal = (href?: string) => !!href && href.startsWith("/");
const SmartLink: React.FC<{ href?: string; className?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ href, className, style, children }) => {
  if (!href) return <span className={className} style={style}>{children}</span>;
  return isInternal(href)
    ? <Link to={href} className={className} style={style}>{children}</Link>
    : <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={className} style={style}>{children}</a>;
};

const money = (n: number) => `$${Number(n).toFixed(2)}`;

export const ContactCard: React.FC<{ contact: Contact; name?: string }> = ({ contact: c }) => (
  <div className="grid sm:grid-cols-2 gap-4 text-sm text-gray-700">
    <div className="space-y-2">
      {c.email && <p className="flex items-center gap-2"><Mail size={15} className="text-gray-400" /> <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a></p>}
      {c.phone && <p className="flex items-center gap-2"><Phone size={15} className="text-gray-400" /> <a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a></p>}
      {c.website && <p className="flex items-center gap-2"><Globe size={15} className="text-gray-400" /> <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline truncate">{c.website.replace(/^https?:\/\//, "")}</a></p>}
      {(c.city || c.state || c.country) && <p className="flex items-center gap-2"><MapPin size={15} className="text-gray-400" /> {[c.city, c.state, c.country].filter(Boolean).join(", ")}</p>}
    </div>
    <div className="space-y-2">
      {c.min_order_value != null && <p className="flex items-center gap-2"><ShoppingBag size={15} className="text-gray-400" /> Minimum order {money(c.min_order_value)}</p>}
      {c.lead_time_days != null && <p className="flex items-center gap-2"><Clock size={15} className="text-gray-400" /> Ships in {c.lead_time_days} day{c.lead_time_days === 1 ? "" : "s"}</p>}
      {c.delivery_info && <p className="flex gap-2"><Truck size={15} className="text-gray-400 shrink-0 mt-0.5" /> <span className="whitespace-pre-line">{c.delivery_info}</span></p>}
      {c.payment_info && <p className="flex gap-2"><CreditCard size={15} className="text-gray-400 shrink-0 mt-0.5" /> <span className="whitespace-pre-line">{c.payment_info}</span></p>}
    </div>
  </div>
);

const ProductsBlock: React.FC<{ s: Section }> = ({ s }) => {
  const products = s.products || [];
  if (s.layout === "carousel") {
    return (
      <div className="flex gap-4 overflow-x-auto snap-x pb-2 -mx-1 px-1">
        {products.map((p) => <div key={p.id} className="snap-start shrink-0 w-48 sm:w-56"><ProductCard product={p} /></div>)}
      </div>
    );
  }
  if (s.layout === "list") {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
        {products.map((p) => (
          <Link key={p.id} to={`/product/${p.slug || p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50">
            <div className="min-w-0"><p className="font-semibold text-gray-900 truncate">{p.title}</p><p className="text-xs text-gray-500">{p.brand}</p></div>
            {p.price != null && <span className="font-black text-gray-900">{money(Number(p.price))}</span>}
          </Link>
        ))}
      </div>
    );
  }
  return <ProductGrid products={products} />;
};

/** One section, styled by the theme (CSS variables --sf-primary, --sf-accent, --sf-radius). */
const SectionView: React.FC<{ s: Section; slug: string }> = ({ s, slug }) => {
  const radius = { borderRadius: "var(--sf-radius)" };
  switch (s.type) {
    case "announcement":
      return s.layout === "card" ? (
        <div className="p-4 flex items-center gap-3 text-white" style={{ ...radius, background: "var(--sf-accent)" }}>
          <Megaphone size={20} /> <p className="font-semibold flex-1">{s.text}</p>
          {s.link && <SmartLink href={s.link} className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm font-bold">{s.link_label || "Learn more"}</SmartLink>}
        </div>
      ) : (
        <div className="text-center text-white text-sm font-semibold py-2 px-4" style={{ ...radius, background: "var(--sf-primary)" }}>
          {s.text} {s.link && <SmartLink href={s.link} className="underline ml-2">{s.link_label || "Learn more"}</SmartLink>}
        </div>
      );
    case "hero":
      return s.layout === "split" ? (
        <div className="grid md:grid-cols-2 gap-6 items-center bg-white border border-gray-200 overflow-hidden" style={radius}>
          <div className="p-8">
            <h1 className="text-3xl sm:text-4xl font-black text-gray-900">{s.title}</h1>
            {s.subtitle && <p className="text-gray-600 mt-2">{s.subtitle}</p>}
            {s.text && <p className="text-gray-600 mt-3 whitespace-pre-line">{s.text}</p>}
            {s.link && <SmartLink href={s.link} className="inline-block mt-5 text-white font-bold px-5 py-2.5 rounded-lg" style={{ background: "var(--sf-primary)" }}>{s.link_label || "Shop now"}</SmartLink>}
          </div>
          {s.image_url && <img src={s.image_url} alt={s.image_alt || ""} className="w-full h-full max-h-80 object-cover" />}
        </div>
      ) : (
        <div className="relative overflow-hidden min-h-[220px] sm:min-h-[300px] flex items-end text-white" style={{ ...radius, background: "linear-gradient(135deg, var(--sf-primary), var(--sf-accent))" }}>
          {s.image_url && <img src={s.image_url} alt={s.image_alt || ""} className="absolute inset-0 w-full h-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="relative p-6 sm:p-10">
            <h1 className="text-3xl sm:text-5xl font-black">{s.title}</h1>
            {s.subtitle && <p className="text-white/90 mt-2 text-lg">{s.subtitle}</p>}
            {s.link && <SmartLink href={s.link} className="inline-block mt-5 bg-white text-gray-900 font-bold px-5 py-2.5 rounded-lg">{s.link_label || "Shop now"}</SmartLink>}
          </div>
        </div>
      );
    case "promo_banners":
      return (
        <div>
          {s.title && <SectionTitle title={s.title} subtitle={s.subtitle} />}
          <div className={s.layout === "stack" ? "space-y-4" : "grid sm:grid-cols-2 lg:grid-cols-3 gap-4"}>
            {(s.items || []).map((b, i) => (
              <SmartLink key={i} href={b.link} className="relative block overflow-hidden aspect-[16/7] bg-gray-100" style={radius}>
                <img src={b.image_url} alt={b.image_alt || b.title || ""} className="absolute inset-0 w-full h-full object-cover" />
                {b.title && <span className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 to-transparent text-white font-bold">{b.title}</span>}
              </SmartLink>
            ))}
          </div>
        </div>
      );
    case "deals":
      return (
        <div className="space-y-4">
          <SectionTitle title={s.title || "Wholesale offers"} subtitle={s.subtitle || "Sales, volume prices and promo codes"} to={`/companies/${slug}?tab=products&deals=1`} />
          {!!(s as any).promotions?.length && <PromoCodes codes={(s as any).promotions} />}
          {!!s.products?.length && <ProductsBlock s={s} />}
        </div>
      );
    case "featured_products":
    case "product_grid":
      return (
        <div>
          <SectionTitle title={s.title || "Products"} subtitle={s.subtitle || undefined} to={`/companies/${slug}?tab=products`} />
          <ProductsBlock s={s} />
        </div>
      );
    case "collection":
      return (
        <div>
          <SectionTitle title={s.title || s.collection?.name || "Collection"} subtitle={s.subtitle || s.collection?.description || undefined} to={s.collection ? `/companies/${slug}/collections/${s.collection.slug}` : undefined} />
          <ProductsBlock s={s} />
        </div>
      );
    case "featured_brands":
      return (
        <div>
          <SectionTitle title={s.title || "Brands we supply"} subtitle={s.subtitle} />
          {s.layout === "list" ? (
            <div className="flex flex-wrap gap-2">{(s.brands || []).map((b) => <Link key={b.id} to={`/brands/${b.slug}`} className="bg-white border border-gray-200 rounded-full px-3 py-1 text-sm hover:border-gray-400">{b.name}</Link>)}</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">{(s.brands || []).map((b) => <BrandTile key={b.id} b={b} />)}</div>
          )}
        </div>
      );
    case "category_tiles":
      return (
        <div>
          <SectionTitle title={s.title || "Shop by category"} subtitle={s.subtitle} />
          {s.layout === "list" ? (
            <div className="flex flex-wrap gap-2">{(s.categories || []).map((c) => <Link key={c.id} to={`/companies/${slug}?tab=products&category=${c.slug}`} className="bg-white border border-gray-200 rounded-full px-3 py-1 text-sm hover:border-gray-400">{c.name}</Link>)}</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{(s.categories || []).map((c) => (
              <Link key={c.id} to={`/companies/${slug}?tab=products&category=${c.slug}`} className="group bg-white border border-gray-200 overflow-hidden hover:shadow-md" style={radius}>
                <div className="aspect-[4/3] bg-gray-100 flex items-center justify-center overflow-hidden">
                  {c.image_url ? <img src={c.image_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" /> : <span className="text-3xl font-black" style={{ color: "var(--sf-primary)", opacity: 0.3 }}>{c.name[0]}</span>}
                </div>
                <p className="p-2.5 font-semibold text-sm text-gray-900 line-clamp-1">{c.name}</p>
              </Link>
            ))}</div>
          )}
        </div>
      );
    case "about":
      return (
        <div className={`bg-white border border-gray-200 p-6 ${s.layout === "split" && s.image_url ? "grid md:grid-cols-2 gap-6 items-center" : ""}`} style={radius}>
          <div>
            <h2 className="font-display text-2xl font-extrabold text-ink mb-2">{s.title || "About us"}</h2>
            {s.subtitle && <p className="text-gray-500 mb-2">{s.subtitle}</p>}
            <p className="text-gray-700 whitespace-pre-line leading-relaxed">{s.text}</p>
          </div>
          {s.layout === "split" && s.image_url && <img src={s.image_url} alt={s.image_alt || ""} className="w-full max-h-72 object-cover rounded-xl" />}
        </div>
      );
    case "contact":
      return s.contact ? (
        <div className="bg-white border border-gray-200 p-6" style={radius}>
          <h2 className="font-display text-2xl font-extrabold text-ink mb-4">{s.title || "Contact & terms"}</h2>
          <ContactCard contact={s.contact} />
        </div>
      ) : null;
    default:
      return null;
  }
};

/** The section list of a storefront with its theme applied. */
export const StorefrontSections: React.FC<{ store: Storefront }> = ({ store }) => {
  const t = store.theme;
  return (
    <div
      className="space-y-8 sm:space-y-10"
      style={{ ["--sf-primary" as any]: t.primary, ["--sf-accent" as any]: t.accent, ["--sf-radius" as any]: t.radius }}
    >
      {store.sections.map((s) => <SectionView key={s.id} s={s} slug={store.slug} />)}
      {store.sections.length === 0 && <Empty title="Nothing to show yet" text="This seller hasn't published products here yet." />}
    </div>
  );
};

/** Company header shown above every tab of a storefront. */
export const CompanyHeader: React.FC<{ store: Storefront; tab: string; setTab: (t: string) => void }> = ({ store, tab, setTab }) => (
  <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-6">
    <div className="h-24 sm:h-36 relative" style={{ background: `linear-gradient(135deg, ${store.theme.primary}, ${store.theme.accent})` }}>
      {store.banner_url && <img src={store.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
    </div>
    <div className="px-4 sm:px-6 pb-4 flex flex-wrap items-end gap-4 -mt-8">
      <div className="w-20 h-20 rounded-2xl bg-white border border-gray-200 shadow overflow-hidden flex items-center justify-center relative">
        {store.logo_url ? <img src={store.logo_url} alt={`${store.name} logo`} className="w-full h-full object-contain" /> : <span className="text-3xl font-black text-gray-300">{store.name[0]}</span>}
      </div>
      <div className="flex-1 min-w-[200px] pt-9">
        <h1 className="font-display text-2xl font-extrabold text-ink">{store.name}</h1>
        <p className="text-sm text-gray-500">{store.tagline || [store.city, store.state].filter(Boolean).join(", ")}</p>
        {store.rating && store.rating.count > 0 && store.rating.average !== null && (
          <button onClick={() => setTab("reviews")} className="mt-1 flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"><Stars value={store.rating.average} /> <b>{store.rating.average.toFixed(1)}</b> ({store.rating.count} reviews)</button>
        )}
      </div>
      <p className="text-sm text-gray-500 pt-9">{store.product_count} products · {store.brands.length} brands</p>
    </div>
    <div className="flex gap-1 px-4 sm:px-6 border-t border-gray-100 overflow-x-auto">
      {[["home", "Storefront"], ["products", "All products"], ...(store.collections.length ? [["collections", "Collections"]] : []), ["reviews", "Reviews"], ["about", "About & terms"]].map(([k, label]) => (
        <button key={k} onClick={() => setTab(k)} className={`px-3 py-3 text-sm font-semibold border-b-2 whitespace-nowrap ${tab === k ? "text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"}`} style={tab === k ? { borderColor: store.theme.primary } : undefined}>
          {label}
        </button>
      ))}
    </div>
  </div>
);

/** /companies/:slug */
export const StorefrontPage: React.FC = () => {
  const { slug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [store, setStore] = useState<Storefront | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tab = params.get("tab") || "home";
  const setTab = (t: string) => setParams(t === "home" ? {} : { tab: t });
  useSeo(store ? { title: `${store.name}${store.tagline ? ` – ${store.tagline}` : ""}`, description: store.description || store.tagline || `${store.name} wholesale catalogue`, image: store.banner_url || store.logo_url, path: `/companies/${slug}` } : null);
  useEffect(() => { if (store?.slug) track({ kind: "storefront", company_slug: store.slug }); }, [store?.slug]);

  useEffect(() => {
    setStore(null);
    setError(null);
    marketplaceApi.company(slug).then(setStore).catch((e) => setError(e.status === 404 ? "This company page isn't available." : e.message));
  }, [slug]);

  if (error) return <div className="min-h-screen bg-gray-50 p-6"><div className="max-w-3xl mx-auto"><Empty title={error} action={<Link to="/companies" className="text-blue-600 font-bold">Browse suppliers</Link>} /></div></div>;
  if (!store) return <div className="min-h-screen bg-gray-50"><Loading /></div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Crumbs items={[{ label: "Suppliers", to: "/companies" }, { label: store.name }]} />
        <CompanyHeader store={store} tab={tab} setTab={setTab} />
        {tab === "home" && <StorefrontSections store={store} />}
        {tab === "products" && (
          <CatalogBrowser
            fetcher={(p) => marketplaceApi.companyProducts(slug, p)}
            hide={["company"]}
            categoryLink={(c) => `/companies/${slug}?tab=products&category=${c}`}
            placeholder={`Search ${store.name}'s products`}
            deps={[slug]}
          />
        )}
        {tab === "collections" && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {store.collections.map((c) => (
              <Link key={c.id} to={`/companies/${slug}/collections/${c.slug}`} className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-md">
                <div className="aspect-[16/7] bg-gray-100">{c.cover_image_url && <img src={c.cover_image_url} alt="" className="w-full h-full object-cover" />}</div>
                <div className="p-4"><p className="font-bold text-gray-900">{c.name}</p>{c.description && <p className="text-sm text-gray-500 line-clamp-2 mt-1">{c.description}</p>}</div>
              </Link>
            ))}
          </div>
        )}
        {tab === "reviews" && (
          <div className="space-y-4">
            <ReviewsSection companySlug={slug} companyId={store.id} companyName={store.name} title={`Reviews of ${store.name}`} />
            <p className="text-sm text-gray-500">Product reviews are on each product's page.</p>
          </div>
        )}
        {tab === "about" && (
          <div className="space-y-6">
            {store.description && <div className="bg-white rounded-2xl border border-gray-200 p-6"><h2 className="text-xl font-black text-gray-900 mb-2">About {store.name}</h2><p className="text-gray-700 whitespace-pre-line">{store.description}</p></div>}
            <div className="bg-white rounded-2xl border border-gray-200 p-6"><h2 className="text-xl font-black text-gray-900 mb-4">Contact & business terms</h2><ContactCard contact={store.contact} /></div>
            {store.categories.length > 0 && (
              <div><SectionTitle title="Categories supplied" /><div className="flex flex-wrap gap-2">{store.categories.map((c) => <Link key={c.id} to={`/companies/${slug}?tab=products&category=${c.slug}`} className="bg-white border border-gray-200 rounded-full px-3 py-1 text-sm">{c.name} <span className="text-gray-400">{c.count}</span></Link>)}</div></div>
            )}
            {store.brands.length > 0 && <div><SectionTitle title="Brands supplied" /><div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{store.brands.map((b) => <BrandTile key={b.id} b={b} />)}</div></div>}
            <div className="text-right"><ReportButton target={{ kind: "seller", company_id: store.id }} label="Report this seller" /></div>
          </div>
        )}
      </div>
    </div>
  );
};

/** /companies/:slug/collections/:collection and /collections/:slug */
export const CollectionPage: React.FC = () => {
  const { slug = "", collection } = useParams();
  const [data, setData] = useState<{ collection: any; company?: any; products: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    (collection ? marketplaceApi.companyCollection(slug, collection) : marketplaceApi.collection(slug)).then(setData).catch((e) => setError(e.message));
  }, [slug, collection]);
  useSeo(data ? { title: `${data.collection.name}${data.company ? ` | ${data.company.name}` : ""}`, description: data.collection.description || `${data.collection.name}: ${data.products.length} products`, image: data.collection.cover_image_url } : error ? { title: "Collection not available", noindex: true } : null);
  if (error) return <div className="min-h-screen bg-gray-50 p-6"><div className="max-w-3xl mx-auto"><Empty title="This collection isn't available" text={error} /></div></div>;
  if (!data) return <div className="min-h-screen bg-gray-50"><Loading /></div>;
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Crumbs items={data.company ? [{ label: "Suppliers", to: "/companies" }, { label: data.company.name, to: `/companies/${data.company.slug}` }, { label: data.collection.name }] : [{ label: "Home", to: "/" }, { label: data.collection.name }]} />
        {data.collection.cover_image_url && <img src={data.collection.cover_image_url} alt="" className="w-full max-h-64 object-cover rounded-2xl mb-6" />}
        <h1 className="font-display text-3xl md:text-[2.15rem] font-extrabold text-ink leading-tight">{data.collection.name}</h1>
        {data.collection.description && <p className="text-gray-600 mt-1 mb-6 max-w-3xl">{data.collection.description}</p>}
        {data.products.length ? <div className="mt-6"><ProductGrid products={data.products} /></div> : <Empty title="No products here right now" />}
      </div>
    </div>
  );
};
