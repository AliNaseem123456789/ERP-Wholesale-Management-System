import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, ShoppingBag, Package, Users, Settings, History, Warehouse, Truck,
  Calculator, BadgeDollarSign, Building2, Clock, Boxes, ClipboardList, RefreshCcw, BarChart3,
  UserRound, Tags, FileSignature, FileText, Undo2, LineChart, SlidersHorizontal,
  BookOpen, ListTree, Receipt, Wallet, Landmark, Scale, ScanLine, ShieldCheck, FileSpreadsheet, FileBarChart, UsersRound, CalendarCheck, Plane, SlidersHorizontal as Sliders2, IdCard, FolderTree, Layers, Store, Activity, Star, Flag, Percent, Search, ChevronDown, PanelLeft, X } from "lucide-react";
import { BusinessProvider, useBusiness } from "../context/BusinessContext";
import { Spinner } from "../components/ui";
import { RegisterBusinessPage } from "./RegisterBusinessPage";
import { useSeo } from "../../insights/seo";

type NavItem = { to: string; label: string; icon: any; perm: string | string[]; end?: boolean };
const NAV: { section?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: "/business", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.view", end: true },
      { to: "/business/orders", label: "Orders", icon: ShoppingBag, perm: "orders.view" },
      { to: "/business/products", label: "Products", icon: Package, perm: "products.view" },
      { to: "/business/catalogue", label: "Categories & brands", icon: FolderTree, perm: "products.view" },
      { to: "/business/collections", label: "Collections", icon: Layers, perm: ["products.view", "storefront.manage"] },
      { to: "/business/storefront", label: "Storefront", icon: Store, perm: ["storefront.manage", "company.manage"] },
      { to: "/business/analytics", label: "Analytics", icon: Activity, perm: ["reports.view", "dashboard.view"] },
      { to: "/business/reviews", label: "Reviews", icon: Star, perm: ["products.view", "customers.view"] },
    ],
  },
  {
    section: "Sales",
    items: [
      { to: "/business/customers", label: "Customers", icon: UserRound, perm: "customers.view" },
      { to: "/business/pricing", label: "Pricing & promos", icon: Tags, perm: ["pricing.view", "pricing.manage"] },
      { to: "/business/quotes", label: "Quotes", icon: FileSignature, perm: ["quotes.view", "quotes.manage"] },
      { to: "/business/invoices", label: "Invoices", icon: FileText, perm: "invoices.view" },
      { to: "/business/returns", label: "Returns", icon: Undo2, perm: "returns.view" },
      { to: "/business/reports", label: "Problems reported", icon: Flag, perm: ["orders.view", "products.view"] },
      { to: "/business/sales-reports", label: "Sales reports", icon: LineChart, perm: ["reports.view", "invoices.view"] },
      { to: "/business/compliance", label: "Tobacco compliance", icon: ShieldCheck, perm: ["sales.manage", "customers.view"] },
      { to: "/business/sales-settings", label: "Sales settings", icon: SlidersHorizontal, perm: "sales.manage" },
    ],
  },
  {
    section: "Inventory",
    items: [
      { to: "/business/inventory", label: "Stock", icon: Boxes, perm: "inventory.view" },
      { to: "/business/scan", label: "Scan station", icon: ScanLine, perm: ["inventory.view", "purchasing.receive", "orders.fulfil"] },
      { to: "/business/warehouses", label: "Warehouses", icon: Warehouse, perm: "inventory.view" },
      { to: "/business/stock-reports", label: "Stock reports", icon: BarChart3, perm: "inventory.view" },
    ],
  },
  {
    section: "Purchasing",
    items: [
      { to: "/business/purchase-orders", label: "Purchase orders", icon: ClipboardList, perm: ["purchasing.view", "purchasing.receive"] },
      { to: "/business/suppliers", label: "Suppliers", icon: Truck, perm: "purchasing.view" },
      { to: "/business/supplier-returns", label: "Supplier returns", icon: Undo2, perm: ["purchasing.view", "purchasing.receive"] },
      { to: "/business/reorder", label: "Reorder", icon: RefreshCcw, perm: "inventory.view" },
    ],
  },
  {
    section: "Accounting",
    items: [
      { to: "/business/accounting", label: "Overview", icon: Calculator, perm: ["accounting.view", "accounting.manage"] },
      { to: "/business/bills", label: "Bills", icon: Receipt, perm: ["accounting.view", "accounting.manage"] },
      { to: "/business/expenses", label: "Expenses", icon: Wallet, perm: ["accounting.view", "accounting.manage"] },
      { to: "/business/financial-reports", label: "Financial reports", icon: Scale, perm: ["accounting.view", "accounting.manage"] },
      { to: "/business/journal", label: "Journal", icon: BookOpen, perm: ["accounting.view", "accounting.manage"] },
      { to: "/business/chart-of-accounts", label: "Chart of accounts", icon: ListTree, perm: ["accounting.view", "accounting.manage"] },
      { to: "/business/reconcile", label: "Reconcile", icon: Landmark, perm: "accounting.manage" },
      { to: "/business/commission", label: "Platform commission", icon: Percent, perm: ["accounting.view", "company.manage"] },
    ],
  },
  {
    section: "HR & Payroll",
    items: [
      { to: "/business/employees", label: "Employees", icon: UsersRound, perm: ["hr.view", "hr.manage", "payroll.view"] },
      { to: "/business/attendance", label: "Attendance", icon: CalendarCheck, perm: ["hr.attendance", "hr.manage"] },
      { to: "/business/leave", label: "Leave", icon: Plane, perm: ["hr.leave", "hr.manage"] },
      { to: "/business/payroll", label: "Payroll", icon: BadgeDollarSign, perm: ["payroll.view", "payroll.manage", "payroll.pay"] },
      { to: "/business/hr-settings", label: "HR settings", icon: Sliders2, perm: ["hr.manage", "payroll.manage"] },
    ],
  },
  {
    section: "Company",
    items: [
      { to: "/business/reports-hub", label: "Reports", icon: FileBarChart, perm: "company.view" },
      { to: "/business/data", label: "Import & export", icon: FileSpreadsheet, perm: "company.view" },
      { to: "/business/team", label: "Team", icon: Users, perm: "members.view" },
      { to: "/business/settings", label: "Settings", icon: Settings, perm: "company.view" },
      { to: "/business/activity", label: "Activity log", icon: History, perm: "audit.view" },
      { to: "/business/my-hr", label: "My HR", icon: IdCard, perm: "company.view" },
    ],
  },
];

