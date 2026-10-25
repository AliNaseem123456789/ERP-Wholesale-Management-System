// Account → Stock alerts: products the buyer asked to hear about when they're back in stock.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { buyingApi, buyingError, StockAlert } from "../../api/buying.api";

export const StockAlertsTab: React.FC = () => {
  const [rows, setRows] = useState<StockAlert[] | null>(null);
  const load = () => buyingApi.alerts().then(setRows).catch((e) => { toast.error(buyingError(e)); setRows([]); });
  useEffect(() => { load(); }, []);
  if (!rows) return <div className="p-10 text-center text-gray-500">Loading…</div>;
  if (!rows.length)
    return (
      <div className="p-16 text-center bg-gray-50 rounded-3xl border-2 border-dashed">
        <BellRing className="mx-auto text-gray-400 mb-3" size={40} />
        <p className="text-gray-600 font-medium">No stock alerts.</p>
        <p className="text-sm text-gray-500">On an out-of-stock product, choose “Notify me” and we'll email you when it's back.</p>
      </div>
    );
  return (
    <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100">
      {rows.map((a) => (
        <div key={a.id} className="flex items-center gap-3 px-5 py-4">
          <div className="flex-1 min-w-0">
            <Link to={`/product/${a.product.slug || a.product.id}`} className="font-semibold text-gray-900 hover:text-blue-600">{a.title}</Link>
            <p className="text-xs text-gray-500">{a.product.company} · {a.notified_at ? `Back in stock: we emailed you on ${new Date(a.notified_at).toLocaleDateString()}` : `Waiting since ${new Date(a.created_at).toLocaleDateString()}`}</p>
          </div>
          {a.notified_at && <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700">in stock</span>}
          <button onClick={async () => { try { toast.success((await buyingApi.deleteAlert(a.id)).message); load(); } catch (e) { toast.error(buyingError(e)); } }}
            className="p-2 text-gray-400 hover:text-red-600" aria-label={`Remove alert for ${a.title}`}><Trash2 size={16} /></button>
        </div>
      ))}
    </div>
  );
};
