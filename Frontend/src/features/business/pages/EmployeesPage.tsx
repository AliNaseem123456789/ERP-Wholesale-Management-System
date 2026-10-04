import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage, businessApi } from "../api/business.api";
import { hrApi, Employee, Department, EMPLOYMENT_TYPES } from "../api/hr.api";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Modal, Field, FilterTabs, Stat, money, dateOnly, inputCls, inputBase, btnPrimary, btnSecondary } from "../components/ui";

const todayStr = () => new Date().toISOString().slice(0, 10);
const blank = {
  first_name: "", last_name: "", email: "", phone: "", department_id: "", job_title: "", employment_type: "full_time", hire_date: todayStr(),
  date_of_birth: "", national_id: "", tax_number: "", address: "", emergency_contact_name: "", emergency_contact_phone: "", notes: "", user_id: "",
  pay_type: "salary", base_salary: "", hourly_rate: "", payment_method: "bank_transfer", bank_name: "", bank_account_number: "", bank_routing: "",
};
export type EmployeeFormValues = typeof blank;

export const toForm = (e: Employee): EmployeeFormValues => {
  const out: any = { ...blank };
  for (const k of Object.keys(blank)) {
    const v = (e as any)[k];
    out[k] = v === null || v === undefined ? "" : ["hire_date", "date_of_birth"].includes(k) ? String(v).slice(0, 10) : String(v);
  }
  return out;
};

/** Profile + pay form, used for new employees and on the employee page. */
export const EmployeeForm: React.FC<{ initial?: EmployeeFormValues; busy?: boolean; submitLabel: string; onSubmit: (v: Record<string, unknown>) => void; onCancel?: () => void }> = ({ initial, busy, submitLabel, onSubmit, onCancel }) => {
  const { companyId, can } = useBusiness();
  const [f, setF] = useState<EmployeeFormValues>(initial || blank);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<{ user: { id: number; email: string } }[]>([]);
  const set = (p: Partial<EmployeeFormValues>) => setF((x) => ({ ...x, ...p }));
  useEffect(() => {
    hrApi.departments(companyId!).then(setDepartments).catch(() => {});
    if (can("members.view")) businessApi.members(companyId!).then((r) => setMembers(r.data || [])).catch(() => {});
  }, [companyId]);
  const pay = can("payroll.manage");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { ...f };
    if (!pay) for (const k of ["pay_type", "base_salary", "hourly_rate", "payment_method", "bank_name", "bank_account_number", "bank_routing"]) delete body[k];
    for (const k of ["department_id", "user_id", "date_of_birth"]) if (body[k] === "") body[k] = null;
    onSubmit(body);
  };
  return (
    <form onSubmit={submit} className="space-y-5 text-sm">
      <section>
        <h3 className="font-bold mb-2">Person</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="First name *"><input required className={inputCls} value={f.first_name} onChange={(e) => set({ first_name: e.target.value })} /></Field>
          <Field label="Last name"><input className={inputCls} value={f.last_name} onChange={(e) => set({ last_name: e.target.value })} /></Field>
          <Field label="Email" hint="Payslips are emailed here"><input type="email" className={inputCls} value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Date of birth"><input type="date" className={inputCls} value={f.date_of_birth} onChange={(e) => set({ date_of_birth: e.target.value })} /></Field>
          <Field label="National ID"><input className={inputCls} value={f.national_id} onChange={(e) => set({ national_id: e.target.value })} /></Field>
          <div className="col-span-2 md:col-span-3"><Field label="Address"><input className={inputCls} value={f.address} onChange={(e) => set({ address: e.target.value })} /></Field></div>
          <Field label="Emergency contact"><input className={inputCls} value={f.emergency_contact_name} onChange={(e) => set({ emergency_contact_name: e.target.value })} /></Field>
          <Field label="Emergency phone"><input className={inputCls} value={f.emergency_contact_phone} onChange={(e) => set({ emergency_contact_phone: e.target.value })} /></Field>
        </div>
      </section>
      <section>
        <h3 className="font-bold mb-2">Job</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Job title"><input className={inputCls} value={f.job_title} onChange={(e) => set({ job_title: e.target.value })} /></Field>
          <Field label="Department">
            <select className={inputCls} value={f.department_id} onChange={(e) => set({ department_id: e.target.value })}>
              <option value="">None</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Employment type">
            <select className={inputCls} value={f.employment_type} onChange={(e) => set({ employment_type: e.target.value })}>
              {Object.entries(EMPLOYMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Hire date *"><input type="date" required className={inputCls} value={f.hire_date} onChange={(e) => set({ hire_date: e.target.value })} /></Field>
          {members.length > 0 && (
            <Field label="Staff login" hint="Lets them see payslips and request leave in My HR">
              <select className={inputCls} value={f.user_id} onChange={(e) => set({ user_id: e.target.value })}>
                <option value="">Not linked</option>
                {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.email}</option>)}
              </select>
            </Field>
          )}
          <Field label="Tax number"><input className={inputCls} value={f.tax_number} onChange={(e) => set({ tax_number: e.target.value })} /></Field>
        </div>
      </section>
      {pay && (
        <section>
          <h3 className="font-bold mb-2">Pay</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Paid">
              <select className={inputCls} value={f.pay_type} onChange={(e) => set({ pay_type: e.target.value })}>
                <option value="salary">Monthly salary</option>
                <option value="hourly">By the hour</option>
              </select>
            </Field>
            {f.pay_type === "salary"
              ? <Field label="Monthly salary"><input type="number" min="0" step="0.01" className={inputCls} value={f.base_salary} onChange={(e) => set({ base_salary: e.target.value })} /></Field>
              : <Field label="Hourly rate"><input type="number" min="0" step="0.01" className={inputCls} value={f.hourly_rate} onChange={(e) => set({ hourly_rate: e.target.value })} /></Field>}
            <Field label="Payment method">
              <select className={inputCls} value={f.payment_method} onChange={(e) => set({ payment_method: e.target.value })}>
                <option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="check">Check</option>
              </select>
            </Field>
            {f.payment_method === "bank_transfer" && (
              <>
                <Field label="Bank"><input className={inputCls} value={f.bank_name} onChange={(e) => set({ bank_name: e.target.value })} /></Field>
                <Field label="Account number / IBAN"><input className={inputCls} value={f.bank_account_number} onChange={(e) => set({ bank_account_number: e.target.value })} /></Field>
                <Field label="Branch / routing"><input className={inputCls} value={f.bank_routing} onChange={(e) => set({ bank_routing: e.target.value })} /></Field>
              </>
            )}
          </div>
        </section>
      )}
      <Field label="Notes"><textarea rows={2} className={inputCls} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>}
        <button disabled={busy} className={btnPrimary}>{submitLabel}</button>
      </div>
    </form>
  );
};

