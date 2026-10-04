import React, { useEffect } from "react";
import { Routes, Route, useNavigate, useParams } from "react-router-dom";
import { useDispatch } from "react-redux";
import { AppDispatch } from "../app/store";
import { useAuth } from "../features/auth/context/AuthContext";
import { fetchCart, clearCart } from "../features/cart/redux/cartSlice";

import { Header } from "./components/layout/Header";
import { Footer } from "./components/layout/Footer";
import { Toaster } from "./components/ui/sonner";
import { ScrollToTop } from "./components/layout/ScrollToTop";

// Pages
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { RegistrationPage } from "../features/auth/pages/RegistrationPage";
import { CartPage } from "../features/cart/pages/CartPage";
import { ContactPage } from "./pages/ContactPage";
import FAQ from "./pages/FAQ";
import { AccountPage } from "../features/account/pages/AccountPage";

import { BrandProductsPage } from "../features/products/pages/BrandProductsPage";
import { CategoryProductsPage } from "../features/products/pages/CategoryProductsPage";
import { ProductDetailPage } from "../features/products/pages/ProductDetailPage";
import { BrandList } from "../features/products/pages/BrandList";

import { ProtectedRoute } from "../features/auth/components/ProtectedRoute";
import { CheckoutPage } from "../features/checkout/pages/CheckoutPage";

import { UserManagement } from "../features/admin/pages/UserManagement";
import { AdminRoute } from "../features/admin/components/AdminRoute";
import { ProductManagement } from "../features/admin/pages/ProductManagement";
import { AdminDashboard } from "../features/admin/pages/AdminDashboard";

import FloatingChat from "../features/chatbot/FloatingChatbot";
import { ForgotPasswordPage } from "../features/auth/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/pages/ResetPasswordPage";
import { VerifyEmailPage } from "../features/auth/pages/VerifyEmailPage";
import { AcceptInvitePage } from "../features/auth/pages/AcceptInvitePage";
import { VerifyEmailBanner } from "../features/auth/components/VerifyEmailBanner";
import { CompaniesPage } from "../features/products/pages/CompaniesPage";
import { CompanyPage } from "../features/products/pages/CompanyPage";
import { SearchPage } from "../features/products/pages/SearchPage";
import { BusinessLayout } from "../features/business/pages/BusinessLayout";
import { DashboardPage as BusinessDashboard } from "../features/business/pages/DashboardPage";
import { OrdersPage as BusinessOrders } from "../features/business/pages/OrdersPage";
import { ProductsPage as BusinessProducts } from "../features/business/pages/ProductsPage";
import { TeamPage as BusinessTeam } from "../features/business/pages/TeamPage";
import { SettingsPage as BusinessSettings } from "../features/business/pages/SettingsPage";
import { ActivityPage as BusinessActivity } from "../features/business/pages/ActivityPage";
import { InventoryPage } from "../features/business/pages/InventoryPage";
import { WarehousesPage } from "../features/business/pages/WarehousesPage";
import { StockReportsPage } from "../features/business/pages/StockReportsPage";
import { SuppliersPage } from "../features/business/pages/SuppliersPage";
import { PurchaseOrdersPage } from "../features/business/pages/PurchaseOrdersPage";
import { PurchaseOrderFormPage } from "../features/business/pages/PurchaseOrderFormPage";
import { PurchaseOrderDetailPage } from "../features/business/pages/PurchaseOrderDetailPage";
import { ReorderPage } from "../features/business/pages/ReorderPage";
import { PackingSlipPage } from "../features/business/pages/PackingSlipPage";
import { CustomersPage } from "../features/business/pages/CustomersPage";
import { PricingPage } from "../features/business/pages/PricingPage";
import { QuotesPage, QuoteEditorPage } from "../features/business/pages/QuotesPage";
import { InvoicesPage } from "../features/business/pages/InvoicesPage";
import { ReturnsPage } from "../features/business/pages/ReturnsPage";
import { SalesReportsPage } from "../features/business/pages/SalesReportsPage";
import { SalesSettingsPage } from "../features/business/pages/SalesSettingsPage";
import { SupplierReturnsPage } from "../features/business/pages/SupplierReturnsPage";
import { AccountingOverviewPage } from "../features/business/pages/AccountingOverviewPage";
import { ChartOfAccountsPage } from "../features/business/pages/ChartOfAccountsPage";
import { JournalPage } from "../features/business/pages/JournalPage";
import { BillsPage } from "../features/business/pages/BillsPage";
import { ExpensesPage } from "../features/business/pages/ExpensesPage";
import { ReconcilePage } from "../features/business/pages/ReconcilePage";
import { FinancialReportsPage } from "../features/business/pages/FinancialReportsPage";
import { EmployeesPage } from "../features/business/pages/EmployeesPage";
import { EmployeeDetailPage } from "../features/business/pages/EmployeeDetailPage";
import { AttendancePage } from "../features/business/pages/AttendancePage";
import { LeavePage } from "../features/business/pages/LeavePage";
import { PayrollPage } from "../features/business/pages/PayrollPage";
import { PayrollRunPage } from "../features/business/pages/PayrollRunPage";
import { HrSettingsPage } from "../features/business/pages/HrSettingsPage";
import { MyHrPage } from "../features/business/pages/MyHrPage";
import { DataPage } from "../features/business/pages/DataPage";
import { ScanStationPage } from "../features/business/pages/ScanStationPage";
import { CompliancePage } from "../features/business/pages/CompliancePage";
import { ReportsHubPage } from "../features/business/pages/ReportsHubPage";
import { NotificationsPage } from "../features/notifications/notifications";
import { CHATBOT_URL } from "../config/config";
const BrandProductsPageWrapper = () => {
  const { brandName } = useParams();
  const navigate = useNavigate();
  if (!brandName) return null;
  return (
    <BrandProductsPage
      brandName={decodeURIComponent(brandName)}
      onNavigate={navigate}
    />
  );
};

