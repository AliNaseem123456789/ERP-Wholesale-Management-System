// Operations API: CSV import/export, scan station, tobacco compliance, reports hub & scheduled reports.
import { apiClient } from "../../../api/apiClient";

const co = (companyId: string) => ({ headers: { "X-Company-Id": companyId } });
const qs = (params: Record<string, unknown>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();

export const COMPLIANCE_CATEGORIES: Record<string, string> = {
  none: "Not regulated", cigarettes: "Cigarettes", cigars: "Cigars", smokeless: "Smokeless / chewing tobacco", pipe_tobacco: "Pipe / roll-your-own tobacco",
  vapor_closed: "Vapor: closed system (pods, disposables)", vapor_open: "Vapor: open system (devices)", e_liquid: "E-liquid", nicotine_pouch: "Nicotine pouches",
  other_tobacco: "Other tobacco / nicotine",
};
export const TAX_TYPE_LABELS: Record<string, string> = { none: "No excise", percent: "% of wholesale price", per_ml: "Per ml of liquid", per_unit: "Per unit" };

/** Downloads a CSV through the API (cookies + company header) and saves it. */
export const downloadCsv = async (companyId: string, url: string, filename: string) => {
  const res = await apiClient.get(url, { ...co(companyId), responseType: "blob" });
  const blobUrl = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
};

export const opsApi = {
  dataTypes: async (c: string) => (await apiClient.get("/company/data/types", co(c))).data as { data: { type: string; columns: string[]; required: string[]; note: string | null; allowed: boolean }[]; exports: { type: string; allowed: boolean }[] },
  importCsv: async (c: string, type: string, csv: string, dryRun: boolean) => (await apiClient.post(`/company/import/${type}`, { csv, dry_run: dryRun }, co(c))).data,

  scanLookup: async (c: string, code: string, warehouseId?: string) => (await apiClient.get(`/company/scan/lookup?${qs({ code, warehouse_id: warehouseId })}`, co(c))).data.data,
  scanCount: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/scan/count", body, co(c))).data,
  packSheet: async (c: string, orderId: number | string) => (await apiClient.get(`/company/scan/orders/${orderId}`, co(c))).data.data,
  verifyPack: async (c: string, orderId: number | string, scanned: unknown[]) => (await apiClient.post(`/company/scan/orders/${orderId}/verify`, { scanned }, co(c))).data,
  receivingSheet: async (c: string, poId: number | string) => (await apiClient.get(`/company/scan/purchase-orders/${poId}`, co(c))).data.data,

  compliance: async (c: string) => (await apiClient.get("/company/compliance", co(c))).data.data,
  saveRule: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/compliance/rules", body, co(c))).data,
  updateRule: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.patch(`/company/compliance/rules/${id}`, body, co(c))).data,
  deleteRule: async (c: string, id: number) => (await apiClient.delete(`/company/compliance/rules/${id}`, co(c))).data,
  licenses: async (c: string) => (await apiClient.get("/company/compliance/licenses", co(c))).data.data as any[],
  saveLicense: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/compliance/licenses", body, co(c))).data,
  deleteLicense: async (c: string, id: number) => (await apiClient.delete(`/company/compliance/licenses/${id}`, co(c))).data,

  reportCatalog: async (c: string) => (await apiClient.get("/company/reports/catalog", co(c))).data.data as { key: string; label: string; period: boolean }[],
  runReport: async (c: string, key: string, p: Record<string, unknown>) => (await apiClient.get(`/company/reports/run/${key}?${qs(p)}`, co(c))).data.data,
  schedules: async (c: string) => (await apiClient.get("/company/reports/schedules", co(c))).data.data as any[],
  createSchedule: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/reports/schedules", body, co(c))).data,
  updateSchedule: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.patch(`/company/reports/schedules/${id}`, body, co(c))).data,
  deleteSchedule: async (c: string, id: number) => (await apiClient.delete(`/company/reports/schedules/${id}`, co(c))).data,
  runSchedule: async (c: string, id: number) => (await apiClient.post(`/company/reports/schedules/${id}/run`, {}, co(c))).data,
  reportRuns: async (c: string, scheduleId?: number) => (await apiClient.get(`/company/reports/runs?${qs({ schedule_id: scheduleId })}`, co(c))).data.data as any[],
};
