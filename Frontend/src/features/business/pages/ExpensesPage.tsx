import React, { useCallback, useEffect, useState } from "react";
import { Plus, Ban, Wallet, Search } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { accountingApi, isMoneyAccount, accountLabel, Account } from "../api/accounting.api";
import { useAccounts, useAccountingSettings, AccountSelect, SetupFirst, DateRange, todayStr, monthStart } from "../components/accounting";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Modal, Field, money, dateOnly, inputCls, inputBase, btnPrimary, btnSecondary } from "../components/ui";

const METHODS = ["card", "bank_transfer", "cash", "check", "direct_debit", "other"];

const NewExpenseModal: React.FC<{ accounts: Account[]; onClose: () => void; onSaved: () => void }> = ({ accounts, onClose, onSaved }) => {
  const { companyId } = useBusiness();
  const bank = String(accounts.find((a) => a.system_key === "bank")?.id || "");
  const [form, setForm] = useState({ expense_date: todayStr(), payee: "", account_id: "", paid_from_account_id: bank, amount: "", method: "card", reference: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      toast.success((await accountingApi.createExpense(companyId!, { ...form, amount: Number(form.amount), account_id: Number(form.account_id), paid_from_account_id: Number(form.paid_from_account_id) })).message);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Record an expense" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <p className="text-gray-500">Money already spent (rent, fuel, software, fees). For something you'll pay later, enter a bill instead.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" required className={inputCls} value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></Field>
          <Field label="Amount"><input type="number" step="0.01" min="0.01" required className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
        </div>
        <Field label="Paid to"><input required className={inputCls} value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} placeholder="Landlord, Shell, Google..." /></Field>
        <Field label="Category (expense account)"><AccountSelect accounts={accounts} filter={(a) => a.type === "expense" || (a.type === "asset" && a.subtype === "fixed_asset") || (a.type === "asset" && a.subtype === "current_asset" && !a.system_key)} value={form.account_id} onChange={(v) => setForm({ ...form, account_id: v })} required ariaLabel="Category" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid from"><AccountSelect accounts={accounts} filter={isMoneyAccount} value={form.paid_from_account_id} onChange={(v) => setForm({ ...form, paid_from_account_id: v })} required ariaLabel="Paid from" /></Field>
          <Field label="Method"><select className={inputCls} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}</select></Field>
        </div>
        <Field label="Reference"><input className={inputCls} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Receipt #" /></Field>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button disabled={busy} className={btnPrimary}>Save expense</button></div>
      </form>
    </Modal>
  );
};

export const ExpensesPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const { settings } = useAccountingSettings();
  const { accounts } = useAccounts();
  const [range, setRange] = useState({ from: monthStart(), to: todayStr() });
  const [search, setSearch] = useState("");
  const [data, setData] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => {
    accountingApi.expenses(companyId!, { ...range, search }).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, range, search]);
  useEffect(() => { if (settings?.enabled) load(); }, [load, settings]);
  if (!settings) return <Spinner />;
  if (!settings.enabled) return <><PageHeader title="Expenses" /><SetupFirst /></>;
  const voidIt = async (id: number) => {
    if (!window.confirm("Void this expense? Its journal entry is reversed.")) return;
    try {
      toast.success((await accountingApi.voidExpense(companyId!, id)).message);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div>
      <PageHeader title="Expenses" subtitle="Day-to-day spending paid straight from cash, bank or card"
        actions={can("accounting.manage") && <button onClick={() => setCreating(true)} className={btnPrimary}><Plus size={16} /> Record expense</button>} />
      <Card className="p-3 mb-3 flex flex-wrap gap-3 items-center">
        <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <div className="relative ml-auto"><Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" /><input className={`${inputBase} pl-8 w-48`} placeholder="Payee or reference" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </Card>
      {!data ? <Spinner /> : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
          <Card className="overflow-hidden">
            {data.data.length === 0 ? <EmptyState icon={<Wallet size={36} />} title="No expenses in this period" /> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Date</th><th>Paid to</th><th>Category</th><th>From</th><th className="text-right">Amount</th><th className="w-10" /></tr></thead>
                <tbody>{data.data.map((e: any) => (
                  <tr key={e.id} className={`border-b border-gray-50 ${e.status === "void" ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2">{dateOnly(e.expense_date)}<span className="block text-xs text-gray-400 font-mono">{e.expense_number}</span></td>
                    <td className="font-semibold">{e.payee}{e.reference && <span className="block text-xs text-gray-500 font-normal">{e.reference}</span>}</td>
                    <td className="text-gray-600">{accountLabel(e.account)}</td>
                    <td className="text-gray-600">{e.paid_from?.name}</td>
                    <td className="text-right font-mono">{e.status === "void" ? <StatusBadge status="void" /> : money(e.amount)}</td>
                    <td className="text-right pr-3">{can("accounting.manage") && e.status === "posted" && <button onClick={() => voidIt(e.id)} className="text-gray-400 hover:text-red-600" aria-label="Void expense"><Ban size={14} /></button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>
          <Card className="p-4 text-sm h-fit">
            <h3 className="font-bold mb-2">By category</h3>
            {Object.entries(data.by_account as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} className="flex justify-between py-1 border-b border-gray-50"><span className="text-gray-600 truncate pr-2">{k}</span><span className="font-mono">{money(v)}</span></div>
            ))}
            <div className="flex justify-between pt-2 font-bold"><span>Total</span><span>{money(data.total)}</span></div>
          </Card>
        </div>
      )}
      {creating && <NewExpenseModal accounts={accounts} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </div>
  );
};
