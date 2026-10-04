import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Check, X, Ban, Plane } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { hrApi, Employee, LeaveType } from "../api/hr.api";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Modal, Field, FilterTabs, dateOnly, inputCls, inputBase, btnPrimary, btnSecondary } from "../components/ui";

const todayStr = () => new Date().toISOString().slice(0, 10);

/** Leave request form: HR picks the employee; self-service passes none. */
export const LeaveForm: React.FC<{ employees?: Employee[]; employeeId?: string; types: LeaveType[]; canApprove?: boolean; onSubmit: (body: Record<string, unknown>) => Promise<void>; onCancel: () => void }> = ({ employees, employeeId, types, canApprove, onSubmit, onCancel }) => {
  const [f, setF] = useState({ employee_id: employeeId || "", leave_type_id: String(types[0]?.id || ""), start_date: todayStr(), end_date: todayStr(), half_day: false, reason: "", approve: !!canApprove });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit({ ...f, end_date: f.half_day ? f.start_date : f.end_date, employee_id: employees ? f.employee_id : undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      {employees && (
        <Field label="Employee">
          <select required className={inputCls} value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}>
            <option value="">Choose an employee</option>
            {employees.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.employee_number})</option>)}
          </select>
        </Field>
      )}
      <Field label="Type of leave">
        <select required className={inputCls} value={f.leave_type_id} onChange={(e) => setF({ ...f, leave_type_id: e.target.value })}>
          {types.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}{t.paid ? "" : " (unpaid)"}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From"><input type="date" required className={inputCls} value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: e.target.value > f.end_date ? e.target.value : f.end_date })} /></Field>
        <Field label="To"><input type="date" required disabled={f.half_day} className={inputCls} value={f.half_day ? f.start_date : f.end_date} min={f.start_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={f.half_day} onChange={(e) => setF({ ...f, half_day: e.target.checked })} /> Half day</label>
      <Field label="Reason"><input className={inputCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      {canApprove && <label className="flex items-center gap-2"><input type="checkbox" checked={f.approve} onChange={(e) => setF({ ...f, approve: e.target.checked })} /> Approve it now</label>}
      <p className="text-xs text-gray-400">Weekends and company holidays aren't counted.</p>
      <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button><button disabled={busy} className={btnPrimary}>{canApprove && f.approve ? "Book leave" : "Request leave"}</button></div>
    </form>
  );
};

