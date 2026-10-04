import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Printer, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { accountingApi, SOURCE_LABELS, TYPE_LABELS, AccountType } from "../api/accounting.api";
import { useAccounts, useAccountingSettings, AccountSelect, SetupFirst, DateRange, todayStr, monthStart, yearStart, amt } from "../components/accounting";
import { EntryModal } from "./JournalPage";
import { Card, PageHeader, Spinner, EmptyState, FilterTabs, dateOnly, btnSecondary } from "../components/ui";

type Row = { id?: number; code?: string; name: string; amount: number };

const Section: React.FC<{ title: string; rows: Row[]; total?: number; totalLabel?: string; prev?: Row[] }> = ({ title, rows, total, totalLabel, prev }) => (
  <>
    <tr><td colSpan={prev ? 3 : 2} className="pt-4 pb-1 font-bold text-gray-900">{title}</td></tr>
    {rows.length === 0 && <tr><td className="pl-4 text-gray-400 py-1">None</td><td /></tr>}
    {rows.map((r) => (
      <tr key={r.id || r.name} className="border-b border-gray-50">
        <td className="pl-4 py-1">{r.code && <span className="font-mono text-gray-400 mr-2">{r.code}</span>}{r.name}</td>
        <td className="text-right font-mono">{amt(r.amount)}</td>
        {prev && <td className="text-right font-mono text-gray-500">{amt(prev.find((p) => p.id === r.id)?.amount || 0)}</td>}
      </tr>
    ))}
    {total !== undefined && <tr className="font-semibold"><td className="pl-4 py-1">{totalLabel || `Total ${title.toLowerCase()}`}</td><td className="text-right font-mono border-t border-gray-300">{amt(total)}</td>{prev && <td />}</tr>}
  </>
);
const Total: React.FC<{ label: string; value: number; prev?: number; strong?: boolean }> = ({ label, value, prev, strong }) => (
  <tr className={strong ? "font-black text-base" : "font-bold"}>
    <td className="py-2">{label}</td><td className={`text-right font-mono border-t-2 ${strong ? "border-double border-gray-900" : "border-gray-300"}`}>{amt(value)}</td>
    {prev !== undefined && <td className="text-right font-mono text-gray-500 border-t-2 border-gray-200">{amt(prev)}</td>}
  </tr>
);

