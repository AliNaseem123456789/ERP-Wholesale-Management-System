// Renders the homepage sections arranged in Admin → Site → Homepage.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Headphones, Gift, Star, Truck, Shield, Clock, Tag, Users, Package, CreditCard, Globe, Award } from "lucide-react";
import type { Product } from "../products/types/product.types";
import { HomeSection, siteApi } from "./api";
import { Hero } from "./Hero";
import { useLook } from "./SiteContext";
import { useRecentlyViewed, clearViewed } from "./browserLists";
import { ProductGrid, SectionTitle, CategoryTile, BrandTile, CompanyCard } from "../marketplace/components";
import { BannerStrip } from "../marketplace/pages";
import ProductCard from "../products/components/ProductCard";

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = { headphones: Headphones, gift: Gift, star: Star, truck: Truck, shield: Shield, clock: Clock, tag: Tag, users: Users, package: Package, "credit-card": CreditCard, globe: Globe, award: Award };

const SmartLink: React.FC<{ href?: string; className?: string; children: React.ReactNode }> = ({ href, className, children }) =>
  !href ? <span className={className}>{children}</span> : /^https?:/.test(href) ? <a href={href} className={className} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <Link to={href} className={className}>{children}</Link>;

/** A product row as a grid, or as a row that scrolls sideways. */
export const ProductRow: React.FC<{ products: Product[]; layout?: string }> = ({ products, layout }) =>
  layout === "carousel" ? (
    <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-3 -mx-1 px-1">
      {products.map((p) => <div key={p.id} className="snap-start shrink-0 w-[46%] sm:w-[30%] md:w-[23%] lg:w-[18%]"><ProductCard product={p} /></div>)}
    </div>
  ) : <ProductGrid products={products} cols="grid-cols-2 md:grid-cols-4 lg:grid-cols-5" />;

/** The visitor's recently viewed products (kept in this browser). */
export const RecentlyViewed: React.FC<{ title?: string; exclude?: number | string; onDark?: boolean; max?: number }> = ({ title = "Recently viewed", exclude, onDark, max = 10 }) => {
  const ids = useRecentlyViewed().filter((x) => String(x) !== String(exclude)).slice(0, max);
  const [products, setProducts] = useState<Product[]>([]);
  const key = ids.join(",");
  useEffect(() => {
    if (!ids.length) return setProducts([]);
    let live = true;
    siteApi.productsByIds(ids).then((rows) => {
      if (!live) return;
      const order = new Map(ids.map((x, i) => [x, i]));
      setProducts([...rows].sort((a, b) => (order.get(String(a.id)) ?? 99) - (order.get(String(b.id)) ?? 99)));
    }).catch(() => {});
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!products.length) return null;
  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <SectionTitle title={title} onDark={onDark} />
        <button onClick={clearViewed} className="text-sm text-gray-500 hover:underline mb-4">Clear</button>
      </div>
      <ProductRow products={products} layout="carousel" />
    </section>
  );
};

const Wrap: React.FC<{ children: React.ReactNode; full?: boolean }> = ({ children, full }) =>
  full ? <>{children}</> : <div className="max-w-7xl mx-auto px-4 md:px-6">{children}</div>;