const Balances: React.FC = () => {
  const { companyId } = useBusiness();
  const [year, setYear] = useState(new Date().getFullYear());
  const [d, setD] = useState<any>(null);
  useEffect(() => { hrApi.leaveBalances(companyId!, year).then(setD).catch((e) => toast.error(errorMessage(e))); }, [companyId, year]);
  if (!d) return <Spinner />;
  const types = d.data[0]?.balances || [];
  return (
    <>
      <div className="flex items-center gap-2 mb-3 text-sm"><span>Year</span><input type="number" aria-label="Year" className={`${inputBase} w-24`} value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
      <Card className="overflow-x-auto">
        {d.data.length === 0 ? <EmptyState title="No active employees" /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Employee</th>{types.map((t: any) => <th key={t.leave_type_id} className="text-right px-3">{t.name}</th>)}</tr></thead>
            <tbody>{d.data.map((r: any) => (
              <tr key={r.employee.id} className="border-b border-gray-50">
                <td className="px-4 py-2 font-semibold">{r.employee.name}</td>
                {r.balances.map((b: any) => (
                  <td key={b.leave_type_id} className="text-right px-3">
                    {b.allowance ? <><b>{b.remaining}</b><span className="text-gray-400"> / {b.allowance}</span></> : <span>{b.taken} taken</span>}
                    {b.pending > 0 && <span className="block text-xs text-amber-700">{b.pending} pending</span>}
                  </td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
};

export const LeavePage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState("requests");
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState<any>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [adding, setAdding] = useState<string | null>(params.get("employee"));
  const load = useCallback(() => {
    hrApi.leave(companyId!, { status }).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, status]);
  useEffect(load, [load]);
  useEffect(() => {
    hrApi.leaveTypes(companyId!).then(setTypes).catch(() => {});
    hrApi.employees(companyId!, { status: "active" }).then((r) => setEmployees(r.data)).catch(() => {});
  }, [companyId]);
  const decide = async (id: number, action: "approve" | "reject" | "cancel") => {
    const notes = action === "reject" ? window.prompt("Reason for declining (optional)") ?? undefined : undefined;
    if (action === "cancel" && !window.confirm("Cancel this leave? Approved days are removed from attendance.")) return;
    try {
      toast.success((await hrApi.decideLeave(companyId!, id, action, notes || undefined)).message);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const closeAdd = () => { setAdding(null); if (params.get("employee")) { params.delete("employee"); setParams(params, { replace: true }); } };
  return (
    <div>
      <PageHeader title="Leave" subtitle="Requests, approvals and balances"
        actions={<button onClick={() => setAdding("")} className={btnPrimary}><Plus size={16} /> Book leave</button>} />
      <div className="mb-3"><FilterTabs value={tab} onChange={setTab} options={[{ value: "requests", label: "Requests", count: data?.pending }, { value: "balances", label: "Balances" }]} /></div>
      {tab === "balances" ? <Balances /> : (
        <>
          <div className="mb-3"><FilterTabs value={status} onChange={setStatus} options={[{ value: "pending", label: "Waiting" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Declined" }, { value: "cancelled", label: "Cancelled" }, { value: "", label: "All" }]} /></div>
          <Card className="overflow-hidden">
            {!data ? <Spinner /> : data.data.length === 0 ? <EmptyState icon={<Plane size={36} />} title="No leave requests here" /> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Employee</th><th>Leave</th><th>Dates</th><th className="text-right">Days</th><th>Reason</th><th>Status</th><th className="px-4 text-right">Actions</th></tr></thead>
                <tbody>{data.data.map((l: any) => (
                  <tr key={l.id} className="border-b border-gray-50">
                    <td className="px-4 py-2 font-semibold">{l.employee.name}</td>
                    <td>{l.leave_type.name}{!l.leave_type.paid && <span className="text-xs text-gray-400"> (unpaid)</span>}</td>
                    <td>{dateOnly(l.start_date)}{l.end_date !== l.start_date && ` – ${dateOnly(l.end_date)}`}{l.half_day && " (half day)"}</td>
                    <td className="text-right">{l.days}</td>
                    <td className="text-gray-500 max-w-48 truncate">{l.reason}{l.decision_notes && <span className="block text-xs">Note: {l.decision_notes}</span>}</td>
                    <td><StatusBadge status={l.status} /></td>
                    <td className="px-4 text-right whitespace-nowrap">
                      {l.status === "pending" && (
                        <>
                          <button onClick={() => decide(l.id, "approve")} className="inline-flex items-center gap-1 text-green-700 font-bold mr-3"><Check size={14} /> Approve</button>
                          <button onClick={() => decide(l.id, "reject")} className="inline-flex items-center gap-1 text-red-600 font-bold mr-3"><X size={14} /> Decline</button>
                        </>
                      )}
                      {["pending", "approved"].includes(l.status) && <button onClick={() => decide(l.id, "cancel")} className="inline-flex items-center gap-1 text-gray-500 font-semibold" aria-label="Cancel leave"><Ban size={14} /></button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>
        </>
      )}
      {adding !== null && types.length > 0 && (
        <Modal title="Book leave" onClose={closeAdd}>
          <LeaveForm employees={employees} employeeId={adding || undefined} types={types} canApprove={can("hr.leave") || can("hr.manage")} onCancel={closeAdd}
            onSubmit={async (body) => {
              try {
                toast.success((await hrApi.createLeave(companyId!, body)).message);
                closeAdd();
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
