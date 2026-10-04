import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { supplyApi, Supplier } from "../api/supply.api";
import { ProductPicker, PickedProduct, useWarehouses, WarehouseSelect, FlavorSelect, hasFlavors } from "../components/supply";
import { Card, PageHeader, Spinner, Field, money, inputCls, btnPrimary, btnSecondary } from "../components/ui";

type Line = { product: PickedProduct | null; flavor: string; quantity: string; unit_cost: string };

export const PurchaseOrderFormPage: React.FC = () => {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { companyId } = useBusiness();
  const warehouses = useWarehouses();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [prices, setPrices] = useState<any[]>([]);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    supplier_id: params.get("supplier") || "", warehouse_id: "", expected_date: "", supplier_reference: "",
    notes: "", tax_amount: "0", shipping_amount: "0",
  });
  const [lines, setLines] = useState<Line[]>([{ product: null, flavor: "", quantity: "", unit_cost: "" }]);

  useEffect(() => {
    supplyApi.suppliers(companyId!, { active: true }).then(setSuppliers).catch(() => {});
  }, [companyId]);

  useEffect(() => {
    if (!form.warehouse_id && warehouses.length) {
      setForm((f) => ({ ...f, warehouse_id: String((warehouses.find((w) => w.is_default) || warehouses[0]).id) }));
    }
  }, [warehouses]);

  // Load the supplier's price list so unit costs fill in automatically.
  useEffect(() => {
    if (!form.supplier_id) return setPrices([]);
    supplyApi.supplier(companyId!, Number(form.supplier_id)).then((s) => setPrices(s.products)).catch(() => setPrices([]));
  }, [companyId, form.supplier_id]);

  // Editing an existing draft
  useEffect(() => {
    if (!id) return;
    supplyApi.purchaseOrder(companyId!, id).then((po) => {
      if (po.status !== "draft") {
        toast.error("Only drafts can be edited");
        navigate(`/business/purchase-orders/${id}`);
        return;
      }
      setForm({
        supplier_id: String(po.supplier_id), warehouse_id: String(po.warehouse_id),
        expected_date: po.expected_date ? po.expected_date.slice(0, 10) : "", supplier_reference: po.supplier_reference || "",
        notes: po.notes || "", tax_amount: String(po.tax_amount), shipping_amount: String(po.shipping_amount),
      });
      setLines(po.items.map((i: any) => ({ product: i.product, flavor: i.flavor || "", quantity: String(i.quantity_ordered), unit_cost: String(i.unit_cost) })));
      setLoading(false);
    });
  }, [id, companyId]);

  const priceFor = (productId: number) => prices.find((p) => p.product_id === productId);

  const setLine = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const pickProduct = (i: number, p: PickedProduct | null) => {
    const sp = p ? priceFor(p.id) : null;
    setLine(i, { product: p, flavor: p?.flavor || "", unit_cost: p ? String(sp?.unit_cost ?? p.cost_price ?? "") : "" });
  };

  const subtotal = useMemo(() => lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0), [lines]);
  const total = subtotal + Number(form.tax_amount || 0) + Number(form.shipping_amount || 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = lines.filter((l) => l.product && Number(l.quantity) > 0).map((l) => ({
      product_id: l.product!.id, flavor: l.flavor || undefined, quantity: Number(l.quantity), unit_cost: l.unit_cost === "" ? undefined : Number(l.unit_cost),
    }));
    if (!form.supplier_id) return toast.error("Choose a supplier");
    if (!items.length) return toast.error("Add at least one product with a quantity");
    setSaving(true);
    try {
      const body = { ...form, items, tax_amount: Number(form.tax_amount || 0), shipping_amount: Number(form.shipping_amount || 0) };
      const res = id ? await supplyApi.updatePurchaseOrder(companyId!, id, body) : await supplyApi.createPurchaseOrder(companyId!, body);
      toast.success(res.message);
      navigate(`/business/purchase-orders/${res.data.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title={id ? "Edit purchase order" : "New purchase order"} />
      <form onSubmit={submit} className="space-y-4">
        <Card className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Supplier *">
            <select required className={inputCls} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
              <option value="">Choose a supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Deliver to"><WarehouseSelect value={form.warehouse_id} onChange={(v) => setForm({ ...form, warehouse_id: v })} warehouses={warehouses} /></Field>
          <Field label="Expected delivery"><input type="date" className={inputCls} value={form.expected_date} onChange={(e) => setForm({ ...form, expected_date: e.target.value })} /></Field>
          <Field label="Supplier reference"><input className={inputCls} value={form.supplier_reference} onChange={(e) => setForm({ ...form, supplier_reference: e.target.value })} placeholder="Their quote / order #" /></Field>
          <div className="md:col-span-2"><Field label="Notes for the supplier"><input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
        </Card>

        <Card className="p-5 space-y-3">
          <div className="hidden md:grid grid-cols-[1fr_150px_110px_130px_110px_32px] gap-2 text-[10px] font-bold uppercase text-gray-400">
            <span>Product</span><span>Flavour</span><span>Quantity</span><span>Unit cost</span><span className="text-right">Line total</span><span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_150px_110px_130px_110px_32px] gap-2 items-center">
              <ProductPicker value={l.product} onChange={(p) => pickProduct(i, p)} />
              {hasFlavors(l.product) ? <FlavorSelect product={l.product} value={l.flavor} onChange={(f) => setLine(i, { flavor: f })} /> : <span className="text-xs text-gray-400">—</span>}
              <input type="number" min={1} placeholder="Qty" className={inputCls} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              <input type="number" min={0} step="0.0001" placeholder="Unit cost" className={inputCls} value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} />
              <span className="text-right font-bold">{money(Number(l.quantity || 0) * Number(l.unit_cost || 0))}</span>
              <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} disabled={lines.length === 1} className="text-gray-400 hover:text-red-600 disabled:opacity-30" aria-label="Remove line"><Trash2 size={16} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setLines((prev) => [...prev, { product: null, flavor: "", quantity: "", unit_cost: "" }])} className="text-sm font-semibold text-blue-600 hover:underline">+ Add line</button>

          <div className="border-t border-gray-100 pt-4 ml-auto max-w-xs space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><b>{money(subtotal)}</b></div>
            <div className="flex justify-between items-center gap-2"><span className="text-gray-500">Tax</span><input type="number" min={0} step="0.01" className={`${inputCls} w-28 text-right`} value={form.tax_amount} onChange={(e) => setForm({ ...form, tax_amount: e.target.value })} /></div>
            <div className="flex justify-between items-center gap-2"><span className="text-gray-500">Shipping</span><input type="number" min={0} step="0.01" className={`${inputCls} w-28 text-right`} value={form.shipping_amount} onChange={(e) => setForm({ ...form, shipping_amount: e.target.value })} /></div>
            <div className="flex justify-between text-lg pt-2 border-t border-gray-100"><span className="font-bold">Total</span><span className="font-black">{money(total)}</span></div>
          </div>
        </Card>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => navigate(-1)} className={btnSecondary}>Cancel</button>
          <button disabled={saving} className={btnPrimary}>{saving ? "Saving..." : id ? "Save draft" : "Create draft"}</button>
        </div>
      </form>
    </div>
  );
};
