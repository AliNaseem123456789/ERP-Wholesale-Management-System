import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ClipboardList, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { supplyApi, PO_STATUS_LABEL } from "../api/supply.api";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Pagination, money, dateOnly, inputBase, inputCls, btnPrimary } from "../components/ui";

export const PurchaseOrdersPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);

  const load = useCallback(() => {
    supplyApi.purchaseOrders(companyId!, { status, search, page }).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, status, search, page]);
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        subtitle="Stock you've ordered from suppliers"
        actions={can("purchasing.manage") && <Link to="/business/purchase-orders/new" className={btnPrimary}><Plus size={16} /> New purchase order</Link>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 p-4 border-b border-gray-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input className={`${inputCls} pl-9`} placeholder="Search PO #, supplier or reference" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <select className={`${inputBase} w-auto`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {Object.entries(PO_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {!data ? <Spinner /> : data.data.length === 0 ? (
          <EmptyState icon={<ClipboardList size={40} />} title="No purchase orders" text={status || search ? "Try a different filter." : "Create one to order stock from a supplier."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                <th className="px-4 py-3">PO</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Deliver to</th>
                <th className="px-4 py-3">Ordered</th><th className="px-4 py-3">Expected</th><th className="px-4 py-3 text-right">Received</th>
                <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {data.data.map((po: any) => (
                  <tr key={po.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => navigate(`/business/purchase-orders/${po.id}`)}>
                    <td className="px-4 py-3 font-mono font-bold text-blue-600">{po.po_number}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{po.supplier_name}</td>
                    <td className="px-4 py-3">{po.warehouse_code}</td>
                    <td className="px-4 py-3 text-gray-500">{dateOnly(po.order_date)}</td>
                    <td className="px-4 py-3 text-gray-500">{dateOnly(po.expected_date)}</td>
                    <td className="px-4 py-3 text-right">{po.units_received}/{po.units_ordered}</td>
                    <td className="px-4 py-3"><StatusBadge status={po.status} /></td>
                    <td className="px-4 py-3 text-right font-bold">{money(po.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={data.currentPage} totalPages={data.totalPages} onChange={setPage} />
          </div>
        )}
      </Card>
    </div>
  );
};
