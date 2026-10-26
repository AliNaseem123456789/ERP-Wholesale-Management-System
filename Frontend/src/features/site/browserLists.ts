// Per-browser lists kept in localStorage: recently viewed products and the compare list. Nothing is sent anywhere.
import { useEffect, useState } from "react";

const read = (key: string): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v.map(String).filter((x) => /^\d+$/.test(x)) : [];
  } catch {
    return [];
  }
};
const write = (key: string, ids: string[]) => {
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent("browser-list", { detail: key }));
};

const useList = (key: string) => {
  const [ids, setIds] = useState<string[]>(() => read(key));
  useEffect(() => {
    const on = (e: Event) => { if (!(e as CustomEvent).detail || (e as CustomEvent).detail === key) setIds(read(key)); };
    const onStorage = (e: StorageEvent) => { if (e.key === key) setIds(read(key)); };
    window.addEventListener("browser-list", on);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("browser-list", on); window.removeEventListener("storage", onStorage); };
  }, [key]);
  return ids;
};

// ---- recently viewed ---------------------------------------------------------------------------------
const RECENT = "recentlyViewed";
export const rememberViewed = (id: number | string) => write(RECENT, [String(id), ...read(RECENT).filter((x) => x !== String(id))].slice(0, 16));
export const clearViewed = () => write(RECENT, []);
export const useRecentlyViewed = () => useList(RECENT);

// ---- compare -----------------------------------------------------------------------------------------
const COMPARE = "compareList";
export const COMPARE_MAX = 4;
export const useCompare = () => {
  const ids = useList(COMPARE);
  return {
    ids,
    has: (id: number | string) => ids.includes(String(id)),
    /** returns false when the list is full */
    toggle: (id: number | string) => {
      const cur = read(COMPARE);
      if (cur.includes(String(id))) { write(COMPARE, cur.filter((x) => x !== String(id))); return true; }
      if (cur.length >= COMPARE_MAX) return false;
      write(COMPARE, [...cur, String(id)]);
      return true;
    },
    remove: (id: number | string) => write(COMPARE, read(COMPARE).filter((x) => x !== String(id))),
    clear: () => write(COMPARE, []),
  };
};
