import React, { useCallback, useEffect, useState } from "react";
import { Plus, Download, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { openPdf } from "../api/sales.api";
import { hrApi, EMPLOYMENT_TYPES } from "../api/hr.api";
import { LeaveForm } from "./LeavePage";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Modal, Stat, money, dateOnly, btnPrimary } from "../components/ui";

export const MyHrPage: React.FC = () => {
  const { companyId } = useBusiness();
  const [d, setD] = useState<any>(undefined);
  const [asking, setAsking] = useState(false);
  const load = useCallback(() => { hrApi.me(companyId!).then(setD).catch((e) => { toast.error(errorMessage(e)); setD(null); }); }, [companyId]);
  useEffect(load, [load]);
  if (d === undefined) return <Spinner />;
  if (!d) return (
    <div>
      <PageHeader title="My HR" />
      <Card><EmptyState icon={<UserRound size={36} />} title="Your login isn't linked to an employee record" text="Ask HR to link it on your employee page. Then your payslips and leave appear here." /></Card>
    </div>
  );
  const e = d.employee;
  const cancel = async (id: number) => {
    try {
      toast.success((await hrApi.myLeaveCancel(companyId!, id)).message);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div>
      <PageHeader title="My HR" subtitle={`${e.name} · ${e.employee_number}${e.job_title ? ` · ${e.job_title}` : ""}${e.department ? ` · ${e.department.name}` : ""}`}
        actions={e.status === "active" && <button onClick={() => setAsking(true)} className={btnPrimary}><Plus size={16} /> Request leave</button>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {d.leave_balances.map((b: any) => (
          <Card key={b.leave_type_id} className="p-3"><Stat label={b.name} value={b.allowance ? `${b.remaining} days left` : `${b.taken} days taken`} />{b.pending > 0 && <p className="text-xs text-amber-700">{b.pending} waiting for approval</p>}</Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="overflow-hidden">
          <h3 className="font-bold px-4 pt-4 pb-2">Payslips</h3>
          {d.payslips.length === 0 ? <p className="px-4 pb-4 text-sm text-gray-500">No payslips yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Period</th><th className="text-right">Gross</th><th className="text-right">Net</th><th className="w-12" /></tr></thead>
              <tbody>{d.payslips.map((p: any) => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="px-4 py-2">{dateOnly(p.run.period_start)} – {dateOnly(p.run.period_end)}<span className="block text-xs text-gray-400">{p.run.status === "paid" ? "Paid" : "Approved"} · {dateOnly(p.run.pay_date)}</span></td>
                  <td className="text-right">{money(p.gross)}</td><td className="text-right font-bold">{money(p.net)}</td>
                  <td className="text-right pr-4"><button onClick={() => openPdf(`/company/me/hr/payslips/${p.id}/pdf`, { "X-Company-Id": companyId! }).catch((err) => toast.error(err.message))} className="text-gray-500 hover:text-blue-700" aria-label="Download payslip"><Download size={15} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
        <Card className="overflow-hidden">
          <h3 className="font-bold px-4 pt-4 pb-2">My leave</h3>
          {d.leave_requests.length === 0 ? <p className="px-4 pb-4 text-sm text-gray-500">No leave requests yet.</p> : (
            <table className="w-full text-sm">
              <tbody>{d.leave_requests.map((l: any) => (
                <tr key={l.id} className="border-b border-gray-50">
                  <td className="px-4 py-2">{l.leave_type.name}<span className="block text-xs text-gray-400">{dateOnly(l.start_date)}{l.end_date !== l.start_date && ` – ${dateOnly(l.end_date)}`} · {l.days} day(s)</span>{l.decision_notes && <span className="block text-xs text-gray-500">Note: {l.decision_notes}</span>}</td>
                  <td><StatusBadge status={l.status} /></td>
                  <td className="text-right pr-4">{l.status === "pending" && <button onClick={() => cancel(l.id)} className="text-xs font-bold text-gray-500 hover:text-red-600">Withdraw</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      </div>
      <Card className="p-4 mt-4 text-sm text-gray-600">
        Hired {dateOnly(e.hire_date)} · {EMPLOYMENT_TYPES[e.employment_type]}{e.bank_account_last4 ? ` · Paid to ${e.bank_name || "bank"} ****${e.bank_account_last4}` : ""}. Something wrong? Contact HR.
      </Card>
      {asking && (
        <Modal title="Request leave" onClose={() => setAsking(false)}>
          <LeaveForm types={d.leave_types} onCancel={() => setAsking(false)}
            onSubmit={async (body) => {
              try {
                toast.success((await hrApi.myLeave(companyId!, body)).message);
                setAsking(false);
                load();
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }} />
        </Modal>
      )}
    </div>
  );
};
