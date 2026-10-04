import React, { useState } from "react";
import { Package, Clock, CheckCircle2, Eye } from "lucide-react";
import { useOrders } from "../../hooks/useOrders";
import { OrderDetail } from "../OrderDetails";
import { Order } from "../../types/order.types";

export const OrdersTab = () => {
  const { orders, loading } = useOrders();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  if (loading)
    return (
      <div className="p-10 text-center font-medium text-gray-500">
        Loading your orders...
      </div>
    );

  if (orders.length === 0)
    return (
      <div className="p-20 text-center bg-gray-50 rounded-3xl border-2 border-dashed">
        <Package className="mx-auto text-gray-400 mb-4" size={48} />
        <p className="text-gray-500 font-medium">
          You haven't placed any orders yet.
        </p>
      </div>
    );

  if (selectedOrder)
    return (
      <OrderDetail
        order={selectedOrder}
        onBack={() => setSelectedOrder(null)}
      />
    );

  return (
    <div className="bg-white border border-gray-200 rounded-[32px] overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50/50 border-b border-gray-100">
              <th className="px-6 py-5 text-[10px] font-black uppercase text-gray-400 tracking-widest">
                Order #
              </th>
              <th className="px-6 py-5 text-[10px] font-black uppercase text-gray-400 tracking-widest">
                Date
              </th>
              <th className="px-6 py-5 text-[10px] font-black uppercase text-gray-400 tracking-widest">
                Seller
              </th>
              <th className="px-6 py-5 text-[10px] font-black uppercase text-gray-400 tracking-widest">
                Status
              </th>
              <th className="px-6 py-5 text-[10px] font-black uppercase text-gray-400 tracking-widest text-right">
                Total
              </th>
              <th className="px-6 py-5 text-[10px] font-black uppercase text-gray-400 tracking-widest text-center">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {orders.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                onView={() => setSelectedOrder(order)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const OrderRow = ({ order, onView }: { order: Order; onView: () => void }) => (
  <tr className="hover:bg-blue-50/30 transition-colors group">
    <td className="px-6 py-5 font-mono text-xs font-bold text-blue-600">
      {order.order_number || `#${order.id}`}
    </td>
    <td className="px-6 py-5 text-sm font-medium text-gray-600">
      {order.created_at ? new Date(order.created_at).toLocaleDateString() : 'N/A'}
    </td>
    <td className="px-6 py-5 text-sm font-bold text-gray-900">
      {order.company?.name || "—"}
    </td>
    <td className="px-6 py-5">
      <span
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase ${
          order.status === "pending"
            ? "bg-amber-100 text-amber-700"
            : "bg-green-100 text-green-700"
        }`}
      >
        {order.status === "pending" ? (
          <Clock size={12} />
        ) : (
          <CheckCircle2 size={12} />
        )}
        {order.status}
      </span>
    </td>
    <td className="px-6 py-5 text-right font-black text-gray-900">
      ${Number(order.total_amount).toFixed(2)}
    </td>
    <td className="px-6 py-5">
      <div className="flex justify-center gap-2">
        <button
          onClick={onView}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-900 rounded-xl text-xs font-black hover:bg-black hover:text-white transition-all"
        >
          <Eye size={14} /> VIEW
        </button>
      </div>
    </td>
  </tr>
);