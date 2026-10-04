import React, { useEffect, useState } from "react";
import { fetchCreditHistory } from "../../api/credit.api";
import { Wallet, Loader2, ArrowUpRight, ArrowDownLeft } from "lucide-react";
export const CreditTab = () => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCreditHistory()
      .then((data) => setHistory(data))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const totalCredit = history.reduce(
    (acc, curr) => acc + Number(curr.amount),
    0,
  );
  if (loading)
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin text-blue-600" />
      </div>
    );
  return (
    <div className="space-y-8">
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-3xl p-8 text-white shadow-xl shadow-blue-100 flex justify-between items-center">
        <div>
          <p className="text-blue-100 text-sm font-bold uppercase tracking-wider">
            Available Store Credit
          </p>
          <h2 className="text-5xl font-black mt-2">
            ${totalCredit.toFixed(2)}
          </h2>
        </div>
        <div className="bg-white/10 p-4 rounded-2xl backdrop-blur-md">
          <Wallet size={40} className="text-blue-100" />
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-50">
          <h3 className="font-bold text-gray-900">Transaction History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50/50 text-gray-500 font-bold uppercase text-[10px] tracking-widest">
              <tr>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Reason</th>
                <th className="px-6 py-4 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map((item) => (
                <tr
                  key={item.id}
                  className="hover:bg-gray-50/50 transition-colors group"
                >
                  <td className="px-6 py-4">
                    <span
                      className={`px-3 py-1 rounded-full font-bold text-[10px] ${
                        item.status === "APPROVED"
                          ? "bg-green-50 text-green-600"
                          : "bg-amber-50 text-amber-600"
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-900">{item.reason}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(item.created_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td
                    className={`px-6 py-4 text-right font-black text-lg ${
                      item.amount >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {item.amount >= 0 ? "+" : ""}$
                    {Math.abs(item.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.length === 0 && (
            <div className="p-20 text-center text-gray-400 font-medium">
              No credit history found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
