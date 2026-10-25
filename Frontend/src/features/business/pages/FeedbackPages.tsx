// Business → Reviews, Problems reported, Platform commission.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, Flag, Star, Percent, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { sellerInsightsApi, Statement } from "../api/insights.api";
import { Card, PageHeader, Spinner, EmptyState, FilterTabs, StatusBadge, Modal, Pagination, money, dateOnly, inputCls, btnPrimary, btnSecondary } from "../components/ui";
import { Stars } from "../../insights/components";

// ---- reviews ------------------------------------------------------------------------------------

const REVIEW_REPORT_REASONS: Record<string, string> = { fake: "Fake or paid review", offensive: "Offensive or personal information", not_relevant: "Not about this product or us", other: "Something else" };

const ReviewCard: React.FC<{ r: any; canReply: boolean; onChanged: () => void }> = ({ r, canReply, onChanged }) => {
  const { companyId } = useBusiness();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState(r.seller_reply || "");
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("fake");
  const [details, setDetails] = useState("");
  const save = async () => {
    try { toast.success((await sellerInsightsApi.reply(companyId!, r.id, text)).message); setReplying(false); onChanged(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const report = async () => {
    try { toast.success((await sellerInsightsApi.reportReview(companyId!, r.id, reason, details || undefined)).message); setReporting(false); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Stars value={r.rating} />
        {r.title && <b className="text-gray-900">{r.title}</b>}
        {r.status === "hidden" && <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Hidden by the marketplace</span>}
      </div>
      <p className="text-xs text-gray-500 mt-0.5">
        {r.author}{r.verified ? " · verified buyer" : ""} · {dateOnly(r.created_at)} · {r.product ? <Link to={`/product/${r.product.slug || r.product.id}`} className="text-blue-600 hover:underline">{r.product.title}</Link> : "Review of your company"}
      </p>
      {r.body && <p className="text-sm text-gray-700 mt-1 whitespace-pre-line">{r.body}</p>}
      {r.seller_reply && !replying && <div className="mt-2 ml-3 pl-3 border-l-2 border-blue-200 text-sm"><p className="text-xs font-bold text-blue-700">Your reply</p><p className="text-gray-700 whitespace-pre-line">{r.seller_reply}</p></div>}
      {replying && (
        <div className="mt-2 space-y-2">
          <textarea className={inputCls} rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Thank them, or explain what you're doing about it. Your reply is public." aria-label="Your reply" />
          <div className="flex gap-2">
            <button onClick={save} className={btnPrimary}>{text.trim() ? "Publish reply" : "Remove reply"}</button>
            <button onClick={() => { setReplying(false); setText(r.seller_reply || ""); }} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}
      {canReply && !replying && (
        <div className="flex gap-4 mt-2 text-xs font-semibold">
          <button onClick={() => setReplying(true)} className="text-blue-600 hover:underline inline-flex items-center gap-1"><MessageSquare size={12} /> {r.seller_reply ? "Edit reply" : "Reply"}</button>
          <button onClick={() => setReporting(true)} className="text-gray-500 hover:text-red-600 inline-flex items-center gap-1"><Flag size={12} /> Report to the marketplace</button>
        </div>
      )}
      {reporting && (
        <Modal title="Report this review" onClose={() => setReporting(false)}>
          <div className="space-y-3 text-sm">
            <p className="text-gray-600">The marketplace team checks the review against the rules. You can't remove reviews yourself.</p>
            {Object.entries(REVIEW_REPORT_REASONS).map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="radio" checked={reason === k} onChange={() => setReason(k)} /> {l}</label>)}
            <textarea className={inputCls} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={reason === "other" ? "Tell us what's wrong (required)" : "Details (optional)"} aria-label="Details" />
            <div className="flex justify-end gap-2"><button onClick={() => setReporting(false)} className={btnSecondary}>Cancel</button><button onClick={report} disabled={reason === "other" && !details.trim()} className={btnPrimary}>Send report</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export const SellerReviewsPage: React.FC = () => {
  const { companyId, company, can } = useBusiness();
  const [filter, setFilter] = useState("");
  const [rating, setRating] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof sellerInsightsApi.reviews>> | null>(null);
  const load = () => sellerInsightsApi.reviews(companyId!, { replied: filter === "unanswered" ? "no" : "", status: filter === "hidden" ? "hidden" : "", rating, page }).then(setData).catch((e) => toast.error(errorMessage(e)));
  useEffect(() => { load(); }, [companyId, filter, rating, page]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <PageHeader title="Reviews" subtitle="What buyers say about your products and your company. Replies are public."
        actions={company?.slug && <Link to={`/companies/${company.slug}?tab=reviews`} className={btnSecondary}>Public page <ExternalLink size={14} /></Link>} />
      {data && (
        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          <Card className="p-4"><p className="text-xs font-bold uppercase text-gray-500">All reviews</p><p className="text-2xl font-black text-gray-900 flex items-center gap-2">{data.summary.average?.toFixed(1) ?? "—"} <Star size={18} className="text-amber-400 fill-amber-400" /></p><p className="text-xs text-gray-500">{data.summary.count} published</p></Card>
          <Card className="p-4"><p className="text-xs font-bold uppercase text-gray-500">Your company</p><p className="text-2xl font-black text-gray-900">{data.supplier.average?.toFixed(1) ?? "—"}</p><p className="text-xs text-gray-500">{data.supplier.count} supplier reviews</p></Card>
          <Card className="p-4"><p className="text-xs font-bold uppercase text-gray-500">By stars</p>
            <div className="flex gap-2 mt-1 text-xs text-gray-600">{[5, 4, 3, 2, 1].map((n) => <span key={n}>{n}★ <b>{data.summary.distribution?.[n] || 0}</b></span>)}</div></Card>
        </div>
      )}
      <div className="flex flex-wrap gap-3 mb-3 items-center">
        <FilterTabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} options={[{ value: "", label: "All" }, { value: "unanswered", label: "Not replied" }, { value: "hidden", label: "Hidden" }]} />
        <select className={`${inputCls} w-auto`} value={rating} onChange={(e) => { setRating(e.target.value); setPage(1); }} aria-label="Stars">
          <option value="">Any rating</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} stars</option>)}
        </select>
      </div>
      {!data ? <Spinner /> : data.data.length === 0 ? (
        <Card><EmptyState icon={<Star size={36} />} title="No reviews here" text="Buyers can review a product once their order is delivered." /></Card>
      ) : (
        <Card className="divide-y divide-gray-100">
          {data.data.map((r) => <ReviewCard key={r.id} r={r} canReply={can("products.manage") || can("customers.manage")} onChanged={load} />)}
          {data.pages > 1 && <div className="p-3"><Pagination page={data.page} totalPages={data.pages} onChange={setPage} /></div>}
        </Card>
      )}
    </div>
  );
};

// ---- problem reports ----------------------------------------------------------------------------

const KIND: Record<string, string> = { listing: "Listing", order: "Order", seller: "Your company", review: "Review" };

export const SellerReportsPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  const [answer, setAnswer] = useState<{ id: number; text: string } | null>(null);
  const load = () => sellerInsightsApi.reports(companyId!, status).then(setRows).catch((e) => toast.error(errorMessage(e)));
  useEffect(() => { load(); }, [companyId, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!answer) return;
    try { toast.success((await sellerInsightsApi.respond(companyId!, answer.id, answer.text)).message); setAnswer(null); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const canRespond = can("orders.manage") || can("products.manage");
  return (
    <div>
      <PageHeader title="Problems reported" subtitle="Reports from buyers about your listings, orders or company. The marketplace team reviews each one; answer with what you've done." />
      <div className="mb-3"><FilterTabs value={status} onChange={setStatus} options={[{ value: "", label: "All" }, { value: "open", label: "Open" }, { value: "in_review", label: "In review" }, { value: "resolved", label: "Resolved" }, { value: "dismissed", label: "Dismissed" }]} /></div>
      {!rows ? <Spinner /> : rows.length === 0 ? <Card><EmptyState icon={<Flag size={36} />} title="No reports" text="Nothing has been reported. Keep it that way!" /></Card> : (
        <Card className="divide-y divide-gray-100">
          {rows.map((r) => (
            <div key={r.id} className="px-5 py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-gray-500">{r.report_number}</span>
                <StatusBadge status={r.status} />
                <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{KIND[r.kind]}</span>
                <b className="text-gray-900">{r.reason_label}</b>
                <span className="text-xs text-gray-400 ml-auto">{dateOnly(r.created_at)}</span>
              </div>
              <p className="text-gray-600 mt-1">
                {r.product && <>Product: <Link to={`/business/products/${r.product.id}`} className="text-blue-600 hover:underline">{r.product.title}</Link>{r.product.status !== "published" ? ` (${r.product.status})` : ""}. </>}
                {r.order && <>Order <Link to={`/business/orders?open=${r.order.id}`} className="font-mono text-blue-600 hover:underline">{r.order.order_number}</Link>. </>}
                {r.review && <>Review: “{r.review.title || (r.review.body || "").slice(0, 80)}” ({r.review.rating}★). </>}
                {r.reporter && <>From {r.reporter.name} ({r.reporter.email}).</>}
              </p>
              {r.details && <p className="text-gray-700 mt-1 whitespace-pre-line">“{r.details}”</p>}
              {r.seller_response && <p className="mt-2 ml-3 pl-3 border-l-2 border-blue-200 text-gray-700"><span className="text-xs font-bold text-blue-700 block">Your answer · {dateOnly(r.seller_responded_at)}</span>{r.seller_response}</p>}
              {r.resolution && <p className="mt-2 ml-3 pl-3 border-l-2 border-green-200 text-gray-700"><span className="text-xs font-bold text-green-700 block">Marketplace decision</span>{r.resolution}</p>}
              {canRespond && !["resolved", "dismissed"].includes(r.status) && (
                answer && answer.id === r.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea className={inputCls} rows={3} maxLength={4000} value={answer.text} onChange={(e) => setAnswer({ id: r.id, text: e.target.value })} placeholder="What happened, and what you've done (e.g. replacement shipped, listing corrected)" aria-label="Your answer" />
                    <div className="flex gap-2"><button onClick={send} disabled={!answer.text.trim()} className={btnPrimary}>Send answer</button><button onClick={() => setAnswer(null)} className={btnSecondary}>Cancel</button></div>
                  </div>
                ) : <button onClick={() => setAnswer({ id: r.id, text: r.seller_response || "" })} className="mt-2 text-xs font-bold text-blue-600 hover:underline">{r.seller_response ? "Update your answer" : "Answer"}</button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
};

// ---- platform commission ------------------------------------------------------------------------

export const CommissionPage: React.FC = () => {
  const { companyId } = useBusiness();
  const [data, setData] = useState<Awaited<ReturnType<typeof sellerInsightsApi.commission>> | null>(null);
  const [open, setOpen] = useState<Statement | null>(null);
  useEffect(() => { sellerInsightsApi.commission(companyId!).then(setData).catch((e) => toast.error(errorMessage(e))); }, [companyId]);
  const show = async (s: Statement) => { try { setOpen(await sellerInsightsApi.statement(companyId!, s.id)); } catch (e) { toast.error(errorMessage(e)); } };
  if (!data) return <Spinner />;
  return (
    <div>
      <PageHeader title="Platform commission" subtitle="The marketplace's commission on your delivered orders: subtotal after discounts and returns credited, excluding shipping and tax. Each order keeps the rate from when it was placed." />
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <Card className="p-4"><p className="text-xs font-bold uppercase text-gray-500 flex items-center gap-1"><Percent size={12} /> Current rate</p><p className="text-2xl font-black text-gray-900">{data.rate}%</p><p className="text-xs text-gray-500">Set by the marketplace</p></Card>
        <Card className="p-4"><p className="text-xs font-bold uppercase text-gray-500">Not billed yet</p><p className="text-2xl font-black text-gray-900">{money(data.unbilled.commission_amount)}</p><p className="text-xs text-gray-500">{data.unbilled.order_count} delivered orders · {money(data.unbilled.sales_amount)} sales</p></Card>
        <Card className="p-4"><p className="text-xs font-bold uppercase text-gray-500">Unpaid statements</p><p className="text-2xl font-black text-gray-900">{money(data.data.filter((s) => s.status === "issued").reduce((t, s) => t + s.commission_amount, 0))}</p><p className="text-xs text-gray-500">{data.data.filter((s) => s.status === "issued").length} statement(s)</p></Card>
      </div>
      <Card>
        <p className="font-bold text-gray-900 px-5 pt-4">Statements</p>
        {data.data.length === 0 ? <p className="text-sm text-gray-500 px-5 py-4">No statements yet. The marketplace sends one per period.</p> : (
          <table className="w-full text-sm mt-2">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-5 py-2">Statement</th><th className="px-2 py-2">Period</th><th className="px-2 py-2 text-right">Orders</th><th className="px-2 py-2 text-right">Sales</th><th className="px-2 py-2 text-right">Commission</th><th className="px-5 py-2">Status</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {data.data.map((s) => (
                <tr key={s.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => show(s)}>
                  <td className="px-5 py-2 font-mono font-bold text-blue-600">{s.statement_number}</td>
                  <td className="px-2 py-2">{dateOnly(s.period_start)} – {dateOnly(s.period_end)}</td>
                  <td className="px-2 py-2 text-right">{s.order_count}</td>
                  <td className="px-2 py-2 text-right">{money(s.sales_amount)}</td>
                  <td className="px-2 py-2 text-right font-bold">{money(s.commission_amount)}</td>
                  <td className="px-5 py-2"><StatusBadge status={s.status === "issued" ? "unpaid" : s.status} />{s.paid_at && <span className="block text-xs text-gray-500">{dateOnly(s.paid_at)}{s.payment_reference ? ` · ${s.payment_reference}` : ""}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {open && <StatementModal s={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

export const StatementModal: React.FC<{ s: Statement; onClose: () => void; actions?: React.ReactNode }> = ({ s, onClose, actions }) => (
  <Modal title={`Statement ${s.statement_number}`} onClose={onClose} wide>
    <div className="space-y-3 text-sm">
      <p className="text-gray-600">{s.company?.name ? `${s.company.name} · ` : ""}{dateOnly(s.period_start)} – {dateOnly(s.period_end)} · <StatusBadge status={s.status === "issued" ? "unpaid" : s.status} /></p>
      <table className="w-full">
        <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Order</th><th>Date</th><th className="text-right">Subtotal</th><th className="text-right">Discount</th><th className="text-right">Rate</th><th className="text-right">Commission</th></tr></thead>
        <tbody className="divide-y divide-gray-50">
          {(s.orders || []).map((o: any) => (
            <tr key={o.id}><td className="py-1 font-mono">{o.order_number}</td><td>{dateOnly(o.created_at)}</td><td className="text-right">{money(o.subtotal_amount)}</td><td className="text-right">{Number(o.discount_amount) ? `-${money(o.discount_amount)}` : "—"}</td><td className="text-right">{Number(o.commission_rate)}%</td><td className="text-right font-semibold">{money(o.commission_amount)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-col items-end"><p>Commissionable sales <b className="ml-2">{money(s.sales_amount)}</b></p><p className="text-base">Commission <b className="ml-2">{money(s.commission_amount)}</b></p></div>
      {s.notes && <p className="text-gray-600">Notes: {s.notes}</p>}
      {actions}
    </div>
  </Modal>
);
