// Platform admin: commission statements, review moderation, problem reports.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { apiClient } from "../../../api/apiClient";
import { errorMessage } from "../../business/api/business.api";
import { Card, Field, Modal, Spinner, StatusBadge, FilterTabs, Pagination, money, dateOnly, inputCls, inputBase, btnPrimary, btnSecondary, btnDanger } from "../../business/components/ui";
import { StatementModal } from "../../business/pages/FeedbackPages";
import type { Statement } from "../../business/api/insights.api";
import { Stars } from "../../insights/components";

const api = {
  commission: async (params = "") => (await apiClient.get(`/admin/commission${params}`)).data as { data: any[]; statements: Statement[] },
  createStatement: async (body: Record<string, unknown>) => (await apiClient.post("/admin/commission/statements", body)).data as { message: string },
  statement: async (id: number) => (await apiClient.get(`/admin/commission/statements/${id}`)).data.data as Statement,
  setStatement: async (id: number, body: Record<string, unknown>) => (await apiClient.patch(`/admin/commission/statements/${id}`, body)).data as { message: string },
  reviews: async (q: string) => (await apiClient.get(`/admin/reviews?${q}`)).data as { data: any[]; total: number; page: number; pages: number },
  moderate: async (id: number, body: Record<string, unknown>) => (await apiClient.patch(`/admin/reviews/${id}`, body)).data as { message: string },
  reports: async (q: string) => (await apiClient.get(`/admin/reports?${q}`)).data as { data: any[]; total: number; page: number; pages: number; counts: Record<string, number> },
  updateReport: async (id: number, body: Record<string, unknown>) => (await apiClient.patch(`/admin/reports/${id}`, body)).data as { message: string },
};

const lastMonth = () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

// ---- commission ---------------------------------------------------------------------------------

