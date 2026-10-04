import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { salesApi } from "../api/sales.api";
import { Card, PageHeader, Spinner, EmptyState, Field, FilterTabs, Stat, money, inputCls, btnSecondary } from "../components/ui";

const iso = (d: Date) => d.toISOString().slice(0, 10);

const SalesReport: React.FC = () => {
  const { companyId } = useBusiness();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [groupBy, setGroupBy] = useState("day");
  const [data, setData] = useState<any>(null);
  const load = useCallback(() => {
    setData(null);
    salesApi.salesReport(companyId!, { from, to, group_by: groupBy }).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, from, to, groupBy]);
  useEffect(load, [load]);
  const max = Math.max(1, ...(data?.rows || []).map((r: any) => r.sales || 0));

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap gap-3 items-end no-print">
        <Field label="From"><input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Group by">
          <select className={inputCls} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="day">Day</option><option value="month">Month</option><option value="product">Product</option><option value="customer">Customer</option>
          </select>
        </Field>
        <span className="flex-1" />
        <button onClick={() => window.print()} className={btnSecondary}><Printer size={16} /> Print</button>
      </Card>
      {!data ? <Spinner /> : (
        <div className="print-area space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Orders" value={data.summary.orders} />
            <Stat label="Revenue (incl. tax & shipping)" value={money(data.summary.revenue)} />
            <Stat label="Net sales" value={money(data.summary.net_sales)} />
            <Stat label="Customers" value={data.summary.customers} />
            <Stat label="Discounts given" value={money(data.summary.discounts)} />
            <Stat label="Tax collected" value={money(data.summary.tax)} />
            <Stat label="Shipping charged" value={money(data.summary.shipping)} />
            <Stat label="Average order" value={money(data.summary.orders ? data.summary.revenue / data.summary.orders : 0)} />
          </div>
          <Card>
            {data.rows.length === 0 ? <EmptyState title="No sales in this period" /> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                  <th className="px-4 py-3">{groupBy === "product" ? "Product" : groupBy === "customer" ? "Customer" : groupBy === "month" ? "Month" : "Day"}</th>
                  {groupBy === "product" && <th className="px-4 py-3 text-right">Units</th>}
                  <th className="px-4 py-3 text-right">Orders</th>
                  <th className="px-4 py-3 text-right">Sales</th>
                  {groupBy === "product" && <><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">Margin</th></>}
                  <th className="px-4 py-3 w-1/4 no-print" />
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {data.rows.map((r: any) => (
                    <tr key={String(r.key)}>
                      <td className="px-4 py-2 font-semibold">{r.label || r.key}{r.email && r.email !== r.label && <span className="text-xs text-gray-400 ml-1">{r.email}</span>}</td>
                      {groupBy === "product" && <td className="px-4 py-2 text-right">{r.units}</td>}
                      <td className="px-4 py-2 text-right">{r.orders}</td>
                      <td className="px-4 py-2 text-right font-bold">{money(r.sales)}</td>
                      {groupBy === "product" && <><td className="px-4 py-2 text-right text-gray-500">{money(r.cost)}</td><td className={`px-4 py-2 text-right ${r.margin < 0 ? "text-red-600" : "text-green-700"}`}>{money(r.margin)}{r.sales ? <span className="text-xs text-gray-400 ml-1">{Math.round((r.margin / r.sales) * 100)}%</span> : null}</td></>}
                      <td className="px-4 py-2 no-print"><div className="h-2 rounded bg-blue-500" style={{ width: `${Math.max(2, (r.sales / max) * 100)}%` }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {groupBy === "product" && <p className="text-xs text-gray-500">Margin uses each product's current average cost.</p>}
        </div>
      )}
    </div>
  );
};

const ArAging: React.FC = () => {
  const { companyId } = useBusiness();
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    salesApi.arAging(companyId!).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId]);
  if (!data) return <Spinner />;
  const cols: [string, string][] = [["current", "Not yet due"], ["d1_30", "1–30 days"], ["d31_60", "31–60"], ["d61_90", "61–90"], ["d90_plus", "90+"], ["total", "Total"]];
  return (
    <Card>
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm text-gray-600">Unpaid invoice balances by how late they are, as of {data.as_of}.</p>
        <button onClick={() => window.print()} className={`${btnSecondary} no-print`}><Printer size={16} /> Print</button>
      </div>
      {data.data.length === 0 ? <EmptyState title="Nobody owes you anything right now" /> : (
        <div className="overflow-x-auto print-area">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Customer</th>{cols.map(([k, l]) => <th key={k} className="px-4 py-3 text-right">{l}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {data.data.map((r: any) => (
                <tr key={String(r.user_id)}>
                  <td className="px-4 py-2"><Link to={`/business/invoices?search=${encodeURIComponent(r.email || "")}`} className="font-semibold hover:text-blue-600">{r.customer}</Link><p className="text-xs text-gray-400">{r.invoices} open invoice{r.invoices > 1 ? "s" : ""}</p></td>
                  {cols.map(([k]) => <td key={k} className={`px-4 py-2 text-right ${k === "total" ? "font-bold" : ""} ${["d31_60", "d61_90", "d90_plus"].includes(k) && r[k] > 0 ? "text-red-600 font-semibold" : ""}`}>{r[k] ? money(r[k]) : "—"}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-gray-50 font-bold"><td className="px-4 py-2">Total</td>{cols.map(([k]) => <td key={k} className="px-4 py-2 text-right">{money(data.totals[k])}</td>)}</tr></tfoot>
          </table>
        </div>
      )}
    </Card>
  );
};

export const SalesReportsPage: React.FC = () => {
  const { can } = useBusiness();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || (can("reports.view") ? "sales" : "aging");
  return (
    <div>
      <PageHeader title="Sales reports" subtitle="Sales, margins and who owes you money" />
      <div className="mb-4 no-print">
        <FilterTabs value={tab} onChange={(v) => setParams({ tab: v })} options={[...(can("reports.view") ? [{ value: "sales", label: "Sales" }] : []), { value: "aging", label: "Receivables aging" }]} />
      </div>
      {tab === "aging" ? <ArAging /> : <SalesReport />}
    </div>
  );
};
