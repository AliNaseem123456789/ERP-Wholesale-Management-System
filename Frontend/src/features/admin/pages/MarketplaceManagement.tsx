// Platform admin → Marketplace: top menu, featured categories / brands / suppliers, homepage banners,
// what companies may use on their storefronts, and platform-wide collections.
import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, Pencil, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { adminCatalogApi, MarketplaceSettings } from "../api/adminCatalog.api";
import { adminService } from "../api/admin.service";
import { errorMessage } from "../../business/api/business.api";
import { Card, Field, Modal, Spinner, inputCls, btnPrimary, btnSecondary, btnDanger, dateOnly } from "../../business/components/ui";
import { ChipSelect, ImageField } from "../../business/components/pickers";
import { CollectionForm, draftOf, liveLabel } from "../../business/pages/CollectionsPage";

type Opt = { id: number | string; name: string; slug: string };
const NAV_TYPES = [["link", "Page or web address"], ["category", "Category"], ["brand", "Brand"], ["company", "Supplier"], ["collection", "Platform collection"]] as const;

const moveIn = <T,>(a: T[], i: number, d: number) => {
  const n = [...a]; const j = i + d;
  if (j < 0 || j >= n.length) return a;
  [n[i], n[j]] = [n[j], n[i]];
  return n;
};