const SECTION_KEY = "bo.closedSections";
const readClosed = (): string[] => { try { return JSON.parse(localStorage.getItem(SECTION_KEY) || "[]"); } catch { return []; } };

/** The back-office menu: a filter box (Ctrl/⌘ K), collapsible sections, and the current company. */
const SideNav: React.FC<{ onNavigate?: () => void; autoFocus?: boolean }> = ({ onNavigate, autoFocus }) => {
  const { companies, companyId, company, switchCompany, can } = useBusiness();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<string[]>(readClosed);
  const filter = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); filter.current?.focus(); }
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, []);
  const toggle = (section: string) => {
    const next = closed.includes(section) ? closed.filter((x) => x !== section) : [...closed, section];
    setClosed(next);
    try { localStorage.setItem(SECTION_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  const term = q.trim().toLowerCase();
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((n) => (Array.isArray(n.perm) ? n.perm.some(can) : can(n.perm)) && (!term || n.label.toLowerCase().includes(term) || (g.section || "").toLowerCase().includes(term))),
  })).filter((g) => g.items.length);
  const isActive = (n: NavItem) => (n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + "/"));

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-line">
        {companies.length > 1 ? (
          <label className="block">
            <span className="sr-only">Business</span>
            <select
              value={companyId || ""}
              onChange={(e) => { switchCompany(e.target.value); navigate("/business"); onNavigate?.(); }}
              className="w-full h-11 rounded-lg border border-line bg-raised px-3 text-sm font-semibold text-ink"
            >
              {companies.map((c) => <option key={c.companyId} value={c.companyId}>{c.name}</option>)}
            </select>
          </label>
        ) : (
          <div className="flex items-center gap-2.5 px-1 py-1">
            <span className="w-9 h-9 rounded-lg bg-brand-soft text-brand-text grid place-items-center font-display font-extrabold shrink-0">{company?.name?.[0] || "B"}</span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink truncate leading-tight">{company?.name}</span>
              <span className="block text-xs text-ink-3 capitalize">{String(company?.myRole || "").toLowerCase()}</span>
            </span>
          </div>
        )}
        <div className="relative mt-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
          <input
            ref={filter}
            autoFocus={autoFocus}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && groups[0]?.items[0]) { navigate(groups[0].items[0].to); setQ(""); onNavigate?.(); }
              if (e.key === "Escape") { setQ(""); (e.target as HTMLInputElement).blur(); }
            }}
            placeholder="Jump to…"
            aria-label="Find a page"
            className="w-full h-9 pl-9 pr-12 rounded-lg bg-raised border border-line text-sm text-ink placeholder:text-ink-3 focus:bg-surface focus:border-brand focus:ring-4 focus:ring-brand/15 outline-none"
          />
          <kbd className="hidden lg:block absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-3 border border-line rounded px-1.5 py-px font-sans">Ctrl K</kbd>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto overscroll-contain p-2" aria-label="Back office">
        {groups.length === 0 && <p className="px-3 py-6 text-sm text-ink-3 text-center">No page matches “{q}”.</p>}
        {groups.map((group, gi) => {
          const open = !!term || !group.section || !closed.includes(group.section) || group.items.some(isActive);
          return (
            <div key={gi} className={gi ? "mt-1" : ""}>
              {group.section && (
                <button
                  onClick={() => toggle(group.section!)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between px-3 pt-3 pb-1.5 text-xs font-semibold text-ink-3 hover:text-ink"
                >
                  {group.section}
                  <ChevronDown size={14} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
                </button>
              )}
              {open && group.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  onClick={() => { setQ(""); onNavigate?.(); }}
                  className={({ isActive }) =>
                    `relative flex items-center gap-3 px-3 h-9 rounded-lg text-sm transition-colors ${
                      isActive ? "bg-brand-soft text-ink font-semibold before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-brand" : "text-ink-2 hover:bg-raised hover:text-ink"
                    }`
                  }
                >
                  {({ isActive }) => <><n.icon size={17} className={isActive ? "text-brand-text" : "text-ink-3"} /> <span className="truncate">{n.label}</span></>}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-line">
        <Link to="/" onClick={onNavigate} className="flex items-center gap-2 px-3 h-9 rounded-lg text-sm text-ink-2 hover:bg-raised hover:text-ink">
          <Store size={16} className="text-ink-3" /> Back to the marketplace
        </Link>
      </div>
    </div>
  );
};

const Shell: React.FC = () => {
  useSeo({ title: "Business", noindex: true });
  const { companies, company, loading } = useBusiness();
  const { pathname } = useLocation();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", esc); };
  }, [drawer]);

  if (!companies.length) return <RegisterBusinessPage />;
  if (loading && !company) return <Spinner label="Loading your business..." />;
  if (!company) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center text-ink-2">
        We couldn't open this business. It may have been suspended, or your access was removed.
      </div>
    );
  }

  const current = NAV.flatMap((g) => g.items).filter((n) => (n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + "/"))).sort((a, b) => b.to.length - a.to.length)[0];

  return (
    <div className="min-h-screen bg-page lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="hidden lg:block no-print sticky top-20 h-[calc(100vh-5rem)] bg-surface border-r border-line">
        <SideNav />
      </aside>

      {/* phone / tablet: current page + menu button */}
      <div className="lg:hidden no-print sticky top-14 md:top-20 z-30 bg-surface/95 backdrop-blur border-b border-line px-3 h-12 flex items-center gap-2">
        <button onClick={() => setDrawer(true)} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line text-sm font-semibold text-ink" aria-label="Open the back-office menu">
          <PanelLeft size={16} /> Menu
        </button>
        <span className="text-sm text-ink-3 truncate">{company.name}{current ? <> <span className="mx-1">/</span> <span className="text-ink font-medium">{current.label}</span></> : null}</span>
      </div>
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Back-office menu">
          <div className="absolute inset-0 bg-night/60" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[86%] max-w-xs bg-surface shadow-xl">
            <button onClick={() => setDrawer(false)} className="absolute right-2 top-2 z-10 w-9 h-9 grid place-items-center rounded-lg text-ink-3 hover:bg-raised" aria-label="Close menu"><X size={18} /></button>
            <SideNav onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <main className="min-w-0 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
        <div className="max-w-[1400px] mx-auto">
          {company.status === "pending" && (
            <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 text-sm">
              <Clock size={18} className="shrink-0 mt-0.5" />
              <span>
                <b className="font-semibold">Waiting for approval.</b> You can set up products and your team now. Customers will see your store once the
                platform team approves it.
              </span>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export const BusinessLayout: React.FC = () => (
  <BusinessProvider>
    <Shell />
  </BusinessProvider>
);
