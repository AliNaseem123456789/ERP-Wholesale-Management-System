// Small shared building blocks for the back office.
import React from "react";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";

export const PageHeader: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
  <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
    <div className="min-w-0">
      <h1 className="font-display text-[1.65rem] md:text-[1.9rem] font-extrabold text-ink leading-tight">{title}</h1>
      {subtitle && <p className="text-[15px] text-ink-2 mt-1">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>
);

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = "", children }) => (
  <div className={`bg-surface text-ink border border-line rounded-xl ${className}`}>{children}</div>
);

export const Spinner: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center py-16 text-ink-3" role="status">
    <Loader2 className="animate-spin text-brand mb-2" size={24} />
    {label && <p className="text-sm">{label}</p>}
  </div>
);

export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }> = ({ icon, title, text, action }) => (
  <div className="text-center py-16 px-4">
    {icon && <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-raised grid place-items-center text-ink-3 [&_svg]:w-6 [&_svg]:h-6">{icon}</div>}
    <p className="font-semibold text-ink">{title}</p>
    {text && <p className="text-sm text-ink-3 mt-1 max-w-sm mx-auto">{text}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-blue-100 text-blue-800",
  processing: "bg-indigo-100 text-indigo-800",
  shipped: "bg-purple-100 text-purple-800",
  delivered: "bg-green-100 text-green-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-200 text-gray-700",
  active: "bg-green-100 text-green-800",
  disabled: "bg-gray-200 text-gray-700",
  suspended: "bg-red-100 text-red-800",
  inactive: "bg-gray-200 text-gray-700",
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-800",
  partially_received: "bg-amber-100 text-amber-800",
  received: "bg-green-100 text-green-800",
  closed: "bg-gray-200 text-gray-700",
  ok: "bg-green-100 text-green-800",
  "in stock": "bg-green-100 text-green-800",
  low: "bg-amber-100 text-amber-800",
  out: "bg-red-100 text-red-800",
  // sales documents
  issued: "bg-blue-100 text-blue-800",
  partially_paid: "bg-amber-100 text-amber-800",
  paid: "bg-green-100 text-green-800",
  void: "bg-gray-200 text-gray-500 line-through",
  overdue: "bg-red-100 text-red-800",
  applied: "bg-green-100 text-green-800",
  refunded: "bg-teal-100 text-teal-800",
  requested: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  accepted: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
  expired: "bg-gray-200 text-gray-600",
  blocked: "bg-red-100 text-red-800",
  "in transit": "bg-indigo-100 text-indigo-800",
  credited: "bg-green-100 text-green-800",
  // HR
  terminated: "bg-gray-200 text-gray-700",
  present: "bg-green-100 text-green-800",
  absent: "bg-red-100 text-red-800",
  half_day: "bg-amber-100 text-amber-800",
  paid_leave: "bg-blue-100 text-blue-800",
  unpaid_leave: "bg-purple-100 text-purple-800",
  holiday: "bg-teal-100 text-teal-800",
  new: "bg-green-100 text-green-800",
  // products
  published: "bg-green-100 text-green-800",
  hidden: "bg-gray-200 text-gray-700",
  discontinued: "bg-orange-100 text-orange-800",
  archived: "bg-gray-100 text-gray-500",
  updated: "bg-blue-100 text-blue-800",
  unchanged: "bg-gray-100 text-gray-600",
};

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const TONE: Record<Tone, { chip: string; dot: string }> = {
  neutral: { chip: "bg-raised text-ink-2 ring-line", dot: "bg-ink-3" },
  info: { chip: "bg-blue-50 text-blue-800 ring-blue-200", dot: "bg-blue-500" },
  success: { chip: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500" },
  warning: { chip: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  danger: { chip: "bg-red-50 text-red-800 ring-red-200", dot: "bg-red-500" },
};
// every status the back office shows, grouped into five meanings
const toneOf = (status: string): Tone => {
  const cls = STATUS_STYLES[status] || "";
  if (/green|teal/.test(cls)) return "success";
  if (/amber|orange/.test(cls)) return "warning";
  if (/red/.test(cls)) return "danger";
  if (/blue|indigo|purple/.test(cls)) return "info";
  return "neutral";
};

export const StatusBadge: React.FC<{ status?: string | null }> = ({ status }) => {
  const t = TONE[toneOf(status || "")];
  const label = (status || "unknown").replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset whitespace-nowrap ${t.chip} ${status === "void" ? "line-through" : ""}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} aria-hidden="true" />
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  );
};

export const Pagination: React.FC<{ page: number; totalPages: number; onChange: (p: number) => void }> = ({ page, totalPages, onChange }) =>
  totalPages > 1 ? (
    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-line text-sm">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="w-8 h-8 grid place-items-center rounded-lg border border-line hover:bg-raised disabled:opacity-30" aria-label="Previous page">
        <ChevronLeft size={16} />
      </button>
      <span className="text-ink-2 px-1">
        Page <b className="text-ink font-semibold">{page}</b> of {totalPages}
      </span>
      <button disabled={page >= totalPages} onClick={() => onChange(page + 1)} className="w-8 h-8 grid place-items-center rounded-lg border border-line hover:bg-raised disabled:opacity-30" aria-label="Next page">
        <ChevronRight size={16} />
      </button>
    </div>
  ) : null;

export const money = (n: unknown) => {
  const v = Number(n || 0);
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const dateTime = (d?: string | null) => (d ? new Date(d).toLocaleString() : "—");
export const dateOnly = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

// inputBase has no width so it can be combined with w-auto / w-64 etc.
export const inputBase = "h-10 px-3 border border-line-strong rounded-lg bg-surface text-ink text-sm placeholder:text-ink-3 hover:border-ink-3/50 focus:border-brand focus:ring-4 focus:ring-brand/15 outline-none [&:is(textarea)]:h-auto [&:is(textarea)]:py-2";
export const inputCls = `${inputBase} w-full`;
export const btnPrimary = "inline-flex items-center justify-center gap-2 h-10 bg-brand text-white px-4 rounded-lg font-semibold text-sm hover:bg-brand-hover disabled:opacity-50";
export const btnSecondary = "inline-flex items-center justify-center gap-2 h-10 border border-line-strong bg-surface text-ink px-4 rounded-lg font-semibold text-sm hover:bg-raised disabled:opacity-50";
export const btnDanger = "inline-flex items-center justify-center gap-2 h-10 border border-red-200 bg-surface text-red-600 px-4 rounded-lg font-semibold text-sm hover:bg-red-50 disabled:opacity-50";

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block">
    <span className="block text-sm font-medium text-ink mb-1.5">{label}</span>
    {children}
    {hint && <span className="block text-xs text-ink-3 mt-1.5">{hint}</span>}
  </label>
);

/** Small labelled number tile for summaries. */
export const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: "default" | "warn" | "good" }> = ({ label, value, tone = "default" }) => (
  <div className="rounded-lg p-3.5 bg-raised border border-line">
    <p className="text-[13px] text-ink-3 flex items-center gap-1.5">
      {tone !== "default" && <span className={`w-1.5 h-1.5 rounded-full ${tone === "warn" ? "bg-red-500" : "bg-emerald-500"}`} aria-hidden="true" />}
      {label}
    </p>
    <p className={`font-display text-xl font-extrabold mt-0.5 ${tone === "warn" ? "text-red-700" : tone === "good" ? "text-emerald-700" : "text-ink"}`}>{value}</p>
  </div>
);

/** Row of filter "tabs" (status filters). */
export const FilterTabs: React.FC<{ value: string; onChange: (v: string) => void; options: { value: string; label: string; count?: number }[] }> = ({ value, onChange, options }) => (
  <div className="flex flex-wrap gap-1">
    {options.map((o) => (
      <button
        key={o.value}
        onClick={() => onChange(o.value)}
        className={`px-3 py-1.5 rounded-lg text-xs font-bold ${value === o.value ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
      >
        {o.label}
        {o.count ? <span className="ml-1 opacity-70">{o.count}</span> : null}
      </button>
    ))}
  </div>
);

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => {
  const box = React.useRef<HTMLDivElement>(null);
  // Escape closes; focus moves into the dialog and back out when it closes
  React.useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-[100] bg-night/60 backdrop-blur-[2px] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        ref={box}
        tabIndex={-1}
        className={`bg-surface text-ink rounded-2xl shadow-xl border border-line w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto outline-none`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line sticky top-0 bg-surface z-10">
          <h2 className="font-display font-bold text-lg text-ink">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 -mr-2 grid place-items-center rounded-lg text-ink-3 hover:text-ink hover:bg-raised" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};
