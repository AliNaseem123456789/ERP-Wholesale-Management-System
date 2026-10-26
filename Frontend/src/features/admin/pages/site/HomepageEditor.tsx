// Admin → Site → Homepage: arrange the homepage from predefined sections; save a draft, preview it, publish it.
import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, RotateCcw, Save, Eye, Send, History, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { siteAdminApi, HomeConfig, HomeSection, SectionType, SiteAdmin } from "../../../site/api";
import { adminCatalogApi } from "../../api/adminCatalog.api";
import { Card, Field, Modal, inputCls, btnPrimary, btnSecondary } from "../../../business/components/ui";
import { ImageField, ChipSelect, ProductPicker } from "../../../business/components/pickers";
import type { PickedProduct } from "../../../business/api/storefront.api";
import { Options, RowTools, useDrag, move, newId, upload, errText, categoryTree } from "./shared";

const SOURCE_LABELS: Record<string, string> = {
  featured: "Featured", top: "Most products", manual: "I choose", new: "Newest", best_sellers: "Best sellers (last 90 days)", deals: "On offer", category: "From a category", collection: "From a platform collection",
};
const HINTS: Record<string, string> = {
  hero: "The slides you set up under Hero.",
  banners: "The banners set up under Marketplace → Homepage banners.",
  categories: "Category tiles. Featured = the ones chosen under Marketplace (or marked featured).",
  products: "A row of products. Sales and prices follow each buyer's own price.",
  collections: "Each live platform collection with its products.",
  brands: "Brand tiles.",
  suppliers: "Supplier cards.",
  feature_tiles: "The four image tiles from Site features.",
  text: "A heading, text, picture and button.",
  features: "Up to six reasons to buy here, with icons.",
  logos: "A strip of logos that scrolls across.",
  recently_viewed: "What this visitor looked at recently (kept in their browser). Hidden until they've viewed something.",
};

