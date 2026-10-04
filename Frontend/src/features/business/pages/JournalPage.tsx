import React, { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { accountingApi, JournalEntry, SOURCE_LABELS, accountLabel } from "../api/accounting.api";
import { useAccounts, useAccountingSettings, AccountSelect, SetupFirst, todayStr, amt } from "../components/accounting";
import { Card, PageHeader, Spinner, EmptyState, Pagination, Modal, Field, money, dateOnly, inputCls, inputBase, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

type Line = { account_id: string; debit: string; credit: string; description: string };
const blank = (): Line => ({ account_id: "", debit: "", credit: "", description: "" });

const NewEntryModal: React.FC<{ onClose: () => void; onSaved: () => void }> = ({ onClose, onSaved }) => {
  const { companyId } = useBusiness();
  const { accounts } = useAccounts();
  const [date, setDate] = useState(todayStr());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const diff = Math.round((dr - cr) * 100) / 100;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (diff !== 0) return toast.error("Debits and credits must be equal");
    setBusy(true);
    try {
      const body = { entry_date: date, memo, lines: lines.filter((l) => l.account_id).map((l) => ({ account_id: Number(l.account_id), debit: Number(l.debit || 0), credit: Number(l.credit || 0), description: l.description || undefined })) };
      toast.success((await accountingApi.createEntry(companyId!, body)).message);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New journal entry" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-3">
          <Field label="Date"><input type="date" required className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Memo"><input required className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Owner investment, loan received, depreciation" /></Field>
        </div>
        <table className="w-full">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400"><th>Account</th><th>Description</th><th className="w-28 text-right">Debit</th><th className="w-28 text-right">Credit</th><th className="w-8" /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="pr-2 py-1"><AccountSelect accounts={accounts} value={l.account_id} onChange={(v) => set(i, { account_id: v })} ariaLabel={`Line ${i + 1} account`} /></td>
                <td className="pr-2 py-1"><input className={inputCls} value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                <td className="pr-2 py-1"><input type="number" min="0" step="0.01" aria-label={`Line ${i + 1} debit`} className={`${inputBase} w-full text-right`} value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td>
                <td className="pr-2 py-1"><input type="number" min="0" step="0.01" aria-label={`Line ${i + 1} credit`} className={`${inputBase} w-full text-right`} value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
                <td>{lines.length > 2 && <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove line"><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td><button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className="text-blue-700 text-xs font-bold py-2">+ Add line</button></td>
              <td className="text-right pr-2">Totals</td><td className="text-right pr-2">{money(dr)}</td><td className="text-right pr-2">{money(cr)}</td><td />
            </tr>
          </tfoot>
        </table>
        {diff !== 0 && <p className="text-red-600 text-right">Out of balance by {money(Math.abs(diff))}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button disabled={busy || diff !== 0 || dr === 0} className={btnPrimary}>Post entry</button></div>
      </form>
    </Modal>
  );
};

export const EntryModal: React.FC<{ id: number; onClose: () => void; onChanged?: () => void }> = ({ id, onClose, onChanged }) => {
  const { companyId, can } = useBusiness();
  const [e, setE] = useState<JournalEntry | null>(null);
  const load = useCallback(() => { accountingApi.entry(companyId!, id).then(setE).catch((err) => toast.error(errorMessage(err))); }, [companyId, id]);
  useEffect(load, [load]);
  const reverse = async () => {
    if (!window.confirm("Post a reversing entry dated today?")) return;
    try {
      toast.success((await accountingApi.reverseEntry(companyId!, id)).message);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal title={e ? `Journal entry ${e.entry_number}` : "Journal entry"} onClose={onClose} wide>
      {!e ? <Spinner /> : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-600">
            <span>Date: <b>{dateOnly(e.entry_date)}</b></span>
            <span>Source: <b>{SOURCE_LABELS[e.source_type] || e.source_type}</b></span>
            {e.reversed && <span className="text-red-700 font-bold">Reversed</span>}
            {e.reversal_of_id && <span className="text-gray-500">Reversing entry</span>}
          </div>
          {e.memo && <p className="font-semibold">{e.memo}</p>}
          <table className="w-full">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Account</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
            <tbody>
              {e.lines!.map((l) => (
                <tr key={l.id} className="border-b border-gray-50"><td className="py-1.5">{accountLabel(l.account)}</td><td className="text-gray-500">{l.description}</td><td className="text-right font-mono">{l.debit ? amt(l.debit) : ""}</td><td className="text-right font-mono">{l.credit ? amt(l.credit) : ""}</td></tr>
              ))}
            </tbody>
            <tfoot><tr className="font-bold"><td colSpan={2} className="pt-2">Total</td><td className="text-right font-mono pt-2">{amt(e.total)}</td><td className="text-right font-mono pt-2">{amt(e.total)}</td></tr></tfoot>
          </table>
          {can("accounting.manage") && ["manual", "opening_balance"].includes(e.source_type) && !e.reversed && !e.reversal_of_id && (
            <div className="flex justify-end"><button onClick={reverse} className={btnDanger}><RotateCcw size={16} /> Reverse</button></div>
          )}
          {!["manual", "opening_balance"].includes(e.source_type) && <p className="text-xs text-gray-400">Posted automatically. To undo it, void or delete the document it came from.</p>}
        </div>
      )}
    </Modal>
  );
};

export const JournalPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const { settings } = useAccountingSettings();
  const [rows, setRows] = useState<JournalEntry[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState({ source_type: "", search: "", from: "", to: "" });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => {
    accountingApi.journal(companyId!, { ...filters, page }).then((r) => { setRows(r.data); setTotalPages(r.totalPages); }).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, filters, page]);
  useEffect(() => { if (settings?.enabled) load(); }, [load, settings]);
  if (!settings) return <Spinner />;
  if (!settings.enabled) return <><PageHeader title="Journal" /><SetupFirst /></>;
  return (
    <div>
      <PageHeader title="Journal" subtitle="Every entry in the books, newest first"
        actions={can("accounting.manage") && <button onClick={() => setCreating(true)} className={btnPrimary}><Plus size={16} /> New entry</button>} />
      <Card className="p-3 mb-3 flex flex-wrap gap-2 items-center text-sm">
        <div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" /><input className={`${inputBase} pl-8 w-56`} placeholder="Memo or JE number" value={filters.search} onChange={(e) => { setPage(1); setFilters({ ...filters, search: e.target.value }); }} /></div>
        <select aria-label="Source" className={inputBase} value={filters.source_type} onChange={(e) => { setPage(1); setFilters({ ...filters, source_type: e.target.value }); }}>
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" aria-label="From" className={inputBase} value={filters.from} onChange={(e) => { setPage(1); setFilters({ ...filters, from: e.target.value }); }} />
        <input type="date" aria-label="To" className={inputBase} value={filters.to} onChange={(e) => { setPage(1); setFilters({ ...filters, to: e.target.value }); }} />
      </Card>
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : rows.length === 0 ? <EmptyState title="No journal entries" text="Entries appear here as invoices, payments, bills and stock movements are recorded." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Entry</th><th>Date</th><th>Source</th><th>Memo</th><th className="text-right px-4">Amount</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} onClick={() => setOpen(e.id)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-2 font-mono">{e.entry_number}</td>
                  <td>{dateOnly(e.entry_date)}</td>
                  <td className="text-gray-600">{SOURCE_LABELS[e.source_type] || e.source_type}</td>
                  <td className={e.reversed ? "line-through text-gray-400" : ""}>{e.memo}</td>
                  <td className="text-right px-4 font-mono">{amt(e.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>
      {creating && <NewEntryModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {open && <EntryModal id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
};
