// Back office for company staff. Every route below `companyContext` acts on the
// company given in the X-Company-Id header and checks the member's role permissions.
const express = require("express");
const multer = require("multer");
const { verifyTokenFromCookie } = require("../jwt");
const { companyContext, requirePermission: perm } = require("../middlware/companyContext");
const business = require("../controllers/company/business.controller");
const team = require("../controllers/company/team.controller");
const products = require("../controllers/company/products.controller");
const orders = require("../controllers/company/orders.controller");
const inventory = require("../controllers/company/inventory.controller");
const purchasing = require("../controllers/company/purchasing.controller");
const sales = require("../controllers/company/sales.controller");
const billing = require("../controllers/company/billing.controller");
const quotes = require("../controllers/company/quotes.controller");
const returns = require("../controllers/company/returns.controller");
const supplierReturns = require("../controllers/company/supplierReturns.controller");
const payables = require("../controllers/company/payables.controller");
const accounting = require("../controllers/company/accounting.controller");
const hrc = require("../controllers/company/hr.controller");
const payrollc = require("../controllers/company/payroll.controller");
const dataio = require("../controllers/company/dataio.controller");
const scan = require("../controllers/company/scan.controller");
const compliancec = require("../controllers/company/compliance.controller");
const reportsHub = require("../controllers/company/reportsHub.controller");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = express.Router();
router.use(verifyTokenFromCookie);

// No company selected yet
router.get("/memberships", business.myMemberships);
router.get("/roles", business.roles);
router.post("/register", business.registerCompany);

router.use(companyContext);

router.get("/profile", business.getProfile);
router.patch("/profile", perm("company.manage"), business.updateProfile);
router.post("/logo", perm("company.manage"), upload.single("image"), business.uploadLogo);
router.get("/dashboard", perm("dashboard.view"), business.dashboard);
router.get("/audit", perm("audit.view"), business.auditLog);

router.get("/members", perm("members.view"), team.listMembers);
router.patch("/members/:id", perm("members.manage"), team.updateMember);
router.delete("/members/:id", perm("members.manage"), team.removeMember);
router.post("/invitations", perm("members.manage"), team.inviteMember);
router.delete("/invitations/:id", perm("members.manage"), team.revokeInvitation);

router.get("/products", perm("products.view"), products.listProducts);
router.post("/products", perm("products.manage"), products.createProduct);
router.patch("/products/:id", perm("products.manage"), products.updateProduct);
router.delete("/products/:id", perm("products.manage"), products.deleteProduct);
router.post("/products/:id/image", perm("products.manage"), upload.single("image"), products.uploadProductImage);
router.get("/products/:id/variants", perm("products.view", "inventory.view"), products.listVariants);
router.put("/products/:id/variants", perm("products.manage", "inventory.manage"), products.saveVariants);
router.get("/brands", perm("products.view"), products.listBrands);
router.post("/brands", perm("products.manage"), products.createBrand);

router.get("/orders", perm("orders.view"), orders.listOrders);
router.get("/orders/:id", perm("orders.view"), orders.getOrder);
router.patch("/orders/:id/status", perm("orders.manage", "orders.fulfil"), orders.updateOrderStatus);
router.patch("/orders/:id", perm("orders.manage", "orders.fulfil"), orders.updateOrderDetails);

router.get("/orders/:id/pick-list", perm("orders.view"), orders.pickList);

// ---- inventory ----
router.get("/inventory/settings", perm("inventory.view"), inventory.getSettings);
router.patch("/inventory/settings", perm("inventory.manage"), inventory.updateSettings);
router.get("/warehouses", perm("inventory.view", "purchasing.view"), inventory.listWarehouses);
router.post("/warehouses", perm("inventory.manage"), inventory.createWarehouse);
router.patch("/warehouses/:id", perm("inventory.manage"), inventory.updateWarehouse);
router.get("/warehouses/:id/bins", perm("inventory.view", "purchasing.receive"), inventory.listBins);
router.post("/warehouses/:id/bins", perm("inventory.manage"), inventory.createBin);
router.patch("/bins/:binId", perm("inventory.manage"), inventory.updateBin);
router.get("/inventory", perm("inventory.view"), inventory.stockList);
router.get("/inventory/lookup", perm("inventory.view", "purchasing.receive"), inventory.lookup);
router.get("/inventory/products/:id", perm("inventory.view"), inventory.productStock);
router.post("/inventory/adjust", perm("inventory.manage"), inventory.adjust);
router.get("/inventory/transfers", perm("inventory.view"), inventory.listTransfers);
router.post("/inventory/transfers", perm("inventory.manage"), inventory.createTransfer);
router.post("/inventory/transfers/:id/receive", perm("inventory.manage"), inventory.receiveTransfer);
router.post("/inventory/transfers/:id/cancel", perm("inventory.manage"), inventory.cancelTransfer);
router.post("/inventory/reassign", perm("inventory.manage"), inventory.reassignFlavor);
router.get("/inventory/movements", perm("inventory.view"), inventory.movements);
router.get("/inventory/expiring", perm("inventory.view"), inventory.expiring);
router.get("/inventory/valuation", perm("inventory.view"), inventory.valuation);
router.get("/inventory/reorder-suggestions", perm("inventory.view", "purchasing.view"), inventory.reorderSuggestions);

