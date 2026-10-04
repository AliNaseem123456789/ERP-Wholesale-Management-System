import React, { useCallback, useEffect, useState } from "react";
import { Undo2, Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { documentsApi, errorText, money, dateOnly, badgeCls } from "../../api/documents.api";

const STATUS_TEXT: Record<string, string> = {
  requested: "Waiting for the seller to review",
  approved: "Approved: send the items back with the return number on the package",
  rejected: "Not approved",
  received: "The seller received the items",
  closed: "Completed",
  cancelled: "Cancelled",
};

/** Ask a seller to take back items from a delivered order. */
export const RequestReturnModal: React.FC<{ orderId: number; orderNumber: string; onClose: () => void; onDone: () => void }> = ({ orderId, orderNumber, onClose, onDone }) => {
  const [data, setData] = useState<any>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("damaged");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    documentsApi.returnable(orderId).then(setData).catch((e) => toast.error(errorText(e)));
  }, [orderId]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ order_item_id: Number(k), quantity: Number(v) }));
    if (!items.length) return toast.error("Choose how many of each item you want to return");
    setBusy(true);
    try {
      toast.success((await documentsApi.requestReturn({ order_id: orderId, reason, notes, items })).message);
      onDone();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="bg-white text-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-lg">Return items from {orderNumber}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl" aria-label="Close">✕</button>
        </div>
        {!data ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-blue-600" /></div> : !data.eligible ? (
          <p className="p-6 text-sm text-gray-600">This order can't be returned online{data.deadline ? ` (the return window ended ${dateOnly(data.deadline)})` : ""}. Please contact the seller.</p>
        ) : (
          <form onSubmit={submit} className="p-6 space-y-4 text-sm">
            {data.data.map((l: any) => (
              <div key={l.order_item_id} className="flex items-center gap-3">
                <span className="flex-1">{l.title}<span className="block text-xs text-gray-400">{l.returnable} of {l.quantity} can be returned · {money(l.price)} each</span></span>
                <input type="number" min={0} max={l.returnable} disabled={!l.returnable} value={qty[l.order_item_id] || ""} onChange={(e) => setQty({ ...qty, [l.order_item_id]: e.target.value })} className="w-20 border border-gray-300 rounded-lg px-2 py-1.5" aria-label={`Quantity of ${l.title} to return`} />
              </div>
            ))}
            <label className="block">
              <span className="text-xs font-bold text-gray-500 uppercase">Reason</span>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 bg-white">
                {Object.entries(data.reasons as Record<string, string>).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-gray-500 uppercase">Details (optional)</span>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" />
            </label>
            {data.deadline && <p className="text-xs text-gray-500">Return window ends {dateOnly(data.deadline)}.</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 font-bold">Cancel</button>
              <button disabled={busy} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-50">Send request</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export const ReturnsTab: React.FC = () => {
  const [list, setList] = useState<any[] | null>(null);
  const load = useCallback(() => {
    documentsApi.returns().then(setList).catch((e) => toast.error(errorText(e)));
  }, []);
  useEffect(load, [load]);
  const cancel = async (id: number) => {
    if (!window.confirm("Cancel this return request?")) return;
    try {
      toast.success((await documentsApi.cancelReturn(id)).message);
      load();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  if (!list) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" size={32} /></div>;
  if (!list.length)
    return (
      <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed">
        <Undo2 className="mx-auto text-gray-300 mb-3" size={44} />
        <p className="font-bold text-gray-900">No returns</p>
        <p className="text-sm text-gray-500">To return items, open a delivered order and choose “Request a return”.</p>
      </div>
    );
  return (
    <div className="space-y-3">
      {list.map((r) => (
        <div key={r.id} className="border border-gray-200 rounded-2xl p-5 text-sm space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono font-bold text-gray-900">{r.rma_number}</span>
            <span className="text-gray-600">{r.company?.name} · order {r.order?.order_number}</span>
            <span className={badgeCls(r.status)}>{r.status}</span>
            <span className="ml-auto text-xs text-gray-500">{dateOnly(r.created_at)}</span>
          </div>
          <p className="text-gray-600">{STATUS_TEXT[r.status]} · {r.reason_label}</p>
          <ul className="text-gray-800">
            {r.items.map((i: any) => <li key={i.id}>{i.quantity} × {i.title}{["received", "closed"].includes(r.status) && i.quantity_received !== i.quantity ? ` (${i.quantity_received} received)` : ""}</li>)}
          </ul>
          {r.staff_notes && <p className="bg-gray-50 rounded-lg p-2 text-gray-700"><b>Seller:</b> {r.staff_notes}</p>}
          {r.credit_note && (
            <p className="flex items-center gap-2 text-green-700 font-semibold">
              Credit {r.credit_note.credit_note_number}: {money(r.credit_note.total_amount)}
              <button onClick={() => documentsApi.creditNotePdf(r.credit_note.id, r.credit_note.credit_note_number).catch((e) => toast.error(e.message))} className="inline-flex items-center gap-1 text-xs text-blue-600"><Download size={12} /> PDF</button>
            </p>
          )}
          {r.status === "requested" && <button onClick={() => cancel(r.id)} className="text-xs font-bold text-red-600">Cancel request</button>}
        </div>
      ))}
    </div>
  );
};
