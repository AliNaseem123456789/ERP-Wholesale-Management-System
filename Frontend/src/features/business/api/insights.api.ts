// Seller side: analytics, reviews, problem reports, platform commission.
import { apiClient } from "../../../api/apiClient";

const co = (companyId: string) => ({ headers: { "X-Company-Id": companyId } });

export type AnalyticsReport = {
  days: number; from: string; to: string;
  totals: { storefront_views: number; product_views: number; search_impressions: number; add_to_carts: number; visitors: number; orders: number; revenue: number; conversion: number | null; buyers: number; new_buyers: number };
  previous: { storefront_views: number; product_views: number; search_impressions: number; add_to_carts: number; visitors: number; orders: number; revenue: number };
  series: { day: string; views: number; carts: number; orders: number; revenue: number }[];
  top_products: { product_id: number; title: string; slug?: string; sku?: string; views: number; carts: number; units: number; revenue: number; view_to_cart: number | null }[];
  top_searches: { query: string; impressions: number }[];
  quotes: { sent: number; accepted: number; win_rate: number | null; requested: number };
  rfqs: { invited: number; answered: number; won: number };
};
export type Statement = {
  id: number; statement_number: string; period_start: string; period_end: string; order_count: number; sales_amount: number; commission_amount: number;
  status: "issued" | "paid" | "void"; paid_at: string | null; payment_reference: string | null; notes: string | null; created_at: string;
  company?: { id: number; name: string; slug: string } | null; orders?: any[];
};

export const sellerInsightsApi = {
  analytics: async (c: string, days: number) => (await apiClient.get(`/company/analytics?days=${days}`, co(c))).data.data as AnalyticsReport,
  reviews: async (c: string, params: Record<string, string | number>) => (await apiClient.get(`/company/reviews?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v !== undefined).map(([k, v]) => [k, String(v)]))}`, co(c))).data as {
    data: any[]; total: number; page: number; pages: number; summary: { average: number | null; count: number; distribution: Record<string, number> }; supplier: { average: number | null; count: number };
  },
  reply: async (c: string, id: number, reply: string) => (await apiClient.post(`/company/reviews/${id}/reply`, { reply }, co(c))).data as { message: string },
  reportReview: async (c: string, id: number, reason: string, details?: string) => (await apiClient.post(`/company/reviews/${id}/report`, { reason, details }, co(c))).data as { message: string },
  reports: async (c: string, status = "") => (await apiClient.get(`/company/reports${status ? `?status=${status}` : ""}`, co(c))).data.data as any[],
  respond: async (c: string, id: number, response: string) => (await apiClient.post(`/company/reports/${id}/respond`, { response }, co(c))).data as { message: string },
  commission: async (c: string) => (await apiClient.get("/company/commission", co(c))).data as { data: Statement[]; rate: number; unbilled: { order_count: number; sales_amount: number; commission_amount: number; orders: any[] } },
  statement: async (c: string, id: number) => (await apiClient.get(`/company/commission/statements/${id}`, co(c))).data.data as Statement,
};
