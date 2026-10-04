// Back-office API for company staff. Every call is scoped to a company via X-Company-Id.
import { apiClient } from "../../../api/apiClient";

const co = (companyId: string, extra: Record<string, unknown> = {}) => ({
  ...extra,
  headers: { "X-Company-Id": companyId, ...((extra.headers as object) || {}) },
});

export const errorMessage = (err: any, fallback = "Something went wrong") =>
  err?.response?.data?.message || err?.message || fallback;

export type OrderStatus = "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";

export const businessApi = {
  // no company needed
  roles: async () => (await apiClient.get("/company/roles")).data.data as { role: string; description: string }[],
  register: async (body: Record<string, string>) => (await apiClient.post("/company/register", body)).data,

  profile: async (id: string) => (await apiClient.get("/company/profile", co(id))).data.data,
  updateProfile: async (id: string, body: Record<string, unknown>) =>
    (await apiClient.patch("/company/profile", body, co(id))).data,
  uploadLogo: async (id: string, file: File) => {
    const form = new FormData();
    form.append("image", file);
    return (await apiClient.post("/company/logo", form, co(id))).data.url as string;
  },
  dashboard: async (id: string) => (await apiClient.get("/company/dashboard", co(id))).data.data,
  audit: async (id: string, page = 1) => (await apiClient.get(`/company/audit?page=${page}`, co(id))).data,

  members: async (id: string) => (await apiClient.get("/company/members", co(id))).data,
  updateMember: async (id: string, memberId: number, body: { role?: string; status?: string }) =>
    (await apiClient.patch(`/company/members/${memberId}`, body, co(id))).data,
  removeMember: async (id: string, memberId: number) =>
    (await apiClient.delete(`/company/members/${memberId}`, co(id))).data,
  invite: async (id: string, email: string, role: string) =>
    (await apiClient.post("/company/invitations", { email, role }, co(id))).data,
  revokeInvite: async (id: string, inviteId: number) =>
    (await apiClient.delete(`/company/invitations/${inviteId}`, co(id))).data,

  products: async (id: string, params: { page?: number; search?: string; status?: string } = {}) => {
    const q = new URLSearchParams({ page: String(params.page || 1), limit: "20", search: params.search || "", status: params.status || "" });
    return (await apiClient.get(`/company/products?${q}`, co(id))).data;
  },
  createProduct: async (id: string, body: Record<string, unknown>) =>
    (await apiClient.post("/company/products", body, co(id))).data,
  updateProduct: async (id: string, productId: number, body: Record<string, unknown>) =>
    (await apiClient.patch(`/company/products/${productId}`, body, co(id))).data,
  deleteProduct: async (id: string, productId: number) =>
    (await apiClient.delete(`/company/products/${productId}`, co(id))).data,
  uploadProductImage: async (id: string, productId: number, file: File) => {
    const form = new FormData();
    form.append("image", file);
    return (await apiClient.post(`/company/products/${productId}/image`, form, co(id))).data.url as string;
  },
  brands: async (id: string) => (await apiClient.get("/company/brands", co(id))).data.data as { id: number; name: string }[],

  orders: async (id: string, params: { page?: number; search?: string; status?: string } = {}) => {
    const q = new URLSearchParams({ page: String(params.page || 1), limit: "20", search: params.search || "", status: params.status || "" });
    return (await apiClient.get(`/company/orders?${q}`, co(id))).data;
  },
  order: async (id: string, orderId: number) => (await apiClient.get(`/company/orders/${orderId}`, co(id))).data.data,
  setOrderStatus: async (id: string, orderId: number, body: { status: OrderStatus; tracking_number?: string; notes?: string; warehouse_id?: number }) =>
    (await apiClient.patch(`/company/orders/${orderId}/status`, body, co(id))).data,
  updateOrder: async (id: string, orderId: number, body: { tracking_number?: string; notes?: string }) =>
    (await apiClient.patch(`/company/orders/${orderId}`, body, co(id))).data,
};
