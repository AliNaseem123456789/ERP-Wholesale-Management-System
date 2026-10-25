// Platform admin: the category tree, which details (attributes) each category uses, merging duplicates,
// and a catalogue health report.
import React, { useEffect, useMemo, useState } from "react";
import { FolderTree, Plus, Pencil, Merge, ListChecks, Trash2, Star, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { adminCatalogApi, AdminAttribute, AdminCategory } from "../api/adminCatalog.api";
import { errorMessage } from "../../business/api/business.api";
import { Card, Spinner, Modal, Field, inputCls, btnPrimary, btnSecondary, StatusBadge } from "../../business/components/ui";

const tree = (cats: AdminCategory[]) => {
  const out: (AdminCategory & { depth: number; path: string })[] = [];
  const walk = (parent: number | null, depth: number, prefix: string) => {
    for (const c of cats.filter((x) => (x.parent_id ?? null) === parent).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix} › ${c.name}` : c.name;
      out.push({ ...c, depth, path });
      walk(c.id, depth + 1, path);
    }
  };
  walk(null, 0, "");
  return out;
};

const CategoryForm: React.FC<{ category: AdminCategory | null; all: AdminCategory[]; templates: { key: string; name: string }[]; onClose: () => void; onSaved: () => void }> = ({ category, all, templates, onClose, onSaved }) => {
  const [f, setF] = useState({
    name: category?.name || "", slug: category?.slug || "", parent_id: category?.parent_id ? String(category.parent_id) : "", description: category?.description || "",
    image_url: category?.image_url || "", is_featured: !!category?.is_featured, sort_order: String(category?.sort_order ?? 0), status: category?.status || "active", template: "",
  });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body: Record<string, unknown> = { ...f, parent_id: f.parent_id || null, sort_order: Number(f.sort_order) || 0 };
      if (!f.template) delete body.template;
      if (category) {
        delete body.template;
        await adminCatalogApi.updateCategory(category.id, body);
      } else await adminCatalogApi.createCategory(body);
      toast.success("Category saved");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal title={category ? `Edit ${category.name}` : "New category"} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Name *"><input required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Inside">
          <select className={inputCls} value={f.parent_id} onChange={(e) => setF({ ...f, parent_id: e.target.value })}>
            <option value="">Top level</option>
            {tree(all).filter((c) => c.id !== category?.id).map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Web address"><input className={inputCls} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} placeholder="auto" /></Field>
          <Field label="Order"><input type="number" className={inputCls} value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} /></Field>
        </div>
        <Field label="Description"><textarea rows={2} className={inputCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Image address"><input className={inputCls} value={f.image_url} onChange={(e) => setF({ ...f, image_url: e.target.value })} placeholder="https://…" /></Field>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_featured} onChange={(e) => setF({ ...f, is_featured: e.target.checked })} /> Featured</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.status === "hidden"} onChange={(e) => setF({ ...f, status: e.target.checked ? "hidden" : "active" })} /> Hidden</label>
        </div>
        {!category && (
          <Field label="Details template" hint="Adds the usual details for this kind of product (you can change them after)">
            <select className={inputCls} value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}>
              <option value="">None</option>
              {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          </Field>
        )}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Save</button></div>
      </form>
    </Modal>
  );
};

const AttributesModal: React.FC<{ category: AdminCategory; templates: { key: string; name: string }[]; onClose: () => void; onSaved: () => void }> = ({ category, templates, onClose, onSaved }) => {
  const [linked, setLinked] = useState<{ attribute_id: number; is_required: boolean; name: string; data_type: string; is_variant_option: boolean }[] | null>(null);
  const [all, setAll] = useState<AdminAttribute[]>([]);
  const load = () =>
    Promise.all([adminCatalogApi.categoryAttributes(category.id), adminCatalogApi.attributes()]).then(([l, a]) => {
      setLinked(l.map((x) => ({ attribute_id: x.id, is_required: !!x.is_required, name: x.name, data_type: x.data_type, is_variant_option: x.is_variant_option })));
      setAll(a);
    }).catch((e) => toast.error(errorMessage(e)));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    try {
      await adminCatalogApi.setCategoryAttributes(category.id, linked!.map((l) => ({ attribute_id: l.attribute_id, is_required: l.is_required })));
      toast.success("Saved");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const move = (i: number, d: number) => { const n = [...linked!]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setLinked(n); };
  return (
    <Modal title={`Details for ${category.name}`} onClose={onClose} wide>
      {!linked ? <Spinner /> : (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Products in this category are asked for these details. Required ones must be filled before a product can be published. Sub-categories don't inherit them.</p>
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
            {linked.length === 0 && <p className="p-3 text-sm text-gray-400">None yet.</p>}
            {linked.map((l, i) => (
              <div key={l.attribute_id} className="flex items-center gap-3 p-2 text-sm">
                <div className="flex flex-col">
                  <button disabled={i === 0} onClick={() => move(i, -1)} className="text-xs disabled:opacity-20">▲</button>
                  <button disabled={i === linked.length - 1} onClick={() => move(i, 1)} className="text-xs disabled:opacity-20">▼</button>
                </div>
                <span className="flex-1 font-semibold">{l.name} <span className="text-xs font-normal text-gray-400">{l.data_type}{l.is_variant_option ? " · can define variants" : ""}</span></span>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={l.is_required} onChange={(e) => setLinked(linked.map((x, j) => (j === i ? { ...x, is_required: e.target.checked } : x)))} /> Required</label>
                <button onClick={() => setLinked(linked.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <select className={`${inputCls} max-w-xs`} value="" onChange={(e) => { const a = all.find((x) => String(x.id) === e.target.value); if (a) setLinked([...linked, { attribute_id: a.id, is_required: false, name: a.name, data_type: a.data_type, is_variant_option: a.is_variant_option }]); }}>
              <option value="">+ Add a detail…</option>
              {all.filter((a) => !linked.some((l) => l.attribute_id === a.id)).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.key})</option>)}
            </select>
            <select className={`${inputCls} max-w-xs`} value="" onChange={async (e) => {
              if (!e.target.value) return;
              try { toast.success((await adminCatalogApi.applyTemplate(category.id, e.target.value)).message); load(); } catch (err) { toast.error(errorMessage(err)); }
            }}>
              <option value="">+ Apply a template…</option>
              {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2"><button onClick={onClose} className={btnSecondary}>Cancel</button><button onClick={save} className={btnPrimary}>Save</button></div>
        </div>
      )}
    </Modal>
  );
};

const MergeModal: React.FC<{ category: AdminCategory; all: AdminCategory[]; onClose: () => void; onDone: () => void }> = ({ category, all, onClose, onDone }) => {
  const [into, setInto] = useState("");
  const merge = async () => {
    try {
      toast.success((await adminCatalogApi.mergeCategory(category.id, Number(into))).message);
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal title={`Merge "${category.name}"`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Its {category.product_count} product(s), sub-categories and details move to the category you choose, then "{category.name}" is deleted.</p>
        <Field label="Merge into">
          <select className={inputCls} value={into} onChange={(e) => setInto(e.target.value)}>
            <option value="">Choose…</option>
            {tree(all).filter((c) => c.id !== category.id).map((c) => <option key={c.id} value={c.id}>{c.path}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2"><button onClick={onClose} className={btnSecondary}>Cancel</button><button disabled={!into} onClick={merge} className={btnPrimary}>Merge</button></div>
      </div>
    </Modal>
  );
};

export const CategoriesManagement: React.FC = () => {
  const [cats, setCats] = useState<AdminCategory[] | null>(null);
  const [templates, setTemplates] = useState<{ key: string; name: string }[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [edit, setEdit] = useState<AdminCategory | null | undefined>(undefined);
  const [attrsFor, setAttrsFor] = useState<AdminCategory | null>(null);
  const [mergeFor, setMergeFor] = useState<AdminCategory | null>(null);
  const [q, setQ] = useState("");
  const load = () => {
    adminCatalogApi.categories().then(setCats).catch((e) => toast.error(errorMessage(e)));
    adminCatalogApi.health().then(setHealth).catch(() => {});
  };
  useEffect(() => {
    load();
    adminCatalogApi.templates().then(setTemplates).catch(() => {});
  }, []);
  const rows = useMemo(() => tree(cats || []).filter((c) => !q || c.path.toLowerCase().includes(q.toLowerCase())), [cats, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-2"><FolderTree size={20} /> Categories</h2>
          <p className="text-sm text-gray-500">Shared by every company. Companies can add categories; merge duplicates here.</p>
        </div>
        <input className={`${inputCls} w-56`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={btnPrimary} onClick={() => setEdit(null)}><Plus size={16} /> New category</button>
      </div>

      {health && (health.duplicate_brands.length > 0 || health.duplicate_skus.length > 0 || health.products_without_category > 0 || health.empty_categories.length > 0) && (
        <Card className="p-4">
          <p className="font-bold text-sm flex items-center gap-2 mb-2"><AlertTriangle size={16} className="text-amber-500" /> Catalogue health</p>
          <ul className="text-sm text-gray-700 space-y-1 list-disc pl-5">
            {health.duplicate_skus.length > 0 && (
              <li>
                <details>
                  <summary className="cursor-pointer">{health.duplicate_skus.length} SKU(s) used by more than one product of the same company</summary>
                  <div className="max-h-48 overflow-y-auto text-xs mt-1">
                    {health.duplicate_skus.map((d: any) => <p key={`${d.company}${d.sku}`}>{d.company}: <b>{d.sku}</b> × {d.n} ({d.titles.slice(0, 3).join(", ")})</p>)}
                  </div>
                </details>
              </li>
            )}
            {health.duplicate_brands.length > 0 && <li>{health.duplicate_brands.length} brand name(s) differ only in capitals: merge them in Brands</li>}
            {health.products_without_category > 0 && <li>{health.products_without_category} product(s) have no category</li>}
            {health.empty_categories.length > 0 && <li>{health.empty_categories.length} empty categor{health.empty_categories.length === 1 ? "y" : "ies"}: {health.empty_categories.slice(0, 8).map((c: any) => c.name).join(", ")}</li>}
          </ul>
        </Card>
      )}

      <Card>
        {!cats ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                <th className="px-4 py-3">Category</th><th className="px-4 py-3 text-center">Products</th><th className="px-4 py-3 text-center">Details</th>
                <th className="px-4 py-3">Added by</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2" style={{ paddingLeft: 16 + c.depth * 20 }}>
                    <span className={c.depth ? "" : "font-semibold"}>{c.name}</span>{c.is_featured && <Star size={12} className="inline ml-1 text-amber-500 fill-amber-400" />}
                    <span className="block text-[11px] text-gray-400">/{c.slug}</span>
                  </td>
                  <td className="px-4 py-2 text-center">{c.product_count}</td>
                  <td className="px-4 py-2 text-center">{c.attribute_count || "—"}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{c.created_by_company?.name || "Platform"}</td>
                  <td className="px-4 py-2"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <button title="Edit" onClick={() => setEdit(c)} className="p-1.5 hover:bg-gray-100 rounded-lg"><Pencil size={15} /></button>
                      <button title="Details (attributes)" onClick={() => setAttrsFor(c)} className="p-1.5 hover:bg-gray-100 rounded-lg"><ListChecks size={15} /></button>
                      <button title="Merge into another category" onClick={() => setMergeFor(c)} className="p-1.5 hover:bg-gray-100 rounded-lg"><Merge size={15} /></button>
                      {c.product_count === 0 && (
                        <button title="Delete" className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg" onClick={async () => {
                          if (!window.confirm(`Delete "${c.name}"?`)) return;
                          try { toast.success((await adminCatalogApi.deleteCategory(c.id)).message); load(); } catch (e) { toast.error(errorMessage(e)); }
                        }}><Trash2 size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {edit !== undefined && <CategoryForm category={edit} all={cats || []} templates={templates} onClose={() => setEdit(undefined)} onSaved={load} />}
      {attrsFor && <AttributesModal category={attrsFor} templates={templates} onClose={() => setAttrsFor(null)} onSaved={load} />}
      {mergeFor && <MergeModal category={mergeFor} all={cats || []} onClose={() => setMergeFor(null)} onDone={load} />}
    </div>
  );
};

export default CategoriesManagement;
