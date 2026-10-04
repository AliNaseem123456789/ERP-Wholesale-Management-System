import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Undo2, Plus, Trash2, Truck, BadgeCheck, Ban, Lock } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { supplyApi, Supplier } from "../api/supply.api";
import { ProductPicker, PickedProduct, FlavorSelect, hasFlavors, useWarehouses, WarehouseSelect } from "../components/supply";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Modal, Field, FilterTabs, money, dateOnly, dateTime, inputCls, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

const REASONS: Record<string, string> = {
  damaged: "Damaged in delivery", defective: "Defective", expired: "Expired / short-dated", wrong_item: "Wrong item delivered",
  overstock: "Overstock", recall: "Recall", other: "Other",
};

type Line = { product: PickedProduct | null; flavor: string; quantity: string; unit_cost: string };

const NewReturnModal: React.FC<{ supplierId?: string; poId?: string; onClose: () => void; onCreated: (id: number) => void }> = ({ supplierId, poId, onClose, onCreated }) => {
  const { companyId } = useBusiness();
  const warehouses = useWarehouses();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [form, setForm] = useState({ supplier_id: supplierId || "", purchase_order_id: poId || "", warehouse_id: "", reason: "defective", notes: "" });
  const [lines, setLines] = useState<Line[]>([{ product: null, flavor: "", quantity: "", unit_cost: "" }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supplyApi.suppliers(companyId!).then(setSuppliers).catch(() => {});
  }, [companyId]);
  useEffect(() => {
    if (!form.warehouse_id && warehouses.length) setForm((f) => ({ ...f, warehouse_id: String((warehouses.find((w) => w.is_default) || warehouses[0]).id) }));
  }, [warehouses]);
  // Returning goods from a purchase order: start from what was received on it.
  useEffect(() => {
    if (!poId) return;
    supplyApi.purchaseOrder(companyId!, poId).then((po) => {
      setForm((f) => ({ ...f, supplier_id: String(po.supplier_id), warehouse_id: String(po.warehouse_id) }));
      const received = po.items.filter((i: any) => i.quantity_received > 0);
      if (received.length) {
        // don't overwrite lines the user already started
        setLines((prev) =>
          prev.some((l) => l.product)
            ? prev
            : received.map((i: any) => ({ product: { ...i.product, flavors: i.flavor ? [i.flavor] : [] }, flavor: i.flavor || "", quantity: "", unit_cost: String(i.unit_cost) })),
        );
      }
    }).catch(() => {});
  }, [companyId, poId]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = lines.filter((l) => l.product && Number(l.quantity) > 0).map((l) => ({
      product_id: l.product!.id, flavor: l.flavor || undefined, quantity: Number(l.quantity), unit_cost: l.unit_cost === "" ? undefined : Number(l.unit_cost),
    }));
    if (!items.length) return toast.error("Enter a quantity for at least one product");
    setBusy(true);
    try {
      const res = await supplyApi.createSupplierReturn(companyId!, { ...form, purchase_order_id: form.purchase_order_id || undefined, items });
      toast.success(res.message);
      onCreated(res.data.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Return goods to a supplier" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4 text-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Supplier *">
            <select required className={inputCls} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} disabled={!!poId}>
              <option value="">Choose a supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Ship from"><WarehouseSelect value={form.warehouse_id} onChange={(v) => setForm({ ...form, warehouse_id: v })} warehouses={warehouses} /></Field>
          <Field label="Reason">
            <select className={inputCls} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
              {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
        {poId && <p className="text-gray-600">Lines from the purchase order. Enter how many of each you're sending back.</p>}
        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-[1fr_150px_100px_120px_32px] gap-2 text-[10px] font-bold uppercase text-gray-400">
            <span>Product</span><span>Flavour</span><span>Quantity</span><span>Unit cost</span><span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_150px_100px_120px_32px] gap-2 items-center">
              <ProductPicker value={l.product} onChange={(p) => setLine(i, { product: p, flavor: p?.flavor || "", unit_cost: p?.cost_price != null ? String(p.cost_price) : "" })} />
              {hasFlavors(l.product) ? <FlavorSelect product={l.product} value={l.flavor} allowUnassigned onChange={(f) => setLine(i, { flavor: f })} /> : <span className="text-xs text-gray-400">—</span>}
              <input type="number" min={1} placeholder="Qty" className={inputCls} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label="Quantity to return" />
              <input type="number" min={0} step="0.0001" placeholder="Unit cost" className={inputCls} value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} aria-label="Unit cost" />
              <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} disabled={lines.length === 1} className="text-gray-400 hover:text-red-600 disabled:opacity-30" aria-label="Remove line"><Trash2 size={16} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setLines((prev) => [...prev, { product: null, flavor: "", quantity: "", unit_cost: "" }])} className="text-sm font-semibold text-blue-600 hover:underline">+ Add product</button>
        </div>
        <Field label="Notes for the supplier"><textarea rows={2} className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button disabled={busy} className={btnPrimary}>Save draft</button></div>
      </form>
    </Modal>
  );
};

