// Shared UI: star ratings, the reviews section, "Report a problem", sale badges.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Star, Flag, BadgeCheck, MessageSquareReply, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../auth/context/AuthContext";
import { insightsApi, errText, Rating, Review, ReviewPage, Reasons } from "./api";

export const Stars: React.FC<{ value: number; size?: number; className?: string }> = ({ value, size = 14, className = "" }) => (
  <span className={`inline-flex items-center ${className}`} role="img" aria-label={`${value} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((i) => {
      const fill = Math.max(0, Math.min(1, value - (i - 1)));
      return (
        <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
          <Star size={size} className="absolute inset-0 text-gray-300" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
            <Star size={size} className="text-amber-400 fill-amber-400" />
          </span>
        </span>
      );
    })}
  </span>
);

/** "★ 4.3 (12)" — compact rating for cards. */
export const RatingBadge: React.FC<{ rating?: { average: number | null; count: number } | null; className?: string }> = ({ rating, className = "" }) =>
  rating && rating.count > 0 && rating.average !== null ? (
    <span className={`inline-flex items-center gap-1 text-xs text-gray-600 ${className}`}>
      <Star size={12} className="text-amber-400 fill-amber-400" /> <b className="text-gray-800">{rating.average.toFixed(1)}</b> ({rating.count})
    </span>
  ) : null;

export const StarInput: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => {
  const [hover, setHover] = useState(0);
  const labels = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
  return (
    <div className="flex items-center gap-2">
      <div className="flex" onMouseLeave={() => setHover(0)} role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i > 1 ? "s" : ""}`}
            onMouseEnter={() => setHover(i)} onClick={() => onChange(i)} className="p-0.5">
            <Star size={26} className={(hover || value) >= i ? "text-amber-400 fill-amber-400" : "text-gray-300"} />
          </button>
        ))}
      </div>
      <span className="text-sm text-gray-600">{labels[hover || value]}</span>
    </div>
  );
};

const Distribution: React.FC<{ s: Rating }> = ({ s }) => (
  <div className="space-y-1 w-full max-w-xs">
    {[5, 4, 3, 2, 1].map((n) => {
      const c = s.distribution?.[n] || 0;
      return (
        <div key={n} className="flex items-center gap-2 text-xs text-gray-600">
          <span className="w-8">{n} ★</span>
          <span className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><span className="block h-full bg-amber-400" style={{ width: `${s.count ? (c / s.count) * 100 : 0}%` }} /></span>
          <span className="w-6 text-right">{c}</span>
        </div>
      );
    })}
  </div>
);

export const ReviewItem: React.FC<{ r: Review; companyName?: string; onReport?: (r: Review) => void; showProduct?: boolean }> = ({ r, companyName, onReport, showProduct }) => (
  <article className="py-4">
    <div className="flex flex-wrap items-center gap-2">
      <Stars value={r.rating} />
      {r.title && <h4 className="font-bold text-gray-900">{r.title}</h4>}
    </div>
    <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-2">
      <span>{r.author}</span>
      {r.verified && <span className="inline-flex items-center gap-0.5 text-green-700"><BadgeCheck size={12} /> Verified buyer</span>}
      <span>{new Date(r.created_at).toLocaleDateString()}</span>
      {showProduct && r.product && <Link to={`/product/${r.product.slug || r.product.id}`} className="text-blue-600 hover:underline">{r.product.title}</Link>}
    </p>
    {r.body && <p className="text-sm text-gray-700 mt-2 whitespace-pre-line">{r.body}</p>}
    {r.seller_reply && (
      <div className="mt-3 ml-4 pl-3 border-l-2 border-gray-200 text-sm">
        <p className="text-xs font-bold text-gray-600 flex items-center gap-1"><MessageSquareReply size={12} /> Reply from {companyName || "the seller"}</p>
        <p className="text-gray-700 whitespace-pre-line">{r.seller_reply}</p>
      </div>
    )}
    {onReport && <button onClick={() => onReport(r)} className="mt-2 text-xs text-gray-400 hover:text-red-600 inline-flex items-center gap-1"><Flag size={11} /> Report</button>}
  </article>
);

