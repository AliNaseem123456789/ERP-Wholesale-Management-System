// frontend/src/pages/AccountPage.tsx
import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Package,
  MapPin,
  User,
  Users,
  ShoppingBag,
  CreditCard,
  Wallet,
  LogOut,
  ChevronRight,
  AlertCircle,
  FileText,
  FileSignature,
  Undo2,
  Repeat,
  BellRing,
  ClipboardList,
  Star,
  Flag,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../../auth/context/AuthContext";
import { OrdersTab } from "../components/tabs/OrdersTab";
import { AddressesTab } from "../components/tabs/AddressesTab";
import { AccountDetailsTab } from "../components/tabs/AccountDetailsTab";
import { TeamTab } from "../components/tabs/TeamTab";
import { SavedCartsTab } from "../components/tabs/SavedCartsTab";
import PactCompliance from "../components/tabs/PactTab";
import { PaymentsTab } from "../components/tabs/PaymentsTab";
import { CreditTab } from "../components/tabs/CreditTab";
import { InvoicesTab } from "../components/tabs/InvoicesTab";
import { QuotesTab } from "../components/tabs/QuotesTab";
import { ReturnsTab } from "../components/tabs/ReturnsTab";
import { RecurringTab } from "../components/tabs/RecurringTab";
import { StockAlertsTab } from "../components/tabs/StockAlertsTab";
import { RfqsTab } from "../components/tabs/RfqsTab";
import { ReviewsTab, ReportsTab } from "../components/tabs/FeedbackTabs";
import { useSeo } from "../../insights/seo";

const TABS = [
  { id: "orders", label: "Orders", icon: Package },
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "quotes", label: "Quotes", icon: FileSignature },
  { id: "rfqs", label: "Requests for quotes", icon: ClipboardList },
  { id: "recurring", label: "Recurring orders", icon: Repeat },
  { id: "stock-alerts", label: "Stock alerts", icon: BellRing },
  { id: "reviews", label: "Reviews", icon: Star },
  { id: "reports", label: "Reported problems", icon: Flag },
  { id: "returns", label: "Returns", icon: Undo2 },
  { id: "addresses", label: "Addresses", icon: MapPin },
  { id: "details", label: "Account details", icon: User },
  { id: "subaccounts", label: "Subaccounts", icon: Users },
  { id: "saved-carts", label: "Saved carts", icon: ShoppingBag },
  { id: "payments", label: "Payment history", icon: CreditCard },
  { id: "credit", label: "Credit", icon: Wallet },
  { id: "PACT", label: "PACT compliance", icon: ShieldCheck },
];