const CategoryProductsPageWrapper = () => {
  const { categoryName } = useParams();
  const navigate = useNavigate();

  if (!categoryName) return null;

  return (
    <CategoryProductsPage
      categoryName={decodeURIComponent(categoryName)}
      onNavigate={navigate}
    />
  );
};

function App() {
  const { user } = useAuth();
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    if (user) {
      dispatch(fetchCart());
    } else {
      dispatch(clearCart());
    }
  }, [user, dispatch]);
  return (
    <>
      <ScrollToTop />
      <Header />
      <VerifyEmailBanner />

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />

          <Route
            path="/brand/:brandName"
            element={<BrandProductsPageWrapper />}
          />
          <Route
            path="/category/:categoryName"
            element={<CategoryProductsPageWrapper />}
          />
          <Route path="/product/:id" element={<ProductDetailPage />} />

          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegistrationPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />

          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/:slug" element={<CompanyPage />} />
          <Route path="/search" element={<SearchPage />} />

          <Route
            path="/notifications"
            element={
              <ProtectedRoute>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/business"
            element={
              <ProtectedRoute>
                <BusinessLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<BusinessDashboard />} />
            <Route path="orders" element={<BusinessOrders />} />
            <Route path="products" element={<BusinessProducts />} />
            <Route path="team" element={<BusinessTeam />} />
            <Route path="settings" element={<BusinessSettings />} />
            <Route path="activity" element={<BusinessActivity />} />
            <Route path="orders/:id/packing-slip" element={<PackingSlipPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="warehouses" element={<WarehousesPage />} />
            <Route path="stock-reports" element={<StockReportsPage />} />
            <Route path="suppliers" element={<SuppliersPage />} />
            <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="purchase-orders/new" element={<PurchaseOrderFormPage />} />
            <Route path="purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
            <Route path="purchase-orders/:id/edit" element={<PurchaseOrderFormPage />} />
            <Route path="reorder" element={<ReorderPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="pricing" element={<PricingPage />} />
            <Route path="quotes" element={<QuotesPage />} />
            <Route path="quotes/new" element={<QuoteEditorPage />} />
            <Route path="quotes/:id" element={<QuoteEditorPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="returns" element={<ReturnsPage />} />
            <Route path="sales-reports" element={<SalesReportsPage />} />
            <Route path="sales-settings" element={<SalesSettingsPage />} />
            <Route path="supplier-returns" element={<SupplierReturnsPage />} />
            <Route path="accounting" element={<AccountingOverviewPage />} />
            <Route path="chart-of-accounts" element={<ChartOfAccountsPage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="bills" element={<BillsPage />} />
            <Route path="expenses" element={<ExpensesPage />} />
            <Route path="reconcile" element={<ReconcilePage />} />
            <Route path="financial-reports" element={<FinancialReportsPage />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="employees/:id" element={<EmployeeDetailPage />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="leave" element={<LeavePage />} />
            <Route path="payroll" element={<PayrollPage />} />
            <Route path="payroll/:id" element={<PayrollRunPage />} />
            <Route path="hr-settings" element={<HrSettingsPage />} />
            <Route path="my-hr" element={<MyHrPage />} />
            <Route path="data" element={<DataPage />} />
            <Route path="scan" element={<ScanStationPage />} />
            <Route path="compliance" element={<CompliancePage />} />
            <Route path="reports-hub" element={<ReportsHubPage />} />
          </Route>

          <Route
            path="/cart"
            element={
              <ProtectedRoute>
                <CartPage />
              </ProtectedRoute>
            }
          />
          <Route path="/contact" element={<ContactPage />} />

          <Route path="/brand" element={<BrandList />} />
          <Route path="/FAQ" element={<FAQ />} />

          <Route
            path="/checkout"
            element={
              <ProtectedRoute>
                <CheckoutPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <AccountPage />
              </ProtectedRoute>
            }
          />
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route
              path="/admin-product-management"
              element={<ProductManagement />}
            />
          </Route>
        </Routes>
      </main>

      <Footer />
      <Toaster position="top-center" richColors />
      <FloatingChat
        botId="smoking"
        apiUrl={CHATBOT_URL}
        title="SmokeBuddy Assistant"
        welcomeMessage="Hello! Welcome to SmokeBuddy Wholesale. Need help with products, wholesale pricing, or orders? I'm here to help! 🔥"
        primaryColor="#8B5CF6"
        userId={user?.id}
      />
    </>
  );
}
export default App;
