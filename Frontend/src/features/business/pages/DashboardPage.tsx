import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DollarSign, ShoppingBag, Package, Users, Boxes, AlertTriangle, ClipboardList } from "lucide-react";
import { useBusiness } from "../context/BusinessContext";
import { businessApi, errorMessage } from "../api/business.api";
import { Card, PageHeader, Spinner, StatusBadge, money, dateOnly } from "../components/ui";

const Stat: React.FC<{ label: string; value: React.ReactNode; icon: React.ReactNode; hint?: string }> = ({ label, value, icon, hint }) => (
  <Card className="p-5">
    <div className="flex items-center justify-between text-gray-500">
      <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
      {icon}
    </div>
    <p className="text-3xl font-black text-gray-900 mt-2">{value}</p>
    {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
  </Card>
);

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
      <PageHeader title={`Welcome to ${company?.name}`} subtitle="Last 30 days at a glance" />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <Stat label="Revenue (30d)" value={money(data.last30Days.revenue)} icon={<DollarSign size={18} />} hint={`${data.last30Days.orders} orders`} />
        <Stat label="Open orders" value={open} icon={<ShoppingBag size={18} />} hint={`${data.ordersByStatus.pending || 0} awaiting confirmation`} />
        <Stat label="Active products" value={data.products.active} icon={<Package size={18} />} hint={data.products.inactive ? `${data.products.inactive} hidden` : undefined} />
        <Stat label="Team members" value={data.teamMembers} icon={<Users size={18} />} />
      </div>

      {data.inventory && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <Stat label="Stock value" value={money(data.inventory.stockValue)} icon={<Boxes size={18} />} hint={data.inventory.tracking ? "Tracking on" : "Tracking off"} />
          <Link to="/business/reorder"><Stat label="Low stock" value={data.inventory.lowStock} icon={<AlertTriangle size={18} />} hint="At or below reorder point" /></Link>
          <Link to="/business/inventory"><Stat label="Out of stock" value={data.inventory.outOfStock} icon={<Package size={18} />} /></Link>
          <Link to="/business/purchase-orders?status=sent"><Stat label="Open purchase orders" value={data.inventory.openPurchaseOrders} icon={<ClipboardList size={18} />} hint={money(data.inventory.openPurchaseValue)} /></Link>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900">Recent orders</h2>
            <Link to="/business/orders" className="text-sm text-blue-600 font-semibold hover:underline">View all</Link>
          </div>
          {data.recentOrders.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No orders yet. They'll show up here as soon as customers buy your products.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.recentOrders.map((o: any) => (
                <li key={o.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                  <Link to={`/business/orders?open=${o.id}`} className="font-mono font-bold text-blue-600">{o.order_number}</Link>
                  <span className="text-gray-500 truncate flex-1">{o.business_name || o.customer_email}</span>
                  <StatusBadge status={o.status} />
                  <span className="font-bold w-24 text-right">{money(o.total_amount)}</span>
                  <span className="text-gray-400 w-20 text-right">{dateOnly(o.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900">Top products (30d)</h2>
          </div>
          {data.topProducts.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No sales in the last 30 days.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.topProducts.map((p: any) => (
                <li key={p.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                  <span className="flex-1 font-semibold text-gray-900 truncate">{p.title}</span>
                  <span className="text-gray-500">{p.units} units</span>
                  <span className="font-bold w-24 text-right">{money(p.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};