const PlatformCollections: React.FC = () => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [editing, setEditing] = useState<ReturnType<typeof draftOf> | null>(null);
  const load = () => adminCatalogApi.collections().then(setRows).catch((e) => { toast.error(errorMessage(e)); setRows([]); });
  useEffect(() => { load(); }, []);
  const open = async (c?: any) => {
    if (!c) return setEditing(draftOf());
    try {
      const d = await adminCatalogApi.collection(c.id);
      setEditing(draftOf({ ...d, products: (d.products || []).map((p: any) => ({ ...p, company: p.company?.name || p.company })) }));
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const save = async (body: Record<string, unknown>) => {
    if (editing?.id) await adminCatalogApi.updateCollection(editing.id, body);
    else await adminCatalogApi.createCollection(body);
    toast.success("Collection saved");
    setEditing(null);
    load();
  };
  const remove = async (c: any) => {
    if (!window.confirm(`Delete the platform collection "${c.name}"?`)) return;
    try { toast.success((await adminCatalogApi.deleteCollection(c.id)).message); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-gray-900">Platform collections</h3>
          <p className="text-sm text-gray-500">Products from any supplier, shown on the homepage (e.g. “Back to school”, “Best sellers”).</p>
        </div>
        <button onClick={() => open()} className={btnPrimary}><Plus size={16} /> New</button>
      </div>
      {!rows ? <Spinner /> : rows.length === 0 ? <p className="text-sm text-gray-500">None yet.</p> : (
        <div className="divide-y divide-gray-100">
          {rows.map((c) => {
            const l = liveLabel(c);
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex-1 min-w-[180px]">
                  <p className="font-semibold text-gray-900">{c.name} <span className={`ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full ${l.tone}`}>{l.text}</span></p>
                  <p className="text-xs text-gray-500">{c.product_count} products · /collections/{c.slug}{c.ends_at ? ` · ends ${dateOnly(c.ends_at)}` : ""}</p>
                </div>
                {c.live && <a href={`/collections/${c.slug}`} target="_blank" rel="noreferrer" className="text-sm text-blue-600 inline-flex items-center gap-1">View <ExternalLink size={13} /></a>}
                <button onClick={() => open(c)} className={btnSecondary}><Pencil size={14} /> Edit</button>
                <button onClick={() => remove(c)} className={btnDanger} aria-label={`Delete ${c.name}`}><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
      )}
      {editing && (
        <Modal title={editing.id ? `Edit “${editing.name}”` : "New platform collection"} onClose={() => setEditing(null)} wide>
          <CollectionForm initial={editing} onSave={save} onCancel={() => setEditing(null)} publicPath={(s) => `/collections/${s}`}
            searchProducts={async (q) => (await adminCatalogApi.searchProducts(q)).map((p) => ({ ...p, status: "published" }))} />
        </Modal>
      )}
    </Card>
  );
};

export const MarketplaceManagement: React.FC = () => {
  const [s, setS] = useState<MarketplaceSettings | null>(null);
  const [meta, setMeta] = useState<{ themes: { key: string; name: string }[]; sections: { type: string; label: string }[] }>({ themes: [], sections: [] });
  const [opts, setOpts] = useState<{ categories: Opt[]; brands: Opt[]; companies: Opt[]; collections: Opt[] }>({ categories: [], brands: [], companies: [], collections: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminCatalogApi.marketplace().then((r) => {
      setS(r.data);
      setMeta({ themes: r.all_themes, sections: r.all_sections });
      // make sure already-chosen brands show even if they're beyond the first page of the brand list
      setOpts((o) => ({ ...o, brands: [...o.brands, ...r.chosen.brands.filter((b) => !o.brands.some((x) => String(x.id) === String(b.id)))] }));
    }).catch((e) => toast.error(errorMessage(e)));
    adminCatalogApi.categories().then((c) => setOpts((o) => ({ ...o, categories: c.filter((x) => x.status === "active") }))).catch(() => {});
    adminCatalogApi.brands().then((b) => setOpts((o) => ({ ...o, brands: [...b, ...o.brands.filter((x) => !b.some((y: Opt) => String(y.id) === String(x.id)))] }))).catch(() => {});
    adminService.getCompanies({ status: "active" }).then((c: any[]) => setOpts((o) => ({ ...o, companies: c }))).catch(() => {});
    adminCatalogApi.collections().then((c) => setOpts((o) => ({ ...o, collections: c }))).catch(() => {});
  }, []);

  if (!s) return <Spinner />;
  const set = (patch: Partial<MarketplaceSettings>) => setS({ ...s, ...patch });
  const save = async () => {
    setSaving(true);
    try { const r = await adminCatalogApi.saveMarketplace(s); setS(r.data); toast.success(r.message); } catch (e) { toast.error(errorMessage(e)); } finally { setSaving(false); }
  };
  const refOptions = (t: string): Opt[] => (t === "category" ? opts.categories : t === "brand" ? opts.brands : t === "company" ? opts.companies : t === "collection" ? opts.collections : []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-gray-900">Marketplace</h2>
          <p className="text-sm text-gray-500">Menu, homepage and what suppliers can use on their store pages. Changes show within a few seconds of saving.</p>
        </div>
        <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save marketplace settings"}</button>
      </div>

      <Card className="p-5">
        <h3 className="font-bold text-gray-900">Top menu</h3>
        <p className="text-sm text-gray-500 mb-3">Shown in the dark bar under the header, before the classic category menu. Up to 12 items.</p>
        <div className="space-y-2">
          {s.nav.map((n, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_180px_1fr_auto] gap-2 items-center">
              <input className={inputCls} value={n.label} maxLength={40} placeholder="Label" aria-label="Menu label" onChange={(e) => set({ nav: s.nav.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <select className={inputCls} value={n.type} aria-label="Goes to" onChange={(e) => set({ nav: s.nav.map((x, j) => (j === i ? { ...x, type: e.target.value as any, ref: "" } : x)) })}>
                {NAV_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {n.type === "link" ? (
                <input className={inputCls} value={n.ref} placeholder="/products?featured=1 or https://…" aria-label="Address" onChange={(e) => set({ nav: s.nav.map((x, j) => (j === i ? { ...x, ref: e.target.value } : x)) })} />
              ) : (
                <select className={inputCls} value={n.ref} aria-label="Destination" onChange={(e) => set({ nav: s.nav.map((x, j) => (j === i ? { ...x, ref: e.target.value } : x)) })}>
                  <option value="">Choose…</option>
                  {refOptions(n.type).map((o) => <option key={o.id} value={o.slug}>{o.name}</option>)}
                  {n.ref && !refOptions(n.type).some((o) => o.slug === n.ref) && <option value={n.ref}>{n.ref}</option>}
                </select>
              )}
              <div className="flex gap-1">
                <button onClick={() => set({ nav: moveIn(s.nav, i, -1) })} className="p-1.5 text-gray-400 hover:text-gray-800" aria-label="Move up"><ArrowUp size={16} /></button>
                <button onClick={() => set({ nav: moveIn(s.nav, i, 1) })} className="p-1.5 text-gray-400 hover:text-gray-800" aria-label="Move down"><ArrowDown size={16} /></button>
                <button onClick={() => set({ nav: s.nav.filter((_, j) => j !== i) })} className="p-1.5 text-gray-400 hover:text-red-600" aria-label="Remove"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
          {s.nav.length < 12 && <button onClick={() => set({ nav: [...s.nav, { label: "", type: "link", ref: "" }] })} className={btnSecondary}><Plus size={14} /> Add menu item</button>}
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <h3 className="font-bold text-gray-900">Featured on the homepage</h3>
          <p className="text-sm text-gray-500">Leave a list empty to show the most popular ones automatically. Featured suppliers can also be set from Companies.</p>
        </div>
        <Field label="Categories"><ChipSelect options={opts.categories} value={s.featured.category_ids} onChange={(v) => set({ featured: { ...s.featured, category_ids: v } })} /></Field>
        <Field label="Brands"><ChipSelect options={opts.brands} value={s.featured.brand_ids} onChange={(v) => set({ featured: { ...s.featured, brand_ids: v } })} /></Field>
        <Field label="Suppliers"><ChipSelect options={opts.companies} value={s.featured.company_ids} onChange={(v) => set({ featured: { ...s.featured, company_ids: v } })} /></Field>
      </Card>

      <Card className="p-5">
        <h3 className="font-bold text-gray-900">Homepage banners</h3>
        <p className="text-sm text-gray-500 mb-3">Rotating banners at the top of the homepage. Wide images (about 1600×500) work best. Up to 8.</p>
        <div className="space-y-3">
          {s.banners.map((b, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="flex justify-between items-center">
                <p className="text-xs font-bold text-gray-500 uppercase">Banner {i + 1}</p>
                <div className="flex gap-1">
                  <button onClick={() => set({ banners: moveIn(s.banners, i, -1) })} className="p-1 text-gray-400 hover:text-gray-800" aria-label="Move up"><ArrowUp size={15} /></button>
                  <button onClick={() => set({ banners: moveIn(s.banners, i, 1) })} className="p-1 text-gray-400 hover:text-gray-800" aria-label="Move down"><ArrowDown size={15} /></button>
                  <button onClick={() => set({ banners: s.banners.filter((_, j) => j !== i) })} className="p-1 text-gray-400 hover:text-red-600" aria-label="Remove banner"><Trash2 size={15} /></button>
                </div>
              </div>
              <ImageField value={b.image_url} onChange={(v) => set({ banners: s.banners.map((x, j) => (j === i ? { ...x, image_url: v } : x)) })} />
              <div className="grid md:grid-cols-2 gap-2">
                {(["title", "subtitle", "image_alt", "link"] as const).map((k) => (
                  <input key={k} className={inputCls} value={b[k] || ""} aria-label={k}
                    placeholder={{ title: "Title (optional)", subtitle: "Subtitle (optional)", image_alt: "Image description", link: "Link: /categories/… or https://…" }[k]}
                    onChange={(e) => set({ banners: s.banners.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
                ))}
              </div>
            </div>
          ))}
          {s.banners.length < 8 && <button onClick={() => set({ banners: [...s.banners, { image_url: "", image_alt: "", title: "", subtitle: "", link: "" }] })} className={btnSecondary}><Plus size={14} /> Add banner</button>}
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <h3 className="font-bold text-gray-900">Supplier storefronts</h3>
          <p className="text-sm text-gray-500">What companies may use when designing their store page. Turning something off doesn't break published pages; it just can't be added or republished.</p>
        </div>
        <Field label="Themes"><ChipSelect options={meta.themes.map((t) => ({ id: t.key, name: t.name }))} value={s.storefront.themes} onChange={(v) => set({ storefront: { ...s.storefront, themes: v } })} /></Field>
        <Field label="Sections"><ChipSelect options={meta.sections.map((t) => ({ id: t.type, name: t.label }))} value={s.storefront.sections} onChange={(v) => set({ storefront: { ...s.storefront, sections: v } })} /></Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={s.storefront.custom_colors} onChange={(e) => set({ storefront: { ...s.storefront, custom_colors: e.target.checked } })} />
          Let companies choose their own colours
        </label>
      </Card>

      <PlatformCollections />
    </div>
  );
};
