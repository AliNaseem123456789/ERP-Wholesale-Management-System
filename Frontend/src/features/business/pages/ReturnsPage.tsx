import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Undo2, Search, Check, X, PackageCheck, Receipt } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { salesApi, customerName, RETURN_REASONS } from "../api/sales.api";
import { useWarehouses } from "../components/supply";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Modal, Field, FilterTabs, money, dateOnly, dateTime, inputCls, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

const ReturnDetail: React.FC<{ id: number; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const { companyId, can } = useBusiness();
  const canManage = can("returns.manage");
  const canReceive = can("returns.receive") || canManage;
  const warehouses = useWarehouses();
  const [r, setR] = useState<any>(null);
  const [tracked, setTracked] = useState(false);
  const [notes, setNotes] = useState("");
  const [receive, setReceive] = useState<Record<number, { quantity_received: string; condition: string; restock: boolean }>>({});
  const [warehouseId, setWarehouseId] = useState("");
  const [resolution, setResolution] = useState("credit_invoice");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    salesApi.returnRequest(companyId!, id).then((d) => {
      setR(d.data);
      setTracked(d.inventoryTracked);
      setNotes(d.data.staff_notes || "");
      setReceive(Object.fromEntries(d.data.items.map((i: any) => [i.id, { quantity_received: String(i.quantity), condition: "resellable", restock: true }])));
    }).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, id]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<any>) => {
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
    <Modal title={r ? `Return ${r.rma_number}` : "Return"} onClose={onClose} wide>
      {!r ? <Spinner /> : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={r.status} />
            <span className="text-gray-500">Requested {dateTime(r.created_at)}</span>
            <Link to={`/business/orders?open=${r.order.id}`} className="font-mono font-bold text-blue-600">{r.order.order_number}</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-gray-400">Customer</p><p className="font-semibold">{customerName(r.customer)}</p><p>{r.customer?.email}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-gray-400">Reason</p><p className="font-semibold">{r.reason_label}</p>{r.customer_notes && <p className="text-gray-600">“{r.customer_notes}”</p>}</div>
          </div>

          <table className="w-full">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Item</th><th className="text-center">Ordered</th><th className="text-center">Returning</th><th className="text-right">Price</th>{["received", "closed"].includes(r.status) && <><th className="text-center">Received</th><th>Condition</th></>}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {r.items.map((i: any) => (
                <tr key={i.id}>
                  <td className="py-1.5 font-semibold">{i.title}<span className="text-xs text-gray-400 ml-1">{i.sku}</span></td>
                  <td className="text-center">{i.ordered}</td><td className="text-center font-bold">{i.quantity}</td><td className="text-right">{money(i.unit_price)}</td>
                  {["received", "closed"].includes(r.status) && <><td className="text-center">{i.quantity_received}</td><td>{i.condition}{i.restock && i.quantity_received > 0 ? " · restocked" : ""}</td></>}
                </tr>
              ))}
            </tbody>
          </table>

          {r.credit_note && (
            <div className="bg-green-50 border border-green-100 rounded-xl p-3 flex items-center gap-3">
              <Receipt size={16} /> Credit note <Link to={`/business/invoices?tab=credits&open=${r.credit_note.id}`} className="font-mono font-bold text-green-800">{r.credit_note.credit_note_number}</Link>
              <span>{money(r.credit_note.total_amount)}</span><StatusBadge status={r.credit_note.status} />
            </div>
          )}
          {r.status === "closed" && !r.credit_note && <p className="text-gray-600">Closed without credit.</p>}

          {(canManage && ["requested", "approved"].includes(r.status)) && (
            <Field label="Message to the customer"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Ship to our warehouse at ..., write the RMA number on the box" /></Field>
          )}

          {canManage && r.status === "requested" && (
            <div className="flex justify-end gap-2">
              <button disabled={busy} onClick={() => act(() => salesApi.rejectReturn(companyId!, r.id, notes))} className={btnDanger}><X size={16} /> Reject</button>
              <button disabled={busy} onClick={() => act(() => salesApi.approveReturn(companyId!, r.id, { staff_notes: notes }))} className={btnPrimary}><Check size={16} /> Approve</button>
            </div>
          )}

          {canReceive && r.status === "approved" && (
            <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3 space-y-3">
              <p className="font-bold">Receive the returned goods</p>
              {r.items.map((i: any) => {
                const v = receive[i.id] || { quantity_received: "0", condition: "resellable", restock: true };
                const set = (patch: any) => setReceive((prev) => ({ ...prev, [i.id]: { ...v, ...patch } }));
                return (
                  <div key={i.id} className="grid grid-cols-[1fr_90px_140px_auto] gap-2 items-center">
                    <span className="font-semibold">{i.title}</span>
                    <input type="number" min={0} max={i.quantity} className={inputCls} value={v.quantity_received} onChange={(e) => set({ quantity_received: e.target.value })} aria-label="Quantity received" />
                    <select className={inputCls} value={v.condition} onChange={(e) => set({ condition: e.target.value, restock: e.target.value === "resellable" })} aria-label="Condition">
                      <option value="resellable">Resellable</option><option value="damaged">Damaged</option><option value="expired">Expired</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={v.condition !== "resellable"} checked={v.restock && v.condition === "resellable"} onChange={(e) => set({ restock: e.target.checked })} /> Restock</label>
                  </div>
                );
              })}
              {tracked && (
                <div className="max-w-xs">
                  <Field label="Restock into warehouse">
                    <select className={inputCls} value={warehouseId || String(r.warehouse?.id || warehouses.find((w) => w.is_default)?.id || "")} onChange={(e) => setWarehouseId(e.target.value)}>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
                    </select>
                  </Field>
                </div>
              )}
              <div className="flex justify-between gap-2">
                {canManage ? <button disabled={busy} onClick={() => act(() => salesApi.rejectReturn(companyId!, r.id, notes))} className={btnDanger}><X size={16} /> Reject</button> : <span />}
                <button
                  disabled={busy}
                  onClick={() => act(() => salesApi.receiveReturn(companyId!, r.id, {
                    warehouse_id: warehouseId || undefined,
                    items: r.items.map((i: any) => ({ id: i.id, quantity_received: Number(receive[i.id]?.quantity_received || 0), condition: receive[i.id]?.condition, restock: receive[i.id]?.restock })),
                  }))}
                  className={btnPrimary}
                ><PackageCheck size={16} /> Mark received</button>
              </div>
            </div>
          )}

          {canManage && r.status === "received" && (
            <div className="bg-green-50/60 border border-green-100 rounded-xl p-3 space-y-3">
              <p className="font-bold">Resolve</p>
              <div className="space-y-1">
                <label className="flex items-center gap-2"><input type="radio" checked={resolution === "credit_invoice"} onChange={() => setResolution("credit_invoice")} /> Credit note, applied to the order's invoice (any rest stays as credit)</label>
                <label className="flex items-center gap-2"><input type="radio" checked={resolution === "refund"} onChange={() => setResolution("refund")} /> Credit note, refunded to the customer</label>
                <label className="flex items-center gap-2"><input type="radio" checked={resolution === "no_credit"} onChange={() => setResolution("no_credit")} /> Close without credit (e.g. replaced)</label>
              </div>
              <p className="text-xs text-gray-500">The credit is the price paid for the received items, less the order's discount share, plus tax.</p>
              <div className="flex justify-end"><button disabled={busy} onClick={() => act(() => salesApi.resolveReturn(companyId!, r.id, { resolution }))} className={btnPrimary}>Close return</button></div>
            </div>
          )}
          {r.staff_notes && !["requested", "approved"].includes(r.status) && <p className="text-xs text-gray-500">Note: {r.staff_notes}</p>}
        </div>
      )}
    </Modal>
  );
};

