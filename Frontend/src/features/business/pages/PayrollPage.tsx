import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Banknote } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { hrApi } from "../api/hr.api";
import { isMoneyAccount } from "../api/accounting.api";
import { useAccounts, AccountSelect } from "../components/accounting";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Modal, Field, Stat, money, dateOnly, inputCls, btnPrimary, btnSecondary } from "../components/ui";

const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

const RemitModal: React.FC<{ liabilities: any; onClose: () => void; onDone: () => void }> = ({ liabilities, onClose, onDone }) => {
  const { companyId } = useBusiness();
  const { accounts } = useAccounts();
  const [f, setF] = useState({ account_id: String(liabilities.data[0]?.id || ""), amount: String(liabilities.data[0]?.balance || ""), paid_from_account_id: "", paid_at: new Date().toISOString().slice(0, 10), reference: "" });
  useEffect(() => { if (!f.paid_from_account_id && accounts.length) setF((x) => ({ ...x, paid_from_account_id: String(accounts.find((a) => a.system_key === "bank")?.id || "") })); }, [accounts]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      toast.success((await hrApi.remit(companyId!, { ...f, amount: Number(f.amount), account_id: Number(f.account_id), paid_from_account_id: Number(f.paid_from_account_id) })).message);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal title="Pay over taxes & deductions" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <p className="text-gray-500">Record money paid to the tax office, pension fund or other bodies for amounts withheld from pay and employer contributions.</p>
        <Field label="What you're paying">
          <select className={inputCls} value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}>
            {liabilities.data.map((a: any) => <option key={a.id} value={a.id}>{a.code} · {a.name} ({money(a.balance)} owed)</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount"><input type="number" step="0.01" min="0.01" required className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date"><input type="date" className={inputCls} value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} /></Field>
        </div>
        <Field label="Paid from"><AccountSelect accounts={accounts} filter={isMoneyAccount} value={f.paid_from_account_id} onChange={(v) => setF({ ...f, paid_from_account_id: v })} required ariaLabel="Paid from" /></Field>
        <Field label="Reference"><input className={inputCls} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Challan / receipt number" /></Field>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Record payment</button></div>
      </form>
    </Modal>
  );
};

export const PayrollPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [liab, setLiab] = useState<any>(null);
  const [creating, setCreating] = useState<{ month: string; pay_date: string } | null>(null);
  const [remitting, setRemitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    hrApi.runs(companyId!).then(setData).catch((e) => toast.error(errorMessage(e)));
    if (can("payroll.pay") || can("payroll.view")) hrApi.liabilities(companyId!).then(setLiab).catch(() => setLiab(null));
  }, [companyId]);
  useEffect(load, [load]);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await hrApi.createRun(companyId!, creating!);
      toast.success(res.message);
      navigate(`/business/payroll/${res.data.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Payroll" subtitle="Monthly pay runs, payslips and what's owed to the tax office"
        actions={can("payroll.manage") && <button onClick={() => { const m = lastMonth(); setCreating({ month: m, pay_date: monthEnd(m) }); }} className={btnPrimary}><Plus size={16} /> Run payroll</button>} />
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Card className="p-3"><Stat label={`Gross pay ${data.summary.year}`} value={money(data.summary.gross)} /></Card>
          <Card className="p-3"><Stat label={`Net paid ${data.summary.year}`} value={money(data.summary.net)} /></Card>
          <Card className="p-3"><Stat label="Employer contributions" value={money(data.summary.employer)} /></Card>
          {liab?.enabled && (
            <Card className="p-3">
              <Stat label="Taxes & deductions owed" value={money(liab.total)} tone={liab.total > 0 ? "warn" : "default"} />
              {liab.total > 0 && can("payroll.pay") && <button onClick={() => setRemitting(true)} className="text-xs font-bold text-blue-700 mt-1 inline-flex items-center gap-1"><Banknote size={13} /> Pay over</button>}
            </Card>
          )}
        </div>
      )}
      <Card className="overflow-hidden">
        {!data ? <Spinner /> : data.data.length === 0 ? <EmptyState icon={<Banknote size={36} />} title="No payroll yet" text="Run payroll for a month: payslips are worked out from salaries, attendance, leave and your pay components." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Payroll</th><th>Period</th><th>Pay date</th><th className="text-right">Employees</th><th className="text-right">Gross</th><th className="text-right">Net</th><th className="px-4">Status</th></tr></thead>
            <tbody>{data.data.map((r: any) => (
              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/business/payroll/${r.id}`)}>
                <td className="px-4 py-2 font-mono"><Link to={`/business/payroll/${r.id}`} className="text-blue-700">{r.run_number}</Link></td>
                <td>{dateOnly(r.period_start)} – {dateOnly(r.period_end)}</td>
                <td>{dateOnly(r.paid_at || r.pay_date)}</td>
                <td className="text-right">{r.employee_count}</td>
                <td className="text-right">{money(r.total_gross)}</td>
                <td className="text-right font-bold">{money(r.total_net)}</td>
                <td className="px-4"><StatusBadge status={r.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {creating && (
        <Modal title="Run payroll" onClose={() => setCreating(null)}>
          <form onSubmit={create} className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Month"><input type="month" required className={inputCls} value={creating.month} onChange={(e) => setCreating({ month: e.target.value, pay_date: monthEnd(e.target.value) })} /></Field>
              <Field label="Pay date"><input type="date" required className={inputCls} value={creating.pay_date} onChange={(e) => setCreating({ ...creating, pay_date: e.target.value })} /></Field>
            </div>
            <p className="text-gray-500">A draft is created for everyone employed in the month. Check it, add bonuses or one-off deductions, then approve and pay.</p>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setCreating(null)} className={btnSecondary}>Cancel</button><button disabled={busy} className={btnPrimary}>Create draft</button></div>
          </form>
        </Modal>
      )}
      {remitting && liab && <RemitModal liabilities={liab} onClose={() => setRemitting(false)} onDone={() => { setRemitting(false); load(); }} />}
    </div>
  );
};
