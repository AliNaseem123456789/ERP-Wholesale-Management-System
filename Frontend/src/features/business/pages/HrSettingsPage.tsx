import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { hrApi, Department, PayComponent, LeaveType, PayrollSettings, KIND_LABELS, CALC_LABELS, DAY_NAMES, describeComponent } from "../api/hr.api";
import { useAccounts, useAccountingSettings, AccountSelect } from "../components/accounting";
import { Card, PageHeader, Spinner, EmptyState, Modal, Field, FilterTabs, StatusBadge, money, dateOnly, inputCls, inputBase, btnPrimary, btnSecondary } from "../components/ui";

const run = async (fn: () => Promise<any>, after: () => void) => {
  try {
    toast.success((await fn()).message);
    after();
  } catch (err) {
    toast.error(errorMessage(err));
  }
};

const DepartmentsTab: React.FC = () => {
  const { companyId } = useBusiness();
  const [rows, setRows] = useState<Department[] | null>(null);
  const [edit, setEdit] = useState<Partial<Department> | null>(null);
  const load = useCallback(() => { hrApi.departments(companyId!).then(setRows).catch((e) => toast.error(errorMessage(e))); }, [companyId]);
  useEffect(load, [load]);
  if (!rows) return <Spinner />;
  return (
    <>
      <div className="flex justify-end mb-3"><button onClick={() => setEdit({ name: "", code: "", is_active: true })} className={btnPrimary}><Plus size={16} /> Department</button></div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? <EmptyState title="No departments yet" /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Department</th><th>Code</th><th className="text-right">Employees</th><th>Status</th><th className="w-20" /></tr></thead>
            <tbody>{rows.map((d) => (
              <tr key={d.id} className="border-b border-gray-50">
                <td className="px-4 py-2 font-semibold">{d.name}</td><td className="font-mono">{d.code}</td><td className="text-right">{d.employee_count}</td><td><StatusBadge status={d.is_active ? "active" : "inactive"} /></td>
                <td className="text-right pr-4 space-x-2">
                  <button onClick={() => setEdit(d)} className="text-gray-400 hover:text-blue-700" aria-label={`Edit ${d.name}`}><Pencil size={14} /></button>
                  {!d.employee_count && <button onClick={() => window.confirm(`Delete ${d.name}?`) && run(() => hrApi.deleteDepartment(companyId!, d.id), load)} className="text-gray-400 hover:text-red-600" aria-label={`Delete ${d.name}`}><Trash2 size={14} /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : "New department"} onClose={() => setEdit(null)}>
          <form onSubmit={(e) => { e.preventDefault(); const body = { name: edit.name, code: edit.code, is_active: edit.is_active }; run(() => (edit.id ? hrApi.updateDepartment(companyId!, edit.id, body) : hrApi.createDepartment(companyId!, body)), () => { setEdit(null); load(); }); }} className="space-y-3 text-sm">
            <Field label="Name"><input required className={inputCls} value={edit.name || ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Code"><input className={inputCls} value={edit.code || ""} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            {edit.id && <label className="flex items-center gap-2"><input type="checkbox" checked={!!edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Active</label>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setEdit(null)} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Save</button></div>
          </form>
        </Modal>
      )}
    </>
  );
};

const CALCS_FOR: Record<string, string[]> = { earning: ["fixed", "percent_base"], deduction: ["fixed", "percent_base", "percent_gross", "tax_table"], employer: ["fixed", "percent_base", "percent_gross"] };
const ComponentsTab: React.FC = () => {
  const { companyId, can } = useBusiness();
  const { settings } = useAccountingSettings();
  const { accounts } = useAccounts();
  const [rows, setRows] = useState<PayComponent[] | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const load = useCallback(() => { hrApi.components(companyId!).then(setRows).catch((e) => toast.error(errorMessage(e))); }, [companyId]);
  useEffect(load, [load]);
  if (!rows) return <Spinner />;
  const manage = can("payroll.manage");
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...edit, amount: Number(edit.amount || 0), percent: Number(edit.percent || 0), account_id: edit.account_id ? Number(edit.account_id) : null };
    delete body.id; delete body.assigned; delete body.created_at; delete body.updated_at; delete body.company_id;
    run(() => (edit.id ? hrApi.updateComponent(companyId!, edit.id, body) : hrApi.createComponent(companyId!, body)), () => { setEdit(null); load(); });
  };
  return (
    <>
      <p className="text-sm text-gray-500 mb-3">Allowances are added to pay, deductions are withheld from it, and employer contributions are costs on top (pension, social security). "Everyone" components apply to all employees unless excluded on their page; others are switched on per employee.</p>
      {manage && <div className="flex justify-end mb-3"><button onClick={() => setEdit({ code: "", name: "", kind: "earning", calc: "fixed", amount: "", percent: "", taxable: true, applies_to_all: false, is_active: true, account_id: "" })} className={btnPrimary}><Plus size={16} /> Pay component</button></div>}
      <Card className="overflow-hidden">
        {rows.length === 0 ? <EmptyState title="No pay components yet" text="Add allowances (house rent, transport), deductions (income tax, pension, loans) and employer contributions." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Component</th><th>Type</th><th>Calculation</th><th>Applies to</th><th /><th className="w-10" /></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} className={`border-b border-gray-50 ${c.is_active ? "" : "opacity-50"}`}>
                <td className="px-4 py-2"><span className="font-semibold">{c.name}</span> <span className="font-mono text-xs text-gray-400">{c.code}</span></td>
                <td>{KIND_LABELS[c.kind]}</td>
                <td>{describeComponent(c, money)}</td>
                <td>{c.applies_to_all ? "Everyone" : `${c.assigned || 0} employee(s)`}</td>
                <td className="text-xs text-gray-500">{c.kind === "earning" && (c.taxable ? "taxable" : "not taxable")}</td>
                <td className="pr-4">{manage && <button onClick={() => setEdit({ ...c, account_id: c.account_id ? String(c.account_id) : "" })} className="text-gray-400 hover:text-blue-700" aria-label={`Edit ${c.name}`}><Pencil size={14} /></button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : "New pay component"} onClose={() => setEdit(null)}>
          <form onSubmit={save} className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Code"><input required className={inputCls} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} placeholder="HRA" /></Field>
              <div className="col-span-2"><Field label="Name (on payslips)"><input required className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select className={inputCls} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value, calc: "fixed", account_id: "" })}>
                  {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Calculation">
                <select className={inputCls} value={edit.calc} onChange={(e) => setEdit({ ...edit, calc: e.target.value })}>
                  {CALCS_FOR[edit.kind].map((k) => <option key={k} value={k}>{CALC_LABELS[k]}</option>)}
                </select>
              </Field>
            </div>
            {edit.calc === "fixed" && <Field label="Monthly amount" hint={edit.kind === "earning" ? "Pro-rated for joiners, leavers and unpaid days" : undefined}><input type="number" min="0" step="0.01" className={inputCls} value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} /></Field>}
            {(edit.calc === "percent_base" || edit.calc === "percent_gross") && <Field label="Percent"><input type="number" min="0" max="100" step="0.01" className={inputCls} value={edit.percent} onChange={(e) => setEdit({ ...edit, percent: e.target.value })} /></Field>}
            {edit.calc === "tax_table" && <p className="bg-gray-50 rounded-lg px-3 py-2 text-gray-600">Worked out from the tax brackets in Payroll settings: taxable pay x 12, taxed progressively, divided by 12.</p>}
            <label className="flex items-center gap-2"><input type="checkbox" checked={edit.applies_to_all} onChange={(e) => setEdit({ ...edit, applies_to_all: e.target.checked })} /> Applies to everyone</label>
            {edit.kind === "earning" && <label className="flex items-center gap-2"><input type="checkbox" checked={edit.taxable} onChange={(e) => setEdit({ ...edit, taxable: e.target.checked })} /> Taxable</label>}
            {edit.id && <label className="flex items-center gap-2"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Active</label>}
            {settings?.enabled && (
              <Field label="Post to account (optional)" hint={edit.kind === "earning" ? "Default: Salaries & wages" : "Default: Payroll liabilities"}>
                <AccountSelect accounts={accounts} filter={(a) => (edit.kind === "earning" ? a.type === "expense" : a.type === "liability" && a.system_key !== "wages_payable")} value={edit.account_id} onChange={(v) => setEdit({ ...edit, account_id: v })} placeholder="Default" />
              </Field>
            )}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setEdit(null)} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Save</button></div>
          </form>
        </Modal>
      )}
    </>
  );
};

