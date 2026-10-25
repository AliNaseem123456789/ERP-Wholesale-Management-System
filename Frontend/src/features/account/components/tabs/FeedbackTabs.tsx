// Account → Reviews (what to review, my reviews) and Account → Reports (problems I reported).
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Star, Flag, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { insightsApi, errText } from "../../../insights/api";
import { Stars, StarInput } from "../../../insights/components";
import { badgeCls } from "../../api/documents.api";

const ReviewForm: React.FC<{ title: string; initial?: { rating: number; title?: string | null; body?: string | null }; onSubmit: (v: { rating: number; title: string; body: string }) => Promise<void>; onCancel: () => void }> = ({ title, initial, onSubmit, onCancel }) => {
  const [rating, setRating] = useState(initial?.rating || 0);
  const [t, setT] = useState(initial?.title || "");
  const [b, setB] = useState(initial?.body || "");
  const [busy, setBusy] = useState(false);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (!rating) return toast.error("Choose a star rating"); setBusy(true); try { await onSubmit({ rating, title: t, body: b }); } finally { setBusy(false); } }} className="space-y-2 bg-gray-50 border border-gray-200 rounded-xl p-4 mt-2">
      <p className="font-semibold text-gray-900 text-sm">{title}</p>
      <StarInput value={rating} onChange={setRating} />
      <input className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm" maxLength={120} placeholder="Headline (optional)" value={t} onChange={(e) => setT(e.target.value)} aria-label="Headline" />
      <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm" rows={3} maxLength={4000} placeholder="Your experience" value={b} onChange={(e) => setB(e.target.value)} aria-label="Review" />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm font-semibold">Cancel</button>
        <button disabled={busy} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
};

