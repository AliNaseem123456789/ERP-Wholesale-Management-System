// Site settings every page needs (menu, look, announcement), loaded once; and the light / dark mode.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { siteApi, SiteSettings, Appearance } from "./api";

const DEFAULT_APPEARANCE: Appearance = { style: "neon", default_mode: "dark", allow_toggle: true };
const CHOICE_KEY = "themeChoice"; // only set when the visitor picks a mode themselves

type Ctx = {
  settings: SiteSettings | null;
  appearance: Appearance;
  mode: "light" | "dark";
  toggleMode: () => void;
  reload: () => void;
};
const SiteCtx = createContext<Ctx>({ settings: null, appearance: DEFAULT_APPEARANCE, mode: "dark", toggleMode: () => {}, reload: () => {} });

const readChoice = (): "light" | "dark" | null => {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
};

export const SiteProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [choice, setChoice] = useState<"light" | "dark" | null>(readChoice);
  const load = useCallback(() => { siteApi.settings().then(setSettings).catch(() => {}); }, []);
  useEffect(load, [load]);

  const appearance = settings?.appearance || DEFAULT_APPEARANCE;
  // until the settings arrive, keep whatever mode the page was painted in (see index.html)
  const startMode = useMemo<"light" | "dark">(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"), []);
  const fallback = settings ? appearance.default_mode : startMode;
  const mode: "light" | "dark" = appearance.allow_toggle && choice ? choice : fallback;

  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("dark", mode === "dark");
    el.dataset.look = appearance.style;
    try { localStorage.setItem("themeMode", mode); } catch { /* storage unavailable */ }
  }, [mode, appearance.style]);

  // print in light colours whatever the screen mode
  useEffect(() => {
    const el = document.documentElement;
    let was = false;
    const before = () => { was = el.classList.contains("dark"); el.classList.remove("dark"); };
    const after = () => { if (was) el.classList.add("dark"); };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);

  const toggleMode = useCallback(() => {
    const next = mode === "dark" ? "light" : "dark";
    try { localStorage.setItem(CHOICE_KEY, next); } catch { /* storage unavailable */ }
    setChoice(next);
  }, [mode]);

  const value = useMemo(() => ({ settings, appearance, mode, toggleMode, reload: load }), [settings, appearance, mode, toggleMode, load]);
  return <SiteCtx.Provider value={value}>{children}</SiteCtx.Provider>;
};

export const useSite = () => useContext(SiteCtx);

/**
 * Class names shared by the storefront chrome. Both admin looks ("neon" and "clean") now use the same
 * ink / cobalt design; `clean` is kept so existing callers keep working.
 */
export const useLook = () => {
  const { appearance } = useSite();
  const clean = appearance.style === "clean";
  return {
    clean,
    header: "bg-surface/95 backdrop-blur border-b border-line",
    headerBg: undefined as React.CSSProperties | undefined,
    headerOverlay: "",
    logoAccent: "text-brand",
    logoText: "text-ink",
    iconBtn: "text-ink-2 hover:text-ink hover:bg-raised",
    outlineBtn: "text-ink-2 hover:text-ink hover:bg-raised",
    accountBtn: "text-ink-2 hover:text-ink hover:bg-raised",
    primaryBtn: "bg-brand text-white hover:bg-brand-hover",
    countBadge: "bg-brand text-white",
    navBar: "bg-surface border-b border-line",
    navText: "text-ink-2 hover:text-ink",
    navActive: "text-ink",
    dropdown: "bg-surface text-ink border border-line shadow-xl",
    dropdownLink: "hover:bg-raised hover:text-brand-text",
    dropdownHeading: "text-ink",
    mobileBar: "bg-surface/95 backdrop-blur border-t border-line text-ink-2",
    mobileTop: "bg-surface/95 backdrop-blur border-b border-line",
    cardBrand: "text-ink-3",
    cardView: "border border-line text-ink hover:bg-raised",
    cardQuick: "bg-solid text-white hover:bg-solid-hover",
    heroPrimary: "bg-brand text-white hover:bg-brand-hover",
    heroSecondary: "bg-white/10 text-white ring-1 ring-inset ring-white/30 hover:bg-white/20",
    heroAccent: "text-signal",
    pageBg: "bg-page",
  };
};

/** The original class names for the two looks, used by the original navbar, hero and footer band: "neon" (the original dark galaxy style) and "clean" (neutral, for a general marketplace). */
export const useClassicLook = () => {
  const { appearance } = useSite();
  const clean = appearance.style === "clean";
  return {
    clean,
    header: clean ? "bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800" : "",
    headerBg: clean ? undefined : { backgroundImage: "url('/logos/galaxy.jpeg')", backgroundSize: "cover", backgroundPosition: "center" },
    headerOverlay: clean ? "" : "absolute inset-0 bg-black/60 backdrop-blur-sm",
    logoAccent: clean ? "text-blue-600 dark:text-blue-400" : "text-cyan-400",
    logoText: clean ? "text-gray-900 dark:text-white" : "text-white",
    iconBtn: clean ? "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-800" : "text-cyan-400 hover:bg-cyan-400/20",
    outlineBtn: clean ? "border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800" : "border border-cyan-400 text-cyan-400 hover:bg-cyan-400/10",
    accountBtn: clean ? "border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800" : "border border-pink-500 text-pink-400 hover:bg-pink-500/10",
    primaryBtn: clean ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-pink-500 text-pink-400 hover:bg-pink-500/10",
    countBadge: clean ? "bg-blue-600 text-white" : "bg-cyan-400 text-black",
    navBar: clean ? "bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800" : "bg-black",
    navText: clean ? "text-gray-700 hover:text-blue-600 dark:text-gray-200 dark:hover:text-blue-400" : "text-gray-100 hover:text-cyan-300",
    navActive: clean ? "text-blue-600 dark:text-blue-400" : "text-cyan-300",
    dropdown: clean ? "bg-white text-gray-800 border border-gray-200 shadow-xl dark:bg-slate-900 dark:text-gray-100 dark:border-slate-700" : "bg-black text-gray-100 border border-gray-700 shadow-xl",
    dropdownLink: clean ? "hover:bg-gray-50 hover:text-blue-600 dark:hover:bg-slate-800" : "hover:bg-gray-800 hover:text-cyan-300",
    dropdownHeading: clean ? "text-gray-900 dark:text-white" : "text-cyan-300",
    mobileBar: clean ? "bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 text-gray-600 dark:text-gray-300" : "bg-black/90 backdrop-blur-lg border-t border-cyan-400 text-cyan-400",
    mobileTop: clean ? "bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800" : "bg-black border-b border-gray-800",
    cardBrand: clean ? "text-gray-500 dark:text-gray-400" : "text-cyan-500",
    cardView: clean ? "border border-gray-300 text-gray-700 hover:bg-gray-50" : "bg-cyan-500 text-white hover:bg-cyan-600",
    cardQuick: clean ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-pink-500 text-white hover:bg-pink-600",
    heroPrimary: clean ? "bg-blue-600 text-white hover:bg-blue-500" : "bg-cyan-500 text-black hover:bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.4)]",
    heroSecondary: clean ? "border-2 border-white text-white hover:bg-white hover:text-gray-900" : "border-2 border-pink-500 text-pink-500 hover:bg-pink-500 hover:text-white",
    heroAccent: clean ? "text-blue-300" : "text-cyan-400",
    pageBg: clean ? "bg-gray-50 dark:bg-slate-950" : "bg-white dark:bg-[#0a0a0f]",
  };
};
