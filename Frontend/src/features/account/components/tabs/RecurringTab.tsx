// Account → Recurring orders: the same lines every week, two weeks or month, placed automatically or prepared for review.
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { Repeat, Plus, Pause, Play, Trash2, Pencil, SkipForward, Zap } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "../../../../api/apiClient";
import { AppDispatch } from "../../../../app/store";
import { fetchCart, setActiveCart } from "../../../cart/redux/cartSlice";
import { buyingApi, buyingError, Recurring, DAYS, scheduleText } from "../../api/buying.api";
import { orderService } from "../../api/order.api";
import { cartsApi, CartInfo } from "../../../cart/components/CartSwitcher";

const input = "w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm";
const label = "block text-xs font-bold text-gray-600 uppercase tracking-wide mb-1";

type Source = { kind: "order"; id: string } | { kind: "cart"; id: string } | null;

/** Create / edit form. `source` prefills the lines from a past order or a cart (create only). */
export const RecurringEditor: React.FC<{ existing?: Recurring | null; source?: Source; onClose: () => void; onSaved: () => void }> = ({ existing, source: initialSource, onClose, onSaved }) => {
  const [addresses, setAddresses] = useState<{ id: string; text: string; is_default: boolean }[]>([]);
  const [orders, setOrders] = useState<{ id: string; text: string }[]>([]);
  const [carts, setCarts] = useState<CartInfo[]>([]);
  const [source, setSource] = useState<Source>(initialSource || null);
  const [f, setF] = useState({
    name: existing?.name || "",
    frequency: existing?.frequency || "weekly",
    day_of_week: String(existing?.day_of_week ?? 1),
    day_of_month: String(existing?.day_of_month ?? 1),
    mode: existing?.mode || "review",
    start_on: "",
    shipping_address_id: existing?.shipping_address_id ? String(existing.shipping_address_id) : "",
  });
  const [items, setItems] = useState(existing?.items.map((i) => ({ product_id: i.product_id, flavor: i.flavor, quantity: i.quantity, title: i.title, company: i.product.company })) || []);
  const [payments, setPayments] = useState<Record<string, string>>(existing?.payment_methods || {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.get("/address").then((r) => {
      const list = (r.data.data || []).map((a: any) => ({ id: String(a.id), text: [a.full_name, a.address_line1, a.city].filter(Boolean).join(", "), is_default: a.is_default }));
      setAddresses(list);
      if (!existing) setF((x) => ({ ...x, shipping_address_id: x.shipping_address_id || list.find((a: any) => a.is_default)?.id || list[0]?.id || "" }));
    }).catch(() => {});
    if (!existing) {
      orderService.getMyOrders().then((o) => setOrders(o.slice(0, 30).map((x: any) => ({ id: String(x.id), text: `${x.order_number || `#${x.id}`} · ${x.company?.name || ""} · ${new Date(x.created_at).toLocaleDateString()}` })))).catch(() => {});
      cartsApi.list().then((c) => setCarts(c.filter((x) => x.line_count > 0))).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sellers = [...new Map(items.filter((i) => i.company).map((i) => [String(i.company!.id), i.company!])).values()];
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: f.name, frequency: f.frequency, mode: f.mode,
        ...(f.frequency === "monthly" ? { day_of_month: Number(f.day_of_month) } : { day_of_week: Number(f.day_of_week) }),
        shipping_address_id: f.shipping_address_id || null,
        payment_methods: Object.fromEntries(sellers.map((s) => [String(s.id), payments[String(s.id)] || "cash_on_delivery"])),
      };
      if (f.start_on) body.start_on = f.start_on;
      if (existing) {
        body.items = items.map((i) => ({ product_id: i.product_id, flavor: i.flavor, quantity: i.quantity }));
        toast.success((await buyingApi.updateRecurring(existing.id, body)).message);
      } else {
        if (!source) throw new Error("Choose which order or cart to repeat");
        body[source.kind === "order" ? "from_order_id" : "from_cart_id"] = source.id;
        toast.success((await buyingApi.createRecurring(body)).message);
      }
      onSaved();
    } catch (err) {
      toast.error(buyingError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <form onSubmit={save} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Recurring order"
        className="bg-white text-gray-900 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <h2 className="font-bold text-lg">{existing ? `Edit “${existing.name}”` : "New recurring order"}</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block"><span className={label}>Name</span><input required maxLength={120} className={input} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Weekly restock" /></label>
          {!existing && (
            <label className="block"><span className={label}>Repeat these items</span>
              <select required className={input} value={source ? `${source.kind}:${source.id}` : ""} onChange={(e) => { const [k, id] = e.target.value.split(":"); setSource(k ? { kind: k as "order" | "cart", id } : null); }}>
                <option value="">Choose…</option>
                {source && !orders.some((o) => `order:${o.id}` === `${source.kind}:${source.id}`) && !carts.some((c) => `cart:${c.id}` === `${source.kind}:${source.id}`) && <option value={`${source.kind}:${source.id}`}>The selected {source.kind}</option>}
                {carts.length > 0 && <optgroup label="A cart">{carts.map((c) => <option key={c.id} value={`cart:${c.id}`}>{c.name} ({c.line_count} lines)</option>)}</optgroup>}
                {orders.length > 0 && <optgroup label="A past order">{orders.map((o) => <option key={o.id} value={`order:${o.id}`}>{o.text}</option>)}</optgroup>}
              </select>
            </label>
          )}
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block"><span className={label}>How often</span>
            <select className={input} value={f.frequency} onChange={(e) => set("frequency", e.target.value)}>
              <option value="weekly">Every week</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Every month</option>
            </select>
          </label>
          {f.frequency === "monthly" ? (
            <label className="block"><span className={label}>Day of the month</span>
              <select className={input} value={f.day_of_month} onChange={(e) => set("day_of_month", e.target.value)}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select>
            </label>
          ) : (
            <label className="block"><span className={label}>Day</span>
              <select className={input} value={f.day_of_week} onChange={(e) => set("day_of_week", e.target.value)}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
            </label>
          )}
          <label className="block"><span className={label}>First run on or after</span><input type="date" className={input} value={f.start_on} min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} onChange={(e) => set("start_on", e.target.value)} /></label>
        </div>
        <fieldset className="space-y-2">
          <legend className={label}>When it's due</legend>
          <label className="flex items-start gap-2 text-sm"><input type="radio" name="mode" checked={f.mode === "review"} onChange={() => set("mode", "review")} className="mt-1" />
            <span><b>Prepare a cart for me to check</b><span className="block text-gray-500">We fill a cart with these items and email you; you review and place it.</span></span></label>
          <label className="flex items-start gap-2 text-sm"><input type="radio" name="mode" checked={f.mode === "auto"} onChange={() => set("mode", "auto")} className="mt-1" />
            <span><b>Place the order automatically</b><span className="block text-gray-500">Same checks as checkout. If something is unavailable, we prepare a cart instead and tell you why.</span></span></label>
        </fieldset>
        <label className="block"><span className={label}>Deliver to {f.mode === "auto" && "*"}</span>
          <select className={input} value={f.shipping_address_id} required={f.mode === "auto"} onChange={(e) => set("shipping_address_id", e.target.value)}>
            <option value="">{f.mode === "auto" ? "Choose an address" : "Choose at checkout"}</option>
            {addresses.map((a) => <option key={a.id} value={a.id}>{a.text}</option>)}
          </select>
        </label>
        {f.mode === "auto" && sellers.length > 0 && (
          <div className="space-y-2">
            <span className={label}>Payment per seller</span>
            {sellers.map((s) => (
              <label key={s.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{s.name}</span>
                <select className={`${input} w-auto`} value={payments[String(s.id)] || "cash_on_delivery"} onChange={(e) => setPayments({ ...payments, [String(s.id)]: e.target.value })}>
                  <option value="cash_on_delivery">Pay on delivery</option><option value="on_account">On account (if approved)</option>
                </select>
              </label>
            ))}
          </div>
        )}
        {existing && (
          <div>
            <span className={label}>Items</span>
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {items.map((i, idx) => (
                <div key={`${i.product_id}|${i.flavor}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1">{i.title}<span className="block text-xs text-gray-500">{i.company?.name}</span></span>
                  <input type="number" min={1} className={`${input} w-24`} value={i.quantity} aria-label={`Quantity of ${i.title}`} onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} />
                  <button type="button" onClick={() => setItems(items.filter((_, j) => j !== idx))} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${i.title}`}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 font-semibold text-sm">Cancel</button>
          <button disabled={saving || (!!existing && items.length === 0)} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
};

export const RecurringTab: React.FC = () => {
  const [rows, setRows] = useState<Recurring[] | null>(null);
  const [editing, setEditing] = useState<Recurring | "new" | null>(null);
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const load = () => buyingApi.recurring().then(setRows).catch((e) => { toast.error(buyingError(e)); setRows([]); });
  useEffect(() => { load(); }, []);

  const act = async (fn: () => Promise<{ message: string }>) => { try { toast.success((await fn()).message); load(); } catch (e) { toast.error(buyingError(e)); } };
  const openCart = (cartId?: number) => {
    if (!cartId) return;
    dispatch(setActiveCart(String(cartId)));
    dispatch(fetchCart(String(cartId)));
    navigate("/cart");
  };

  if (!rows) return <div className="p-10 text-center text-gray-500">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500 max-w-xl">Order the same things on a schedule. Prices and stock are checked each time, so you always pay the current price.</p>
        <button onClick={() => setEditing("new")} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm"><Plus size={16} /> New recurring order</button>
      </div>
      {rows.length === 0 ? (
        <div className="p-16 text-center bg-gray-50 rounded-3xl border-2 border-dashed">
          <Repeat className="mx-auto text-gray-400 mb-3" size={40} />
          <p className="text-gray-600 font-medium">No recurring orders yet.</p>
          <p className="text-sm text-gray-500">Open a past order and choose “Make recurring”, or start from a cart.</p>
        </div>
      ) : rows.map((r) => (
        <div key={r.id} className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-bold text-gray-900">{r.name}
                <span className={`ml-2 text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${r.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{r.status}</span>
                <span className="ml-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{r.mode === "auto" ? "automatic" : "review first"}</span>
              </p>
              <p className="text-sm text-gray-500">{scheduleText(r)} · {r.items.length} items{r.status === "active" && <> · next <b className="text-gray-800">{new Date(`${r.next_run_on}T00:00:00`).toLocaleDateString()}</b>{r.skip_next && " (will be skipped)"}</>}</p>
              {r.last_result && (
                <p className={`text-xs mt-1 ${r.last_result.ok ? "text-gray-500" : "text-amber-700"}`}>
                  Last run {r.last_result.ran_on ? new Date(`${r.last_result.ran_on}T00:00:00`).toLocaleDateString() : ""}: {r.last_result.message}
                  {r.last_result.cart_id && <button onClick={() => openCart(r.last_result!.cart_id)} className="ml-2 font-bold text-blue-600 hover:underline">Open cart</button>}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setEditing(r)} className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50" title="Edit" aria-label="Edit"><Pencil size={15} /></button>
              {r.status === "active" && <button onClick={() => act(() => buyingApi.updateRecurring(r.id, { skip_next: !r.skip_next }))} className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50" title={r.skip_next ? "Don't skip the next run" : "Skip the next run"} aria-label="Skip next"><SkipForward size={15} /></button>}
              <button onClick={() => act(() => buyingApi.updateRecurring(r.id, { status: r.status === "active" ? "paused" : "active" }))} className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50" title={r.status === "active" ? "Pause" : "Resume"} aria-label={r.status === "active" ? "Pause" : "Resume"}>{r.status === "active" ? <Pause size={15} /> : <Play size={15} />}</button>
              <button onClick={async () => { try { const x = await buyingApi.runRecurring(r.id); toast.success(x.message); load(); if (x.data.cart_id) openCart(x.data.cart_id); } catch (e) { toast.error(buyingError(e)); } }} className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50" title="Run now (the schedule doesn't change)" aria-label="Run now"><Zap size={15} /></button>
              <button onClick={() => window.confirm(`Stop "${r.name}"? Past orders are kept.`) && act(() => buyingApi.cancelRecurring(r.id))} className="p-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50" title="Stop" aria-label="Stop"><Trash2 size={15} /></button>
            </div>
          </div>
          <ul className="mt-3 text-sm text-gray-700 grid sm:grid-cols-2 gap-x-6">
            {r.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 py-0.5">
                <span className={i.product.status !== "published" ? "line-through text-gray-400" : ""}>{i.title}</span>
                <span className="text-gray-500 tabular-nums">× {i.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {editing && <RecurringEditor existing={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
};