// ---- purchasing ----
router.get("/suppliers", perm("purchasing.view"), purchasing.listSuppliers);
router.get("/suppliers/:id", perm("purchasing.view"), purchasing.getSupplier);
router.post("/suppliers", perm("purchasing.manage"), purchasing.createSupplier);
router.patch("/suppliers/:id", perm("purchasing.manage"), purchasing.updateSupplier);
router.delete("/suppliers/:id", perm("purchasing.manage"), purchasing.deleteSupplier);
router.put("/suppliers/:id/products", perm("purchasing.manage"), purchasing.upsertSupplierProduct);
router.delete("/suppliers/:id/products/:productId", perm("purchasing.manage"), purchasing.removeSupplierProduct);

router.get("/purchase-orders", perm("purchasing.view", "purchasing.receive"), purchasing.listPos);
router.post("/purchase-orders/from-suggestions", perm("purchasing.manage"), purchasing.createFromSuggestions);
router.get("/purchase-orders/:id", perm("purchasing.view", "purchasing.receive"), purchasing.getPo);
router.post("/purchase-orders", perm("purchasing.manage"), purchasing.createPo);
router.patch("/purchase-orders/:id", perm("purchasing.manage"), purchasing.updatePo);
router.post("/purchase-orders/:id/send", perm("purchasing.manage"), purchasing.sendPo);
router.post("/purchase-orders/:id/receive", perm("purchasing.receive", "purchasing.manage"), purchasing.receivePo);
router.post("/purchase-orders/:id/close", perm("purchasing.manage"), purchasing.closePo);
router.post("/purchase-orders/:id/cancel", perm("purchasing.manage"), purchasing.cancelPo);

// ---- returns to suppliers ----
router.get("/supplier-returns", perm("purchasing.view", "purchasing.receive"), supplierReturns.listReturns);
router.post("/supplier-returns", perm("purchasing.manage"), supplierReturns.createReturn);
router.get("/supplier-returns/:id", perm("purchasing.view", "purchasing.receive"), supplierReturns.getReturn);
router.patch("/supplier-returns/:id", perm("purchasing.manage"), supplierReturns.updateReturn);
router.post("/supplier-returns/:id/ship", perm("purchasing.manage", "purchasing.receive"), supplierReturns.shipReturn);
router.post("/supplier-returns/:id/credit", perm("purchasing.manage"), supplierReturns.recordCredit);
router.post("/supplier-returns/:id/close", perm("purchasing.manage"), supplierReturns.closeReturn);
router.post("/supplier-returns/:id/cancel", perm("purchasing.manage"), supplierReturns.cancelReturn);

// ---- accounting: setup, chart of accounts, journal, reports, bank reconciliation ----
const AV = perm("accounting.view", "accounting.manage");
const AM = perm("accounting.manage");
router.get("/accounting/settings", perm("accounting.view", "accounting.manage", "invoices.manage", "purchasing.manage", "payroll.manage", "payroll.pay"), accounting.getSettings);
router.patch("/accounting/settings", AM, accounting.updateSettings);
router.get("/accounting/setup-preview", AM, accounting.setupPreview);
router.post("/accounting/setup", AM, accounting.setup);
router.get("/accounting/accounts", perm("accounting.view", "accounting.manage", "invoices.manage", "payroll.manage", "payroll.pay"), accounting.listAccounts);
router.post("/accounting/accounts", AM, accounting.createAccount);
router.patch("/accounting/accounts/:id", AM, accounting.updateAccount);
router.get("/accounting/journal", AV, accounting.listJournal);
router.post("/accounting/journal", AM, accounting.createEntry);
router.get("/accounting/journal/:id", AV, accounting.getEntry);
router.post("/accounting/journal/:id/reverse", AM, accounting.reverseEntry);
router.get("/accounting/reports/trial-balance", AV, accounting.trialBalance);
router.get("/accounting/reports/profit-loss", AV, accounting.profitLoss);
router.get("/accounting/reports/balance-sheet", AV, accounting.balanceSheet);
router.get("/accounting/reports/cash-flow", AV, accounting.cashFlow);
router.get("/accounting/reports/general-ledger", AV, accounting.generalLedger);
router.get("/accounting/overview", AV, accounting.overview);
router.get("/accounting/reconcile", AM, accounting.reconcileView);
router.post("/accounting/reconcile", AM, accounting.reconcile);

