// Admin → Site → Hero: the homepage slides, their buttons, who sees them and when, and the layout.
import React, { useState } from "react";
import { ChevronDown, ChevronRight, Plus, RotateCcw, Save, Eye } from "lucide-react";
import { toast } from "sonner";
import { siteAdminApi, HeroConfig, HeroButton } from "../../../site/api";
import { Hero } from "../../../site/Hero";
import { Card, Field, inputCls, btnPrimary, btnSecondary } from "../../../business/components/ui";
import { ImageField } from "../../../business/components/pickers";
import { RowTools, useDrag, move, newId, upload, errText, toLocal, fromLocal } from "./shared";

type Slide = HeroConfig["slides"][number];

const Buttons: React.FC<{ value: HeroButton[]; onChange: (v: HeroButton[]) => void; label: string; hint?: string }> = ({ value, onChange, label, hint }) => (
  <div>
    <p className="text-xs font-bold text-gray-600 uppercase mb-1">{label}</p>
    {hint && <p className="text-xs text-gray-400 mb-2">{hint}</p>}
    <div className="space-y-2">
      {value.map((b, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_130px_auto] gap-2">
          <input className={inputCls} value={b.label} maxLength={40} placeholder="Button text" aria-label={`${label} ${i + 1} text`} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <input className={inputCls} value={b.link} placeholder="/register" aria-label={`${label} ${i + 1} link`} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, link: e.target.value } : x)))} />
          <select className={inputCls} value={b.style} aria-label={`${label} ${i + 1} style`} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, style: e.target.value as HeroButton["style"] } : x)))}>
            <option value="primary">Filled</option><option value="secondary">Outline</option>
          </select>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">Remove</button>
        </div>
      ))}
      {value.length < 2 && <button type="button" className={btnSecondary} onClick={() => onChange([...value, { label: "", link: "", style: value.length ? "secondary" : "primary" }])}><Plus size={14} /> Add button</button>}
    </div>
  </div>
);

