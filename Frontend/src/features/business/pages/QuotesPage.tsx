import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileSignature, Plus, Search, Trash2, Send, Download, Ban, ArrowLeft, AlertTriangle, MessageSquare, History, Users } from "lucide-react";
import { MessageBubble } from "../../account/components/QuoteNegotiation";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { salesApi, customerName } from "../api/sales.api";
import { ProductPicker, PickedProduct, FlavorSelect, hasFlavors } from "../components/supply";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Field, FilterTabs, money, dateOnly, inputCls, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

const STATUS_TABS = [
  { value: "", label: "All" }, { value: "requested", label: "Requested" }, { value: "draft", label: "Drafts" }, { value: "sent", label: "Sent" }, { value: "countered", label: "Counter-offers" },
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

type Line = { item_id?: number; product_id: number; title: string; sku?: string | null; flavors?: string[] | null; flavor: string; quantity: string; unit_price: string; description?: string | null };

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
  const [form, setForm] = useState({ discount_amount: "0", shipping_amount: "", valid_until: "", notes: "", lead_time_days: "" });
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const fill = (q: any) => {
    setQuote(q);
    setLines(q.items.map((i: any) => ({ item_id: i.id, product_id: i.product_id, title: i.title, sku: i.sku, flavors: i.flavors, flavor: i.flavor || "", quantity: String(i.quantity), unit_price: String(i.unit_price), description: i.description })));
    setForm({ discount_amount: String(q.discount_amount), shipping_amount: String(q.shipping_amount), valid_until: q.valid_until?.slice(0, 10) || "", notes: q.notes || "", lead_time_days: q.lead_time_days == null ? "" : String(q.lead_time_days) });
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

  const editable = canManage && (isNew || ["requested", "draft", "sent", "countered"].includes(quote?.status));
  const body = () => ({
    items: lines.map((l) => ({ product_id: l.product_id, flavor: l.flavor || undefined, quantity: Number(l.quantity), unit_price: l.unit_price === "" ? undefined : Number(l.unit_price), description: l.description || undefined })),
    discount_amount: Number(form.discount_amount || 0),
    shipping_amount: form.shipping_amount === "" ? null : Number(form.shipping_amount),
    valid_until: form.valid_until || undefined,
    notes: form.notes,
    lead_time_days: form.lead_time_days === "" ? null : Number(form.lead_time_days),
  });

  // Sending is refused for lines below cost when the company blocks that; pricing managers may send anyway.
  const sendNow = async (quoteId: number | string) => {
    try {
      const r = await salesApi.sendQuote(companyId!, quoteId);
      toast.success(r.message);
      setWarnings(r.warnings || []);
    } catch (err: any) {
      const msg = errorMessage(err);
      if (/below cost/i.test(msg) && can("pricing.manage") && window.confirm(`${msg}\n\nSend it anyway?`)) {
        const r = await salesApi.sendQuote(companyId!, quoteId, { override_margin: true });
        toast.success(r.message);
        setWarnings(r.warnings || []);
      } else throw err;
    }
  };
  const postMessage = async () => {
    if (!message.trim()) return;
    try {
      fill((await salesApi.quoteMessage(companyId!, id!, message.trim())).data);
      setMessage("");
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const applyCounter = async (messageId: number) => {
    try {
      const r = await salesApi.applyCounter(companyId!, id!, messageId);
      toast.success(r.message);
      fill(r.data);
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const save = async (send: boolean) => {
    if (!lines.length) return toast.error("Add at least one product");
    setBusy(true);
    try {
      if (isNew) {
        const res = await salesApi.createQuote(companyId!, { ...body(), customer_email: email });
        if (send) await sendNow(res.data.id);
        else toast.success(res.message);
        navigate(`/business/quotes/${res.data.id}`, { replace: true });
      } else {
        const res = await salesApi.updateQuote(companyId!, id!, body());
        if (send) await sendNow(id!);
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
  const marginOf = (l: Line) => (l.item_id ? quote?.margin?.lines?.find((m: any) => String(m.item_id) === String(l.item_id)) : null);
  const allWarnings = [...new Set([...(quote?.margin_warnings || []), ...warnings])];
  const titleOf = (itemId: number) => quote?.items?.find((i: any) => String(i.id) === String(itemId))?.title || "a line from an earlier version";
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
      {!isNew && quote.rfq && (
        <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-sm">
          <p className="font-bold text-indigo-900 flex items-center gap-1"><Users size={15} /> Competitive request {quote.rfq.rfq_number}: {quote.rfq.title}</p>
          <p className="text-indigo-800">The customer sent this request to several sellers and will compare offers. You don't see the other offers.{quote.rfq.needed_by ? ` Needed by ${dateOnly(quote.rfq.needed_by)}.` : ""}{quote.rfq.status !== "open" ? ` The request is ${quote.rfq.status}.` : ""}</p>
          {quote.rfq.rfq_items?.length > 0 && <ul className="mt-1 text-indigo-900 list-disc pl-5">{quote.rfq.rfq_items.map((i: any) => <li key={i.id}>{i.quantity} × {i.description}</li>)}</ul>}
          <p className="text-xs text-indigo-700 mt-1">Add the matching products from your catalogue below, then send.</p>
        </div>
      )}
      {!isNew && quote.status === "countered" && <div className="mb-4 bg-purple-50 border border-purple-200 rounded-xl p-3 text-sm text-purple-900"><b>The customer asked for changes.</b> See their proposal in the conversation below: apply it, or change the quote yourself, then send it again.</div>}
      {allWarnings.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
          <p className="font-bold flex items-center gap-1"><AlertTriangle size={15} /> Margin check</p>
          <ul className="list-disc pl-5">{allWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
          {quote?.margin?.block_below_cost && quote?.margin?.below_cost && <p className="text-xs mt-1">Your sales settings block sending below cost{can("pricing.manage") ? "; you can still send it as a pricing manager." : "."}</p>}
        </div>
      )}
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
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-2">Product</th><th className="w-28">Qty</th><th className="w-36">Unit price</th><th className="text-right w-28">Amount</th>{!isNew && <th className="text-right w-20">Margin</th>}<th className="w-8" /></tr></thead>
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
                {!isNew && (() => {
                  const m = marginOf(l);
                  const changed = m && quote.items.find((i: any) => i.id === l.item_id) && String(quote.items.find((i: any) => i.id === l.item_id).unit_price) !== l.unit_price;
                  return (
                    <td className={`text-right text-xs font-semibold ${m?.below_cost ? "text-red-600" : m?.below_min ? "text-amber-600" : "text-gray-500"}`} title={m ? `Cost ${money(m.cost)}` : "Save to see the margin"}>
                      {m && !changed && m.cost > 0 ? `${m.margin_percent}%` : "—"}
                    </td>
                  );
                })()}
                <td className="text-right">{editable && <button onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-600" aria-label="Remove line"><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {editable && <div className="max-w-md"><Field label="Add product"><ProductPicker value={picked} onChange={setPicked} /></Field></div>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Discount (amount)"><input disabled={!editable} type="number" min={0} step="0.01" className={inputCls} value={form.discount_amount} onChange={(e) => setForm({ ...form, discount_amount: e.target.value })} /></Field>
          <Field label="Shipping" hint="Empty = your normal shipping fee"><input disabled={!editable} type="number" min={0} step="0.01" className={inputCls} value={form.shipping_amount} onChange={(e) => setForm({ ...form, shipping_amount: e.target.value })} /></Field>
          <Field label="Delivery (days)" hint="Shown to the customer"><input disabled={!editable} type="number" min={0} max={365} className={inputCls} value={form.lead_time_days} onChange={(e) => setForm({ ...form, lead_time_days: e.target.value })} /></Field>
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
            {quote.margin && quote.margin.cost > 0 && <p className={`text-xs ${quote.margin.below_cost ? "text-red-600" : quote.margin.below_min ? "text-amber-600" : "text-gray-500"}`}>Margin {quote.margin.margin_percent}% (cost {money(quote.margin.cost)}){quote.margin.min_margin != null ? ` · minimum ${quote.margin.min_margin}%` : ""}</p>}
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

      {!isNew && (
        <div className="grid lg:grid-cols-[1fr_320px] gap-4 mt-4">
          <Card className="p-5">
            <p className="font-bold text-gray-900 flex items-center gap-1 mb-3"><MessageSquare size={15} /> Conversation with the customer</p>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {(quote.messages || []).length === 0 ? <p className="text-sm text-gray-500">No messages yet.</p> : quote.messages.map((m: any) => (
                <div key={m.id}>
                  <MessageBubble m={m} mine={m.author_side === "seller"} titleOf={titleOf} />
                  {m.author_side === "customer" && m.proposal && editable && m.version === quote.version && (
                    <div className="flex justify-start mt-1"><button onClick={() => applyCounter(m.id)} className="text-xs font-bold text-purple-700 hover:underline">Apply this proposal to the quote</button></div>
                  )}
                </div>
              ))}
            </div>
            {canManage && !["accepted", "declined", "cancelled", "expired"].includes(quote.status) && (
              <div className="flex gap-2 mt-3">
                <input className={inputCls} value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && postMessage()} placeholder="Message the customer (they're emailed)" aria-label="Message the customer" />
                <button onClick={postMessage} disabled={!message.trim()} className={btnPrimary} aria-label="Send message"><Send size={15} /></button>
              </div>
            )}
          </Card>
          <Card className="p-5 text-sm">
            <p className="font-bold text-gray-900 flex items-center gap-1 mb-2"><History size={15} /> Versions sent</p>
            {(quote.versions || []).length === 0 ? <p className="text-gray-500">Not sent yet.</p> : (
              <ul className="space-y-1.5">
                {quote.versions.map((v: any) => (
                  <li key={v.version} className="flex justify-between gap-2">
                    <span>v{v.version} · {dateOnly(v.created_at)}{v.version === quote.version ? <span className="text-xs text-gray-400"> (latest)</span> : null}</span>
                    <b>{money(v.snapshot?.total)}</b>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};
