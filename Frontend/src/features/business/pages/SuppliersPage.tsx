import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Truck, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { supplyApi, Supplier } from "../api/supply.api";
import { ProductPicker, PickedProduct } from "../components/supply";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Modal, Field, money, dateOnly, inputCls, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

const FIELDS: [keyof Supplier, string][] = [
  ["name", "Name *"], ["code", "Supplier code"], ["contact_name", "Contact person"], ["email", "Email (POs are sent here)"],
  ["phone", "Phone"], ["website", "Website"], ["address_line1", "Address"], ["city", "City"], ["state", "State"],
  ["postal_code", "ZIP"], ["country", "Country"], ["tax_id", "Tax ID"],
];

const SupplierForm: React.FC<{ supplier: Supplier | null; onClose: () => void; onSaved: () => void }> = ({ supplier, onClose, onSaved }) => {
  const { companyId } = useBusiness();
  const [form, setForm] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(FIELDS.map(([k]) => [k, String((supplier as any)?.[k] ?? "")])),
    payment_terms_days: String(supplier?.payment_terms_days ?? 30),
    currency: supplier?.currency || "USD",
    notes: supplier?.notes || "",
  }));
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form, payment_terms_days: Number(form.payment_terms_days) } as any;
      const res = supplier ? await supplyApi.updateSupplier(companyId!, supplier.id, body) : await supplyApi.createSupplier(companyId!, body);
      toast.success(res.message);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={supplier ? `Edit ${supplier.name}` : "New supplier"} onClose={onClose} wide>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {FIELDS.map(([k, label]) => (
          <Field key={k} label={label}>
            <input type={k === "email" ? "email" : "text"} className={inputCls} required={label.endsWith("*")} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </Field>
        ))}
        <Field label="Payment terms (days)"><input type="number" min={0} max={365} className={inputCls} value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} /></Field>
        <Field label="Currency"><input maxLength={3} className={inputCls} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></Field>
        <div className="md:col-span-2"><Field label="Notes"><textarea rows={2} className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
        <div className="md:col-span-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button disabled={saving} className={btnPrimary}>{saving ? "Saving..." : "Save supplier"}</button>
        </div>
      </form>
    </Modal>
  );
};

