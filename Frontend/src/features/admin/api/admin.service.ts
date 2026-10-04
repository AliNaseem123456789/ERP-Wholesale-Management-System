import { apiClient } from "../../../api/apiClient";
export const adminService = {
  getUsers: async () => {
    const { data } = await apiClient.get("/admin/users");
    return data;
  },
  deleteUser: async (userId: string) => {
    const { data } = await apiClient.delete(`/admin/users/${userId}`);
    return data;
  },
  updateRole: async (userId: string, role: "ADMIN" | "USER") => {
    const { data } = await apiClient.patch(`/admin/users/${userId}/role`, {
      role,
    });
    return data;
  },
  getProducts: async (
    page: number = 1,
    limit: number = 10,
    search: string = "",
  ) => {
    const { data } = await apiClient.get(
      `/admin/products?page=${page}&limit=${limit}&search=${search}`,
    );
    return data;
  },
  uploadProductImage: async (file: File, productId: string) => {
    const formData = new FormData();
    formData.append("image", file);
    formData.append("productId", productId);
    const { data } = await apiClient.post("/admin/upload", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    return data.url;
  },
  createProduct: async (productData: any) => {
    const payload = { ...productData };
    if (payload.price) payload.price = Number(payload.price);
    if (payload.stock) payload.stock = Number(payload.stock);
    if (!payload.url || payload.url === "") {
      delete payload.url;
    }
    const { data } = await apiClient.post("/admin/products", payload);
    return data;
  },
  updateProduct: async (id: string, productData: any) => {
    const payload = { ...productData };
    if (payload.price) payload.price = Number(payload.price);
    if (payload.category) {
      payload.categories = [payload.category];
      delete payload.category;
    }
    const { data } = await apiClient.patch(`/admin/products/${id}`, payload);
    return data;
  },
  deleteProduct: async (id: string) => {
    await apiClient.delete(`/admin/products/${id}`);
  },
  updateFeature: async (slotKey: string, link: string, file?: File) => {
    const formData = new FormData();
    formData.append("slotKey", slotKey);
    formData.append("link", link);
    if (file) formData.append("image", file);

    const { data } = await apiClient.patch("/admin/update-feature", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  getSettings: async () => {
    const { data } = await apiClient.get("/admin/settings");
    return data;
  },
  // ---- companies (tenants) ----
  getCompanies: async (params: { status?: string; search?: string } = {}) => {
    const q = new URLSearchParams({ status: params.status || "", search: params.search || "" });
    const { data } = await apiClient.get(`/admin/companies?${q}`);
    return data.data;
  },
  createCompany: async (body: { name: string; ownerEmail?: string; status?: string }) => {
    const { data } = await apiClient.post("/admin/companies", body);
    return data;
  },
  updateCompany: async (id: number, body: { name?: string; status?: string; commission_rate?: number }) => {
    const { data } = await apiClient.patch(`/admin/companies/${id}`, body);
    return data;
  },
  getAllBrands: async () => {
    const { data } = await apiClient.get("/admin/brands");
    return data.data;
  },
  assignBrand: async (brandId: number, companyId: number) => {
    const { data } = await apiClient.post(`/admin/brands/${brandId}/assign`, { company_id: companyId });
    return data;
  },
  // ---- email outbox ----
  getEmails: async (status = "") => {
    const { data } = await apiClient.get(`/admin/emails${status ? `?status=${status}` : ""}`);
    return data;
  },
  sendTestEmail: async (to: string) => {
    const { data } = await apiClient.post("/admin/emails/test", { to });
    return data;
  },
  retryEmail: async (id: number) => {
    const { data } = await apiClient.post(`/admin/emails/${id}/retry`);
    return data;
  },
};
