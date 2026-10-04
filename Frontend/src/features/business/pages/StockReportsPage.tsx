import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { supplyApi } from "../api/supply.api";
import { useWarehouses, WarehouseSelect } from "../components/supply";
import { Card, PageHeader, Spinner, EmptyState, Pagination, Modal, Field, StatusBadge, money, dateOnly, dateTime, inputBase, inputCls, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

const TABS = [
  ["valuation", "Stock valuation"],
  ["expiring", "Expiring stock"],
  ["movements", "Stock movements"],
  ["transfers", "Transfers"],
] as const;

const TYPE_LABEL: Record<string, string> = {
  receipt: "Received", adjustment: "Adjustment", sale: "Sold", transfer_in: "Transfer in", transfer_out: "Transfer out",
  return: "Customer return", supplier_return: "Returned to supplier",
};

const Valuation: React.FC = () => {
  const { companyId } = useBusiness();
  const [d, setD] = useState<any>(null);
  useEffect(() => { supplyApi.valuation(companyId!).then(setD).catch((e) => toast.error(errorMessage(e))); }, [companyId]);
  if (!d) return <Spinner />;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Warehouse</th><th className="px-4 py-3 text-right">Products</th><th className="px-4 py-3 text-right">Units</th><th className="px-4 py-3 text-right">Value (avg cost)</th></tr></thead>
      <tbody className="divide-y divide-gray-100">
        {d.data.map((w: any) => (
          <tr key={w.warehouse_id}><td className="px-4 py-3 font-semibold">{w.name} ({w.code})</td><td className="px-4 py-3 text-right">{w.products}</td><td className="px-4 py-3 text-right">{w.units}</td><td className="px-4 py-3 text-right font-bold">{money(w.value)}</td></tr>
        ))}
      </tbody>
      <tfoot>
        {d.in_transit?.units > 0 && (
          <tr><td className="px-4 py-3 font-semibold text-blue-800">In transit between warehouses</td><td /><td className="px-4 py-3 text-right">{d.in_transit.units}</td><td className="px-4 py-3 text-right font-bold">{money(d.in_transit.value)}</td></tr>
        )}
        <tr className="bg-gray-50"><td className="px-4 py-3 font-bold">Total</td><td /><td className="px-4 py-3 text-right font-bold">{d.totals.units}</td><td className="px-4 py-3 text-right text-lg font-black">{money(d.totals.value)}</td></tr>
      </tfoot>
    </table>
  );
};

