// Business → Collections: hand-picked product lists for the storefront (e.g. "Summer deals", "New this month").
import React, { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ExternalLink, Layers } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { catalogApi } from "../api/catalog.api";
import { storefrontApi, Collection, PickedProduct } from "../api/storefront.api";
import { Card, PageHeader, Spinner, EmptyState, Modal, Field, inputCls, btnPrimary, btnSecondary, btnDanger, dateOnly } from "../components/ui";
import { ProductPicker, ImageField } from "../components/pickers";

export const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export const liveLabel = (c: Collection) => {
  const now = Date.now();
  if (c.status !== "published") return { text: "Draft", tone: "bg-gray-100 text-gray-600" };
  if (!c.is_enabled) return { text: "Turned off", tone: "bg-gray-100 text-gray-600" };
  if (c.starts_at && new Date(c.starts_at).getTime() > now) return { text: `Starts ${dateOnly(c.starts_at)}`, tone: "bg-blue-50 text-blue-700" };
  if (c.ends_at && new Date(c.ends_at).getTime() < now) return { text: "Ended", tone: "bg-amber-50 text-amber-700" };
  return { text: "Live", tone: "bg-green-50 text-green-700" };
};

type Draft = {
  id?: number; name: string; slug: string; description: string; cover_image_url: string;
  status: "draft" | "published"; is_enabled: boolean; starts_at: string; ends_at: string; products: PickedProduct[];
};
const blank: Draft = { name: "", slug: "", description: "", cover_image_url: "", status: "draft", is_enabled: true, starts_at: "", ends_at: "", products: [] };

/** The form for one collection; used by companies and (with other callbacks) by platform admins. */
export const CollectionForm: React.FC<{
  initial: Draft;
  searchProducts: (q: string) => Promise<PickedProduct[]>;
  uploadImage?: (f: File) => Promise<string>;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  publicPath?: (slug: string) => string;
}> = ({ initial, searchProducts, uploadImage, onSave, onCancel, publicPath }) => {
  const [d, setD] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        name: d.name, slug: d.slug || undefined, description: d.description, cover_image_url: d.cover_image_url,
        status: d.status, is_enabled: d.is_enabled, starts_at: fromLocalInput(d.starts_at), ends_at: fromLocalInput(d.ends_at),
        product_ids: d.products.map((p) => p.id),
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Name"><input className={inputCls} value={d.name} onChange={(e) => set("name", e.target.value)} required maxLength={255} /></Field>
        <Field label="Web address" hint={d.slug && publicPath ? publicPath(d.slug) : "Made from the name if left empty"}>
          <input className={inputCls} value={d.slug} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="summer-deals" />
        </Field>
      </div>
      <Field label="Description"><textarea rows={2} className={inputCls} value={d.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <Field label="Cover image"><ImageField value={d.cover_image_url} onChange={(v) => set("cover_image_url", v)} upload={uploadImage} label="Cover image" /></Field>
      <div className="grid md:grid-cols-4 gap-4">
        <Field label="Status">
          <select className={inputCls} value={d.status} onChange={(e) => set("status", e.target.value as Draft["status"])}>
            <option value="draft">Draft (hidden)</option><option value="published">Published</option>
          </select>
        </Field>
        <Field label="Shown">
          <label className="flex items-center gap-2 h-[38px] text-sm text-gray-700"><input type="checkbox" checked={d.is_enabled} onChange={(e) => set("is_enabled", e.target.checked)} /> Turned on</label>
        </Field>
        <Field label="Starts" hint="Optional"><input type="datetime-local" className={inputCls} value={d.starts_at} onChange={(e) => set("starts_at", e.target.value)} /></Field>
        <Field label="Ends" hint="Optional"><input type="datetime-local" className={inputCls} value={d.ends_at} min={d.starts_at || undefined} onChange={(e) => set("ends_at", e.target.value)} /></Field>
      </div>
      <Field label={`Products (${d.products.length})`} hint="Customers see them in this order. Products that aren't published are skipped.">
        <ProductPicker value={d.products} onChange={(v) => set("products", v)} search={searchProducts} />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
        <button disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save collection"}</button>
      </div>
    </form>
  );
};

