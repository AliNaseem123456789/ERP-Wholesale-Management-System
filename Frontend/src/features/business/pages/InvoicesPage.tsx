import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FileText, Search, Mail, Ban, Download, Plus, Trash2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { salesApi, PAYMENT_METHODS, paymentLabel, customerName } from "../api/sales.api";
import { isMoneyAccount } from "../api/accounting.api";
import { useAccounts, useAccountingSettings, AccountSelect } from "../components/accounting";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Pagination, Modal, Field, FilterTabs, Stat, money, dateOnly, inputCls, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

const todayStr = () => new Date().toISOString().slice(0, 10);

// Money accounts for choosing where a payment lands (only once accounting is set up).
const useBooks = () => {
  const { settings } = useAccountingSettings();
  const { accounts } = useAccounts();
  return { enabled: !!settings?.enabled, accounts };
};

// ---------------- payment / credit forms ----------------
const PaymentForm: React.FC<{ invoice: any; onDone: () => void; onCancel: () => void }> = ({ invoice, onDone, onCancel }) => {
  const { companyId } = useBusiness();
  const [form, setForm] = useState({ amount: String(invoice.balance), method: "bank_transfer", reference: "", paid_at: todayStr(), notes: "", notify: true, account_id: "" });
  const books = useBooks();
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      toast.success((await salesApi.addPayment(companyId!, invoice.id, { ...form, amount: Number(form.amount), account_id: form.account_id ? Number(form.account_id) : undefined })).message);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-green-50/60 border border-green-100 rounded-xl p-3">
      <Field label="Amount"><input type="number" step="0.01" min="0.01" max={invoice.balance} required className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
      <Field label="Method">
        <select className={inputCls} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </Field>
      <Field label="Date"><input type="date" className={inputCls} value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} /></Field>
      <Field label="Reference"><input className={inputCls} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Check # / transfer ID" /></Field>
      {books.enabled && (
        <Field label="Deposit to" hint="Blank: cash for cash payments, otherwise the bank account">
          <AccountSelect accounts={books.accounts} filter={isMoneyAccount} value={form.account_id} onChange={(v) => setForm({ ...form, account_id: v })} placeholder="Default account" ariaLabel="Deposit to" />
        </Field>
      )}
      <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} /> Email the customer a receipt</label>
      <div className="col-span-2 flex justify-end gap-2"><button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button><button disabled={busy} className={btnPrimary}>Record payment</button></div>
    </form>
  );
};

const CreditForm: React.FC<{ invoice: any; onDone: () => void; onCancel: () => void }> = ({ invoice, onDone, onCancel }) => {
  const { companyId } = useBusiness();
  const [form, setForm] = useState({ amount: "", reason: "", notes: "", apply: true });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      toast.success((await salesApi.createCreditNote(companyId!, { invoice_id: invoice.id, ...form, amount: Number(form.amount) })).message);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 bg-amber-50/60 border border-amber-100 rounded-xl p-3">
      <Field label="Credit amount (incl. tax)"><input type="number" step="0.01" min="0.01" required className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
      <Field label="Reason"><input required className={inputCls} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Price adjustment, goodwill..." /></Field>
      <div className="col-span-2"><Field label="Notes (printed on the credit note)"><input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.apply} onChange={(e) => setForm({ ...form, apply: e.target.checked })} /> Apply to this invoice's balance</label>
      <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button><button disabled={busy} className={btnPrimary}>Issue credit note</button></div>
    </form>
  );
};