const ReturnDetail: React.FC<{ id: number; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const { companyId, can } = useBusiness();
  const canManage = can("purchasing.manage");
  const canShip = canManage || can("purchasing.receive");
  const [r, setR] = useState<any>(null);
  const [credit, setCredit] = useState({ credit_amount: "", credit_reference: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    supplyApi.supplierReturn(companyId!, id).then((d) => {
      setR(d.data);
      setCredit({ credit_amount: String(d.data.total_amount), credit_reference: "" });
    }).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, id]);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<any>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      toast.success((await fn()).message);
      load();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={r ? `Supplier return ${r.return_number}` : "Supplier return"} onClose={onClose} wide>
      {!r ? <Spinner /> : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={r.status} />
            <span className="font-semibold">{r.supplier.name}</span>
            <span className="text-gray-500">from {r.warehouse.code} · {r.reason_label} · created {dateTime(r.created_at)}</span>
            {r.purchase_order && <Link to={`/business/purchase-orders/${r.purchase_order.id}`} className="font-mono font-bold text-blue-600">{r.purchase_order.po_number}</Link>}
          </div>
          <table className="w-full">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Item</th><th>Lot</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th className="text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {r.items.map((i: any) => (
                <tr key={i.id}><td className="py-1.5 font-semibold">{i.title}</td><td>{i.lot_number || "—"}</td><td className="text-right">{i.quantity}</td><td className="text-right">{money(i.unit_cost)}</td><td className="text-right font-bold">{money(i.line_total)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4} className="pt-2 text-right font-bold">Value</td><td className="pt-2 text-right font-black">{money(r.total_amount)}</td></tr></tfoot>
          </table>
          {r.notes && <p className="text-gray-700"><b>Notes:</b> {r.notes}</p>}
          {r.shipped_at && <p className="text-gray-600">Shipped {dateTime(r.shipped_at)}.</p>}
          {r.status === "credited" && <p className="bg-green-50 border border-green-100 rounded-xl p-3">Supplier credited <b>{money(r.credit_amount)}</b>{r.credit_reference ? ` (ref ${r.credit_reference})` : ""} on {dateOnly(r.credited_at)}.</p>}

          {r.status === "draft" && (
            <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
              {canManage && <button disabled={busy} onClick={() => act(() => supplyApi.cancelSupplierReturn(companyId!, r.id), "Cancel this return?")} className={btnDanger}><Ban size={16} /> Cancel</button>}
              <span className="flex-1" />
              {canShip && <button disabled={busy} onClick={() => act(() => supplyApi.shipSupplierReturn(companyId!, r.id, false))} className={btnSecondary}>Ship without email</button>}
              {canShip && <button disabled={busy} onClick={() => act(() => supplyApi.shipSupplierReturn(companyId!, r.id, true), "Ship the goods? The stock leaves your warehouse now and the supplier is emailed.")} className={btnPrimary}><Truck size={16} /> Ship &amp; email supplier</button>}
            </div>
          )}
          {r.status === "shipped" && canManage && (
            <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-1 md:grid-cols-[150px_1fr_auto_auto] gap-3 items-end">
              <Field label="Supplier credit"><input type="number" min={0} step="0.01" className={inputCls} value={credit.credit_amount} onChange={(e) => setCredit({ ...credit, credit_amount: e.target.value })} /></Field>
              <Field label="Their credit note #"><input className={inputCls} value={credit.credit_reference} onChange={(e) => setCredit({ ...credit, credit_reference: e.target.value })} /></Field>
              <button disabled={busy} onClick={() => act(() => supplyApi.closeSupplierReturn(companyId!, r.id), "Close without a credit from the supplier?")} className={btnSecondary}><Lock size={16} /> No credit</button>
              <button disabled={busy} onClick={() => act(() => supplyApi.creditSupplierReturn(companyId!, r.id, { ...credit, credit_amount: Number(credit.credit_amount) }))} className={btnPrimary}><BadgeCheck size={16} /> Record credit</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

const TABS = [
  { value: "", label: "All" }, { value: "draft", label: "Drafts" }, { value: "shipped", label: "Awaiting credit" },
  { value: "credited", label: "Credited" }, { value: "closed", label: "Closed" }, { value: "cancelled", label: "Cancelled" },
];

export const SupplierReturnsPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  const openId = params.get("open");
  const creating = params.get("new") === "1";
  const load = useCallback(() => {
    supplyApi.supplierReturns(companyId!, { status }).then((d) => setRows(d.data)).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, status]);
  useEffect(load, [load]);

  return (
    <div>
      <PageHeader
        title="Returns to suppliers"
        subtitle="Send faulty, expired or excess stock back and track the supplier's credit"
        actions={can("purchasing.manage") && <button onClick={() => setParams({ new: "1" })} className={btnPrimary}><Plus size={16} /> New return</button>}
      />
      <Card>
        <div className="p-4 border-b border-gray-100"><FilterTabs value={status} onChange={setStatus} options={TABS} /></div>
        {!rows ? <Spinner /> : rows.length === 0 ? (
          <EmptyState icon={<Undo2 size={40} />} title="No supplier returns" text="Start one here, or from a received purchase order." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Return</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3 text-right">Units</th><th className="px-4 py-3 text-right">Value</th><th className="px-4 py-3 text-right">Credit</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setParams({ open: String(r.id) })}>
                  <td className="px-4 py-3"><p className="font-mono font-bold text-blue-600">{r.return_number}</p><p className="text-xs text-gray-500">{dateOnly(r.created_at)}{r.purchase_order ? ` · ${r.purchase_order.po_number}` : ""}</p></td>
                  <td className="px-4 py-3 font-semibold">{r.supplier.name}</td>
                  <td className="px-4 py-3">{r.reason_label}</td>
                  <td className="px-4 py-3 text-right">{r.items.reduce((s: number, i: any) => s + i.quantity, 0)}</td>
                  <td className="px-4 py-3 text-right">{money(r.total_amount)}</td>
                  <td className="px-4 py-3 text-right">{r.credit_amount != null ? money(r.credit_amount) : "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {creating && (
        <NewReturnModal
          supplierId={params.get("supplier") || undefined}
          poId={params.get("po") || undefined}
          onClose={() => setParams({})}
          onCreated={(id) => { load(); setParams({ open: String(id) }); }}
        />
      )}
      {openId && <ReturnDetail id={Number(openId)} onClose={() => setParams({})} onChanged={load} />}
    </div>
  );
};
