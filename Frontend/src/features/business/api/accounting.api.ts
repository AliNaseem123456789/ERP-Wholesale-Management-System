// Phase 4 back-office API: accounting setup, chart of accounts, journal, bills, supplier credits,
// expenses, bank reconciliation and financial reports.
import { apiClient } from "../../../api/apiClient";

const co = (companyId: string) => ({ headers: { "X-Company-Id": companyId } });
const qs = (params: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type Account = {
  id: number; code: string; name: string; type: AccountType; subtype: string; system_key?: string | null;
  description?: string | null; is_active: boolean; debit: number; credit: number; balance: number;
};
export type AccountingSettings = { enabled: boolean; startDate: string | null; lockDate: string | null; inventoryTracked: boolean; entries: number };
export type JournalLine = { id: number; account: { id: number; code: string; name: string; type: string }; debit: number; credit: number; description?: string | null };
export type JournalEntry = {
  id: number; entry_number: string; entry_date: string; memo?: string | null; source_type: string; source_id?: string | null;
  total: number; reversed: boolean; reversal_of_id?: number | null; created_at: string; lines?: JournalLine[];
};

export const TYPE_LABELS: Record<AccountType, string> = { asset: "Assets", liability: "Liabilities", equity: "Equity", revenue: "Income", expense: "Expenses" };
export const SUBTYPE_LABELS: Record<string, string> = {
  cash: "Cash", bank: "Bank", receivable: "Receivable", inventory: "Inventory", current_asset: "Other current asset", fixed_asset: "Fixed asset",
  payable: "Payable", current_liability: "Current liability", long_term_liability: "Long-term liability", equity: "Equity",
  income: "Income", other_income: "Other income", contra_revenue: "Returns & discounts", cogs: "Cost of sales", expense: "Expense", other_expense: "Other expense",
};
export const SOURCE_LABELS: Record<string, string> = {
  opening_balance: "Opening balances", manual: "Manual entry", invoice: "Invoice", invoice_payment: "Customer payment", credit_note: "Credit note",
  credit_refund: "Refund", shipment: "Goods shipped", customer_return: "Customer return", goods_receipt: "Goods received", stock_adjustment: "Stock adjustment",
  transfer_loss: "Lost in transit", supplier_return: "Return to supplier", supplier_return_settled: "Supplier return credit", bill: "Supplier bill",
  bill_payment: "Bill payment", vendor_credit: "Supplier credit", expense: "Expense", payroll: "Payroll",
};
export const BILL_PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank transfer" }, { value: "check", label: "Check" }, { value: "cash", label: "Cash" },
  { value: "card", label: "Card" }, { value: "other", label: "Other" },
];
/** Cash, bank and credit card accounts (what money can be paid from / into). */
export const isMoneyAccount = (a: Account) => a.is_active && (["cash", "bank"].includes(a.subtype) || (a.type === "liability" && a.subtype === "current_liability" && !a.system_key));
export const accountLabel = (a?: { code: string; name: string } | null) => (a ? `${a.code} · ${a.name}` : "—");

export const accountingApi = {
  settings: async (c: string) => (await apiClient.get("/company/accounting/settings", co(c))).data.data as AccountingSettings,
  saveSettings: async (c: string, body: { lockDate: string | null }) => (await apiClient.patch("/company/accounting/settings", body, co(c))).data,
  setupPreview: async (c: string) => (await apiClient.get("/company/accounting/setup-preview", co(c))).data.data as { inventory: number; receivables: number },
  setup: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/accounting/setup", body, co(c))).data,
  overview: async (c: string) => (await apiClient.get("/company/accounting/overview", co(c))).data.data,

  accounts: async (c: string) => (await apiClient.get("/company/accounting/accounts", co(c))).data as { data: Account[]; types: AccountType[]; subtypes: Record<string, string[]> },
  createAccount: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/accounting/accounts", body, co(c))).data,
  updateAccount: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.patch(`/company/accounting/accounts/${id}`, body, co(c))).data,

  journal: async (c: string, p: Record<string, unknown> = {}) => (await apiClient.get(`/company/accounting/journal?${qs(p)}`, co(c))).data as { data: JournalEntry[]; totalPages: number; totalCount: number },
  entry: async (c: string, id: number) => (await apiClient.get(`/company/accounting/journal/${id}`, co(c))).data.data as JournalEntry,
  createEntry: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/accounting/journal", body, co(c))).data,
  reverseEntry: async (c: string, id: number, date?: string) => (await apiClient.post(`/company/accounting/journal/${id}/reverse`, { date }, co(c))).data,

  trialBalance: async (c: string, p: Record<string, unknown>) => (await apiClient.get(`/company/accounting/reports/trial-balance?${qs(p)}`, co(c))).data,
  profitLoss: async (c: string, p: Record<string, unknown>) => (await apiClient.get(`/company/accounting/reports/profit-loss?${qs(p)}`, co(c))).data,
  balanceSheet: async (c: string, p: Record<string, unknown>) => (await apiClient.get(`/company/accounting/reports/balance-sheet?${qs(p)}`, co(c))).data,
  cashFlow: async (c: string, p: Record<string, unknown>) => (await apiClient.get(`/company/accounting/reports/cash-flow?${qs(p)}`, co(c))).data,
  generalLedger: async (c: string, p: Record<string, unknown>) => (await apiClient.get(`/company/accounting/reports/general-ledger?${qs(p)}`, co(c))).data,
  apAging: async (c: string) => (await apiClient.get("/company/reports/ap-aging", co(c))).data,

  reconcileView: async (c: string, p: Record<string, unknown>) => (await apiClient.get(`/company/accounting/reconcile?${qs(p)}`, co(c))).data.data,
  reconcile: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/accounting/reconcile", body, co(c))).data,

  // payables
  bills: async (c: string, p: Record<string, unknown> = {}) => (await apiClient.get(`/company/bills?${qs(p)}`, co(c))).data,
  bill: async (c: string, id: number | string) => (await apiClient.get(`/company/bills/${id}`, co(c))).data.data,
  billDraft: async (c: string, poId: number | string) => (await apiClient.get(`/company/purchase-orders/${poId}/bill-draft`, co(c))).data.data,
  createBill: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/bills", body, co(c))).data,
  payBill: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.post(`/company/bills/${id}/payments`, body, co(c))).data,
  removeBillPayment: async (c: string, id: number, paymentId: number) => (await apiClient.delete(`/company/bills/${id}/payments/${paymentId}`, co(c))).data,
  voidBill: async (c: string, id: number) => (await apiClient.post(`/company/bills/${id}/void`, {}, co(c))).data,
  credits: async (c: string, p: Record<string, unknown> = {}) => (await apiClient.get(`/company/vendor-credits?${qs(p)}`, co(c))).data.data as any[],
  createCredit: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/vendor-credits", body, co(c))).data,
  applyCredit: async (c: string, id: number, billId: number, amount?: number) => (await apiClient.post(`/company/vendor-credits/${id}/apply`, { bill_id: billId, amount }, co(c))).data,

  expenses: async (c: string, p: Record<string, unknown> = {}) => (await apiClient.get(`/company/expenses?${qs(p)}`, co(c))).data,
  createExpense: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/expenses", body, co(c))).data,
  voidExpense: async (c: string, id: number) => (await apiClient.post(`/company/expenses/${id}/void`, {}, co(c))).data,
};
