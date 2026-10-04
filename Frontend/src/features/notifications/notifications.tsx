// Notifications centre: the bell in the header (polls every minute) and the full page.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Trash2, ShoppingBag, FileText, Package, Plane, Banknote, BarChart3, Building2, AlertTriangle, ShieldCheck, Undo2, FileSignature } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "../../api/apiClient";
import { announceActiveCompany } from "../business/context/activeCompany";

export type Notification = {
  id: number; type: string; title: string; body?: string | null; link?: string | null; read_at?: string | null; created_at: string;
  company_id?: number | null; company?: { id: number; name: string } | null;
};

export const notificationsApi = {
  list: async (p: { unread?: boolean; page?: number; limit?: number } = {}) =>
    (await apiClient.get(`/notifications?${new URLSearchParams({ ...(p.unread ? { unread: "1" } : {}), page: String(p.page || 1), limit: String(p.limit || 20) })}`)).data as {
      data: Notification[]; unread: number; totalPages: number;
    },
  count: async () => (await apiClient.get("/notifications/count")).data.unread as number,
  read: async (id: number) => (await apiClient.post(`/notifications/${id}/read`)).data,
  readAll: async () => (await apiClient.post("/notifications/read-all")).data,
  clearRead: async () => (await apiClient.delete("/notifications/read")).data,
  remove: async (id: number) => (await apiClient.delete(`/notifications/${id}`)).data,
};

const ICONS: [string, any][] = [
  ["order", ShoppingBag], ["invoice", FileText], ["credit_note", FileText], ["quote", FileSignature], ["return", Undo2], ["stock", Package],
  ["leave", Plane], ["payslip", Banknote], ["payroll", Banknote], ["bill", Banknote], ["report", BarChart3], ["company", Building2], ["license", ShieldCheck],
];
const iconFor = (type: string) => ICONS.find(([k]) => type.startsWith(k))?.[1] || AlertTriangle;

export const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
};

/** Opening a notification: mark it read, switch to its company for back-office links, go to the link. */
export const useOpenNotification = () => {
  const navigate = useNavigate();
  return async (n: Notification, after?: () => void) => {
    if (!n.read_at) await notificationsApi.read(n.id).catch(() => {});
    if (n.company_id && n.link?.startsWith("/business")) announceActiveCompany(String(n.company_id));
    after?.();
    if (n.link) navigate(n.link);
  };
};

