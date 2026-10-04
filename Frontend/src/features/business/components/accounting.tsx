// Shared pieces for the accounting pages.
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { useBusiness } from "../context/BusinessContext";
import { accountingApi, Account, AccountingSettings, TYPE_LABELS, AccountType } from "../api/accounting.api";
import { Card, inputCls, btnPrimary } from "./ui";

export const todayStr = () => new Date().toISOString().slice(0, 10);
export const monthStart = () => `${todayStr().slice(0, 7)}-01`;
export const yearStart = () => `${todayStr().slice(0, 4)}-01-01`;
/** Accounting amounts: negatives in brackets, like on financial statements. */
export const amt = (n: unknown) => {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

/** Accounting settings (enabled, start and lock dates). */
export const useAccountingSettings = () => {
  const { companyId } = useBusiness();
  const [settings, setSettings] = useState<AccountingSettings | null>(null);
  const reload = useCallback(() => {
    if (!companyId) return;
    accountingApi.settings(companyId).then(setSettings).catch(() => setSettings({ enabled: false, startDate: null, lockDate: null, inventoryTracked: false, entries: 0 }));
  }, [companyId]);
  useEffect(reload, [reload]);
  return { settings, reload };
};

/** The chart of accounts with balances. */
export const useAccounts = () => {
  const { companyId } = useBusiness();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    accountingApi.accounts(companyId).then((r) => setAccounts(r.data)).catch(() => setAccounts([])).finally(() => setLoading(false));
  }, [companyId]);
  useEffect(reload, [reload]);
  return { accounts, loading, reload };
};

/** Account dropdown grouped by type. */
export const AccountSelect: React.FC<{
  accounts: Account[]; value: string; onChange: (id: string) => void; filter?: (a: Account) => boolean; placeholder?: string;
  required?: boolean; className?: string; ariaLabel?: string;
}> = ({ accounts, value, onChange, filter, placeholder = "Choose an account", required, className = inputCls, ariaLabel }) => {
  const list = accounts.filter((a) => (a.is_active || String(a.id) === value) && (!filter || filter(a)));
  const groups = (Object.keys(TYPE_LABELS) as AccountType[]).map((t) => [t, list.filter((a) => a.type === t)] as const).filter(([, l]) => l.length);
  return (
    <select required={required} aria-label={ariaLabel} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {groups.map(([t, l]) => (
        <optgroup key={t} label={TYPE_LABELS[t]}>
          {l.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
};

/** Shown on accounting pages until the books are set up. */
export const SetupFirst: React.FC = () => {
  const { can } = useBusiness();
  return (
    <Card className="p-10 text-center">
      <BookOpen size={36} className="mx-auto text-gray-300 mb-3" />
      <p className="font-bold text-gray-900">Accounting isn't set up yet</p>
      <p className="text-sm text-gray-500 mt-1">Set up your books once (opening balances and a start date). From then on sales, purchases, stock and payments post automatically.</p>
      {can("accounting.manage") && <Link to="/business/accounting" className={`${btnPrimary} mt-4`}>Set up accounting</Link>}
    </Card>
  );
};

export const DateRange: React.FC<{ from: string; to: string; onChange: (from: string, to: string) => void }> = ({ from, to, onChange }) => {
  const presets: [string, () => [string, string]][] = [
    ["This month", () => [monthStart(), todayStr()]],
    ["Last month", () => {
      const d = new Date(`${monthStart()}T00:00:00Z`);
      const end = new Date(d.getTime() - 86400000).toISOString().slice(0, 10);
      return [`${end.slice(0, 7)}-01`, end];
    }],
    ["This year", () => [yearStart(), todayStr()]],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input type="date" aria-label="From" className="px-2 py-1.5 border border-gray-300 rounded-lg bg-white" value={from} onChange={(e) => onChange(e.target.value, to)} />
      <span className="text-gray-400">to</span>
      <input type="date" aria-label="To" className="px-2 py-1.5 border border-gray-300 rounded-lg bg-white" value={to} onChange={(e) => onChange(from, e.target.value)} />
      {presets.map(([label, fn]) => (
        <button key={label} type="button" onClick={() => onChange(...fn())} className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-100 text-gray-600 hover:bg-gray-200">{label}</button>
      ))}
    </div>
  );
};
