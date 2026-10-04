// Phase 3 back-office API: customers, pricing, promotions, quotes, invoices, credit notes, returns, sales reports.
import { apiClient } from "../../../api/apiClient";

const co = (companyId: string) => ({ headers: { "X-Company-Id": companyId } });
const qs = (params: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();

/** Downloads a PDF through the API (cookies + headers) and opens it in a new tab. */
export const openPdf = async (url: string, headers?: Record<string, string>, filename = "document.pdf") => {
  // Open the tab right away (inside the click) so pop-up blockers allow it.
  const win = window.open("", "_blank");
  try {
    const res = await apiClient.get(url, { responseType: "blob", headers });
    const blobUrl = URL.createObjectURL(res.data as Blob);
    if (win) {
      win.location.href = blobUrl;
    } else {
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (err) {
    win?.close();
    throw new Error("Could not open the PDF");
  }
};

export type SalesSettings = {
  taxRate: number; shippingFee: number; freeShippingOver: number | null; autoInvoice: boolean; invoiceNotes: string;
  quoteValidityDays: number; allowCashOnDelivery: boolean; returnWindowDays: number;
};
export type CustomerGroup = { id: number; name: string; description?: string | null; discount_percent: number; price_list_id?: number | null; price_list?: { id: number; name: string } | null; customerCount?: number };
export type PriceList = { id: number; name: string; description?: string | null; is_default: boolean; is_active: boolean; itemCount?: number; groupCount?: number };
export type Promotion = {
  id: number; code: string; description?: string | null; type: "percent" | "fixed" | "free_shipping"; value: number; min_order_amount: number;
  starts_at?: string | null; ends_at?: string | null; max_uses?: number | null; max_uses_per_customer?: number | null; uses_count: number;
  is_active: boolean; total_discount?: number;
};

export const salesApi = {
  // settings
  settings: async (c: string) => (await apiClient.get("/company/sales/settings", co(c))).data.data as SalesSettings,
  saveSettings: async (c: string, body: Partial<SalesSettings>) => (await apiClient.patch("/company/sales/settings", body, co(c))).data,

  // customers
  customers: async (c: string, p: { search?: string; group_id?: number | string; status?: string } = {}) =>
    (await apiClient.get(`/company/customers?${qs(p)}`, co(c))).data.data as any[],
  customer: async (c: string, id: number) => (await apiClient.get(`/company/customers/${id}`, co(c))).data.data,
  addCustomer: async (c: string, email: string) => (await apiClient.post("/company/customers", { email }, co(c))).data,
  updateCustomer: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.patch(`/company/customers/${id}`, body, co(c))).data,

  // groups
  groups: async (c: string) => (await apiClient.get("/company/customer-groups", co(c))).data.data as CustomerGroup[],
  createGroup: async (c: string, body: Partial<CustomerGroup>) => (await apiClient.post("/company/customer-groups", body, co(c))).data,
  updateGroup: async (c: string, id: number, body: Partial<CustomerGroup>) => (await apiClient.patch(`/company/customer-groups/${id}`, body, co(c))).data,
  deleteGroup: async (c: string, id: number) => (await apiClient.delete(`/company/customer-groups/${id}`, co(c))).data,

  // price lists
  priceLists: async (c: string) => (await apiClient.get("/company/price-lists", co(c))).data.data as PriceList[],
  priceList: async (c: string, id: number) => (await apiClient.get(`/company/price-lists/${id}`, co(c))).data.data,
  createPriceList: async (c: string, body: Partial<PriceList>) => (await apiClient.post("/company/price-lists", body, co(c))).data,
  updatePriceList: async (c: string, id: number, body: Partial<PriceList>) => (await apiClient.patch(`/company/price-lists/${id}`, body, co(c))).data,
  deletePriceList: async (c: string, id: number) => (await apiClient.delete(`/company/price-lists/${id}`, co(c))).data,
  setPrices: async (c: string, listId: number, productId: number, tiers: { min_quantity: number; price: number }[]) =>
    (await apiClient.put(`/company/price-lists/${listId}/products/${productId}`, { tiers }, co(c))).data,

  // promotions
  promotions: async (c: string) => (await apiClient.get("/company/promotions", co(c))).data.data as Promotion[],
  createPromotion: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/promotions", body, co(c))).data,
  updatePromotion: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.patch(`/company/promotions/${id}`, body, co(c))).data,
  deletePromotion: async (c: string, id: number) => (await apiClient.delete(`/company/promotions/${id}`, co(c))).data,

  // quotes
  quotes: async (c: string, p: { status?: string; search?: string } = {}) => (await apiClient.get(`/company/quotes?${qs(p)}`, co(c))).data,
  quote: async (c: string, id: number | string) => (await apiClient.get(`/company/quotes/${id}`, co(c))).data.data,
  createQuote: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/quotes", body, co(c))).data,
  updateQuote: async (c: string, id: number | string, body: Record<string, unknown>) => (await apiClient.patch(`/company/quotes/${id}`, body, co(c))).data,
  sendQuote: async (c: string, id: number | string) => (await apiClient.post(`/company/quotes/${id}/send`, {}, co(c))).data,
  cancelQuote: async (c: string, id: number | string) => (await apiClient.post(`/company/quotes/${id}/cancel`, {}, co(c))).data,
  quotePdf: (c: string, id: number | string, number?: string) => openPdf(`/company/quotes/${id}/pdf`, co(c).headers, `${number || "quote"}.pdf`),

  // invoices & payments
  invoices: async (c: string, p: { status?: string; search?: string; customer_id?: number | string; page?: number } = {}) =>
    (await apiClient.get(`/company/invoices?${qs(p)}`, co(c))).data,
  invoice: async (c: string, id: number | string) => (await apiClient.get(`/company/invoices/${id}`, co(c))).data.data,
  createInvoice: async (c: string, orderId: number, send = true) => (await apiClient.post("/company/invoices", { order_id: orderId, send }, co(c))).data,
  sendInvoice: async (c: string, id: number, to?: string) => (await apiClient.post(`/company/invoices/${id}/send`, { to }, co(c))).data,
  addPayment: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.post(`/company/invoices/${id}/payments`, body, co(c))).data,
  removePayment: async (c: string, id: number, paymentId: number) => (await apiClient.delete(`/company/invoices/${id}/payments/${paymentId}`, co(c))).data,
  voidInvoice: async (c: string, id: number, reason?: string) => (await apiClient.post(`/company/invoices/${id}/void`, { reason }, co(c))).data,
  invoicePdf: (c: string, id: number, number?: string) => openPdf(`/company/invoices/${id}/pdf`, co(c).headers, `${number || "invoice"}.pdf`),

  // credit notes
  creditNotes: async (c: string, p: { status?: string; customer_id?: number | string } = {}) => (await apiClient.get(`/company/credit-notes?${qs(p)}`, co(c))).data.data as any[],
  creditNote: async (c: string, id: number) => (await apiClient.get(`/company/credit-notes/${id}`, co(c))).data.data,
  createCreditNote: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/credit-notes", body, co(c))).data,
  applyCreditNote: async (c: string, id: number, invoiceId: number, amount?: number) =>
    (await apiClient.post(`/company/credit-notes/${id}/apply`, { invoice_id: invoiceId, amount }, co(c))).data,
  refundCreditNote: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.post(`/company/credit-notes/${id}/refund`, body, co(c))).data,
  voidCreditNote: async (c: string, id: number) => (await apiClient.post(`/company/credit-notes/${id}/void`, {}, co(c))).data,
  sendCreditNote: async (c: string, id: number) => (await apiClient.post(`/company/credit-notes/${id}/send`, {}, co(c))).data,
  creditNotePdf: (c: string, id: number, number?: string) => openPdf(`/company/credit-notes/${id}/pdf`, co(c).headers, `${number || "credit-note"}.pdf`),

  // returns
  returns: async (c: string, p: { status?: string; search?: string } = {}) => (await apiClient.get(`/company/returns?${qs(p)}`, co(c))).data,
  returnRequest: async (c: string, id: number) => (await apiClient.get(`/company/returns/${id}`, co(c))).data,
  returnable: async (c: string, orderId: number) => (await apiClient.get(`/company/orders/${orderId}/returnable`, co(c))).data,
  createReturn: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/returns", body, co(c))).data,
  approveReturn: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.post(`/company/returns/${id}/approve`, body, co(c))).data,
  rejectReturn: async (c: string, id: number, staff_notes: string) => (await apiClient.post(`/company/returns/${id}/reject`, { staff_notes }, co(c))).data,
  receiveReturn: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.post(`/company/returns/${id}/receive`, body, co(c))).data,
  resolveReturn: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.post(`/company/returns/${id}/resolve`, body, co(c))).data,

  // reports
  salesReport: async (c: string, p: { from?: string; to?: string; group_by?: string }) => (await apiClient.get(`/company/reports/sales?${qs(p)}`, co(c))).data,
  arAging: async (c: string) => (await apiClient.get("/company/reports/ar-aging", co(c))).data,
};

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "cash_on_delivery", label: "Cash on delivery" },
  { value: "other", label: "Other" },
];
export const paymentLabel = (m?: string | null) =>
  m === "on_account" ? "On account" : PAYMENT_METHODS.find((p) => p.value === m)?.label || (m ? m.replace(/_/g, " ") : "—");

export const RETURN_REASONS: Record<string, string> = {
  damaged: "Damaged",
  wrong_item: "Wrong item sent",
  expired: "Expired or short-dated",
  not_as_described: "Not as described",
  no_longer_needed: "No longer needed",
  other: "Other",
};

export const customerName = (u?: any) =>
  u ? u.business_name || [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email : "—";