export const HomeSectionView: React.FC<{ s: HomeSection }> = ({ s }) => {
  const look = useLook();
  const title = s.title ? <SectionTitle title={s.title} subtitle={s.subtitle || undefined} to={s.link || undefined} onDark /> : null;
  switch (s.type) {
    case "hero":
      return s.hero ? <Hero hero={s.hero} /> : null;
    case "banners":
      return <Wrap><BannerStrip banners={s.banners as any} /></Wrap>;
    case "categories":
      return <Wrap>{title}<div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">{s.categories!.map((c) => <CategoryTile key={c.id} c={c} />)}</div></Wrap>;
    case "products":
      return <Wrap>{title}<ProductRow products={s.products!} layout={s.layout} /></Wrap>;
    case "collections":
      return (
        <Wrap>
          <div className="space-y-12">
            {s.collections!.map((c) => (
              <section key={c.id}><SectionTitle title={c.name} subtitle={c.description || undefined} to={`/collections/${c.slug}`} onDark /><ProductRow products={c.products} /></section>
            ))}
          </div>
        </Wrap>
      );
    case "brands":
      return <Wrap>{title}<div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{s.brands!.map((b) => <BrandTile key={b.id} b={b} />)}</div></Wrap>;
    case "suppliers":
      return <Wrap>{title}<div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{s.companies!.map((c) => <CompanyCard key={c.id} c={c} />)}</div></Wrap>;
    case "feature_tiles":
      return (
        <Wrap>
          {title}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {s.tiles!.map((t) => (
              <SmartLink key={t.key} href={t.link || undefined} className="group relative block aspect-[2/1] w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                <img src={t.image} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              </SmartLink>
            ))}
          </div>
        </Wrap>
      );
    case "text":
      if (s.layout === "banner") {
        return (
          <Wrap>
            <div className="relative overflow-hidden rounded-2xl bg-gray-900 text-white">
              {s.image_url && <img src={s.image_url} alt={s.image_alt || ""} className="absolute inset-0 w-full h-full object-cover opacity-50" />}
              <div className="relative p-8 md:p-12 max-w-2xl">
                {s.title && <h2 className="text-2xl md:text-4xl font-black">{s.title}</h2>}
                {s.text && <p className="mt-3 text-white/90 whitespace-pre-line">{s.text}</p>}
                {s.link && <SmartLink href={s.link} className="inline-block mt-6 bg-white text-gray-900 font-bold px-5 py-2.5 rounded-lg">{s.link_label || "Learn more"}</SmartLink>}
              </div>
            </div>
          </Wrap>
        );
      }
      return (
        <Wrap>
          <div className={`bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 md:p-10 ${s.layout === "split" && s.image_url ? "grid md:grid-cols-2 gap-8 items-center" : ""}`}>
            <div>
              {s.title && <h2 className="text-2xl font-black text-gray-900 dark:text-white">{s.title}</h2>}
              {s.subtitle && <p className="text-gray-500 mt-1">{s.subtitle}</p>}
              {s.text && <p className="mt-3 text-gray-700 dark:text-gray-300 whitespace-pre-line">{s.text}</p>}
              {s.link && <SmartLink href={s.link} className="inline-block mt-5 bg-blue-600 text-white font-bold px-5 py-2.5 rounded-lg">{s.link_label || "Learn more"}</SmartLink>}
            </div>
            {s.layout === "split" && s.image_url && <img src={s.image_url} alt={s.image_alt || ""} className="w-full rounded-xl object-cover" />}
          </div>
        </Wrap>
      );
    case "features": {
      const items = s.items || [];
      const left = items.slice(0, Math.ceil(items.length / 2));
      const right = items.slice(Math.ceil(items.length / 2));
      const Item = ({ it }: { it: any }) => {
        const I = ICONS[it.icon] || Star;
        return (
          <div className="flex items-start gap-4">
            <div className={look.clean ? "text-blue-300" : "text-yellow-400"}><I size={22} /></div>
            <div><h3 className="font-semibold text-lg">{it.title}</h3>{it.text && <p className="text-sm text-gray-200 leading-relaxed">{it.text}</p>}</div>
          </div>
        );
      };
      return (
        <section className="relative py-12 px-6 text-white" style={look.clean ? { background: "linear-gradient(135deg,#0f172a,#1e3a8a)" } : { backgroundImage: "url('/logos/galaxy.jpeg')", backgroundSize: "cover", backgroundPosition: "center" }}>
          {!look.clean && <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />}
          <div className="relative max-w-6xl mx-auto">
            {s.title && <h2 className="text-center text-2xl md:text-4xl font-semibold tracking-wide mb-12 uppercase">{s.title}</h2>}
            <div className={`grid grid-cols-1 ${s.image_url ? "md:grid-cols-3" : "md:grid-cols-2"} gap-10 items-center`}>
              <div className="space-y-10">{left.map((it, i) => <Item key={i} it={it} />)}</div>
              {s.image_url && <div className="hidden md:flex justify-center"><img src={s.image_url} alt={s.image_alt || ""} loading="lazy" className="max-h-80 drop-shadow-[0_25px_50px_rgba(0,0,0,0.8)]" /></div>}
              <div className="space-y-10">{right.map((it, i) => <Item key={i} it={it} />)}</div>
            </div>
          </div>
        </section>
      );
    }
    case "logos": {
      const items = s.items || [];
      if (!items.length) return null;
      return (
        <section className="bg-gray-100 dark:bg-gray-900 py-6 overflow-hidden" aria-label={s.title || "Brands we work with"}>
          {s.title && <p className="text-center font-bold text-gray-700 dark:text-gray-200 mb-4">{s.title}</p>}
          <div className="relative flex w-max animate-logo-strip motion-reduce:animate-none items-center">
            {[...items, ...items].map((l, i) => (
              <SmartLink key={i} href={l.link || undefined} className="flex items-center justify-center px-6">
                <img src={l.image_url} alt={i < items.length ? l.alt || "" : ""} className="h-14 w-auto object-contain" draggable={false} loading="lazy" />
              </SmartLink>
            ))}
          </div>
          <style>{`@keyframes logo-strip{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}.animate-logo-strip{animation:logo-strip 30s linear infinite}`}</style>
        </section>
      );
    }
    case "recently_viewed":
      return <Wrap><RecentlyViewed title={s.title || "Recently viewed"} onDark /></Wrap>;
    default:
      return null;
  }
};

/** Full-width sections touch the edges; the rest sit in the page width with spacing. */
const FULL = new Set(["hero", "features", "logos"]);
export const HomeSections: React.FC<{ sections: HomeSection[] }> = ({ sections }) => (
  <div className="pb-12">
    {sections.map((s, i) => (
      <div key={s.id} className={FULL.has(s.type) ? (i ? "mt-12" : "") : "mt-10 md:mt-12"}>
        <HomeSectionView s={s} />
      </div>
    ))}
  </div>
);