const Row: React.FC<{ n: Notification; onOpen: () => void; compact?: boolean; onRemove?: () => void }> = ({ n, onOpen, compact, onRemove }) => {
  const Icon = iconFor(n.type);
  return (
    <div className={`flex gap-3 px-4 py-3 border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50 ${n.read_at ? "" : "bg-blue-50/50"}`} onClick={onOpen}>
      <div className={`mt-0.5 shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${n.read_at ? "bg-gray-100 text-gray-400" : "bg-blue-100 text-blue-700"}`}><Icon size={16} /></div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm text-gray-900 ${n.read_at ? "" : "font-bold"}`}>{n.title}</p>
        {n.body && <p className={`text-xs text-gray-500 ${compact ? "truncate" : ""}`}>{n.body}</p>}
        <p className="text-[11px] text-gray-400 mt-0.5">{timeAgo(n.created_at)}{n.company ? ` · ${n.company.name}` : ""}</p>
      </div>
      {!n.read_at && <span className="mt-2 w-2 h-2 rounded-full bg-blue-600 shrink-0" aria-label="Unread" />}
      {onRemove && <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-gray-300 hover:text-red-600 shrink-0" aria-label="Remove notification"><Trash2 size={14} /></button>}
    </div>
  );
};

export const NotificationBell: React.FC<{ className?: string; mobile?: boolean }> = ({ className = "", mobile }) => {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const openNotification = useOpenNotification();

  const refreshCount = useCallback(() => { notificationsApi.count().then(setUnread).catch(() => {}); }, []);
  useEffect(() => {
    refreshCount();
    const t = setInterval(() => { if (document.visibilityState === "visible") refreshCount(); }, 60000);
    const onFocus = () => refreshCount();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [refreshCount]);
  useEffect(() => {
    if (!open) return;
    notificationsApi.list({ limit: 8 }).then((r) => { setItems(r.data); setUnread(r.unread); }).catch(() => setItems([]));
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (mobile) {
    return (
      <button onClick={() => navigate("/notifications")} className={`relative flex flex-col items-center ${className}`} aria-label="Notifications">
        <Bell size={22} /><span className="text-xs">Alerts</span>
        {unread > 0 && <span className="absolute top-0 right-1 bg-pink-500 text-white text-[10px] min-w-4 h-4 px-1 flex items-center justify-center rounded-full font-bold">{unread > 99 ? "99+" : unread}</span>}
      </button>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className={`relative p-2 border rounded-md transition-colors ${className}`} aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
        <Bell />
        {unread > 0 && <span className="absolute -top-2 -right-2 bg-pink-500 text-white text-xs min-w-5 h-5 px-1 flex items-center justify-center rounded-full font-bold">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[90vw] bg-white text-gray-900 rounded-2xl shadow-2xl border border-gray-200 z-[200] overflow-hidden" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="font-bold">Notifications</span>
            {unread > 0 && (
              <button onClick={async () => { await notificationsApi.readAll(); setUnread(0); setItems((x) => x?.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })) || null); }} className="text-xs font-bold text-blue-700 inline-flex items-center gap-1">
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {!items ? <p className="p-6 text-sm text-gray-400 text-center">Loading...</p> : items.length === 0 ? <p className="p-6 text-sm text-gray-500 text-center">You're all caught up.</p> :
              items.map((n) => <Row key={n.id} n={n} compact onOpen={() => openNotification(n, () => { setOpen(false); refreshCount(); })} />)}
          </div>
          <button onClick={() => { setOpen(false); navigate("/notifications"); }} className="w-full text-center text-sm font-semibold text-blue-700 py-3 border-t border-gray-100 hover:bg-gray-50">See all notifications</button>
        </div>
      )}
    </div>
  );
};

export const NotificationsPage: React.FC = () => {
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(1);
  const [d, setD] = useState<{ data: Notification[]; unread: number; totalPages: number } | null>(null);
  const openNotification = useOpenNotification();
  const load = useCallback(() => { notificationsApi.list({ unread: tab === "unread", page, limit: 25 }).then(setD).catch(() => setD({ data: [], unread: 0, totalPages: 1 })); }, [tab, page]);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<any>) => {
    try {
      toast.success((await fn()).message);
      load();
    } catch {
      toast.error("Something went wrong");
    }
  };
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-black text-gray-900">Notifications</h1>
            <p className="text-sm text-gray-500">{d ? `${d.unread} unread` : ""}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => act(notificationsApi.readAll)} className="inline-flex items-center gap-1 border border-gray-300 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50"><CheckCheck size={16} /> Mark all read</button>
            <button onClick={() => act(notificationsApi.clearRead)} className="inline-flex items-center gap-1 border border-gray-300 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50"><Trash2 size={16} /> Clear read</button>
          </div>
        </div>
        <div className="flex gap-1 mb-3">
          {(["all", "unread"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setPage(1); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === t ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>{t === "all" ? "All" : "Unread"}</button>
          ))}
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {!d ? <p className="p-8 text-center text-gray-400">Loading...</p> : d.data.length === 0 ? <p className="p-8 text-center text-gray-500">Nothing here.</p> :
            d.data.map((n) => <Row key={n.id} n={n} onOpen={() => openNotification(n)} onRemove={() => notificationsApi.remove(n.id).then(load)} />)}
        </div>
        {d && d.totalPages > 1 && (
          <div className="flex justify-center gap-3 mt-4 text-sm">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 rounded border border-gray-300 bg-white disabled:opacity-40">Previous</button>
            <span className="py-1 text-gray-600">Page {page} of {d.totalPages}</span>
            <button disabled={page >= d.totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1 rounded border border-gray-300 bg-white disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
    </div>
  );
};