const SupplierDetail: React.FC<{ id: number; onClose: () => void; onEdit: (s: Supplier) => void; onChanged: () => void }> = ({ id, onClose, onEdit, onChanged }) => {
  const { companyId, can } = useBusiness();
  const canManage = can("purchasing.manage");
  const [s, setS] = useState<any>(null);
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [price, setPrice] = useState({ supplier_sku: "", unit_cost: "", lead_time_days: "", preferred: true });
  const load = () => supplyApi.supplier(companyId!, id).then(setS).catch((e) => toast.error(errorMessage(e)));
  useEffect(() => {
    load();
  }, [id]);

  const savePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return toast.error("Choose a product");
    try {
      await supplyApi.saveSupplierProduct(companyId!, id, { ...price, product_id: product.id });
      toast.success("Price saved");
      setProduct(null);
      setPrice({ supplier_sku: "", unit_cost: "", lead_time_days: "", preferred: true });
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${s.name}?`)) return;
    try {
      const res = await supplyApi.deleteSupplier(companyId!, id);
      toast.success(res.message);
      onChanged();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Modal title={s ? s.name : "Supplier"} onClose={onClose} wide>
      {!s ? <Spinner /> : (
        <div className="space-y-6 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-gray-400">Contact</p><p className="font-semibold">{s.contact_name || "—"}</p><p>{s.email || "no email"}</p><p>{s.phone}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-gray-400">Address</p><p>{[s.address_line1, s.city, s.state, s.postal_code].filter(Boolean).join(", ") || "—"}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-gray-400">Terms</p><p className="font-semibold">Net {s.payment_terms_days} · {s.currency}</p><StatusBadge status={s.is_active ? "active" : "inactive"} /></div>
          </div>

          <div>
            <h3 className="font-bold mb-2">Price list</h3>
            {s.products.length === 0 ? <p className="text-gray-500">No prices yet. Prices you add here fill in automatically on purchase orders.</p> : (
              <table className="w-full">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Product</th><th>Their SKU</th><th className="text-right">Unit cost</th><th className="text-right">Lead time</th><th /></tr></thead>
                <tbody>{s.products.map((p: any) => (
                  <tr key={p.id} className="border-b border-gray-50">
                    <td className="py-1.5 font-semibold">{p.product.title}</td><td>{p.supplier_sku || "—"}</td>
                    <td className="text-right">{money(p.unit_cost)}</td><td className="text-right">{p.lead_time_days != null ? `${p.lead_time_days} days` : "—"}</td>
                    <td className="text-right">{canManage && <button onClick={() => supplyApi.removeSupplierProduct(companyId!, id, p.product_id).then(load)} className="text-gray-400 hover:text-red-600" aria-label="Remove"><Trash2 size={14} /></button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {canManage && (
              <form onSubmit={savePrice} className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_120px_110px_100px_auto] gap-2 items-end bg-gray-50 rounded-xl p-3">
                <Field label="Product"><ProductPicker value={product} onChange={setProduct} /></Field>
                <Field label="Their SKU"><input className={inputCls} value={price.supplier_sku} onChange={(e) => setPrice({ ...price, supplier_sku: e.target.value })} /></Field>
                <Field label="Unit cost"><input type="number" min="0" step="0.0001" required className={inputCls} value={price.unit_cost} onChange={(e) => setPrice({ ...price, unit_cost: e.target.value })} /></Field>
                <Field label="Lead (days)"><input type="number" min="0" className={inputCls} value={price.lead_time_days} onChange={(e) => setPrice({ ...price, lead_time_days: e.target.value })} /></Field>
                <button className={btnPrimary}>Save</button>
                <label className="md:col-span-5 flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={price.preferred} onChange={(e) => setPrice({ ...price, preferred: e.target.checked })} /> Make this the preferred supplier for the product (used for reorder suggestions)</label>
              </form>
            )}
          </div>

          <div>
            <h3 className="font-bold mb-2">Recent purchase orders</h3>
            {s.orders.length === 0 ? <p className="text-gray-500">None yet.</p> : (
              <ul className="divide-y divide-gray-100">{s.orders.map((o: any) => (
                <li key={o.id} className="py-2 flex gap-3 items-center">
                  <Link to={`/business/purchase-orders/${o.id}`} className="font-mono font-bold text-blue-600">{o.po_number}</Link>
                  <StatusBadge status={o.status} /><span className="text-gray-500">{dateOnly(o.order_date)}</span>
                  <span className="ml-auto font-bold">{money(o.total_amount)}</span>
                </li>
              ))}</ul>
            )}
          </div>

          {canManage && (
            <div className="flex justify-between pt-2 border-t border-gray-100">
              <button onClick={remove} className={btnDanger}><Trash2 size={16} /> Delete</button>
              <div className="flex gap-2">
                <Link to={`/business/purchase-orders/new?supplier=${s.id}`} className={btnSecondary}>New purchase order</Link>
                <button onClick={() => onEdit(s)} className={btnPrimary}>Edit supplier</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export const SuppliersPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const canManage = can("purchasing.manage");
  const [list, setList] = useState<Supplier[] | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined);
  const [viewing, setViewing] = useState<number | null>(null);

  const load = useCallback(() => {
    supplyApi.suppliers(companyId!, { search }).then(setList).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, search]);
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <PageHeader title="Suppliers" subtitle="Who you buy from" actions={canManage && <button onClick={() => setEditing(null)} className={btnPrimary}><Plus size={16} /> New supplier</button>} />
      <Card>
        <div className="p-4 border-b border-gray-100">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input className={`${inputCls} pl-9`} placeholder="Search suppliers" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {!list ? <Spinner /> : list.length === 0 ? (
          <EmptyState icon={<Truck size={40} />} title="No suppliers yet" text="Add the companies you buy stock from." action={canManage && <button onClick={() => setEditing(null)} className={btnPrimary}><Plus size={16} /> New supplier</button>} />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Terms</th><th className="px-4 py-3 text-right">Products</th><th className="px-4 py-3 text-right">Open POs</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((s) => (
                <tr key={s.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setViewing(s.id)}>
                  <td className="px-4 py-3"><p className="font-semibold text-gray-900">{s.name}</p><p className="text-xs text-gray-500">{s.code}</p></td>
                  <td className="px-4 py-3"><p>{s.contact_name || "—"}</p><p className="text-xs text-gray-500">{s.email}</p></td>
                  <td className="px-4 py-3">Net {s.payment_terms_days}</td>
                  <td className="px-4 py-3 text-right">{s.productCount}</td>
                  <td className="px-4 py-3 text-right">{s.openPoCount ? `${s.openPoCount} · ${money(s.openPoValue)}` : "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={s.is_active ? "active" : "inactive"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {viewing && <SupplierDetail id={viewing} onClose={() => setViewing(null)} onEdit={(s) => { setViewing(null); setEditing(s); }} onChanged={load} />}
      {editing !== undefined && <SupplierForm supplier={editing} onClose={() => setEditing(undefined)} onSaved={load} />}
    </div>
  );
};
