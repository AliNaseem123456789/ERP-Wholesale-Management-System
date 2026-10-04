import React, { useEffect, useState } from "react";
import { FileText, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { documentsApi, errorText, money, dateOnly, badgeCls } from "../../api/documents.api";

const FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Unpaid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
];

export const InvoicesTab: React.FC = () => {
  const [status, setStatus] = useState("");
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    setData(null);
    documentsApi.invoices(status).then(setData).catch((e) => toast.error(errorText(e)));
  }, [status]);

  const pdf = (fn: () => Promise<void>) => fn().catch((e) => toast.error(e.message));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {data && (
          <>
            <div className="bg-gray-50 rounded-xl px-4 py-2"><p className="text-[10px] uppercase font-black text-gray-400">You owe</p><p className="text-lg font-black text-gray-900">{money(data.summary.outstanding)}</p></div>
            <div className={`rounded-xl px-4 py-2 ${data.summary.overdue > 0 ? "bg-red-50" : "bg-gray-50"}`}><p className="text-[10px] uppercase font-black text-gray-400">Overdue</p><p className={`text-lg font-black ${data.summary.overdue > 0 ? "text-red-700" : "text-gray-900"}`}>{money(data.summary.overdue)}</p></div>
          </>
        )}
        <div className="ml-auto flex gap-1">
          {FILTERS.map((f) => (
            <button key={f.value} onClick={() => setStatus(f.value)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${status === f.value ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{f.label}</button>
          ))}
        </div>
      </div>

      {!data ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" size={32} /></div>
      ) : data.data.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed">
          <FileText className="mx-auto text-gray-300 mb-3" size={44} />
          <p className="font-bold text-gray-900">No invoices</p>
          <p className="text-sm text-gray-500">Sellers send an invoice when your order ships.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-2xl">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-left text-[10px] uppercase text-gray-400 font-black tracking-widest"><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Seller</th><th className="px-4 py-3">Due</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Balance</th><th className="px-4 py-3">Status</th><th /></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {data.data.map((i: any) => (
                <tr key={i.id}>
                  <td className="px-4 py-3"><p className="font-mono font-bold text-gray-900">{i.invoice_number}</p><p className="text-xs text-gray-500">{i.order?.order_number} · {dateOnly(i.issue_date)}</p></td>
                  <td className="px-4 py-3 font-semibold text-gray-900">{i.company?.name}</td>
                  <td className={`px-4 py-3 ${i.overdue ? "text-red-600 font-bold" : "text-gray-700"}`}>{i.balance > 0 ? dateOnly(i.due_date) : "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{money(i.total_amount)}</td>
                  <td className="px-4 py-3 text-right font-black text-gray-900">{money(i.balance)}</td>
                  <td className="px-4 py-3"><span className={badgeCls(i.overdue ? "overdue" : i.status)}>{(i.overdue ? "overdue" : i.status).replace(/_/g, " ")}</span></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => pdf(() => documentsApi.invoicePdf(i.id, i.invoice_number))} className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline"><Download size={14} /> PDF</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.credit_notes?.length > 0 && (
        <div>
          <h3 className="font-black text-gray-900 mb-2">Credit notes</h3>
          <div className="border border-gray-200 rounded-2xl divide-y divide-gray-100">
            {data.credit_notes.map((c: any) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="font-mono font-bold text-gray-900">{c.credit_note_number}</span>
                <span className="text-gray-600">{c.company?.name}</span>
                <span className="text-gray-500">{c.reason}</span>
                <span className={badgeCls(c.status)}>{c.status}</span>
                <span className="ml-auto font-bold text-gray-900">{money(c.total_amount)}{c.remaining > 0 && <span className="text-xs text-green-700 ml-2">{money(c.remaining)} credit left</span>}</span>
                <button onClick={() => pdf(() => documentsApi.creditNotePdf(c.id, c.credit_note_number))} className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline"><Download size={14} /> PDF</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-gray-500">To pay an invoice, use the payment details printed on it, or contact the seller. Payments you make show up here once the seller records them.</p>
    </div>
  );
};
