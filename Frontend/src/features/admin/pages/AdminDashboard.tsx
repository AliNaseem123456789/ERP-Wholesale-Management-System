import React, { useState } from "react";
import { Users, Package, LayoutDashboard, Settings, Building2, Tags, Mail, Gauge } from "lucide-react";
import { AdminOverview } from "./AdminOverview";
import { UserManagement } from "./UserManagement";
import { ProductManagement } from "./ProductManagement";
import { FeatureSettings } from "./FeaturesManagement";
import { CompaniesManagement } from "./CompaniesManagement";
import { BrandsManagement } from "./BrandsManagement";
import { EmailsManagement } from "./EmailsManagement";
type AdminTab = "overview" | "companies" | "brands" | "users" | "products" | "features" | "emails";

export const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const tabs = [
    { id: "overview", label: "Overview", icon: Gauge },
    { id: "companies", label: "Companies", icon: Building2 },
    { id: "brands", label: "Brands", icon: Tags },
    { id: "products", label: "All products", icon: Package },
    { id: "users", label: "Users", icon: Users },
    { id: "features", label: "Site Features", icon: LayoutDashboard },
    { id: "emails", label: "Emails", icon: Mail },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="bg-blue-600 p-1.5 rounded-lg">
                <Settings className="text-white" size={20} />
              </div>
              <span className="font-bold text-xl tracking-tight text-gray-900">
                Platform<span className="text-blue-600">Admin</span>
              </span>
            </div>
            <nav className="flex gap-1 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as AdminTab)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all
                    ${
                      activeTab === tab.id
                        ? "bg-blue-50 text-blue-700 shadow-sm"
                        : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                    }`}
                >
                  <tab.icon size={18} />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>
      <main className="p-6">
        <div className="max-w-7xl mx-auto">
          {activeTab === "overview" && <AdminOverview />}
          {activeTab === "companies" && <CompaniesManagement />}
          {activeTab === "brands" && <BrandsManagement />}
          {activeTab === "emails" && <EmailsManagement />}
          {activeTab === "products" && <ProductManagement />}
          {activeTab === "users" && <UserManagement />}
          {activeTab === "features" && <FeatureSettings />}
        </div>
      </main>
    </div>
  );
};
