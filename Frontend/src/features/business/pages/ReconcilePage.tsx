import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Landmark } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { accountingApi, isMoneyAccount, SOURCE_LABELS } from "../api/accounting.api";
import { useAccounts, useAccountingSettings, AccountSelect, SetupFirst, todayStr, amt } from "../components/accounting";
import { Card, PageHeader, Spinner, EmptyState, Field, Stat, money, dateOnly, inputCls, btnPrimary } from "../components/ui";

export const ReconcilePage: React.FC = () => {
  const { companyId } = useBusiness();
  const { settings } = useAccountingSettings();
  const { accounts } = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [statement, setStatement] = useState("");
  const [view, setView] = useState<any>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(String(accounts.find((a) => a.system_key === "bank")?.id || ""));
  }, [accounts, accountId]);
  const load = useCallback(() => {
    if (!accountId) return;
    accountingApi.reconcileView(companyId!, { account_id: accountId, statement_date: date }).then((v) => { setView(v); setTicked(new Set()); }).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, accountId, date]);
  useEffect(load, [load]);

  const clearedAfter = useMemo(() => {
    if (!view) return 0;
    const sum = view.lines.filter((l: any) => ticked.has(l.id)).reduce((s: number, l: any) => s + l.debit - l.credit, 0);
    return Math.round((view.cleared_balance + sum) * 100) / 100;
  }, [view, ticked]);
  const diff = statement === "" ? null : Math.round((Number(statement) - clearedAfter) * 100) / 100;

  if (!settings) return <Spinner />;
  if (!settings.enabled) return <><PageHeader title="Reconcile" /><SetupFirst /></>;

  const toggle = (id: number) => setTicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const finish = async () => {
    setBusy(true);
    try {
      toast.success((await accountingApi.reconcile(companyId!, { account_id: Number(accountId), statement_date: date, statement_balance: Number(statement), line_ids: [...ticked] })).message);
      setStatement("");
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Reconcile" subtitle="Match the books to your bank or card statement" />
      <Card className="p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <Field label="Account"><AccountSelect accounts={accounts} filter={isMoneyAccount} value={accountId} onChange={setAccountId} ariaLabel="Account" /></Field>
        <Field label="Statement end date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Statement ending balance"><input type="number" step="0.01" className={inputCls} value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="From your statement" /></Field>
      </Card>
      {!view ? (accountId ? <Spinner /> : <EmptyState icon={<Landmark size={36} />} title="Choose an account" />) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Card className="p-3"><Stat label="Balance in the books" value={money(view.book_balance)} /></Card>
            <Card className="p-3"><Stat label="Previously cleared" value={money(view.cleared_balance)} /></Card>
            <Card className="p-3"><Stat label="Cleared incl. ticked" value={money(clearedAfter)} /></Card>
            <Card className="p-3"><Stat label="Difference" value={diff === null ? "—" : money(diff)} tone={diff === 0 ? "good" : diff === null ? "default" : "warn"} /></Card>
          </div>
          <Card className="overflow-hidden mb-4">
            {view.lines.length === 0 ? <EmptyState icon={<CheckCircle2 size={36} />} title="Everything up to this date is reconciled" /> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b">
                  <th className="px-4 py-2 w-10"><input type="checkbox" aria-label="Tick all" checked={ticked.size === view.lines.length} onChange={(e) => setTicked(e.target.checked ? new Set(view.lines.map((l: any) => l.id)) : new Set())} /></th>
                  <th>Date</th><th>Entry</th><th>Description</th><th className="text-right">Money in</th><th className="text-right px-4">Money out</th></tr></thead>
                <tbody>{view.lines.map((l: any) => (
                  <tr key={l.id} onClick={() => toggle(l.id)} className={`border-b border-gray-50 cursor-pointer ${ticked.has(l.id) ? "bg-green-50" : "hover:bg-gray-50"}`}>
                    <td className="px-4 py-2"><input type="checkbox" aria-label={`Tick ${l.entry_number}`} checked={ticked.has(l.id)} onChange={() => toggle(l.id)} onClick={(e) => e.stopPropagation()} /></td>
                    <td>{dateOnly(l.entry_date)}</td><td className="font-mono">{l.entry_number}</td>
                    <td>{l.description || l.memo}<span className="block text-xs text-gray-400">{SOURCE_LABELS[l.source_type] || l.source_type}</span></td>
                    <td className="text-right font-mono">{l.debit ? amt(l.debit) : ""}</td><td className="text-right px-4 font-mono">{l.credit ? amt(l.credit) : ""}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Card>
          <div className="flex justify-end mb-6">
            <button disabled={busy || diff !== 0} onClick={finish} className={btnPrimary}><CheckCircle2 size={16} /> Finish reconciliation</button>
          </div>
          {view.history.length > 0 && (
            <Card className="p-4 text-sm">
              <h3 className="font-bold mb-2">Past reconciliations</h3>
              {view.history.map((h: any) => (
                <div key={h.id} className="flex justify-between py-1 border-b border-gray-50"><span>Statement {dateOnly(h.statement_date)} · {h.lines_cleared} transaction(s)</span><span className="font-mono">{money(h.statement_balance)}</span></div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
};