const Expiring: React.FC = () => {
  const { companyId } = useBusiness();
  const [days, setDays] = useState(60);
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { setRows(null); supplyApi.expiring(companyId!, days).then(setRows).catch((e) => toast.error(errorMessage(e))); }, [companyId, days]);
  return (
    <>
      <div className="p-4 border-b border-gray-100 flex items-center gap-2 text-sm">
        Expiring within
        <select className={`${inputBase} w-auto`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
        <span className="text-gray-500">(already expired stock is included)</span>
      </div>
      {!rows ? <Spinner /> : rows.length === 0 ? <EmptyState title="Nothing expiring in this period" /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Product</th><th className="px-4 py-3">Warehouse</th><th className="px-4 py-3">Bin</th><th className="px-4 py-3">Lot</th><th className="px-4 py-3">Expiry</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Value</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 font-semibold">{l.product.title}{l.flavor ? <span className="text-blue-700 font-normal"> · {l.flavor}</span> : null}</td><td className="px-4 py-3">{l.warehouse.code}</td><td className="px-4 py-3">{l.bin || "—"}</td><td className="px-4 py-3">{l.lot_number || "—"}</td>
                <td className={`px-4 py-3 font-semibold ${l.days_left < 0 ? "text-red-600" : l.days_left <= 30 ? "text-amber-700" : ""}`}>{dateOnly(l.expiry_date)} · {l.days_left < 0 ? `expired ${-l.days_left}d ago` : `${l.days_left}d left`}</td>
                <td className="px-4 py-3 text-right font-bold">{l.quantity}</td><td className="px-4 py-3 text-right">{money(l.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
};

const Movements: React.FC = () => {
  const { companyId } = useBusiness();
  const warehouses = useWarehouses(false);
  const [f, setF] = useState({ warehouse_id: "", type: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [d, setD] = useState<any>(null);
  useEffect(() => { setD(null); supplyApi.movements(companyId!, { ...f, page }).then(setD).catch((e) => toast.error(errorMessage(e))); }, [companyId, f, page]);
  return (
    <>
      <div className="p-4 border-b border-gray-100 flex flex-wrap gap-2 text-sm">
        <WarehouseSelect value={f.warehouse_id} onChange={(v) => { setF({ ...f, warehouse_id: v }); setPage(1); }} warehouses={warehouses} allowAll className={`${inputBase} w-auto`} />
        <select className={`${inputBase} w-auto`} value={f.type} onChange={(e) => { setF({ ...f, type: e.target.value }); setPage(1); }}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" className={`${inputBase} w-auto`} value={f.from} onChange={(e) => { setF({ ...f, from: e.target.value }); setPage(1); }} aria-label="From date" />
        <input type="date" className={`${inputBase} w-auto`} value={f.to} onChange={(e) => { setF({ ...f, to: e.target.value }); setPage(1); }} aria-label="To date" />
      </div>
      {!d ? <Spinner /> : d.data.length === 0 ? <EmptyState title="No movements" /> : (
        <>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">When</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Wh</th><th className="px-4 py-3">Lot</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Balance</th><th className="px-4 py-3">Note / by</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {d.data.map((m: any) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{dateTime(m.created_at)}</td>
                  <td className="px-4 py-2 font-semibold">{m.product.title}{m.flavor ? <span className="text-blue-700 font-normal"> · {m.flavor}</span> : null}</td>
                  <td className="px-4 py-2">{TYPE_LABEL[m.type] || m.type}{m.reason ? <span className="text-gray-400"> · {m.reason.replace(/_/g, " ")}</span> : null}</td>
                  <td className="px-4 py-2">{m.warehouse}</td><td className="px-4 py-2">{m.lot_number || "—"}</td>
                  <td className={`px-4 py-2 text-right font-bold ${m.quantity < 0 ? "text-red-600" : "text-green-700"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity}</td>
                  <td className="px-4 py-2 text-right">{m.balance_after}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{[m.notes, m.user].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={d.page} totalPages={d.totalPages} onChange={setPage} />
        </>
      )}
    </>
  );
};

const ReceiveTransferModal: React.FC<{ t: any; onClose: () => void; onDone: () => void }> = ({ t, onClose, onDone }) => {
  const { companyId } = useBusiness();
  const [qty, setQty] = useState<Record<number, string>>(() => Object.fromEntries(t.stock_transfer_items.map((i: any) => [i.id, String(i.quantity)])));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await supplyApi.receiveTransfer(companyId!, t.id, { notes, lines: t.stock_transfer_items.map((i: any) => ({ item_id: i.id, quantity_received: Number(qty[i.id] || 0) })) });
      toast.success(res.message);
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Receive ${t.transfer_number} at ${t.to_warehouse.code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        {t.stock_transfer_items.map((i: any) => (
          <div key={i.id} className="flex items-center gap-3">
            <span className="flex-1">{i.products.title}{i.flavor ? ` (${i.flavor})` : ""} <span className="text-gray-400">· {i.quantity} shipped</span></span>
            <input type="number" min={0} max={i.quantity} className={`${inputCls} w-24`} value={qty[i.id]} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} aria-label={`Received ${i.products.title}`} />
          </div>
        ))}
        <p className="text-xs text-gray-500">Anything not received is recorded as lost in transit.</p>
        <Field label="Notes"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button disabled={busy} className={btnPrimary}>Receive</button></div>
      </form>
    </Modal>
  );
};

const Transfers: React.FC = () => {
  const { companyId, can } = useBusiness();
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  const [receiving, setReceiving] = useState<any>(null);
  const load = useCallback(() => {
    supplyApi.transfers(companyId!, status).then(setRows).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, status]);
  useEffect(load, [load]);
  const cancel = async (t: any) => {
    if (!window.confirm(`Cancel ${t.transfer_number}? The stock goes back to ${t.from_warehouse.code}.`)) return;
    try {
      toast.success((await supplyApi.cancelTransfer(companyId!, t.id)).message);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <>
      <div className="p-4 border-b border-gray-100 flex gap-2 text-sm items-center">
        <select className={`${inputBase} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Transfer status">
          <option value="">All transfers</option><option value="in_transit">In transit</option><option value="received">Received</option><option value="completed">Completed at once</option><option value="cancelled">Cancelled</option>
        </select>
      </div>
      {!rows ? <Spinner /> : !rows.length ? <EmptyState title="No transfers" /> : (
        <ul className="divide-y divide-gray-100 text-sm">
          {rows.map((t) => (
            <li key={t.id} className="px-5 py-3 flex flex-wrap gap-3 items-start">
              <div className="flex-1 min-w-[260px]">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold">{t.transfer_number}</span>
                  <StatusBadge status={t.status === "in_transit" ? "in transit" : t.status} />
                  <span>{t.from_warehouse.code} → {t.to_warehouse.code}</span>
                  <span className="text-gray-500">· {dateTime(t.created_at)} · {t.users?.email}</span>
                </p>
                <p className="text-gray-600">{t.stock_transfer_items.map((i: any) => `${i.quantity} × ${i.products.title}${i.flavor ? ` (${i.flavor})` : ""}${t.status === "received" && i.quantity_received !== i.quantity ? ` [${i.quantity_received} arrived]` : ""}`).join(" · ")}</p>
                <p className="text-xs text-gray-500">
                  Value {money(t.value)}
                  {t.carrier || t.tracking_number ? ` · ${[t.carrier, t.tracking_number].filter(Boolean).join(" ")}` : ""}
                  {t.status === "in_transit" && t.expected_date ? ` · expected ${dateOnly(t.expected_date)}` : ""}
                  {t.received_at && t.status === "received" ? ` · received ${dateTime(t.received_at)}` : ""}
                  {t.lost_units > 0 && <span className="text-red-600 font-semibold"> · {t.lost_units} lost in transit</span>}
                </p>
              </div>
              {t.status === "in_transit" && can("inventory.manage") && (
                <div className="flex gap-2">
                  <button onClick={() => cancel(t)} className={btnDanger}>Cancel</button>
                  <button onClick={() => setReceiving(t)} className={btnPrimary}>Receive</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {receiving && <ReceiveTransferModal t={receiving} onClose={() => setReceiving(null)} onDone={load} />}
    </>
  );
};

export const StockReportsPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") || "valuation") as (typeof TABS)[number][0];
  const setTab = (k: string) => setParams({ tab: k });
  return (
    <div>
      <PageHeader title="Stock reports" />
      <div className="flex flex-wrap gap-1 mb-4">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === k ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>{label}</button>
        ))}
      </div>
      <Card>
        {tab === "valuation" && <Valuation />}
        {tab === "expiring" && <Expiring />}
        {tab === "movements" && <Movements />}
        {tab === "transfers" && <Transfers />}
      </Card>
    </div>
  );
};
