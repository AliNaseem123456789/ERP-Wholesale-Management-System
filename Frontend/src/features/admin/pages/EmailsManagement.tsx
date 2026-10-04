import React, { useEffect, useState } from "react";
import { Send, RotateCcw, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { adminService } from "../api/admin.service";
import { errorMessage } from "../../business/api/business.api";
import { Card, Spinner, StatusBadge, inputCls, btnPrimary, dateTime, inputBase } from "../../business/components/ui";
import { useAuth } from "../../auth/context/AuthContext";

export const EmailsManagement: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [to, setTo] = useState(user?.email || "");
  const [sending, setSending] = useState(false);

  const load = () => adminService.getEmails(status).then(setData).catch((e) => toast.error(errorMessage(e)));
  useEffect(() => {
    load();
  }, [status]);

  const test = async () => {
    setSending(true);
    try {
      const res = await adminService.sendTestEmail(to);
      res.data?.status === "sent" ? toast.success(res.message) : toast.error(res.message);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const retry = async (id: number) => {
    try {
      await adminService.retryEmail(id);
      toast.success("Retried");
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-black text-gray-900">Emails</h2>
      {data && (
        <div className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm border ${data.smtp.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-900"}`}>
          {data.smtp.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span className="flex-1">
            {data.smtp.ok ? data.smtp.message : `Emails are not being sent: ${data.smtp.message}. Set SMTP_HOST, SMTP_USER and SMTP_PASS on the server.`}
          </span>
        </div>
      )}
      <Card className="p-4 flex flex-wrap gap-3 items-center">
        <input className={`${inputBase} w-72`} value={to} onChange={(e) => setTo(e.target.value)} placeholder="Send a test email to..." />
        <button onClick={test} disabled={sending || !to} className={btnPrimary}><Send size={16} /> {sending ? "Sending..." : "Send test email"}</button>
        <span className="flex-1" />
        <select className={`${inputBase} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All emails</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
      </Card>
      <Card>
        {!data ? (
          <Spinner />
        ) : data.data.length === 0 ? (
          <p className="p-8 text-center text-gray-500">No emails yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">To</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.data.map((m: any) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateTime(m.created_at)}</td>
                    <td className="px-4 py-3">{m.to_email}</td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{m.subject}</p>
                      {m.last_error && <p className="text-xs text-red-500">{m.last_error}</p>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={m.status === "sent" ? "completed" : m.status === "failed" ? "cancelled" : "pending"} /> <span className="text-xs text-gray-400">{m.status}</span></td>
                    <td className="px-4 py-3 text-right">
                      {m.status === "failed" && (
                        <button onClick={() => retry(m.id)} className="text-xs font-bold text-blue-600 hover:underline inline-flex items-center gap-1"><RotateCcw size={12} /> Retry</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