// ---- payables: supplier bills, supplier credits, expenses ----
router.get("/bills", AV, payables.listBills);
router.post("/bills", AM, payables.createBill);
router.get("/bills/:id", AV, payables.getBill);
router.post("/bills/:id/payments", AM, payables.payBill);
router.delete("/bills/:id/payments/:paymentId", AM, payables.removeBillPayment);
router.post("/bills/:id/void", AM, payables.voidBill);
router.get("/purchase-orders/:id/bill-draft", AM, payables.billDraftFromPo);
router.get("/vendor-credits", AV, payables.listCredits);
router.post("/vendor-credits", AM, payables.createCredit);
router.post("/vendor-credits/:id/apply", AM, payables.applyCredit);
router.get("/reports/ap-aging", AV, payables.apAging);
router.get("/expenses", AV, payables.listExpenses);
router.post("/expenses", AM, payables.createExpense);
router.post("/expenses/:id/void", AM, payables.voidExpense);

// ---- HR: employees, departments, attendance, leave ----
const HV = perm("hr.view", "hr.manage");
const HM = perm("hr.manage");
router.get("/hr/settings", perm("hr.view", "hr.manage", "payroll.view", "payroll.manage"), hrc.getSettings);
router.patch("/hr/settings", perm("payroll.manage"), hrc.updateSettings);
router.get("/hr/departments", HV, hrc.listDepartments);
router.post("/hr/departments", HM, hrc.createDepartment);
router.patch("/hr/departments/:id", HM, hrc.updateDepartment);
router.delete("/hr/departments/:id", HM, hrc.deleteDepartment);
router.get("/hr/employees", perm("hr.view", "hr.manage", "payroll.view"), hrc.listEmployees);
router.post("/hr/employees", HM, hrc.createEmployee);
router.get("/hr/employees/:id", perm("hr.view", "hr.manage", "payroll.view"), hrc.getEmployee);
router.patch("/hr/employees/:id", HM, hrc.updateEmployee);
router.post("/hr/employees/:id/terminate", HM, hrc.terminateEmployee);
router.post("/hr/employees/:id/reinstate", HM, hrc.reinstateEmployee);
router.put("/hr/employees/:id/pay-components", perm("payroll.manage"), hrc.setEmployeeComponents);
router.get("/hr/holidays", perm("hr.view", "hr.manage", "hr.attendance", "hr.leave"), hrc.listHolidays);
router.post("/hr/holidays", HM, hrc.createHoliday);
router.delete("/hr/holidays/:id", HM, hrc.deleteHoliday);
router.get("/hr/leave-types", perm("hr.view", "hr.manage", "hr.leave"), hrc.listLeaveTypes);
router.post("/hr/leave-types", HM, hrc.createLeaveType);
router.patch("/hr/leave-types/:id", HM, hrc.updateLeaveType);
router.get("/hr/attendance", perm("hr.attendance", "hr.manage"), hrc.dayAttendance);
router.put("/hr/attendance", perm("hr.attendance", "hr.manage"), hrc.saveAttendance);
router.get("/hr/attendance/summary", perm("hr.view", "hr.attendance", "hr.manage", "payroll.view"), hrc.attendanceSummary);
router.get("/hr/leave", perm("hr.leave", "hr.manage"), hrc.listLeave);
router.post("/hr/leave", perm("hr.leave", "hr.manage"), hrc.createLeave);
router.get("/hr/leave/balances", perm("hr.view", "hr.leave", "hr.manage"), hrc.leaveBalancesReport);
router.post("/hr/leave/:id/approve", perm("hr.leave", "hr.manage"), hrc.decideLeave("approved"));
router.post("/hr/leave/:id/reject", perm("hr.leave", "hr.manage"), hrc.decideLeave("rejected"));
router.post("/hr/leave/:id/cancel", perm("hr.leave", "hr.manage"), hrc.decideLeave("cancelled"));
// self-service for any staff member linked to an employee record
router.get("/me/hr", perm("company.view"), hrc.myHr);
router.post("/me/hr/leave", perm("company.view"), hrc.myLeaveRequest);
router.post("/me/hr/leave/:id/cancel", perm("company.view"), hrc.myLeaveCancel);
router.get("/me/hr/payslips/:id/pdf", perm("company.view"), hrc.myPayslipPdf);

