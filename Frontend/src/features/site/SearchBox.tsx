// Header search with suggestions as you type: products, categories, brands and suppliers. Enter searches everything.
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Tag, FolderTree, Building2, Loader2 } from "lucide-react";
import { siteApi, Suggestions } from "./api";
import { ProductImage } from "../products/components/ProductImage";

type Row = { key: string; label: string; sub?: string | null; href: string; kind: "product" | "category" | "brand" | "company"; product?: Suggestions["products"][number] };

const rowsOf = (s: Suggestions): Row[] => [
  ...s.products.map((p) => ({ key: `p${p.id}`, label: p.title, sub: [p.brand, p.company].filter(Boolean).join(" · "), href: `/product/${p.slug || p.id}`, kind: "product" as const, product: p })),
  ...s.categories.map((c) => ({ key: `c${c.id}`, label: c.name, sub: c.parent ? `in ${c.parent}` : "Category", href: `/categories/${c.slug}`, kind: "category" as const })),
  ...s.brands.map((b) => ({ key: `b${b.id}`, label: b.name, sub: "Brand", href: `/brands/${b.slug}`, kind: "brand" as const })),
  ...s.companies.map((c) => ({ key: `s${c.id}`, label: c.name, sub: c.city ? `Supplier · ${c.city}` : "Supplier", href: `/companies/${c.slug}`, kind: "company" as const })),
];
const GROUPS: [Row["kind"], string][] = [["product", "Products"], ["category", "Categories"], ["brand", "Brands"], ["company", "Suppliers"]];

export const SearchBox: React.FC<{ className?: string; inputClassName?: string; autoFocus?: boolean; onDone?: () => void; placeholder?: string }> = ({
  className = "", inputClassName = "", autoFocus, onDone, placeholder = "Search products, brands or SKU…",
}) => {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const listId = useRef(`search-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); setBusy(false); return; }
    setBusy(true);
    let live = true;
    const t = setTimeout(() => {
      siteApi.suggest(term).then((s) => { if (live) { setRows(rowsOf(s)); setActive(-1); } }).catch(() => live && setRows([])).finally(() => live && setBusy(false));
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (href: string) => { setOpen(false); setQ(""); navigate(href); onDone?.(); };
  const searchAll = () => { const term = q.trim(); if (term.length >= 2) go(`/products?q=${encodeURIComponent(term)}`); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(rows.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (active >= 0 && rows[active]) go(rows[active].href); else searchAll(); }
    else if (e.key === "Escape") setOpen(false);
  };
  const showList = open && q.trim().length >= 2;

  return (
    <div ref={box} className={`relative ${className}`}>
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <input
        type="search" value={q} autoFocus={autoFocus} placeholder={placeholder} aria-label="Search the marketplace"
        role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        className={`w-full pl-9 pr-9 py-2 rounded-lg bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-800 dark:text-gray-100 ${inputClassName}`}
      />
      {busy && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
      {showList && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 mt-1 z-[70] bg-white text-gray-900 rounded-xl border border-gray-200 shadow-2xl overflow-hidden max-h-[70vh] overflow-y-auto">
          {!busy && rows.length === 0 && <p className="px-4 py-3 text-sm text-gray-500">No matches. Press Enter to search everything.</p>}
          {GROUPS.map(([kind, title]) => {
            const group = rows.map((r, i) => ({ r, i })).filter((x) => x.r.kind === kind);
            if (!group.length) return null;
            return (
              <div key={kind} className="py-1">
                <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{title}</p>
                {group.map(({ r, i }) => (
                  <button key={r.key} id={`${listId}-${i}`} role="option" aria-selected={active === i} type="button"
                    onMouseEnter={() => setActive(i)} onClick={() => go(r.href)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm ${active === i ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                    <span className="w-8 h-8 rounded-md overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center text-gray-400">
                      {r.kind === "product" ? <ProductImage product={r.product} small /> : r.kind === "category" ? <FolderTree size={15} /> : r.kind === "brand" ? <Tag size={15} /> : <Building2 size={15} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold truncate">{r.label}</span>
                      {r.sub && <span className="block text-xs text-gray-500 truncate">{r.sub}</span>}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
          <button type="button" onClick={searchAll} className="w-full text-left px-4 py-2.5 text-sm font-semibold text-blue-600 border-t border-gray-100 hover:bg-gray-50">
            Search for “{q.trim()}” in all products →
          </button>
        </div>
      )}
    </div>
  );
};
