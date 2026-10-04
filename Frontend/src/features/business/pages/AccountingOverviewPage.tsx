import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Lock, Unlock, Receipt, Wallet, Landmark, FileText, Scale } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { accountingApi } from "../api/accounting.api";
import { useAccountingSettings, todayStr, SetupFirst } from "../components/accounting";
import { Card, PageHeader, Spinner, Field, Stat, money, dateOnly, inputCls, btnPrimary, btnSecondary } from "../components/ui";

const SetupWizard: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { companyId } = useBusiness();
  const [preview, setPreview] = useState<{ inventory: number; receivables: number } | null>(null);
  const [form, setForm] = useState({ start_date: todayStr(), cash: "", bank: "", include_inventory: true, include_receivables: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    accountingApi.setupPreview(companyId!).then(setPreview).catch(() => setPreview({ inventory: 0, receivables: 0 }));
  }, [companyId]);
  const total = Number(form.cash || 0) + Number(form.bank || 0) + (form.include_inventory ? preview?.inventory || 0 : 0) + (form.include_receivables ? preview?.receivables || 0 : 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.confirm("Start the books? Opening balances are posted once; correct them later with a journal entry.")) return;
    setBusy(true);
    try {
      toast.success((await accountingApi.setup(companyId!, { ...form, cash: Number(form.cash || 0), bank: Number(form.bank || 0) })).message);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!preview) return <Spinner />;
  return (
    <Card className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <BookOpen className="text-blue-600" />
        <div>
          <h2 className="font-bold text-lg">Set up your books</h2>
          <p className="text-sm text-gray-500">We create a standard chart of accounts and record what the business has today. After that, invoices, payments, goods received, stock changes and supplier bills post automatically.</p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4 text-sm">
        <Field label="Start date" hint="Transactions from this date are recorded in the books.">
          <input type="date" required className={inputCls} value={form.start_date} max={todayStr()} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cash on hand"><input type="number" min="0" step="0.01" className={inputCls} value={form.cash} onChange={(e) => setForm({ ...form, cash: e.target.value })} placeholder="0.00" /></Field>
          <Field label="Bank balance"><input type="number" min="0" step="0.01" className={inputCls} value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} placeholder="0.00" /></Field>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.include_inventory} onChange={(e) => setForm({ ...form, include_inventory: e.target.checked })} /> Stock on hand at average cost: <b>{money(preview.inventory)}</b></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.include_receivables} onChange={(e) => setForm({ ...form, include_receivables: e.target.checked })} /> Unpaid customer invoices (less open credit): <b>{money(preview.receivables)}</b></label>
        <p className="text-gray-500">Supplier bills you still owe from before the start date: enter them as bills after setup (bill them against <i>Opening balance equity</i>; bills made from purchase orders received earlier do this for you).</p>
        <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <span className="text-gray-600">Opening balance total</span><b className="text-lg">{money(total)}</b>
        </div>
        <div className="flex justify-end"><button disabled={busy} className={btnPrimary}>Start the books</button></div>
      </form>
    </Card>
  );
};

const LockCard: React.FC<{ lockDate: string | null; startDate: string | null; onSaved: () => void }> = ({ lockDate, startDate, onSaved }) => {
  const { companyId, can } = useBusiness();
  const [value, setValue] = useState(lockDate || "");
  useEffect(() => setValue(lockDate || ""), [lockDate]);
  const save = async (v: string | null) => {
    try {
      toast.success((await accountingApi.saveSettings(companyId!, { lockDate: v })).message);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Card className="p-5 text-sm">
      <h3 className="font-bold mb-1 flex items-center gap-2">{lockDate ? <Lock size={16} /> : <Unlock size={16} />} Closing periods</h3>
      <p className="text-gray-500 mb-3">Books started on <b>{dateOnly(startDate)}</b>. {lockDate ? <>Closed up to <b>{dateOnly(lockDate)}</b>: nothing can be posted on or before that date.</> : "All periods are open."}</p>
      {can("accounting.manage") && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Close the books up to"><input type="date" className={inputCls} value={value} max={todayStr()} onChange={(e) => setValue(e.target.value)} /></Field>
          <button onClick={() => save(value || null)} className={btnPrimary} disabled={!value}>Close period</button>
          {lockDate && <button onClick={() => save(null)} className={btnSecondary}>Reopen all</button>}
        </div>
      )}
    </Card>
  );
};

