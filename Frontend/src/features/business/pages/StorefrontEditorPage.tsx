// Business → Storefront: arrange the company's public page from predefined sections, preview it, publish it.
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Eye, EyeOff, History, Plus, RotateCcw, Trash2, ExternalLink, Send, Save, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { catalogApi, Category, CompanyBrand } from "../api/catalog.api";
import { storefrontApi, StorefrontState, StoreConfig, SectionConfig, SectionType, Collection, PickedProduct } from "../api/storefront.api";
import { Card, PageHeader, Spinner, Modal, Field, inputCls, btnPrimary, btnSecondary, btnDanger, dateTime } from "../components/ui";
import { ProductPicker, ChipSelect, ImageField } from "../components/pickers";
import type { Storefront } from "../../marketplace/api";
import { StorefrontSections, CompanyHeader } from "../../marketplace/storefront";

const newId = (type: string) => `${type.replace(/_/g, "-").slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}`;
const LAYOUT_LABELS: Record<string, string> = { full: "Full width", split: "Image beside text", row: "Side by side", stack: "Stacked", grid: "Grid", carousel: "Scrolling row", list: "List", logos: "Logos", tiles: "Tiles", bar: "Thin bar", card: "Card", text: "Text only" };
const HINTS: Record<string, string> = {
  hero: "A large banner at the top of your page.",
  promo_banners: "Up to 6 clickable promotional images.",
  featured_products: "Products you pick. Leave empty to show your featured products.",
  product_grid: "Your latest products, optionally from one category or brand.",
  collection: "Products from one of your collections.",
  featured_brands: "Brands you supply. Leave empty to show all of them.",
  category_tiles: "Categories to browse. Leave empty to show your main ones.",
  announcement: "A short message, e.g. delivery cut-off times or a holiday notice.",
  about: "Tell buyers about your business.",
  contact: "Your public contact details and terms (set in Business settings).",
  deals: "Products with quantity discounts or special prices.",
};