/** Staff-created return for an order (starts approved). */
export const CreateReturnModal: React.FC<{ orderId: number; orderNumber: string; onClose: () => void; onCreated: (id: number) => void }> = ({ orderId, orderNumber, onClose, onCreated }) => {
  const { companyId } = useBusiness();
  const [lines, setLines] = useState<any[] | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("damaged");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    salesApi.returnable(companyId!, orderId).then((d) => setLines(d.data)).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, orderId]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const items = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ order_item_id: Number(k), quantity: Number(v) }));
      const res = await salesApi.createReturn(companyId!, { order_id: orderId, reason, staff_notes: notes, items });
      toast.success(res.message);
      onCreated(res.data.id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal title={`Return items from ${orderNumber}`} onClose={onClose}>
      {!lines ? <Spinner /> : (
        <form onSubmit={submit} className="space-y-3 text-sm">
          {lines.map((l) => (
            <div key={l.order_item_id} className="flex items-center gap-3">
              <span className="flex-1">{l.title} <span className="text-xs text-gray-400">({l.returnable} of {l.quantity} returnable)</span></span>
              <input type="number" min={0} max={l.returnable} disabled={!l.returnable} className={`${inputCls} w-24`} value={qty[l.order_item_id] || ""} onChange={(e) => setQty({ ...qty, [l.order_item_id]: e.target.value })} aria-label={`Quantity of ${l.title}`} />
            </div>
          ))}
          <Field label="Reason">
            <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(RETURN_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Note to the customer"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Create return</button></div>
        </form>
      )}
    </Modal>
  );
};

const TABS = [
  { value: "", label: "All" }, { value: "requested", label: "To review" }, { value: "approved", label: "Awaiting goods" },
  { value: "received", label: "To resolve" }, { value: "closed", label: "Closed" }, { value: "rejected", label: "Rejected" },
];

export const ReturnsPage: React.FC = () => {
  const { companyId } = useBusiness();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<any>(null);
  const openId = params.get("open");
  const load = useCallback(() => {
    salesApi.returns(companyId!, { status, search }).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, status, search]);
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <PageHeader title="Returns" subtitle="Return requests (RMA): approve, receive back into stock, and credit the customer" />
      <Card>
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <FilterTabs value={status} onChange={setStatus} options={TABS.map((t) => ({ ...t, count: t.value && ["requested", "approved", "received"].includes(t.value) ? data?.counts?.[t.value] : undefined }))} />
          <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input className={`${inputCls} pl-9`} placeholder="RMA #, order # or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {!data ? <Spinner /> : data.data.length === 0 ? (
          <EmptyState icon={<Undo2 size={40} />} title="No returns" text="Customers request returns from their order page. You can also start one from an order." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Return</th><th className="px-4 py-3">Order</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3 text-right">Units</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {data.data.map((r: any) => (
                <tr key={r.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setParams({ open: String(r.id) })}>
                  <td className="px-4 py-3"><p className="font-mono font-bold text-blue-600">{r.rma_number}</p><p className="text-xs text-gray-500">{dateOnly(r.created_at)}</p></td>
                  <td className="px-4 py-3 font-mono">{r.order?.order_number}</td>
                  <td className="px-4 py-3">{customerName(r.customer)}</td>
                  <td className="px-4 py-3">{r.reason_label}</td>
                  <td className="px-4 py-3 text-right">{r.items.reduce((s: number, i: any) => s + i.quantity, 0)}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {openId && <ReturnDetail id={Number(openId)} onClose={() => setParams({})} onChanged={load} />}
    </div>
  );
};
