import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, CheckCircle2, Banknote, Mail, Ban, Undo2, Download, AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { openPdf } from "../api/sales.api";
import { hrApi } from "../api/hr.api";
import { isMoneyAccount } from "../api/accounting.api";
import { useAccounts, useAccountingSettings, AccountSelect } from "../components/accounting";
import { Card, PageHeader, Spinner, StatusBadge, Modal, Field, Stat, money, dateOnly, inputCls, inputBase, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

type Adj = { kind: "earning" | "deduction"; name: string; amount: string; taxable: boolean };

const SlipModal: React.FC<{ run: any; slip: any; onClose: () => void; onChanged: (run: any) => void }> = ({ run, slip, onClose, onChanged }) => {
  const { companyId, can } = useBusiness();
  const editable = run.status === "draft" && can("payroll.manage");
  const [adj, setAdj] = useState<Adj[]>(slip.lines.filter((l: any) => l.is_manual).map((l: any) => ({ kind: l.kind, name: l.name, amount: String(l.amount), taxable: l.taxable })));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const res = await hrApi.adjust(companyId!, slip.id, adj.filter((a) => a.name && Number(a.amount) > 0).map((a) => ({ ...a, amount: Number(a.amount) })));
      toast.success(res.message);
      onChanged(res.data);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const section = (kind: string, title: string) => {
    const lines = slip.lines.filter((l: any) => l.kind === kind);
    return (
      <div>
        <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">{title}</p>
        {lines.length === 0 ? <p className="text-gray-400">None</p> : lines.map((l: any) => (
          <div key={l.id} className="flex justify-between py-1 border-b border-gray-50">
            <span>{l.name}{l.is_manual && <span className="ml-1 text-[10px] text-amber-700 font-bold">ONE-OFF</span>}</span>
            <span className={`font-mono ${l.amount < 0 ? "text-red-700" : ""}`}>{money(l.amount)}</span>
          </div>
        ))}
      </div>
    );
  };
  return (
    <Modal title={`${slip.employee.name} · ${slip.payslip_number}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        {slip.warnings?.length > 0 && <div className="bg-amber-50 text-amber-900 rounded-lg px-3 py-2">{slip.warnings.map((w: string) => <p key={w}>{w}</p>)}</div>}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Stat label="Working days" value={slip.working_days} />
          <Stat label="Paid days" value={slip.paid_days} />
          <Stat label="Unpaid days" value={slip.unpaid_days} tone={slip.unpaid_days > 0 ? "warn" : "default"} />
          <Stat label="Hours" value={slip.hours_worked} />
          <Stat label="Overtime h" value={slip.overtime_hours} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">{section("earning", "Earnings")}<div className="flex justify-between font-bold"><span>Gross</span><span className="font-mono">{money(slip.gross)}</span></div></div>
          <div className="space-y-4">{section("deduction", "Deductions")}<div className="flex justify-between font-bold"><span>Total deductions</span><span className="font-mono">{money(slip.total_deductions)}</span></div>{section("employer", "Employer contributions (not deducted)")}</div>
        </div>
        <div className="flex justify-between bg-green-50 rounded-xl px-4 py-3 text-lg font-black text-green-800"><span>Net pay</span><span>{money(slip.net)}</span></div>
        {editable && (
          <div className="border-t border-gray-100 pt-3">
            <p className="font-bold mb-2">One-off lines (bonus, commission, advance repayment...)</p>
            {adj.map((a, i) => (
              <div key={i} className="flex flex-wrap gap-2 mb-2 items-center">
                <select aria-label="Line type" className={`${inputBase} w-36`} value={a.kind} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, kind: e.target.value as Adj["kind"] } : x)))}>
                  <option value="earning">Add to pay</option><option value="deduction">Deduct</option>
                </select>
                <input aria-label="Line description" className={`${inputBase} flex-1 min-w-40`} placeholder="Description" value={a.name} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input aria-label="Line amount" type="number" min="0" step="0.01" className={`${inputBase} w-28`} placeholder="Amount" value={a.amount} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                {a.kind === "earning" && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={a.taxable} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, taxable: e.target.checked } : x)))} /> taxable</label>}
                <button onClick={() => setAdj(adj.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove line"><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="flex justify-between">
              <button onClick={() => setAdj([...adj, { kind: "earning", name: "", amount: "", taxable: true }])} className="text-blue-700 text-xs font-bold">+ Add line</button>
              <button disabled={busy} onClick={save} className={btnPrimary}>Save & recalculate</button>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          {["approved", "paid"].includes(run.status) && slip.employee.email && can("payroll.manage") && (
            <button onClick={() => hrApi.emailRun(companyId!, run.id, slip.id).then((r) => toast.success(r.message)).catch((e) => toast.error(errorMessage(e)))} className={btnSecondary}><Mail size={16} /> Email</button>
          )}
          <button onClick={() => openPdf(`/company/payroll/payslips/${slip.id}/pdf`, { "X-Company-Id": companyId! }).catch((e) => toast.error(e.message))} className={btnSecondary}><Download size={16} /> PDF</button>
        </div>
      </div>
    </Modal>
  );
};

const PayModal: React.FC<{ run: any; onClose: () => void; onDone: (r: any) => void }> = ({ run, onClose, onDone }) => {
  const { companyId } = useBusiness();
  const { settings } = useAccountingSettings();
  const { accounts } = useAccounts();
  const [f, setF] = useState({ account_id: "", paid_at: String(run.pay_date).slice(0, 10), reference: "", email_payslips: true });
  useEffect(() => { if (!f.account_id && accounts.length) setF((x) => ({ ...x, account_id: String(accounts.find((a) => a.system_key === "bank")?.id || "") })); }, [accounts]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await hrApi.pay(companyId!, run.id, { ...f, account_id: f.account_id ? Number(f.account_id) : undefined });
      toast.success(res.message);
      onDone(res.data);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal title={`Pay ${money(run.total_net)} to ${run.employee_count} employee(s)`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <p className="text-gray-500">Record that salaries were paid (bank transfer batch, cash or checks).</p>
        <div className="grid grid-cols-2 gap-3">
          {settings?.enabled && <Field label="Paid from"><AccountSelect accounts={accounts} filter={isMoneyAccount} value={f.account_id} onChange={(v) => setF({ ...f, account_id: v })} required ariaLabel="Paid from" /></Field>}
          <Field label="Date paid"><input type="date" className={inputCls} value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} /></Field>
        </div>
        <Field label="Reference"><input className={inputCls} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Bank batch number" /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.email_payslips} onChange={(e) => setF({ ...f, email_payslips: e.target.checked })} /> Email each employee their payslip (PDF)</label>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Mark as paid</button></div>
      </form>
    </Modal>
  );
};

export const PayrollRunPage: React.FC = () => {
  const { id } = useParams();
  const { companyId, can } = useBusiness();
  const [run, setRun] = useState<any>(null);
  const [slipId, setSlipId] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const load = useCallback(() => { hrApi.run(companyId!, id!).then(setRun).catch((e) => toast.error(errorMessage(e))); }, [companyId, id]);
  useEffect(load, [load]);
  if (!run) return <Spinner />;
  const act = async (fn: () => Promise<any>, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    try {
      const res = await fn();
      toast.success(res.message);
      if (res.data) setRun(res.data);
      else load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const manage = can("payroll.manage");
  const payer = can("payroll.pay") || manage;
  const slip = run.payslips.find((p: any) => p.id === slipId);
  return (
    <div>
      <Link to="/business/payroll" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-3"><ArrowLeft size={16} /> Payroll</Link>
      <PageHeader title={`Payroll ${run.run_number}`} subtitle={`${dateOnly(run.period_start)} – ${dateOnly(run.period_end)} · pay date ${dateOnly(run.paid_at || run.pay_date)}`}
        actions={<>
          {run.status === "draft" && manage && <button onClick={() => act(() => hrApi.recalc(companyId!, run.id))} className={btnSecondary}><RefreshCw size={16} /> Recalculate</button>}
          {run.status === "draft" && manage && <button onClick={() => act(() => hrApi.approve(companyId!, run.id), "Approve this payroll? Payslips are locked and the payroll is posted to the books.")} className={btnPrimary}><CheckCircle2 size={16} /> Approve</button>}
          {run.status === "approved" && payer && <button onClick={() => setPaying(true)} className={btnPrimary}><Banknote size={16} /> Mark as paid</button>}
          {["approved", "paid"].includes(run.status) && payer && <button onClick={() => act(() => hrApi.emailRun(companyId!, run.id))} className={btnSecondary}><Mail size={16} /> Email payslips</button>}
          {run.status === "paid" && payer && <button onClick={() => act(() => hrApi.unpay(companyId!, run.id), "Undo the payment? The payment entry is reversed.")} className={btnSecondary}><Undo2 size={16} /> Undo payment</button>}
          {["draft", "approved"].includes(run.status) && manage && <button onClick={() => act(() => hrApi.voidRun(companyId!, run.id), "Void this payroll?")} className={btnDanger}><Ban size={16} /> Void</button>}
        </>} />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Card className="p-3"><p className="text-[10px] uppercase font-bold text-gray-400">Status</p><div className="mt-1"><StatusBadge status={run.status} /></div></Card>
        <Card className="p-3"><Stat label="Gross pay" value={money(run.total_gross)} /></Card>
        <Card className="p-3"><Stat label="Deductions" value={money(run.total_deductions)} /></Card>
        <Card className="p-3"><Stat label="Net to pay" value={money(run.total_net)} tone="good" /></Card>
        <Card className="p-3"><Stat label="Employer cost" value={money(run.total_employer)} /></Card>
      </div>
      {run.warnings.length > 0 && (
        <Card className="p-3 mb-4 bg-amber-50 border-amber-200 text-sm text-amber-900">
          <p className="font-bold flex items-center gap-2 mb-1"><AlertTriangle size={16} /> Check before approving</p>
          {run.warnings.map((w: any) => <p key={w.payslip_id}><button className="underline font-semibold" onClick={() => setSlipId(w.payslip_id)}>{w.employee}</button>: {w.warnings.join(" ")}</p>)}
        </Card>
      )}
      <Card className="overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Employee</th><th className="text-right">Paid days</th><th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net</th><th className="text-right pr-4">Employer</th></tr></thead>
          <tbody>{run.payslips.map((p: any) => (
            <tr key={p.id} onClick={() => setSlipId(p.id)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
              <td className="px-4 py-2"><span className="font-semibold">{p.employee.name}</span>{p.warnings?.length > 0 && <AlertTriangle size={13} className="inline ml-1 text-amber-600" />}<span className="block text-xs text-gray-400 font-mono">{p.employee.employee_number}</span></td>
              <td className="text-right">{p.paid_days} / {p.working_days}</td>
              <td className="text-right">{money(p.gross)}</td><td className="text-right">{money(p.total_deductions)}</td>
              <td className="text-right font-bold">{money(p.net)}</td><td className="text-right pr-4 text-gray-500">{money(p.employer_total)}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr className="font-bold"><td className="px-4 py-2">Total</td><td /><td className="text-right">{money(run.total_gross)}</td><td className="text-right">{money(run.total_deductions)}</td><td className="text-right">{money(run.total_net)}</td><td className="text-right pr-4">{money(run.total_employer)}</td></tr></tfoot>
        </table>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4 text-sm">
          <h3 className="font-bold mb-2">Breakdown</h3>
          {run.breakdown.map((b: any) => <div key={`${b.kind}${b.name}`} className="flex justify-between py-1 border-b border-gray-50"><span>{b.name} <span className="text-xs text-gray-400">{b.kind === "employer" ? "employer" : b.kind}</span></span><span className="font-mono">{money(b.amount)}</span></div>)}
        </Card>
        <Card className="p-4 text-sm space-y-1">
          <h3 className="font-bold mb-2">Books</h3>
          {run.journal_entry ? <p>Posted as <Link to="/business/journal" className="font-mono text-blue-700">{run.journal_entry.entry_number}</Link>: wages and employer costs, against wages payable and payroll liabilities.</p> : <p className="text-gray-500">{run.status === "draft" ? "Posted to the books when approved." : "Not posted (accounting isn't set up)."}</p>}
          {run.status === "paid" && <p>Paid {dateOnly(run.paid_at)}{run.paid_account ? ` from ${run.paid_account.code} ${run.paid_account.name}` : ""}{run.paid_reference ? ` · ${run.paid_reference}` : ""}.</p>}
          {run.notes && <p className="text-gray-500">{run.notes}</p>}
        </Card>
      </div>
      {slip && <SlipModal run={run} slip={slip} onClose={() => setSlipId(null)} onChanged={(r) => setRun(r)} />}
      {paying && <PayModal run={run} onClose={() => setPaying(false)} onDone={(r) => { setPaying(false); setRun(r); }} />}
    </div>
  );
};
