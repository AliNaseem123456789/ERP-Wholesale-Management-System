// Pickers shared by the collection editor, storefront editor and admin marketplace settings.
import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Search, X, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import type { PickedProduct } from "../api/storefront.api";
import { inputCls } from "./ui";

const statusTone: Record<string, string> = { published: "text-green-700 bg-green-50", draft: "text-gray-600 bg-gray-100" };

/** Search-and-add product list, kept in order (move up/down, remove). */
export const ProductPicker: React.FC<{
  value: PickedProduct[];
  onChange: (v: PickedProduct[]) => void;
  search: (q: string) => Promise<PickedProduct[]>;
  max?: number;
  disabled?: boolean;
}> = ({ value, onChange, search, max = 500, disabled }) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search(q.trim()).then(setResults).catch(() => setResults([])), 200);
    return () => clearTimeout(t);
  }, [q, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const chosen = new Set(value.map((p) => String(p.id)));
  const add = (p: PickedProduct) => {
    if (chosen.has(String(p.id))) return;
    if (value.length >= max) return toast.error(`At most ${max} products`);
    onChange([...value, p]);
  };
  const move = (i: number, d: number) => {
    const n = [...value];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  return (
    <div>
      {!disabled && (
        <div ref={box} className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className={`${inputCls} pl-9`} placeholder="Search your products by name, SKU or brand to add" value={q}
            onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} aria-label="Search products to add" />
          {open && (
            <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
              {results.length === 0 ? <p className="px-3 py-3 text-sm text-gray-500">No products found</p> : results.map((p) => (
                <button type="button" key={p.id} onClick={() => add(p)} disabled={chosen.has(String(p.id))}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-40">
                  {p.image ? <img src={p.image} alt="" className="w-8 h-8 rounded object-cover bg-gray-100" /> : <span className="w-8 h-8 rounded bg-gray-100" />}
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-gray-900 truncate">{p.title}</span>
                    <span className="block text-xs text-gray-500 truncate">{[p.brand, p.sku, p.company].filter(Boolean).join(" · ")}</span>
                  </span>
                  {p.status && p.status !== "published" && <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${statusTone[p.status] || "bg-amber-50 text-amber-700"}`}>{p.status}</span>}
                  {chosen.has(String(p.id)) && <span className="text-xs text-gray-400">Added</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {value.length === 0 ? <p className="text-sm text-gray-500 mt-2">No products yet.</p> : (
        <ol className="mt-2 divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {value.map((p, i) => (
            <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="w-6 text-xs text-gray-400 tabular-nums">{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="font-semibold text-gray-900">{p.title}</span>
                {p.status && p.status !== "published" && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-50 text-amber-700" title="Hidden from customers until published">{p.status}</span>}
                <span className="block text-xs text-gray-500">{[p.brand, p.sku, p.company].filter(Boolean).join(" · ")}</span>
              </span>
              {!disabled && (
                <>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-gray-400 hover:text-gray-800 disabled:opacity-30" aria-label="Move up"><ArrowUp size={15} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="p-1 text-gray-400 hover:text-gray-800 disabled:opacity-30" aria-label="Move down"><ArrowDown size={15} /></button>
                  <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-600" aria-label={`Remove ${p.title}`}><X size={15} /></button>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

/** Choose several from a known list (brands, categories, companies) as toggle chips. */
export const ChipSelect: React.FC<{
  options: { id: number | string; name: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  max?: number;
  empty?: string;
}> = ({ options, value, onChange, max = 50, empty = "Nothing to choose from yet" }) => {
  const [q, setQ] = useState("");
  const set = new Set(value.map(String));
  const shown = options.filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()));
  if (!options.length) return <p className="text-sm text-gray-500">{empty}</p>;
  return (
    <div>
      {options.length > 12 && <input className={`${inputCls} mb-2`} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter options" />}
      <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
        {shown.map((o) => {
          const on = set.has(String(o.id));
          return (
            <button type="button" key={o.id} aria-pressed={on}
              onClick={() => on ? onChange(value.filter((x) => String(x) !== String(o.id))) : set.size >= max ? toast.error(`At most ${max}`) : onChange([...value, String(o.id)])}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${on ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-300 text-gray-700 hover:border-gray-500"}`}>
              {o.name}
            </button>
          );
        })}
      </div>
      {value.length > 0 && <p className="text-xs text-gray-500 mt-1">{value.length} selected</p>}
    </div>
  );
};

/** Image address field with an upload button. */
export const ImageField: React.FC<{ value: string; onChange: (v: string) => void; upload?: (f: File) => Promise<string>; label?: string }> = ({ value, onChange, upload, label = "Image" }) => {
  const [busy, setBusy] = useState(false);
  const pick = async (f?: File) => {
    if (!f || !upload) return;
    setBusy(true);
    try { onChange(await upload(f)); } catch (e: any) { toast.error(e?.response?.data?.message || "Upload failed"); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-start gap-3">
      <div className="w-20 h-14 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
        {value ? <img src={value} alt="" className="w-full h-full object-cover" /> : <ImagePlus size={18} className="text-gray-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <input className={inputCls} placeholder="https://…" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} address`} />
        {upload && (
          <label className="inline-block mt-1 text-xs font-semibold text-blue-600 cursor-pointer hover:underline">
            {busy ? "Uploading…" : "Upload an image"}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        )}
      </div>
    </div>
  );
};
