// Business → Analytics: what buyers look at, search for and add to carts, and how much of it becomes orders.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Search, ShoppingCart, Users, Receipt, TrendingUp, FileSignature } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { sellerInsightsApi, AnalyticsReport } from "../api/insights.api";
import { Card, PageHeader, Spinner, FilterTabs, money } from "../components/ui";

const change = (now: number, before: number) => {
  if (!before) return now ? { text: "new", tone: "text-green-700" } : null;
  const pct = Math.round(((now - before) / before) * 100);
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, tone: pct > 0 ? "text-green-700" : pct < 0 ? "text-red-600" : "text-gray-500" };
};

const Kpi: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; now?: number; before?: number; hint?: string }> = ({ icon, label, value, now, before, hint }) => {
  const c = now !== undefined && before !== undefined ? change(now, before) : null;
  return (
    <Card className="p-4">
      <p className="text-xs font-bold uppercase text-gray-500 flex items-center gap-1.5">{icon} {label}</p>
      <p className="text-2xl font-black text-gray-900 mt-1 tabular-nums">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{c ? <span className={`font-bold ${c.tone}`}>{c.text}</span> : null}{c ? " vs previous period" : hint}</p>
    </Card>
  );
};

/** One series per chart (one axis); hover a bar for the exact value. */
const BarChart: React.FC<{ title: string; data: { day: string; value: number }[]; format?: (n: number) => string }> = ({ title, data, format = (n) => String(n) }) => {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 640, H = 160, pad = 28;
  const bw = (W - pad) / Math.max(1, data.length);
  const ticks = [0, max / 2, max].map((v) => Math.round(v * 100) / 100);
  const h = hover !== null ? data[hover] : null;
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 tabular-nums h-4">{h ? `${new Date(`${h.day}T00:00:00`).toLocaleDateString()}: ${format(h.value)}` : `Total ${format(data.reduce((s, d) => s + d.value, 0))}`}</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full h-auto mt-2" role="img" aria-label={`${title}, by day`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => {
          const y = H - (t / max) * (H - 8);
          return (
            <g key={t}>
              <line x1={pad} x2={W} y1={y} y2={y} stroke="currentColor" className="text-gray-200" strokeWidth={1} />
              <text x={pad - 4} y={y + 3} textAnchor="end" fontSize={9} className="fill-gray-400">{format(t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const bh = (d.value / max) * (H - 8);
          const x = pad + i * bw;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              {bh > 0 && <rect x={x + Math.min(2, bw * 0.15)} y={H - bh} width={Math.max(1, bw - Math.min(4, bw * 0.3))} height={bh} rx={Math.min(4, bw / 3)} fill={hover === i ? "#1d4ed8" : "#2563eb"} />}
            </g>
          );
        })}
        {data.length > 0 && [0, Math.floor(data.length / 2), data.length - 1].map((i) => (
          <text key={i} x={pad + i * bw + bw / 2} y={H + 13} textAnchor="middle" fontSize={9} className="fill-gray-400">{new Date(`${data[i].day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</text>
        ))}
      </svg>
      <details className="mt-1 text-xs text-gray-500">
        <summary className="cursor-pointer">Show as table</summary>
        <table className="w-full mt-1">
          <tbody>{data.filter((d) => d.value).map((d) => <tr key={d.day}><td className="py-0.5">{d.day}</td><td className="text-right tabular-nums">{format(d.value)}</td></tr>)}</tbody>
        </table>
      </details>
    </Card>
  );
};

export const AnalyticsPage: React.FC = () => {
  const { companyId, company } = useBusiness();
  const [days, setDays] = useState("30");
  const [r, setR] = useState<AnalyticsReport | null>(null);
  useEffect(() => {
    setR(null);
    sellerInsightsApi.analytics(companyId!, Number(days)).then(setR).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, days]);

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Visits to your store page and products, searches, carts and orders. Your own team's visits aren't counted." />
      <div className="mb-4"><FilterTabs value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "365", label: "12 months" }]} /></div>
      {!r ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={<Users size={13} />} label="Visitors" value={r.totals.visitors} now={r.totals.visitors} before={r.previous.visitors} />
            <Kpi icon={<Eye size={13} />} label="Page views" value={r.totals.storefront_views + r.totals.product_views} now={r.totals.storefront_views + r.totals.product_views} before={r.previous.storefront_views + r.previous.product_views} />
            <Kpi icon={<ShoppingCart size={13} />} label="Added to cart" value={r.totals.add_to_carts} now={r.totals.add_to_carts} before={r.previous.add_to_carts} />
            <Kpi icon={<Receipt size={13} />} label="Orders" value={r.totals.orders} now={r.totals.orders} before={r.previous.orders} />
            <Kpi icon={<TrendingUp size={13} />} label="Revenue" value={money(r.totals.revenue)} now={r.totals.revenue} before={r.previous.revenue} />
            <Kpi icon={<Users size={13} />} label="Visitor → order" value={r.totals.conversion === null ? "—" : `${r.totals.conversion}%`} hint="Orders per visitor" />
            <Kpi icon={<Users size={13} />} label="Buyers" value={r.totals.buyers} hint={`${r.totals.new_buyers} ordered for the first time`} />
            <Kpi icon={<Search size={13} />} label="Search appearances" value={r.totals.search_impressions} now={r.totals.search_impressions} before={r.previous.search_impressions} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <BarChart title="Page views" data={r.series.map((s) => ({ day: s.day, value: s.views }))} />
            <BarChart title="Revenue" data={r.series.map((s) => ({ day: s.day, value: s.revenue }))} format={(n) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`)} />
          </div>

          <div className="grid lg:grid-cols-[2fr_1fr] gap-4 items-start">
            <Card>
              <p className="font-bold text-gray-900 px-4 pt-4">Products</p>
              {r.top_products.length === 0 ? <p className="text-sm text-gray-500 p-4">No product activity in this period yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm mt-2">
                    <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-2">Product</th><th className="px-2 py-2 text-right">Views</th><th className="px-2 py-2 text-right">To cart</th><th className="px-2 py-2 text-right">View → cart</th><th className="px-2 py-2 text-right">Units sold</th><th className="px-4 py-2 text-right">Revenue</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {r.top_products.map((t) => (
                        <tr key={t.product_id}>
                          <td className="px-4 py-2">{t.slug ? <Link to={`/product/${t.slug}`} className="font-semibold text-gray-900 hover:text-blue-600">{t.title}</Link> : <span className="font-semibold">{t.title}</span>}<span className="block text-xs text-gray-400">{t.sku}</span></td>
                          <td className="px-2 py-2 text-right tabular-nums">{t.views}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{t.carts}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{t.view_to_cart === null ? "—" : `${t.view_to_cart}%`}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{t.units}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold">{money(t.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <div className="space-y-4">
              <Card className="p-4">
                <p className="font-bold text-gray-900 mb-2">Searches that found you</p>
                {r.top_searches.length === 0 ? <p className="text-sm text-gray-500">None yet.</p> : (
                  <ol className="space-y-1 text-sm">
                    {r.top_searches.map((s) => <li key={s.query} className="flex justify-between gap-2"><Link to={`/products?q=${encodeURIComponent(s.query)}`} className="text-gray-800 hover:text-blue-600 truncate">{s.query}</Link><span className="text-gray-500 tabular-nums">{s.impressions}</span></li>)}
                  </ol>
                )}
              </Card>
              <Card className="p-4 text-sm space-y-1">
                <p className="font-bold text-gray-900 flex items-center gap-1.5"><FileSignature size={14} /> Quotes</p>
                <p className="flex justify-between"><span className="text-gray-600">Sent</span><b>{r.quotes.sent}</b></p>
                <p className="flex justify-between"><span className="text-gray-600">Accepted</span><b>{r.quotes.accepted}</b></p>
                <p className="flex justify-between"><span className="text-gray-600">Win rate</span><b>{r.quotes.win_rate === null ? "—" : `${r.quotes.win_rate}%`}</b></p>
                <p className="flex justify-between"><span className="text-gray-600">Waiting for your prices</span><b>{r.quotes.requested}</b></p>
                <p className="pt-2 border-t border-gray-100 flex justify-between"><span className="text-gray-600">Competitive requests</span><b>{r.rfqs.invited}</b></p>
                <p className="flex justify-between"><span className="text-gray-600">You answered / won</span><b>{r.rfqs.answered} / {r.rfqs.won}</b></p>
              </Card>
              {company?.slug && <p className="text-xs text-gray-500">Want more visits? Improve your <Link to="/business/storefront" className="text-blue-600 hover:underline">storefront</Link> or put products on sale.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
