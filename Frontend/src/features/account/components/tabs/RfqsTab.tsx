// Account → Requests for quotes: one request sent to several sellers, their offers compared side by side, one awarded.
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { ClipboardList, Plus, Trash2, ArrowLeft, Trophy, X, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "../../../../api/apiClient";
import { RootState } from "../../../../app/store";
import { documentsApi, errorText, money, dateOnly, badgeCls } from "../../api/documents.api";
import { marketplaceApi, CompanyCardT, CategoryNode } from "../../../marketplace/api";

const input = "w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm";
const label = "block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1";
const STATUS: Record<string, string> = { open: "Waiting for offers / your decision", awarded: "Awarded", cancelled: "Withdrawn", closed: "Closed" };

type Line = { description: string; quantity: string; product_id?: number | string; flavor?: string | null };

const NewRfq: React.FC<{ onDone: (id: number) => void; onCancel: () => void }> = ({ onDone, onCancel }) => {
  const cartItems = useSelector((s: RootState) => s.cart.items);
  const [title, setTitle] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1" }]);
  const [mode, setMode] = useState<"sellers" | "category">("sellers");
  const [sellers, setSellers] = useState<CompanyCardT[]>([]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<CompanyCardT[]>([]);
  const [cats, setCats] = useState<CategoryNode[]>([]);
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { marketplaceApi.categories().then(setCats).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => marketplaceApi.companies({ q: q.trim(), limit: 8 }).then((r) => setFound(r.data)).catch(() => setFound([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  const fromCart = () => {
    if (!cartItems.length) return toast.error("Your active cart is empty");
    setLines(cartItems.map((i) => ({ description: `${i.products?.title || "Item"}${i.flavor ? ` · ${i.flavor}` : ""}`, quantity: String(i.quantity), product_id: i.product_id, flavor: i.flavor })));
    const ids = new Map<string, CompanyCardT>();
    cartItems.forEach((i) => i.products?.company && ids.set(String(i.products.company.id), { ...(i.products.company as any) }));
    if (ids.size) setSellers((s) => [...s, ...[...ids.values()].filter((c) => !s.some((x) => String(x.id) === String(c.id)))].slice(0, 10));
    if (!title) setTitle("Prices for my cart");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await documentsApi.createRfq({
        title, notes: notes || undefined, needed_by: neededBy || undefined,
        items: lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), product_id: l.product_id, flavor: l.flavor || undefined })),
        ...(mode === "sellers" ? { company_ids: sellers.map((s) => s.id) } : { category }),
      });
      toast.success(r.message);
      onDone(r.data.id);
    } catch (err) { toast.error(errorText(err)); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <button type="button" onClick={onCancel} className="flex items-center gap-1 text-sm font-bold text-gray-500 hover:text-gray-900"><ArrowLeft size={16} /> Back</button>
      <div>
        <h2 className="text-lg font-black text-gray-900">Ask several sellers for a price</h2>
        <p className="text-sm text-gray-500">Each seller answers privately; you compare the offers here and accept the one you want. The others are told automatically.</p>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block sm:col-span-2"><span className={label}>Title</span><input required maxLength={255} className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cleaning supplies for Q3" /></label>
        <label className="block"><span className={label}>Needed by</span><input type="date" className={input} value={neededBy} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setNeededBy(e.target.value)} /></label>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1"><span className={label}>What you need</span>
          <button type="button" onClick={fromCart} className="text-xs font-bold text-blue-600 hover:underline">Fill from my cart</button></div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input required className={input} value={l.description} maxLength={500} placeholder="Describe the product: brand, size, spec…" aria-label={`Item ${i + 1}`}
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value, product_id: undefined, flavor: undefined } : x)))} />
              <input required type="number" min={1} className={`${input} w-28`} value={l.quantity} aria-label={`Quantity for item ${i + 1}`} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              <button type="button" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ description: "", quantity: "1" }])} className="px-2 text-gray-400 hover:text-red-600" aria-label={`Remove item ${i + 1}`}><Trash2 size={16} /></button>
            </div>
          ))}
          {lines.length < 100 && <button type="button" onClick={() => setLines([...lines, { description: "", quantity: "1" }])} className="text-sm font-bold text-blue-600"><Plus size={14} className="inline" /> Add item</button>}
        </div>
      </div>
      <div>
        <span className={label}>Send to</span>
        <div className="flex gap-4 text-sm mb-2">
          <label className="flex items-center gap-2"><input type="radio" checked={mode === "sellers"} onChange={() => setMode("sellers")} /> Sellers I choose (up to 10)</label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === "category"} onChange={() => setMode("category")} /> The main sellers of a category</label>
        </div>
        {mode === "sellers" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {sellers.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 rounded-full pl-3 pr-1 py-1 text-xs font-semibold">
                  {s.name}<button type="button" onClick={() => setSellers(sellers.filter((x) => x.id !== s.id))} className="p-0.5 hover:text-red-600" aria-label={`Remove ${s.name}`}><X size={12} /></button>
                </span>
              ))}
              {!sellers.length && <span className="text-sm text-gray-500">No sellers chosen yet.</span>}
            </div>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className={`${input} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find sellers by name or city" aria-label="Find sellers" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {found.filter((c) => !sellers.some((s) => s.id === c.id)).map((c) => (
                <button type="button" key={c.id} disabled={sellers.length >= 10} onClick={() => setSellers([...sellers, c])} className="px-3 py-1 rounded-full border border-gray-300 text-xs font-semibold text-gray-700 hover:border-gray-500 disabled:opacity-40">
                  + {c.name}{c.city ? ` · ${c.city}` : ""}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <select required className={input} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">Choose a category…</option>
            {cats.flatMap((c) => [c, ...(c.children || [])]).map((c) => <option key={c.id} value={c.slug}>{c.parent_id ? "— " : ""}{c.name}</option>)}
          </select>
        )}
      </div>
      <label className="block"><span className={label}>Notes for the sellers</span><textarea rows={3} maxLength={4000} className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery location, packaging, payment terms you need…" /></label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-gray-300 font-bold text-sm text-gray-700">Cancel</button>
        <button disabled={busy || (mode === "sellers" ? !sellers.length : !category)} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold text-sm disabled:opacity-50">{busy ? "Sending…" : "Send request"}</button>
      </div>
    </form>
  );
};

const AwardForm: React.FC<{ rfqId: number; offer: any; onDone: () => void; onCancel: () => void }> = ({ rfqId, offer, onDone, onCancel }) => {
  const navigate = useNavigate();
  const [addresses, setAddresses] = useState<any[]>([]);
  const [addressId, setAddressId] = useState("");
  const [method, setMethod] = useState("cash_on_delivery");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    apiClient.get("/address").then((r) => {
      const list = r.data.data || [];
      setAddresses(list);
      const d = list.find((a: any) => a.is_default) || list[0];
      if (d) setAddressId(String(d.id));
    }).catch(() => {});
  }, []);
  const award = async () => {
    setBusy(true);
    try {
      toast.success((await documentsApi.awardRfq(rfqId, { quote_id: offer.quote_id, shipping_address_id: Number(addressId), payment_method: method })).message);
      onDone();
      navigate("/account?tab=orders");
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3 text-sm mt-3">
      <p className="font-bold text-gray-900">Accept {offer.company.name}'s offer for {money(offer.total)} and place the order</p>
      {addresses.length === 0 ? <button onClick={() => navigate("/account?tab=addresses")} className="text-blue-700 font-bold">+ Add a shipping address first</button> : (
        <select className={input} value={addressId} onChange={(e) => setAddressId(e.target.value)} aria-label="Ship to">
          {addresses.map((a) => <option key={a.id} value={a.id}>{[a.full_name, a.address_line1, a.city, a.state].filter(Boolean).join(", ")}</option>)}
        </select>
      )}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2"><input type="radio" checked={method === "cash_on_delivery"} onChange={() => setMethod("cash_on_delivery")} /> Cash on delivery</label>
        <label className="flex items-center gap-2"><input type="radio" checked={method === "on_account"} onChange={() => setMethod("on_account")} /> On account (if this seller gave you terms)</label>
      </div>
      <p className="text-xs text-gray-500">The other sellers are told their offers weren't chosen.</p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-gray-300 bg-white font-bold text-gray-700">Back</button>
        <button disabled={busy || !addressId} onClick={award} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-50">{busy ? "Placing order…" : "Accept & place order"}</button>
      </div>
    </div>
  );
};

const RfqDetail: React.FC<{ id: number; onBack: () => void }> = ({ id, onBack }) => {
  const [r, setR] = useState<any>(null);
  const [awarding, setAwarding] = useState<any>(null);
  const load = () => documentsApi.rfq(id).then(setR).catch((e) => { toast.error(errorText(e)); onBack(); });
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" size={28} /></div>;
  const priced = r.offers.filter((o: any) => o.total !== undefined);
  const waiting = r.offers.filter((o: any) => o.total === undefined);
  const cancel = async () => {
    if (!window.confirm("Withdraw this request? Sellers who haven't answered are told.")) return;
    try { toast.success((await documentsApi.cancelRfq(id)).message); load(); } catch (e) { toast.error(errorText(e)); }
  };
  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold text-gray-500 hover:text-gray-900"><ArrowLeft size={16} /> All requests</button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-gray-500">{r.rfq_number}</p>
          <h2 className="text-xl font-black text-gray-900">{r.title} <span className={badgeCls(r.status)}>{r.status}</span></h2>
          <p className="text-sm text-gray-500">{r.items.length} items · {r.requested_units} units{r.needed_by ? ` · needed by ${dateOnly(r.needed_by)}` : ""} · sent {dateOnly(r.created_at)}</p>
        </div>
        {r.status === "open" && <button onClick={cancel} className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-bold">Withdraw request</button>}
      </div>
      <details className="text-sm bg-gray-50 rounded-xl p-3">
        <summary className="font-bold cursor-pointer text-gray-800">What you asked for</summary>
        <ul className="mt-2 space-y-0.5">{r.items.map((i: any) => <li key={i.id}>{i.quantity} × {i.description}</li>)}</ul>
        {r.notes && <p className="mt-2 text-gray-600">{r.notes}</p>}
      </details>

      {priced.length === 0 ? (
        <div className="text-center py-10 bg-gray-50 rounded-2xl border-2 border-dashed text-sm text-gray-500">No offers yet. We'll email you as sellers answer.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[560px]">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-500 border-b">
                <th className="py-2">Seller</th><th className="text-right">Total</th><th className="text-right">Units</th><th className="text-center">Delivery</th><th className="text-center">Valid until</th><th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {priced.map((o: any) => (
                <React.Fragment key={o.quote_id}>
                  <tr className={o.best ? "bg-green-50/60" : ""}>
                    <td className="py-3 pr-2">
                      <p className="font-bold text-gray-900">{o.company.name} {o.best && <span className="inline-flex items-center gap-0.5 text-[10px] font-black uppercase text-green-700 ml-1"><Trophy size={11} /> lowest</span>}</p>
                      <p className="text-xs text-gray-500">{o.quote_number}{o.version > 1 ? ` · v${o.version}` : ""} · <span className={badgeCls(o.status)}>{o.status}</span></p>
                    </td>
                    <td className="text-right font-black text-gray-900">{money(o.total)}<span className="block text-[11px] font-normal text-gray-500">shipping {money(o.shipping)}</span></td>
                    <td className={`text-right ${o.covers_all === false ? "text-amber-700 font-semibold" : ""}`} title={o.covers_all === false ? "Fewer units than you asked for" : undefined}>{o.units}/{r.requested_units}</td>
                    <td className="text-center">{o.lead_time_days != null ? `${o.lead_time_days} days` : "—"}</td>
                    <td className="text-center">{dateOnly(o.valid_until)}</td>
                    <td className="text-right whitespace-nowrap pl-2">
                      {o.can_accept && r.status === "open" && <button onClick={() => setAwarding(o)} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold">Accept</button>}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={6} className="pb-3">
                      <details className="text-xs text-gray-600">
                        <summary className="cursor-pointer text-blue-600 font-semibold">Lines{o.notes ? " & note" : ""}</summary>
                        <div className="mt-1 space-y-0.5">
                          {o.lines.map((l: any, i: number) => <p key={i}>{l.quantity} × {l.title} @ {money(l.unit_price)} = <b>{money(l.line_total)}</b></p>)}
                          {o.notes && <p className="italic">“{o.notes}”</p>}
                          <p>To ask {o.company.name} for changes, open {o.quote_number} under <a href="/account?tab=quotes" className="text-blue-600 font-semibold">Quotes</a>.</p>
                        </div>
                      </details>
                      {awarding?.quote_id === o.quote_id && <AwardForm rfqId={r.id} offer={o} onDone={() => { setAwarding(null); load(); }} onCancel={() => setAwarding(null)} />}
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {waiting.length > 0 && (
        <p className="text-sm text-gray-500">Still waiting for: {waiting.map((o: any) => `${o.company.name} (${o.status === "countered" ? "revising after your counter-offer" : o.status === "requested" || o.status === "draft" ? "preparing" : o.status})`).join(", ")}</p>
      )}
    </div>
  );
};

export const RfqsTab: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<any[] | null>(null);
  const view = params.get("rfq");
  const go = (v: string | null) => { const n = new URLSearchParams(params); v ? n.set("rfq", v) : n.delete("rfq"); setParams(n); };
  const load = () => documentsApi.rfqs().then(setRows).catch((e) => { toast.error(errorText(e)); setRows([]); });
  useEffect(() => { if (!view) load(); }, [view]);

  if (view === "new") return <NewRfq onDone={(id) => go(String(id))} onCancel={() => go(null)} />;
  if (view) return <RfqDetail id={Number(view)} onBack={() => go(null)} />;
  if (!rows) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" size={28} /></div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500 max-w-xl">Send one request to several sellers and compare their prices, delivery times and terms side by side.</p>
        <button onClick={() => go("new")} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm"><Plus size={16} /> New request</button>
      </div>
      {rows.length === 0 ? (
        <div className="p-16 text-center bg-gray-50 rounded-3xl border-2 border-dashed">
          <ClipboardList className="mx-auto text-gray-400 mb-3" size={40} />
          <p className="text-gray-600 font-medium">No requests yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100">
          {rows.map((r) => (
            <button key={r.id} onClick={() => go(String(r.id))} className="w-full flex flex-wrap items-center gap-3 px-5 py-4 text-left hover:bg-gray-50">
              <span className="flex-1 min-w-[200px]">
                <span className="block font-bold text-gray-900">{r.title} <span className={badgeCls(r.status)}>{r.status}</span></span>
                <span className="block text-xs text-gray-500">{r.rfq_number} · {r.item_count} items · {STATUS[r.status] || r.status}</span>
              </span>
              <span className="text-sm text-gray-700">{r.offers}/{r.seller_count} offers</span>
              <span className="text-sm font-black text-gray-900 w-28 text-right">{r.best_total != null ? `from ${money(r.best_total)}` : "—"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