export const HeroEditor: React.FC<{ initial: HeroConfig; onSaved: () => void }> = ({ initial, onSaved }) => {
  const [h, setH] = useState<HeroConfig>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<"visitor" | "buyer" | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useDrag(h.slides, (slides) => setH({ ...h, slides }));
  const dirty = JSON.stringify(h) !== saved;
  const setSlide = (id: string, p: Partial<Slide>) => setH({ ...h, slides: h.slides.map((s) => (s.id === id ? { ...s, ...p } : s)) });

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast.error(errText(e)); } finally { setBusy(false); } };
  const save = () => run(async () => { const r = await siteAdminApi.saveHero(h); setH(r.data); setSaved(JSON.stringify(r.data)); toast.success(r.message); onSaved(); });
  const reset = () => run(async () => {
    if (!window.confirm("Put back the original five slides? Your slides are replaced.")) return;
    const r = await siteAdminApi.resetHero(); setH(r.data); setSaved(JSON.stringify(r.data)); toast.success(r.message);
  });

  // the preview shows what a visitor / signed-in buyer would see today
  const previewData = preview && {
    layout: h.layout, interval: h.interval, thumbnails: h.thumbnails,
    slides: h.slides.filter((s) => s.enabled && (s.audience === "all" || (s.audience === "buyers") === (preview === "buyer")) && (!s.starts_at || new Date(s.starts_at) <= new Date()) && (!s.ends_at || new Date(s.ends_at) >= new Date()))
      .map((s) => ({ ...s, buttons: s.buttons.length ? s.buttons : preview === "buyer" ? h.buyer_buttons : h.visitor_buttons })),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Hero</h3>
          <p className="text-sm text-gray-500">The big rotating banner at the top of the homepage.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={reset} disabled={busy} className={btnSecondary}><RotateCcw size={14} /> Original slides</button>
          <button onClick={() => setPreview("visitor")} className={btnSecondary}><Eye size={14} /> Preview</button>
          <button onClick={save} disabled={busy || !dirty} className={btnPrimary}><Save size={14} /> {busy ? "Saving…" : "Save hero"}</button>
        </div>
      </div>
      {dirty && <p className="text-sm bg-blue-50 text-blue-800 rounded-lg px-3 py-2">Unsaved changes.</p>}

      <Card className="p-4 grid md:grid-cols-4 gap-3">
        <Field label="Layout">
          <select className={inputCls} value={h.layout} onChange={(e) => setH({ ...h, layout: e.target.value as HeroConfig["layout"] })}>
            <option value="full">Full-width picture</option><option value="split">Text beside the picture</option><option value="search">Search first</option>
          </select>
        </Field>
        <Field label="Change slide every (seconds)"><input type="number" min={3} max={20} className={inputCls} value={h.interval} onChange={(e) => setH({ ...h, interval: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-2 text-sm md:col-span-2 self-end pb-2"><input type="checkbox" checked={h.thumbnails} onChange={(e) => setH({ ...h, thumbnails: e.target.checked })} /> Show small pictures of the slides (full-width layout)</label>
      </Card>

      <Card className="p-4 grid md:grid-cols-2 gap-6">
        <Buttons label="Buttons for visitors" hint="Used by slides without their own buttons, for people not signed in" value={h.visitor_buttons} onChange={(v) => setH({ ...h, visitor_buttons: v })} />
        <Buttons label="Buttons for signed-in buyers" value={h.buyer_buttons} onChange={(v) => setH({ ...h, buyer_buttons: v })} />
      </Card>

      <div className="space-y-2">
        {h.slides.map((s, i) => {
          const isOpen = open === s.id;
          const scheduled = s.starts_at || s.ends_at;
          return (
            <div key={s.id} {...drag.props(i)}>
              <Card className={`p-3 ${s.enabled ? "" : "opacity-60"} ${drag.over === i ? "ring-2 ring-blue-300" : ""}`}>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen} className="flex-1 flex items-center gap-3 text-left min-w-0">
                    {isOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                    <span className="w-20 h-12 rounded-md bg-gray-100 overflow-hidden shrink-0">{s.image_url && <img src={s.image_url} alt="" className="w-full h-full object-cover" />}</span>
                    <span className="min-w-0">
                      <span className="block font-bold text-gray-900 truncate">{[s.title, s.highlight].filter(Boolean).join(" ") || "(no headline)"}</span>
                      <span className="block text-xs text-gray-500">{s.audience === "all" ? "Everyone" : s.audience === "buyers" ? "Signed-in buyers" : "Visitors"}{scheduled ? " · scheduled" : ""}{!s.enabled ? " · hidden" : ""}</span>
                    </span>
                  </button>
                  <RowTools i={i} count={h.slides.length} label={`slide ${i + 1}`} handle={drag.handle(i)} onMove={(to) => setH({ ...h, slides: move(h.slides, i, to) })}
                    hidden={!s.enabled} onToggle={() => setSlide(s.id, { enabled: !s.enabled })}
                    onDuplicate={h.slides.length < 8 ? () => { const c = { ...s, id: newId("slide") }; const n = [...h.slides]; n.splice(i + 1, 0, c); setH({ ...h, slides: n }); } : undefined}
                    onRemove={h.slides.length > 1 ? () => setH({ ...h, slides: h.slides.filter((x) => x.id !== s.id) }) : undefined} />
                </div>
                {isOpen && (
                  <div className="space-y-3 pt-3 mt-3 border-t border-gray-100">
                    <div className="grid md:grid-cols-2 gap-3">
                      <Field label="Picture" hint="Wide, at least 1600 × 700"><ImageField value={s.image_url} upload={upload} onChange={(v) => setSlide(s.id, { image_url: v })} /></Field>
                      <Field label="Phone picture (optional)" hint="Taller, e.g. 800 × 1000; otherwise the main picture is used"><ImageField value={s.mobile_image_url || ""} upload={upload} onChange={(v) => setSlide(s.id, { mobile_image_url: v })} /></Field>
                    </div>
                    <Field label="Picture description"><input className={inputCls} value={s.image_alt || ""} maxLength={200} onChange={(e) => setSlide(s.id, { image_alt: e.target.value })} /></Field>
                    <div className="grid md:grid-cols-2 gap-3">
                      <Field label="Headline"><input className={inputCls} value={s.title} maxLength={80} onChange={(e) => setSlide(s.id, { title: e.target.value })} /></Field>
                      <Field label="Second line" hint="Shown on its own line"><input className={inputCls} value={s.highlight} maxLength={80} onChange={(e) => setSlide(s.id, { highlight: e.target.value })} /></Field>
                    </div>
                    <Field label="Text"><textarea rows={2} className={inputCls} value={s.subtitle} maxLength={300} onChange={(e) => setSlide(s.id, { subtitle: e.target.value })} /></Field>
                    <Buttons label="This slide's buttons" hint="Leave empty to use the buttons above" value={s.buttons} onChange={(v) => setSlide(s.id, { buttons: v })} />
                    <div className="grid md:grid-cols-3 gap-3">
                      <Field label="Who sees it">
                        <select className={inputCls} value={s.audience} onChange={(e) => setSlide(s.id, { audience: e.target.value as Slide["audience"] })}>
                          <option value="all">Everyone</option><option value="visitors">Only visitors (not signed in)</option><option value="buyers">Only signed-in buyers</option>
                        </select>
                      </Field>
                      <Field label="Starts" hint="Optional"><input type="datetime-local" className={inputCls} value={toLocal(s.starts_at)} onChange={(e) => setSlide(s.id, { starts_at: fromLocal(e.target.value) })} /></Field>
                      <Field label="Ends" hint="Optional"><input type="datetime-local" className={inputCls} value={toLocal(s.ends_at)} onChange={(e) => setSlide(s.id, { ends_at: fromLocal(e.target.value) })} /></Field>
                    </div>
                  </div>
                )}
              </Card>
            </div>
          );
        })}
      </div>
      {h.slides.length < 8 && (
        <button className={btnSecondary} onClick={() => { const s: Slide = { id: newId("slide"), enabled: true, image_url: "", mobile_image_url: "", image_alt: "", title: "", highlight: "", subtitle: "", buttons: [], audience: "all", starts_at: null, ends_at: null }; setH({ ...h, slides: [...h.slides, s] }); setOpen(s.id); }}>
          <Plus size={14} /> Add slide
        </button>
      )}

      {preview && previewData && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex flex-col" role="dialog" aria-modal="true" aria-label="Hero preview">
          <div className="bg-gray-900 text-white px-4 py-2 flex flex-wrap gap-2 items-center justify-between text-sm">
            <span><b>Preview</b> as {preview === "buyer" ? "a signed-in buyer" : "a visitor"}, today. Not saved yet.</span>
            <div className="flex gap-2">
              <button onClick={() => setPreview(preview === "buyer" ? "visitor" : "buyer")} className="bg-white/10 px-3 py-1.5 rounded font-semibold">Show as {preview === "buyer" ? "visitor" : "buyer"}</button>
              <button onClick={() => setPreview(null)} className="bg-white/10 px-3 py-1.5 rounded font-semibold">Close</button>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-white">
            {previewData.slides.length ? <Hero hero={previewData} /> : <p className="p-10 text-center text-gray-500">No slide is shown to this audience today, so the hero is left out.</p>}
          </div>
        </div>
      )}
    </div>
  );
};