/** Fields for one section, depending on its type. */
const SectionFields: React.FC<{
  s: SectionConfig; def: SectionType; set: (patch: Partial<SectionConfig>) => void;
  brands: CompanyBrand[]; categories: Category[]; collections: Collection[];
  picked: Map<string, PickedProduct>; remember: (p: PickedProduct[]) => void;
  search: (q: string) => Promise<PickedProduct[]>; upload: (f: File) => Promise<string>;
}> = ({ s, def, set, brands, categories, collections, picked, remember, search, upload }) => {
  const has = (f: string) => def.fields.includes(f);
  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Title"><input className={inputCls} value={s.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Subtitle"><input className={inputCls} value={s.subtitle} maxLength={240} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
        {def.layouts.length > 1 && (
          <Field label="Layout">
            <select className={inputCls} value={s.layout} onChange={(e) => set({ layout: e.target.value })}>
              {def.layouts.map((l) => <option key={l} value={l}>{LAYOUT_LABELS[l] || l}</option>)}
            </select>
          </Field>
        )}
      </div>
      {has("image_url") && (
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Image"><ImageField value={s.image_url || ""} onChange={(v) => set({ image_url: v })} upload={upload} /></Field>
          <Field label="Image description" hint="For screen readers and if the image can't load"><input className={inputCls} value={s.image_alt || ""} maxLength={200} onChange={(e) => set({ image_alt: e.target.value })} /></Field>
        </div>
      )}
      {has("text") && <Field label="Text"><textarea rows={s.type === "about" ? 5 : 2} className={inputCls} value={s.text || ""} maxLength={4000} onChange={(e) => set({ text: e.target.value })} /></Field>}
      {has("link") && (
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Link" hint="A page on this site (/products?q=…) or https://…"><input className={inputCls} value={s.link || ""} onChange={(e) => set({ link: e.target.value })} placeholder="/products?featured=1" /></Field>
          {has("link_label") && <Field label="Button text"><input className={inputCls} value={s.link_label || ""} maxLength={60} onChange={(e) => set({ link_label: e.target.value })} placeholder="Shop now" /></Field>}
        </div>
      )}
      {has("product_ids") && (
        <Field label="Products">
          <ProductPicker max={48} search={search}
            value={(s.product_ids || []).map((id) => picked.get(String(id)) || { id, title: `Product #${id}` })}
            onChange={(v) => { remember(v); set({ product_ids: v.map((p) => String(p.id)) }); }} />
        </Field>
      )}
      {has("collection_id") && (
        <Field label="Collection" hint={collections.length ? undefined : "Create one under Collections first"}>
          <select className={inputCls} value={s.collection_id || ""} onChange={(e) => set({ collection_id: e.target.value || null })}>
            <option value="">Choose a collection…</option>
            {collections.map((c) => <option key={c.id} value={String(c.id)}>{c.name}{c.live ? "" : " (not live)"}</option>)}
          </select>
        </Field>
      )}
      {(has("category_id") || has("brand_id") || has("sort") || has("limit")) && (
        <div className="grid md:grid-cols-4 gap-3">
          {has("category_id") && (
            <Field label="Only category">
              <select className={inputCls} value={s.category_id || ""} onChange={(e) => set({ category_id: e.target.value || null })}>
                <option value="">Any</option>{categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </Field>
          )}
          {has("brand_id") && (
            <Field label="Only brand">
              <select className={inputCls} value={s.brand_id || ""} onChange={(e) => set({ brand_id: e.target.value || null })}>
                <option value="">Any</option>{brands.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
            </Field>
          )}
          {has("sort") && (
            <Field label="Order">
              <select className={inputCls} value={s.sort || "newest"} onChange={(e) => set({ sort: e.target.value })}>
                <option value="newest">Newest first</option><option value="featured">Featured first</option><option value="title">Name A–Z</option>
              </select>
            </Field>
          )}
          {has("limit") && <Field label="How many"><input type="number" min={1} max={48} className={inputCls} value={s.limit ?? 8} onChange={(e) => set({ limit: Number(e.target.value) })} /></Field>}
        </div>
      )}
      {has("brand_ids") && <Field label="Brands"><ChipSelect options={brands} value={s.brand_ids || []} max={40} onChange={(v) => set({ brand_ids: v })} empty="Add the brands you supply under Catalogue first" /></Field>}
      {has("category_ids") && <Field label="Categories"><ChipSelect options={categories} value={s.category_ids || []} max={24} onChange={(v) => set({ category_ids: v })} /></Field>}
      {has("items") && (
        <div className="space-y-3">
          {(s.items || []).map((it, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="flex justify-between items-center"><p className="text-xs font-bold text-gray-500 uppercase">Banner {i + 1}</p>
                <button type="button" onClick={() => set({ items: (s.items || []).filter((_, j) => j !== i) })} className="text-xs text-red-600 hover:underline">Remove</button></div>
              <ImageField value={it.image_url} upload={upload} onChange={(v) => set({ items: (s.items || []).map((x, j) => (j === i ? { ...x, image_url: v } : x)) })} />
              <div className="grid md:grid-cols-3 gap-2">
                {(["title", "image_alt", "link"] as const).map((k) => (
                  <input key={k} className={inputCls} value={it[k] || ""} aria-label={k} placeholder={k === "title" ? "Title (optional)" : k === "image_alt" ? "Image description" : "Link (optional)"}
                    onChange={(e) => set({ items: (s.items || []).map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
                ))}
              </div>
            </div>
          ))}
          {(s.items || []).length < 6 && <button type="button" className={btnSecondary} onClick={() => set({ items: [...(s.items || []), { image_url: "", image_alt: "", title: "", link: "" }] })}><Plus size={14} /> Add banner</button>}
        </div>
      )}
    </div>
  );
};

export const StorefrontEditorPage: React.FC = () => {
  const { companyId, company, can } = useBusiness();
  const editable = can("storefront.manage") || can("company.manage");
  const [state, setState] = useState<StorefrontState | null>(null);
  const [cfg, setCfg] = useState<StoreConfig | null>(null);
  const [saved, setSaved] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [preview, setPreview] = useState<Storefront | null>(null);
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof storefrontApi.versions>> | null>(null);
  const [brands, setBrands] = useState<CompanyBrand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [picked, setPicked] = useState<Map<string, PickedProduct>>(new Map());
  const remember = (ps: PickedProduct[]) => setPicked((m) => { const n = new Map(m); ps.forEach((p) => n.set(String(p.id), p)); return n; });

  const load = async () => {
    try {
      const s = await storefrontApi.get(companyId!);
      setState(s);
      setCfg(s.draft);
      setSaved(JSON.stringify(s.draft));
      // names for products already chosen
      const ids = s.draft.sections.flatMap((x) => x.product_ids || []);
      if (ids.length) {
        storefrontApi.preview(companyId!).then((p) => remember(p.sections.flatMap((x) => (x.products || []).map((pr) => ({ id: pr.id, title: pr.title, brand: pr.brand, sku: (pr as any).sku }))))).catch(() => {});
      }
    } catch (e) { toast.error(errorMessage(e)); }
  };
  useEffect(() => {
    if (!companyId) return;
    load();
    catalogApi.brands(companyId).then(setBrands).catch(() => {});
    catalogApi.categories(companyId).then(setCategories).catch(() => {});
    storefrontApi.collections(companyId).then(setCollections).catch(() => {});
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!cfg && JSON.stringify(cfg) !== saved;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const types = useMemo(() => new Map((state?.section_types || []).map((t) => [t.type, t])), [state]);
  const search = async (q: string) => ((await catalogApi.products(companyId!, { search: q, limit: 20 })).products || []) as PickedProduct[];
  const upload = (f: File) => storefrontApi.uploadImage(companyId!, f);

  if (!state || !cfg) return <Spinner />;

  const setSection = (id: string, patch: Partial<SectionConfig>) => setCfg({ ...cfg, sections: cfg.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const move = (i: number, d: number) => {
    const n = [...cfg.sections]; const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; setCfg({ ...cfg, sections: n });
  };
  const addSection = (type: string) => {
    const def = types.get(type)!;
    const s: SectionConfig = { id: newId(type), type, enabled: true, title: def.label, subtitle: "", layout: def.layouts[0] };
    if (def.fields.includes("limit")) s.limit = 8;
    if (def.fields.includes("items")) s.items = [];
    setCfg({ ...cfg, sections: [...cfg.sections, s] });
    setOpen(s.id);
  };

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try { await fn(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };
  const saveDraft = async () => {
    const r = await storefrontApi.save(companyId!, cfg);
    setCfg(r.data); setSaved(JSON.stringify(r.data)); setWarnings(r.warnings || []);
    return r;
  };
  const onSave = () => run("save", async () => { toast.success((await saveDraft()).message); });
  const onPreview = () => run("preview", async () => { if (dirty) await saveDraft(); setPreview(await storefrontApi.preview(companyId!)); });
  const onPublish = () => run("publish", async () => {
    if (dirty) await saveDraft();
    const r = await storefrontApi.publish(companyId!);
    setWarnings(r.warnings || []); toast.success(r.message); await load();
  });
  const onUnpublish = () => run("unpublish", async () => {
    if (!window.confirm("Turn off your custom storefront? Customers will see the standard company page. Your draft is kept.")) return;
    toast.success((await storefrontApi.unpublish(companyId!)).message); await load();
  });
  const onReset = () => run("reset", async () => {
    if (!window.confirm("Replace your draft with the standard layout? Your published page doesn't change until you publish.")) return;
    const r = await storefrontApi.reset(companyId!); setCfg(r.data); setSaved(JSON.stringify(r.data)); toast.success(r.message);
  });
  const onVersions = () => run("versions", async () => setVersions(await storefrontApi.versions(companyId!)));
  const onRestore = (v: number) => run("restore", async () => {
    if (dirty && !window.confirm("You have unsaved changes. Replace them with this version?")) return;
    const r = await storefrontApi.restore(companyId!, v); setCfg(r.data); setSaved(JSON.stringify(r.data)); setVersions(null); toast.success(r.message);
  });

  const theme = state.themes.find((t) => t.key === cfg.theme) || state.themes[0];

  return (
    <div>
      <PageHeader
        title="Storefront"
        subtitle={state.published ? `Published version ${state.published_version} · ${dateTime(state.published_at)}` : "Not published yet: customers see the standard company page"}
        actions={
          <div className="flex flex-wrap gap-2">
            {state.company_live && <a href={`/companies/${state.slug}`} target="_blank" rel="noreferrer" className={btnSecondary}>View live <ExternalLink size={14} /></a>}
            <button onClick={onVersions} className={btnSecondary} disabled={!!busy}><History size={14} /> Versions</button>
            <button onClick={onPreview} className={btnSecondary} disabled={!!busy}><Eye size={14} /> {busy === "preview" ? "Loading…" : "Preview"}</button>
            {editable && <button onClick={onSave} className={btnSecondary} disabled={!!busy || !dirty}><Save size={14} /> {busy === "save" ? "Saving…" : "Save draft"}</button>}
            {editable && <button onClick={onPublish} className={btnPrimary} disabled={!!busy}><Send size={14} /> {busy === "publish" ? "Publishing…" : "Publish"}</button>}
          </div>
        }
      />

      {!state.company_live && <p className="mb-4 rounded-lg bg-amber-50 text-amber-800 text-sm px-4 py-3">Your business is waiting for approval, so the storefront isn't public yet. You can still build and preview it.</p>}
      {!state.storefront_published && <p className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-4 py-3">The marketplace team has hidden your store page. Contact support to have it shown again.</p>}
      {(dirty || state.has_unpublished_changes) && <p className="mb-4 rounded-lg bg-blue-50 text-blue-800 text-sm px-4 py-3">{dirty ? "You have unsaved changes." : "Your draft has changes that aren't published yet."} Customers only see changes after you publish.</p>}
      {warnings.length > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 text-amber-800 text-sm px-4 py-3">
          <p className="font-bold flex items-center gap-1"><AlertTriangle size={14} /> Some things won't show</p>
          <ul className="list-disc pl-5 mt-1">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="space-y-3">
          {cfg.sections.map((s, i) => {
            const def = types.get(s.type);
            const isOpen = open === s.id;
            return (
              <Card key={s.id} className={`${s.enabled ? "" : "opacity-70"}`}>
                <div className="flex items-center gap-2 px-4 py-3">
                  <button onClick={() => setOpen(isOpen ? null : s.id)} className="flex-1 flex items-center gap-2 text-left min-w-0" aria-expanded={isOpen}>
                    {isOpen ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
                    <span className="min-w-0">
                      <span className="block font-bold text-gray-900 truncate">{s.title || def?.label || s.type}</span>
                      <span className="block text-xs text-gray-500">{def?.label || "Turned off by the marketplace: remove this section before saving"}{!s.enabled && " · hidden"}</span>
                    </span>
                  </button>
                  {editable && (
                    <>
                      <button onClick={() => setSection(s.id, { enabled: !s.enabled })} className="p-1.5 text-gray-400 hover:text-gray-800" aria-label={s.enabled ? "Hide section" : "Show section"} title={s.enabled ? "Hide" : "Show"}>{s.enabled ? <Eye size={16} /> : <EyeOff size={16} />}</button>
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1.5 text-gray-400 hover:text-gray-800 disabled:opacity-30" aria-label="Move up"><ArrowUp size={16} /></button>
                      <button onClick={() => move(i, 1)} disabled={i === cfg.sections.length - 1} className="p-1.5 text-gray-400 hover:text-gray-800 disabled:opacity-30" aria-label="Move down"><ArrowDown size={16} /></button>
                      <button onClick={() => { const c = { ...s, id: newId(s.type) }; const n = [...cfg.sections]; n.splice(i + 1, 0, c); setCfg({ ...cfg, sections: n }); }} disabled={cfg.sections.length >= 30} className="p-1.5 text-gray-400 hover:text-gray-800" aria-label="Duplicate" title="Duplicate"><Copy size={15} /></button>
                      <button onClick={() => setCfg({ ...cfg, sections: cfg.sections.filter((x) => x.id !== s.id) })} className="p-1.5 text-gray-400 hover:text-red-600" aria-label="Remove section" title="Remove"><Trash2 size={15} /></button>
                    </>
                  )}
                </div>
                {isOpen && def && (
                  <fieldset disabled={!editable} className="px-4 pb-4 pt-1 border-t border-gray-100">
                    {HINTS[s.type] && <p className="text-xs text-gray-500 mb-3 mt-2">{HINTS[s.type]}</p>}
                    <SectionFields s={s} def={def} set={(p) => setSection(s.id, p)} brands={brands} categories={categories} collections={collections}
                      picked={picked} remember={remember} search={search} upload={upload} />
                  </fieldset>
                )}
              </Card>
            );
          })}
          {cfg.sections.length === 0 && <Card className="p-6 text-sm text-gray-500 text-center">No sections. Add one below, or reset to the standard layout.</Card>}
          {editable && cfg.sections.length < 30 && (
            <Card className="p-4">
              <p className="text-xs font-bold text-gray-500 uppercase mb-2">Add a section</p>
              <div className="flex flex-wrap gap-2">
                {state.section_types.map((t) => <button key={t.type} onClick={() => addSection(t.type)} className={btnSecondary} title={HINTS[t.type]}><Plus size={14} /> {t.label}</button>)}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-4">
          <Card className="p-4 space-y-3">
            <p className="font-bold text-gray-900">Look</p>
            <fieldset disabled={!editable} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {state.themes.map((t) => (
                  <button key={t.key} type="button" onClick={() => setCfg({ ...cfg, theme: t.key })} aria-pressed={cfg.theme === t.key}
                    className={`rounded-lg border p-2 text-left text-sm ${cfg.theme === t.key ? "border-blue-600 ring-2 ring-blue-100" : "border-gray-200 hover:border-gray-400"}`}>
                    <span className="flex gap-1 mb-1"><span className="w-4 h-4 rounded" style={{ background: t.primary }} /><span className="w-4 h-4 rounded" style={{ background: t.accent }} /></span>
                    <span className="font-semibold text-gray-800">{t.name}</span>
                  </button>
                ))}
              </div>
              {state.custom_colors && (
                <div className="grid grid-cols-2 gap-2">
                  {(["primary", "accent"] as const).map((k) => (
                    <label key={k} className="text-xs font-bold text-gray-600 uppercase">
                      {k === "primary" ? "Main colour" : "Accent"}
                      <span className="flex items-center gap-2 mt-1">
                        <input type="color" value={cfg.colors?.[k] || theme?.[k] || "#000000"} onChange={(e) => setCfg({ ...cfg, colors: { ...cfg.colors, [k]: e.target.value } })} className="w-9 h-9 rounded border border-gray-200" />
                        {cfg.colors?.[k] && <button type="button" onClick={() => { const c = { ...cfg.colors }; delete c[k]; setCfg({ ...cfg, colors: c }); }} className="text-xs font-normal normal-case text-blue-600 hover:underline">Theme default</button>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          </Card>
          <Card className="p-4 space-y-2 text-sm">
            <p className="font-bold text-gray-900">Page details</p>
            <p className="text-gray-500">Logo, banner, tagline, contact details and terms come from <Link to="/business/settings" className="text-blue-600 hover:underline">Business settings</Link>. Product groups come from <Link to="/business/collections" className="text-blue-600 hover:underline">Collections</Link>.</p>
            {company?.slug && <p className="text-gray-500">Address: <span className="font-mono text-gray-700">/companies/{company.slug}</span></p>}
          </Card>
          {editable && (
            <Card className="p-4 flex flex-wrap gap-2">
              <button onClick={onReset} className={btnSecondary} disabled={!!busy}><RotateCcw size={14} /> Reset draft</button>
              {state.published && <button onClick={onUnpublish} className={btnDanger} disabled={!!busy}>Unpublish</button>}
            </Card>
          )}
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex flex-col" role="dialog" aria-modal="true" aria-label="Storefront preview">
          <div className="bg-solid text-white px-4 py-2 flex items-center justify-between text-sm">
            <span><b>Preview</b> of your draft, as a logged-out visitor would see it</span>
            <div className="flex gap-2">
              {editable && <button onClick={() => { setPreview(null); onPublish(); }} className="bg-blue-600 px-3 py-1.5 rounded font-semibold">Publish</button>}
              <button onClick={() => setPreview(null)} className="bg-white/10 px-3 py-1.5 rounded font-semibold">Close</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 py-6">
              <CompanyHeader store={preview} tab="home" setTab={() => {}} />
              <StorefrontSections store={preview} />
            </div>
          </div>
        </div>
      )}

      {versions && (
        <Modal title="Published versions" onClose={() => setVersions(null)}>
          {versions.length === 0 ? <p className="text-sm text-gray-500">Nothing published yet.</p> : (
            <ul className="divide-y divide-gray-100">
              {versions.map((v) => (
                <li key={v.version} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span><b>Version {v.version}</b>{v.version === state.published_version && state.published ? <span className="ml-2 text-xs text-green-700">live</span> : null}<span className="block text-xs text-gray-500">{dateTime(v.published_at)}{v.published_by ? ` · ${v.published_by.first_name || v.published_by.email}` : ""}</span></span>
                  {editable && <button onClick={() => onRestore(v.version)} className={btnSecondary} disabled={!!busy}>Copy to draft</button>}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
};