export const CommissionManagement: React.FC = () => {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.commission>> | null>(null);
  const [creating, setCreating] = useState<any>(null);
  const [period, setPeriod] = useState(lastMonth());
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState<Statement | null>(null);
  const [ref, setRef] = useState("");
  const load = () => api.commission().then(setData).catch((e) => toast.error(errorMessage(e)));
  useEffect(() => { load(); }, []);
  const create = async () => {
    try { toast.success((await api.createStatement({ company_id: creating.company.id, period_start: period.start, period_end: period.end, notes: notes || undefined })).message); setCreating(null); setNotes(""); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const act = async (s: Statement, status: string) => {
    if (status === "void" && !window.confirm(`Void ${s.statement_number}? Its orders can be billed again on a new statement.`)) return;
    try { toast.success((await api.setStatement(s.id, { status, payment_reference: status === "paid" ? ref || undefined : undefined })).message); setOpen(null); setRef(""); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  if (!data) return <Spinner />;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-gray-900">Commission</h2>
        <p className="text-sm text-gray-500">Each order keeps the company's rate from when it was placed (set the rate in Companies). Statements bill delivered orders: subtotal after discounts and credited returns, without shipping or tax. Buyers pay sellers directly, so statements are what each seller owes the platform.</p>
      </div>
      <Card>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Company</th><th className="px-2 py-3 text-right">Rate</th><th className="px-2 py-3 text-right">Unbilled orders</th><th className="px-2 py-3 text-right">Unbilled commission</th><th className="px-2 py-3 text-right">Unpaid statements</th><th className="px-2 py-3">Last billed to</th><th /></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {data.data.map((c) => (
              <tr key={c.company.id}>
                <td className="px-4 py-2 font-semibold">{c.company.name}</td>
                <td className="px-2 py-2 text-right">{c.rate}%</td>
                <td className="px-2 py-2 text-right">{c.order_count}{c.first_order ? <span className="block text-xs text-gray-400">{dateOnly(c.first_order)} – {dateOnly(c.last_order)}</span> : null}</td>
                <td className="px-2 py-2 text-right font-semibold">{money(c.commission_amount)}</td>
                <td className="px-2 py-2 text-right">{c.outstanding_count ? `${money(c.outstanding)} (${c.outstanding_count})` : "—"}</td>
                <td className="px-2 py-2">{c.last_period_end ? dateOnly(c.last_period_end) : "never"}</td>
                <td className="px-4 py-2 text-right">{c.order_count > 0 && <button onClick={() => { setCreating(c); setPeriod(lastMonth()); }} className={btnSecondary}>New statement</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <p className="font-bold text-gray-900 px-4 pt-4">Statements</p>
        {data.statements.length === 0 ? <p className="px-4 py-4 text-sm text-gray-500">None yet.</p> : (
          <table className="w-full text-sm mt-2">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-2">Statement</th><th className="px-2 py-2">Company</th><th className="px-2 py-2">Period</th><th className="px-2 py-2 text-right">Orders</th><th className="px-2 py-2 text-right">Commission</th><th className="px-4 py-2">Status</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {data.statements.map((s) => (
                <tr key={s.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={async () => { try { setOpen(await api.statement(s.id)); } catch (e) { toast.error(errorMessage(e)); } }}>
                  <td className="px-4 py-2 font-mono font-bold text-blue-600">{s.statement_number}</td>
                  <td className="px-2 py-2">{s.company?.name}</td>
                  <td className="px-2 py-2">{dateOnly(s.period_start)} – {dateOnly(s.period_end)}</td>
                  <td className="px-2 py-2 text-right">{s.order_count}</td>
                  <td className="px-2 py-2 text-right font-semibold">{money(s.commission_amount)}</td>
                  <td className="px-4 py-2"><StatusBadge status={s.status === "issued" ? "unpaid" : s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {creating && (
        <Modal title={`New statement: ${creating.company.name}`} onClose={() => setCreating(null)}>
          <div className="space-y-3 text-sm">
            <p className="text-gray-600">Bills the delivered orders placed in this period that aren't on a statement yet. The period has to end before today.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><input type="date" className={inputCls} value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} /></Field>
              <Field label="To"><input type="date" className={inputCls} value={period.end} max={new Date(Date.now() - 86400000).toISOString().slice(0, 10)} onChange={(e) => setPeriod({ ...period, end: e.target.value })} /></Field>
            </div>
            <Field label="Notes (shown to the company)"><textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><button onClick={() => setCreating(null)} className={btnSecondary}>Cancel</button><button onClick={create} className={btnPrimary}>Create statement</button></div>
          </div>
        </Modal>
      )}
      {open && (
        <StatementModal s={open} onClose={() => setOpen(null)} actions={
          <div className="flex flex-wrap items-end gap-2 pt-3 border-t border-gray-100">
            {open.status === "issued" && (
              <>
                <Field label="Payment reference"><input className={inputBase} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Bank transfer ref" /></Field>
                <button onClick={() => act(open, "paid")} className={btnPrimary}>Mark paid</button>
                <button onClick={() => act(open, "void")} className={btnDanger}>Void</button>
              </>
            )}
            {open.status === "paid" && <><p className="text-gray-600 flex-1">Paid {dateOnly(open.paid_at)}{open.payment_reference ? ` · ${open.payment_reference}` : ""}</p><button onClick={() => act(open, "issued")} className={btnSecondary}>Mark unpaid</button></>}
          </div>
        } />
      )}
    </div>
  );
};

// ---- reviews ------------------------------------------------------------------------------------

export const ReviewsModeration: React.FC = () => {
  const [status, setStatus] = useState("");
  const [rating, setRating] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.reviews>> | null>(null);
  const load = () => api.reviews(new URLSearchParams({ status, rating, q, page: String(page) }).toString()).then(setData).catch((e) => toast.error(errorMessage(e)));
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [status, rating, q, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const moderate = async (r: any, next: string) => {
    let reason: string | null = null;
    if (next === "hidden") { reason = window.prompt("Why is it hidden? (shown to the reviewer)", "Breaks the review rules"); if (reason === null) return; }
    try { toast.success((await api.moderate(r.id, { status: next, hidden_reason: reason || undefined })).message); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-black text-gray-900">Reviews</h2><p className="text-sm text-gray-500">Only buyers with a delivered order can review. Hide reviews that break the rules (fake, abusive, personal details, off-topic); hidden reviews don't count in ratings.</p></div>
      <div className="flex flex-wrap gap-3 items-center">
        <FilterTabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "", label: "All" }, { value: "published", label: "Published" }, { value: "hidden", label: "Hidden" }]} />
        <select className={`${inputBase} w-auto`} value={rating} onChange={(e) => { setRating(e.target.value); setPage(1); }} aria-label="Stars"><option value="">Any rating</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} stars</option>)}</select>
        <input className={`${inputBase} w-64`} placeholder="Search the text" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search reviews" />
      </div>
      {!data ? <Spinner /> : (
        <Card className="divide-y divide-gray-100">
          {data.data.length === 0 && <p className="p-5 text-sm text-gray-500">No reviews.</p>}
          {data.data.map((r) => (
            <div key={r.id} className="px-5 py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Stars value={r.rating} /> {r.title && <b>{r.title}</b>}
                <StatusBadge status={r.status} />
                {r.reports > 0 && <span className="text-[10px] font-bold uppercase bg-red-50 text-red-700 px-2 py-0.5 rounded">{r.reports} report(s)</span>}
                <span className="ml-auto">{r.status === "published" ? <button onClick={() => moderate(r, "hidden")} className={btnDanger}>Hide</button> : <button onClick={() => moderate(r, "published")} className={btnSecondary}>Publish again</button>}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">{r.author} ({r.author_email}){r.verified ? " · verified" : ""} · {dateOnly(r.created_at)} · {r.company?.name}{r.product ? <> · <Link to={`/product/${r.product.slug || r.product.id}`} className="text-blue-600 hover:underline">{r.product.title}</Link></> : " · supplier review"}</p>
              {r.body && <p className="text-gray-700 mt-1 whitespace-pre-line">{r.body}</p>}
              {r.hidden_reason && <p className="text-xs text-gray-500 mt-1">Hidden: {r.hidden_reason}</p>}
            </div>
          ))}
          {data.pages > 1 && <div className="p-3"><Pagination page={data.page} totalPages={data.pages} onChange={setPage} /></div>}
        </Card>
      )}
    </div>
  );
};

// ---- problem reports ----------------------------------------------------------------------------

const KIND: Record<string, string> = { listing: "Listing", order: "Order", seller: "Seller", review: "Review" };

export const ReportsQueue: React.FC = () => {
  const [status, setStatus] = useState("open");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.reports>> | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const load = () => api.reports(new URLSearchParams({ status, kind, page: String(page) }).toString()).then(setData).catch((e) => toast.error(errorMessage(e)));
  useEffect(() => { load(); }, [status, kind, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (action?: string) => {
    if (action === "suspend_company" && !window.confirm(`Suspend ${edit.company?.name}? Their products leave the marketplace and staff lose access.`)) return;
    try { toast.success((await api.updateReport(edit.id, { status: edit.status, admin_note: edit.admin_note, resolution: edit.resolution, action })).message); setEdit(null); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-black text-gray-900">Problem reports</h2><p className="text-sm text-gray-500">Reported listings, orders, sellers and reviews. Sellers see reports about them (without who reported, except for their own orders) and can answer.</p></div>
      <div className="flex flex-wrap gap-3 items-center">
        <FilterTabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "open", label: "Open", count: data?.counts.open }, { value: "in_review", label: "In review", count: data?.counts.in_review }, { value: "resolved", label: "Resolved" }, { value: "dismissed", label: "Dismissed" }, { value: "", label: "All" }]} />
        <select className={`${inputBase} w-auto`} value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} aria-label="Kind"><option value="">Everything</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      {!data ? <Spinner /> : (
        <Card className="divide-y divide-gray-100">
          {data.data.length === 0 && <p className="p-5 text-sm text-gray-500">Nothing here.</p>}
          {data.data.map((r) => (
            <button key={r.id} onClick={() => setEdit({ ...r })} className="w-full text-left px-5 py-3 text-sm hover:bg-gray-50">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-gray-500">{r.report_number}</span><StatusBadge status={r.status} />
                <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{KIND[r.kind]}</span><b>{r.reason_label}</b>
                <span className="ml-auto text-xs text-gray-400">{dateOnly(r.created_at)}</span>
              </div>
              <p className="text-gray-600 mt-0.5 truncate">{r.company?.name}{r.product ? ` · ${r.product.title}` : ""}{r.order ? ` · order ${r.order.order_number}` : ""}{r.details ? ` · “${r.details}”` : ""}</p>
            </button>
          ))}
          {data.pages > 1 && <div className="p-3"><Pagination page={data.page} totalPages={data.pages} onChange={setPage} /></div>}
        </Card>
      )}
      {edit && (
        <Modal title={`${edit.report_number}: ${edit.reason_label}`} onClose={() => setEdit(null)} wide>
          <div className="space-y-3 text-sm">
            <div className="grid md:grid-cols-2 gap-3 bg-gray-50 rounded-xl p-3">
              <p><span className="text-xs text-gray-500 block">Reported by</span>{edit.reporter ? `${[edit.reporter.first_name, edit.reporter.last_name].filter(Boolean).join(" ") || edit.reporter.business_name || ""} ${edit.reporter.email}` : "Deleted user"}</p>
              <p><span className="text-xs text-gray-500 block">Seller</span>{edit.company ? <Link to={`/companies/${edit.company.slug}`} className="text-blue-600 hover:underline">{edit.company.name}</Link> : "—"}{edit.company?.status !== "active" ? ` (${edit.company?.status})` : ""}</p>
              {edit.product && <p><span className="text-xs text-gray-500 block">Listing</span><Link to={`/product/${edit.product.slug || edit.product.id}`} className="text-blue-600 hover:underline">{edit.product.title}</Link> ({edit.product.status})</p>}
              {edit.order && <p><span className="text-xs text-gray-500 block">Order</span><span className="font-mono">{edit.order.order_number}</span> · {edit.order.status} · {money(edit.order.total_amount)}</p>}
              {edit.review && <p className="md:col-span-2"><span className="text-xs text-gray-500 block">Review ({edit.review.status})</span>{edit.review.rating}★ {edit.review.title} {edit.review.body}</p>}
            </div>
            {edit.details && <p className="text-gray-700">“{edit.details}”</p>}
            {edit.seller_response && <p className="pl-3 border-l-2 border-blue-200 text-gray-700"><span className="text-xs font-bold text-blue-700 block">Seller's answer</span>{edit.seller_response}</p>}
            <div className="grid md:grid-cols-3 gap-3">
              <Field label="Status"><select className={inputCls} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></Field>
              <div className="md:col-span-2"><Field label="Decision (shown to the reporter and the seller)"><textarea className={inputCls} rows={2} value={edit.resolution || ""} onChange={(e) => setEdit({ ...edit, resolution: e.target.value })} /></Field></div>
            </div>
            <Field label="Internal note (admins only)"><textarea className={inputCls} rows={3} value={edit.admin_note || ""} onChange={(e) => setEdit({ ...edit, admin_note: e.target.value })} /></Field>
            <div className="flex flex-wrap gap-2 justify-between pt-2 border-t border-gray-100">
              <div className="flex flex-wrap gap-2">
                {edit.product && edit.product.status === "published" && <button onClick={() => save("hide_product")} className={btnDanger}>Save & hide listing</button>}
                {edit.review && edit.review.status === "published" && <button onClick={() => save("hide_review")} className={btnDanger}>Save & hide review</button>}
                {edit.company && edit.company.status === "active" && edit.kind !== "review" && <button onClick={() => save("suspend_company")} className={btnDanger}>Save & suspend seller</button>}
              </div>
              <div className="flex gap-2"><button onClick={() => setEdit(null)} className={btnSecondary}>Cancel</button><button onClick={() => save()} className={btnPrimary}>Save</button></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
