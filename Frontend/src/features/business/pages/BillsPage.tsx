import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Trash2, Ban, Receipt, Search } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { supplyApi, Supplier } from "../api/supply.api";
import { accountingApi, BILL_PAYMENT_METHODS, isMoneyAccount, accountLabel, Account } from "../api/accounting.api";
import { useAccounts, useAccountingSettings, AccountSelect, SetupFirst, todayStr } from "../components/accounting";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Pagination, Modal, Field, FilterTabs, Stat, money, dateOnly, inputCls, inputBase, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

type Line = { account_id: string; description: string; quantity: string; unit_cost: string; product_id?: number | null };
const blank = (): Line => ({ account_id: "", description: "", quantity: "1", unit_cost: "" });
const methodLabel = (m: string) => BILL_PAYMENT_METHODS.find((x) => x.value === m)?.label || m;
const billable = (a: Account) => ["expense", "asset", "liability", "equity"].includes(a.type);

// ---------------- new bill ----------------
const NewBillModal: React.FC<{ poId?: string; accounts: Account[]; onClose: () => void; onSaved: (id: number) => void }> = ({ poId, accounts, onClose, onSaved }) => {
  const { companyId } = useBusiness();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [form, setForm] = useState({ supplier_id: "", purchase_order_id: poId || "", supplier_invoice_number: "", bill_date: todayStr(), due_date: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [existing, setExisting] = useState<any[]>([]);
  const [po, setPo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { supplyApi.suppliers(companyId!).then(setSuppliers).catch(() => {}); }, [companyId]);
  useEffect(() => {
    if (!poId) return;
    accountingApi.billDraft(companyId!, poId).then((d) => {
      setPo(d.purchase_order);
      setExisting(d.existing_bills);
      setForm((f) => ({ ...f, supplier_id: String(d.supplier.id) }));
      if (d.lines.length) setLines(d.lines.map((l: any) => ({ account_id: String(l.account_id), description: l.description, quantity: String(l.quantity), unit_cost: String(l.unit_cost), product_id: l.product_id })));
    }).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, poId]);
  const set = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await accountingApi.createBill(companyId!, {
        ...form, purchase_order_id: form.purchase_order_id || undefined, due_date: form.due_date || undefined,
        lines: lines.filter((l) => l.account_id && Number(l.unit_cost)).map((l) => ({ account_id: Number(l.account_id), description: l.description, quantity: Number(l.quantity || 1), unit_cost: Number(l.unit_cost), product_id: l.product_id || undefined })),
      });
      toast.success(res.message);
      onSaved(res.data.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={po ? `Bill for ${po.po_number}` : "Enter a supplier bill"} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3 text-sm">
        {existing.length > 0 && <p className="bg-amber-50 text-amber-900 rounded-lg px-3 py-2">This purchase order already has {existing.map((b) => `${b.bill_number} (${money(b.total_amount)})`).join(", ")}. Only enter what hasn't been billed yet.</p>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2"><Field label="Supplier *">
            <select required disabled={!!poId} className={inputCls} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
              <option value="">Choose a supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field></div>
          <Field label="Supplier's invoice #"><input className={inputCls} value={form.supplier_invoice_number} onChange={(e) => setForm({ ...form, supplier_invoice_number: e.target.value })} /></Field>
          <Field label="Bill date"><input type="date" required className={inputCls} value={form.bill_date} onChange={(e) => setForm({ ...form, bill_date: e.target.value })} /></Field>
          <Field label="Due date" hint="Blank = supplier's terms"><input type="date" className={inputCls} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
        </div>
        <table className="w-full">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400"><th>Account</th><th>Description</th><th className="w-20 text-right">Qty</th><th className="w-28 text-right">Unit cost</th><th className="w-24 text-right">Amount</th><th className="w-6" /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="pr-2 py-1"><AccountSelect accounts={accounts} filter={billable} value={l.account_id} onChange={(v) => set(i, { account_id: v })} ariaLabel={`Line ${i + 1} account`} /></td>
                <td className="pr-2 py-1"><input className={inputCls} value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                <td className="pr-2 py-1"><input type="number" min="0" step="any" className={`${inputBase} w-full text-right`} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
                <td className="pr-2 py-1"><input type="number" step="0.0001" aria-label={`Line ${i + 1} unit cost`} className={`${inputBase} w-full text-right`} value={l.unit_cost} onChange={(e) => set(i, { unit_cost: e.target.value })} /></td>
                <td className="text-right font-mono">{money(Number(l.quantity || 0) * Number(l.unit_cost || 0))}</td>
                <td>{lines.length > 1 && <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 ml-1" aria-label="Remove line"><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td><button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className="text-blue-700 text-xs font-bold py-2">+ Add line</button></td><td colSpan={3} className="text-right font-bold pr-2">Total</td><td className="text-right font-bold">{money(total)}</td><td /></tr></tfoot>
        </table>
        {po && <p className="text-xs text-gray-500">Goods lines go to <i>Goods received not invoiced</i>, which was credited when the stock arrived. If the supplier's price differs, change the unit cost and the difference lands there for review.</p>}
        <Field label="Notes"><input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button disabled={busy || total <= 0} className={btnPrimary}>Save bill</button></div>
      </form>
    </Modal>
  );
};

// ---------------- bill detail ----------------
const BillModal: React.FC<{ id: number; accounts: Account[]; onClose: () => void; onChanged: () => void }> = ({ id, accounts, onClose, onChanged }) => {
  const { companyId, can } = useBusiness();
  const [b, setB] = useState<any>(null);
  const [pay, setPay] = useState<{ amount: string; method: string; account_id: string; reference: string; paid_at: string } | null>(null);
  const load = useCallback(() => { accountingApi.bill(companyId!, id).then(setB).catch((e) => toast.error(errorMessage(e))); }, [companyId, id]);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<any>, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    try {
      toast.success((await fn()).message);
      setPay(null);
      load();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const manage = can("accounting.manage");
  const bankId = String(accounts.find((a) => a.system_key === "bank")?.id || "");
  return (
    <Modal title={b ? `Bill ${b.bill_number}` : "Bill"} onClose={onClose} wide>
      {!b ? <Spinner /> : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={b.overdue ? "overdue" : b.status} />
            <span className="font-semibold">{b.supplier.name}</span>
            {b.supplier_invoice_number && <span className="text-gray-500">Invoice {b.supplier_invoice_number}</span>}
            {b.purchase_order && <Link to={`/business/purchase-orders/${b.purchase_order.id}`} className="text-blue-700 font-semibold">{b.purchase_order.po_number}</Link>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Stat label="Bill date" value={dateOnly(b.bill_date)} />
            <Stat label="Due" value={dateOnly(b.due_date)} tone={b.overdue ? "warn" : "default"} />
            <Stat label="Total" value={money(b.total_amount)} />
            <Stat label="Paid + credits" value={money(Number(b.amount_paid) + Number(b.amount_credited))} />
            <Stat label="Balance" value={money(b.balance)} tone={b.balance > 0 ? "warn" : "good"} />
          </div>
          <table className="w-full">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Line</th><th>Account</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{b.items.map((i: any) => <tr key={i.id} className="border-b border-gray-50"><td className="py-1">{i.description}</td><td className="text-gray-500">{accountLabel(i.account)}</td><td className="text-right">{Number(i.quantity)}</td><td className="text-right">{money(i.unit_cost)}</td><td className="text-right">{money(i.line_total)}</td></tr>)}</tbody>
          </table>
          <div>
            <h3 className="font-bold mb-1">Payments & credits</h3>
            {b.payments.length === 0 && b.credits.length === 0 && <p className="text-gray-500">Nothing paid yet.</p>}
            {b.payments.map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 py-1 border-b border-gray-50">
                <span>{dateOnly(p.paid_at)}</span><span className="font-semibold">{methodLabel(p.method)}</span><span className="text-gray-500">from {accountLabel(p.account)}</span>
                {p.reference && <span className="text-gray-500">{p.reference}</span>}
                <span className="ml-auto font-mono">{money(p.amount)}</span>
                {manage && <button onClick={() => act(() => accountingApi.removeBillPayment(companyId!, b.id, p.id), "Remove this payment? Its journal entry is reversed.")} className="text-gray-400 hover:text-red-600" aria-label="Remove payment"><Trash2 size={14} /></button>}
              </div>
            ))}
            {b.credits.map((c: any) => <div key={c.id} className="flex items-center gap-3 py-1 border-b border-gray-50"><span className="font-semibold">Supplier credit {c.credit_number}</span><span className="ml-auto font-mono">{money(c.amount)}</span></div>)}
          </div>
          {manage && b.balance > 0 && b.status !== "void" && b.open_credits.length > 0 && (
            <div className="bg-green-50 rounded-xl p-3">
              <p className="font-semibold mb-1">Open supplier credits</p>
              {b.open_credits.map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 py-1"><span className="font-mono">{c.credit_number}</span><span className="text-gray-500">{money(c.remaining)} left</span>
                  <button onClick={() => act(() => accountingApi.applyCredit(companyId!, c.id, b.id))} className="ml-auto text-blue-700 font-bold">Apply</button></div>
              ))}
            </div>
          )}
          {pay && (
            <form onSubmit={(e) => { e.preventDefault(); act(() => accountingApi.payBill(companyId!, b.id, { ...pay, amount: Number(pay.amount), account_id: pay.account_id ? Number(pay.account_id) : undefined })); }}
              className="grid grid-cols-2 md:grid-cols-5 gap-3 bg-blue-50/60 border border-blue-100 rounded-xl p-3">
              <Field label="Amount"><input type="number" step="0.01" min="0.01" max={b.balance} required className={inputCls} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
              <Field label="Method"><select className={inputCls} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{BILL_PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
              <Field label="Paid from"><AccountSelect accounts={accounts} filter={isMoneyAccount} value={pay.account_id} onChange={(v) => setPay({ ...pay, account_id: v })} required ariaLabel="Paid from" /></Field>
              <Field label="Date"><input type="date" className={inputCls} value={pay.paid_at} onChange={(e) => setPay({ ...pay, paid_at: e.target.value })} /></Field>
              <Field label="Reference"><input className={inputCls} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="Check #" /></Field>
              <div className="col-span-2 md:col-span-5 flex justify-end gap-2"><button type="button" onClick={() => setPay(null)} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Record payment</button></div>
            </form>
          )}
          {manage && b.status !== "void" && !pay && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
              {Number(b.amount_paid) === 0 && Number(b.amount_credited) === 0 && <button onClick={() => act(() => accountingApi.voidBill(companyId!, b.id), "Void this bill? Its journal entry is reversed.")} className={btnDanger}><Ban size={16} /> Void</button>}
              <span className="flex-1" />
              {b.balance > 0 && <button onClick={() => setPay({ amount: String(b.balance), method: "bank_transfer", account_id: bankId, reference: "", paid_at: todayStr() })} className={btnPrimary}><Plus size={16} /> Record payment</button>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

// ---------------- supplier credits ----------------
const NewCreditModal: React.FC<{ accounts: Account[]; onClose: () => void; onSaved: () => void }> = ({ accounts, onClose, onSaved }) => {
  const { companyId } = useBusiness();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const variance = String(accounts.find((a) => a.system_key === "purchase_variance")?.id || "");
  const [form, setForm] = useState({ supplier_id: "", amount: "", account_id: variance, reference: "", notes: "" });
  useEffect(() => { supplyApi.suppliers(companyId!).then(setSuppliers).catch(() => {}); }, [companyId]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      toast.success((await accountingApi.createCredit(companyId!, { ...form, amount: Number(form.amount), account_id: Number(form.account_id) })).message);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal title="Record a supplier credit" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <p className="text-gray-500">For rebates, price corrections and other credits. (Credits for goods you sent back are recorded on the supplier return.) It's applied to the supplier's open bills automatically.</p>
        <Field label="Supplier"><select required className={inputCls} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}><option value="">Choose a supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount"><input type="number" step="0.01" min="0.01" required className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Supplier's reference"><input className={inputCls} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
        </div>
        <Field label="Credit to account" hint="What the credit reduces: usually purchase price variance or an expense"><AccountSelect accounts={accounts} filter={(a) => ["expense", "asset", "revenue"].includes(a.type)} value={form.account_id} onChange={(v) => setForm({ ...form, account_id: v })} required /></Field>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Save credit</button></div>
      </form>
    </Modal>
  );
};

const CreditsTab: React.FC<{ accounts: Account[] }> = ({ accounts }) => {
  const { companyId, can } = useBusiness();
  const [rows, setRows] = useState<any[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => { accountingApi.credits(companyId!).then(setRows).catch((e) => toast.error(errorMessage(e))); }, [companyId]);
  useEffect(load, [load]);
  return (
    <>
      {can("accounting.manage") && <div className="flex justify-end mb-3"><button onClick={() => setCreating(true)} className={btnPrimary}><Plus size={16} /> Supplier credit</button></div>}
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : rows.length === 0 ? <EmptyState title="No supplier credits" /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Credit</th><th>Supplier</th><th>Reference</th><th>Applied to</th><th className="text-right">Amount</th><th className="text-right px-4">Remaining</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} className="border-b border-gray-50">
                <td className="px-4 py-2 font-mono">{c.credit_number} <StatusBadge status={c.status} /></td><td>{c.supplier.name}</td><td className="text-gray-500">{c.reference}</td>
                <td className="text-gray-500">{c.applications.map((a: any) => a.bill.bill_number).join(", ")}</td>
                <td className="text-right">{money(c.amount)}</td><td className="text-right px-4 font-bold">{money(c.remaining)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {creating && <NewCreditModal accounts={accounts} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </>
  );
};

const AgingTab: React.FC = () => {
  const { companyId } = useBusiness();
  const [r, setR] = useState<any>(null);
  useEffect(() => { accountingApi.apAging(companyId!).then(setR).catch((e) => toast.error(errorMessage(e))); }, [companyId]);
  if (!r) return <Spinner />;
  const cols: [string, string][] = [["current", "Not due"], ["d1_30", "1–30"], ["d31_60", "31–60"], ["d61_90", "61–90"], ["d90_plus", "90+"], ["total", "Total"]];
  return (
    <Card className="overflow-x-auto">
      {r.data.length === 0 ? <EmptyState title="You don't owe any supplier" /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Supplier (days overdue)</th>{cols.map(([k, l]) => <th key={k} className="text-right px-3">{l}</th>)}</tr></thead>
          <tbody>{r.data.map((s: any) => <tr key={s.supplier_id} className="border-b border-gray-50"><td className="px-4 py-2 font-semibold">{s.supplier} <span className="text-gray-400 font-normal">· {s.bills} bill(s)</span></td>{cols.map(([k]) => <td key={k} className={`text-right px-3 font-mono ${k === "total" ? "font-bold" : ""} ${k !== "current" && k !== "total" && s[k] > 0 ? "text-red-700" : ""}`}>{s[k] ? money(s[k]) : "—"}</td>)}</tr>)}</tbody>
          <tfoot><tr className="font-bold"><td className="px-4 py-2">Total</td>{cols.map(([k]) => <td key={k} className="text-right px-3 font-mono">{money(r.totals[k])}</td>)}</tr></tfoot>
        </table>
      )}
    </Card>
  );
};

// ---------------- page ----------------
export const BillsPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const { settings } = useAccountingSettings();
  const { accounts } = useAccounts();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "bills");
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [creating, setCreating] = useState<string | null>(params.get("po") ? params.get("po") : null);
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => {
    accountingApi.bills(companyId!, { status, search, page }).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, status, search, page]);
  useEffect(() => { if (settings?.enabled && tab === "bills") load(); }, [load, settings, tab]);
  if (!settings) return <Spinner />;
  if (!settings.enabled) return <><PageHeader title="Bills" /><SetupFirst /></>;
  const closeNew = () => { setCreating(null); if (params.get("po")) { params.delete("po"); setParams(params, { replace: true }); } };
  return (
    <div>
      <PageHeader title="Bills & supplier credits" subtitle="What you owe suppliers, and paying it"
        actions={can("accounting.manage") && <button onClick={() => setCreating("")} className={btnPrimary}><Plus size={16} /> Enter bill</button>} />
      <div className="mb-3"><FilterTabs value={tab} onChange={setTab} options={[{ value: "bills", label: "Bills" }, { value: "credits", label: "Supplier credits" }, { value: "aging", label: "AP aging" }]} /></div>
      {tab === "credits" && <CreditsTab accounts={accounts} />}
      {tab === "aging" && <AgingTab />}
      {tab === "bills" && (
        <>
          {data && (
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Card className="p-3"><Stat label="Outstanding" value={money(data.summary.outstanding)} /></Card>
              <Card className="p-3"><Stat label="Overdue" value={money(data.summary.overdue)} tone={data.summary.overdue > 0 ? "warn" : "default"} /></Card>
              <Card className="p-3"><Stat label="Due this week" value={money(data.summary.due_this_week)} /></Card>
            </div>
          )}
          <Card className="p-3 mb-3 flex flex-wrap gap-2 items-center">
            <FilterTabs value={status} onChange={(v) => { setPage(1); setStatus(v); }} options={[{ value: "open", label: "Unpaid" }, { value: "overdue", label: "Overdue" }, { value: "paid", label: "Paid" }, { value: "void", label: "Void" }, { value: "", label: "All" }]} />
            <div className="relative ml-auto"><Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" /><input className={`${inputBase} pl-8 w-56`} placeholder="Bill #, supplier, invoice #" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} /></div>
          </Card>
          <Card className="overflow-hidden">
            {!data ? <Spinner /> : data.data.length === 0 ? <EmptyState icon={<Receipt size={36} />} title="No bills here" text="Enter supplier bills by hand, or from a received purchase order." /> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Bill</th><th>Supplier</th><th>Date</th><th>Due</th><th>Status</th><th className="text-right">Total</th><th className="text-right px-4">Balance</th></tr></thead>
                <tbody>{data.data.map((b: any) => (
                  <tr key={b.id} onClick={() => setOpen(b.id)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-2"><span className="font-mono">{b.bill_number}</span>{b.supplier_invoice_number && <span className="text-xs text-gray-500 block">{b.supplier_invoice_number}</span>}</td>
                    <td>{b.supplier.name}</td><td>{dateOnly(b.bill_date)}</td><td className={b.overdue ? "text-red-700 font-semibold" : ""}>{dateOnly(b.due_date)}</td>
                    <td><StatusBadge status={b.overdue ? "overdue" : b.status} /></td>
                    <td className="text-right">{money(b.total_amount)}</td><td className="text-right px-4 font-bold">{money(b.balance)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {data && <Pagination page={page} totalPages={data.totalPages} onChange={setPage} />}
          </Card>
        </>
      )}
      {creating !== null && <NewBillModal poId={creating || undefined} accounts={accounts} onClose={closeNew} onSaved={(id) => { closeNew(); setTab("bills"); load(); setOpen(id); }} />}
      {open && <BillModal id={open} accounts={accounts} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
};