export const ReviewsTab: React.FC = () => {
  const [data, setData] = useState<Awaited<ReturnType<typeof insightsApi.myReviews>> | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const load = () => insightsApi.myReviews().then(setData).catch((e) => { toast.error(errText(e)); });
  useEffect(() => { load(); }, []);
  if (!data) return <div className="p-10 text-center text-gray-500">Loading…</div>;
  const todo = [...data.eligible.products.map((p) => ({ key: `p${p.id}`, label: p.title, sub: `${p.company?.name || ""}${p.order_number ? ` · order ${p.order_number}` : ""}`, body: { product_id: p.id } })),
    ...data.eligible.companies.map((c) => ({ key: `c${c.id}`, label: c.name, sub: "The supplier: delivery, service, communication", body: { company_id: c.id } }))];
  return (
    <div className="space-y-6">
      <section>
        <h3 className="font-bold text-gray-900 mb-2">Waiting for your review</h3>
        {todo.length === 0 ? <p className="text-sm text-gray-500">Nothing to review. You can review products and suppliers after an order is delivered.</p> : (
          <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100">
            {todo.slice(0, 30).map((t) => (
              <div key={t.key} className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0"><p className="font-semibold text-gray-900 truncate">{t.label}</p><p className="text-xs text-gray-500">{t.sub}</p></div>
                  {writing !== t.key && <button onClick={() => setWriting(t.key)} className="inline-flex items-center gap-1 text-sm font-bold text-blue-600"><Star size={14} /> Review</button>}
                </div>
                {writing === t.key && (
                  <ReviewForm title={`Review ${t.label}`} onCancel={() => setWriting(null)} onSubmit={async (v) => {
                    try { toast.success((await insightsApi.createReview({ ...t.body, ...v })).message); setWriting(null); load(); } catch (e) { toast.error(errText(e)); }
                  }} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <h3 className="font-bold text-gray-900 mb-2">Your reviews</h3>
        {data.data.length === 0 ? <p className="text-sm text-gray-500">You haven't written any reviews yet.</p> : (
          <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100">
            {data.data.map((r) => (
              <div key={r.id} className="px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars value={r.rating} />
                  <span className="font-semibold text-gray-900">{r.product ? <Link to={`/product/${r.product.slug || r.product.id}`} className="hover:text-blue-600">{r.product.title}</Link> : <Link to={`/companies/${r.company?.slug}?tab=reviews`} className="hover:text-blue-600">{r.company?.name}</Link>}</span>
                  {r.status === "hidden" && <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-600 px-2 py-0.5 rounded" title={r.hidden_reason || undefined}>Hidden by the marketplace</span>}
                  <span className="ml-auto flex gap-1">
                    <button onClick={() => setEditing(editing === r.id ? null : r.id)} className="p-1.5 text-gray-400 hover:text-gray-800" aria-label="Edit review"><Pencil size={14} /></button>
                    <button onClick={async () => { if (!window.confirm("Delete this review?")) return; try { toast.success((await insightsApi.deleteReview(r.id)).message); load(); } catch (e) { toast.error(errText(e)); } }} className="p-1.5 text-gray-400 hover:text-red-600" aria-label="Delete review"><Trash2 size={14} /></button>
                  </span>
                </div>
                {r.title && <p className="font-bold text-gray-900 mt-1">{r.title}</p>}
                {r.body && <p className="text-gray-700 whitespace-pre-line">{r.body}</p>}
                {r.seller_reply && <p className="mt-2 ml-3 pl-3 border-l-2 border-gray-200 text-gray-700"><span className="text-xs font-bold text-gray-500 block">Reply from {r.company?.name}</span>{r.seller_reply}</p>}
                {editing === r.id && (
                  <ReviewForm title="Edit your review" initial={r} onCancel={() => setEditing(null)} onSubmit={async (v) => {
                    try { toast.success((await insightsApi.updateReview(r.id, v)).message); setEditing(null); load(); } catch (e) { toast.error(errText(e)); }
                  }} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

const STATUS_TEXT: Record<string, string> = { open: "Received", in_review: "Being looked at", resolved: "Resolved", dismissed: "Closed without action" };

export const ReportsTab: React.FC = () => {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { insightsApi.myReports().then((r) => setRows(r.data)).catch((e) => { toast.error(errText(e)); setRows([]); }); }, []);
  if (!rows) return <div className="p-10 text-center text-gray-500">Loading…</div>;
  if (!rows.length)
    return (
      <div className="p-16 text-center bg-gray-50 rounded-3xl border-2 border-dashed">
        <Flag className="mx-auto text-gray-400 mb-3" size={40} />
        <p className="text-gray-600 font-medium">You haven't reported anything.</p>
        <p className="text-sm text-gray-500">Use “Report a problem” on a product, a seller's page or an order.</p>
      </div>
    );
  return (
    <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100">
      {rows.map((r) => (
        <div key={r.id} className="px-5 py-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-gray-500">{r.report_number}</span>
            <span className={badgeCls(r.status === "in_review" ? "sent" : r.status === "resolved" ? "accepted" : r.status === "dismissed" ? "cancelled" : "requested")}>{STATUS_TEXT[r.status] || r.status}</span>
            <b className="text-gray-900">{r.reason_label}</b>
            <span className="text-xs text-gray-400 ml-auto">{new Date(r.created_at).toLocaleDateString()}</span>
          </div>
          <p className="text-gray-600 mt-1">
            {r.product && <>About <Link to={`/product/${r.product.slug || r.product.id}`} className="text-blue-600 hover:underline">{r.product.title}</Link>. </>}
            {r.order && <>Order <span className="font-mono">{r.order.order_number}</span>. </>}
            {r.company && !r.product && !r.order && <>About {r.company.name}. </>}
          </p>
          {r.details && <p className="text-gray-700 mt-1">“{r.details}”</p>}
          {r.seller_response && <p className="mt-2 ml-3 pl-3 border-l-2 border-blue-200 text-gray-700"><span className="text-xs font-bold text-blue-700 block">{r.company?.name || "The seller"} answered</span>{r.seller_response}</p>}
          {r.resolution && <p className="mt-2 ml-3 pl-3 border-l-2 border-green-200 text-gray-700"><span className="text-xs font-bold text-green-700 block">Marketplace team</span>{r.resolution}</p>}
        </div>
      ))}
    </div>
  );
};
