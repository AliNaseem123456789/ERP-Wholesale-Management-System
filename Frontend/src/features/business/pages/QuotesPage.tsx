import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileSignature, Plus, Search, Trash2, Send, Download, Ban, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { salesApi, customerName } from "../api/sales.api";
import { ProductPicker, PickedProduct, FlavorSelect, hasFlavors } from "../components/supply";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Field, FilterTabs, money, dateOnly, inputCls, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

const STATUS_TABS = [
  { value: "", label: "All" }, { value: "requested", label: "Requested" }, { value: "draft", label: "Drafts" }, { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" }, { value: "declined", label: "Declined" }, { value: "expired", label: "Expired" },
];

export const QuotesPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<any>(null);
  const load = useCallback(() => {
    salesApi.quotes(companyId!, { status, search }).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, status, search]);
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Quotes"
        subtitle="Price offers for customers. Once accepted, a quote becomes an order at the quoted prices."
        actions={can("quotes.manage") && <Link to="/business/quotes/new" className={btnPrimary}><Plus size={16} /> New quote</Link>}
      />
      <Card>
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <FilterTabs value={status} onChange={setStatus} options={STATUS_TABS.map((t) => ({ ...t, count: t.value ? data?.counts?.[t.value] : undefined }))} />
          <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input className={`${inputCls} pl-9`} placeholder="Quote # or customer" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {!data ? <Spinner /> : data.data.length === 0 ? (
          <EmptyState icon={<FileSignature size={40} />} title="No quotes" text="Customers can request a quote from their cart, or you can prepare one for them." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Quote</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Valid until</th><th className="px-4 py-3 text-right">Items</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {data.data.map((q: any) => (
                <tr key={q.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => navigate(`/business/quotes/${q.id}`)}>
                  <td className="px-4 py-3"><p className="font-mono font-bold text-blue-600">{q.quote_number}</p><p className="text-xs text-gray-500">{dateOnly(q.created_at)}</p></td>
                  <td className="px-4 py-3"><p className="font-semibold">{customerName(q.customer)}</p><p className="text-xs text-gray-500">{q.customer?.email}</p></td>
                  <td className="px-4 py-3">{dateOnly(q.valid_until)}</td>
                  <td className="px-4 py-3 text-right">{q.item_count}</td>
                  <td className="px-4 py-3 text-right font-bold">{money(q.total_amount)}</td>
                  <td className="px-4 py-3"><StatusBadge status={q.status} />{q.order && <p className="text-xs font-mono text-gray-500 mt-1">{q.order.order_number}</p>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};

type Line = { product_id: number; title: string; sku?: string | null; flavors?: string[] | null; flavor: string; quantity: string; unit_price: string; description?: string | null };

export const QuoteEditorPage: React.FC = () => {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const { companyId, can } = useBusiness();
  const canManage = can("quotes.manage");
  const navigate = useNavigate();
  const [quote, setQuote] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [picked, setPicked] = useState<PickedProduct | null>(null);
  const [form, setForm] = useState({ discount_amount: "0", shipping_amount: "", valid_until: "", notes: "" });
  const [busy, setBusy] = useState(false);

  const fill = (q: any) => {
    setQuote(q);
    setLines(q.items.map((i: any) => ({ product_id: i.product_id, title: i.title, sku: i.sku, flavors: i.flavors, flavor: i.flavor || "", quantity: String(i.quantity), unit_price: String(i.unit_price), description: i.description })));
    setForm({ discount_amount: String(q.discount_amount), shipping_amount: String(q.shipping_amount), valid_until: q.valid_until?.slice(0, 10) || "", notes: q.notes || "" });
  };
  const load = useCallback(() => {
    if (!isNew) salesApi.quote(companyId!, id!).then(fill).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, id, isNew]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!picked) return;
    // products with flavours can be added once per flavour
    setLines((prev) =>
      !hasFlavors(picked) && prev.some((l) => l.product_id === picked.id)
        ? prev
        : [...prev, { product_id: picked.id, title: picked.title, sku: picked.sku, flavors: picked.flavors, flavor: picked.flavor || "", quantity: "1", unit_price: "" }],
    );
    setPicked(null);
  }, [picked]);

  const editable = canManage && (isNew || ["requested", "draft", "sent"].includes(quote?.status));
  const body = () => ({
    items: lines.map((l) => ({ product_id: l.product_id, flavor: l.flavor || undefined, quantity: Number(l.quantity), unit_price: l.unit_price === "" ? undefined : Number(l.unit_price), description: l.description || undefined })),
    discount_amount: Number(form.discount_amount || 0),
    shipping_amount: form.shipping_amount === "" ? null : Number(form.shipping_amount),
    valid_until: form.valid_until || undefined,
    notes: form.notes,
  });

  const save = async (send: boolean) => {
    if (!lines.length) return toast.error("Add at least one product");
    setBusy(true);
    try {
      if (isNew) {
        const res = await salesApi.createQuote(companyId!, { ...body(), customer_email: email, send });
        toast.success(res.message);
        navigate(`/business/quotes/${res.data.id}`, { replace: true });
      } else {
        const res = await salesApi.updateQuote(companyId!, id!, body());
        if (send) toast.success((await salesApi.sendQuote(companyId!, id!)).message);
        else toast.success(res.message);
        load();
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!window.confirm("Cancel this quote?")) return;
    try {
      toast.success((await salesApi.cancelQuote(companyId!, id!)).message);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (!isNew && !quote) return <Spinner />;
  const preview = lines.reduce((s, l) => s + (l.unit_price === "" ? 0 : Number(l.unit_price) * Number(l.quantity || 0)), 0);

  return (
    <div>
      <Link to="/business/quotes" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-3"><ArrowLeft size={14} /> Quotes</Link>
      <PageHeader
        title={isNew ? "New quote" : `Quote ${quote.quote_number}`}
        subtitle={isNew ? "Prices start at the customer's own price (price list / group discount). Change any line." : [customerName(quote.customer), quote.customer?.email].filter((v, i, a) => v && a.indexOf(v) === i).join(" · ")}
        actions={!isNew && (
          <>
            <span className="self-center"><StatusBadge status={quote.status} /></span>
            <button onClick={() => salesApi.quotePdf(companyId!, quote.id, quote.quote_number).catch((e) => toast.error(e.message))} className={btnSecondary}><Download size={16} /> PDF</button>
          </>
        )}
      />
      {!isNew && quote.customer_notes && <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm"><b>Customer's note:</b> {quote.customer_notes}</div>}
      {!isNew && quote.order && <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-3 text-sm">Accepted {dateOnly(quote.accepted_at)}: became order <Link to={`/business/orders?open=${quote.order.id}`} className="font-mono font-bold text-green-800">{quote.order.order_number}</Link>.</div>}
      {!isNew && quote.status === "sent" && <p className="mb-4 text-sm text-gray-600">Sent {dateOnly(quote.sent_at)}. Editing it moves it back to draft; send it again afterwards.</p>}

      <Card className="p-5 space-y-5">
        {isNew && (
          <Field label="Customer email" hint="The customer needs a marketplace account">
            <input type="email" required className={`${inputCls} max-w-md`} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-2">Product</th><th className="w-28">Qty</th><th className="w-36">Unit price</th><th className="text-right w-28">Amount</th><th className="w-8" /></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {lines.map((l, idx) => (
              <tr key={idx}>
                <td className="py-2">
                  <p className="font-semibold">{l.title}</p><p className="text-xs text-gray-400">{l.sku}</p>
                  {hasFlavors(l) && (
                    editable
                      ? <div className="mt-1 max-w-[200px]"><FlavorSelect product={{ id: l.product_id, title: l.title, flavors: l.flavors }} value={l.flavor} onChange={(f) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, flavor: f } : x)))} /></div>
                      : <p className="text-xs text-blue-700">{l.flavor}</p>
                  )}
                  {!hasFlavors(l) && l.flavor && <p className="text-xs text-blue-700">{l.flavor}</p>}
                </td>
                <td><input disabled={!editable} type="number" min={1} className={`${inputCls} w-24`} value={l.quantity} onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))} /></td>
                <td><input disabled={!editable} type="number" min={0} step="0.0001" placeholder="customer price" className={`${inputCls} w-32`} value={l.unit_price} onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, unit_price: e.target.value } : x)))} /></td>
                <td className="text-right font-semibold">{l.unit_price === "" ? "auto" : money(Number(l.unit_price) * Number(l.quantity || 0))}</td>
                <td className="text-right">{editable && <button onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-600" aria-label="Remove line"><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {editable && <div className="max-w-md"><Field label="Add product"><ProductPicker value={picked} onChange={setPicked} /></Field></div>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Discount (amount)"><input disabled={!editable} type="number" min={0} step="0.01" className={inputCls} value={form.discount_amount} onChange={(e) => setForm({ ...form, discount_amount: e.target.value })} /></Field>
          <Field label="Shipping" hint="Empty = your normal shipping fee"><input disabled={!editable} type="number" min={0} step="0.01" className={inputCls} value={form.shipping_amount} onChange={(e) => setForm({ ...form, shipping_amount: e.target.value })} /></Field>
          <Field label="Valid until" hint="Empty = default validity"><input disabled={!editable} type="date" className={inputCls} value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></Field>
          <div className="md:col-span-4"><Field label="Notes (printed on the quote)"><textarea disabled={!editable} rows={2} className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
        </div>

        {!isNew && (
          <div className="flex flex-col items-end text-sm space-y-0.5">
            <p>Subtotal <b className="ml-3">{money(quote.subtotal)}</b></p>
            {Number(quote.discount_amount) > 0 && <p>Discount <b className="ml-3">-{money(quote.discount_amount)}</b></p>}
            <p>Shipping <b className="ml-3">{money(quote.shipping_amount)}</b></p>
            {Number(quote.tax_amount) > 0 && <p>Tax <b className="ml-3">{money(quote.tax_amount)}</b></p>}
            <p className="text-lg">Total <b className="ml-3">{money(quote.total_amount)}</b></p>
            <p className="text-xs text-gray-400">Totals update when you save.</p>
          </div>
        )}
        {isNew && preview > 0 && <p className="text-right text-sm text-gray-500">Lines with a price: {money(preview)} (tax and shipping are added when you save)</p>}

        {editable && (
          <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
            {!isNew && <button onClick={cancel} className={btnDanger}><Ban size={16} /> Cancel quote</button>}
            <span className="flex-1" />
            <button disabled={busy} onClick={() => save(false)} className={btnSecondary}>Save draft</button>
            <button disabled={busy} onClick={() => save(true)} className={btnPrimary}><Send size={16} /> Save &amp; send to customer</button>
          </div>
        )}
      </Card>
    </div>
  );
};