/** Write (or explain why you can't yet) a review of a product or supplier. */
const WriteReview: React.FC<{ productId?: number | string; companyId?: number | string; onDone: () => void }> = ({ productId, companyId, onDone }) => {
  const { user } = useAuth();
  const [state, setState] = useState<"loading" | "can" | "done" | "no" | "anon">(user ? "loading" : "anon");
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user) return setState("anon");
    insightsApi.myReviews().then((r) => {
      const already = r.data.some((x) => (productId ? String(x.product_id) === String(productId) : !x.product_id && String(x.company_id ?? x.company?.id) === String(companyId)));
      const can = productId ? r.eligible.products.some((p) => String(p.id) === String(productId)) : r.eligible.companies.some((c) => String(c.id) === String(companyId));
      setState(already ? "done" : can ? "can" : "no");
    }).catch(() => setState("no"));
  }, [user, productId, companyId]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) return toast.error("Choose a star rating");
    setBusy(true);
    try {
      toast.success((await insightsApi.createReview({ product_id: productId, company_id: productId ? undefined : companyId, rating, title, body })).message);
      setOpen(false); setState("done"); onDone();
    } catch (err) { toast.error(errText(err)); } finally { setBusy(false); }
  };
  if (state === "anon") return <p className="text-sm text-gray-500"><Link to="/login" className="text-blue-600 font-semibold">Sign in</Link> to review after your order is delivered.</p>;
  if (state === "loading") return null;
  if (state === "done") return <p className="text-sm text-gray-500">You've reviewed this. Edit it under <Link to="/account?tab=reviews" className="text-blue-600 font-semibold">My account → Reviews</Link>.</p>;
  if (state === "no") return <p className="text-sm text-gray-500">Only buyers with a delivered order can review{productId ? " this product" : " this supplier"}.</p>;
  if (!open) return <button onClick={() => setOpen(true)} className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-bold">Write a review</button>;
  return (
    <form onSubmit={submit} className="space-y-3 bg-gray-50 border border-gray-200 rounded-xl p-4 max-w-xl">
      <StarInput value={rating} onChange={setRating} />
      <input className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm" maxLength={120} placeholder="Headline (optional)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Headline" />
      <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm" rows={4} maxLength={4000} placeholder="What did you like or not like? Quality, packaging, delivery…" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Your review" />
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700">Cancel</button>
        <button disabled={busy} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-50">{busy ? "Publishing…" : "Publish review"}</button>
      </div>
    </form>
  );
};

/** Reviews of a product (productId) or of a supplier (companySlug + companyId). */
export const ReviewsSection: React.FC<{ productId?: number | string; companySlug?: string; companyId?: number | string; companyName?: string; title?: string }> = ({ productId, companySlug, companyId, companyName, title = "Reviews" }) => {
  const [data, setData] = useState<ReviewPage | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("newest");
  const [reporting, setReporting] = useState<Review | null>(null);
  const { user } = useAuth();
  const load = () => (productId ? insightsApi.productReviews(productId, page, sort) : insightsApi.companyReviews(companySlug!, page, sort)).then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, [productId, companySlug, page, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;
  const s = data.summary;
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6" aria-labelledby="reviews-title">
      <div className="flex flex-wrap items-start gap-6 justify-between">
        <div>
          <h2 id="reviews-title" className="text-xl font-black text-gray-900">{title}</h2>
          {s.count > 0 && s.average !== null ? (
            <div className="flex items-center gap-2 mt-1"><Stars value={s.average} size={18} /><span className="font-bold text-gray-900">{s.average.toFixed(1)}</span><span className="text-sm text-gray-500">from {s.count} review{s.count === 1 ? "" : "s"}</span></div>
          ) : <p className="text-sm text-gray-500 mt-1">No reviews yet.</p>}
        </div>
        {s.count > 0 && <Distribution s={s} />}
      </div>
      <div className="mt-4"><WriteReview productId={productId} companyId={companyId} onDone={load} /></div>
      {data.data.length > 0 && (
        <>
          <div className="flex justify-end mt-4">
            <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} aria-label="Sort reviews" className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700">
              <option value="newest">Newest</option><option value="highest">Highest rated</option><option value="lowest">Lowest rated</option>
            </select>
          </div>
          <div className="divide-y divide-gray-100">
            {data.data.map((r) => <ReviewItem key={r.id} r={r} companyName={companyName} onReport={user ? setReporting : undefined} />)}
          </div>
          {data.pages > 1 && (
            <div className="flex justify-center gap-2 mt-3 text-sm">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40">Previous</button>
              <span className="px-2 py-1 text-gray-500">{page} / {data.pages}</span>
              <button disabled={page >= data.pages} onClick={() => setPage(page + 1)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40">Next</button>
            </div>
          )}
        </>
      )}
      {reporting && <ReportModal target={{ kind: "review", review_id: reporting.id }} title="Report this review" onClose={() => setReporting(null)} />}
    </section>
  );
};

