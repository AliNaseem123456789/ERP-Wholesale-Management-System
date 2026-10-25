// Reviews, problem reports, deals and page-view tracking (buyer and public side).
import { apiClient } from "../../api/apiClient";

const pub = { _public: true } as any;
export const errText = (e: any, fallback = "Something went wrong") => e?.response?.data?.message || e?.message || fallback;

export type Rating = { average: number | null; count: number; distribution?: Record<string, number> };
export type Review = {
  id: number; rating: number; title: string | null; body: string | null; author: string; verified: boolean;
  seller_reply: string | null; replied_at: string | null; created_at: string; updated_at: string; product_id: number | null;
  product?: { id: number; title: string; slug?: string | null } | null;
};
export type ReviewPage = { data: Review[]; total: number; page: number; pages: number; summary: Rating };
export type Reasons = Record<"listing" | "order" | "seller" | "review", Record<string, string>>;
export type DealCode = { code: string; description: string | null; type: "percent" | "fixed" | "free_shipping"; value: number; min_order_amount: number; ends_at: string | null; company?: { id: number; name: string; slug: string; logo_url?: string | null } };

export const insightsApi = {
  productReviews: async (id: number | string, page = 1, sort = "newest") => (await apiClient.get(`/marketplace/products/${id}/reviews?page=${page}&sort=${sort}`, pub)).data as ReviewPage,
  companyReviews: async (slug: string, page = 1, sort = "newest", scope = "supplier") => (await apiClient.get(`/marketplace/companies/${encodeURIComponent(slug)}/reviews?page=${page}&sort=${sort}&scope=${scope}`, pub)).data as ReviewPage,
  myReviews: async () => (await apiClient.get("/account/reviews")).data as {
    data: (Review & { status: string; hidden_reason?: string | null; company_id: number; product: any; company: any })[];
    eligible: { products: { id: number; title: string; slug?: string; order_number?: string; company?: { id: number; name: string } }[]; companies: { id: number; name: string; slug: string }[] };
  },
  createReview: async (body: { product_id?: number | string; company_id?: number | string; rating: number; title?: string; body?: string }) => (await apiClient.post("/account/reviews", body)).data as { message: string },
  updateReview: async (id: number, body: { rating?: number; title?: string; body?: string }) => (await apiClient.patch(`/account/reviews/${id}`, body)).data as { message: string },
  deleteReview: async (id: number) => (await apiClient.delete(`/account/reviews/${id}`)).data as { message: string },

  reasons: async () => (await apiClient.get("/account/reports/reasons")).data.data as Reasons,
  myReports: async () => (await apiClient.get("/account/reports")).data as { data: any[]; reasons: Reasons },
  report: async (body: Record<string, unknown>) => (await apiClient.post("/account/reports", body)).data as { message: string },

  dealCodes: async () => (await apiClient.get("/marketplace/deals/codes", pub)).data.data as DealCode[],
};

// ---- page-view tracking for seller analytics (anonymous; the server hashes the id) ----
const VISITOR_KEY = "mp_visitor";
const visitorId = () => {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v || !/^[a-zA-Z0-9-]{16,64}$/.test(v)) {
      v = (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return null; // storage blocked: the server still counts signed-in buyers
  }
};
/** Fire-and-forget; never shows errors. */
export const track = (event: { kind: "storefront" | "product" | "search"; company_slug?: string; product_id?: number | string; query?: string; product_ids?: (number | string)[] }) => {
  apiClient.post("/marketplace/track", { ...event, visitor: visitorId() }, pub).catch(() => {});
};

export const dealText = (c: Pick<DealCode, "type" | "value" | "min_order_amount">) =>
  `${c.type === "percent" ? `${c.value}% off` : c.type === "fixed" ? `$${c.value.toFixed(2)} off` : "Free shipping"}${c.min_order_amount > 0 ? ` orders over $${c.min_order_amount.toFixed(2)}` : ""}`;
