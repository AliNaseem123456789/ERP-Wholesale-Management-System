import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Send, PackageCheck, Printer, Pencil, XCircle, Lock, ArrowLeft, Receipt } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { supplyApi, Bin } from "../api/supply.api";
import { Undo2 } from "lucide-react";
import { Card, Spinner, StatusBadge, Modal, money, dateOnly, dateTime, inputCls, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

const ReceiveModal: React.FC<{ po: any; onClose: () => void; onDone: (po: any) => void }> = ({ po, onClose, onDone }) => {
  const { companyId } = useBusiness();
  const [bins, setBins] = useState<Bin[]>([]);
  const open = po.items.filter((i: any) => i.outstanding > 0);
  const [lines, setLines] = useState<Record<number, { quantity: string; lot_number: string; expiry_date: string; bin_id: string }>>(
    () => Object.fromEntries(open.map((i: any) => [i.id, { quantity: String(i.outstanding), lot_number: "", expiry_date: "", bin_id: "" }])),
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // Freight/duty for this delivery: defaults to the PO shipping not yet added to stock cost.
  const remainingShipping = Math.max(0, Math.round((Number(po.shipping_amount || 0) - Number(po.landed_allocated || 0)) * 100) / 100);
  const [landed, setLanded] = useState({ cost: remainingShipping ? String(remainingShipping) : "", allocation: "value", notes: remainingShipping ? "PO shipping" : "" });

  useEffect(() => {
    supplyApi.bins(companyId!, po.warehouse_id).then((b) => setBins(b.filter((x) => x.is_active))).catch(() => {});
  }, [companyId, po.warehouse_id]);

  const set = (id: number, k: string, v: string) => setLines({ ...lines, [id]: { ...lines[id], [k]: v } });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = Object.entries(lines)
      .filter(([, l]) => Number(l.quantity) > 0)
      .map(([item_id, l]) => ({ item_id: Number(item_id), ...l, quantity: Number(l.quantity) }));
    if (!payload.length) return toast.error("Enter at least one quantity");
    setSaving(true);
    try {
      const res = await supplyApi.receivePurchaseOrder(companyId!, po.id, {
        lines: payload, notes,
        landed_cost: landed.cost === "" ? 0 : Number(landed.cost), landed_allocation: landed.allocation, landed_notes: landed.notes,
      });
      toast.success(res.message);
      onDone(res.data);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Receive ${po.po_number} into ${po.warehouse.name}`} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4 text-sm">
        <p className="text-gray-600">Enter what actually arrived. You can receive the rest later. Lot and expiry are optional but recommended for products that expire.</p>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b">
              <th className="py-2">Product</th><th className="text-right">Expected</th><th>Received now</th><th>Lot #</th><th>Expiry</th><th>Bin</th>
            </tr></thead>
            <tbody>
              {open.map((i: any) => (
                <tr key={i.id} className="border-b border-gray-50">
                  <td className="py-2 font-semibold pr-2">{i.product.title}{i.flavor ? <span className="text-blue-700"> · {i.flavor}</span> : null}</td>
                  <td className="text-right pr-3">{i.outstanding}</td>
                  <td className="pr-2"><input type="number" min={0} max={i.outstanding} className={`${inputCls} w-20`} value={lines[i.id].quantity} onChange={(e) => set(i.id, "quantity", e.target.value)} /></td>
                  <td className="pr-2"><input className={`${inputCls} w-28`} value={lines[i.id].lot_number} onChange={(e) => set(i.id, "lot_number", e.target.value)} /></td>
                  <td className="pr-2"><input type="date" className={`${inputCls} w-36`} value={lines[i.id].expiry_date} onChange={(e) => set(i.id, "expiry_date", e.target.value)} /></td>
                  <td>
                    <select className={`${inputCls} w-28`} value={lines[i.id].bin_id} onChange={(e) => set(i.id, "bin_id", e.target.value)}>
                      <option value="">—</option>
                      {bins.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-1 md:grid-cols-[140px_200px_1fr] gap-3 items-end">
          <label className="block">
            <span className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Landed cost</span>
            <input type="number" min={0} step="0.01" className={inputCls} value={landed.cost} onChange={(e) => setLanded({ ...landed, cost: e.target.value })} placeholder="0.00" />
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Spread by</span>
            <select className={inputCls} value={landed.allocation} onChange={(e) => setLanded({ ...landed, allocation: e.target.value })}>
              <option value="value">Line value</option><option value="quantity">Quantity</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">What for</span>
            <input className={inputCls} value={landed.notes} onChange={(e) => setLanded({ ...landed, notes: e.target.value })} placeholder="Freight, duty, customs…" />
          </label>
          <p className="md:col-span-3 text-xs text-gray-500">Freight, duty and other costs of this delivery are added to the cost of the units received, so stock value and margins include them.</p>
        </div>
        <input className={inputCls} placeholder="Notes (e.g. delivery note #, damaged cartons)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button disabled={saving} className={btnPrimary}><PackageCheck size={16} /> {saving ? "Receiving..." : "Receive into stock"}</button>
        </div>
      </form>
    </Modal>
  );
};

export const PurchaseOrderDetailPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { companyId, company, can } = useBusiness();
  const [po, setPo] = useState<any>(null);
  const [receiving, setReceiving] = useState(false);
  const [busy, setBusy] = useState(false);
  const canManage = can("purchasing.manage");
  const canReceive = can("purchasing.receive") || canManage;

  const load = useCallback(() => {
    supplyApi.purchaseOrder(companyId!, id!).then(setPo).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, id]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<any>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const res = await fn();
      toast.success(res.message);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!po) return <Spinner />;
  const receivable = ["draft", "sent", "partially_received"].includes(po.status) && po.items.some((i: any) => i.outstanding > 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4 no-print">
        <button onClick={() => navigate("/business/purchase-orders")} className="text-sm text-blue-600 font-semibold flex items-center gap-1 hover:underline"><ArrowLeft size={16} /> Purchase orders</button>
        <span className="flex-1" />
        {canManage && po.status === "draft" && <Link to={`/business/purchase-orders/${po.id}/edit`} className={btnSecondary}><Pencil size={16} /> Edit</Link>}
        {canManage && ["draft", "sent"].includes(po.status) && (
          <>
            <button disabled={busy} onClick={() => act(() => supplyApi.sendPurchaseOrder(companyId!, po.id, true))} className={btnSecondary} title={po.supplier.email || "Supplier has no email"}>
              <Send size={16} /> {po.status === "sent" ? "Re-send email" : "Email to supplier"}
            </button>
            {po.status === "draft" && <button disabled={busy} onClick={() => act(() => supplyApi.sendPurchaseOrder(companyId!, po.id, false))} className={btnSecondary}>Mark as sent</button>}
          </>
        )}
        {canReceive && receivable && <button onClick={() => setReceiving(true)} className={btnPrimary}><PackageCheck size={16} /> Receive</button>}
        {canManage && ["sent", "partially_received"].includes(po.status) && (
          <button disabled={busy} onClick={() => act(() => supplyApi.closePurchaseOrder(companyId!, po.id), "Close this PO? You won't be able to receive the remaining items.")} className={btnSecondary}><Lock size={16} /> Close</button>
        )}
        {canManage && ["draft", "sent"].includes(po.status) && (
          <button disabled={busy} onClick={() => act(() => supplyApi.cancelPurchaseOrder(companyId!, po.id), "Cancel this purchase order?")} className={btnDanger}><XCircle size={16} /> Cancel</button>
        )}
        {canManage && ["partially_received", "received", "closed"].includes(po.status) && (
          <Link to={`/business/supplier-returns?new=1&supplier=${po.supplier_id}&po=${po.id}`} className={btnSecondary}><Undo2 size={16} /> Return to supplier</Link>
        )}
        {can("accounting.manage") && ["partially_received", "received", "closed"].includes(po.status) && (
          <Link to={`/business/bills?po=${po.id}`} className={btnSecondary}><Receipt size={16} /> Enter bill</Link>
        )}
        <button onClick={() => window.print()} className={btnSecondary}><Printer size={16} /> Print</button>
      </div>

      <Card className="p-6 print-area">
        <div className="flex flex-wrap justify-between gap-6 mb-6">
          <div>
            <p className="text-xs font-bold uppercase text-gray-400 tracking-widest">Purchase order</p>
            <h1 className="text-3xl font-black text-gray-900">{po.po_number}</h1>
            <div className="mt-2 flex items-center gap-2 text-sm"><StatusBadge status={po.status} /><span className="text-gray-500">Ordered {dateOnly(po.order_date)}{po.expected_date ? ` · expected ${dateOnly(po.expected_date)}` : ""}</span></div>
            {po.supplier_reference && <p className="text-sm text-gray-500 mt-1">Supplier ref: {po.supplier_reference}</p>}
          </div>
          <div className="text-sm text-right">
            <p className="font-bold text-gray-900">{company?.name}</p>
            <p className="text-gray-500">{[company?.address_line1, company?.city, company?.state].filter(Boolean).join(", ")}</p>
            <p className="text-gray-500">{company?.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 text-sm">
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase text-gray-400 mb-1">Supplier</p>
            <p className="font-bold text-gray-900">{po.supplier.name}</p>
            {po.supplier.contact_name && <p>{po.supplier.contact_name}</p>}
            <p className="text-gray-600">{po.supplier.email}</p>
            <p className="text-gray-600">Terms: Net {po.supplier.payment_terms_days}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase text-gray-400 mb-1">Deliver to</p>
            <p className="font-bold text-gray-900">{po.warehouse.name} ({po.warehouse.code})</p>
            <p className="text-gray-600">{[po.warehouse.address_line1, po.warehouse.city, po.warehouse.state, po.warehouse.postal_code].filter(Boolean).join(", ")}</p>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b">
            <th className="py-2">Product</th><th>SKU</th><th className="text-right">Ordered</th><th className="text-right">Received</th><th className="text-right">Unit cost</th><th className="text-right">Total</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {po.items.map((i: any) => (
              <tr key={i.id}>
                <td className="py-2 font-semibold">{i.description || i.product.title}</td>
                <td className="text-gray-500">{i.product.sku || "—"}</td>
                <td className="text-right">{i.quantity_ordered}</td>
                <td className={`text-right ${i.quantity_received >= i.quantity_ordered ? "text-green-700 font-bold" : ""}`}>{i.quantity_received}</td>
                <td className="text-right">{money(i.unit_cost)}</td>
                <td className="text-right font-bold">{money(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-sm">
            {Number(po.landed_allocated) > 0 && <tr className="no-print"><td colSpan={6} className="pt-2 text-right text-xs text-blue-700">{money(po.landed_allocated)} of landed costs added to stock cost</td></tr>}
            <tr><td colSpan={5} className="pt-3 text-right text-gray-500">Subtotal</td><td className="pt-3 text-right">{money(po.subtotal)}</td></tr>
            <tr><td colSpan={5} className="text-right text-gray-500">Tax</td><td className="text-right">{money(po.tax_amount)}</td></tr>
            <tr><td colSpan={5} className="text-right text-gray-500">Shipping</td><td className="text-right">{money(po.shipping_amount)}</td></tr>
            <tr><td colSpan={5} className="text-right font-bold">Total</td><td className="text-right text-lg font-black">{money(po.total_amount)}</td></tr>
          </tfoot>
        </table>
        {po.notes && <p className="mt-4 text-sm"><b>Notes:</b> {po.notes}</p>}
      </Card>

      {po.receipts?.length > 0 && (
        <Card className="mt-4 no-print">
          <div className="px-5 py-4 border-b border-gray-100 font-bold text-gray-900">Goods receipts</div>
          <ul className="divide-y divide-gray-100 text-sm">
            {po.receipts.map((r: any) => (
              <li key={r.id} className="px-5 py-3">
                <p><span className="font-mono font-bold">{r.receipt_number}</span> · {dateTime(r.received_at)} · {r.users?.email || ""}
                  {Number(r.landed_cost) > 0 && <span className="text-blue-700"> · landed cost {money(r.landed_cost)}{r.landed_notes ? ` (${r.landed_notes})` : ""}, spread by {r.landed_allocation}</span>}</p>
                <p className="text-gray-600">
                  {r.goods_receipt_items.map((g: any) => `${g.quantity} × ${g.products.title}${g.flavor ? ` ${g.flavor}` : ""}${g.landed_unit_cost && Number(g.landed_unit_cost) !== Number(g.unit_cost) ? ` @ ${money(g.landed_unit_cost)} landed` : ""}${g.inventory_lots?.lot_number ? ` (lot ${g.inventory_lots.lot_number}${g.inventory_lots.expiry_date ? `, exp ${dateOnly(g.inventory_lots.expiry_date)}` : ""})` : ""}`).join(" · ")}
                </p>
                {r.notes && <p className="text-gray-500">{r.notes}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {receiving && <ReceiveModal po={po} onClose={() => setReceiving(false)} onDone={() => load()} />}
    </div>
  );
};