// ---- payroll ----
const PV = perm("payroll.view", "payroll.manage", "payroll.pay");
const PM = perm("payroll.manage");
router.get("/payroll/components", perm("payroll.view", "payroll.manage"), hrc.listComponents);
router.post("/payroll/components", PM, hrc.createComponent);
router.patch("/payroll/components/:id", PM, hrc.updateComponent);
router.get("/payroll/runs", PV, payrollc.listRuns);
router.post("/payroll/runs", PM, payrollc.createRun);
router.get("/payroll/runs/:id", PV, payrollc.getRun);
router.post("/payroll/runs/:id/recalculate", PM, payrollc.recalcRun);
router.post("/payroll/runs/:id/approve", PM, payrollc.approveRun);
router.post("/payroll/runs/:id/pay", perm("payroll.pay", "payroll.manage"), payrollc.payRun);
router.post("/payroll/runs/:id/unpay", perm("payroll.pay", "payroll.manage"), payrollc.unpayRun);
router.post("/payroll/runs/:id/void", PM, payrollc.voidRun);
router.post("/payroll/runs/:id/email", perm("payroll.manage", "payroll.pay"), payrollc.emailRun);
router.put("/payroll/payslips/:id/adjustments", PM, payrollc.setAdjustments);
router.get("/payroll/payslips/:id/pdf", PV, payrollc.payslipPdf);
router.get("/payroll/liabilities", perm("payroll.view", "payroll.pay", "accounting.view", "accounting.manage"), payrollc.liabilities);
router.post("/payroll/remittances", perm("payroll.pay", "accounting.manage"), payrollc.remit);

// ---- CSV import / export (each type checks its own permission) ----
router.get("/data/types", perm("company.view"), dataio.importTypes);
router.get("/export/:type", perm("company.view"), dataio.exportCsv);
router.get("/import/:type/template", perm("company.view"), dataio.importTemplate);
router.post("/import/:type", perm("company.view"), dataio.importCsv);

// ---- warehouse scan station ----
router.get("/scan/lookup", perm("inventory.view", "purchasing.receive", "orders.fulfil"), scan.lookup);
router.post("/scan/count", perm("inventory.manage"), scan.count);
router.get("/scan/orders/:id", perm("orders.fulfil", "orders.manage"), scan.orderForPacking);
router.post("/scan/orders/:id/verify", perm("orders.fulfil", "orders.manage"), scan.verifyPack);
router.get("/scan/purchase-orders/:id", perm("purchasing.receive", "purchasing.manage"), scan.poForReceiving);

// ---- tobacco / vapor compliance ----
router.get("/compliance", perm("sales.manage", "customers.view"), compliancec.getSettings);
router.post("/compliance/rules", perm("sales.manage"), compliancec.saveRule);
router.patch("/compliance/rules/:id", perm("sales.manage"), compliancec.updateRule);
router.delete("/compliance/rules/:id", perm("sales.manage"), compliancec.deleteRule);
router.get("/compliance/licenses", perm("customers.view"), compliancec.listLicenses);
router.post("/compliance/licenses", perm("customers.manage"), compliancec.saveLicense);
router.delete("/compliance/licenses/:id", perm("customers.manage"), compliancec.deleteLicense);

// ---- reports hub & scheduled email reports (each report checks its own permission) ----
router.get("/reports/catalog", perm("company.view"), reportsHub.catalog);
router.get("/reports/run/:key", perm("company.view"), reportsHub.runNow);
router.get("/reports/schedules", perm("company.view"), reportsHub.listSchedules);
router.post("/reports/schedules", perm("company.view"), reportsHub.createSchedule);
router.patch("/reports/schedules/:id", perm("company.view"), reportsHub.updateSchedule);
router.delete("/reports/schedules/:id", perm("company.view"), reportsHub.deleteSchedule);
router.post("/reports/schedules/:id/run", perm("company.view"), reportsHub.runScheduleNow);
router.get("/reports/runs", perm("company.view"), reportsHub.listRuns);
router.get("/reports/runs/:id/csv", perm("company.view"), reportsHub.runCsv);

