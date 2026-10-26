// The homepage hero (Admin → Site → Hero): rotating slides in three layouts.
//   full:   a full-width picture with the text over it (the original look)
//   split:  text on one side, the picture on the other
//   search: a big search box over the picture
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { HeroData, HeroButton } from "./api";
import { useLook } from "./SiteContext";
import { SearchBox } from "./SearchBox";

const Btn: React.FC<{ b: HeroButton }> = ({ b }) => {
  const look = useLook();
  const cls = `inline-block px-7 py-3 rounded-lg font-bold transition-all ${b.style === "primary" ? look.heroPrimary : look.heroSecondary}`;
  return /^https?:/.test(b.link) ? <a href={b.link} className={cls} target="_blank" rel="noopener noreferrer">{b.label}</a> : <Link to={b.link} className={cls}>{b.label}</Link>;
};

const Picture: React.FC<{ src: string; mobile?: string; alt?: string; className: string }> = ({ src, mobile, alt, className }) => (
  <picture>
    {mobile && <source media="(max-width: 767px)" srcSet={mobile} />}
    <img src={src} alt={alt || ""} className={className} />
  </picture>
);

export const Hero: React.FC<{ hero: HeroData }> = ({ hero }) => {
  const look = useLook();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = hero.slides.length;
  useEffect(() => {
    if (n < 2 || paused) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = setInterval(() => setActive((a) => (a + 1) % n), Math.max(3, hero.interval) * 1000);
    return () => clearInterval(t);
  }, [n, paused, hero.interval]);
  useEffect(() => { if (active >= n) setActive(0); }, [n, active]);
  if (!n) return null;
  const s = hero.slides[Math.min(active, n - 1)];
  const go = (d: number) => setActive((a) => (a + d + n) % n);
  const arrows = n > 1 && (
    <>
      <button onClick={() => go(-1)} aria-label="Previous slide" className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60"><ChevronLeft /></button>
      <button onClick={() => go(1)} aria-label="Next slide" className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60"><ChevronRight /></button>
    </>
  );
  const dots = n > 1 && (
    <div className="flex gap-2" role="tablist" aria-label="Slides">
      {hero.slides.map((x, i) => (
        <button key={x.id} role="tab" aria-selected={i === active} aria-label={`Slide ${i + 1}`} onClick={() => setActive(i)}
          className={`h-2 rounded-full transition-all ${i === active ? "w-8 bg-white" : "w-2 bg-white/50"}`} />
      ))}
    </div>
  );
  const heading = (cls: string) => (
    <h1 className={cls}>
      {s.title && <span className="block">{s.title}</span>}
      {s.highlight && <span className="block">{s.highlight}{!look.clean && <span className={`${look.heroAccent} ml-3`}>//</span>}</span>}
    </h1>
  );

  if (hero.layout === "split") {
    return (
      <section className="bg-gray-900 text-white" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} aria-roledescription="carousel">
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 items-center gap-8 px-6 py-10 md:py-16">
          <div>
            {heading(`text-3xl md:text-5xl font-extrabold leading-tight ${look.clean ? "" : "[&>span:last-child]:text-cyan-300"}`)}
            {s.subtitle && <p className="mt-4 text-lg text-gray-300 max-w-xl">{s.subtitle}</p>}
            {s.buttons.length > 0 && <div className="mt-8 flex flex-wrap gap-3">{s.buttons.map((b) => <Btn key={b.label} b={b} />)}</div>}
            {dots && <div className="mt-8">{dots}</div>}
          </div>
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden">
            <Picture src={s.image_url} mobile={s.mobile_image_url} alt={s.image_alt} className="absolute inset-0 w-full h-full object-cover" />
            {arrows}
          </div>
        </div>
      </section>
    );
  }

  if (hero.layout === "search") {
    return (
      <section className="relative overflow-hidden bg-black text-white" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <Picture src={s.image_url} mobile={s.mobile_image_url} alt={s.image_alt} className="absolute inset-0 w-full h-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 to-black/70" />
        <div className="relative max-w-3xl mx-auto px-6 py-20 md:py-28 text-center">
          {heading("text-3xl md:text-5xl font-extrabold leading-tight")}
          {s.subtitle && <p className="mt-4 text-lg text-gray-200">{s.subtitle}</p>}
          <SearchBox className="mt-8 text-left" inputClassName="py-3 text-base" placeholder="What are you looking for?" />
          {s.buttons.length > 0 && <div className="mt-6 flex flex-wrap gap-3 justify-center">{s.buttons.map((b) => <Btn key={b.label} b={b} />)}</div>}
          {dots && <div className="mt-8 flex justify-center">{dots}</div>}
        </div>
      </section>
    );
  }

  // full (the original look)
  return (
    <section className="relative h-[60vh] md:h-[70vh] min-h-[460px] md:min-h-[600px] overflow-hidden bg-black" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} aria-roledescription="carousel">
      <Picture src={s.image_url} mobile={s.mobile_image_url} alt={s.image_alt} className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
      {arrows}
      <div className="relative max-w-7xl mx-auto px-6 md:px-8 pb-10 md:pb-16 h-full flex items-end">
        <div className="w-full">
          <div className="max-w-3xl mb-8 md:mb-10">
            {heading("text-3xl md:text-6xl font-extrabold mb-4 text-white leading-tight")}
            {s.subtitle && <p className="text-base md:text-xl text-gray-200 mb-8 max-w-2xl">{s.subtitle}</p>}
            {s.buttons.length > 0 && <div className="flex flex-col sm:flex-row gap-4">{s.buttons.map((b) => <Btn key={b.label} b={b} />)}</div>}
          </div>
          {hero.thumbnails && n > 1 ? (
            <div className="hidden md:flex gap-4 items-center">
              {hero.slides.map((x, i) => (
                <button key={x.id} onClick={() => setActive(i)} aria-label={`Slide ${i + 1}`}
                  className={`relative h-20 w-32 rounded-lg transition-all duration-500 overflow-hidden border-2 ${active === i ? `${look.clean ? "border-white" : "border-cyan-400 shadow-[0_0_25px_rgba(34,211,238,0.5)]"} scale-110 z-10` : "border-transparent opacity-50 hover:opacity-100 hover:scale-105"}`}>
                  <img src={x.image_url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
          <div className={hero.thumbnails ? "md:hidden" : ""}>{dots}</div>
        </div>
      </div>
    </section>
  );
};
