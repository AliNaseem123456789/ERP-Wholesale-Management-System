import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileSignature, Download, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "../../../../api/apiClient";
import { documentsApi, errorText, money, dateOnly, badgeCls } from "../../api/documents.api";

const STATUS_TEXT: Record<string, string> = {
  requested: "Waiting for the seller's prices",
  draft: "The seller is revising this quote",
  sent: "Ready: accept it to place the order",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
};

const AcceptForm: React.FC<{ quote: any; onDone: () => void; onCancel: () => void }> = ({ quote, onDone, onCancel }) => {
  const navigate = useNavigate();
  const [addresses, setAddresses] = useState<any[]>([]);
  const [addressId, setAddressId] = useState("");
  const [method, setMethod] = useState("cash_on_delivery");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    apiClient.get("/address").then((r) => {
      const list = r.data.data || [];
      setAddresses(list);
      const def = list.find((a: any) => a.is_default) || list[0];
      if (def) setAddressId(String(def.id));
    });
  }, []);
  const accept = async () => {
    if (!addressId) return toast.error("Add a shipping address first");
    setBusy(true);
    try {
      const res = await documentsApi.acceptQuote(quote.id, { shipping_address_id: Number(addressId), payment_method: method });
      toast.success(res.message);
      onDone();
      navigate("/account?tab=orders");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3 text-sm">
      <p className="font-bold text-gray-900">Place the order for {money(quote.total_amount)}</p>
      {addresses.length === 0 ? (
        <button onClick={() => navigate("/account?tab=addresses")} className="text-blue-700 font-bold">+ Add a shipping address first</button>
      ) : (
        <label className="block">
          <span className="text-xs font-bold text-gray-500 uppercase">Ship to</span>
          <select className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
            {addresses.map((a) => <option key={a.id} value={a.id}>{[a.full_name, a.address_line1, a.city, a.state].filter(Boolean).join(", ")}</option>)}
          </select>
        </label>
      )}
      <div className="flex gap-4">
        <label className="flex items-center gap-2"><input type="radio" checked={method === "cash_on_delivery"} onChange={() => setMethod("cash_on_delivery")} /> Cash on delivery</label>
        <label className="flex items-center gap-2"><input type="radio" checked={method === "on_account"} onChange={() => setMethod("on_account")} /> On account (if the seller gave you terms)</label>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-gray-300 bg-white font-bold text-gray-700">Back</button>
        <button disabled={busy || !addressId} onClick={accept} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-50">{busy ? "Placing order..." : "Accept & place order"}</button>
      </div>
    </div>
  );
};

export const QuotesTab: React.FC = () => {
  const [quotes, setQuotes] = useState<any[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [accepting, setAccepting] = useState<number | null>(null);
  const load = useCallback(() => {
    documentsApi.quotes().then(setQuotes).catch((e) => toast.error(errorText(e)));
  }, []);
  useEffect(load, [load]);

  const decline = async (q: any) => {
    if (!window.confirm(q.status === "requested" ? "Withdraw this quote request?" : "Decline this quote?")) return;
    try {
      toast.success((await documentsApi.declineQuote(q.id)).message);
      load();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  if (!quotes) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" size={32} /></div>;
  if (!quotes.length)
    return (
      <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed">
        <FileSignature className="mx-auto text-gray-300 mb-3" size={44} />
        <p className="font-bold text-gray-900">No quotes yet</p>
        <p className="text-sm text-gray-500">Buying in volume? Use “Request a quote” in your cart to ask a seller for a price.</p>
      </div>
    );

  return (
    <div className="space-y-3">
      {quotes.map((q) => (
        <div key={q.id} className="border border-gray-200 rounded-2xl overflow-hidden">
          <button onClick={() => setOpen(open === q.id ? null : q.id)} className="w-full flex flex-wrap items-center gap-3 px-5 py-4 text-left hover:bg-gray-50">
            <span className="font-mono font-bold text-gray-900">{q.quote_number}</span>
            <span className="font-semibold text-gray-700">{q.company?.name}</span>
            <span className={badgeCls(q.status)}>{q.status}</span>
            <span className="text-xs text-gray-500">{STATUS_TEXT[q.status]}{q.status === "sent" && q.valid_until ? ` · valid until ${dateOnly(q.valid_until)}` : ""}</span>
            <span className="ml-auto font-black text-gray-900">{money(q.total_amount)}</span>
          </button>
          {open === q.id && (
            <div className="px-5 pb-5 space-y-4 text-sm">
              <table className="w-full">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Product</th><th className="text-center">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {q.items.map((i: any) => <tr key={i.id}><td className="py-1.5 text-gray-900">{i.description || i.title}{i.flavor ? <span className="text-blue-700"> · {i.flavor}</span> : null}</td><td className="text-center">{i.quantity}</td><td className="text-right">{money(i.unit_price)}</td><td className="text-right font-semibold">{money(i.line_total)}</td></tr>)}
                </tbody>
              </table>
              <div className="flex flex-col items-end text-gray-700">
                <p>Subtotal {money(q.subtotal)}</p>
                {Number(q.discount_amount) > 0 && <p>Discount -{money(q.discount_amount)}</p>}
                <p>Shipping {money(q.shipping_amount)}</p>
                {Number(q.tax_amount) > 0 && <p>Tax {money(q.tax_amount)}</p>}
                <p className="font-black text-gray-900 text-base">Total {money(q.total_amount)}</p>
              </div>
              {q.notes && <p className="text-gray-600"><b>Seller's note:</b> {q.notes}</p>}
              {q.order && <p className="text-green-700 font-semibold">Became order {q.order.order_number}.</p>}
              {accepting === q.id ? (
                <AcceptForm quote={q} onDone={() => { setAccepting(null); load(); }} onCancel={() => setAccepting(null)} />
              ) : (
                <div className="flex flex-wrap gap-2 justify-end">
                  {q.status !== "requested" && <button onClick={() => documentsApi.quotePdf(q.id, q.quote_number).catch((e) => toast.error(e.message))} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg border border-gray-300 font-bold text-gray-700"><Download size={14} /> PDF</button>}
                  {["sent", "requested"].includes(q.status) && <button onClick={() => decline(q)} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg border border-red-200 text-red-600 font-bold"><X size={14} /> {q.status === "requested" ? "Withdraw" : "Decline"}</button>}
                  {q.can_accept && <button onClick={() => setAccepting(q.id)} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-blue-600 text-white font-bold"><Check size={14} /> Accept</button>}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