export const AccountingOverviewPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const { settings, reload } = useAccountingSettings();
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    if (settings?.enabled) accountingApi.overview(companyId!).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, settings]);

  if (!settings) return <Spinner />;
  if (!settings.enabled) {
    return (
      <div>
        <PageHeader title="Accounting" subtitle="Double-entry books that keep themselves up to date" />
        {can("accounting.manage") ? <SetupWizard onDone={reload} /> : <SetupFirst />}
      </div>
    );
  }
  if (!data) return <Spinner />;
  const links = [
    { to: "/business/bills", label: "Bills", icon: Receipt, perm: "accounting.view" },
    { to: "/business/expenses", label: "Expenses", icon: Wallet, perm: "accounting.view" },
    { to: "/business/reconcile", label: "Reconcile bank", icon: Landmark, perm: "accounting.manage" },
    { to: "/business/financial-reports", label: "Reports", icon: Scale, perm: "accounting.view" },
    { to: "/business/journal", label: "Journal", icon: FileText, perm: "accounting.view" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Accounting" subtitle={`This month: ${dateOnly(data.month.from)} – ${dateOnly(data.month.to)}`}
        actions={links.filter((l) => can(l.perm) || can("accounting.manage")).map((l) => <Link key={l.to} to={l.to} className={btnSecondary}><l.icon size={16} /> {l.label}</Link>)} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {data.money.map((m: any) => <Card key={m.id} className="p-4"><Stat label={m.name} value={money(m.balance)} tone={m.balance < 0 ? "warn" : "default"} /></Card>)}
        <Card className="p-4"><Stat label="Inventory (books)" value={money(data.inventory)} /></Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-5">
          <h3 className="font-bold mb-3">Customers owe you</h3>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Receivable" value={money(data.receivables.total)} />
            <Stat label="Overdue" value={money(data.receivables.overdue)} tone={data.receivables.overdue > 0 ? "warn" : "default"} />
          </div>
          <Link to="/business/invoices" className="text-xs font-bold text-blue-700 mt-3 inline-block">Invoices →</Link>
        </Card>
        <Card className="p-5">
          <h3 className="font-bold mb-3">You owe suppliers</h3>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Payable" value={money(data.payables.total)} />
            <Stat label="Overdue" value={money(data.payables.overdue)} tone={data.payables.overdue > 0 ? "warn" : "default"} />
            <Stat label="Due 7 days" value={money(data.payables.due_soon)} />
          </div>
          <Link to="/business/bills" className="text-xs font-bold text-blue-700 mt-3 inline-block">Bills →</Link>
        </Card>
        <Card className="p-5">
          <h3 className="font-bold mb-3">This month</h3>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Income" value={money(data.month.revenue)} />
            <Stat label="Gross profit" value={money(data.month.grossProfit)} />
            <Stat label="Expenses" value={money(data.month.expenses)} />
            <Stat label="Net profit" value={money(data.month.netIncome)} tone={data.month.netIncome < 0 ? "warn" : "good"} />
          </div>
          <Link to="/business/financial-reports" className="text-xs font-bold text-blue-700 mt-3 inline-block">Profit & loss →</Link>
        </Card>
      </div>
      {!settings.inventoryTracked && (
        <Card className="p-4 text-sm text-amber-900 bg-amber-50 border-amber-200">
          Inventory tracking is off, so purchases are recorded straight to cost of goods sold and stock isn't carried on the balance sheet. Turn tracking on in Stock settings to keep perpetual inventory books.
        </Card>
      )}
      <LockCard lockDate={settings.lockDate} startDate={settings.startDate} onSaved={reload} />
    </div>
  );
};
