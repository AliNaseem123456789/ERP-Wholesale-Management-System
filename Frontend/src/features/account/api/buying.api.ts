// Buyer tools: buy again, recurring orders, back-in-stock alerts.
import { apiClient } from "../../../api/apiClient";

export const buyingError = (e: any) => e?.response?.data?.message || e?.message || "Something went wrong";

export type RecurringItem = { id: number; product_id: number; flavor: string; quantity: number; title: string; product: { id: number; slug?: string; status: string; company?: { id: number; name: string } | null } };
export type Recurring = {
  id: number; name: string; frequency: "weekly" | "biweekly" | "monthly"; day_of_week: number | null; day_of_month: number | null;
  mode: "auto" | "review"; status: "active" | "paused"; next_run_on: string; skip_next: boolean;
  shipping_address_id: number | null; billing_address_id: number | null; payment_methods: Record<string, string> | null;
  last_run_at: string | null; last_result: { ok: boolean; message: string; ran_on?: string; cart_id?: number; skipped?: { title: string; reason: string }[] } | null;
  items: RecurringItem[];
};
export type StockAlert = { id: number; product_id: number; flavor: string; title: string; created_at: string; notified_at: string | null; product: { id: number; slug?: string; company?: string } };

export const buyingApi = {
  reorder: async (orderId: number | string, cartId?: string | null) =>
    (await apiClient.post(`/cart/reorder/${orderId}`, { cart_id: cartId || undefined })).data as { message: string; cart_id: number; added: unknown[]; skipped: { title: string; reason: string }[] },

  recurring: async () => (await apiClient.get("/account/recurring-orders")).data.data as Recurring[],
  createRecurring: async (body: Record<string, unknown>) => (await apiClient.post("/account/recurring-orders", body)).data as { message: string; data: Recurring },
  updateRecurring: async (id: number, body: Record<string, unknown>) => (await apiClient.patch(`/account/recurring-orders/${id}`, body)).data as { message: string; data: Recurring },
  cancelRecurring: async (id: number) => (await apiClient.delete(`/account/recurring-orders/${id}`)).data as { message: string },
  runRecurring: async (id: number) => (await apiClient.post(`/account/recurring-orders/${id}/run`)).data as { message: string; data: { ok: boolean; cart_id?: number } },

  alerts: async () => (await apiClient.get("/account/stock-alerts")).data.data as StockAlert[],
  createAlert: async (productId: number | string, flavor?: string | null) => (await apiClient.post("/account/stock-alerts", { product_id: productId, flavor: flavor || undefined })).data as { message: string },
  deleteAlert: async (id: number) => (await apiClient.delete(`/account/stock-alerts/${id}`)).data as { message: string },
};

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const scheduleText = (r: Pick<Recurring, "frequency" | "day_of_week" | "day_of_month">) =>
  r.frequency === "monthly" ? `Monthly on day ${r.day_of_month}` : `${r.frequency === "weekly" ? "Every" : "Every other"} ${DAYS[r.day_of_week ?? 1]}`;