export const AccountPage: React.FC = () => {
  useSeo({ title: "My account", noindex: true });
  const { user, logout, logoutAllDevices } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "orders";
  
  // ✅ NEW: State for logout all devices
  const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false);
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);
  const [logoutAllResult, setLogoutAllResult] = useState<{ message: string; success: boolean } | null>(null);

  const filteredTabs = TABS.filter((tab) => {
    if (tab.id === "subaccounts" && user?.role === "SUBACCOUNT") {
      return false;
    }
    return true;
  });

  // ✅ NEW: Handle logout all devices
  const handleLogoutAllDevices = async () => {
    setIsLoggingOutAll(true);
    setLogoutAllResult(null);
    
    try {
      const result = await logoutAllDevices();
      setLogoutAllResult({ message: result.message, success: true });
      
      // Close confirmation after success
      setTimeout(() => {
        setShowLogoutAllConfirm(false);
        setLogoutAllResult(null);
        setIsLoggingOutAll(false);
      }, 3000);
    } catch (error: any) {
      setLogoutAllResult({ 
        message: error.message || "Failed to logout all devices",
        success: false,
      });
      setIsLoggingOutAll(false);
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "orders":
        return <OrdersTab />;
      case "invoices":
        return <InvoicesTab />;
      case "quotes":
        return <QuotesTab />;
      case "returns":
        return <ReturnsTab />;
      case "rfqs":
        return <RfqsTab />;
      case "recurring":
        return <RecurringTab />;
      case "stock-alerts":
        return <StockAlertsTab />;
      case "reviews":
        return <ReviewsTab />;
      case "reports":
        return <ReportsTab />;
      case "addresses":
        return <AddressesTab />;
      case "details":
        return <AccountDetailsTab />;
      case "subaccounts":
        if (user?.role === "SUBACCOUNT") {
          return (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="bg-amber-50 p-4 rounded-full mb-4">
                <Users className="text-amber-600 w-10 h-10" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">
                Access Restricted
              </h3>
              <p className="text-gray-500 max-w-xs mt-2">
                As a subaccount, you do not have permission to manage or create
                additional team members.
              </p>
            </div>
          );
        }
        return <TeamTab />;
      case "saved-carts":
        return <SavedCartsTab />;
      case "payments":
        return <PaymentsTab />;
      case "credit":
        return <CreditTab />;
      case "PACT":
        return <PactCompliance />;
      default:
        return <div className="p-4">Select a tab</div>;
    }
  };

  const GROUPS: { title: string; ids: string[] }[] = [
    { title: "Buying", ids: ["orders", "quotes", "rfqs", "recurring", "saved-carts", "stock-alerts"] },
    { title: "Money", ids: ["invoices", "payments", "credit"] },
    { title: "After the sale", ids: ["returns", "reviews", "reports"] },
    { title: "Account", ids: ["details", "addresses", "subaccounts", "PACT"] },
  ];
  const current = TABS.find((t) => t.id === activeTab);
  const initials = ((user?.firstName?.[0] || user?.email?.[0] || "?") + (user?.lastName?.[0] || "")).toUpperCase();

  return (
    <div className="min-h-screen bg-page flex flex-col">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 md:py-10">
        <div className="flex items-center gap-4 mb-6 md:mb-8">
          <span className="w-12 h-12 rounded-full bg-brand-soft text-brand-text grid place-items-center font-display font-extrabold">{initials}</span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl md:text-[1.9rem] font-extrabold text-ink leading-tight truncate">
              {user?.businessName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "My account"}
            </h1>
            <p className="text-sm text-ink-3 truncate flex items-center gap-2">
              {user?.email}
              {user?.role === "SUBACCOUNT" && <span className="text-xs bg-raised border border-line text-ink-2 px-1.5 py-px rounded">Subaccount</span>}
            </p>
          </div>
        </div>

        {/* phones: tabs as a sideways row */}
        <nav className="md:hidden no-scrollbar -mx-4 px-4 flex gap-2 overflow-x-auto pb-4" aria-label="Account sections">
          {filteredTabs.map((tab) => (
            <button key={tab.id} onClick={() => setSearchParams({ tab: tab.id })} aria-current={activeTab === tab.id ? "page" : undefined}
              className={`shrink-0 h-9 px-3.5 rounded-full text-sm font-medium border ${activeTab === tab.id ? "bg-solid text-white border-transparent" : "bg-surface text-ink-2 border-line"}`}>
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex flex-col md:flex-row gap-6 lg:gap-8">
          <aside className="hidden md:block w-64 shrink-0">
            <nav className="sticky top-32 space-y-5" aria-label="Account sections">
              {GROUPS.map((g) => {
                const tabs = filteredTabs.filter((t) => g.ids.includes(t.id));
                if (!tabs.length) return null;
                return (
                  <div key={g.title}>
                    <p className="px-3 mb-1.5 text-xs font-semibold text-ink-3">{g.title}</p>
                    {tabs.map((tab) => {
                      const Icon = tab.icon;
                      const isActive = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setSearchParams({ tab: tab.id })}
                          aria-current={isActive ? "page" : undefined}
                          className={`relative w-full flex items-center gap-3 px-3 h-9 rounded-lg text-sm ${
                            isActive ? "bg-surface text-ink font-semibold border border-line shadow-sm" : "text-ink-2 hover:bg-surface hover:text-ink border border-transparent"
                          }`}
                        >
                          <Icon size={17} className={isActive ? "text-brand-text" : "text-ink-3"} />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              <div className="border-t border-line pt-4 space-y-0.5">
                <button
                  onClick={() => setShowLogoutAllConfirm(true)}
                  className="w-full flex items-center gap-3 px-3 h-9 rounded-lg text-sm text-ink-2 hover:bg-surface hover:text-ink"
                >
                  <LogOut size={17} className="text-ink-3" />
                  Sign out of all devices
                </button>
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-3 px-3 h-9 rounded-lg text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut size={17} />
                  Sign out
                </button>
              </div>
            </nav>
          </aside>

          <main className="flex-1 min-w-0 bg-surface border border-line rounded-2xl min-h-[600px]">
            <header className="px-5 md:px-8 py-5 border-b border-line">
              <h2 className="font-display text-xl font-extrabold text-ink">
                {current?.label || activeTab.replace("-", " ")}
              </h2>
            </header>

            <div className="p-5 md:p-8">{renderTabContent()}</div>
          </main>
        </div>

        <div className="md:hidden mt-6 grid grid-cols-2 gap-2">
          <button onClick={() => setShowLogoutAllConfirm(true)} className="h-11 rounded-lg border border-line bg-surface text-sm font-medium text-ink-2">Sign out everywhere</button>
          <button onClick={logout} className="h-11 rounded-lg border border-red-200 bg-surface text-sm font-medium text-red-600">Sign out</button>
        </div>
      </div>

      {/* ✅ NEW: Logout All Devices Confirmation Modal */}
      {showLogoutAllConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-night/60 backdrop-blur-[2px]">
          <div className="bg-surface border border-line rounded-2xl max-w-md w-full mx-4 p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-amber-100 p-2 rounded-full">
                <AlertCircle className="text-amber-600 w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">
                Logout from all devices?
              </h3>
            </div>

            <p className="text-gray-600 text-sm mb-6">
              This will log you out from all devices where you're currently signed in. 
              You'll need to sign in again on each device.
            </p>

            {logoutAllResult && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${
                logoutAllResult.success 
                  ? 'bg-green-50 text-green-700 border border-green-200' 
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {logoutAllResult.success 
                  ? `✅ ${logoutAllResult.message}` 
                  : `❌ ${logoutAllResult.message}`
                }
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowLogoutAllConfirm(false);
                  setLogoutAllResult(null);
                  setIsLoggingOutAll(false);
                }}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all"
                disabled={isLoggingOutAll}
              >
                Cancel
              </button>
              <button
                onClick={handleLogoutAllDevices}
                disabled={isLoggingOutAll}
                className={`flex-1 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all ${
                  isLoggingOutAll
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {isLoggingOutAll ? 'Logging out...' : 'Yes, logout all'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};