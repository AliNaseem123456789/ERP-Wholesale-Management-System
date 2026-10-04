import React from "react";
import { usePayments } from "../../../checkout/hooks/usePayment";
import {
  Loader2,
  CreditCard,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";

export const PaymentsTab: React.FC = () => {
  const { payments, loading } = usePayments();

  const getStatusStyle = (status: string) => {
    switch (status?.toLowerCase()) {
      case "completed":
      case "success":
        return "bg-green-100 text-green-700 border-green-200";
      case "pending":
        return "bg-amber-100 text-amber-700 border-amber-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  if (loading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );

  if (payments.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed">
        <CreditCard className="mx-auto text-gray-300 mb-4" size={48} />
        <h3 className="text-lg font-bold text-gray-900">No payment history</h3>
        <p className="text-gray-500">
          Your transaction records will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500">
                Order #
              </th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500">
                Date
              </th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500">
                Amount
              </th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500">
                Transaction ID
              </th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {payments.map((p) => (
              <tr
                key={p.id}
                className="hover:bg-gray-50 transition-colors text-sm"
              >
                <td className="px-6 py-4 font-bold text-blue-600">
                  #{p.order_id?.toString().padStart(5, "0")}
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {new Date(p.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 font-black text-gray-900">
                  ${Number(p.amount || 0).toFixed(2)}
                </td>
                <td className="px-6 py-4 font-mono text-gray-500 text-xs">
                  {p.transaction_id || "N/A"}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusStyle(p.status)}`}
                  >
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
