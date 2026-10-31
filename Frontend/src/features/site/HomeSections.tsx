// Renders the homepage sections arranged in Admin → Site → Homepage.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Headphones, Gift, Star, Truck, Shield, Clock, Tag, Users, Package, CreditCard, Globe, Award } from "lucide-react";
import type { Product } from "../products/types/product.types";
import { HomeSection, siteApi } from "./api";
import { Hero } from "./Hero";
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
    <div className="no-scrollbar flex gap-3 sm:gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6 scroll-px-4 sm:scroll-px-6">
      {products.map((p) => <div key={p.id} className="snap-start shrink-0 w-[62%] sm:w-[36%] md:w-[28%] lg:w-[22%] xl:w-[18.6%]"><ProductCard product={p} /></div>)}
    </div>
  ) : <ProductGrid products={products} cols="grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" />;

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
        <button onClick={clearViewed} className="text-sm font-medium text-ink-3 hover:text-ink mb-6">Clear</button>
      </div>
      <ProductRow products={products} layout="carousel" />
    </section>
  );
};

const Wrap: React.FC<{ children: React.ReactNode; full?: boolean }> = ({ children, full }) =>
  full ? <>{children}</> : <div className="max-w-7xl mx-auto px-4 sm:px-6">{children}</div>;

export const HomeSectionView: React.FC<{ s: HomeSection }> = ({ s }) => {
  const title = s.title ? <SectionTitle title={s.title} subtitle={s.subtitle || undefined} to={s.link || undefined} onDark /> : null;
  switch (s.type) {
    case "hero":
      return s.hero ? <Hero hero={s.hero} /> : null;
    case "banners":
      return <Wrap><BannerStrip banners={s.banners as any} /></Wrap>;
    case "categories":
      return (
        <Wrap>
          {title}
          <div className="no-scrollbar flex gap-3 sm:gap-4 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-4 lg:grid-cols-8 sm:overflow-visible">
            {s.categories!.map((c) => <div key={c.id} className="w-[30%] shrink-0 sm:w-auto"><CategoryTile c={c} /></div>)}
          </div>
        </Wrap>
      );
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
      return <Wrap>{title}<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">{s.brands!.map((b) => <BrandTile key={b.id} b={b} />)}</div></Wrap>;
    case "suppliers":
      return (
        <section className="bg-surface border-y border-line py-12 md:py-14">
          <Wrap>{title}<div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{s.companies!.map((c) => <CompanyCard key={c.id} c={c} />)}</div></Wrap>
        </section>
      );
    case "feature_tiles":
      return (
        <Wrap>
          {title}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {s.tiles!.map((t) => (
              <SmartLink key={t.key} href={t.link || undefined} className="group relative block aspect-[2/1] w-full overflow-hidden rounded-xl border border-line bg-raised">
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
            <div className="relative overflow-hidden rounded-2xl bg-night text-white grid md:grid-cols-[1.1fr_1fr] min-h-[300px]">
              <div className="relative z-10 p-8 md:p-12 flex flex-col justify-center">
                {s.title && <h2 className="font-display text-3xl md:text-[2.6rem] font-extrabold leading-[1.05]">{s.title}</h2>}
                {s.text && <p className="mt-4 text-white/70 text-lg leading-relaxed whitespace-pre-line max-w-lg">{s.text}</p>}
                {s.link && <div><SmartLink href={s.link} className="inline-flex items-center gap-2 mt-7 h-12 px-6 rounded-lg bg-signal text-signal-ink font-semibold hover:brightness-105">{s.link_label || "Learn more"}</SmartLink></div>}
              </div>
              {s.image_url && (
                <div className="absolute inset-0 md:relative">
                  <img src={s.image_url} alt={s.image_alt || ""} className="absolute inset-0 w-full h-full object-cover opacity-30 md:opacity-100" />
                  <div className="absolute inset-0 bg-gradient-to-r from-night via-night/40 to-transparent hidden md:block" />
                </div>
              )}
            </div>
          </Wrap>
        );
      }
      return (
        <Wrap>
          <div className={`bg-surface rounded-2xl border border-line p-6 md:p-10 ${s.layout === "split" && s.image_url ? "grid md:grid-cols-2 gap-10 items-center" : ""}`}>
            <div className="max-w-2xl">
              {s.title && <h2 className="font-display text-2xl md:text-3xl font-extrabold text-ink">{s.title}</h2>}
              {s.subtitle && <p className="text-ink-2 mt-1.5 text-lg">{s.subtitle}</p>}
              {s.text && <p className="mt-4 text-ink-2 leading-relaxed whitespace-pre-line">{s.text}</p>}
              {s.link && <SmartLink href={s.link} className="inline-flex items-center mt-6 h-11 px-5 rounded-lg bg-brand text-white font-semibold hover:bg-brand-hover">{s.link_label || "Learn more"}</SmartLink>}
            </div>
            {s.layout === "split" && s.image_url && <img src={s.image_url} alt={s.image_alt || ""} className="w-full rounded-xl object-cover" />}
          </div>
        </Wrap>
      );
    case "features": {
      const items = s.items || [];
      return (
        <section className="bg-night text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 md:py-16 grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)] items-start">
            <div>
              {s.title && <h2 className="font-display text-3xl md:text-[2.4rem] font-extrabold leading-[1.05]">{s.title}</h2>}
              {s.subtitle && <p className="mt-3 text-white/65 text-lg">{s.subtitle}</p>}
              {s.image_url && <img src={s.image_url} alt={s.image_alt || ""} loading="lazy" className="hidden lg:block mt-8 max-h-56 object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.6)]" />}
            </div>
            <div className="grid sm:grid-cols-2 gap-px bg-white/10 rounded-xl overflow-hidden ring-1 ring-white/10">
              {items.map((it, i) => {
                const I = ICONS[it.icon] || Star;
                return (
                  <div key={i} className="bg-night p-6 md:p-7">
                    <span className="w-10 h-10 rounded-lg bg-signal/15 text-signal grid place-items-center"><I size={20} /></span>
                    <h3 className="mt-4 font-semibold text-lg text-white">{it.title}</h3>
                    {it.text && <p className="mt-1.5 text-[15px] text-white/65 leading-relaxed">{it.text}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      );
    }
    case "logos": {
      const items = s.items || [];
      if (!items.length) return null;
      return (
        <section className="py-10 overflow-hidden" aria-label={s.title || "Brands we work with"}>
          {s.title && <p className="text-center text-sm font-medium text-ink-3 mb-6">{s.title}</p>}
          <div className="relative [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
          <div className="relative flex w-max animate-logo-strip motion-reduce:animate-none items-center hover:[animation-play-state:paused]">
            {[...items, ...items].map((l, i) => (
              <SmartLink key={i} href={l.link || undefined} className="flex items-center justify-center px-8">
                <img src={l.image_url} alt={i < items.length ? l.alt || "" : ""} className="h-10 w-auto object-contain grayscale opacity-60 hover:opacity-100 mix-blend-multiply dark:invert dark:mix-blend-screen" draggable={false} loading="lazy" />
              </SmartLink>
            ))}
          </div>
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
const FULL = new Set(["hero", "features", "logos", "suppliers"]);
export const HomeSections: React.FC<{ sections: HomeSection[] }> = ({ sections }) => (
  <div className="pb-4">
    {sections.map((s, i) => (
      <div key={s.id} className={FULL.has(s.type) ? (i ? "mt-14 md:mt-16" : "") : "mt-12 md:mt-14"}>
        <HomeSectionView s={s} />
      </div>
    ))}
  </div>
);
