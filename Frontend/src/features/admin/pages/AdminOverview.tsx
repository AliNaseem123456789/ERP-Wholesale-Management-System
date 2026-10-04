// Platform admin overview: headline KPIs vs the previous period, daily sales, top sellers & products, health.
import React, { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Mail, Building2 } from "lucide-react";
import { apiClient } from "../../../api/apiClient";

type Kpis = any;
const money = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`);

const Change: React.FC<{ value: number | null; invert?: boolean }> = ({ value, invert }) => {
  if (value === null) return <span className="text-xs text-gray-400">new</span>;
  if (value === 0) return <span className="inline-flex items-center text-xs text-gray-500"><Minus size={12} /> 0%</span>;
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center text-xs font-bold ${good ? "text-green-700" : "text-red-700"}`}><Icon size={13} />{Math.abs(value)}%</span>;
};

const Tile: React.FC<{ label: string; value: string | number; change?: number | null; invert?: boolean; hint?: string }> = ({ label, value, change, invert, hint }) => (
  <div className="bg-white border border-gray-200 rounded-2xl p-4">
    <p className="text-[11px] uppercase font-bold text-gray-500 tracking-wide">{label}</p>
    <p className="text-2xl font-black text-gray-900 mt-1">{value}</p>
    <div className="flex items-center gap-2 mt-1">{change !== undefined && <Change value={change} invert={invert} />}{hint && <span className="text-xs text-gray-400">{hint}</span>}</div>
  </div>
);

// Daily sales: one series, thin bars anchored to the baseline, hover tooltip per bar.
const SalesChart: React.FC<{ series: { date: string; gmv: number; orders: number }[] }> = ({ series }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 220, L = 52, B = 26, T = 10;
  const max = Math.max(1, ...series.map((s) => s.gmv));
  const step = (W - L - 8) / Math.max(1, series.length);
  const bw = Math.max(2, Math.min(18, step - 2));
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const labelEvery = Math.ceil(series.length / 8);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-56" role="img" aria-label="Sales per day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#6b7280">{compact(t)}</text>
          </g>
        ))}
        {series.map((s, i) => {
          const x = L + i * step + (step - bw) / 2;
          const h = Math.max(s.gmv > 0 ? 2 : 0, H - B - y(s.gmv));
          return (
            <g key={s.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + i * step} y={T} width={step} height={H - T - B} fill="transparent" />
              {h > 0 && <path d={`M${x},${H - B} v${-(h - Math.min(4, h))} q0,${-Math.min(4, h)} ${Math.min(4, bw / 2)},${-Math.min(4, h)} h${bw - 2 * Math.min(4, bw / 2)} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, h)} v${h - Math.min(4, h)} z`} fill={hover === i ? "#1d4ed8" : "#2563eb"} />}
              {i % labelEvery === 0 && <text x={L + i * step + step / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b7280">{s.date.slice(5)}</text>}
            </g>
          );
        })}
        <line x1={L} x2={W - 4} y1={H - B} y2={H - B} stroke="#9ca3af" strokeWidth={1} />
      </svg>
      {hover !== null && (
        <div className="absolute top-1 pointer-events-none bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 shadow" style={{ left: `${((L + hover * step + step / 2) / W) * 100}%`, transform: "translateX(-50%)" }}>
          <b>{series[hover].date}</b><br />{money(series[hover].gmv)} · {series[hover].orders} order(s)
        </div>
      )}
    </div>
  );
};

