// Phase 5 back-office API: employees, departments, attendance, leave, payroll and "My HR".
import { apiClient } from "../../../api/apiClient";

const co = (companyId: string) => ({ headers: { "X-Company-Id": companyId } });
const qs = (params: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export type PayrollSettings = { workDays: number[]; hoursPerDay: number; overtimeMultiplier: number; taxBrackets: { upTo: number | null; rate: number }[]; payslipNotes: string };
export type Department = { id: number; name: string; code?: string | null; description?: string | null; is_active: boolean; manager?: { id: number; name: string } | null; employee_count?: number };
export type PayComponent = {
  id: number; code: string; name: string; kind: "earning" | "deduction" | "employer"; calc: "fixed" | "percent_base" | "percent_gross" | "tax_table";
  amount: number; percent: number; taxable: boolean; applies_to_all: boolean; account_id?: number | null; is_active: boolean; assigned?: number;
};
export type LeaveType = { id: number; name: string; paid: boolean; annual_days: number; is_active: boolean };
export type Employee = {
  id: number; employee_number: string; name: string; first_name: string; last_name?: string | null; email?: string | null; phone?: string | null;
  department?: { id: number; name: string } | null; department_id?: number | null; job_title?: string | null; employment_type: string; status: string;
  hire_date: string; termination_date?: string | null; date_of_birth?: string | null; national_id?: string | null; tax_number?: string | null; address?: string | null;
  emergency_contact_name?: string | null; emergency_contact_phone?: string | null; notes?: string | null; user_id?: number | null;
  pay_type?: "salary" | "hourly"; base_salary?: number; hourly_rate?: number; payment_method?: string; bank_name?: string | null; bank_account_number?: string | null; bank_routing?: string | null;
  pay_components?: { component_id: number; amount: number | null; percent: number | null; excluded: boolean; component: PayComponent }[];
};

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const EMPLOYMENT_TYPES: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", intern: "Intern" };
export const ATTENDANCE_STATUSES: Record<string, string> = { present: "Present", absent: "Absent", half_day: "Half day", paid_leave: "Paid leave", unpaid_leave: "Unpaid leave", holiday: "Holiday" };
export const KIND_LABELS: Record<string, string> = { earning: "Allowance / earning", deduction: "Deduction", employer: "Employer contribution" };
export const CALC_LABELS: Record<string, string> = { fixed: "Fixed amount", percent_base: "% of basic pay", percent_gross: "% of gross pay", tax_table: "Income-tax table" };
export const describeComponent = (c: { calc: string; amount: number; percent: number }, money: (n: unknown) => string) =>
  c.calc === "fixed" ? `${money(c.amount)} / month` : c.calc === "tax_table" ? "From the tax brackets" : `${c.percent}% of ${c.calc === "percent_base" ? "basic" : "gross"}`;

export const hrApi = {
  settings: async (c: string) => (await apiClient.get("/company/hr/settings", co(c))).data.data as PayrollSettings,
  saveSettings: async (c: string, body: Partial<PayrollSettings>) => (await apiClient.patch("/company/hr/settings", body, co(c))).data,

  departments: async (c: string) => (await apiClient.get("/company/hr/departments", co(c))).data.data as Department[],
  createDepartment: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/hr/departments", body, co(c))).data,
  updateDepartment: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.patch(`/company/hr/departments/${id}`, body, co(c))).data,
  deleteDepartment: async (c: string, id: number) => (await apiClient.delete(`/company/hr/departments/${id}`, co(c))).data,

  employees: async (c: string, p: Record<string, unknown> = {}) => (await apiClient.get(`/company/hr/employees?${qs(p)}`, co(c))).data as { data: Employee[]; summary: { count: number; monthly_salaries?: number } },
  employee: async (c: string, id: number | string) => (await apiClient.get(`/company/hr/employees/${id}`, co(c))).data.data,
  createEmployee: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/hr/employees", body, co(c))).data,
  updateEmployee: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.patch(`/company/hr/employees/${id}`, body, co(c))).data,
  terminate: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.post(`/company/hr/employees/${id}/terminate`, body, co(c))).data,
  reinstate: async (c: string, id: number) => (await apiClient.post(`/company/hr/employees/${id}/reinstate`, {}, co(c))).data,
  setComponents: async (c: string, id: number, components: unknown[]) => (await apiClient.put(`/company/hr/employees/${id}/pay-components`, { components }, co(c))).data,

  components: async (c: string) => (await apiClient.get("/company/payroll/components", co(c))).data.data as PayComponent[],
  createComponent: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/payroll/components", body, co(c))).data,
  updateComponent: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.patch(`/company/payroll/components/${id}`, body, co(c))).data,

  holidays: async (c: string, year: number) => (await apiClient.get(`/company/hr/holidays?year=${year}`, co(c))).data.data as { id: number; holiday_date: string; name: string }[],
  createHoliday: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/hr/holidays", body, co(c))).data,
  deleteHoliday: async (c: string, id: number) => (await apiClient.delete(`/company/hr/holidays/${id}`, co(c))).data,

  leaveTypes: async (c: string) => (await apiClient.get("/company/hr/leave-types", co(c))).data.data as LeaveType[],
  createLeaveType: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/hr/leave-types", body, co(c))).data,
  updateLeaveType: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.patch(`/company/hr/leave-types/${id}`, body, co(c))).data,

  attendanceDay: async (c: string, date: string) => (await apiClient.get(`/company/hr/attendance?date=${date}`, co(c))).data,
  saveAttendance: async (c: string, date: string, records: unknown[]) => (await apiClient.put("/company/hr/attendance", { date, records }, co(c))).data,
  attendanceSummary: async (c: string, p: Record<string, unknown>) => (await apiClient.get(`/company/hr/attendance/summary?${qs(p)}`, co(c))).data,

  leave: async (c: string, p: Record<string, unknown> = {}) => (await apiClient.get(`/company/hr/leave?${qs(p)}`, co(c))).data,
  createLeave: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/hr/leave", body, co(c))).data,
  decideLeave: async (c: string, id: number, action: "approve" | "reject" | "cancel", notes?: string) => (await apiClient.post(`/company/hr/leave/${id}/${action}`, { notes }, co(c))).data,
  leaveBalances: async (c: string, year: number) => (await apiClient.get(`/company/hr/leave/balances?year=${year}`, co(c))).data,

  runs: async (c: string, p: Record<string, unknown> = {}) => (await apiClient.get(`/company/payroll/runs?${qs(p)}`, co(c))).data,
  run: async (c: string, id: number | string) => (await apiClient.get(`/company/payroll/runs/${id}`, co(c))).data.data,
  createRun: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/payroll/runs", body, co(c))).data,
  recalc: async (c: string, id: number, body: Record<string, unknown> = {}) => (await apiClient.post(`/company/payroll/runs/${id}/recalculate`, body, co(c))).data,
  approve: async (c: string, id: number) => (await apiClient.post(`/company/payroll/runs/${id}/approve`, {}, co(c))).data,
  pay: async (c: string, id: number, body: Record<string, unknown>) => (await apiClient.post(`/company/payroll/runs/${id}/pay`, body, co(c))).data,
  unpay: async (c: string, id: number) => (await apiClient.post(`/company/payroll/runs/${id}/unpay`, {}, co(c))).data,
  voidRun: async (c: string, id: number) => (await apiClient.post(`/company/payroll/runs/${id}/void`, {}, co(c))).data,
  emailRun: async (c: string, id: number, payslipId?: number) => (await apiClient.post(`/company/payroll/runs/${id}/email`, { payslip_id: payslipId }, co(c))).data,
  adjust: async (c: string, payslipId: number, lines: unknown[]) => (await apiClient.put(`/company/payroll/payslips/${payslipId}/adjustments`, { lines }, co(c))).data,
  liabilities: async (c: string) => (await apiClient.get("/company/payroll/liabilities", co(c))).data,
  remit: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/payroll/remittances", body, co(c))).data,

  me: async (c: string) => (await apiClient.get("/company/me/hr", co(c))).data.data,
  myLeave: async (c: string, body: Record<string, unknown>) => (await apiClient.post("/company/me/hr/leave", body, co(c))).data,
  myLeaveCancel: async (c: string, id: number) => (await apiClient.post(`/company/me/hr/leave/${id}/cancel`, {}, co(c))).data,
};
