// Platform admin → Site: the top menu, homepage hero, notices, homepage layout and the overall look.
import React, { useEffect, useState } from "react";
import { Menu, Image, Bell, LayoutTemplate, Palette, Save } from "lucide-react";
import { toast } from "sonner";
import { siteAdminApi, SiteAdmin, Appearance } from "../../site/api";
import { useSite } from "../../site/SiteContext";
import { Card, Spinner, btnPrimary } from "../../business/components/ui";
import { useOptions, errText } from "./site/shared";
import { MenuEditor } from "./site/MenuEditor";
import { HeroEditor } from "./site/HeroEditor";
import { NoticesEditor } from "./site/NoticesEditor";
import { HomepageEditor } from "./site/HomepageEditor";

const LOOKS: { style: Appearance["style"]; name: string; text: string; swatch: string[] }[] = [
  { style: "neon", name: "Neon", text: "The original: dark galaxy header, cyan and pink accents.", swatch: ["#000000", "#22d3ee", "#ec4899"] },
  { style: "clean", name: "Clean", text: "Neutral and light, for a general B2B marketplace: white header, blue accents.", swatch: ["#ffffff", "#2563eb", "#0f172a"] },
];

const LookEditor: React.FC<{ initial: Appearance; onSaved: () => void }> = ({ initial, onSaved }) => {
  const [a, setA] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(a) !== JSON.stringify(initial);
  const save = async () => {
    setBusy(true);
    try { toast.success((await siteAdminApi.saveAppearance(a)).message); onSaved(); } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-lg font-bold text-gray-900">Look</h3><p className="text-sm text-gray-500">How the marketplace looks to buyers. Company storefronts keep their own themes.</p></div>
        <button onClick={save} disabled={busy || !dirty} className={btnPrimary}><Save size={14} /> {busy ? "Saving…" : "Save look"}</button>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {LOOKS.map((l) => (
          <button key={l.style} type="button" onClick={() => setA({ ...a, style: l.style })} aria-pressed={a.style === l.style}
            className={`text-left rounded-2xl border-2 p-4 bg-white ${a.style === l.style ? "border-blue-600 ring-4 ring-blue-100" : "border-gray-200 hover:border-gray-400"}`}>
            <div className="flex gap-1.5 mb-3">{l.swatch.map((c) => <span key={c} className="w-8 h-8 rounded-lg border border-gray-200" style={{ background: c }} />)}</div>
            <p className="font-bold text-gray-900">{l.name}</p>
            <p className="text-sm text-gray-500">{l.text}</p>
          </button>
        ))}
      </div>
      <Card className="p-4 space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-semibold text-gray-700">Start in</span>
          <label className="flex items-center gap-2"><input type="radio" checked={a.default_mode === "light"} onChange={() => setA({ ...a, default_mode: "light" })} /> Light mode</label>
          <label className="flex items-center gap-2"><input type="radio" checked={a.default_mode === "dark"} onChange={() => setA({ ...a, default_mode: "dark" })} /> Dark mode</label>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={a.allow_toggle} onChange={(e) => setA({ ...a, allow_toggle: e.target.checked })} /> Let buyers switch between light and dark (the sun / moon button)</label>
      </Card>
    </div>
  );
};

const TABS = [
  { id: "menu", label: "Menu", icon: Menu },
  { id: "hero", label: "Hero", icon: Image },
  { id: "notices", label: "Notices", icon: Bell },
  { id: "homepage", label: "Homepage", icon: LayoutTemplate },
  { id: "look", label: "Look", icon: Palette },
] as const;

export const SiteManagement: React.FC = () => {
  const [data, setData] = useState<SiteAdmin | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("menu");
  const opts = useOptions();
  const site = useSite();
  const load = () => siteAdminApi.get().then(setData).catch((e) => toast.error(errText(e)));
  useEffect(() => { load(); }, []);
  // after saving, the live header / bar update too
  const saved = () => { site.reload(); load(); };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl font-extrabold text-ink">Site</h2>
        <p className="text-sm text-gray-500">What every visitor sees: the menu, the homepage and notices.</p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>
      {!data ? <Spinner /> : (
        <>
          {tab === "menu" && <MenuEditor key={`menu-${data.nav_is_default}`} initial={data.nav} isDefault={data.nav_is_default} opts={opts} onSaved={saved} />}
          {tab === "hero" && <HeroEditor initial={data.hero} onSaved={saved} />}
          {tab === "notices" && <NoticesEditor initial={data.notices} opts={opts} onSaved={saved} />}
          {tab === "homepage" && <HomepageEditor initial={data.homepage} types={data.section_types} icons={data.icons} opts={opts} onSaved={saved} />}
          {tab === "look" && <LookEditor key={JSON.stringify(data.appearance)} initial={data.appearance} onSaved={saved} />}
        </>
      )}
    </div>
  );
};
