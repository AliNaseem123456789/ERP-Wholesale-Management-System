// Buyer side of sales documents: invoices, credit notes, quotes and returns.
import { apiClient } from "../../../api/apiClient";
import { openPdf } from "../../business/api/sales.api";

export const errorText = (err: any, fallback = "Something went wrong") => err?.response?.data?.message || err?.message || fallback;

export const documentsApi = {
  invoices: async (status = "") => (await apiClient.get(`/account/invoices${status ? `?status=${status}` : ""}`)).data,
  invoice: async (id: number) => (await apiClient.get(`/account/invoices/${id}`)).data.data,
  invoicePdf: (id: number, number?: string) => openPdf(`/account/invoices/${id}/pdf`, undefined, `${number || "invoice"}.pdf`),
  creditNotePdf: (id: number, number?: string) => openPdf(`/account/credit-notes/${id}/pdf`, undefined, `${number || "credit-note"}.pdf`),

  quotes: async () => (await apiClient.get("/account/quotes")).data.data as any[],
  quote: async (id: number) => (await apiClient.get(`/account/quotes/${id}`)).data.data,
  quotePdf: (id: number, number?: string) => openPdf(`/account/quotes/${id}/pdf`, undefined, `${number || "quote"}.pdf`),
  requestQuote: async (body: { company_id: number; items?: { product_id: number; quantity: number }[]; notes?: string }) =>
    (await apiClient.post("/account/quotes", body)).data,
  acceptQuote: async (id: number, body: { shipping_address_id: number; payment_method?: string; business_name?: string }) =>
    (await apiClient.post(`/account/quotes/${id}/accept`, body)).data,
  declineQuote: async (id: number, reason?: string) => (await apiClient.post(`/account/quotes/${id}/decline`, { reason })).data,

  returns: async () => (await apiClient.get("/account/returns")).data.data as any[],
  returnable: async (orderId: number) => (await apiClient.get(`/account/orders/${orderId}/returnable`)).data,
  requestReturn: async (body: { order_id: number; reason: string; notes?: string; items: { order_item_id: number; quantity: number }[] }) =>
    (await apiClient.post("/account/returns", body)).data,
  cancelReturn: async (id: number) => (await apiClient.post(`/account/returns/${id}/cancel`, {})).data,
};

export const money = (n: unknown) => `$${Number(n || 0).toFixed(2)}`;
export const dateOnly = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

const BADGE: Record<string, string> = {
  issued: "bg-blue-100 text-blue-700", partially_paid: "bg-amber-100 text-amber-700", paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700", requested: "bg-amber-100 text-amber-700", draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-700", accepted: "bg-green-100 text-green-700", declined: "bg-red-100 text-red-700",
  expired: "bg-gray-200 text-gray-600", cancelled: "bg-gray-200 text-gray-600", approved: "bg-blue-100 text-blue-700",
  rejected: "bg-red-100 text-red-700", received: "bg-indigo-100 text-indigo-700", closed: "bg-green-100 text-green-700",
  applied: "bg-green-100 text-green-700", refunded: "bg-teal-100 text-teal-700",
};
export const badgeCls = (s: string) =>
  `inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${BADGE[s] || "bg-gray-100 text-gray-600"}`;
