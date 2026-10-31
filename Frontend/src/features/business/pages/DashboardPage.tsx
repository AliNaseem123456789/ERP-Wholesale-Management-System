import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DollarSign, ShoppingBag, Package, Users, Boxes, AlertTriangle, ClipboardList } from "lucide-react";
import { useBusiness } from "../context/BusinessContext";
import { businessApi, errorMessage } from "../api/business.api";
import { Card, PageHeader, Spinner, StatusBadge, money, dateOnly } from "../components/ui";

const Stat: React.FC<{ label: string; value: React.ReactNode; icon: React.ReactNode; hint?: string; alert?: boolean }> = ({ label, value, icon, hint, alert }) => (
  <Card className="p-5 h-full hover:border-line-strong">
    <div className="flex items-center justify-between">
      <span className="text-sm text-ink-2">{label}</span>
      <span className={`w-8 h-8 rounded-lg grid place-items-center ${alert ? "bg-red-50 text-red-600" : "bg-raised text-ink-3"}`}>{icon}</span>
    </div>
    <p className={`font-display text-[1.45rem] sm:text-[1.85rem] leading-none font-extrabold mt-3 [overflow-wrap:anywhere] ${alert ? "text-red-700" : "text-ink"}`}>{value}</p>
    {hint && <p className="text-[13px] text-ink-3 mt-2">{hint}</p>}
  </Card>
);

const PIPELINE: { key: string; label: string; color: string }[] = [
  { key: "pending", label: "Awaiting confirmation", color: "bg-amber-400" },
  { key: "confirmed", label: "Confirmed", color: "bg-blue-500" },
  { key: "processing", label: "Processing", color: "bg-indigo-500" },
  { key: "shipped", label: "Shipped", color: "bg-sky-400" },
];

export const DashboardPage: React.FC = () => {
  const { companyId, company } = useBusiness();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    setData(null);
    businessApi.dashboard(companyId).then(setData).catch((e) => setError(errorMessage(e)));
  }, [companyId]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <Spinner />;

  const open = (data.ordersByStatus.pending || 0) + (data.ordersByStatus.confirmed || 0) + (data.ordersByStatus.processing || 0);

  return (
    <div>
      <PageHeader title={company?.name || "Dashboard"} subtitle="Your last 30 days at a glance" />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <Stat label="Revenue (30d)" value={money(data.last30Days.revenue)} icon={<DollarSign size={18} />} hint={`${data.last30Days.orders} orders`} />
        <Stat label="Open orders" value={open} icon={<ShoppingBag size={18} />} hint={`${data.ordersByStatus.pending || 0} awaiting confirmation`} />
        <Stat label="Active products" value={data.products.active} icon={<Package size={18} />} hint={data.products.inactive ? `${data.products.inactive} hidden` : undefined} />
        <Stat label="Team members" value={data.teamMembers} icon={<Users size={18} />} />
      </div>

      {open > 0 && (
        <Card className="p-5 mb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="font-display text-lg font-bold text-ink">Order pipeline</h2>
            <Link to="/business/orders" className="text-sm font-semibold text-brand-text hover:underline">Open orders</Link>
          </div>
          {(() => {
            const parts = PIPELINE.map((p) => ({ ...p, n: Number(data.ordersByStatus[p.key] || 0) })).filter((p) => p.n > 0);
            const total = parts.reduce((t, p) => t + p.n, 0) || 1;
            return (
              <>
                <div className="flex h-3 rounded-full overflow-hidden bg-raised gap-0.5" role="img" aria-label={parts.map((p) => `${p.n} ${p.label}`).join(", ")}>
                  {parts.map((p) => <div key={p.key} className={p.color} style={{ width: `${(p.n / total) * 100}%` }} />)}
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3 text-sm">
                  {parts.map((p) => (
                    <span key={p.key} className="flex items-center gap-2 text-ink-2"><span className={`w-2.5 h-2.5 rounded-sm ${p.color}`} />{p.label} <b className="text-ink font-semibold">{p.n}</b></span>
                  ))}
                </div>
              </>
            );
          })()}
        </Card>
      )}

      {data.inventory && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <Stat label="Stock value" value={money(data.inventory.stockValue)} icon={<Boxes size={18} />} hint={data.inventory.tracking ? "Tracking on" : "Tracking off"} />
          <Link to="/business/reorder"><Stat alert={data.inventory.lowStock > 0} label="Low stock" value={data.inventory.lowStock} icon={<AlertTriangle size={18} />} hint="At or below reorder point" /></Link>
          <Link to="/business/inventory"><Stat alert={data.inventory.outOfStock > 0} label="Out of stock" value={data.inventory.outOfStock} icon={<Package size={18} />} /></Link>
          <Link to="/business/purchase-orders?status=sent"><Stat label="Open purchase orders" value={data.inventory.openPurchaseOrders} icon={<ClipboardList size={18} />} hint={money(data.inventory.openPurchaseValue)} /></Link>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="font-display text-lg font-bold text-ink">Recent orders</h2>
            <Link to="/business/orders" className="text-sm text-brand-text font-semibold hover:underline">View all</Link>
          </div>
          {data.recentOrders.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No orders yet. They'll show up here as soon as customers buy your products.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.recentOrders.map((o: any) => (
                <li key={o.id} className="px-5 py-3 flex items-center gap-3 text-sm hover:bg-raised">
                  <Link to={`/business/orders?open=${o.id}`} className="font-semibold text-brand-text hover:underline">{o.order_number}</Link>
                  <span className="text-gray-500 truncate flex-1">{o.business_name || o.customer_email}</span>
                  <StatusBadge status={o.status} />
                  <span className="font-semibold text-ink w-24 text-right">{money(o.total_amount)}</span>
                  <span className="text-gray-400 w-20 text-right">{dateOnly(o.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="px-5 py-4 border-b border-line">
            <h2 className="font-display text-lg font-bold text-ink">Top products, last 30 days</h2>
          </div>
          {data.topProducts.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No sales in the last 30 days.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.topProducts.map((p: any) => {
                const max = Math.max(...data.topProducts.map((x: any) => Number(x.revenue) || 0), 1);
                return (
                  <li key={p.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="flex-1 font-medium text-ink truncate">{p.title}</span>
                      <span className="text-ink-3">{Number(p.units).toLocaleString()} units</span>
                      <span className="font-semibold text-ink w-24 text-right">{money(p.revenue)}</span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-raised overflow-hidden"><div className="h-full rounded-full bg-brand/70" style={{ width: `${(Number(p.revenue) / max) * 100}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};