export const draftOf = (c?: Collection): Draft => c ? {
  id: c.id, name: c.name, slug: c.slug, description: c.description || "", cover_image_url: c.cover_image_url || "",
  status: c.status, is_enabled: c.is_enabled, starts_at: toLocalInput(c.starts_at), ends_at: toLocalInput(c.ends_at), products: c.products || [],
} : blank;

export const CollectionsPage: React.FC = () => {
  const { companyId, company, can } = useBusiness();
  const editable = can("products.manage") || can("storefront.manage");
  const [rows, setRows] = useState<Collection[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);

  const load = () => storefrontApi.collections(companyId!).then(setRows).catch((e) => { toast.error(errorMessage(e)); setRows([]); });
  useEffect(() => { if (companyId) load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (c?: Collection) => {
    if (!c) return setEditing({ ...blank });
    try { setEditing(draftOf(await storefrontApi.collection(companyId!, c.id))); } catch (e) { toast.error(errorMessage(e)); }
  };
  const search = async (q: string) => {
    const r = await catalogApi.products(companyId!, { search: q, limit: 20 });
    return (r.products || []) as PickedProduct[];
  };
  const save = async (body: Record<string, unknown>) => {
    if (editing?.id) await storefrontApi.updateCollection(companyId!, editing.id, body);
    else await storefrontApi.createCollection(companyId!, body);
    toast.success("Collection saved");
    setEditing(null);
    load();
  };
  const remove = async (c: Collection) => {
    if (!window.confirm(`Delete the collection "${c.name}"? The products themselves are not affected.`)) return;
    try { toast.success((await storefrontApi.deleteCollection(companyId!, c.id)).message); load(); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div>
      <PageHeader title="Collections" subtitle="Hand-picked groups of products to feature on your store page"
        actions={editable && <button onClick={() => open()} className={btnPrimary}><Plus size={16} /> New collection</button>} />
      {!rows ? <Spinner /> : rows.length === 0 ? (
        <Card><EmptyState icon={<Layers />} title="No collections yet" text="Group products for a promotion, a season or a type of customer, then show the collection on your storefront."
          action={editable && <button onClick={() => open()} className={btnPrimary}><Plus size={16} /> New collection</button>} /></Card>
      ) : (
        <Card className="divide-y divide-gray-100">
          {rows.map((c) => {
            const l = liveLabel(c);
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="w-14 h-14 rounded-lg bg-gray-100 overflow-hidden shrink-0">{c.cover_image_url && <img src={c.cover_image_url} alt="" className="w-full h-full object-cover" />}</div>
                <div className="flex-1 min-w-[180px]">
                  <p className="font-bold text-gray-900">{c.name} <span className={`ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full ${l.tone}`}>{l.text}</span></p>
                  <p className="text-sm text-gray-500">{c.product_count ?? 0} products · /{c.slug}{c.ends_at ? ` · ends ${dateOnly(c.ends_at)}` : ""}</p>
                </div>
                {c.live && company?.slug && (
                  <a href={`/companies/${company.slug}/collections/${c.slug}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-600 inline-flex items-center gap-1 hover:underline">View <ExternalLink size={13} /></a>
                )}
                {editable && (
                  <>
                    <button onClick={() => open(c)} className={btnSecondary}><Pencil size={14} /> Edit</button>
                    <button onClick={() => remove(c)} className={btnDanger} aria-label={`Delete ${c.name}`}><Trash2 size={14} /></button>
                  </>
                )}
              </div>
            );
          })}
        </Card>
      )}
      {editing && (
        <Modal title={editing.id ? `Edit “${editing.name}”` : "New collection"} onClose={() => setEditing(null)} wide>
          <CollectionForm initial={editing} searchProducts={search} uploadImage={(f) => storefrontApi.uploadImage(companyId!, f)}
            onSave={save} onCancel={() => setEditing(null)} publicPath={(s) => `/companies/${company?.slug}/collections/${s}`} />
        </Modal>
      )}
    </div>
  );
};
