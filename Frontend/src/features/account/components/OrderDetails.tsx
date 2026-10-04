import React, { useState } from "react";
import { ChevronLeft, Printer, MapPin, Building2, FileText, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Order } from "../types/order.types";
import { documentsApi } from "../api/documents.api";
import { RequestReturnModal } from "./tabs/ReturnsTab";

interface OrderDetailProps {
  order: Order;
  onBack: () => void;
}

export const OrderDetail: React.FC<OrderDetailProps> = ({ order, onBack }) => {
  const [returning, setReturning] = useState(false);
  const money = (n: unknown) => `$${Number(n || 0).toFixed(2)}`;
  const paymentText = order.payment_method === "on_account" ? "On account (pay by the invoice due date)" : "Cash on delivery";
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-center print:hidden">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-500 hover:text-black font-bold transition-colors"
        >
          <ChevronLeft size={20} /> Back to Orders
        </button>
        <div className="flex flex-wrap gap-2">
          {order.invoices?.map((inv) => (
            <button
              key={inv.id}
              onClick={() => documentsApi.invoicePdf(inv.id, inv.invoice_number).catch((e) => toast.error(e.message))}
              className="flex items-center gap-2 border border-gray-300 px-4 py-2.5 rounded-xl font-bold text-gray-800 hover:bg-gray-50"
            >
              <FileText size={18} /> Invoice {inv.invoice_number}
            </button>
          ))}
          {order.status === "delivered" && (
            <button onClick={() => setReturning(true)} className="flex items-center gap-2 border border-gray-300 px-4 py-2.5 rounded-xl font-bold text-gray-800 hover:bg-gray-50">
              <Undo2 size={18} /> Request a return
            </button>
          )}
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 bg-black text-white px-6 py-2.5 rounded-xl font-bold hover:bg-gray-800 transition-all shadow-sm"
          >
            <Printer size={18} /> Print
          </button>
        </div>
      </div>
      {returning && (
        <RequestReturnModal
          orderId={order.id}
          orderNumber={order.order_number || `#${order.id}`}
          onClose={() => setReturning(false)}
          onDone={() => setReturning(false)}
        />
      )}
      <div className="bg-white border border-gray-200 rounded-[32px] overflow-hidden shadow-sm p-8 md:p-12 print:border-0 print:shadow-none">
        <div className="flex justify-between items-start mb-12">
          <div>
            <h1 className="text-4xl font-black text-gray-900 mb-2 tracking-tighter">
              ORDER
            </h1>
            <p className="font-mono text-gray-500 bg-gray-50 px-3 py-1 rounded-lg inline-block text-sm border border-gray-100">
              ORDER {order.order_number || `#${order.id}`}
            </p>
            {order.company && (
              <p className="text-sm text-gray-600 mt-2">
                Sold by <b>{order.company.name}</b>
              </p>
            )}
            {order.tracking_number && (
              <p className="text-sm text-gray-600 mt-1">
                Tracking: <b className="font-mono">{order.tracking_number}</b>
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-gray-400 uppercase tracking-widest text-[10px] font-black mb-1">
              Date Placed
            </p>
            <p className="font-bold text-lg">
              {new Date(order.created_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
          <div>
            <div className="flex items-center gap-2 text-blue-600 mb-4 print:text-black">
              <MapPin size={18} />
              <h3 className="font-black uppercase text-xs tracking-widest">
                Shipping Details
              </h3>
            </div>
            <div className="text-gray-600 space-y-1">
              <p className="font-bold text-gray-900 text-xl">
                {order.shipping_address?.full_name}
              </p>
              <p className="text-lg">{order.shipping_address?.address_line1}</p>
              {order.shipping_address?.address_line2 && (
                <p className="text-lg">
                  {order.shipping_address?.address_line2}
                </p>
              )}
              <p className="text-lg">
                {order.shipping_address?.city}, {order.shipping_address?.state}{" "}
                {order.shipping_address?.postal_code}
              </p>
              <p className="text-sm pt-4 font-medium flex items-center gap-2">
                <span className="text-gray-400 uppercase text-[10px] font-black">
                  Phone:
                </span>
                {order.shipping_address?.phone || "N/A"}
              </p>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 text-gray-400 mb-4 print:text-black">
              <Building2 size={18} />
              <h3 className="font-black uppercase text-xs tracking-widest">
                Business Info
              </h3>
            </div>
            <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 print:bg-white print:p-0 print:border-0">
              <p className="text-[10px] font-black uppercase text-gray-400 mb-1">
                Account Entity
              </p>
              <p className="font-bold text-gray-900 text-xl">
                {order.business_name || "Personal Purchase"}
              </p>
              <div className="mt-6 pt-4 border-t border-gray-200 flex justify-between items-center">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-tight">
                  Order Status
                </span>
                <span
                  className={`text-xs font-black uppercase px-3 py-1 rounded-full ${
                    order.status === "pending"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {order.status}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="border border-gray-100 rounded-[24px] overflow-hidden mb-8 print:border-gray-200">
          <table className="w-full text-left">
            <thead className="bg-gray-50 print:bg-gray-100">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-400 tracking-widest">
                  Description
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-400 text-center tracking-widest">
                  Qty
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-400 text-right tracking-widest">
                  Unit
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-400 text-right tracking-widest">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 print:divide-gray-200">
              {order.order_items.map((item, idx) => (
                <tr key={idx} className="group">
                  <td className="px-6 py-5">
                    <span className="font-bold text-gray-900 block">
                      {item.products?.title}
                    </span>
                    {item.flavor && (
                      <span className="inline-block mt-1 text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md uppercase font-black print:bg-transparent print:border print:border-blue-200">
                        {item.flavor}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-5 text-center font-bold text-gray-600">
                    {item.quantity}
                  </td>
                  <td className="px-6 py-5 text-right font-medium text-gray-500">
                    ${Number(item.price_at_time).toFixed(2)}
                  </td>
                  <td className="px-6 py-5 text-right font-black text-gray-900">
                    ${(item.price_at_time * item.quantity).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col items-end pt-6">
          <div className="w-full md:w-80 space-y-2">
            <div className="flex justify-between text-gray-500 px-2">
              <span className="text-sm font-bold uppercase tracking-tighter">Subtotal</span>
              <span className="font-mono font-bold">{money(order.subtotal_amount ?? Number(order.total_amount) - Number(order.shipping_amount || 0))}</span>
            </div>
            {Number(order.discount_amount) > 0 && (
              <div className="flex justify-between text-green-700 px-2">
                <span className="text-sm font-bold uppercase tracking-tighter">Discount{order.promo_code ? ` (${order.promo_code})` : ""}</span>
                <span className="font-mono font-bold">-{money(order.discount_amount)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-500 px-2">
              <span className="text-sm font-bold uppercase tracking-tighter">Shipping</span>
              <span className="font-mono font-bold">{money(order.shipping_amount)}</span>
            </div>
            {Number(order.tax_amount) > 0 && (
              <div className="flex justify-between text-gray-500 px-2">
                <span className="text-sm font-bold uppercase tracking-tighter">Tax</span>
                <span className="font-mono font-bold">{money(order.tax_amount)}</span>
              </div>
            )}
            {Number(order.excise_amount) > 0 && (
              <div className="flex justify-between text-gray-500 px-2">
                <span className="text-sm font-bold uppercase tracking-tighter">Tobacco excise tax</span>
                <span className="font-mono font-bold">{money(order.excise_amount)}</span>
              </div>
            )}
            <div className="flex justify-between items-center bg-gray-900 text-white p-6 rounded-2xl mt-4 print:bg-white print:text-black print:border-t-4 print:border-black print:rounded-none print:px-2">
              <div>
                <p className="text-[10px] font-black uppercase opacity-60">Order total</p>
                <p className="text-xs font-bold opacity-80">{paymentText}</p>
              </div>
              <span className="text-3xl font-black">{money(order.total_amount)}</span>
            </div>
          </div>
        </div>
        <div className="hidden print:block mt-20 text-center border-t border-gray-100 pt-10">
          <p className="text-gray-400 text-xs font-medium">
            Thank you for your business. For any questions about this order,
            please contact the seller.
          </p>
        </div>
      </div>
    </div>
  );
};
