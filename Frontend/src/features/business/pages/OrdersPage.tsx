import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ShoppingBag, Search, Truck, ClipboardList, FileText, Undo2 } from "lucide-react";
import { salesApi, paymentLabel } from "../api/sales.api";
import { CreateReturnModal } from "./ReturnsPage";
import { useWarehouses, WarehouseSelect } from "../components/supply";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { businessApi, errorMessage, OrderStatus } from "../api/business.api";
import {
  Card, PageHeader, Spinner, EmptyState, StatusBadge, Pagination, Modal, Field,
  money, dateTime, inputCls, btnPrimary, btnSecondary, btnDanger, inputBase
} from "../components/ui";

const STATUSES = ["", "pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];
const ACTION_LABELS: Record<string, string> = {
  confirmed: "Confirm order",
  processing: "Start processing",
  shipped: "Mark as shipped",
  delivered: "Mark as delivered",
  cancelled: "Cancel order",
};

const OrderDetail: React.FC<{ orderId: number; onClose: () => void; onChanged: () => void }> = ({ orderId, onClose, onChanged }) => {
  const { companyId, can } = useBusiness();
  const [order, setOrder] = useState<any>(null);
  const [tracking, setTracking] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  const [returning, setReturning] = useState(false);

  const load = useCallback(async () => {
    const o = await businessApi.order(companyId!, orderId);
    setOrder(o);
    setTracking(o.tracking_number || "");
    setNotes(o.notes || "");
  }, [companyId, orderId]);

  useEffect(() => {
    load().catch((e) => toast.error(errorMessage(e)));
  }, [load]);

  const canDo = (status: string) =>
    can("orders.manage") || (["processing", "shipped", "delivered"].includes(status) && can("orders.fulfil"));

  const setStatus = async (status: OrderStatus) => {
    if (status === "cancelled" && !window.confirm("Cancel this order? The customer will be emailed.")) return;
    setBusy(true);
    try {
      const res = await businessApi.setOrderStatus(companyId!, orderId, {
        status, tracking_number: tracking || undefined, notes,
        ...(warehouseId ? { warehouse_id: Number(warehouseId) } : {}),
      } as any);
      toast.success(res.message);
      await load();
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const createInvoice = async () => {
    setBusy(true);
    try {
      toast.success((await salesApi.createInvoice(companyId!, orderId)).message);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveDetails = async () => {
    setBusy(true);
    try {
      const res = await businessApi.updateOrder(companyId!, orderId, { tracking_number: tracking, notes });
      toast.success(res.message);
      setOrder(res.data);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={order ? `Order ${order.order_number}` : "Order"} onClose={onClose} wide>
      {!order ? (
        <Spinner />
      ) : (
        <div className="space-y-6 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={order.status} />
            <span className="text-gray-500">Placed {dateTime(order.created_at)}</span>
            {order.shipped_at && <span className="text-gray-500">· Shipped {dateTime(order.shipped_at)}</span>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-[10px] font-bold uppercase text-gray-400 mb-1">Customer</p>
              <p className="font-bold text-gray-900">{order.business_name || order.customer?.business_name || "—"}</p>
              <p>{[order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ")}</p>
              <p className="text-gray-600">{order.customer?.email}</p>
              {order.customer?.phone && <p className="text-gray-600">{order.customer.phone}</p>}
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-[10px] font-bold uppercase text-gray-400 mb-1">Ship to</p>
              {order.shipping_address ? (
                <>
                  <p className="font-bold text-gray-900">{order.shipping_address.full_name}</p>
                  <p>{order.shipping_address.address_line1}</p>
                  {order.shipping_address.address_line2 && <p>{order.shipping_address.address_line2}</p>}
                  <p>
                    {order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.postal_code}
                  </p>
                  {order.shipping_address.phone && <p className="text-gray-600">{order.shipping_address.phone}</p>}
                </>
              ) : (
                <p className="text-gray-500">No address</p>
              )}
            </div>
          </div>

          <table className="w-full">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-400 border-b">
                <th className="py-2">Product</th>
                <th className="py-2">SKU</th>
                <th className="py-2 text-center">Qty</th>
                <th className="py-2 text-right">Price</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {order.order_items.map((i: any) => (
                <tr key={i.id}>
                  <td className="py-2 font-semibold text-gray-900">{i.products?.title}{i.flavor ? <span className="font-normal text-blue-700"> · {i.flavor}</span> : null}</td>
                  <td className="py-2 text-gray-500">{i.products?.sku || "—"}</td>
                  <td className="py-2 text-center">{i.quantity}</td>
                  <td className="py-2 text-right">{money(i.price_at_time)}</td>
                  <td className="py-2 text-right font-bold">{money(i.price_at_time * i.quantity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {order.subtotal_amount != null && (
                <tr>
                  <td colSpan={4} className="pt-3 text-right text-gray-500">Subtotal</td>
                  <td className="pt-3 text-right">{money(order.subtotal_amount)}</td>
                </tr>
              )}
              {Number(order.discount_amount) > 0 && (
                <tr>
                  <td colSpan={4} className="text-right text-gray-500">Discount{order.promo_code ? ` (${order.promo_code})` : ""}</td>
                  <td className="text-right">-{money(order.discount_amount)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={4} className="text-right text-gray-500">Shipping</td>
                <td className="text-right">{money(order.shipping_amount)}</td>
              </tr>
              {Number(order.tax_amount) > 0 && (
                <tr>
                  <td colSpan={4} className="text-right text-gray-500">Tax</td>
                  <td className="text-right">{money(order.tax_amount)}</td>
                </tr>
              )}
              {Number(order.excise_amount) > 0 && (
                <tr>
                  <td colSpan={4} className="text-right text-gray-500">Excise tax{order.compliance?.state ? ` (${order.compliance.state})` : ""}</td>
                  <td className="text-right">{money(order.excise_amount)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={4} className="text-right font-bold">Total</td>
                <td className="text-right text-lg font-black">{money(order.total_amount)}</td>
              </tr>
            </tfoot>
          </table>

          {order.compliance?.flags?.length > 0 && (
            <div className="bg-amber-50 text-amber-900 rounded-xl px-3 py-2 text-sm">
              {order.compliance.flags.map((f: string) => <p key={f}>⚠ {f}</p>)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 bg-gray-50 rounded-xl p-3">
            <span>
              Payment: <b>{paymentLabel(order.payment_method || "cash_on_delivery")}</b>
              {order.payment_method === "on_account" && order.payment_terms_days ? ` · Net ${order.payment_terms_days}` : ""}
            </span>
            {order.quote_id && <span className="text-gray-500">· from a quote</span>}
            {order.invoices?.map((i: any) => (
              <Link key={i.id} to={`/business/invoices?open=${i.id}`} className="inline-flex items-center gap-1 font-mono font-bold text-blue-600">
                <FileText size={14} /> {i.invoice_number} <StatusBadge status={i.status} />
              </Link>
            ))}
            {order.return_requests?.map((r: any) => (
              <Link key={r.id} to={`/business/returns?open=${r.id}`} className="inline-flex items-center gap-1 font-mono font-bold text-blue-600">
                <Undo2 size={14} /> {r.rma_number} <StatusBadge status={r.status} />
              </Link>
            ))}
            <span className="flex-1" />
            {can("invoices.manage") && !order.invoices?.length && order.status !== "cancelled" && (
              <button onClick={createInvoice} disabled={busy} className={btnSecondary}><FileText size={16} /> Create invoice</button>
            )}
            {can("returns.manage") && ["shipped", "delivered"].includes(order.status) && (
              <button onClick={() => setReturning(true)} className={btnSecondary}><Undo2 size={16} /> Start a return</button>
            )}
          </div>
          {returning && (
            <CreateReturnModal orderId={order.id} orderNumber={order.order_number} onClose={() => setReturning(false)} onCreated={() => { setReturning(false); load(); }} />
          )}

          {order.inventoryTracked && (
            <div className="flex flex-wrap items-end gap-3 bg-blue-50/60 border border-blue-100 rounded-xl p-3">
              {order.warehouse ? (
                <p className="text-sm">Fulfilled from <b>{order.warehouse.name} ({order.warehouse.code})</b>
                  {order.order_items.some((i: any) => i.reserved_quantity > 0) && " · stock reserved"}</p>
              ) : (
                <div className="w-64">
                  <Field label="Fulfil from warehouse">
                    <WarehouseSelect value={warehouseId || String(warehouses.find((w) => w.is_default)?.id || "")} onChange={setWarehouseId} warehouses={warehouses} />
                  </Field>
                </div>
              )}
              <span className="flex-1" />
              <Link to={`/business/orders/${order.id}/packing-slip`} className={btnSecondary}><ClipboardList size={16} /> Pick list &amp; packing slip</Link>
            </div>
          )}
          {!order.inventoryTracked && (
            <div className="flex justify-end">
              <Link to={`/business/orders/${order.id}/packing-slip`} className={btnSecondary}><ClipboardList size={16} /> Packing slip</Link>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Tracking number">
              <input className={inputCls} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Carrier tracking #" />
            </Field>
            <Field label="Internal notes">
              <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Only visible to your team" />
            </Field>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
            {(can("orders.manage") || can("orders.fulfil")) && (
              <button onClick={saveDetails} disabled={busy} className={btnSecondary}>Save details</button>
            )}
            <span className="flex-1" />
            {order.allowedTransitions.filter(canDo).map((s: OrderStatus) => (
              <button key={s} onClick={() => setStatus(s)} disabled={busy} className={s === "cancelled" ? btnDanger : btnPrimary}>
                {s === "shipped" && <Truck size={16} />} {ACTION_LABELS[s] || s}
              </button>
            ))}
          </div>
          {order.payment_history?.length > 0 && (
            <p className="text-xs text-gray-500">
              Payment status: {order.payment_history.map((p: any) => `${p.status} · ${money(p.amount)}`).join(", ")}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
};

export const OrdersPage: React.FC = () => {
  const { companyId } = useBusiness();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const openId = params.get("open");

  const load = useCallback(() => {
    if (!companyId) return;
    businessApi
      .orders(companyId, { page, status, search })
      .then(setData)
      .catch((e) => toast.error(errorMessage(e)));
  }, [companyId, page, status, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <PageHeader title="Orders" subtitle="Orders customers placed with your business" />
      <Card>
        <div className="flex flex-wrap gap-3 p-4 border-b border-gray-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              className={`${inputCls} pl-9`}
              placeholder="Search order #, customer email or business"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select className={`${inputBase} w-auto`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s ? s[0].toUpperCase() + s.slice(1) : "All statuses"}</option>
            ))}
          </select>
        </div>
        {!data ? (
          <Spinner />
        ) : data.orders.length === 0 ? (
          <EmptyState icon={<ShoppingBag size={40} />} title="No orders found" text={status || search ? "Try a different filter." : "New orders will appear here."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Items</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.orders.map((o: any) => (
                  <tr key={o.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setParams({ open: String(o.id) })}>
                    <td className="px-4 py-3 font-mono font-bold text-blue-600">{o.order_number}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{o.business_name || "—"}</p>
                      <p className="text-xs text-gray-500">{o.customer_email}</p>
                    </td>
                    <td className="px-4 py-3">{o.item_count}</td>
                    <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                    <td className="px-4 py-3 text-right font-bold">{money(o.total_amount)}</td>
                    <td className="px-4 py-3 text-gray-500">{dateTime(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={data.currentPage} totalPages={data.totalPages} onChange={setPage} />
          </div>
        )}
      </Card>
      {openId && <OrderDetail orderId={Number(openId)} onClose={() => setParams({})} onChanged={load} />}
    </div>
  );
};