// ---- sales: settings, customers, pricing, promotions ----
router.get("/sales/settings", perm("customers.view", "sales.manage"), sales.getSettings);
router.patch("/sales/settings", perm("sales.manage"), sales.updateSettings);
router.get("/customers", perm("customers.view"), sales.listCustomers);
router.post("/customers", perm("customers.manage"), sales.addCustomer);
router.get("/customers/:id", perm("customers.view"), sales.getCustomer);
router.patch("/customers/:id", perm("customers.manage"), sales.updateCustomer);
router.get("/customer-groups", perm("customers.view", "pricing.manage"), sales.listGroups);
router.post("/customer-groups", perm("pricing.manage"), sales.createGroup);
router.patch("/customer-groups/:id", perm("pricing.manage"), sales.updateGroup);
router.delete("/customer-groups/:id", perm("pricing.manage"), sales.deleteGroup);
router.get("/price-lists", perm("pricing.view", "pricing.manage"), sales.listPriceLists);
router.post("/price-lists", perm("pricing.manage"), sales.createPriceList);
router.get("/price-lists/:id", perm("pricing.view", "pricing.manage"), sales.getPriceList);
router.patch("/price-lists/:id", perm("pricing.manage"), sales.updatePriceList);
router.delete("/price-lists/:id", perm("pricing.manage"), sales.deletePriceList);
router.put("/price-lists/:id/products/:productId", perm("pricing.manage"), sales.setProductPrices);
router.get("/promotions", perm("pricing.view", "pricing.manage"), sales.listPromotions);
router.post("/promotions", perm("pricing.manage"), sales.createPromotion);
router.patch("/promotions/:id", perm("pricing.manage"), sales.updatePromotion);
router.delete("/promotions/:id", perm("pricing.manage"), sales.deletePromotion);
router.get("/reports/sales", perm("reports.view"), sales.salesReport);
router.get("/reports/ar-aging", perm("invoices.view", "reports.view"), billing.arAging);

// ---- quotes ----
router.get("/quotes", perm("quotes.view", "quotes.manage"), quotes.listQuotes);
router.post("/quotes", perm("quotes.manage"), quotes.createQuote);
router.get("/quotes/:id", perm("quotes.view", "quotes.manage"), quotes.getQuote);
router.patch("/quotes/:id", perm("quotes.manage"), quotes.updateQuote);
router.get("/quotes/:id/pdf", perm("quotes.view", "quotes.manage"), quotes.quotePdf);
router.post("/quotes/:id/send", perm("quotes.manage"), quotes.sendQuote);
router.post("/quotes/:id/cancel", perm("quotes.manage"), quotes.cancelQuote);

// ---- invoices, payments, credit notes ----
router.get("/invoices", perm("invoices.view"), billing.listInvoices);
router.post("/invoices", perm("invoices.manage"), billing.createInvoice);
router.get("/invoices/:id", perm("invoices.view"), billing.getInvoice);
router.get("/invoices/:id/pdf", perm("invoices.view"), billing.invoicePdf);
router.post("/invoices/:id/send", perm("invoices.manage"), billing.sendInvoice);
router.post("/invoices/:id/payments", perm("invoices.manage"), billing.addPayment);
router.delete("/invoices/:id/payments/:paymentId", perm("invoices.manage"), billing.removePayment);
router.post("/invoices/:id/void", perm("invoices.manage"), billing.voidInvoice);
router.get("/credit-notes", perm("invoices.view"), billing.listCreditNotes);
router.post("/credit-notes", perm("invoices.manage"), billing.createCreditNote);
router.get("/credit-notes/:id", perm("invoices.view"), billing.getCreditNote);
router.get("/credit-notes/:id/pdf", perm("invoices.view"), billing.creditNotePdf);
router.post("/credit-notes/:id/send", perm("invoices.manage"), billing.sendCreditNote);
router.post("/credit-notes/:id/apply", perm("invoices.manage"), billing.applyCreditNote);
router.post("/credit-notes/:id/refund", perm("invoices.manage"), billing.refundCreditNote);
router.post("/credit-notes/:id/void", perm("invoices.manage"), billing.voidCreditNote);

// ---- returns (RMA) ----
router.get("/returns", perm("returns.view"), returns.listReturns);
router.post("/returns", perm("returns.manage"), returns.createReturnForOrder);
router.get("/returns/:id", perm("returns.view"), returns.getReturn);
router.post("/returns/:id/approve", perm("returns.manage"), returns.approveReturn);
router.post("/returns/:id/reject", perm("returns.manage"), returns.rejectReturn);
router.post("/returns/:id/receive", perm("returns.receive", "returns.manage"), returns.receiveReturn);
router.post("/returns/:id/resolve", perm("returns.manage"), returns.resolveReturn);
router.get("/orders/:id/returnable", perm("returns.view"), returns.returnableLines);

module.exports = router;
