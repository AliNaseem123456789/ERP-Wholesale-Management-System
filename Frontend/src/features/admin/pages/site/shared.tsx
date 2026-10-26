// Bits shared by the Site editors: drag-and-drop ordering, the lists of things to link to, small controls.
import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Trash2, Eye, EyeOff, Copy } from "lucide-react";
import { adminCatalogApi } from "../../api/adminCatalog.api";
import { adminService } from "../../api/admin.service";
import { siteAdminApi } from "../../../site/api";

export type Opt = { id: string; name: string; slug: string; parent_id?: string | null };
export type Options = { categories: Opt[]; brands: Opt[]; companies: Opt[]; collections: Opt[] };

/** Everything a menu item / section can point at, loaded once. */
export const useOptions = () => {
  const [o, setO] = useState<Options>({ categories: [], brands: [], companies: [], collections: [] });
  useEffect(() => {
    const norm = (rows: any[]) => rows.map((r) => ({ id: String(r.id), name: r.name, slug: r.slug, parent_id: r.parent_id ? String(r.parent_id) : null }));
    adminCatalogApi.categories().then((c) => setO((x) => ({ ...x, categories: norm(c.filter((k) => k.status === "active")) }))).catch(() => {});
    adminCatalogApi.brands().then((b) => setO((x) => ({ ...x, brands: norm(b.filter((k: any) => k.slug)) }))).catch(() => {});
    adminService.getCompanies({ status: "active" }).then((c: any[]) => setO((x) => ({ ...x, companies: norm(c) }))).catch(() => {});
    adminCatalogApi.collections().then((c) => setO((x) => ({ ...x, collections: norm(c) }))).catch(() => {});
  }, []);
  return o;
};

/** Categories as an indented list (parents first). */
export const categoryTree = (cats: Opt[]) => {
  const out: (Opt & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number) =>
    cats.filter((c) => (c.parent_id || null) === parent).sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => { out.push({ ...c, depth }); walk(c.id, depth + 1); });
  walk(null, 0);
  return out;
};

export const move = <T,>(list: T[], from: number, to: number) => {
  if (to < 0 || to >= list.length || from === to) return list;
  const n = [...list];
  const [x] = n.splice(from, 1);
  n.splice(to, 0, x);
  return n;
};

/** Drag-and-drop between rows (drag the handle; the arrows do the same for keyboards and phones). */
export const useDrag = <T,>(list: T[], setList: (l: T[]) => void) => {
  const from = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return {
    over,
    /** on the row: where things can be dropped */
    props: (i: number) => ({
      onDragOver: (e: React.DragEvent) => { if (from.current === null) return; e.preventDefault(); setOver(i); },
      onDragLeave: () => setOver((o) => (o === i ? null : o)),
      onDrop: (e: React.DragEvent) => { e.preventDefault(); if (from.current !== null) setList(move(list, from.current, i)); from.current = null; setOver(null); },
    }),
    /** on the handle: what is dragged */
    handle: (i: number) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => { from.current = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); },
      onDragEnd: () => { from.current = null; setOver(null); },
    }),
  };
};

/** Row controls: drag handle, show/hide, up, down, duplicate, remove. */
export const RowTools: React.FC<{
  i: number; count: number; onMove: (to: number) => void; onRemove?: () => void; hidden?: boolean; onToggle?: () => void; onDuplicate?: () => void; label: string;
  handle?: Record<string, unknown>;
}> = ({ i, count, onMove, onRemove, hidden, onToggle, onDuplicate, label, handle }) => (
  <div className="flex items-center gap-0.5 shrink-0">
    {handle && <span {...handle} className="p-1.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing" title="Drag to reorder" aria-hidden="true"><GripVertical size={16} /></span>}
    {onToggle && <button type="button" onClick={onToggle} className="p-1.5 text-gray-400 hover:text-gray-800" aria-label={hidden ? `Show ${label}` : `Hide ${label}`} title={hidden ? "Show" : "Hide"}>{hidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>}
    <button type="button" onClick={() => onMove(i - 1)} disabled={i === 0} className="p-1.5 text-gray-400 hover:text-gray-800 disabled:opacity-30" aria-label={`Move ${label} up`}><ArrowUp size={16} /></button>
    <button type="button" onClick={() => onMove(i + 1)} disabled={i === count - 1} className="p-1.5 text-gray-400 hover:text-gray-800 disabled:opacity-30" aria-label={`Move ${label} down`}><ArrowDown size={16} /></button>
    {onDuplicate && <button type="button" onClick={onDuplicate} className="p-1.5 text-gray-400 hover:text-gray-800" aria-label={`Duplicate ${label}`} title="Duplicate"><Copy size={15} /></button>}
    {onRemove && <button type="button" onClick={onRemove} className="p-1.5 text-gray-400 hover:text-red-600" aria-label={`Remove ${label}`} title="Remove"><Trash2 size={15} /></button>}
  </div>
);

export const upload = (f: File) => siteAdminApi.uploadImage(f);
export const newId = (p = "x") => `${p}-${Math.random().toString(36).slice(2, 8)}`;
export const toLocal = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
export const errText = (e: any) => e?.response?.data?.message || e?.message || "Something went wrong";
