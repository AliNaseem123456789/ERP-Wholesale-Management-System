// Phase 2 back-office API: inventory, warehouses, suppliers, purchase orders.
import { apiClient } from "../../../api/apiClient";

const co = (companyId: string) => ({ headers: { "X-Company-Id": companyId } });
const qs = (params: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export type Warehouse = {
  id: number; name: string; code: string; is_default: boolean; is_active: boolean;
  address_line1?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; phone?: string | null;
  binCount?: number; units?: number; reserved?: number;
};
export type Bin = { id: number; code: string; description?: string | null; is_active: boolean };
export type StockRow = {
  id: number; title: string; brand: string; sku?: string | null; barcode?: string | null; unit: string; is_active: boolean;
  cost_price: number; reorder_point: number; reorder_quantity: number; on_hand: number; reserved: number;
  available: number; stock_value: number; status: "ok" | "low" | "out";
  /** per-flavour breakdown for products with flavours */
  variants?: { flavor: string; on_hand: number; reserved: number; available: number }[] | null;
  /** stock not assigned to a flavour (recorded before flavours were tracked) */
  unassigned?: number;
  flavors?: string[];
};
export type Supplier = {
  id: number; name: string; code?: string | null; contact_name?: string | null; email?: string | null; phone?: string | null;
  website?: string | null; address_line1?: string | null; city?: string | null; state?: string | null; postal_code?: string | null;
  country?: string | null; tax_id?: string | null; payment_terms_days: number; currency: string; notes?: string | null; is_active: boolean;
  productCount?: number; poCount?: number; openPoCount?: number; openPoValue?: number;
};
export type PoStatus = "draft" | "sent" | "partially_received" | "received" | "closed" | "cancelled";

export const supplyApi = {
  // inventory settings
  inventorySettings: async (c: string) => (await apiClient.get("/company/inventory/settings", co(c))).data.data as { tracking: boolean; lowStockEmails: boolean },
  updateInventorySettings: async (c: string, body: { tracking?: boolean; lowStockEmails?: boolean }) =>
    (await apiClient.patch("/company/inventory/settings", body, co(c))).data,

  // warehouses & bins
  warehouses: async (c: string, activeOnly = false) =>
    (await apiClient.get(`/company/warehouses${activeOnly ? "?active=true" : ""}`, co(c))).data.data as Warehouse[],
  createWarehouse: async (c: string, body: Partial<Warehouse>) => (await apiClient.post("/company/warehouses", body, co(c))).data,
  updateWarehouse: async (c: string, id: number, body: Partial<Warehouse>) => (await apiClient.patch(`/company/warehouses/${id}`, body, co(c))).data,
  bins: async (c: string, warehouseId: number) => (await apiClient.get(`/company/warehouses/${warehouseId}/bins`, co(c))).data.data as Bin[],
  createBin: async (c: string, warehouseId: number, body: { code: string; description?: string }) =>
    (await apiClient.post(`/company/warehouses/${warehouseId}/bins`, body, co(c))).data,
  updateBin: async (c: string, binId: number, body: Partial<Bin>) => (await apiClient.patch(`/company/bins/${binId}`, body, co(c))).data,

  // stock
  stock: async (c: string, p: { warehouse_id?: number | string; search?: string; filter?: string; page?: number }) =>
    (await apiClient.get(`/company/inventory?${qs(p)}`, co(c))).data,
  productStock: async (c: string, productId: number) => (await apiClient.get(`/company/inventory/products/${productId}`, co(c))).data.data,
  lookup: async (c: string, code: string) => (await apiClient.get(`/company/inventory/lookup?${qs({ code })}`, co(c))).data.data,
  adjust: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/inventory/adjust", body, co(c))).data,
  transfers: async (c: string, status = "") => (await apiClient.get(`/company/inventory/transfers${status ? `?status=${status}` : ""}`, co(c))).data.data,
  createTransfer: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/inventory/transfers", body, co(c))).data,
  receiveTransfer: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.post(`/company/inventory/transfers/${id}/receive`, body, co(c))).data,
  cancelTransfer: async (c: string, id: number) => (await apiClient.post(`/company/inventory/transfers/${id}/cancel`, {}, co(c))).data,
  reassignFlavor: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/inventory/reassign", body, co(c))).data,
  variants: async (c: string, productId: number) => (await apiClient.get(`/company/products/${productId}/variants`, co(c))).data,
  saveVariants: async (c: string, productId: number, variants: { flavor: string; sku?: string; barcode?: string }[]) =>
    (await apiClient.put(`/company/products/${productId}/variants`, { variants }, co(c))).data,

  // returns to suppliers
  supplierReturns: async (c: string, p: { status?: string; supplier_id?: number | string } = {}) =>
    (await apiClient.get(`/company/supplier-returns?${qs(p)}`, co(c))).data,
  supplierReturn: async (c: string, id: number | string) => (await apiClient.get(`/company/supplier-returns/${id}`, co(c))).data,
  createSupplierReturn: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/supplier-returns", body, co(c))).data,
  updateSupplierReturn: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.patch(`/company/supplier-returns/${id}`, body, co(c))).data,
  shipSupplierReturn: async (c: string, id: number, email: boolean) => (await apiClient.post(`/company/supplier-returns/${id}/ship`, { email }, co(c))).data,
  creditSupplierReturn: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.post(`/company/supplier-returns/${id}/credit`, body, co(c))).data,
  closeSupplierReturn: async (c: string, id: number) => (await apiClient.post(`/company/supplier-returns/${id}/close`, {}, co(c))).data,
  cancelSupplierReturn: async (c: string, id: number) => (await apiClient.post(`/company/supplier-returns/${id}/cancel`, {}, co(c))).data,
  movements: async (c: string, p: Record<string, unknown>) => (await apiClient.get(`/company/inventory/movements?${qs(p)}`, co(c))).data,
  expiring: async (c: string, days: number) => (await apiClient.get(`/company/inventory/expiring?days=${days}`, co(c))).data.data,
  valuation: async (c: string) => (await apiClient.get("/company/inventory/valuation", co(c))).data,
  reorderSuggestions: async (c: string) => (await apiClient.get("/company/inventory/reorder-suggestions", co(c))).data.data,

  // suppliers
  suppliers: async (c: string, p: { search?: string; active?: boolean } = {}) =>
    (await apiClient.get(`/company/suppliers?${qs({ search: p.search, active: p.active ? "true" : "" })}`, co(c))).data.data as Supplier[],
  supplier: async (c: string, id: number) => (await apiClient.get(`/company/suppliers/${id}`, co(c))).data.data,
  createSupplier: async (c: string, body: Partial<Supplier>) => (await apiClient.post("/company/suppliers", body, co(c))).data,
  updateSupplier: async (c: string, id: number, body: Partial<Supplier>) => (await apiClient.patch(`/company/suppliers/${id}`, body, co(c))).data,
  deleteSupplier: async (c: string, id: number) => (await apiClient.delete(`/company/suppliers/${id}`, co(c))).data,
  saveSupplierProduct: async (c: string, id: number, body: Record<string, unknown>) =>
    (await apiClient.put(`/company/suppliers/${id}/products`, body, co(c))).data,
  removeSupplierProduct: async (c: string, id: number, productId: number) =>
    (await apiClient.delete(`/company/suppliers/${id}/products/${productId}`, co(c))).data,

  // purchase orders
  purchaseOrders: async (c: string, p: { status?: string; supplier_id?: number | string; search?: string; page?: number }) =>
    (await apiClient.get(`/company/purchase-orders?${qs(p)}`, co(c))).data,
  purchaseOrder: async (c: string, id: number | string) => (await apiClient.get(`/company/purchase-orders/${id}`, co(c))).data.data,
  createPurchaseOrder: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/purchase-orders", body, co(c))).data,
  updatePurchaseOrder: async (c: string, id: number | string, body: Record<string, unknown>) =>
    (await apiClient.patch(`/company/purchase-orders/${id}`, body, co(c))).data,
  sendPurchaseOrder: async (c: string, id: number | string, email: boolean) =>
    (await apiClient.post(`/company/purchase-orders/${id}/send`, { email }, co(c))).data,
  receivePurchaseOrder: async (c: string, id: number | string, body: Record<string, unknown>) =>
    (await apiClient.post(`/company/purchase-orders/${id}/receive`, body, co(c))).data,
  closePurchaseOrder: async (c: string, id: number | string) => (await apiClient.post(`/company/purchase-orders/${id}/close`, {}, co(c))).data,
  cancelPurchaseOrder: async (c: string, id: number | string) => (await apiClient.post(`/company/purchase-orders/${id}/cancel`, {}, co(c))).data,
  createFromSuggestions: async (c: string, orders: unknown[]) =>
    (await apiClient.post("/company/purchase-orders/from-suggestions", { orders }, co(c))).data,

  // fulfilment
  pickList: async (c: string, orderId: number | string) => (await apiClient.get(`/company/orders/${orderId}/pick-list`, co(c))).data.data,
};

export const ADJUST_REASONS: { value: string; label: string }[] = [
  { value: "opening_balance", label: "Opening balance" },
  { value: "stock_count", label: "Stock count" },
  { value: "received", label: "Received (no PO)" },
  { value: "found", label: "Found" },
  { value: "returned", label: "Customer return" },
  { value: "damaged", label: "Damaged" },
  { value: "expired", label: "Expired" },
  { value: "lost", label: "Lost / stolen" },
  { value: "sample", label: "Sample / giveaway" },
  { value: "other", label: "Other" },
];

export const PO_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", sent: "Sent", partially_received: "Partially received", received: "Received", closed: "Closed", cancelled: "Cancelled",
};
