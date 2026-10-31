// Admin → Site → Menu: the top menu with dropdowns and mega menus. Drag or use the arrows to reorder; preview before saving.
import React, { useState } from "react";
import { ChevronDown, ChevronRight, Plus, RotateCcw, Eye, Save } from "lucide-react";
import { toast } from "sonner";
import { siteAdminApi, NavConfig, NavTarget, NavItem } from "../../../site/api";
import { MainNav } from "../../../site/MainNav";
import { Card, Field, inputCls, btnPrimary, btnSecondary } from "../../../business/components/ui";
import { ImageField } from "../../../business/components/pickers";
import { Options, RowTools, useDrag, move, newId, upload, errText, categoryTree } from "./shared";

const TYPES: [NavTarget["type"], string][] = [["link", "Page or web address"], ["category", "Category"], ["brand", "Brand"], ["company", "Supplier"], ["collection", "Platform collection"], ["menu", "Heading only (just a dropdown)"]];
const DROPDOWNS: [NavConfig["dropdown"], string][] = [["none", "No dropdown"], ["subcategories", "Its sub-categories (automatic)"], ["categories", "All categories (automatic)"], ["manual", "Links I choose"]];

/** Where a menu item goes: type + destination. */
const TargetFields: React.FC<{ t: NavTarget; set: (p: Partial<NavTarget>) => void; opts: Options; allowMenu?: boolean }> = ({ t, set, opts, allowMenu = true }) => {
  const list = t.type === "category" ? categoryTree(opts.categories).map((c) => ({ ...c, name: `${"— ".repeat(c.depth)}${c.name}` })) : t.type === "brand" ? opts.brands : t.type === "company" ? opts.companies : t.type === "collection" ? opts.collections : [];
  return (
    <>
      <select className={inputCls} value={t.type} aria-label="Goes to" onChange={(e) => set({ type: e.target.value as NavTarget["type"], ref: "" })}>
        {TYPES.filter(([v]) => allowMenu || v !== "menu").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {t.type === "link" ? (
        <input className={inputCls} value={t.ref} placeholder="/products?featured=1 or https://…" aria-label="Address" onChange={(e) => set({ ref: e.target.value })} />
      ) : t.type === "menu" ? <span className="text-xs text-gray-500 self-center">Opens its dropdown, goes nowhere itself</span> : (
        <select className={inputCls} value={t.ref} aria-label="Destination" onChange={(e) => set({ ref: e.target.value })}>
          <option value="">Choose…</option>
          {list.map((o) => <option key={o.id} value={o.slug}>{o.name}</option>)}
          {t.ref && !list.some((o) => o.slug === t.ref) && <option value={t.ref}>{t.ref} (not found)</option>}
        </select>
      )}
    </>
  );
};

const ItemEditor: React.FC<{ n: NavConfig; set: (p: Partial<NavConfig>) => void; opts: Options }> = ({ n, set, opts }) => {
  const kids = useDrag(n.children, (children) => set({ children }));
  return (
    <div className="space-y-3 pt-3 border-t border-gray-100">
      <div className="grid md:grid-cols-3 gap-2">
        <Field label="Label"><input className={inputCls} value={n.label} maxLength={40} onChange={(e) => set({ label: e.target.value })} /></Field>
        <div className="md:col-span-2 grid md:grid-cols-2 gap-2 items-end"><TargetFields t={n} set={set} opts={opts} /></div>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Dropdown">
          <select className={inputCls} value={n.dropdown} onChange={(e) => set({ dropdown: e.target.value as NavConfig["dropdown"], ...(e.target.value === "manual" && !n.children.length ? { children: [{ label: "", type: "category", ref: "" }] } : {}) })}>
            {DROPDOWNS.filter(([v]) => v !== "subcategories" || n.type === "category").filter(([v]) => v !== "none" || n.type !== "menu").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {n.dropdown !== "none" && (
          <div className="md:col-span-2 flex flex-wrap gap-x-6 gap-y-2 items-end pb-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={n.mega} onChange={(e) => set({ mega: e.target.checked })} /> Mega menu (wide, in columns)</label>
            {n.type === "category" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={n.brands} onChange={(e) => set({ brands: e.target.checked })} /> Show its top brands</label>}
          </div>
        )}
      </div>
      {n.dropdown === "manual" && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-600 uppercase">Dropdown links</p>
          {n.children.map((c, j) => (
            <div key={j} {...kids.props(j)} className={`grid md:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center rounded-lg ${kids.over === j ? "ring-2 ring-blue-300" : ""}`}>
              <input className={inputCls} value={c.label} maxLength={40} placeholder="Label" aria-label={`Link ${j + 1} label`} onChange={(e) => set({ children: n.children.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) })} />
              <TargetFields t={c} allowMenu={false} opts={opts} set={(p) => set({ children: n.children.map((x, k) => (k === j ? { ...x, ...p } : x)) })} />
              <RowTools i={j} count={n.children.length} label={`link ${j + 1}`} handle={kids.handle(j)} onMove={(to) => set({ children: move(n.children, j, to) })} onRemove={() => set({ children: n.children.filter((_, k) => k !== j) })} />
            </div>
          ))}
          {n.children.length < 24 && <button type="button" className={btnSecondary} onClick={() => set({ children: [...n.children, { label: "", type: "category", ref: "" }] })}><Plus size={14} /> Add link</button>}
        </div>
      )}
      {n.dropdown !== "none" && n.mega && (
        <details className="text-sm" open={!!n.promo}>
          <summary className="cursor-pointer font-semibold text-gray-700">Promo tile in the mega menu (optional)</summary>
          <div className="grid md:grid-cols-3 gap-3 mt-2">
            <Field label="Image"><ImageField value={n.promo?.image_url || ""} upload={upload} onChange={(v) => set({ promo: { ...(n.promo || { image_url: "" }), image_url: v } })} /></Field>
            <Field label="Title"><input className={inputCls} value={n.promo?.title || ""} maxLength={80} onChange={(e) => set({ promo: { ...(n.promo || { image_url: "" }), title: e.target.value } })} /></Field>
            <Field label="Link"><input className={inputCls} value={n.promo?.link || ""} placeholder="/deals" onChange={(e) => set({ promo: { ...(n.promo || { image_url: "" }), link: e.target.value } })} /></Field>
          </div>
          {n.promo && <button type="button" onClick={() => set({ promo: null })} className="mt-2 text-xs text-red-600 hover:underline">Remove promo tile</button>}
        </details>
      )}
    </div>
  );
};