export const AdminOverview: React.FC = () => {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Kpis | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setD(null);
    apiClient.get(`/admin/kpis?days=${days}`).then((r) => setD(r.data.data)).catch((e) => setError(e?.response?.data?.message || "Couldn't load the numbers"));
  }, [days]);
  const statusTotal = useMemo(() => (d ? d.order_statuses.reduce((s: number, x: any) => s + x.n, 0) : 0), [d]);
  if (error) return <p className="text-red-600">{error}</p>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Marketplace overview</h1>
          <p className="text-sm text-gray-500">Last {days} days, compared with the {days} days before</p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90, 365].map((n) => (
            <button key={n} onClick={() => setDays(n)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${days === n ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>{n === 365 ? "1 year" : `${n} days`}</button>
          ))}
        </div>
      </div>
      {!d ? <p className="text-gray-500 py-10 text-center">Loading...</p> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Sales (GMV)" value={money(d.current.gmv)} change={d.change.gmv} />
            <Tile label="Orders" value={d.current.orders} change={d.change.orders} />
            <Tile label="Average order" value={money(d.current.aov)} change={d.change.aov} />
            <Tile label="Buying customers" value={d.current.buyers} change={d.change.buyers} />
            <Tile label="Repeat buyers" value={`${d.current.repeat_rate}%`} change={d.change.repeat_rate} hint="ordered twice or more" />
            <Tile label="Cancelled" value={`${d.current.cancel_rate}%`} change={d.change.cancel_rate} invert />
            <Tile label="New sign-ups" value={d.current.new_users} change={d.change.new_users} />
            <Tile label="New companies" value={d.current.new_companies} change={d.change.new_companies} hint={`${d.companies.active || 0} active in total`} />
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <p className="font-bold text-gray-900 mb-1">Sales per day</p>
            <SalesChart series={d.series} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <p className="font-bold text-gray-900 px-4 pt-4 pb-2">Top companies</p>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Company</th><th className="text-right">Orders</th><th className="text-right px-4">Sales</th></tr></thead>
                <tbody>{d.top_companies.length === 0 ? <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">No sales yet</td></tr> : d.top_companies.map((c: any) => (
                  <tr key={c.id} className="border-b border-gray-50"><td className="px-4 py-2 font-semibold text-gray-900">{c.name}</td><td className="text-right text-gray-700">{c.orders}</td><td className="text-right px-4 font-mono text-gray-900">{money(c.gmv)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <p className="font-bold text-gray-900 px-4 pt-4 pb-2">Top products</p>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Product</th><th className="text-right">Units</th><th className="text-right px-4">Sales</th></tr></thead>
                <tbody>{d.top_products.length === 0 ? <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">No sales yet</td></tr> : d.top_products.map((p: any) => (
                  <tr key={p.id} className="border-b border-gray-50"><td className="px-4 py-2"><span className="font-semibold text-gray-900">{p.title}</span><span className="block text-xs text-gray-400">{p.company}</span></td><td className="text-right text-gray-700">{p.units}</td><td className="text-right px-4 font-mono text-gray-900">{money(p.revenue)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <p className="font-bold text-gray-900 mb-3">Orders by status</p>
              {d.order_statuses.map((s: any) => (
                <div key={s.status} className="mb-2">
                  <div className="flex justify-between text-sm text-gray-700"><span className="capitalize">{s.status}</span><span>{s.n}</span></div>
                  <div className="h-1.5 bg-gray-100 rounded-full mt-1"><div className="h-1.5 bg-blue-600 rounded-full" style={{ width: `${statusTotal ? (s.n / statusTotal) * 100 : 0}%` }} /></div>
                </div>
              ))}
              {!d.order_statuses.length && <p className="text-sm text-gray-400">No orders in this period</p>}
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <p className="font-bold text-gray-900 mb-3 flex items-center gap-2"><Building2 size={16} /> Companies</p>
              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                {["active", "pending", "suspended"].map((k) => <div key={k} className="bg-gray-50 rounded-xl py-2"><p className="text-lg font-black text-gray-900">{d.companies[k] || 0}</p><p className="text-[10px] uppercase text-gray-500">{k}</p></div>)}
              </div>
              {d.pending_companies.length > 0 && <p className="text-xs font-bold text-amber-700 mb-1">Waiting for approval</p>}
              {d.pending_companies.map((c: any) => <p key={c.id} className="text-sm text-gray-700 truncate">{c.name} <span className="text-gray-400">· {c.email}</span></p>)}
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <p className="font-bold text-gray-900 mb-3 flex items-center gap-2"><Mail size={16} /> Email (last 7 days)</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {["sent", "pending", "failed"].map((k) => <div key={k} className={`rounded-xl py-2 ${k === "failed" && d.emails_7d[k] ? "bg-red-50" : "bg-gray-50"}`}><p className={`text-lg font-black ${k === "failed" && d.emails_7d[k] ? "text-red-700" : "text-gray-900"}`}>{d.emails_7d[k] || 0}</p><p className="text-[10px] uppercase text-gray-500">{k}</p></div>)}
              </div>
              <p className="text-xs text-gray-500 mt-3">Users: {Object.entries(d.users).map(([k, v]) => `${v} ${String(k).toLowerCase()}`).join(" · ")}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