const LeaveTypesTab: React.FC = () => {
  const { companyId } = useBusiness();
  const [rows, setRows] = useState<LeaveType[] | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const load = useCallback(() => { hrApi.leaveTypes(companyId!).then(setRows).catch((e) => toast.error(errorMessage(e))); }, [companyId]);
  useEffect(load, [load]);
  if (!rows) return <Spinner />;
  return (
    <>
      <div className="flex justify-end mb-3"><button onClick={() => setEdit({ name: "", paid: true, annual_days: "", is_active: true })} className={btnPrimary}><Plus size={16} /> Leave type</button></div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Leave type</th><th>Paid</th><th className="text-right">Days per year</th><th>Status</th><th className="w-10" /></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id} className="border-b border-gray-50">
              <td className="px-4 py-2 font-semibold">{t.name}</td><td>{t.paid ? "Paid" : "Unpaid"}</td><td className="text-right">{Number(t.annual_days) || "No limit"}</td><td><StatusBadge status={t.is_active ? "active" : "inactive"} /></td>
              <td className="pr-4"><button onClick={() => setEdit({ ...t })} className="text-gray-400 hover:text-blue-700" aria-label={`Edit ${t.name}`}><Pencil size={14} /></button></td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : "New leave type"} onClose={() => setEdit(null)}>
          <form onSubmit={(e) => { e.preventDefault(); const body = { name: edit.name, paid: edit.paid, annual_days: Number(edit.annual_days || 0), is_active: edit.is_active }; run(() => (edit.id ? hrApi.updateLeaveType(companyId!, edit.id, body) : hrApi.createLeaveType(companyId!, body)), () => { setEdit(null); load(); }); }} className="space-y-3 text-sm">
            <Field label="Name"><input required className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Days per year" hint="0 = no fixed allowance"><input type="number" min="0" step="0.5" className={inputCls} value={edit.annual_days} onChange={(e) => setEdit({ ...edit, annual_days: e.target.value })} /></Field>
            <label className="flex items-center gap-2"><input type="checkbox" checked={edit.paid} onChange={(e) => setEdit({ ...edit, paid: e.target.checked })} /> Paid leave</label>
            {edit.id && <label className="flex items-center gap-2"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Active</label>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setEdit(null)} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Save</button></div>
          </form>
        </Modal>
      )}
    </>
  );
};

