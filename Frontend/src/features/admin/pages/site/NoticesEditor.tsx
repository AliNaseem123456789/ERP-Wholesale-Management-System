// Admin → Site → Notices: the announcement bar at the top of every page, and notices shown with the products of a
// category (e.g. a nicotine warning on Smoking & Vape pages, their products, and at checkout when the cart has them).
import React, { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { siteAdminApi, NoticesConfig, NoticeStyle } from "../../../site/api";
import { NoticeList } from "../../../site/widgets";
import { Card, Field, inputCls, btnPrimary, btnSecondary } from "../../../business/components/ui";
import { Options, newId, errText, toLocal, fromLocal, categoryTree } from "./shared";

const STYLES: [NoticeStyle, string][] = [["dark", "Dark"], ["info", "Blue"], ["warning", "Yellow (warning)"], ["promo", "Pink (promotion)"]];

export const NoticesEditor: React.FC<{ initial: NoticesConfig; opts: Options; onSaved: () => void }> = ({ initial, opts, onSaved }) => {
  const [n, setN] = useState<NoticesConfig>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(n) !== saved;
  const bar = n.bar;
  const setBar = (p: Partial<NoticesConfig["bar"]>) => setN({ ...n, bar: { ...bar, ...p } });
  const setNotice = (id: string, p: Partial<NoticesConfig["category_notices"][number]>) => setN({ ...n, category_notices: n.category_notices.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const cats = categoryTree(opts.categories);

  const save = async () => {
    setBusy(true);
    try { const r = await siteAdminApi.saveNotices(n); setN(r.data); setSaved(JSON.stringify(r.data)); toast.success(r.message); onSaved(); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Notices</h3>
          <p className="text-sm text-gray-500">An announcement bar for everyone, and warnings that only appear with the products they're about.</p>
        </div>
        <button onClick={save} disabled={busy || !dirty} className={btnPrimary}><Save size={14} /> {busy ? "Saving…" : "Save notices"}</button>
      </div>
      {dirty && <p className="text-sm bg-blue-50 text-blue-800 rounded-lg px-3 py-2">Unsaved changes.</p>}

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-bold text-gray-900">Announcement bar</p>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={bar.enabled} onChange={(e) => setBar({ enabled: e.target.checked, items: e.target.checked && !bar.items.length ? [""] : bar.items })} /> Show it</label>
        </div>
        <div className="space-y-2">
          {bar.items.map((t, i) => (
            <div key={i} className="flex gap-2">
              <input className={inputCls} value={t} maxLength={200} placeholder="e.g. Free delivery on orders over $500 this week" aria-label={`Message ${i + 1}`} onChange={(e) => setBar({ items: bar.items.map((x, j) => (j === i ? e.target.value : x)) })} />
              <button type="button" onClick={() => setBar({ items: bar.items.filter((_, j) => j !== i) })} className="p-2 text-gray-400 hover:text-red-600" aria-label={`Remove message ${i + 1}`}><Trash2 size={16} /></button>
            </div>
          ))}
          {bar.items.length < 6 && <button type="button" className={btnSecondary} onClick={() => setBar({ items: [...bar.items, ""] })}><Plus size={14} /> Add message</button>}
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <Field label="Link (optional)"><input className={inputCls} value={bar.link} placeholder="/deals" onChange={(e) => setBar({ link: e.target.value })} /></Field>
          <Field label="Link text"><input className={inputCls} value={bar.link_label} maxLength={40} placeholder="Shop now" onChange={(e) => setBar({ link_label: e.target.value })} /></Field>
          <Field label="Colour"><select className={inputCls} value={bar.style} onChange={(e) => setBar({ style: e.target.value as NoticeStyle })}>{STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Who sees it"><select className={inputCls} value={bar.audience} onChange={(e) => setBar({ audience: e.target.value as any })}><option value="all">Everyone</option><option value="visitors">Visitors</option><option value="buyers">Signed-in buyers</option></select></Field>
          <Field label="Starts" hint="Optional"><input type="datetime-local" className={inputCls} value={toLocal(bar.starts_at)} onChange={(e) => setBar({ starts_at: fromLocal(e.target.value) })} /></Field>
          <Field label="Ends" hint="Optional"><input type="datetime-local" className={inputCls} value={toLocal(bar.ends_at)} onChange={(e) => setBar({ ends_at: fromLocal(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 text-sm md:col-span-2 self-end pb-2"><input type="checkbox" checked={bar.scrolling} onChange={(e) => setBar({ scrolling: e.target.checked })} /> Scroll the messages across (like a ticker)</label>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <p className="font-bold text-gray-900">Notices for categories</p>
          <p className="text-sm text-gray-500">Shown on a category's pages and its products (sub-categories included), and in the cart and checkout when the cart has those products.</p>
        </div>
        {n.category_notices.map((x) => (
          <div key={x.id} className="border border-gray-200 rounded-xl p-3 space-y-3">
            <div className="grid md:grid-cols-[1fr_1fr_160px_auto] gap-2 items-end">
              <Field label="Category">
                <select className={inputCls} value={x.category_id} onChange={(e) => setNotice(x.id, { category_id: e.target.value })}>
                  <option value="">Choose…</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{"— ".repeat(c.depth)}{c.name}</option>)}
                </select>
              </Field>
              <Field label="Title (optional)"><input className={inputCls} value={x.title} maxLength={80} placeholder="Warning" onChange={(e) => setNotice(x.id, { title: e.target.value })} /></Field>
              <Field label="Colour"><select className={inputCls} value={x.style} onChange={(e) => setNotice(x.id, { style: e.target.value as NoticeStyle })}>{STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <button type="button" onClick={() => setN({ ...n, category_notices: n.category_notices.filter((y) => y.id !== x.id) })} className="p-2 text-gray-400 hover:text-red-600 mb-1" aria-label="Remove notice"><Trash2 size={16} /></button>
            </div>
            <Field label="Notice"><textarea rows={2} className={inputCls} value={x.text} maxLength={1000} onChange={(e) => setNotice(x.id, { text: e.target.value })} /></Field>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={x.on_category} onChange={(e) => setNotice(x.id, { on_category: e.target.checked })} /> On category pages</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={x.on_product} onChange={(e) => setNotice(x.id, { on_product: e.target.checked })} /> On product pages</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={x.on_checkout} onChange={(e) => setNotice(x.id, { on_checkout: e.target.checked })} /> In the cart and checkout</label>
            </div>
            {x.text && <NoticeList notices={[x]} />}
          </div>
        ))}
        {n.category_notices.length < 30 && (
          <button type="button" className={btnSecondary} onClick={() => setN({ ...n, category_notices: [...n.category_notices, { id: newId("notice"), category_id: "", title: "", text: "", style: "warning", on_category: true, on_product: true, on_checkout: true }] })}>
            <Plus size={14} /> Add notice
          </button>
        )}
      </Card>
    </div>
  );
};
