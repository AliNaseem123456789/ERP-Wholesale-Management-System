// Site-wide content: menu, look, announcement bar, notices, hero, homepage sections (public + admin).
import { apiClient } from "../../api/apiClient";
import type { Product } from "../products/types/product.types";
import type { CompanyCardT } from "../marketplace/api";

const pub = { _public: true } as any;

export type NavLink = { label: string; href: string | null; external?: boolean };
export type NavColumn = NavLink & { children: NavLink[] };
export type NavItem = NavLink & { id: string; mega: boolean; children: NavLink[]; columns: NavColumn[]; brands: NavLink[]; promo: { image_url: string; title?: string; link?: string } | null };
export type Appearance = { style: "neon" | "clean"; default_mode: "dark" | "light"; allow_toggle: boolean };
export type Announcement = { items: string[]; link: string; link_label: string; style: NoticeStyle; scrolling: boolean };
export type NoticeStyle = "info" | "warning" | "promo" | "dark";
export type Notice = { id: string; title: string; text: string; style: NoticeStyle };
export type HeroButton = { label: string; link: string; style: "primary" | "secondary" };
export type HeroSlide = { id: string; image_url: string; mobile_image_url?: string; image_alt?: string; title: string; highlight: string; subtitle: string; buttons: HeroButton[] };
export type HeroData = { layout: "full" | "split" | "search"; interval: number; thumbnails: boolean; slides: HeroSlide[] };
export type HomeSection = {
  id: string; type: string; enabled: boolean; title: string; subtitle: string; link?: string; layout?: string; source?: string; limit?: number;
  text?: string; image_url?: string; image_alt?: string; link_label?: string;
  items?: any[]; hero?: HeroData; banners?: { image_url: string; image_alt?: string; title?: string; subtitle?: string; link?: string }[];
  categories?: { id: number; name: string; slug: string; image_url?: string | null }[]; products?: Product[];
  collections?: { id: number; name: string; slug: string; description?: string | null; products: Product[] }[];
  brands?: { id: number; name: string; slug: string; logo_url?: string | null }[]; companies?: CompanyCardT[];
  tiles?: { key: string; image: string; link: string }[];
};
export type SiteSettings = { nav: NavItem[]; banners: HomeSection["banners"]; appearance: Appearance; announcement: Announcement | null };
export type Suggestions = {
  products: { id: number; slug?: string; title: string; brand?: string; image?: string | null; company?: string | null }[];
  categories: { id: number; name: string; slug: string; parent?: string | null }[];
  brands: { id: number; name: string; slug: string; logo_url?: string | null }[];
  companies: { id: number; name: string; slug: string; logo_url?: string | null; city?: string | null }[];
};

export const siteApi = {
  settings: async () => (await apiClient.get("/marketplace/settings", pub)).data.data as SiteSettings,
  homepage: async (preview = false) => (await apiClient.get(`/marketplace/homepage${preview ? "?preview=draft" : ""}`, pub)).data.data as { sections: HomeSection[]; preview: boolean },
  suggest: async (q: string) => (await apiClient.get(`/marketplace/suggest?q=${encodeURIComponent(q)}`, pub)).data.data as Suggestions,
  notices: async (p: { product_ids?: (number | string)[]; category?: string; where: "product" | "category" | "checkout" }) => {
    const q = new URLSearchParams({ where: p.where });
    if (p.product_ids?.length) q.set("product_ids", p.product_ids.join(","));
    if (p.category) q.set("category", p.category);
    return (await apiClient.get(`/marketplace/notices?${q}`, pub)).data.data as Notice[];
  },
  productsByIds: async (ids: (number | string)[]) =>
    ids.length ? ((await apiClient.get(`/marketplace/products?ids=${ids.join(",")}&limit=24`, pub)).data.data as Product[]) : [],
};

// ---- admin ---------------------------------------------------------------------------------------
export type NavTarget = { label: string; type: "category" | "brand" | "company" | "collection" | "link" | "menu"; ref: string };
export type NavConfig = NavTarget & { id: string; hidden: boolean; dropdown: "none" | "subcategories" | "categories" | "manual"; children: NavTarget[]; mega: boolean; brands: boolean; promo: { image_url: string; title?: string; link?: string } | null };
export type HeroConfig = {
  layout: HeroData["layout"]; interval: number; thumbnails: boolean; visitor_buttons: HeroButton[]; buyer_buttons: HeroButton[];
  slides: (HeroSlide & { enabled: boolean; audience: "all" | "visitors" | "buyers"; starts_at: string | null; ends_at: string | null })[];
};
export type NoticesConfig = {
  bar: Announcement & { enabled: boolean; audience: "all" | "visitors" | "buyers"; starts_at: string | null; ends_at: string | null };
  category_notices: (Notice & { category_id: string; on_product: boolean; on_category: boolean; on_checkout: boolean })[];
};
export type HomeConfig = { sections: HomeSection[] };
export type SectionType = { type: string; label: string; fields: string[]; sources: string[]; limit: number | null };
export type SiteAdmin = {
  nav: NavConfig[]; nav_is_default: boolean; hero: HeroConfig; hero_is_default: boolean; notices: NoticesConfig; appearance: Appearance;
  homepage: { draft: HomeConfig; published_at: string | null; is_default: boolean; has_unpublished_changes: boolean; versions: { index: number; at: string; by: string | null; sections: number }[] };
  section_types: SectionType[]; icons: string[];
};

export const siteAdminApi = {
  get: async () => (await apiClient.get("/admin/site")).data.data as SiteAdmin,
  saveNav: async (nav: NavConfig[] | null) => (await apiClient.put("/admin/site/nav", { nav })).data as { message: string; data: NavConfig[] },
  previewNav: async (nav: NavConfig[]) => (await apiClient.post("/admin/site/nav/preview", { nav })).data.data as NavItem[],
  saveHero: async (hero: HeroConfig) => (await apiClient.put("/admin/site/hero", { hero })).data as { message: string; data: HeroConfig },
  resetHero: async () => (await apiClient.post("/admin/site/hero/reset")).data as { message: string; data: HeroConfig },
  saveNotices: async (notices: NoticesConfig) => (await apiClient.put("/admin/site/notices", { notices })).data as { message: string; data: NoticesConfig },
  saveAppearance: async (appearance: Appearance) => (await apiClient.put("/admin/site/appearance", { appearance })).data as { message: string; data: Appearance },
  saveHomepage: async (config: HomeConfig) => (await apiClient.put("/admin/site/homepage", { config })).data as { message: string; data: HomeConfig; warnings: string[] },
  publishHomepage: async () => (await apiClient.post("/admin/site/homepage/publish")).data as { message: string; warnings: string[] },
  resetHomepage: async () => (await apiClient.post("/admin/site/homepage/reset")).data as { message: string; data: HomeConfig },
  restoreHomepage: async (index: number) => (await apiClient.post(`/admin/site/homepage/versions/${index}/restore`)).data as { message: string; data: HomeConfig },
  uploadImage: async (file: File) => {
    const form = new FormData();
    form.append("image", file);
    return (await apiClient.post("/admin/site/images", form)).data.url as string;
  },
};
