// Page titles and descriptions for browsers and search engines (crawlers that don't run JavaScript get the same
// information from the server; see vercel.json). Private areas are marked noindex.
import { useEffect } from "react";

const SITE = "ERP Wholesale";
const DEFAULT_DESCRIPTION = "B2B wholesale marketplace: buy from approved suppliers, compare offers and order in bulk.";

const setMeta = (attr: "name" | "property", key: string, content: string | null) => {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!content) { el?.remove(); return; }
  if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute("content", content);
};
const setCanonical = (href: string | null) => {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) { el?.remove(); return; }
  if (!el) { el = document.createElement("link"); el.rel = "canonical"; document.head.appendChild(el); }
  el.href = href;
};
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export type Seo = { title?: string | null; description?: string | null; image?: string | null; path?: string; noindex?: boolean };

/** Sets the document title and meta tags while the page is shown. Pass null/undefined while data loads. */
export const useSeo = (seo: Seo | null | undefined) => {
  const key = JSON.stringify(seo || null);
  useEffect(() => {
    if (!seo) return;
    const title = seo.title ? `${clip(seo.title, 60)} | ${SITE}` : SITE;
    const description = clip(seo.description || DEFAULT_DESCRIPTION, 200);
    document.title = title;
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:image", seo.image || null);
    setMeta("name", "robots", seo.noindex ? "noindex, nofollow" : null);
    const path = seo.path ?? window.location.pathname;
    setCanonical(seo.noindex ? null : `${window.location.origin}${path}`);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
};
