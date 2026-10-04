import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, UserX, UserCheck, Download } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { openPdf } from "../api/sales.api";
import { hrApi, PayComponent, KIND_LABELS, describeComponent, EMPLOYMENT_TYPES } from "../api/hr.api";
import { EmployeeForm, toForm } from "./EmployeesPage";
import { Card, PageHeader, Spinner, StatusBadge, Modal, Field, FilterTabs, Stat, money, dateOnly, inputCls, inputBase, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

type Assign = { on: boolean; amount: string; percent: string; excluded: boolean };

const ComponentsTab: React.FC<{ employee: any; onSaved: () => void }> = ({ employee, onSaved }) => {
  const { companyId, can } = useBusiness();
  const [components, setComponents] = useState<PayComponent[] | null>(null);
  const [rows, setRows] = useState<Record<string, Assign>>({});
  useEffect(() => {
    hrApi.components(companyId!).then((list) => {
      setComponents(list.filter((c) => c.is_active));
      const map: Record<string, Assign> = {};
      for (const c of list) {
        const a = employee.pay_components?.find((x: any) => String(x.component_id) === String(c.id));
        map[c.id] = { on: a ? !a.excluded : c.applies_to_all, amount: a?.amount != null ? String(a.amount) : "", percent: a?.percent != null ? String(a.percent) : "", excluded: !!a?.excluded };
      }
      setRows(map);
    }).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, employee]);
  if (!components) return <Spinner />;
  const manage = can("payroll.manage");
  const save = async () => {
    const list = components.flatMap((c): Record<string, unknown>[] => {
      const r = rows[c.id];
      if (!r) return [];
      if (c.applies_to_all && !r.on) return [{ component_id: c.id, excluded: true }];
      if (!r.on) return [];
      if (c.applies_to_all && r.amount === "" && r.percent === "") return [];
      return [{ component_id: c.id, amount: r.amount === "" ? null : Number(r.amount), percent: r.percent === "" ? null : Number(r.percent) }];
    });
    try {
      toast.success((await hrApi.setComponents(companyId!, employee.id, list)).message);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Card className="p-5 text-sm">
      <p className="text-gray-500 mb-3">Tick what this person gets. Leave the amount blank to use the company default. Set up components in HR settings.</p>
      {components.length === 0 ? <p className="text-gray-500">No pay components yet. <Link to="/business/hr-settings?tab=components" className="text-blue-700 font-semibold">Add allowances and deductions</Link></p> : (
        <table className="w-full">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1 w-8" /><th>Component</th><th>Type</th><th>Default</th><th className="w-40">This employee</th></tr></thead>
          <tbody>{components.map((c) => {
            const r = rows[c.id] || { on: false, amount: "", percent: "", excluded: false };
            const pct = c.calc === "percent_base" || c.calc === "percent_gross";
            return (
              <tr key={c.id} className="border-b border-gray-50">
                <td className="py-2"><input type="checkbox" aria-label={`Apply ${c.name}`} disabled={!manage} checked={r.on} onChange={(e) => setRows({ ...rows, [c.id]: { ...r, on: e.target.checked } })} /></td>
                <td className="font-semibold">{c.name}{c.applies_to_all && <span className="ml-2 text-[10px] text-gray-400 font-normal">EVERYONE</span>}</td>
                <td className="text-gray-500">{KIND_LABELS[c.kind]}</td>
                <td className="text-gray-500">{describeComponent(c, money)}</td>
                <td>{c.calc !== "tax_table" && r.on && (
                  <input type="number" min="0" step="0.01" disabled={!manage} aria-label={`${c.name} ${pct ? "%" : "amount"}`} placeholder={pct ? `${c.percent}%` : String(c.amount)}
                    className={`${inputBase} w-32`} value={pct ? r.percent : r.amount} onChange={(e) => setRows({ ...rows, [c.id]: { ...r, [pct ? "percent" : "amount"]: e.target.value } })} />
                )}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      {manage && components.length > 0 && <div className="flex justify-end mt-3"><button onClick={save} className={btnPrimary}>Save pay components</button></div>}
    </Card>
  );
};

export const EmployeeDetailPage: React.FC = () => {
  const { id } = useParams();
  const { companyId, can } = useBusiness();
  const [e, setE] = useState<any>(null);
  const [tab, setTab] = useState("profile");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<{ date: string; reason: string } | null>(null);
  const load = useCallback(() => { hrApi.employee(companyId!, id!).then(setE).catch((err) => toast.error(errorMessage(err))); }, [companyId, id]);
  useEffect(load, [load]);
  if (!e) return <Spinner />;
  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      toast.success((await hrApi.updateEmployee(companyId!, e.id, body)).message);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const act = async (fn: () => Promise<any>) => {
    try {
      toast.success((await fn()).message);
      setLeaving(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const manage = can("hr.manage");
  const tabs = [{ value: "profile", label: "Profile" }, ...(can("payroll.view") ? [{ value: "pay", label: "Pay components" }, { value: "payslips", label: "Payslips" }] : []), { value: "leave", label: "Leave" }];
  return (
    <div>
      <Link to="/business/employees" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-3"><ArrowLeft size={16} /> Employees</Link>
      <PageHeader title={e.name} subtitle={`${e.employee_number} · ${e.job_title || "No job title"}${e.department ? ` · ${e.department.name}` : ""} · ${EMPLOYMENT_TYPES[e.employment_type]}`}
        actions={manage && (e.status === "active"
          ? <button onClick={() => setLeaving({ date: new Date().toISOString().slice(0, 10), reason: "" })} className={btnDanger}><UserX size={16} /> Mark as left</button>
          : <button onClick={() => act(() => hrApi.reinstate(companyId!, e.id))} className={btnSecondary}><UserCheck size={16} /> Reinstate</button>)} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="p-3"><p className="text-[10px] uppercase font-bold text-gray-400">Status</p><div className="mt-1"><StatusBadge status={e.status} /></div></Card>
        <Card className="p-3"><Stat label="Hired" value={dateOnly(e.hire_date)} /></Card>
        {e.termination_date && <Card className="p-3"><Stat label="Last day" value={dateOnly(e.termination_date)} /></Card>}
        {e.base_salary !== undefined && <Card className="p-3"><Stat label={e.pay_type === "hourly" ? "Hourly rate" : "Monthly salary"} value={money(e.pay_type === "hourly" ? e.hourly_rate : e.base_salary)} /></Card>}
        {e.user && <Card className="p-3"><Stat label="Staff login" value={<span className="text-sm">{e.user.email}</span>} /></Card>}
      </div>
      <div className="mb-3"><FilterTabs value={tab} onChange={setTab} options={tabs} /></div>
      {tab === "profile" && (
        <Card className="p-5">
          {manage ? <EmployeeForm key={e.updated_at} initial={toForm(e)} busy={busy} submitLabel="Save changes" onSubmit={save} /> : (
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {[["Email", e.email], ["Phone", e.phone], ["Date of birth", dateOnly(e.date_of_birth)], ["Address", e.address], ["Emergency contact", [e.emergency_contact_name, e.emergency_contact_phone].filter(Boolean).join(" · ")]].map(([k, v]) => (
                <div key={k as string}><dt className="text-[10px] uppercase font-bold text-gray-400">{k}</dt><dd>{v || "—"}</dd></div>
              ))}
            </dl>
          )}
        </Card>
      )}
      {tab === "pay" && <ComponentsTab employee={e} onSaved={load} />}
      {tab === "payslips" && (
        <Card className="overflow-hidden">
          {e.payslips.length === 0 ? <p className="p-5 text-sm text-gray-500">No payslips yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Period</th><th>Payroll</th><th>Status</th><th className="text-right">Gross</th><th className="text-right">Net</th><th className="w-16" /></tr></thead>
              <tbody>{e.payslips.map((p: any) => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="px-4 py-2">{dateOnly(p.run.period_start)} – {dateOnly(p.run.period_end)}</td><td className="font-mono">{p.run.run_number}</td><td><StatusBadge status={p.run.status} /></td>
                  <td className="text-right">{money(p.gross)}</td><td className="text-right font-bold">{money(p.net)}</td>
                  <td className="text-right pr-4"><button onClick={() => openPdf(`/company/payroll/payslips/${p.id}/pdf`, { "X-Company-Id": companyId! }).catch((err) => toast.error(err.message))} className="text-gray-500 hover:text-blue-700" aria-label="Payslip PDF"><Download size={15} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "leave" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {e.leave_balances.map((b: any) => (
              <Card key={b.leave_type_id} className="p-3"><Stat label={b.name} value={b.allowance ? `${b.remaining} of ${b.allowance} left` : `${b.taken} taken`} /></Card>
            ))}
          </div>
          <Card className="overflow-hidden">
            {e.leave_requests.length === 0 ? <p className="p-5 text-sm text-gray-500">No leave requests.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Dates</th><th>Type</th><th>Days</th><th className="px-4">Status</th></tr></thead>
                <tbody>{e.leave_requests.map((l: any) => (
                  <tr key={l.id} className="border-b border-gray-50"><td className="px-4 py-2">{dateOnly(l.start_date)}{l.end_date !== l.start_date && ` – ${dateOnly(l.end_date)}`}</td><td>{l.leave_type.name}</td><td>{l.days}</td><td className="px-4"><StatusBadge status={l.status} /></td></tr>
                ))}</tbody>
              </table>
            )}
          </Card>
          {can("hr.leave") && <Link to={`/business/leave?employee=${e.id}`} className="text-sm font-bold text-blue-700">Book leave →</Link>}
        </div>
      )}
      {leaving && (
        <Modal title={`${e.name} is leaving`} onClose={() => setLeaving(null)}>
          <div className="space-y-3 text-sm">
            <p className="text-gray-500">They're paid up to and including their last day, and drop off later payrolls.</p>
            <Field label="Last working day"><input type="date" className={inputCls} value={leaving.date} onChange={(ev) => setLeaving({ ...leaving, date: ev.target.value })} /></Field>
            <Field label="Reason (optional)"><input className={inputCls} value={leaving.reason} onChange={(ev) => setLeaving({ ...leaving, reason: ev.target.value })} /></Field>
            <div className="flex justify-end gap-2"><button onClick={() => setLeaving(null)} className={btnSecondary}>Cancel</button><button onClick={() => act(() => hrApi.terminate(companyId!, e.id, { termination_date: leaving.date, reason: leaving.reason }))} className={btnDanger}>Confirm</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
};
