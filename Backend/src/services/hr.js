// HR helpers: payroll settings, working-day calendar, leave days & balances, attendance from leave.
// Dates are handled as "YYYY-MM-DD" strings (UTC) to avoid time-zone drift.
const { HttpError } = require("../utils/http");
const { round2, num } = require("./money");

const DEFAULT_PAYROLL_SETTINGS = {
  workDays: [1, 2, 3, 4, 5], // 0 = Sunday ... 6 = Saturday
  hoursPerDay: 8,
  overtimeMultiplier: 1.5,
  // Annual income-tax brackets applied progressively to taxable pay x 12: [{ upTo: number | null, rate: % }]
  taxBrackets: [],
  payslipNotes: "",
};

const payrollSettings = (company) => {
  const s = { ...DEFAULT_PAYROLL_SETTINGS, ...(company?.settings?.payroll || {}) };
  s.workDays = Array.isArray(s.workDays) && s.workDays.length ? s.workDays.map(Number) : DEFAULT_PAYROLL_SETTINGS.workDays;
  s.hoursPerDay = Number(s.hoursPerDay) > 0 ? Number(s.hoursPerDay) : 8;
  s.overtimeMultiplier = Number(s.overtimeMultiplier) >= 1 ? Number(s.overtimeMultiplier) : 1.5;
  s.taxBrackets = Array.isArray(s.taxBrackets) ? s.taxBrackets : [];
  return s;
};

