// Platform admin: product details (attributes) and their allowed values.
import React, { useEffect, useState } from "react";
import { ListChecks, Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { adminCatalogApi, AdminAttribute } from "../api/adminCatalog.api";
import { errorMessage } from "../../business/api/business.api";
import { Card, Spinner, Modal, Field, inputCls, btnPrimary, btnSecondary } from "../../business/components/ui";

const TYPES: Record<string, string> = { text: "Text", number: "Number", boolean: "Yes / no", date: "Date", select: "One from a list", multiselect: "Several from a list" };
const SCOPES: Record<string, string> = { product: "Whole product", variant: "Per variant", both: "Product or variant" };

const AttributeForm: React.FC<{ attr: AdminAttribute | null; onClose: () => void; onSaved: () => void }> = ({ attr, onClose, onSaved }) => {
  const locked = !!attr && attr.value_count > 0;
  const [f, setF] = useState({
    name: attr?.name || "", key: attr?.key || "", data_type: attr?.data_type || "text", unit: attr?.unit || "", scope: attr?.scope || "product",
    description: attr?.description || "", is_variant_option: !!attr?.is_variant_option, is_filterable: !!attr?.is_filterable, is_searchable: !!attr?.is_searchable,
    is_public: attr?.is_public ?? true, min: attr?.validation?.min ?? "", max: attr?.validation?.max ?? "", maxLength: attr?.validation?.maxLength ?? "",
    pattern: attr?.validation?.pattern || "", open: !!attr?.validation?.open, options: "",
  });
  const [values, setValues] = useState(attr?.attribute_options || []);
  const [newValue, setNewValue] = useState("");
  const isList = f.data_type === "select" || f.data_type === "multiselect";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: f.name, key: f.key || undefined, data_type: f.data_type, unit: f.unit, scope: f.scope, description: f.description,
      is_variant_option: f.is_variant_option, is_filterable: f.is_filterable, is_searchable: f.is_searchable, is_public: f.is_public,
      validation: { min: f.min, max: f.max, maxLength: f.maxLength, pattern: f.pattern || undefined, open: isList ? f.open : undefined },
    };
    if (!attr && isList) body.options = f.options.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      if (attr) await adminCatalogApi.updateAttribute(attr.id, body);
      else await adminCatalogApi.createAttribute(body);
      toast.success("Saved");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Modal title={attr ? `Edit ${attr.name}` : "New detail"} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Name *"><input required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Storage capacity" /></Field>
          <Field label="Key" hint={locked ? "Fixed: products use it" : "Stable internal name, e.g. storage_capacity"}>
            <input disabled={locked} className={inputCls} value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="auto from the name" />
          </Field>
          <Field label="Type" hint={locked ? "Fixed: products use it" : undefined}>
            <select disabled={locked} className={inputCls} value={f.data_type} onChange={(e) => setF({ ...f, data_type: e.target.value })}>
              {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Unit"><input className={inputCls} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="ml, GB, kg…" /></Field>
          <Field label="Set on">
            <select className={inputCls} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
              {Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Description"><input className={inputCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_variant_option} disabled={!["select", "number", "text"].includes(f.data_type)} onChange={(e) => setF({ ...f, is_variant_option: e.target.checked })} /> Can define variants (like Size or Colour)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_filterable} onChange={(e) => setF({ ...f, is_filterable: e.target.checked })} /> Filterable</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_searchable} onChange={(e) => setF({ ...f, is_searchable: e.target.checked })} /> Searchable</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_public} onChange={(e) => setF({ ...f, is_public: e.target.checked })} /> Shown to buyers</label>
          {isList && <label className="flex items-center gap-2"><input type="checkbox" checked={f.open} onChange={(e) => setF({ ...f, open: e.target.checked })} /> Companies may add values (e.g. flavours)</label>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {f.data_type === "number" && (
            <>
              <Field label="Minimum"><input type="number" className={inputCls} value={String(f.min)} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
              <Field label="Maximum"><input type="number" className={inputCls} value={String(f.max)} onChange={(e) => setF({ ...f, max: e.target.value })} /></Field>
            </>
          )}
          {f.data_type === "text" && (
            <>
              <Field label="Max length"><input type="number" className={inputCls} value={String(f.maxLength)} onChange={(e) => setF({ ...f, maxLength: e.target.value })} /></Field>
              <Field label="Pattern (regex)"><input className={inputCls} value={f.pattern} onChange={(e) => setF({ ...f, pattern: e.target.value })} /></Field>
            </>
          )}
        </div>
        {isList && !attr && <Field label="Values" hint="Comma separated"><input className={inputCls} value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} placeholder="Black, White, Silver" /></Field>}
        {isList && attr && (
          <div>
            <p className="text-xs font-bold uppercase text-gray-600 mb-2">Values</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {values.map((o) => (
                <span key={o.id} className="inline-flex items-center gap-1 bg-gray-100 rounded-full pl-3 pr-1 py-0.5 text-sm">
                  <button type="button" title="Rename" onClick={async () => {
                    const v = window.prompt("Rename this value everywhere it is used:", o.value);
                    if (!v || v === o.value) return;
                    try { await adminCatalogApi.updateOption(o.id, { value: v }); setValues(values.map((x) => (x.id === o.id ? { ...x, value: v } : x))); } catch (e) { toast.error(errorMessage(e)); }
                  }}>{o.value}</button>
                  <button type="button" aria-label={`Delete ${o.value}`} className="p-0.5 hover:bg-gray-200 rounded-full" onClick={async () => {
                    try { await adminCatalogApi.deleteOption(o.id); setValues(values.filter((x) => x.id !== o.id)); } catch (e) { toast.error(errorMessage(e)); }
                  }}><X size={12} /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 max-w-sm">
              <input className={inputCls} value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="New value" />
              <button type="button" className={btnSecondary} disabled={!newValue.trim()} onClick={async () => {
                try { const o = await adminCatalogApi.addOption(attr.id, newValue.trim()); setValues([...values, o]); setNewValue(""); } catch (e) { toast.error(errorMessage(e)); }
              }}>Add</button>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Save</button></div>
      </form>
    </Modal>
  );
};

export const AttributesManagement: React.FC = () => {
  const [rows, setRows] = useState<AdminAttribute[] | null>(null);
  const [scope, setScope] = useState<"global" | "all">("global");
  const [edit, setEdit] = useState<AdminAttribute | null | undefined>(undefined);
  const load = () => adminCatalogApi.attributes(scope).then(setRows).catch((e) => toast.error(errorMessage(e)));
  useEffect(() => { load(); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-2"><ListChecks size={20} /> Product details</h2>
          <p className="text-sm text-gray-500">Specifications and variant options (Size, Colour…). Attach them to categories under Categories.</p>
        </div>
        <select className={`${inputCls} w-auto`} value={scope} onChange={(e) => setScope(e.target.value as any)}>
          <option value="global">Platform details</option>
          <option value="all">Including companies' own</option>
        </select>
        <button className={btnPrimary} onClick={() => setEdit(null)}><Plus size={16} /> New detail</button>
      </div>
      <Card>
        {!rows ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                <th className="px-4 py-3">Detail</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Values</th>
                <th className="px-4 py-3 text-center">Used</th><th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <p className="font-semibold">{a.name}{a.unit ? <span className="text-gray-400 font-normal"> ({a.unit})</span> : null}</p>
                    <p className="text-[11px] text-gray-400">{a.key}{a.company ? ` · ${a.company.name}` : ""}{a.is_variant_option ? " · variant option" : ""}{a.is_filterable ? " · filter" : ""}</p>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{TYPES[a.data_type]}<span className="block text-[11px] text-gray-400">{SCOPES[a.scope]}</span></td>
                  <td className="px-4 py-2 text-xs text-gray-500 max-w-[280px] truncate">{a.attribute_options.map((o) => o.value).join(", ") || "—"}{a.validation?.open ? " (open)" : ""}</td>
                  <td className="px-4 py-2 text-center text-xs">{a.value_count} value(s)<br />{a.category_count} categor{a.category_count === 1 ? "y" : "ies"}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <button className="p-1.5 hover:bg-gray-100 rounded-lg" title="Edit" onClick={() => setEdit(a)}><Pencil size={15} /></button>
                      {a.value_count === 0 && (
                        <button className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg" title="Delete" onClick={async () => {
                          if (!window.confirm(`Delete "${a.name}"?`)) return;
                          try { await adminCatalogApi.deleteAttribute(a.id); load(); } catch (e) { toast.error(errorMessage(e)); }
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
      {edit !== undefined && <AttributeForm attr={edit} onClose={() => setEdit(undefined)} onSaved={load} />}
    </div>
  );
};

export default AttributesManagement;