const HolidaysTab: React.FC = () => {
  const { companyId } = useBusiness();
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<any[] | null>(null);
  const [f, setF] = useState({ holiday_date: "", name: "" });
  const load = useCallback(() => { hrApi.holidays(companyId!, year).then(setRows).catch((e) => toast.error(errorMessage(e))); }, [companyId, year]);
  useEffect(load, [load]);
  return (
    <>
      <Card className="p-3 mb-3">
        <form onSubmit={(e) => { e.preventDefault(); run(() => hrApi.createHoliday(companyId!, f), () => { setF({ holiday_date: "", name: "" }); load(); }); }} className="flex flex-wrap gap-2 items-end text-sm">
          <Field label="Date"><input type="date" required className={inputBase} value={f.holiday_date} onChange={(e) => setF({ ...f, holiday_date: e.target.value })} /></Field>
          <Field label="Holiday"><input required className={`${inputBase} w-64`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Independence Day" /></Field>
          <button className={btnPrimary}><Plus size={16} /> Add</button>
          <span className="flex-1" />
          <Field label="Year"><input type="number" className={`${inputBase} w-24`} value={year} onChange={(e) => setYear(Number(e.target.value))} /></Field>
        </form>
      </Card>
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : rows.length === 0 ? <EmptyState title={`No holidays in ${year}`} text="Holidays aren't counted as working days for pay or leave." /> : rows.map((h) => (
          <div key={h.id} className="flex items-center gap-4 px-4 py-2 border-b border-gray-50 text-sm">
            <span className="w-32">{dateOnly(h.holiday_date)}</span><span className="font-semibold flex-1">{h.name}</span>
            <button onClick={() => run(() => hrApi.deleteHoliday(companyId!, h.id), load)} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${h.name}`}><Trash2 size={14} /></button>
          </div>
        ))}
      </Card>
    </>
  );
};

const PayrollSettingsTab: React.FC = () => {
  const { companyId, can } = useBusiness();
  const [s, setS] = useState<PayrollSettings | null>(null);
  const [brackets, setBrackets] = useState<{ upTo: string; rate: string }[]>([]);
  useEffect(() => {
    hrApi.settings(companyId!).then((x) => { setS(x); setBrackets(x.taxBrackets.map((b) => ({ upTo: b.upTo === null ? "" : String(b.upTo), rate: String(b.rate) }))); }).catch((e) => toast.error(errorMessage(e)));
  }, [companyId]);
  if (!s) return <Spinner />;
  const manage = can("payroll.manage");
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => hrApi.saveSettings(companyId!, { ...s, taxBrackets: brackets.map((b) => ({ upTo: b.upTo === "" ? null : Number(b.upTo), rate: Number(b.rate || 0) })) }), () => {});
  };
  return (
    <Card className="p-5 max-w-2xl">
      <form onSubmit={save} className="space-y-4 text-sm">
        <div>
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Working days</p>
          <div className="flex flex-wrap gap-2">
            {DAY_NAMES.map((d, i) => (
              <label key={d} className={`px-3 py-1.5 rounded-lg border cursor-pointer ${s.workDays.includes(i) ? "bg-blue-50 border-blue-300 text-blue-800 font-semibold" : "border-gray-200 text-gray-500"}`}>
                <input type="checkbox" className="sr-only" disabled={!manage} checked={s.workDays.includes(i)} onChange={(e) => setS({ ...s, workDays: e.target.checked ? [...s.workDays, i].sort() : s.workDays.filter((x) => x !== i) })} />{d}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours per day"><input type="number" min="1" max="24" step="0.5" disabled={!manage} className={inputCls} value={s.hoursPerDay} onChange={(e) => setS({ ...s, hoursPerDay: Number(e.target.value) })} /></Field>
          <Field label="Overtime rate (x hourly pay)"><input type="number" min="1" max="5" step="0.25" disabled={!manage} className={inputCls} value={s.overtimeMultiplier} onChange={(e) => setS({ ...s, overtimeMultiplier: Number(e.target.value) })} /></Field>
        </div>
        <div>
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Income-tax brackets (yearly taxable income)</p>
          <p className="text-gray-500 mb-2">Used by a deduction with the "Income-tax table" calculation. Each rate applies to the income inside its bracket.</p>
          <table className="w-full max-w-md">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400"><th>From</th><th>Up to</th><th>Rate %</th><th /></tr></thead>
            <tbody>{brackets.map((b, i) => (
              <tr key={i}>
                <td className="py-1 pr-2 text-gray-500">{i === 0 ? "0" : brackets[i - 1].upTo || "—"}</td>
                <td className="pr-2"><input type="number" aria-label={`Bracket ${i + 1} up to`} disabled={!manage} className={`${inputBase} w-32`} placeholder="and above" value={b.upTo} onChange={(e) => setBrackets(brackets.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))} /></td>
                <td className="pr-2"><input type="number" aria-label={`Bracket ${i + 1} rate`} min="0" max="100" step="0.01" disabled={!manage} className={`${inputBase} w-20`} value={b.rate} onChange={(e) => setBrackets(brackets.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} /></td>
                <td>{manage && <button type="button" onClick={() => setBrackets(brackets.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove bracket"><Trash2 size={14} /></button>}</td>
              </tr>
            ))}</tbody>
          </table>
          {manage && <button type="button" onClick={() => setBrackets([...brackets, { upTo: "", rate: "" }])} className="text-blue-700 text-xs font-bold mt-1">+ Add bracket</button>}
        </div>
        <Field label="Note printed on payslips"><input disabled={!manage} className={inputCls} value={s.payslipNotes} onChange={(e) => setS({ ...s, payslipNotes: e.target.value })} /></Field>
        {manage && <div className="flex justify-end"><button className={btnPrimary}>Save payroll settings</button></div>}
      </form>
    </Card>
  );
};

export const HrSettingsPage: React.FC = () => {
  const { can } = useBusiness();
  const [params, setParams] = useSearchParams();
  const tabs = [
    ...(can("hr.manage") ? [{ value: "departments", label: "Departments" }] : []),
    ...(can("payroll.view") || can("payroll.manage") ? [{ value: "components", label: "Pay components" }, { value: "payroll", label: "Payroll settings" }] : []),
    ...(can("hr.manage") ? [{ value: "leave", label: "Leave types" }, { value: "holidays", label: "Holidays" }] : []),
  ];
  const tab = params.get("tab") || tabs[0]?.value;
  return (
    <div>
      <PageHeader title="HR settings" subtitle="Departments, pay components, leave types, holidays and payroll rules" />
      <div className="mb-4"><FilterTabs value={tab} onChange={(v) => setParams({ tab: v })} options={tabs} /></div>
      {tab === "departments" && <DepartmentsTab />}
      {tab === "components" && <ComponentsTab />}
      {tab === "payroll" && <PayrollSettingsTab />}
      {tab === "leave" && <LeaveTypesTab />}
      {tab === "holidays" && <HolidaysTab />}
    </div>
  );
};