// ---- problem reports ------------------------------------------------------------------------------

export type ReportTarget = { kind: "listing"; product_id: number | string } | { kind: "order"; order_id: number | string } | { kind: "seller"; company_id: number | string } | { kind: "review"; review_id: number | string };

let reasonsCache: Reasons | null = null;

export const ReportModal: React.FC<{ target: ReportTarget; title: string; onClose: () => void }> = ({ target, title, onClose }) => {
  const [reasons, setReasons] = useState<Reasons | null>(reasonsCache);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!reasonsCache) insightsApi.reasons().then((r) => { reasonsCache = r; setReasons(r); }).catch(() => {}); }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      toast.success((await insightsApi.report({ ...target, reason, details: details.trim() || undefined })).message);
      onClose();
    } catch (err) { toast.error(errText(err)); } finally { setBusy(false); }
  };
  const options = reasons?.[target.kind] || {};
  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <form onSubmit={submit} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title} className="bg-white text-gray-900 rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-lg">{title}</h2>
            <p className="text-sm text-gray-500">The marketplace team reviews every report.{target.kind === "order" ? " The seller sees order problems so they can fix them." : " The seller isn't told who reported it."}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-bold text-gray-600 uppercase mb-1">What's wrong?</legend>
          {Object.entries(options).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} required /> {label}</label>
          ))}
          {!reasons && <p className="text-sm text-gray-500">Loading…</p>}
        </fieldset>
        <label className="block">
          <span className="text-xs font-bold text-gray-600 uppercase">Details {reason === "other" ? "" : "(optional)"}</span>
          <textarea rows={3} maxLength={4000} required={reason === "other"} value={details} onChange={(e) => setDetails(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold">Cancel</button>
          <button disabled={busy || !reason} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold disabled:opacity-50">{busy ? "Sending…" : "Send report"}</button>
        </div>
      </form>
    </div>
  );
};

/** Small "Report" link that opens the form (asks visitors to sign in first). */
export const ReportButton: React.FC<{ target: ReportTarget; label?: string; title?: string; className?: string }> = ({ target, label = "Report a problem", title, className = "" }) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return <Link to="/login" className={`inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 ${className}`}><Flag size={12} /> {label}</Link>;
  return (
    <>
      <button onClick={() => setOpen(true)} className={`inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 ${className}`}><Flag size={12} /> {label}</button>
      {open && <ReportModal target={target} title={title || label} onClose={() => setOpen(false)} />}
    </>
  );
};

// ---- sales ----------------------------------------------------------------------------------------

export type Sale = { percent: number; label?: string | null; ends_at?: string | null; price?: number };
export const SaleBadge: React.FC<{ sale?: Sale | null; className?: string }> = ({ sale, className = "" }) =>
  sale ? <span className={`bg-red-600 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded ${className}`} title={sale.ends_at ? `Ends ${new Date(sale.ends_at).toLocaleDateString()}` : undefined}>−{sale.percent}%{sale.label ? ` · ${sale.label}` : ""}</span> : null;
