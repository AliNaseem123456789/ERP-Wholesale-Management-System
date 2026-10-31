// Create / edit one product: basics, pricing & ordering rules, categories, visibility,
// details (category attributes), variants (options such as Size or Colour) and the image gallery.
import { toLocalInput } from "./CollectionsPage";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, Lock, AlertTriangle, ImagePlus, X, Save } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { supplyApi, Supplier } from "../api/supply.api";
import { COMPLIANCE_CATEGORIES } from "../api/ops.api";
import {
  catalogApi, categoryTree, Attribute, Category, CompanyBrand, CompanyVariant, ProductImage, PRODUCT_STATUSES, RELATIONSHIPS,
} from "../api/catalog.api";
import { Card, PageHeader, Spinner, Field, StatusBadge, money, inputCls, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

const Section: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, actions, children }) => (
  <Card className="p-5">
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h2 className="font-bold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions}
    </div>
    {children}
  </Card>
);

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// ---- categories picker ----------------------------------------------------------------------------

const CategoryPicker: React.FC<{ categories: Category[]; value: number[]; onChange: (ids: number[]) => void; onCreated: () => void; disabled?: boolean }> = ({ categories, value, onChange, onCreated, disabled }) => {
  const { companyId } = useBusiness();
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [parentId, setParentId] = useState("");
  const tree = useMemo(() => categoryTree(categories), [categories]);
  const matches = q ? tree.filter((c) => c.path.toLowerCase().includes(q.toLowerCase())).slice(0, 30) : [];
  const add = (id: number) => !value.includes(id) && onChange([...value, id]);
  const create = async () => {
    try {
      const r = await catalogApi.createCategory(companyId!, newName.trim(), parentId ? Number(parentId) : null);
      toast.success(r.message);
      onCreated();
      add(r.data.id);
      setNewName("");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {value.length === 0 && <span className="text-sm text-gray-400">No category yet</span>}
        {value.map((id, i) => {
          const c = tree.find((x) => x.id === id);
          return (
            <span key={id} className="inline-flex items-center gap-1 bg-blue-50 text-blue-900 border border-blue-100 rounded-full pl-3 pr-1 py-0.5 text-sm">
              {i === 0 && <b className="text-[10px] uppercase mr-1">Main</b>}{c?.path || `#${id}`}
              {!disabled && <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} className="p-0.5 hover:bg-blue-100 rounded-full" aria-label="Remove"><X size={14} /></button>}
            </span>
          );
        })}
      </div>
      {!disabled && (
        <>
          <div className="relative">
            <input className={inputCls} placeholder="Search categories to add…" value={q} onChange={(e) => setQ(e.target.value)} />
            {matches.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {matches.map((c) => (
                  <button type="button" key={c.id} onClick={() => { add(c.id); setQ(""); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                    {c.path}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 items-end bg-gray-50 rounded-xl p-3">
            <div className="flex-1 min-w-[160px]"><Field label="New category"><input className={inputCls} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Gaming Accessories" /></Field></div>
            <div className="flex-1 min-w-[160px]">
              <Field label="Inside (optional)">
                <select className={inputCls} value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">Top level</option>
                  {tree.map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.name}</option>)}
                </select>
              </Field>
            </div>
            <button type="button" className={btnSecondary} disabled={!newName.trim()} onClick={create}><Plus size={14} /> Add category</button>
          </div>
          <p className="text-xs text-gray-400">New categories are shared with the whole marketplace. If the name already exists, the existing one is used.</p>
        </>
      )}
    </div>
  );
};

// ---- one attribute input ---------------------------------------------------------------------------

const AttributeInput: React.FC<{ attr: Attribute; value: unknown; onChange: (v: unknown) => void; disabled?: boolean; listId?: string }> = ({ attr, value, onChange, disabled, listId }) => {
  const open = attr.validation?.open || attr.own;
  switch (attr.data_type) {
    case "boolean":
      return (
        <select className={inputCls} disabled={disabled} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "yes")}>
          <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
        </select>
      );
    case "number":
      return (
        <div className="flex items-center gap-2">
          <input type="number" step="any" className={inputCls} disabled={disabled} value={str(value)} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />
          {attr.unit && <span className="text-sm text-gray-500 shrink-0">{attr.unit}</span>}
        </div>
      );
    case "date":
      return <input type="date" className={inputCls} disabled={disabled} value={str(value).slice(0, 10)} onChange={(e) => onChange(e.target.value || null)} />;
    case "select":
      return open ? (
        <>
          <input className={inputCls} disabled={disabled} list={listId || `opts-${attr.id}`} value={str(value)} onChange={(e) => onChange(e.target.value || null)} placeholder="Choose or type a new value" />
          {!listId && <datalist id={`opts-${attr.id}`}>{attr.attribute_options.map((o) => <option key={o.id} value={o.value} />)}</datalist>}
        </>
      ) : (
        <select className={inputCls} disabled={disabled} value={str(value)} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {attr.attribute_options.map((o) => <option key={o.id} value={o.value}>{o.value}</option>)}
        </select>
      );
    case "multiselect": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {attr.attribute_options.map((o) => {
            const on = list.includes(o.value);
            return (
              <button type="button" key={o.id} disabled={disabled} onClick={() => onChange(on ? list.filter((x) => x !== o.value) : [...list, o.value])}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${on ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200"}`}>
                {o.value}
              </button>
            );
          })}
        </div>
      );
    }
    default:
      return <input className={inputCls} disabled={disabled} value={str(value)} onChange={(e) => onChange(e.target.value || null)} maxLength={attr.validation?.maxLength || 2000} />;
  }
};

// ---- details (specifications) ----------------------------------------------------------------------

const DetailsSection: React.FC<{ productId: number; categoryIds: number[]; canEdit: boolean; onSaved: () => void }> = ({ productId, categoryIds, canEdit, onSaved }) => {
  const { companyId } = useBusiness();
  const [attrs, setAttrs] = useState<Attribute[] | null>(null);
  const [all, setAll] = useState<Attribute[]>([]);
  const [values, setValues] = useState<Record<number, unknown>>({});
  const [saving, setSaving] = useState(false);
  const key = categoryIds.join(",");

  const load = useCallback(() => {
    catalogApi.productAttributes(companyId!, productId, categoryIds).then((list) => {
      const own = list.filter((a) => a.scope !== "variant");
      setAttrs(own);
      setValues(Object.fromEntries(own.map((a) => [a.id, a.value ?? null])));
    }).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, productId, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  useEffect(() => {
    catalogApi.attributes(companyId!).then((l) => setAll(l.filter((a) => a.scope !== "variant"))).catch(() => {});
  }, [companyId]);

  if (!attrs) return <Spinner />;
  const extra = all.filter((a) => !attrs.some((x) => x.id === a.id));
  const save = async () => {
    setSaving(true);
    try {
      await catalogApi.saveProductAttributes(companyId!, productId, attrs.map((a) => ({ attribute_id: a.id, value: values[a.id] ?? null })));
      toast.success("Details saved");
      onSaved();
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Section
      title="Details"
      subtitle="Specifications shown on the product page. Your categories decide which details are suggested; * = required to publish."
      actions={canEdit && <button className={btnPrimary} onClick={save} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Save details"}</button>}
    >
      {attrs.length === 0 && <p className="text-sm text-gray-400 mb-3">No details yet. Pick categories (an admin can attach detail templates to them) or add any detail below.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {attrs.map((a) => (
          <Field key={a.id} label={`${a.name}${a.is_required ? " *" : ""}${a.unit && a.data_type !== "number" ? ` (${a.unit})` : ""}`}>
            <AttributeInput attr={a} value={values[a.id]} disabled={!canEdit} onChange={(v) => setValues((s) => ({ ...s, [a.id]: v }))} />
          </Field>
        ))}
      </div>
      {canEdit && extra.length > 0 && (
        <div className="mt-4 max-w-xs">
          <select className={inputCls} value="" onChange={(e) => { const a = extra.find((x) => String(x.id) === e.target.value); if (a) setAttrs([...attrs, a]); }}>
            <option value="">+ Add another detail…</option>
            {extra.map((a) => <option key={a.id} value={a.id}>{a.name}{a.own ? " (yours)" : ""}</option>)}
          </select>
        </div>
      )}
    </Section>
  );
};

// ---- variants --------------------------------------------------------------------------------------

type VariantRow = {
  id?: number; key?: string; name: string; options: Record<string, unknown>; sku: string; barcode: string; price: string;
  min_order_qty: string; status: string; on_hand?: number; reserved?: number; has_history?: boolean;
};

const VariantsSection: React.FC<{ productId: number; basePrice?: number | null; canEdit: boolean; onSaved: () => void }> = ({ productId, basePrice, canEdit, onSaved }) => {
  const { companyId } = useBusiness();
  const [optionAttrs, setOptionAttrs] = useState<Attribute[]>([]);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [rows, setRows] = useState<VariantRow[] | null>(null);
  const [unassigned, setUnassigned] = useState(0);
  const [saving, setSaving] = useState(false);
  const [combo, setCombo] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [attrs, v] = await Promise.all([catalogApi.attributes(companyId!, { variant_options: true }), catalogApi.variants(companyId!, productId)]);
      setOptionAttrs(attrs);
      setOptionIds(v.option_attribute_ids.map(String));
      setUnassigned(v.unassigned);
      setRows(v.data.filter((x) => x.status !== "archived").map((x: CompanyVariant) => ({
        id: x.id, key: x.key, name: x.name === x.key ? "" : x.name, options: x.options, sku: str(x.sku), barcode: str(x.barcode),
        price: str(x.price), min_order_qty: str(x.min_order_qty), status: x.status, on_hand: x.on_hand, reserved: x.reserved, has_history: x.has_history,
      })));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [companyId, productId]);
  useEffect(() => { load(); }, [load]);

  if (!rows) return <Spinner />;
  const chosen = optionIds.map((id) => optionAttrs.find((a) => String(a.id) === id)).filter(Boolean) as Attribute[];
  const setRow = (i: number, patch: Partial<VariantRow>) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const newOption = async () => {
    const name = window.prompt("Name of the option your variants differ by (e.g. Size, Colour, Strength):");
    if (!name?.trim()) return;
    try {
      const a = await catalogApi.createAttribute(companyId!, { name: name.trim(), data_type: "select", scope: "variant", is_variant_option: true, is_filterable: true });
      setOptionAttrs((l) => [...l, { ...a, own: true }]);
      setOptionIds((l) => [...l, String(a.id)]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const addCombinations = () => {
    // values typed per option, comma separated -> one row per combination that isn't there yet
    const lists = chosen.map((a) => String(combo[a.id] || "").split(",").map((s) => s.trim()).filter(Boolean));
    if (lists.some((l) => !l.length)) return toast.error("Enter at least one value for every option");
    let combos: Record<string, string>[] = [{}];
    chosen.forEach((a, i) => { combos = combos.flatMap((c) => lists[i].map((v) => ({ ...c, [a.id]: v }))); });
    if (combos.length > 100) return toast.error("That's more than 100 combinations. Add the ones you actually sell.");
    const sig = (o: Record<string, unknown>) => chosen.map((a) => String(o[a.id] ?? "").toLowerCase()).join("|");
    const existing = new Set(rows.map((r) => sig(r.options)));
    const fresh = combos.filter((c) => !existing.has(sig(c)));
    setRows([...rows, ...fresh.map((c) => ({ name: "", options: c, sku: "", barcode: "", price: "", min_order_qty: "", status: "active" }))]);
    setCombo({});
    toast.success(`${fresh.length} variant(s) added. Remove the ones you don't sell, then save.`);
  };
  const removeRow = (i: number) => {
    const r = rows[i];
    if (r.has_history && !window.confirm(`"${r.key}" has stock or order history, so it will be archived (kept for old records) instead of deleted. Continue?`)) return;
    setRows(rows.filter((_, j) => j !== i));
  };
  const save = async () => {
    setSaving(true);
    try {
      const r = await catalogApi.saveVariants(companyId!, productId, {
        option_attribute_ids: optionIds,
        variants: rows.map((x) => ({
          id: x.id, name: x.name || undefined, options: x.options, sku: x.sku, barcode: x.barcode, price: x.price === "" ? null : x.price,
          min_order_qty: x.min_order_qty === "" ? null : x.min_order_qty, status: x.status,
        })),
      });
      toast.success(r.message);
      onSaved();
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Variants"
      subtitle="Purchasable versions of this product (e.g. 50 ml / 100 ml, or Black 128 GB). Stock, orders and prices are kept per variant. Only add the combinations you actually sell."
      actions={canEdit && <button className={btnPrimary} onClick={save} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Save variants"}</button>}
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs font-bold uppercase text-gray-500">Options:</span>
        {chosen.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 bg-gray-100 rounded-full pl-3 pr-1 py-0.5 text-sm">
            {a.name}{a.unit ? ` (${a.unit})` : ""}
            {canEdit && <button type="button" onClick={() => setOptionIds(optionIds.filter((x) => x !== String(a.id)))} className="p-0.5 hover:bg-gray-200 rounded-full" aria-label={`Remove ${a.name}`}><X size={14} /></button>}
          </span>
        ))}
        {canEdit && (
          <>
            <select className="px-2 py-1 border border-gray-300 rounded-lg text-sm" value="" onChange={(e) => e.target.value && setOptionIds([...optionIds, e.target.value])}>
              <option value="">+ Add option</option>
              {optionAttrs.filter((a) => !optionIds.includes(String(a.id))).map((a) => <option key={a.id} value={a.id}>{a.name}{a.unit ? ` (${a.unit})` : ""}</option>)}
            </select>
            <button type="button" className="text-xs font-bold text-blue-600 hover:underline" onClick={newOption}>Create an option</button>
          </>
        )}
      </div>

      {canEdit && chosen.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-3 mb-4">
          <p className="text-xs font-bold uppercase text-gray-500 mb-2">Add several at once</p>
          <div className="flex flex-wrap gap-2 items-end">
            {chosen.map((a) => (
              <div key={a.id} className="min-w-[160px] flex-1">
                <Field label={`${a.name} values`}><input className={inputCls} placeholder={a.data_type === "number" ? "e.g. 50, 100" : "e.g. Black, Silver"} value={combo[a.id] || ""} onChange={(e) => setCombo({ ...combo, [a.id]: e.target.value })} /></Field>
              </div>
            ))}
            <button type="button" className={btnSecondary} onClick={addCombinations}>Add combinations</button>
          </div>
        </div>
      )}

      {chosen.length === 0 && rows.length === 0 ? (
        <p className="text-sm text-gray-400">This product is sold as one item. Add an option (Size, Colour, Flavour…) if it comes in several versions.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-400">
                {chosen.map((a) => <th key={a.id} className="px-1 py-2 min-w-[110px]">{a.name}</th>)}
                <th className="px-1 py-2 min-w-[120px]">Display name</th>
                <th className="px-1 py-2 min-w-[110px]">SKU</th>
                <th className="px-1 py-2 min-w-[110px]">Barcode</th>
                <th className="px-1 py-2 min-w-[90px]">Price</th>
                <th className="px-1 py-2 w-20">Min</th>
                <th className="px-1 py-2 min-w-[120px]">Status</th>
                <th className="px-1 py-2 text-right">Stock</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? `new-${i}`} className="align-top">
                  {chosen.map((a) => (
                    <td key={a.id} className="px-1 py-1">
                      <AttributeInput attr={a} value={r.options[a.id]} disabled={!canEdit} listId={`vo-${a.id}`} onChange={(v) => setRow(i, { options: { ...r.options, [a.id]: v } })} />
                    </td>
                  ))}
                  <td className="px-1 py-1">
                    <input className={inputCls} disabled={!canEdit} value={r.name} placeholder={r.key || "auto"} onChange={(e) => setRow(i, { name: e.target.value })} />
                    {r.has_history && <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1" title="This variant has stock or orders, so its internal name stays the same"><Lock size={10} /> {r.key}</p>}
                  </td>
                  <td className="px-1 py-1"><input className={inputCls} disabled={!canEdit} value={r.sku} onChange={(e) => setRow(i, { sku: e.target.value })} /></td>
                  <td className="px-1 py-1"><input className={inputCls} disabled={!canEdit} value={r.barcode} onChange={(e) => setRow(i, { barcode: e.target.value })} /></td>
                  <td className="px-1 py-1"><input type="number" min={0} step="0.01" className={inputCls} disabled={!canEdit} value={r.price} placeholder={basePrice != null ? String(basePrice) : ""} onChange={(e) => setRow(i, { price: e.target.value })} /></td>
                  <td className="px-1 py-1"><input type="number" min={1} className={inputCls} disabled={!canEdit} value={r.min_order_qty} onChange={(e) => setRow(i, { min_order_qty: e.target.value })} /></td>
                  <td className="px-1 py-1">
                    <select className={inputCls} disabled={!canEdit} value={r.status} onChange={(e) => setRow(i, { status: e.target.value })}>
                      <option value="active">On sale</option><option value="discontinued">Discontinued</option>
                    </select>
                  </td>
                  <td className="px-1 py-2 text-right whitespace-nowrap">{r.on_hand ?? "—"}{r.reserved ? <span className="text-gray-400 text-xs"> ({r.reserved} res.)</span> : null}</td>
                  <td className="px-1 py-1">{canEdit && <button type="button" onClick={() => removeRow(i)} className="p-2 text-gray-400 hover:text-red-600" aria-label="Remove variant"><Trash2 size={15} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {chosen.map((a) => <datalist key={a.id} id={`vo-${a.id}`}>{a.attribute_options.map((o) => <option key={o.id} value={o.value} />)}</datalist>)}
        </div>
      )}
      {canEdit && chosen.length > 0 && (
        <button type="button" className="mt-3 text-sm font-bold text-blue-600 hover:underline inline-flex items-center gap-1" onClick={() => setRows([...rows, { name: "", options: {}, sku: "", barcode: "", price: "", min_order_qty: "", status: "active" }])}>
          <Plus size={14} /> Add variant
        </button>
      )}
      {unassigned > 0 && <p className="text-xs text-amber-800 mt-3">{unassigned} unit(s) in stock aren't assigned to a variant yet. Assign them under Inventory → Stock.</p>}
      <p className="text-xs text-gray-400 mt-3">Empty price = the product price. Variants with stock or orders can't be deleted; they're archived so old documents stay correct.</p>
    </Section>
  );
};

// ---- images ----------------------------------------------------------------------------------------

const ImagesSection: React.FC<{ productId: number; initial: ProductImage[]; variantKeys: string[]; canEdit: boolean }> = ({ productId, initial, variantKeys, canEdit }) => {
  const { companyId } = useBusiness();
  const [images, setImages] = useState<ProductImage[]>(initial);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setImages(initial), [initial]);
  const run = async (fn: () => Promise<ProductImage[]>) => {
    setBusy(true);
    try {
      setImages(await fn());
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const reorder = (i: number, d: number) => {
    const next = [...images];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    run(() => catalogApi.updateImages(companyId!, productId, next.map((m) => ({ id: m.id }))));
  };
  const patch = (i: number, p: Partial<ProductImage>) => {
    const next = images.map((m, j) => (j === i ? { ...m, ...p } : m));
    run(() => catalogApi.updateImages(companyId!, productId, next.map((m) => ({ id: m.id, alt_text: m.alt_text ?? null, variant_key: m.variant_key ?? null }))));
  };
  return (
    <Section title="Images" subtitle="The first image is the main one. Tag an image with a variant to show it when that variant is chosen.">
      {images.length === 0 && <p className="text-sm text-gray-400 mb-3">No gallery images. Products imported earlier keep showing their original image until you add some here.</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {images.map((m, i) => (
          <div key={m.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
            <div className="aspect-square bg-gray-50 relative">
              <img src={m.url} alt={m.alt_text || ""} className="w-full h-full object-cover" />
              {i === 0 && <span className="absolute top-2 left-2 bg-solid/80 text-white text-[10px] font-bold uppercase px-2 py-0.5 rounded">Main</span>}
            </div>
            {canEdit && (
              <div className="p-2 space-y-1.5">
                <input className="w-full px-2 py-1 border border-gray-200 rounded text-xs" placeholder="Alt text (describe the image)" defaultValue={m.alt_text || ""} onBlur={(e) => e.target.value !== (m.alt_text || "") && patch(i, { alt_text: e.target.value })} />
                {variantKeys.length > 0 && (
                  <select className="w-full px-2 py-1 border border-gray-200 rounded text-xs" value={m.variant_key || ""} onChange={(e) => patch(i, { variant_key: e.target.value || null })}>
                    <option value="">All variants</option>
                    {variantKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                )}
                <div className="flex justify-between">
                  <div className="flex">
                    <button disabled={busy || i === 0} onClick={() => reorder(i, -1)} className="p-1 text-gray-500 disabled:opacity-30" aria-label="Move left"><ArrowUp size={14} className="-rotate-90" /></button>
                    <button disabled={busy || i === images.length - 1} onClick={() => reorder(i, 1)} className="p-1 text-gray-500 disabled:opacity-30" aria-label="Move right"><ArrowDown size={14} className="-rotate-90" /></button>
                  </div>
                  <button disabled={busy} onClick={() => window.confirm("Delete this image?") && run(() => catalogApi.deleteImage(companyId!, productId, m.id))} className="p-1 text-red-500" aria-label="Delete image"><Trash2 size={14} /></button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-3 items-end mt-4">
          <label className={`${btnSecondary} cursor-pointer`}>
            <ImagePlus size={16} /> Upload images
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" disabled={busy}
              onChange={(e) => { const files = Array.from(e.target.files || []).slice(0, 6); e.target.value = ""; if (files.length) run(() => catalogApi.uploadImages(companyId!, productId, files)); }} />
          </label>
          <div className="flex gap-2 flex-1 min-w-[260px]">
            <input className={inputCls} placeholder="…or paste an image address (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className={btnSecondary} disabled={!url || busy} onClick={() => run(async () => { const r = await catalogApi.addImageUrl(companyId!, productId, url); setUrl(""); return r; })}>Add</button>
          </div>
        </div>
      )}
    </Section>
  );
};

// ---- page ------------------------------------------------------------------------------------------

const emptyForm = {
  title: "", brand: "", brand_relationship: "", sku: "", barcode: "", short_description: "", description: "", status: "draft", slug: "", is_featured: false, allow_preorder: false, sale_percent: "", sale_label: "", sale_starts_at: "", sale_ends_at: "",
  price: "", unit: "each", min_order_qty: "1", order_multiple: "1", pack_size: "", cost_price: "", reorder_point: "", reorder_quantity: "",
  preferred_supplier_id: "", visibility: "public", compliance_category: "none", nicotine_ml: "", is_flavored: false,
};

export const ProductEditorPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const { companyId, can } = useBusiness();
  const canEdit = can("products.manage");
  const [product, setProduct] = useState<any>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<CompanyBrand[]>([]);
  const [brandMatches, setBrandMatches] = useState<{ id: number; name: string }[]>([]);
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [saving, setSaving] = useState(false);
  const [showCompliance, setShowCompliance] = useState(false);

  const loadCategories = useCallback(() => catalogApi.categories(companyId!).then(setCategories).catch(() => {}), [companyId]);
  const loadProduct = useCallback(async () => {
    if (isNew) return;
    try {
      const p = await catalogApi.product(companyId!, id!);
      setProduct(p);
      setForm({
        title: p.title, brand: p.brand, brand_relationship: "", sku: str(p.sku), barcode: str(p.barcode), short_description: str(p.short_description),
        description: str(p.description), status: p.status, slug: str(p.slug), is_featured: !!p.is_featured, allow_preorder: !!p.allow_preorder, sale_percent: p.sale_percent == null ? "" : String(Number(p.sale_percent)), sale_label: str(p.sale_label), sale_starts_at: toLocalInput(p.sale_starts_at), sale_ends_at: toLocalInput(p.sale_ends_at), price: str(p.price), unit: p.unit || "each",
        min_order_qty: str(p.min_order_qty), order_multiple: str(p.order_multiple), pack_size: str(p.pack_size), cost_price: str(p.cost_price),
        reorder_point: str(p.reorder_point), reorder_quantity: str(p.reorder_quantity), preferred_supplier_id: str(p.preferred_supplier_id),
        visibility: p.visibility || "public", compliance_category: p.compliance_category || "none", nicotine_ml: str(p.nicotine_ml), is_flavored: !!p.is_flavored,
      });
      setCategoryIds(p.category_ids || []);
      setGroupIds((p.visible_groups || []).map((g: any) => g.id));
      setShowCompliance((p.compliance_category || "none") !== "none");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [companyId, id, isNew]);

  useEffect(() => {
    if (!companyId) return;
    loadCategories();
    catalogApi.brands(companyId).then(setBrands).catch(() => {});
    catalogApi.customerGroups(companyId).then(setGroups).catch(() => {});
    if (can("purchasing.view")) supplyApi.suppliers(companyId, { active: true }).then(setSuppliers).catch(() => {});
    loadProduct();
  }, [companyId, loadProduct]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const q = form.brand.trim();
    if (!q || brands.some((b) => b.name.toLowerCase() === q.toLowerCase())) return setBrandMatches([]);
    const t = setTimeout(() => catalogApi.searchBrands(companyId!, q).then(setBrandMatches).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [form.brand, brands, companyId]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value } as typeof form);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: form.title, brand: form.brand, sku: form.sku, barcode: form.barcode, short_description: form.short_description, description: form.description,
        status: form.status, is_featured: form.is_featured, allow_preorder: form.allow_preorder, sale_percent: form.sale_percent === "" ? null : Number(form.sale_percent), sale_label: form.sale_label || null, sale_starts_at: form.sale_starts_at ? new Date(form.sale_starts_at).toISOString() : null, sale_ends_at: form.sale_ends_at ? new Date(form.sale_ends_at).toISOString() : null, price: form.price === "" ? null : Number(form.price), unit: form.unit,
        min_order_qty: form.min_order_qty || 1, order_multiple: form.order_multiple || 1, pack_size: form.pack_size === "" ? null : form.pack_size,
        reorder_point: form.reorder_point, reorder_quantity: form.reorder_quantity, visibility: form.visibility,
        visible_group_ids: form.visibility === "groups" ? groupIds : [], category_ids: categoryIds,
        compliance_category: form.compliance_category, nicotine_ml: form.nicotine_ml, is_flavored: form.is_flavored,
      };
      if (form.slug) body.slug = form.slug;
      if (form.brand_relationship) body.brand_relationship = form.brand_relationship;
      if (form.cost_price !== "") body.cost_price = form.cost_price;
      if (can("purchasing.view")) body.preferred_supplier_id = form.preferred_supplier_id || null;
      if (isNew) {
        const created = await catalogApi.create(companyId!, body);
        toast.success("Product created. Add its variants, details and images below.");
        navigate(`/business/products/${created.id}`, { replace: true });
      } else {
        await catalogApi.update(companyId!, product.id, body);
        toast.success("Product saved");
        loadProduct();
        catalogApi.brands(companyId!).then(setBrands).catch(() => {});
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!isNew && !product) return <Spinner label="Loading product…" />;
  const variantKeys: string[] = (product?.variants?.data || []).filter((v: CompanyVariant) => v.status !== "archived").map((v: CompanyVariant) => v.key);
  const statusInfo = PRODUCT_STATUSES.find((s) => s.value === form.status);

  return (
    <div className="space-y-5 max-w-5xl">
      <Link to="/business/products" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ArrowLeft size={14} /> All products</Link>
      <PageHeader
        title={isNew ? "New product" : product.title}
        subtitle={isNew ? "Start with the basics; variants, details and images come next" : `${product.brand}${product.slug ? ` · /product/${product.slug}` : ""}`}
        actions={!isNew && <StatusBadge status={product.status} />}
      />

      {!isNew && product.publish_problems?.length > 0 && (
        <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
          <AlertTriangle size={18} className="shrink-0" />
          <span>{product.status === "published" ? "Published, but" : "Before publishing,"} add {product.publish_problems.join("; ")}.</span>
        </div>
      )}

      <form onSubmit={save} className="space-y-5">
        <Section title="Basics">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Title *"><input required disabled={!canEdit} className={inputCls} value={form.title} onChange={set("title")} /></Field>
            <Field label="Brand *" hint="An existing marketplace brand or a new one. Many companies can sell the same brand.">
              <input required disabled={!canEdit} list="brand-list" className={inputCls} value={form.brand} onChange={set("brand")} />
              <datalist id="brand-list">
                {brands.map((b) => <option key={`o${b.id}`} value={b.name} />)}
                {brandMatches.map((b) => <option key={`m${b.id}`} value={b.name} />)}
              </datalist>
            </Field>
            <Field label="How you sell this brand">
              <select disabled={!canEdit} className={inputCls} value={form.brand_relationship || brands.find((b) => b.name.toLowerCase() === form.brand.toLowerCase())?.relationship || ""} onChange={set("brand_relationship")}>
                <option value="">Reseller (default)</option>
                {Object.entries(RELATIONSHIPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Status" hint={statusInfo?.hint}>
              <select disabled={!canEdit} className={inputCls} value={form.status} onChange={set("status")}>
                {PRODUCT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="SKU"><input disabled={!canEdit} className={inputCls} value={form.sku} onChange={set("sku")} /></Field>
            <Field label="Barcode"><input disabled={!canEdit} className={inputCls} value={form.barcode} onChange={set("barcode")} placeholder="Scan or type" /></Field>
            <div className="md:col-span-2"><Field label="Short description" hint="One or two lines shown near the price"><input disabled={!canEdit} className={inputCls} maxLength={500} value={form.short_description} onChange={set("short_description")} /></Field></div>
            <div className="md:col-span-2"><Field label="Description"><textarea disabled={!canEdit} rows={4} className={inputCls} value={form.description} onChange={set("description")} /></Field></div>
            <Field label="Web address" hint="Made from the title when empty"><input disabled={!canEdit} className={inputCls} value={form.slug} onChange={set("slug")} placeholder="acme-eau-de-parfum" /></Field>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mt-6">
              <input type="checkbox" disabled={!canEdit} checked={form.is_featured} onChange={(e) => setForm({ ...form, is_featured: e.target.checked })} /> Featured product
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700" title="When it's out of stock, buyers can order units already on a purchase order from your supplier. They ship when the stock arrives.">
              <input type="checkbox" disabled={!canEdit} checked={form.allow_preorder} onChange={(e) => setForm({ ...form, allow_preorder: e.target.checked })} /> Allow pre-orders from incoming stock
            </label>
          </div>
        </Section>

        <Section title="Price & ordering" subtitle="Customer groups, price lists and volume prices are set under Pricing & promos.">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Wholesale price" hint={variantKeys.length ? "Variants can override it" : "Empty = can't be ordered"}>
              <input type="number" min="0" step="0.01" disabled={!canEdit} className={inputCls} value={form.price} onChange={set("price")} />
            </Field>
            <Field label="Selling unit" hint="each, box, case…"><input disabled={!canEdit} className={inputCls} value={form.unit} onChange={set("unit")} /></Field>
            <Field label="Units per selling unit" hint="Shown to buyers"><input type="number" min="1" disabled={!canEdit} className={inputCls} value={form.pack_size} onChange={set("pack_size")} /></Field>
            <Field label="Minimum order" hint="All variants together"><input type="number" min="1" disabled={!canEdit} className={inputCls} value={form.min_order_qty} onChange={set("min_order_qty")} /></Field>
            <Field label="Sold in multiples of" hint="e.g. 10 = cases of 10"><input type="number" min="1" disabled={!canEdit} className={inputCls} value={form.order_multiple} onChange={set("order_multiple")} /></Field>
            <Field label="Cost price" hint={isNew ? "Starting cost" : "Updated when stock is received"}><input type="number" min="0" step="0.0001" disabled={!canEdit} className={inputCls} value={form.cost_price} onChange={set("cost_price")} /></Field>
            <Field label="Reorder point" hint="Alert at this stock level"><input type="number" min="0" disabled={!canEdit} className={inputCls} value={form.reorder_point} onChange={set("reorder_point")} /></Field>
            <Field label="Reorder quantity"><input type="number" min="0" disabled={!canEdit} className={inputCls} value={form.reorder_quantity} onChange={set("reorder_quantity")} /></Field>
            {suppliers.length > 0 && (
              <Field label="Preferred supplier">
                <select disabled={!canEdit} className={inputCls} value={form.preferred_supplier_id} onChange={set("preferred_supplier_id")}>
                  <option value="">None</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
          </div>
        </Section>

        <Section title="Sale" subtitle="A % off the price for every buyer, for a limited time. Buyers pay whichever is lower: their usual price or the sale price.">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Discount (%)" hint="Empty = no sale"><input type="number" min="0.01" max="99.99" step="0.01" disabled={!canEdit} className={inputCls} value={form.sale_percent} onChange={set("sale_percent")} /></Field>
            <Field label="Label" hint="e.g. Summer sale"><input maxLength={60} disabled={!canEdit} className={inputCls} value={form.sale_label} onChange={set("sale_label")} /></Field>
            <Field label="Starts" hint="Empty = now"><input type="datetime-local" disabled={!canEdit} className={inputCls} value={form.sale_starts_at} onChange={set("sale_starts_at")} /></Field>
            <Field label="Ends" hint="Empty = until you remove it"><input type="datetime-local" disabled={!canEdit} className={inputCls} value={form.sale_ends_at} min={form.sale_starts_at || undefined} onChange={set("sale_ends_at")} /></Field>
          </div>
          {form.sale_percent !== "" && form.price !== "" && Number(form.sale_percent) > 0 && (
            <p className="text-sm text-gray-600 mt-2">Sale price: <b>${(Number(form.price) * (1 - Number(form.sale_percent) / 100)).toFixed(2)}</b> instead of ${Number(form.price).toFixed(2)}{variantKeys.length ? " (variants with their own price get the same % off)" : ""}.</p>
          )}
        </Section>

        <Section title="Categories" subtitle="The first one is the main category. Categories decide which details are suggested.">
          <CategoryPicker categories={categories} value={categoryIds} onChange={setCategoryIds} onCreated={loadCategories} disabled={!canEdit} />
        </Section>

        <Section title="Who can see it">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm"><input type="radio" disabled={!canEdit} checked={form.visibility === "public"} onChange={() => setForm({ ...form, visibility: "public" })} /> Everyone on the marketplace</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" disabled={!canEdit} checked={form.visibility === "groups"} onChange={() => setForm({ ...form, visibility: "groups" })} /> Only customers in these groups</label>
            {form.visibility === "groups" && (
              <div className="pl-6 flex flex-wrap gap-2">
                {groups.length === 0 && <span className="text-sm text-gray-400">No customer groups yet (Pricing & promos → Customer groups).</span>}
                {groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg px-2 py-1">
                    <input type="checkbox" disabled={!canEdit} checked={groupIds.includes(g.id)} onChange={(e) => setGroupIds(e.target.checked ? [...groupIds, g.id] : groupIds.filter((x) => x !== g.id))} /> {g.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        </Section>

        <Card className="p-5">
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <input type="checkbox" checked={showCompliance} disabled={!canEdit} onChange={(e) => { setShowCompliance(e.target.checked); if (!e.target.checked) setForm({ ...form, compliance_category: "none" }); }} />
            Regulated tobacco / vapor product (state taxes, flavour bans, licences)
          </label>
          {showCompliance && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
              <Field label="Compliance category">
                <select disabled={!canEdit} className={inputCls} value={form.compliance_category} onChange={set("compliance_category")}>
                  {Object.entries(COMPLIANCE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
                </select>
              </Field>
              <Field label="Liquid per unit (ml)"><input type="number" min="0" step="0.001" disabled={!canEdit} className={inputCls} value={form.nicotine_ml} onChange={set("nicotine_ml")} /></Field>
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mt-5">
                <input type="checkbox" disabled={!canEdit} checked={form.is_flavored} onChange={(e) => setForm({ ...form, is_flavored: e.target.checked })} /> Flavored (other than tobacco)
              </label>
            </div>
          )}
        </Card>

        {canEdit && (
          <div className="flex justify-end gap-2 sticky bottom-0 bg-gray-50/90 backdrop-blur py-3">
            <button type="button" className={btnSecondary} onClick={() => navigate("/business/products")}>Cancel</button>
            <button disabled={saving} className={btnPrimary}><Save size={16} /> {saving ? "Saving…" : isNew ? "Create product" : "Save product"}</button>
          </div>
        )}
      </form>

      {!isNew && (
        <>
          <VariantsSection productId={product.id} basePrice={product.price} canEdit={canEdit || can("inventory.manage")} onSaved={loadProduct} />
          <DetailsSection productId={product.id} categoryIds={product.category_ids || []} canEdit={canEdit} onSaved={loadProduct} />
          <ImagesSection productId={product.id} initial={product.images || []} variantKeys={variantKeys} canEdit={canEdit} />
          {canEdit && (
            <div className="flex justify-end">
              <button className={btnDanger} onClick={async () => {
                if (!window.confirm(`Delete "${product.title}"? Products with orders or stock history are archived instead.`)) return;
                try {
                  toast.success((await catalogApi.remove(companyId!, product.id)).message);
                  navigate("/business/products");
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}><Trash2 size={16} /> Delete product</button>
            </div>
          )}
          {product.variants?.data?.some((v: CompanyVariant) => v.cost_price != null) && (
            <p className="text-xs text-gray-400">Average cost per variant: {product.variants.data.filter((v: CompanyVariant) => v.cost_price != null).map((v: CompanyVariant) => `${v.name} ${money(v.cost_price)}`).join(" · ")}</p>
          )}
        </>
      )}
    </div>
  );
};

export default ProductEditorPage;
