// Small shared building blocks for the back office.
import React from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

export const PageHeader: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
  <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
    <div>
      <h1 className="text-2xl font-black text-gray-900">{title}</h1>
      {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>
);

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = "", children }) => (
  <div className={`bg-white text-gray-900 border border-gray-200 rounded-2xl shadow-sm ${className}`}>{children}</div>
);

export const Spinner: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center py-16 text-gray-500">
    <Loader2 className="animate-spin text-blue-600 mb-2" size={28} />
    {label && <p className="text-sm">{label}</p>}
  </div>
);

export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }> = ({ icon, title, text, action }) => (
  <div className="text-center py-16 px-4">
    {icon && <div className="flex justify-center text-gray-300 mb-3">{icon}</div>}
    <p className="font-bold text-gray-900">{title}</p>
    {text && <p className="text-sm text-gray-500 mt-1">{text}</p>}
    {action && <div className="mt-4">{action}</div>}
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
  updated: "bg-blue-100 text-blue-800",
  unchanged: "bg-gray-100 text-gray-600",
};

export const StatusBadge: React.FC<{ status?: string | null }> = ({ status }) => (
  <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLES[status || ""] || "bg-gray-100 text-gray-700"}`}>
    {(status || "unknown").replace(/_/g, " ")}
  </span>
);

export const Pagination: React.FC<{ page: number; totalPages: number; onChange: (p: number) => void }> = ({ page, totalPages, onChange }) =>
  totalPages > 1 ? (
    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 text-sm">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30" aria-label="Previous page">
        <ChevronLeft size={18} />
      </button>
      <span className="text-gray-600">
        Page {page} of {totalPages}
      </span>
      <button disabled={page >= totalPages} onClick={() => onChange(page + 1)} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30" aria-label="Next page">
        <ChevronRight size={18} />
      </button>
    </div>
  ) : null;

export const money = (n: unknown) => {
  const v = Number(n || 0);
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
};
export const dateTime = (d?: string | null) => (d ? new Date(d).toLocaleString() : "—");
export const dateOnly = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

// inputBase has no width so it can be combined with w-auto / w-64 etc.
export const inputBase = "px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900 text-sm";
export const inputCls = `${inputBase} w-full`;
export const btnPrimary = "inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm hover:bg-blue-700 disabled:opacity-50";
export const btnSecondary = "inline-flex items-center gap-2 border border-gray-300 bg-white text-gray-700 px-4 py-2 rounded-lg font-semibold text-sm hover:bg-gray-50 disabled:opacity-50";
export const btnDanger = "inline-flex items-center gap-2 border border-red-200 bg-white text-red-600 px-4 py-2 rounded-lg font-semibold text-sm hover:bg-red-50 disabled:opacity-50";

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block">
    <span className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">{label}</span>
    {children}
    {hint && <span className="block text-xs text-gray-400 mt-1">{hint}</span>}
  </label>
);

/** Small labelled number tile for summaries. */
export const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: "default" | "warn" | "good" }> = ({ label, value, tone = "default" }) => (
  <div className={`rounded-xl p-3 ${tone === "warn" ? "bg-red-50" : tone === "good" ? "bg-green-50" : "bg-gray-50"}`}>
    <p className="text-[10px] uppercase font-bold text-gray-400">{label}</p>
    <p className={`text-lg font-black ${tone === "warn" ? "text-red-700" : tone === "good" ? "text-green-700" : "text-gray-900"}`}>{value}</p>
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

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => (
  <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
    <div
      className={`bg-white text-gray-900 rounded-2xl shadow-2xl w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto`}
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
        <h2 className="font-bold text-lg text-gray-900">{title}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>
);