const SectionFields: React.FC<{ s: HomeSection; def: SectionType; set: (p: Partial<HomeSection>) => void; opts: Options; icons: string[]; picked: Map<string, PickedProduct>; remember: (p: PickedProduct[]) => void }> = ({ s, def, set, opts, icons, picked, remember }) => {
  const has = (f: string) => def.fields.includes(f);
  const cats = categoryTree(opts.categories);
  const items = (s.items || []) as any[];
  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Title"><input className={inputCls} value={s.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Subtitle"><input className={inputCls} value={s.subtitle} maxLength={240} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
      </div>
      {(has("source") || has("limit") || has("layout") || has("link")) && (
        <div className="grid md:grid-cols-4 gap-3">
          {has("source") && (
            <Field label="Show">
              <select className={inputCls} value={s.source} onChange={(e) => set({ source: e.target.value })}>{def.sources.map((x) => <option key={x} value={x}>{SOURCE_LABELS[x] || x}</option>)}</select>
            </Field>
          )}
          {has("limit") && <Field label="How many"><input type="number" min={1} max={def.limit || 24} className={inputCls} value={s.limit ?? 8} onChange={(e) => set({ limit: Number(e.target.value) })} /></Field>}
          {has("layout") && s.type === "products" && (
            <Field label="Layout"><select className={inputCls} value={s.layout || "grid"} onChange={(e) => set({ layout: e.target.value })}><option value="grid">Grid</option><option value="carousel">Scrolling row</option></select></Field>
          )}
          {has("link") && <Field label={'"See all" link'}><input className={inputCls} value={s.link || ""} placeholder="/products?sort=newest" onChange={(e) => set({ link: e.target.value })} /></Field>}
        </div>
      )}
      {has("category_id") && s.source === "category" && (
        <Field label="Category"><select className={inputCls} value={(s as any).category_id || ""} onChange={(e) => set({ category_id: e.target.value || null } as any)}><option value="">Choose…</option>{cats.map((c) => <option key={c.id} value={c.id}>{"— ".repeat(c.depth)}{c.name}</option>)}</select></Field>
      )}
      {has("collection_id") && s.source === "collection" && (
        <Field label="Platform collection" hint={opts.collections.length ? undefined : "Create one under Marketplace → Platform collections"}>
          <select className={inputCls} value={(s as any).collection_id || ""} onChange={(e) => set({ collection_id: e.target.value || null } as any)}><option value="">Choose…</option>{opts.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
      )}
      {has("product_ids") && s.source === "manual" && (
        <Field label="Products">
          <ProductPicker max={24} search={async (q) => (await adminCatalogApi.searchProducts(q)).map((p) => ({ ...p, status: "published" }))}
            value={((s as any).product_ids || []).map((id: string) => picked.get(String(id)) || { id, title: `Product #${id}` })}
            onChange={(v) => { remember(v); set({ product_ids: v.map((p) => String(p.id)) } as any); }} />
        </Field>
      )}
      {has("category_ids") && s.source === "manual" && <Field label="Categories"><ChipSelect options={cats.map((c) => ({ id: c.id, name: c.name }))} value={(s as any).category_ids || []} max={24} onChange={(v) => set({ category_ids: v } as any)} /></Field>}
      {has("brand_ids") && s.source === "manual" && <Field label="Brands"><ChipSelect options={opts.brands} value={(s as any).brand_ids || []} max={48} onChange={(v) => set({ brand_ids: v } as any)} /></Field>}
      {has("company_ids") && s.source === "manual" && <Field label="Suppliers"><ChipSelect options={opts.companies} value={(s as any).company_ids || []} max={24} onChange={(v) => set({ company_ids: v } as any)} /></Field>}
      {has("text") && (
        <>
          <Field label="Text"><textarea rows={4} className={inputCls} value={s.text || ""} maxLength={4000} onChange={(e) => set({ text: e.target.value })} /></Field>
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Layout"><select className={inputCls} value={s.layout || "text"} onChange={(e) => set({ layout: e.target.value })}><option value="text">Text</option><option value="split">Text beside a picture</option><option value="banner">Banner (text over a picture)</option></select></Field>
            <Field label="Button link"><input className={inputCls} value={s.link || ""} placeholder="/companies" onChange={(e) => set({ link: e.target.value })} /></Field>
            <Field label="Button text"><input className={inputCls} value={s.link_label || ""} maxLength={40} onChange={(e) => set({ link_label: e.target.value })} /></Field>
          </div>
        </>
      )}
      {has("image_url") && (
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Picture (optional)"><ImageField value={s.image_url || ""} upload={upload} onChange={(v) => set({ image_url: v })} /></Field>
          {has("image_alt") && <Field label="Picture description"><input className={inputCls} value={s.image_alt || ""} maxLength={200} onChange={(e) => set({ image_alt: e.target.value })} /></Field>}
        </div>
      )}
      {has("items") && s.type === "features" && (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid md:grid-cols-[140px_1fr_2fr_auto] gap-2">
              <select className={inputCls} value={it.icon} aria-label={`Item ${i + 1} icon`} onChange={(e) => set({ items: items.map((x, j) => (j === i ? { ...x, icon: e.target.value } : x)) })}>{icons.map((ic) => <option key={ic} value={ic}>{ic}</option>)}</select>
              <input className={inputCls} value={it.title} maxLength={80} placeholder="Title" aria-label={`Item ${i + 1} title`} onChange={(e) => set({ items: items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
              <input className={inputCls} value={it.text} maxLength={300} placeholder="Text" aria-label={`Item ${i + 1} text`} onChange={(e) => set({ items: items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              <button type="button" onClick={() => set({ items: items.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">Remove</button>
            </div>
          ))}
          {items.length < 6 && <button type="button" className={btnSecondary} onClick={() => set({ items: [...items, { icon: "star", title: "", text: "" }] })}><Plus size={14} /> Add item</button>}
        </div>
      )}
      {has("items") && s.type === "logos" && (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid md:grid-cols-[2fr_1fr_1fr_auto] gap-2 items-start">
              <ImageField value={it.image_url} upload={upload} onChange={(v) => set({ items: items.map((x, j) => (j === i ? { ...x, image_url: v } : x)) })} />
              <input className={inputCls} value={it.link} placeholder="Link (optional)" aria-label={`Logo ${i + 1} link`} onChange={(e) => set({ items: items.map((x, j) => (j === i ? { ...x, link: e.target.value } : x)) })} />
              <input className={inputCls} value={it.alt} placeholder="Name" aria-label={`Logo ${i + 1} name`} onChange={(e) => set({ items: items.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)) })} />
              <button type="button" onClick={() => set({ items: items.filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline mt-2">Remove</button>
            </div>
          ))}
          {items.length < 24 && <button type="button" className={btnSecondary} onClick={() => set({ items: [...items, { image_url: "", link: "", alt: "" }] })}><Plus size={14} /> Add logo</button>}
        </div>
      )}
    </div>
  );
};

export const HomepageEditor: React.FC<{ initial: SiteAdmin["homepage"]; types: SectionType[]; icons: string[]; opts: Options; onSaved: () => void }> = ({ initial, types, icons, opts, onSaved }) => {
  const [cfg, setCfg] = useState<HomeConfig>(initial.draft);
  const [saved, setSaved] = useState(JSON.stringify(initial.draft));
  const [meta, setMeta] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [picked, setPicked] = useState<Map<string, PickedProduct>>(new Map());
  const remember = (ps: PickedProduct[]) => setPicked((m) => { const n = new Map(m); ps.forEach((p) => n.set(String(p.id), p)); return n; });
  const drag = useDrag(cfg.sections, (sections) => setCfg({ sections }));
  const typeOf = useMemo(() => new Map(types.map((t) => [t.type, t])), [types]);
  const dirty = JSON.stringify(cfg) !== saved;
  const setSection = (id: string, p: Partial<HomeSection>) => setCfg({ sections: cfg.sections.map((s) => (s.id === id ? { ...s, ...p } : s)) });

  const run = async (name: string, fn: () => Promise<void>) => { setBusy(name); try { await fn(); } catch (e) { toast.error(errText(e)); } finally { setBusy(""); } };
  const saveDraft = async () => { const r = await siteAdminApi.saveHomepage(cfg); setCfg(r.data); setSaved(JSON.stringify(r.data)); setWarnings(r.warnings || []); return r; };
  const refresh = async () => { const s = await siteAdminApi.get(); setMeta(s.homepage); onSaved(); };
  const onSave = () => run("save", async () => { toast.success((await saveDraft()).message); await refresh(); });
  const onPreview = () => run("preview", async () => { if (dirty) await saveDraft(); window.open("/?preview=draft", "_blank", "noopener"); });
  const onPublish = () => run("publish", async () => {
    if (dirty) await saveDraft();
    const r = await siteAdminApi.publishHomepage();
    setWarnings(r.warnings || []); toast.success(r.message); await refresh();
  });
  const onReset = () => run("reset", async () => {
    if (!window.confirm("Replace the draft with the standard homepage? The live homepage doesn't change until you publish.")) return;
    const r = await siteAdminApi.resetHomepage(); setCfg(r.data); setSaved(JSON.stringify(r.data)); toast.success(r.message); await refresh();
  });
  const onRestore = (i: number) => run("restore", async () => {
    if (dirty && !window.confirm("You have unsaved changes. Replace them with this version?")) return;
    const r = await siteAdminApi.restoreHomepage(i); setCfg(r.data); setSaved(JSON.stringify(r.data)); setShowVersions(false); toast.success(r.message); await refresh();
  });
  const add = (type: string) => {
    const t = typeOf.get(type)!;
    const s: HomeSection = { id: newId(type.replace(/_/g, "-").slice(0, 12)), type, enabled: true, title: t.label, subtitle: "" } as HomeSection;
    if (t.sources.length) (s as any).source = t.sources[0];
    if (t.fields.includes("limit")) s.limit = Math.min(8, t.limit || 8);
    if (t.fields.includes("items")) s.items = [];
    if (type === "products") s.layout = "grid";
    if (type === "text") s.layout = "text";
    setCfg({ sections: [...cfg.sections, s] });
    setOpen(s.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Homepage</h3>
          <p className="text-sm text-gray-500">{meta.published_at ? `Published ${new Date(meta.published_at).toLocaleString()}` : "Showing the standard homepage. Publish to use your own."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowVersions(true)} className={btnSecondary}><History size={14} /> Versions</button>
          <button onClick={onReset} disabled={!!busy} className={btnSecondary}><RotateCcw size={14} /> Standard layout</button>
          <button onClick={onSave} disabled={!!busy || !dirty} className={btnSecondary}><Save size={14} /> {busy === "save" ? "Saving…" : "Save draft"}</button>
          <button onClick={onPreview} disabled={!!busy} className={btnSecondary}><Eye size={14} /> Preview</button>
          <button onClick={onPublish} disabled={!!busy} className={btnPrimary}><Send size={14} /> {busy === "publish" ? "Publishing…" : "Publish"}</button>
        </div>
      </div>
      {(dirty || meta.has_unpublished_changes) && <p className="text-sm bg-blue-50 text-blue-800 rounded-lg px-3 py-2">{dirty ? "Unsaved changes." : "The draft has changes that aren't published yet."} Visitors only see changes after you publish.</p>}
      {warnings.length > 0 && (
        <div className="text-sm bg-amber-50 text-amber-800 rounded-lg px-3 py-2">
          <p className="font-bold flex items-center gap-1"><AlertTriangle size={14} /> Some things won't show</p>
          <ul className="list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="space-y-2">
        {cfg.sections.map((s, i) => {
          const def = typeOf.get(s.type);
          const isOpen = open === s.id;
          return (
            <div key={s.id} {...drag.props(i)}>
              <Card className={`p-3 ${s.enabled ? "" : "opacity-60"} ${drag.over === i ? "ring-2 ring-blue-300" : ""}`}>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen} className="flex-1 flex items-center gap-2 text-left min-w-0">
                    {isOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                    <span className="min-w-0">
                      <span className="block font-bold text-gray-900 truncate">{s.title || def?.label || s.type}</span>
                      <span className="block text-xs text-gray-500">{def?.label}{(s as any).source ? ` · ${SOURCE_LABELS[(s as any).source] || (s as any).source}` : ""}{!s.enabled ? " · hidden" : ""}</span>
                    </span>
                  </button>
                  <RowTools i={i} count={cfg.sections.length} label={s.title || s.type} handle={drag.handle(i)} onMove={(to) => setCfg({ sections: move(cfg.sections, i, to) })}
                    hidden={!s.enabled} onToggle={() => setSection(s.id, { enabled: !s.enabled })}
                    onDuplicate={s.type !== "hero" && cfg.sections.length < 30 ? () => { const n = [...cfg.sections]; n.splice(i + 1, 0, { ...s, id: newId(s.type.slice(0, 10)) }); setCfg({ sections: n }); } : undefined}
                    onRemove={() => setCfg({ sections: cfg.sections.filter((x) => x.id !== s.id) })} />
                </div>
                {isOpen && def && (
                  <div className="pt-3 mt-3 border-t border-gray-100">
                    {HINTS[s.type] && <p className="text-xs text-gray-500 mb-3">{HINTS[s.type]}</p>}
                    {def.fields.length || !["hero", "banners", "feature_tiles"].includes(s.type) ? (
                      <SectionFields s={s} def={def} set={(p) => setSection(s.id, p)} opts={opts} icons={icons} picked={picked} remember={remember} />
                    ) : null}
                  </div>
                )}
              </Card>
            </div>
          );
        })}
      </div>
      {cfg.sections.length < 30 && (
        <Card className="p-4">
          <p className="text-xs font-bold text-gray-500 uppercase mb-2">Add a section</p>
          <div className="flex flex-wrap gap-2">
            {types.filter((t) => t.type !== "hero" || !cfg.sections.some((s) => s.type === "hero")).map((t) => <button key={t.type} onClick={() => add(t.type)} className={btnSecondary} title={HINTS[t.type]}><Plus size={14} /> {t.label}</button>)}
          </div>
        </Card>
      )}

      {showVersions && (
        <Modal title="Published versions" onClose={() => setShowVersions(false)}>
          {meta.versions.length === 0 ? <p className="text-sm text-gray-500">Nothing published yet.</p> : (
            <ul className="divide-y divide-gray-100">
              {meta.versions.map((v) => (
                <li key={v.index} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{new Date(v.at).toLocaleString()}{v.index === 0 ? <span className="ml-2 text-xs text-green-700">live</span> : null}<span className="block text-xs text-gray-500">{v.sections} sections</span></span>
                  <button onClick={() => onRestore(v.index)} className={btnSecondary} disabled={!!busy}>Copy to draft</button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
};
