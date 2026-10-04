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

const TABS = [
  { id: "orders", label: "Orders", icon: Package },
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "quotes", label: "Quotes", icon: FileSignature },
  { id: "returns", label: "Returns", icon: Undo2 },
  { id: "addresses", label: "Addresses", icon: MapPin },
  { id: "details", label: "Account Details", icon: User },
  { id: "subaccounts", label: "Subaccounts", icon: Users },
  { id: "saved-carts", label: "Saved Carts", icon: ShoppingBag },
  { id: "payments", label: "Payment History", icon: CreditCard },
  { id: "credit", label: "Total Credit", icon: Wallet },
  { id: "PACT", label: "PACT", icon: Wallet },
];

export const AccountPage: React.FC = () => {
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="max-w-7xl mx-auto w-full px-4 py-10 flex flex-col md:flex-row gap-8">
        <aside className="w-full md:w-72 shrink-0">
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-6 border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-bold text-gray-900">My Account</h2>
                {user?.role === "SUBACCOUNT" && (
                  <span className="text-[10px] bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                    Subaccount
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>

            <nav className="p-2">
              {filteredTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setSearchParams({ tab: tab.id })}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                      isActive
                        ? "bg-blue-600 text-white shadow-md shadow-blue-100"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon size={18} />
                      {tab.label}
                    </div>
                    {isActive && <ChevronRight size={14} />}
                  </button>
                );
              })}

              <hr className="my-2 border-gray-100" />

              {/* ✅ NEW: Logout from All Devices Button */}
              <button
                onClick={() => setShowLogoutAllConfirm(true)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-amber-600 hover:bg-amber-50 transition-all"
              >
                <LogOut size={18} />
                Logout from all devices
              </button>

              <button
                onClick={logout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-red-500 hover:bg-red-50 transition-all"
              >
                <LogOut size={18} />
                Logout (this device)
              </button>
            </nav>
          </div>
        </aside>

        <main className="flex-1 bg-white border border-gray-200 rounded-2xl shadow-sm min-h-[600px]">
          <header className="px-8 py-6 border-b border-gray-100 flex justify-between items-center">
            <h1 className="text-xl font-bold text-gray-900 capitalize">
              {activeTab.replace("-", " ")}
            </h1>
          </header>

          <div className="p-8">{renderTabContent()}</div>
        </main>
      </div>

      {/* ✅ NEW: Logout All Devices Confirmation Modal */}
      {showLogoutAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-md w-full mx-4 p-6 shadow-2xl">
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