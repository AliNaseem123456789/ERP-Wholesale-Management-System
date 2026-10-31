// The top menu (managed in Admin → Site → Menu): simple links, dropdowns, and mega menus with columns,
// top brands and a promo tile. Desktop opens on hover or keyboard; MobileMenu is the drawer version.
import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { NavItem, NavLink } from "./api";
import { useClassicLook as useLook, useSite } from "./SiteContext";
import { SearchBox } from "./SearchBox";

const Href: React.FC<{ l: NavLink; className?: string; onClick?: () => void; children?: React.ReactNode }> = ({ l, className, onClick, children }) => {
  if (!l.href) return <span className={className}>{children ?? l.label}</span>;
  return l.external
    ? <a href={l.href} target="_blank" rel="noopener noreferrer" className={className} onClick={onClick}>{children ?? l.label}</a>
    : <Link to={l.href} className={className} onClick={onClick}>{children ?? l.label}</Link>;
};
const hasDropdown = (n: NavItem) => n.children.length > 0 || n.columns.length > 0;

/** The contents of a dropdown; used by the desktop menu and by the admin preview. */
export const DropdownBody: React.FC<{ n: NavItem; close?: () => void }> = ({ n, close }) => {
  const look = useLook();
  const link = `block rounded-md px-2 py-1.5 text-sm ${look.dropdownLink}`;
  if (!n.mega) {
    const list = n.columns.length ? n.columns : n.children;
    return (
      <ul className="py-2 min-w-[220px] max-h-[70vh] overflow-y-auto">
        {list.map((c) => <li key={c.label + c.href}><Href l={c} className={`${link} mx-2`} onClick={close} /></li>)}
      </ul>
    );
  }
  return (
    <div className="p-6 grid gap-8" style={{ gridTemplateColumns: `repeat(${Math.max(1, n.columns.length ? Math.min(4, n.columns.length) : 1)}, minmax(0,1fr))${n.brands.length ? " 200px" : ""}${n.promo ? " 240px" : ""}` }}>
      {n.columns.length ? n.columns.map((col) => (
        <div key={col.label}>
          <Href l={col} onClick={close} className={`block font-bold mb-2 ${look.dropdownHeading} hover:underline`} />
          <ul className="space-y-0.5">{col.children.map((c) => <li key={c.label}><Href l={c} className={link} onClick={close} /></li>)}</ul>
        </div>
      )) : (
        <div>
          {n.href && <Href l={{ label: `All ${n.label}`, href: n.href }} onClick={close} className={`block font-bold mb-2 ${look.dropdownHeading} hover:underline`} />}
          <ul className="grid grid-cols-2 gap-x-6 gap-y-0.5">{n.children.map((c) => <li key={c.label}><Href l={c} className={link} onClick={close} /></li>)}</ul>
        </div>
      )}
      {n.brands.length > 0 && (
        <div>
          <p className={`font-bold mb-2 ${look.dropdownHeading}`}>Top brands</p>
          <ul className="space-y-0.5">{n.brands.map((b) => <li key={b.label}><Href l={b} className={link} onClick={close} /></li>)}</ul>
        </div>
      )}
      {n.promo && (
        <Href l={{ label: n.promo.title || "", href: n.promo.link || null, external: /^https?:/.test(n.promo.link || "") }} onClick={close} className="block group">
          <span className="block aspect-[4/3] rounded-xl overflow-hidden bg-gray-100">
            <img src={n.promo.image_url} alt={n.promo.title || ""} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          </span>
          {n.promo.title && <span className="block mt-2 font-semibold text-sm">{n.promo.title}</span>}
        </Href>
      )}
    </div>
  );
};