// ---------------- invoice detail ----------------
export const InvoiceDetail: React.FC<{ id: number; onClose: () => void; onChanged?: () => void }> = ({ id, onClose, onChanged }) => {
  const { companyId, can } = useBusiness();
  const canManage = can("invoices.manage");
  const [inv, setInv] = useState<any>(null);
  const [mode, setMode] = useState<"" | "pay" | "credit">("");
  const load = useCallback(() => {
    salesApi.invoice(companyId!, id).then(setInv).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, id]);
  useEffect(load, [load]);
  const changed = () => {
    setMode("");
    load();
    onChanged?.();
  };
  const act = async (fn: () => Promise<any>) => {
    try {
      toast.success((await fn()).message);
      changed();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const open = ["issued", "partially_paid"].includes(inv?.status);

  return (
    <Modal title={inv ? `Invoice ${inv.invoice_number}` : "Invoice"} onClose={onClose} wide>
      {!inv ? <Spinner /> : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={inv.status} />
            {inv.overdue && <StatusBadge status="overdue" />}
            <span className="text-gray-500">Issued {dateOnly(inv.issue_date)} · due {dateOnly(inv.due_date)}{inv.overdue ? ` (${inv.days_overdue} days late)` : ""}</span>
            {inv.order && <Link to={`/business/orders?open=${inv.order.id}`} className="font-mono text-blue-600 font-bold">{inv.order.order_number}</Link>}
            <span className="flex-1" />
            <button onClick={() => salesApi.invoicePdf(companyId!, inv.id, inv.invoice_number).catch((e) => toast.error(e.message))} className={btnSecondary}><Download size={16} /> PDF</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Customer" value={<span className="text-sm">{customerName(inv.customer)}</span>} />
            <Stat label="Total" value={money(inv.total_amount)} />
            <Stat label="Paid + credited" value={money(Number(inv.amount_paid) + Number(inv.amount_credited))} tone="good" />
            <Stat label="Balance due" value={money(inv.balance)} tone={inv.balance > 0 ? "warn" : "default"} />
          </div>

          <table className="w-full">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Item</th><th className="text-center">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {inv.invoice_items.map((i: any) => (
                <tr key={i.id}><td className="py-1.5">{i.description}</td><td className="text-center">{i.quantity}</td><td className="text-right">{money(i.unit_price)}</td><td className="text-right font-semibold">{money(i.line_total)}</td></tr>
              ))}
            </tbody>
            <tfoot className="text-right">
              <tr><td colSpan={3} className="pt-2 text-gray-500">Subtotal</td><td className="pt-2">{money(inv.subtotal)}</td></tr>
              {Number(inv.discount_amount) > 0 && <tr><td colSpan={3} className="text-gray-500">Discount</td><td>-{money(inv.discount_amount)}</td></tr>}
              <tr><td colSpan={3} className="text-gray-500">Shipping</td><td>{money(inv.shipping_amount)}</td></tr>
              {Number(inv.tax_amount) > 0 && <tr><td colSpan={3} className="text-gray-500">Tax</td><td>{money(inv.tax_amount)}</td></tr>}
              <tr><td colSpan={3} className="font-bold">Total</td><td className="font-black">{money(inv.total_amount)}</td></tr>
            </tfoot>
          </table>

          <div>
            <h3 className="font-bold mb-2">Payments</h3>
            {inv.invoice_payments.length === 0 ? <p className="text-gray-500">No payments yet. {inv.payment_method === "cash_on_delivery" && "Cash on delivery is recorded automatically when the order is delivered."}</p> : (
              <ul className="divide-y divide-gray-100">
                {inv.invoice_payments.map((p: any) => (
                  <li key={p.id} className="py-1.5 flex items-center gap-3">
                    <span>{dateOnly(p.paid_at)}</span><span className="font-semibold">{paymentLabel(p.method)}</span>
                    <span className="text-gray-500">{p.reference}</span>
                    <span className="ml-auto font-bold">{money(p.amount)}</span>
                    {canManage && inv.status !== "void" && (
                      <button onClick={() => window.confirm("Remove this payment?") && act(() => salesApi.removePayment(companyId!, inv.id, p.id))} className="text-gray-400 hover:text-red-600" aria-label="Remove payment"><Trash2 size={14} /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {inv.credit_notes?.length > 0 && (
            <div>
              <h3 className="font-bold mb-2">Credit notes against this invoice</h3>
              <ul className="divide-y divide-gray-100">
                {inv.credit_notes.map((c: any) => (
                  <li key={c.id} className="py-1.5 flex items-center gap-3">
                    <Link to={`/business/invoices?tab=credits&open=${c.id}`} className="font-mono font-bold text-blue-600">{c.credit_note_number}</Link>
                    <StatusBadge status={c.status} /><span className="ml-auto">{money(c.total_amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {canManage && open && inv.available_credits?.some((c: any) => c.remaining > 0) && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
              <p className="font-semibold mb-2">This customer has open credit:</p>
              {inv.available_credits.filter((c: any) => c.remaining > 0).map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 py-1">
                  <span className="font-mono">{c.credit_note_number}</span><span>{money(c.remaining)} available</span>
                  <button onClick={() => act(() => salesApi.applyCreditNote(companyId!, c.id, inv.id))} className="ml-auto text-blue-700 font-bold">Apply to this invoice</button>
                </div>
              ))}
            </div>
          )}

          {mode === "pay" && <PaymentForm invoice={inv} onDone={changed} onCancel={() => setMode("")} />}
          {mode === "credit" && <CreditForm invoice={inv} onDone={changed} onCancel={() => setMode("")} />}

          {canManage && inv.status !== "void" && !mode && (
            <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
              {Number(inv.amount_paid) === 0 && Number(inv.amount_credited) === 0 && (
                <button onClick={() => window.confirm(`Void ${inv.invoice_number}? This can't be undone.`) && act(() => salesApi.voidInvoice(companyId!, inv.id))} className={btnDanger}><Ban size={16} /> Void</button>
              )}
              <span className="flex-1" />
              <button onClick={() => act(() => salesApi.sendInvoice(companyId!, inv.id))} className={btnSecondary}><Mail size={16} /> Email to customer</button>
              <button onClick={() => setMode("credit")} className={btnSecondary}><Receipt size={16} /> Credit note</button>
              {open && <button onClick={() => setMode("pay")} className={btnPrimary}><Plus size={16} /> Record payment</button>}
            </div>
          )}
          {inv.sent_at && <p className="text-xs text-gray-400">Last emailed {dateOnly(inv.sent_at)}</p>}
        </div>
      )}
    </Modal>
  );
};

// ---------------- credit note detail ----------------
const CreditNoteDetail: React.FC<{ id: number; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const { companyId, can } = useBusiness();
  const canManage = can("invoices.manage");
  const [cn, setCn] = useState<any>(null);
  const books = useBooks();
  const [refundFrom, setRefundFrom] = useState("");
  const load = useCallback(() => {
    salesApi.creditNote(companyId!, id).then(setCn).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, id]);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<any>) => {
    try {
      toast.success((await fn()).message);
      load();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal title={cn ? `Credit note ${cn.credit_note_number}` : "Credit note"} onClose={onClose} wide>
      {!cn ? <Spinner /> : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={cn.status} />
            <span className="text-gray-500">{dateOnly(cn.created_at)} · {customerName(cn.customer)}</span>
            {cn.invoice && <span>Invoice <b className="font-mono">{cn.invoice.invoice_number}</b></span>}
            {cn.return_request && <Link to={`/business/returns?open=${cn.return_request.id}`} className="font-mono text-blue-600 font-bold">{cn.return_request.rma_number}</Link>}
            <span className="flex-1" />
            <button onClick={() => salesApi.creditNotePdf(companyId!, cn.id, cn.credit_note_number).catch((e) => toast.error(e.message))} className={btnSecondary}><Download size={16} /> PDF</button>
          </div>
          {cn.reason && <p className="text-gray-700">Reason: {cn.reason}</p>}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Credit total" value={money(cn.total_amount)} />
            <Stat label="Applied" value={money(cn.amount_applied)} />
            <Stat label="Refunded" value={money(cn.amount_refunded)} />
            <Stat label="Remaining" value={money(cn.remaining)} tone={cn.remaining > 0 ? "good" : "default"} />
          </div>
          <table className="w-full">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Line</th><th className="text-center">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{cn.credit_note_items.map((i: any) => <tr key={i.id}><td className="py-1">{i.description}</td><td className="text-center">{i.quantity}</td><td className="text-right">{money(i.unit_price)}</td><td className="text-right">{money(i.line_total)}</td></tr>)}</tbody>
            <tfoot className="text-right"><tr><td colSpan={3} className="text-gray-500 pt-2">Tax</td><td className="pt-2">{money(cn.tax_amount)}</td></tr></tfoot>
          </table>

          {canManage && cn.status === "issued" && cn.remaining > 0 && (
            <div className="space-y-3 pt-3 border-t border-gray-100">
              {cn.open_invoices.length > 0 && (
                <div>
                  <p className="font-semibold mb-1">Apply to an open invoice</p>
                  {cn.open_invoices.map((i: any) => (
                    <div key={i.id} className="flex items-center gap-3 py-1">
                      <span className="font-mono">{i.invoice_number}</span><span className="text-gray-500">balance {money(i.balance)} · due {dateOnly(i.due_date)}</span>
                      <button onClick={() => act(() => salesApi.applyCreditNote(companyId!, cn.id, i.id))} className="ml-auto text-blue-700 font-bold">Apply</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {Number(cn.amount_applied) === 0 && Number(cn.amount_refunded) === 0 && <button onClick={() => window.confirm("Void this credit note?") && act(() => salesApi.voidCreditNote(companyId!, cn.id))} className={btnDanger}><Ban size={16} /> Void</button>}
                <span className="flex-1" />
                <button onClick={() => act(() => salesApi.sendCreditNote(companyId!, cn.id))} className={btnSecondary}><Mail size={16} /> Email</button>
                {books.enabled && (
                  <div className="w-56"><AccountSelect accounts={books.accounts} filter={isMoneyAccount} value={refundFrom} onChange={setRefundFrom} placeholder="Refund from: bank" ariaLabel="Refund from" /></div>
                )}
                <button onClick={() => window.confirm(`Record that ${money(cn.remaining)} was refunded to the customer?`) && act(() => salesApi.refundCreditNote(companyId!, cn.id, refundFrom ? { account_id: Number(refundFrom) } : {}))} className={btnPrimary}>Mark {money(cn.remaining)} refunded</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

// ---------------- page ----------------
const INVOICE_TABS = [
  { value: "", label: "All" }, { value: "open", label: "Open" }, { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" }, { value: "void", label: "Void" },
];

const InvoicesList: React.FC = () => {
  const { companyId } = useBusiness();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const [status, setStatus] = useState(search ? "" : "open");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const openId = params.get("open");

  const load = useCallback(() => {
    salesApi.invoices(companyId!, { status, search, page }).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, status, search, page]);
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <>
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <Stat label="Outstanding" value={money(data.summary.outstanding)} />
          <Stat label="Overdue" value={money(data.summary.overdue)} tone={data.summary.overdue > 0 ? "warn" : "default"} />
          <Stat label="Overdue invoices" value={data.summary.overdue_count} tone={data.summary.overdue_count > 0 ? "warn" : "default"} />
        </div>
      )}
      <Card>
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <FilterTabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={INVOICE_TABS} />
          <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input className={`${inputCls} pl-9`} placeholder="Invoice #, order # or customer" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>
        {!data ? <Spinner /> : data.data.length === 0 ? (
          <EmptyState icon={<FileText size={40} />} title="No invoices here" text="Invoices are created automatically when an order ships (see Sales settings), or from an order." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Issued</th><th className="px-4 py-3">Due</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Balance</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {data.data.map((i: any) => (
                  <tr key={i.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setParams({ open: String(i.id) })}>
                    <td className="px-4 py-3"><p className="font-mono font-bold text-blue-600">{i.invoice_number}</p><p className="text-xs text-gray-500">{i.order?.order_number}</p></td>
                    <td className="px-4 py-3"><p className="font-semibold">{customerName(i.customer)}</p><p className="text-xs text-gray-500">{paymentLabel(i.payment_method)}</p></td>
                    <td className="px-4 py-3">{dateOnly(i.issue_date)}</td>
                    <td className={`px-4 py-3 ${i.overdue ? "text-red-600 font-bold" : ""}`}>{dateOnly(i.due_date)}{i.overdue && <p className="text-[10px]">{i.days_overdue} days late</p>}</td>
                    <td className="px-4 py-3 text-right">{money(i.total_amount)}</td>
                    <td className="px-4 py-3 text-right font-bold">{i.status === "void" ? "—" : money(i.balance)}</td>
                    <td className="px-4 py-3"><StatusBadge status={i.overdue ? "overdue" : i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={page} totalPages={data.totalPages} onChange={setPage} />}
      </Card>
      {openId && <InvoiceDetail id={Number(openId)} onClose={() => setParams({})} onChanged={load} />}
    </>
  );
};

const CreditNotesList: React.FC = () => {
  const { companyId } = useBusiness();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("");
  const [list, setList] = useState<any[] | null>(null);
  const openId = params.get("open");
  const load = useCallback(() => {
    salesApi.creditNotes(companyId!, { status }).then(setList).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, status]);
  useEffect(load, [load]);
  return (
    <Card>
      <div className="p-4 border-b border-gray-100">
        <FilterTabs value={status} onChange={setStatus} options={[{ value: "", label: "All" }, { value: "issued", label: "Open credit" }, { value: "applied", label: "Applied" }, { value: "refunded", label: "Refunded" }, { value: "void", label: "Void" }]} />
      </div>
      {!list ? <Spinner /> : list.length === 0 ? <EmptyState icon={<Receipt size={40} />} title="No credit notes" text="Credit notes come from returns, or from an invoice (price adjustments, goodwill)." /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Credit note</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">For</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Remaining</th><th className="px-4 py-3">Status</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {list.map((c) => (
              <tr key={c.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setParams({ tab: "credits", open: String(c.id) })}>
                <td className="px-4 py-3"><p className="font-mono font-bold text-blue-600">{c.credit_note_number}</p><p className="text-xs text-gray-500">{dateOnly(c.created_at)}</p></td>
                <td className="px-4 py-3">{customerName(c.customer)}</td>
                <td className="px-4 py-3 text-xs">{[c.invoice?.invoice_number, c.return_request?.rma_number].filter(Boolean).join(" · ") || "—"}<p className="text-gray-500">{c.reason}</p></td>
                <td className="px-4 py-3 text-right">{money(c.total_amount)}</td>
                <td className="px-4 py-3 text-right font-bold">{money(c.remaining)}</td>
                <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {openId && <CreditNoteDetail id={Number(openId)} onClose={() => setParams({ tab: "credits" })} onChanged={load} />}
    </Card>
  );
};

export const InvoicesPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "invoices";
  return (
    <div>
      <PageHeader title="Invoices & payments" subtitle="What customers owe you, payments received and credit notes" />
      <div className="mb-4">
        <FilterTabs value={tab} onChange={(v) => setParams(v === "invoices" ? {} : { tab: v })} options={[{ value: "invoices", label: "Invoices" }, { value: "credits", label: "Credit notes" }]} />
      </div>
      {tab === "credits" ? <CreditNotesList /> : <InvoicesList />}
    </div>
  );
};
