// Small site-wide pieces: the announcement bar, category notices (e.g. nicotine warnings), back to top, the compare bar.
import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Info, Megaphone, ArrowUp, X, GitCompareArrows } from "lucide-react";
import { siteApi, Notice, NoticeStyle } from "./api";
import { useSite } from "./SiteContext";
import { useCompare } from "./browserLists";

const BAR_STYLE: Record<NoticeStyle, string> = {
  dark: "bg-black text-white border-b border-white/10",
  info: "bg-blue-600 text-white",
  warning: "bg-amber-400 text-amber-950",
  promo: "bg-gradient-to-r from-fuchsia-600 to-pink-500 text-white",
};

/** The announcement bar at the very top (Admin → Site → Notices). Hidden when turned off. */
export const AnnouncementBar: React.FC = () => {
  const { settings } = useSite();
  const a = settings?.announcement;
  if (!a || !a.items.length) return null;
  const link = a.link ? (
    /^https?:/.test(a.link)
      ? <a href={a.link} target="_blank" rel="noopener noreferrer" className="underline font-bold ml-3 shrink-0">{a.link_label || "Learn more"}</a>
      : <Link to={a.link} className="underline font-bold ml-3 shrink-0">{a.link_label || "Learn more"}</Link>
  ) : null;
  if (a.scrolling) {
    const group = <div className="flex shrink-0 items-center gap-16 px-16">{a.items.map((t, i) => <span key={i} className="uppercase tracking-widest">{t}</span>)}</div>;
    return (
      <div className={`w-full overflow-hidden py-2 text-[12px] font-bold ${BAR_STYLE[a.style]}`} role="region" aria-label="Announcement">
        <div className="flex animate-warning-marquee whitespace-nowrap motion-reduce:animate-none">{group}{group}</div>
      </div>
    );
  }
  return (
    <div className={`w-full px-4 py-2 text-xs sm:text-sm font-semibold text-center ${BAR_STYLE[a.style]}`} role="region" aria-label="Announcement">
      <span>{a.items.join(" · ")}</span>{link}
    </div>
  );
};

const BOX_STYLE: Record<NoticeStyle, { cls: string; icon: React.ReactNode }> = {
  warning: { cls: "bg-amber-50 border-amber-300 text-amber-900", icon: <AlertTriangle size={18} className="text-amber-600 shrink-0" /> },
  info: { cls: "bg-blue-50 border-blue-200 text-blue-900", icon: <Info size={18} className="text-blue-600 shrink-0" /> },
  promo: { cls: "bg-pink-50 border-pink-200 text-pink-900", icon: <Megaphone size={18} className="text-pink-600 shrink-0" /> },
  dark: { cls: "bg-gray-900 border-gray-900 text-white", icon: <Info size={18} className="shrink-0" /> },
};

export const NoticeList: React.FC<{ notices: Notice[]; className?: string }> = ({ notices, className = "" }) =>
  notices.length ? (
    <div className={`space-y-2 ${className}`}>
      {notices.map((n) => (
        <div key={n.id} role="note" className={`flex gap-3 items-start border rounded-xl px-4 py-3 text-sm ${BOX_STYLE[n.style].cls}`}>
          {BOX_STYLE[n.style].icon}
          <p>{n.title && <b className="mr-1">{n.title}:</b>}{n.text}</p>
        </div>
      ))}
    </div>
  ) : null;

/** Notices that apply to these products or this category (e.g. "contains nicotine" on smoking products). */
export const Notices: React.FC<{ productIds?: (number | string)[]; category?: string; where: "product" | "category" | "checkout"; className?: string }> = ({ productIds, category, where, className }) => {
  const [list, setList] = useState<Notice[]>([]);
  const key = `${(productIds || []).join(",")}|${category || ""}|${where}`;
  useEffect(() => {
    if (!productIds?.length && !category) return setList([]);
    let live = true;
    siteApi.notices({ product_ids: productIds, category, where }).then((n) => live && setList(n)).catch(() => {});
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <NoticeList notices={list} className={className} />;
};

/** A round "back to top" button that appears after scrolling down. */
export const BackToTop: React.FC = () => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 800);
    window.addEventListener("scroll", on, { passive: true });
    on();
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (!show) return null;
  return (
    <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top"
      className="fixed z-40 right-4 bottom-24 md:bottom-28 w-11 h-11 rounded-full bg-gray-900/85 text-white shadow-lg flex items-center justify-center hover:bg-gray-900">
      <ArrowUp size={20} />
    </button>
  );
};

/** A bar listing the products picked for comparison, with a link to the comparison. */
export const CompareBar: React.FC = () => {
  const { ids, clear } = useCompare();
  const location = useLocation();
  if (!ids.length || location.pathname === "/compare" || location.pathname.startsWith("/business") || location.pathname.startsWith("/admin")) return null;
  return (
    <div className="fixed z-40 left-1/2 -translate-x-1/2 bottom-20 md:bottom-6 bg-white text-gray-900 border border-gray-200 shadow-2xl rounded-full pl-4 pr-2 py-2 flex items-center gap-3 text-sm">
      <GitCompareArrows size={16} className="text-blue-600" />
      <span className="font-semibold">{ids.length} to compare</span>
      <Link to="/compare" className="bg-blue-600 text-white font-bold rounded-full px-4 py-1.5 hover:bg-blue-700">Compare</Link>
      <button onClick={clear} aria-label="Clear compare list" className="p-1.5 text-gray-400 hover:text-gray-700"><X size={16} /></button>
    </div>
  );
};