const ProfitLoss: React.FC = () => {
  const { companyId } = useBusiness();
  const [range, setRange] = useState({ from: monthStart(), to: todayStr() });
  const [compare, setCompare] = useState(false);
  const [r, setR] = useState<any>(null);
  useEffect(() => { accountingApi.profitLoss(companyId!, { ...range, compare: compare ? "previous" : "" }).then(setR).catch((e) => toast.error(errorMessage(e))); }, [companyId, range, compare]);
  const d = r?.data, p = r?.previous;
  return (
    <>
      <div className="flex flex-wrap gap-3 items-center mb-3 no-print">
        <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with previous period</label>
      </div>
      {!d ? <Spinner /> : (
        <Card className="p-6">
          <h2 className="font-black text-lg">Profit & loss</h2>
          <p className="text-sm text-gray-500 mb-2">{dateOnly(d.from)} – {dateOnly(d.to)}</p>
          <table className="w-full text-sm max-w-3xl">
            {p && <thead><tr className="text-[10px] uppercase text-gray-400"><th /><th className="text-right">This period</th><th className="text-right">{dateOnly(p.from)} – {dateOnly(p.to)}</th></tr></thead>}
            <tbody>
              <Section title="Income" rows={d.sections.income} total={d.totals.revenue} prev={p?.sections.income} />
              <Section title="Cost of sales" rows={d.sections.cogs} total={d.totals.cogs} prev={p?.sections.cogs} />
              <Total label={`Gross profit${d.grossMargin !== null ? ` (${d.grossMargin}%)` : ""}`} value={d.totals.grossProfit} prev={p?.totals.grossProfit} />
              <Section title="Expenses" rows={d.sections.expenses} total={d.totals.expenses} prev={p?.sections.expenses} />
              <Total label="Operating profit" value={d.totals.operatingIncome} prev={p?.totals.operatingIncome} />
              {(d.sections.otherIncome.length > 0 || d.sections.otherExpenses.length > 0) && (
                <>
                  <Section title="Other income" rows={d.sections.otherIncome} prev={p?.sections.otherIncome} />
                  <Section title="Other expenses" rows={d.sections.otherExpenses} prev={p?.sections.otherExpenses} />
                </>
              )}
              <Total label="Net profit" value={d.totals.netIncome} prev={p?.totals.netIncome} strong />
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
};

const BalanceSheet: React.FC = () => {
  const { companyId } = useBusiness();
  const [asOf, setAsOf] = useState(todayStr());
  const [d, setD] = useState<any>(null);
  useEffect(() => { accountingApi.balanceSheet(companyId!, { as_of: asOf }).then(setD).catch((e) => toast.error(errorMessage(e))); }, [companyId, asOf]);
  return (
    <>
      <div className="flex items-center gap-2 mb-3 text-sm no-print"><span>As of</span><input type="date" aria-label="As of" className="px-2 py-1.5 border border-gray-300 rounded-lg bg-white" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      {!d ? <Spinner /> : (
        <Card className="p-6">
          <div className="flex items-center gap-3"><h2 className="font-black text-lg">Balance sheet</h2>{d.balanced ? <CheckCircle2 size={18} className="text-green-600" aria-label="Balanced" /> : <AlertTriangle size={18} className="text-red-600" aria-label="Not balanced" />}</div>
          <p className="text-sm text-gray-500 mb-2">As of {dateOnly(d.as_of)}</p>
          <table className="w-full text-sm max-w-2xl">
            <tbody>
              <Section title="Current assets" rows={d.assets.current} />
              {d.assets.fixed.length > 0 && <Section title="Fixed assets" rows={d.assets.fixed} />}
              <Total label="Total assets" value={d.assets.total} strong />
              <Section title="Current liabilities" rows={d.liabilities.current} />
              {d.liabilities.longTerm.length > 0 && <Section title="Long-term liabilities" rows={d.liabilities.longTerm} />}
              <Total label="Total liabilities" value={d.liabilities.total} />
              <Section title="Equity" rows={[...d.equity.accounts, { name: "Profit to date (not yet closed to retained earnings)", amount: d.equity.earnings }]} />
              <Total label="Total equity" value={d.equity.total} />
              <Total label="Total liabilities & equity" value={Math.round((d.liabilities.total + d.equity.total) * 100) / 100} strong />
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
};

const TrialBalance: React.FC = () => {
  const { companyId } = useBusiness();
  const [asOf, setAsOf] = useState(todayStr());
  const [d, setD] = useState<any>(null);
  useEffect(() => { accountingApi.trialBalance(companyId!, { as_of: asOf }).then(setD).catch((e) => toast.error(errorMessage(e))); }, [companyId, asOf]);
  return (
    <>
      <div className="flex items-center gap-2 mb-3 text-sm no-print"><span>As of</span><input type="date" aria-label="As of" className="px-2 py-1.5 border border-gray-300 rounded-lg bg-white" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      {!d ? <Spinner /> : (
        <Card className="p-6">
          <div className="flex items-center gap-3"><h2 className="font-black text-lg">Trial balance</h2>{d.balanced ? <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded">Balanced</span> : <span className="text-xs font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded">Out of balance</span>}</div>
          <p className="text-sm text-gray-500 mb-3">As of {dateOnly(d.as_of)}</p>
          <table className="w-full text-sm max-w-3xl">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Account</th><th>Type</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
            <tbody>{d.data.map((a: any) => (
              <tr key={a.id} className="border-b border-gray-50"><td className="py-1"><span className="font-mono text-gray-400 mr-2">{a.code}</span>{a.name}</td><td className="text-gray-500">{TYPE_LABELS[a.type as AccountType]}</td><td className="text-right font-mono">{a.debit ? amt(a.debit) : ""}</td><td className="text-right font-mono">{a.credit ? amt(a.credit) : ""}</td></tr>
            ))}</tbody>
            <tfoot><tr className="font-black"><td className="py-2" colSpan={2}>Total</td><td className="text-right font-mono border-t-2 border-gray-900">{amt(d.totals.debit)}</td><td className="text-right font-mono border-t-2 border-gray-900">{amt(d.totals.credit)}</td></tr></tfoot>
          </table>
        </Card>
      )}
    </>
  );
};

const CashFlow: React.FC = () => {
  const { companyId } = useBusiness();
  const [range, setRange] = useState({ from: monthStart(), to: todayStr() });
  const [d, setD] = useState<any>(null);
  useEffect(() => { accountingApi.cashFlow(companyId!, range).then(setD).catch((e) => toast.error(errorMessage(e))); }, [companyId, range]);
  const names: Record<string, string> = { operating: "Operating activities", investing: "Investing activities", financing: "Financing activities" };
  return (
    <>
      <div className="mb-3 no-print"><DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} /></div>
      {!d ? <Spinner /> : (
        <Card className="p-6">
          <h2 className="font-black text-lg">Cash flow</h2>
          <p className="text-sm text-gray-500 mb-2">{dateOnly(d.from)} – {dateOnly(d.to)} · cash, bank and card accounts</p>
          <table className="w-full text-sm max-w-2xl">
            <tbody>
              <tr className="font-semibold"><td className="py-2">Cash at the start</td><td className="text-right font-mono">{amt(d.opening)}</td></tr>
              {Object.keys(names).map((k) => (
                <Section key={k} title={names[k]} rows={Object.entries(d.sections[k] || {}).map(([name, amount]) => ({ name, amount: amount as number }))} total={d.totals?.[k] || 0} totalLabel={`Net cash from ${k}`} />
              ))}
              <Total label="Net change in cash" value={d.net} />
              <Total label="Cash at the end" value={d.closing} strong />
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
};

const GeneralLedger: React.FC<{ initialAccount?: string }> = ({ initialAccount }) => {
  const { companyId } = useBusiness();
  const { accounts } = useAccounts();
  const [accountId, setAccountId] = useState(initialAccount || "");
  const [range, setRange] = useState({ from: yearStart(), to: todayStr() });
  const [d, setD] = useState<any>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(String(accounts.find((a) => a.system_key === "bank")?.id || accounts[0].id));
  }, [accounts, accountId]);
  useEffect(() => {
    if (accountId) accountingApi.generalLedger(companyId!, { account_id: accountId, ...range }).then(setD).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, accountId, range]);
  return (
    <>
      <div className="flex flex-wrap gap-3 items-center mb-3 no-print">
        <div className="w-72"><AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} ariaLabel="Account" /></div>
        <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      </div>
      {!d ? <Spinner /> : (
        <Card className="p-6">
          <h2 className="font-black text-lg">{d.account.code} · {d.account.name}</h2>
          <p className="text-sm text-gray-500 mb-3">{dateOnly(d.from)} – {dateOnly(d.to)}</p>
          {d.data.length === 0 ? <EmptyState title="No transactions in this period" text={`Balance: ${amt(d.opening)}`} /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Date</th><th>Entry</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                <tr className="text-gray-500"><td colSpan={5} className="py-1">Opening balance</td><td className="text-right font-mono">{amt(d.opening)}</td></tr>
                {d.data.map((l: any) => (
                  <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(Number(l.entry_id))}>
                    <td className="py-1">{dateOnly(l.entry_date)}</td><td className="font-mono">{l.entry_number}</td>
                    <td>{l.description || l.memo}<span className="text-xs text-gray-400 ml-2">{SOURCE_LABELS[l.source_type] || l.source_type}</span></td>
                    <td className="text-right font-mono">{l.debit ? amt(l.debit) : ""}</td><td className="text-right font-mono">{l.credit ? amt(l.credit) : ""}</td><td className="text-right font-mono">{amt(l.balance)}</td>
                  </tr>
                ))}
                <tr className="font-bold"><td colSpan={5} className="py-2">Closing balance</td><td className="text-right font-mono border-t-2 border-gray-900">{amt(d.closing)}</td></tr>
              </tbody>
            </table>
          )}
        </Card>
      )}
      {open && <EntryModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
};

export const FinancialReportsPage: React.FC = () => {
  const { settings } = useAccountingSettings();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "pl";
  if (!settings) return <Spinner />;
  if (!settings.enabled) return <><PageHeader title="Financial reports" /><SetupFirst /></>;
  return (
    <div>
      <PageHeader title="Financial reports" subtitle="From the general ledger" actions={<button onClick={() => window.print()} className={`${btnSecondary} no-print`}><Printer size={16} /> Print</button>} />
      <div className="mb-4 no-print">
        <FilterTabs value={tab} onChange={(v) => setParams({ tab: v })} options={[
          { value: "pl", label: "Profit & loss" }, { value: "bs", label: "Balance sheet" }, { value: "cf", label: "Cash flow" },
          { value: "tb", label: "Trial balance" }, { value: "ledger", label: "General ledger" },
        ]} />
      </div>
      {tab === "pl" && <ProfitLoss />}
      {tab === "bs" && <BalanceSheet />}
      {tab === "cf" && <CashFlow />}
      {tab === "tb" && <TrialBalance />}
      {tab === "ledger" && <GeneralLedger initialAccount={params.get("account") || undefined} />}
    </div>
  );
};
