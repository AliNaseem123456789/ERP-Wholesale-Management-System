import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Lock } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { accountingApi, Account, AccountType, TYPE_LABELS, SUBTYPE_LABELS } from "../api/accounting.api";
import { useAccounts, useAccountingSettings, SetupFirst, amt } from "../components/accounting";
import { Card, PageHeader, Spinner, Modal, Field, FilterTabs, inputCls, btnPrimary, btnSecondary } from "../components/ui";

const SUBTYPES: Record<AccountType, string[]> = {
  asset: ["cash", "bank", "receivable", "inventory", "current_asset", "fixed_asset"],
  liability: ["payable", "current_liability", "long_term_liability"],
  equity: ["equity"],
  revenue: ["income", "other_income", "contra_revenue"],
  expense: ["cogs", "expense", "other_expense"],
};

const AccountModal: React.FC<{ account?: Account | null; onClose: () => void; onSaved: () => void }> = ({ account, onClose, onSaved }) => {
  const { companyId } = useBusiness();
  const [form, setForm] = useState({
    code: account?.code || "", name: account?.name || "", type: (account?.type || "expense") as AccountType,
    subtype: account?.subtype || "expense", description: account?.description || "", is_active: account?.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const system = !!account?.system_key;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = account ? await accountingApi.updateAccount(companyId!, account.id, form) : await accountingApi.createAccount(companyId!, form);
      toast.success(res.message);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={account ? `Edit ${account.code} ${account.name}` : "New account"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        {system && <p className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 text-gray-600"><Lock size={14} /> Used automatically by the system: you can rename it, but not change its type or deactivate it.</p>}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Code"><input required className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="6150" /></Field>
          <div className="col-span-2"><Field label="Name"><input required className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select disabled={system} className={inputCls} value={form.type} onChange={(e) => { const t = e.target.value as AccountType; setForm({ ...form, type: t, subtype: SUBTYPES[t][0] }); }}>
              {(Object.keys(TYPE_LABELS) as AccountType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Detail type">
            <select disabled={system} className={inputCls} value={form.subtype} onChange={(e) => setForm({ ...form, subtype: e.target.value })}>
              {SUBTYPES[form.type].map((s) => <option key={s} value={s}>{SUBTYPE_LABELS[s]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Description"><textarea className={inputCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        {account && !system && <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button disabled={busy} className={btnPrimary}>Save</button></div>
      </form>
    </Modal>
  );
};

export const ChartOfAccountsPage: React.FC = () => {
  const { can } = useBusiness();
  const { settings } = useAccountingSettings();
  const { accounts, loading, reload } = useAccounts();
  const [type, setType] = useState("");
  const [editing, setEditing] = useState<Account | null | "new">(null);
  if (!settings || loading) return <Spinner />;
  if (!settings.enabled) return <><PageHeader title="Chart of accounts" /><SetupFirst /></>;
  const shown = (Object.keys(TYPE_LABELS) as AccountType[]).filter((t) => !type || t === type);
  return (
    <div>
      <PageHeader title="Chart of accounts" subtitle="Where every amount in the books is recorded"
        actions={can("accounting.manage") && <button onClick={() => setEditing("new")} className={btnPrimary}><Plus size={16} /> New account</button>} />
      <div className="mb-3">
        <FilterTabs value={type} onChange={setType} options={[{ value: "", label: "All" }, ...(Object.keys(TYPE_LABELS) as AccountType[]).map((t) => ({ value: t, label: TYPE_LABELS[t] }))]} />
      </div>
      {shown.map((t) => {
        const list = accounts.filter((a) => a.type === t);
        return (
          <Card key={t} className="mb-4 overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 font-bold text-sm">{TYPE_LABELS[t]}</div>
            <table className="w-full text-sm">
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} className={`border-b border-gray-50 last:border-0 ${a.is_active ? "" : "opacity-50"}`}>
                    <td className="px-4 py-2 font-mono w-20">{a.code}</td>
                    <td className="py-2">
                      <span className="font-semibold">{a.name}</span>
                      {a.system_key && <Lock size={11} className="inline ml-1 text-gray-400" aria-label="System account" />}
                      {!a.is_active && <span className="ml-2 text-xs text-gray-500">inactive</span>}
                    </td>
                    <td className="py-2 text-gray-500 hidden md:table-cell">{SUBTYPE_LABELS[a.subtype] || a.subtype}</td>
                    <td className="py-2 text-right font-mono">
                      <Link to={`/business/financial-reports?tab=ledger&account=${a.id}`} className="hover:text-blue-700">{amt(a.balance)}</Link>
                    </td>
                    <td className="px-4 py-2 w-10 text-right">
                      {can("accounting.manage") && <button onClick={() => setEditing(a)} className="text-gray-400 hover:text-blue-700" aria-label={`Edit ${a.name}`}><Pencil size={14} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        );
      })}
      {editing && <AccountModal account={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
};
