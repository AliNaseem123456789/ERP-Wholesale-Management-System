import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, ShoppingBag, Package, Users, Settings, History, Warehouse, Truck,
  Calculator, BadgeDollarSign, Building2, Clock, Boxes, ClipboardList, RefreshCcw, BarChart3,
  UserRound, Tags, FileSignature, FileText, Undo2, LineChart, SlidersHorizontal,
  BookOpen, ListTree, Receipt, Wallet, Landmark, Scale, ScanLine, ShieldCheck, FileSpreadsheet, FileBarChart, UsersRound, CalendarCheck, Plane, SlidersHorizontal as Sliders2, IdCard,
} from "lucide-react";
import { BusinessProvider, useBusiness } from "../context/BusinessContext";
import { Spinner } from "../components/ui";
import { RegisterBusinessPage } from "./RegisterBusinessPage";

type NavItem = { to: string; label: string; icon: any; perm: string | string[]; end?: boolean };
const NAV: { section?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: "/business", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.view", end: true },
      { to: "/business/orders", label: "Orders", icon: ShoppingBag, perm: "orders.view" },
      { to: "/business/products", label: "Products", icon: Package, perm: "products.view" },
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

const Shell: React.FC = () => {
  const { companies, companyId, company, loading, switchCompany, can } = useBusiness();
  const navigate = useNavigate();

  if (!companies.length) return <RegisterBusinessPage />;
  if (loading && !company) return <Spinner label="Loading your business..." />;
  if (!company) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center text-gray-600">
        We couldn't open this business. It may have been suspended, or your access was removed.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        <aside className="space-y-4 no-print">
          <div className="bg-white border border-gray-200 rounded-2xl p-3">
            <label className="text-[10px] font-bold uppercase text-gray-400 tracking-widest px-1">Business</label>
            {companies.length > 1 ? (
              <select
                value={companyId || ""}
                onChange={(e) => {
                  switchCompany(e.target.value);
                  navigate("/business");
                }}
                className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-2 text-sm font-semibold bg-white text-gray-900"
              >
                {companies.map((c) => (
                  <option key={c.companyId} value={c.companyId}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2 mt-1 px-1">
                <Building2 size={18} className="text-blue-600" />
                <span className="font-bold text-gray-900 truncate">{company.name}</span>
              </div>
            )}
            <p className="text-xs text-gray-500 mt-2 px-1">
              Your role: <b>{company.myRole}</b>
            </p>
          </div>

          <nav className="bg-white border border-gray-200 rounded-2xl p-2">
            {NAV.map((group, gi) => {
              const items = group.items.filter((n) => (Array.isArray(n.perm) ? n.perm.some(can) : can(n.perm)));
              if (!items.length) return null;
              return (
                <div key={gi} className={gi ? "mt-2 pt-2 border-t border-gray-100" : ""}>
                  {group.section && <p className="px-3 pt-1 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">{group.section}</p>}
                  {items.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.end}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                          isActive ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"
                        }`
                      }
                    >
                      <n.icon size={18} /> {n.label}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0">
          {company.status === "pending" && (
            <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 text-sm">
              <Clock size={18} />
              <span>
                <b>Waiting for approval.</b> You can set up products and your team now. Customers will see your store once the
                platform team approves it.
              </span>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export const BusinessLayout: React.FC = () => (
  <BusinessProvider>
    <Shell />
  </BusinessProvider>
);