export const EmployeesPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const navigate = useNavigate();
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<{ data: Employee[]; summary: any } | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    hrApi.employees(companyId!, { status, search }).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, status, search]);
  useEffect(load, [load]);
  const create = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await hrApi.createEmployee(companyId!, body);
      toast.success(res.message);
      navigate(`/business/employees/${res.data.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const showPay = can("payroll.view");
  return (
    <div>
      <PageHeader title="Employees" subtitle="Your people, their jobs and pay"
        actions={can("hr.manage") && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus size={16} /> Add employee</button>} />
      {data && showPay && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Card className="p-3"><Stat label="Employees" value={data.summary.count} /></Card>
          {data.summary.monthly_salaries !== undefined && <Card className="p-3"><Stat label="Monthly salaries" value={money(data.summary.monthly_salaries)} /></Card>}
        </div>
      )}
      <Card className="p-3 mb-3 flex flex-wrap gap-2 items-center">
        <FilterTabs value={status} onChange={setStatus} options={[{ value: "active", label: "Active" }, { value: "terminated", label: "Former" }, { value: "all", label: "All" }]} />
        <div className="relative ml-auto"><Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" /><input className={`${inputBase} pl-8 w-60`} placeholder="Name, number, email, title" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </Card>
      <Card className="overflow-hidden">
        {!data ? <Spinner /> : data.data.length === 0 ? <EmptyState icon={<UsersRound size={36} />} title="No employees here" text="Add your team to track attendance and leave and run payroll." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Employee</th><th>Job</th><th>Department</th><th>Since</th>{showPay && <th className="text-right">Pay</th>}<th className="px-4">Status</th></tr></thead>
            <tbody>{data.data.map((e) => (
              <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-2"><Link to={`/business/employees/${e.id}`} className="font-semibold text-blue-700 hover:underline">{e.name}</Link><span className="block text-xs text-gray-400 font-mono">{e.employee_number}</span></td>
                <td>{e.job_title || "—"}<span className="block text-xs text-gray-400">{EMPLOYMENT_TYPES[e.employment_type]}</span></td>
                <td>{e.department?.name || "—"}</td>
                <td>{dateOnly(e.hire_date)}</td>
                {showPay && <td className="text-right font-mono">{e.pay_type === "hourly" ? `${money(e.hourly_rate)}/h` : `${money(e.base_salary)}/mo`}</td>}
                <td className="px-4"><StatusBadge status={e.status} />{e.termination_date && <span className="block text-xs text-gray-400">left {dateOnly(e.termination_date)}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {adding && (
        <Modal title="Add employee" onClose={() => setAdding(false)} wide>
          <EmployeeForm busy={busy} submitLabel="Add employee" onSubmit={create} onCancel={() => setAdding(false)} />
        </Modal>
      )}
    </div>
  );
};