export const MainNav: React.FC<{ items?: NavItem[]; preview?: boolean }> = ({ items, preview }) => {
  const { settings } = useSite();
  const look = useLook();
  const nav = items ?? settings?.nav ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const location = useLocation();
  useEffect(() => setOpen(null), [location.pathname, location.search]);
  const enter = (id: string) => { clearTimeout(timer.current); setOpen(id); };
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(null), 150); };
  if (!nav.length) return <div className={`hidden md:block h-11 ${look.navBar}`} />;
  const megaOpen = nav.find((n) => n.id === open && n.mega && hasDropdown(n));

  return (
    <nav className={`relative hidden md:block ${look.navBar}`} aria-label="Main" onMouseLeave={leave} onKeyDown={(e) => e.key === "Escape" && setOpen(null)}>
      <ul className="max-w-7xl mx-auto px-6 flex flex-wrap justify-center gap-x-1 text-sm font-semibold uppercase tracking-wide">
        {nav.map((n) => {
          const dd = hasDropdown(n);
          const active = !!n.href && n.href !== "/" && (location.pathname + location.search).startsWith(n.href.split("?")[0]) && n.href.startsWith("/");
          return (
            <li key={n.id} className="relative" onMouseEnter={() => (dd ? enter(n.id) : setOpen(null))}>
              <span className="flex items-center">
                <Href l={n} className={`block px-3 py-3 ${active ? look.navActive : look.navText}`} onClick={() => setOpen(null)} />
                {dd && (
                  <button type="button" aria-label={`${n.label} menu`} aria-expanded={open === n.id} onClick={() => setOpen(open === n.id ? null : n.id)}
                    className={`-ml-2 pr-2 py-3 ${look.navText}`}>
                    <ChevronDown size={14} className={`transition-transform ${open === n.id ? "rotate-180" : ""}`} />
                  </button>
                )}
              </span>
              {dd && !n.mega && open === n.id && (
                <div className={`absolute left-0 top-full z-50 rounded-xl normal-case tracking-normal font-normal ${look.dropdown}`} onMouseEnter={() => enter(n.id)}>
                  <DropdownBody n={n} close={() => setOpen(null)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {megaOpen && (
        <div className={`absolute left-0 right-0 top-full z-50 normal-case ${look.dropdown} ${preview ? "" : "rounded-b-xl"}`} onMouseEnter={() => enter(megaOpen.id)}>
          <div className="max-w-7xl mx-auto"><DropdownBody n={megaOpen} close={() => setOpen(null)} /></div>
        </div>
      )}
    </nav>
  );
};

/** Phone menu: a drawer with search and the same items (dropdowns become expandable groups). */
export const MobileMenu: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { settings } = useSite();
  const nav = settings?.nav ?? [];
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="fixed inset-0 z-[100] md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute left-0 top-0 bottom-0 w-[85%] max-w-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-800">
          <p className="font-bold">Menu</p>
          <button onClick={onClose} aria-label="Close menu" className="p-1"><X size={22} /></button>
        </div>
        <div className="p-4 border-b border-gray-100 dark:border-slate-800"><SearchBox onDone={onClose} inputClassName="border border-gray-200" /></div>
        <ul className="flex-1 overflow-y-auto py-2">
          {nav.map((n) => {
            const sub = n.columns.length ? n.columns : n.children;
            const isOpen = expanded === n.id;
            return (
              <li key={n.id} className="border-b border-gray-100 dark:border-slate-800">
                <div className="flex items-center">
                  <Href l={n} onClick={onClose} className="flex-1 px-4 py-3 font-semibold" />
                  {sub.length > 0 && (
                    <button onClick={() => setExpanded(isOpen ? null : n.id)} aria-expanded={isOpen} aria-label={`Show ${n.label}`} className="px-4 py-3 text-gray-500">
                      <ChevronRight size={18} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    </button>
                  )}
                </div>
                {isOpen && (
                  <ul className="pb-2 bg-gray-50 dark:bg-slate-800/50">
                    {sub.map((c) => (
                      <li key={c.label}>
                        <Href l={c} onClick={onClose} className="block pl-8 pr-4 py-2 text-sm" />
                        {"children" in c && (c as any).children?.length > 0 && (
                          <ul>{(c as any).children.map((k: NavLink) => <li key={k.label}><Href l={k} onClick={onClose} className="block pl-12 pr-4 py-1.5 text-sm text-gray-600 dark:text-gray-300" /></li>)}</ul>
                        )}
                      </li>
                    ))}
                    {n.brands.length > 0 && (
                      <li className="pl-8 pr-4 pt-2 text-xs font-bold uppercase text-gray-400">Top brands</li>
                    )}
                    {n.brands.map((b) => <li key={b.label}><Href l={b} onClick={onClose} className="block pl-8 pr-4 py-1.5 text-sm" /></li>)}
                  </ul>
                )}
              </li>
            );
          })}
          <li><Link to="/compare" onClick={onClose} className="block px-4 py-3 font-semibold">Compare products</Link></li>
        </ul>
      </div>
    </div>
  );
};