const validateSettings = (b, current) => {
  const next = { ...current };
  if (b.workDays !== undefined) {
    const days = [...new Set((Array.isArray(b.workDays) ? b.workDays : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    if (!days.length) throw new HttpError(400, "Choose at least one working day");
    next.workDays = days;
  }
  if (b.hoursPerDay !== undefined) {
    const h = Number(b.hoursPerDay);
    if (!(h > 0 && h <= 24)) throw new HttpError(400, "Hours per day must be between 0 and 24");
    next.hoursPerDay = h;
  }
  if (b.overtimeMultiplier !== undefined) {
    const m = Number(b.overtimeMultiplier);
    if (!(m >= 1 && m <= 5)) throw new HttpError(400, "Overtime rate must be between 1x and 5x");
    next.overtimeMultiplier = m;
  }
  if (b.taxBrackets !== undefined) {
    const list = Array.isArray(b.taxBrackets) ? b.taxBrackets : [];
    let prev = 0;
    next.taxBrackets = list.map((t, i) => {
      const upTo = t.upTo === null || t.upTo === "" || t.upTo === undefined ? null : Number(t.upTo);
      const rate = Number(t.rate);
      if (!(rate >= 0 && rate <= 100)) throw new HttpError(400, `Tax bracket ${i + 1}: rate must be 0-100%`);
      if (upTo !== null && !(upTo > prev)) throw new HttpError(400, `Tax bracket ${i + 1}: limits must increase`);
      if (upTo === null && i !== list.length - 1) throw new HttpError(400, "Only the last tax bracket can have no upper limit");
      prev = upTo ?? prev;
      return { upTo, rate };
    });
  }
  if (b.payslipNotes !== undefined) next.payslipNotes = String(b.payslipNotes || "").slice(0, 1000);
  return next;
};

// Progressive annual tax.
const annualTax = (income, brackets) => {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo === null || b.upTo === undefined ? Infinity : Number(b.upTo);
    if (income > lower) tax += (Math.min(income, upper) - lower) * (Number(b.rate) / 100);
    lower = upper;
    if (income <= upper) break;
  }
  return round2(tax);
};

// ---- dates ----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toStr = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const toDate = (s) => new Date(`${toStr(s)}T00:00:00Z`);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (s, n) => new Date(toDate(s).getTime() + n * 86400000).toISOString().slice(0, 10);
const parseDate = (v, name, fallback = undefined) => {
  if (v === undefined || v === null || v === "") {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `${name} is required`);
  }
  if (!DATE_RE.test(String(v)) || Number.isNaN(toDate(v).getTime())) throw new HttpError(400, `${name} must be a date (YYYY-MM-DD)`);
  return String(v);
};
const eachDay = function* (from, to) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
};
const monthBounds = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  const start = `${ym}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
};

const loadHolidays = async (db, companyId, from, to) => {
  const rows = await db.holidays.findMany({ where: { company_id: BigInt(companyId), holiday_date: { gte: toDate(from), lte: toDate(to) } } });
  return new Map(rows.map((h) => [toStr(h.holiday_date), h.name]));
};

const isWorkingDay = (d, settings, holidays) => settings.workDays.includes(toDate(d).getUTCDay()) && !holidays.has(d);
const workingDays = (from, to, settings, holidays) => {
  if (from > to) return [];
  return [...eachDay(from, to)].filter((d) => isWorkingDay(d, settings, holidays));
};

// ---- leave ----
const leaveDays = (start, end, halfDay, settings, holidays) => {
  const days = workingDays(start, end, settings, holidays);
  if (halfDay) {
    if (start !== end) throw new HttpError(400, "A half-day leave is for a single day");
    return days.length ? 0.5 : 0;
  }
  return days.length;
};

// Days of a leave type taken (approved) and requested (pending) in a calendar year.
const leaveUsage = async (db, employeeId, year) => {
  const rows = await db.leave_requests.findMany({
    where: { employee_id: BigInt(employeeId), status: { in: ["approved", "pending"] }, start_date: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) } },
    select: { leave_type_id: true, status: true, days: true },
  });
  const usage = new Map();
  for (const r of rows) {
    const k = String(r.leave_type_id);
    const u = usage.get(k) || { taken: 0, pending: 0 };
    if (r.status === "approved") u.taken = round2(u.taken + num(r.days));
    else u.pending = round2(u.pending + num(r.days));
    usage.set(k, u);
  }
  return usage;
};

const leaveBalances = async (db, companyId, employeeId, year) => {
  const [types, usage] = await Promise.all([
    db.leave_types.findMany({ where: { company_id: BigInt(companyId), is_active: true }, orderBy: { name: "asc" } }),
    leaveUsage(db, employeeId, year),
  ]);
  return types.map((t) => {
    const u = usage.get(String(t.id)) || { taken: 0, pending: 0 };
    const allowance = num(t.annual_days);
    return { leave_type_id: t.id, name: t.name, paid: t.paid, allowance, taken: u.taken, pending: u.pending, remaining: allowance ? round2(allowance - u.taken - u.pending) : null };
  });
};

// Throws if a payroll run that is approved/paid covers the date range (those payslips are final).
const assertPayrollOpen = async (db, companyId, from, to, what = "this period") => {
  const run = await db.payroll_runs.findFirst({
    where: { company_id: BigInt(companyId), status: { in: ["approved", "paid"] }, period_start: { lte: toDate(to) }, period_end: { gte: toDate(from) } },
    select: { run_number: true },
  });
  if (run) throw new HttpError(400, `Payroll ${run.run_number} covering ${what} is already approved. Void it first to make changes.`);
};

// Writes attendance rows for an approved leave (one per working day).
const applyLeave = async (tx, { companyId, request, leaveType, settings, holidays, userId }) => {
  const days = workingDays(toStr(request.start_date), toStr(request.end_date), settings, holidays);
  for (const d of days) {
    const data = {
      status: leaveType.paid ? "paid_leave" : "unpaid_leave",
      day_units: request.half_day ? 0.5 : 1,
      leave_request_id: request.id,
      check_in: null, check_out: null, hours: null, overtime_hours: 0,
      notes: leaveType.name, recorded_by: userId ? BigInt(userId) : null, updated_at: new Date(),
    };
    await tx.attendance.upsert({
      where: { employee_id_work_date: { employee_id: request.employee_id, work_date: toDate(d) } },
      create: { company_id: BigInt(companyId), employee_id: request.employee_id, work_date: toDate(d), ...data },
      update: data,
    });
  }
  return days.length;
};

const employeeName = (e) => [e?.first_name, e?.last_name].filter(Boolean).join(" ");

module.exports = {
  DEFAULT_PAYROLL_SETTINGS, payrollSettings, validateSettings, annualTax,
  DATE_RE, toStr, toDate, today, addDays, parseDate, eachDay, monthBounds,
  loadHolidays, isWorkingDay, workingDays, leaveDays, leaveUsage, leaveBalances, assertPayrollOpen, applyLeave, employeeName,
};