export const MenuEditor: React.FC<{ initial: NavConfig[]; isDefault: boolean; opts: Options; onSaved: () => void }> = ({ initial, isDefault, opts, onSaved }) => {
  const [nav, setNav] = useState<NavConfig[]>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<NavItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useDrag(nav, setNav);
  const dirty = JSON.stringify(nav) !== saved;
  const set = (id: string, p: Partial<NavConfig>) => setNav(nav.map((n) => (n.id === id ? { ...n, ...p } : n)));

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast.error(errText(e)); } finally { setBusy(false); } };
  const save = () => run(async () => { const r = await siteAdminApi.saveNav(nav); setNav(r.data); setSaved(JSON.stringify(r.data)); toast.success(r.message); onSaved(); });
  const reset = () => run(async () => {
    if (!window.confirm("Go back to the menu built automatically from your categories? Your menu is replaced.")) return;
    const r = await siteAdminApi.saveNav(null); setNav(r.data); setSaved(JSON.stringify(r.data)); toast.success(r.message); onSaved();
  });
  const showPreview = () => run(async () => setPreview(await siteAdminApi.previewNav(nav)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Top menu</h3>
          <p className="text-sm text-gray-500">{isDefault && !dirty ? "Built automatically from your categories. Change anything and save to take it over." : "The bar under the header, on every page. Up to 12 items."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={reset} disabled={busy} className={btnSecondary}><RotateCcw size={14} /> Automatic menu</button>
          <button onClick={showPreview} disabled={busy} className={btnSecondary}><Eye size={14} /> Preview</button>
          <button onClick={save} disabled={busy || !dirty} className={btnPrimary}><Save size={14} /> {busy ? "Saving…" : "Save menu"}</button>
        </div>
      </div>
      {dirty && <p className="text-sm bg-blue-50 text-blue-800 rounded-lg px-3 py-2">Unsaved changes. Visitors see them once you save.</p>}

      <div className="space-y-2">
        {nav.map((n, i) => {
          const isOpen = open === n.id;
          const summary = n.dropdown === "none" ? "" : n.dropdown === "manual" ? ` · dropdown: ${n.children.length} links` : n.dropdown === "categories" ? " · dropdown: all categories" : " · dropdown: sub-categories";
          return (
            <div key={n.id} {...drag.props(i)}>
            <Card className={`p-3 ${n.hidden ? "opacity-60" : ""} ${drag.over === i ? "ring-2 ring-blue-300" : ""}`}>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setOpen(isOpen ? null : n.id)} aria-expanded={isOpen} className="flex-1 flex items-center gap-2 text-left min-w-0">
                  {isOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                  <span className="min-w-0">
                    <span className="block font-bold text-gray-900 truncate">{n.label || "(no label)"}{n.hidden && <span className="ml-2 text-xs font-normal text-gray-500">hidden</span>}</span>
                    <span className="block text-xs text-gray-500 truncate">{n.type === "menu" ? "heading" : `${n.type}: ${n.ref || "—"}`}{summary}{n.mega ? " · mega" : ""}</span>
                  </span>
                </button>
                <RowTools i={i} count={nav.length} label={n.label || "item"} handle={drag.handle(i)} onMove={(to) => setNav(move(nav, i, to))} hidden={n.hidden} onToggle={() => set(n.id, { hidden: !n.hidden })} onRemove={() => setNav(nav.filter((x) => x.id !== n.id))} />
              </div>
              {isOpen && <ItemEditor n={n} set={(p) => set(n.id, p)} opts={opts} />}
            </Card>
            </div>
          );
        })}
      </div>
      {nav.length < 12 && (
        <button className={btnSecondary} onClick={() => { const n: NavConfig = { id: newId("nav"), label: "", type: "category", ref: "", hidden: false, dropdown: "none", children: [], mega: false, brands: false, promo: null }; setNav([...nav, n]); setOpen(n.id); }}>
          <Plus size={14} /> Add menu item
        </button>
      )}

      {preview && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex flex-col" role="dialog" aria-modal="true" aria-label="Menu preview">
          <div className="bg-solid text-white px-4 py-2 flex items-center justify-between text-sm">
            <span><b>Preview</b>: hover or click the arrows to open dropdowns. Not saved yet.</span>
            <button onClick={() => setPreview(null)} className="bg-white/10 px-3 py-1.5 rounded font-semibold">Close</button>
          </div>
          <div className="bg-gray-100 flex-1 overflow-auto"><MainNav items={preview} preview /><div className="h-[70vh]" /></div>
        </div>
      )}
    </div>
  );
};
