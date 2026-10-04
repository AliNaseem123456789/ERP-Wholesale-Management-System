// Payroll engine: builds payslips for a period, approves (posts the payroll to the books), pays, voids.
//
// Per employee and period:
//   working days  = days in the period on the company's work days, less holidays
//   salaried: basic = monthly salary x employed working days / working days;
//             unpaid days (absent, half days, unpaid leave) are deducted at salary / working days
//   hourly:   basic = rate x hours worked (+ paid leave at hours-per-day)
//   overtime  = overtime hours x hourly rate (salary / working days / hours per day for salaried) x multiplier
//   components (allowances, deductions, employer contributions): fixed (allowances pro-rated by paid days),
//             % of basic, % of gross, or the income-tax table on taxable pay
//   net = gross - deductions
// Journal (on approval, dated the period end):
//   Dr Wages (gross) + Dr Payroll taxes (employer contributions)
//   Cr Payroll liabilities (deductions + employer contributions) + Cr Wages payable (net)
// Payment: Dr Wages payable / Cr Bank (or cash).
const { HttpError } = require("../utils/http");
const { round2, num } = require("./money");
const { nextNumber } = require("./sequences");
const ledger = require("./ledger");
const hr = require("./hr");

const KINDS = ["earning", "deduction", "employer"];
const CALCS = { earning: ["fixed", "percent_base"], deduction: ["fixed", "percent_base", "percent_gross", "tax_table"], employer: ["fixed", "percent_base", "percent_gross"] };

const lockRun = async (tx, companyId, id) => {
  const [row] = await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id = ${BigInt(id)} AND company_id = ${BigInt(companyId)} FOR UPDATE`;
  if (!row) throw new HttpError(404, "Payroll run not found");
  return tx.payroll_runs.findUnique({ where: { id: row.id } });
};

// Employees on the payroll for the period: hired by the end, not terminated before the start.
const eligibleEmployees = (tx, companyId, start, end) =>
  tx.employees.findMany({
    where: {
      company_id: BigInt(companyId),
      hire_date: { lte: hr.toDate(end) },
      OR: [{ termination_date: null }, { termination_date: { gte: hr.toDate(start) } }],
      NOT: { status: "terminated", termination_date: null },
    },
    include: { departments: { select: { name: true } }, employee_pay_components: true },
    orderBy: [{ first_name: "asc" }, { id: "asc" }],
  });

/** Computes one payslip (pure, given the loaded data). Returns { figures, lines, warnings }. */
const computePayslip = ({ employee, start, end, settings, holidays, attendance, components, manualLines = [] }) => {
  const warnings = [];
  const periodDays = hr.workingDays(start, end, settings, holidays);
  const W = periodDays.length;
  const empStart = hr.toStr(employee.hire_date) > start ? hr.toStr(employee.hire_date) : start;
  const empEnd = employee.termination_date && hr.toStr(employee.termination_date) < end ? hr.toStr(employee.termination_date) : end;
  const employedDays = hr.workingDays(empStart, empEnd, settings, holidays).length;
  const isWork = (d) => d >= empStart && d <= empEnd && hr.isWorkingDay(d, settings, holidays);

  let unpaid = 0, paidLeave = 0, hours = 0, overtime = 0, presentDays = 0;
  for (const a of attendance) {
    const d = hr.toStr(a.work_date);
    if (d < empStart || d > empEnd) continue;
    overtime += num(a.overtime_hours);
    if (!isWork(d)) continue;
    const units = num(a.day_units) || 1;
    switch (a.status) {
      case "absent": unpaid += units; break;
      case "unpaid_leave": unpaid += units; break;
      case "half_day": unpaid += 0.5; hours += a.hours != null ? num(a.hours) : settings.hoursPerDay / 2; presentDays += 0.5; break;
      case "paid_leave": paidLeave += units; if (units < 1) { hours += a.hours != null ? num(a.hours) : settings.hoursPerDay * (1 - units); } break;
      case "present": hours += a.hours != null ? num(a.hours) : settings.hoursPerDay; presentDays += 1; break;
      default: break;
    }
  }
  unpaid = Math.min(unpaid, employedDays);

  const lines = [];
  const add = (l) => { if (round2(l.amount) !== 0) lines.push({ ...l, amount: round2(l.amount) }); };
  let base = 0;
  let hourlyRate = 0;
  let fraction = 1; // pro-rating for fixed allowances
  if (employee.pay_type === "hourly") {
    hourlyRate = num(employee.hourly_rate);
    const basic = round2(hourlyRate * hours);
    add({ kind: "earning", code: "BASIC", name: `Hours worked (${round2(hours)} h)`, amount: basic, taxable: true });
    const leavePay = round2(hourlyRate * settings.hoursPerDay * paidLeave);
    add({ kind: "earning", code: "PAID_LEAVE", name: `Paid leave (${paidLeave} day${paidLeave === 1 ? "" : "s"})`, amount: leavePay, taxable: true });
    base = round2(basic + leavePay);
    fraction = W ? employedDays / W : 0;
    if (!attendance.length) warnings.push("No attendance recorded: hourly pay is based on hours in attendance.");
  } else {
    const salary = num(employee.base_salary);
    if (!W) warnings.push("No working days in this period.");
    const daily = W ? salary / W : 0;
    hourlyRate = daily / settings.hoursPerDay;
    const basic = W ? round2((salary * employedDays) / W) : 0;
    add({ kind: "earning", code: "BASIC", name: employedDays < W ? `Basic salary (${employedDays} of ${W} days)` : "Basic salary", amount: basic, taxable: true });
    const unpaidPay = round2(daily * unpaid);
    add({ kind: "earning", code: "UNPAID", name: `Unpaid absence (${unpaid} day${unpaid === 1 ? "" : "s"})`, amount: -unpaidPay, taxable: true });
    base = round2(basic - unpaidPay);
    fraction = W ? (employedDays - unpaid) / W : 0;
    if (!salary) warnings.push("No monthly salary set.");
  }
  if (overtime > 0) {
    add({ kind: "earning", code: "OVERTIME", name: `Overtime (${round2(overtime)} h x ${settings.overtimeMultiplier})`, amount: hourlyRate * overtime * settings.overtimeMultiplier, taxable: true });
  }

  // components assigned to this employee
  const assigned = new Map(employee.employee_pay_components.map((x) => [String(x.component_id), x]));
  const active = components.filter((c) => {
    const a = assigned.get(String(c.id));
    return c.is_active && (a ? !a.excluded : c.applies_to_all);
  });
  const val = (c) => {
    const a = assigned.get(String(c.id));
    return { amount: a?.amount != null ? num(a.amount) : num(c.amount), percent: a?.percent != null ? num(a.percent) : num(c.percent) };
  };
  const compLine = (c, amount) => ({ kind: c.kind, code: c.code, name: c.name, amount, taxable: c.kind === "earning" ? c.taxable : false, component_id: c.id, account_id: c.account_id });

  for (const c of active.filter((x) => x.kind === "earning")) {
    const v = val(c);
    add(compLine(c, c.calc === "percent_base" ? (base * v.percent) / 100 : v.amount * fraction));
  }
  for (const m of manualLines.filter((x) => x.kind === "earning")) add({ ...m, is_manual: true });
  const gross = round2(lines.filter((l) => l.kind === "earning").reduce((s, l) => s + l.amount, 0));
  const taxable = round2(lines.filter((l) => l.kind === "earning" && l.taxable).reduce((s, l) => s + l.amount, 0));

  for (const c of active.filter((x) => x.kind === "deduction")) {
    const v = val(c);
    let amount;
    if (c.calc === "tax_table") {
      if (!settings.taxBrackets.length) warnings.push(`${c.name}: no tax brackets set in payroll settings.`);
      amount = taxable > 0 ? annualTax(taxable * 12, settings.taxBrackets) / 12 : 0;
    } else if (c.calc === "percent_base") amount = (base * v.percent) / 100;
    else if (c.calc === "percent_gross") amount = (gross * v.percent) / 100;
    else amount = v.amount;
    add(compLine(c, amount));
  }
  for (const m of manualLines.filter((x) => x.kind === "deduction")) add({ ...m, is_manual: true });
  for (const c of active.filter((x) => x.kind === "employer")) {
    const v = val(c);
    add(compLine(c, c.calc === "percent_base" ? (base * v.percent) / 100 : c.calc === "percent_gross" ? (gross * v.percent) / 100 : v.amount));
  }
  for (const m of manualLines.filter((x) => x.kind === "employer")) add({ ...m, is_manual: true });

  const deductions = round2(lines.filter((l) => l.kind === "deduction").reduce((s, l) => s + l.amount, 0));
  const employer = round2(lines.filter((l) => l.kind === "employer").reduce((s, l) => s + l.amount, 0));
  const net = round2(gross - deductions);
  if (net < 0) warnings.push("Deductions are more than gross pay: net pay is negative.");
  return {
    figures: {
      working_days: W, paid_days: round2(employedDays - unpaid), unpaid_days: round2(unpaid), hours_worked: round2(hours),
      overtime_hours: round2(overtime), gross, taxable, total_deductions: deductions, employer_total: employer, net,
    },
    lines: lines.map((l, i) => ({ ...l, sort_order: i })),
    warnings,
  };
};
const annualTax = hr.annualTax;

const snapshotOf = (e) => ({
  name: hr.employeeName(e), employee_number: e.employee_number, job_title: e.job_title, department: e.departments?.name || null,
  email: e.email, pay_type: e.pay_type, base_salary: num(e.base_salary), hourly_rate: num(e.hourly_rate),
  payment_method: e.payment_method, bank_name: e.bank_name, bank_account_last4: e.bank_account_number ? String(e.bank_account_number).slice(-4) : null,
  tax_number: e.tax_number, hire_date: hr.toStr(e.hire_date),
});

// (Re)builds every payslip of a draft run. Manual lines on existing payslips are kept.
const buildRun = async (tx, { company, run, onlyEmployeeId = null }) => {
  const companyId = company.id;
  const start = hr.toStr(run.period_start);
  const end = hr.toStr(run.period_end);
  const settings = hr.payrollSettings(company);
  const [holidays, components, employees] = await Promise.all([
    hr.loadHolidays(tx, companyId, start, end),
    tx.pay_components.findMany({ where: { company_id: companyId }, orderBy: [{ sort_order: "asc" }, { id: "asc" }] }),
    eligibleEmployees(tx, companyId, start, end),
  ]);
  const list = onlyEmployeeId ? employees.filter((e) => String(e.id) === String(onlyEmployeeId)) : employees;
  const attendance = await tx.attendance.findMany({
    where: { company_id: companyId, employee_id: { in: list.map((e) => e.id) }, work_date: { gte: hr.toDate(start), lte: hr.toDate(end) } },
  });
  const byEmp = new Map();
  for (const a of attendance) {
    const k = String(a.employee_id);
    if (!byEmp.has(k)) byEmp.set(k, []);
    byEmp.get(k).push(a);
  }
  if (!onlyEmployeeId) {
    // employees no longer eligible drop off the run
    await tx.payslips.deleteMany({ where: { payroll_run_id: run.id, employee_id: { notIn: employees.map((e) => e.id) } } });
  }
  for (const e of list) {
    const existing = await tx.payslips.findUnique({ where: { payroll_run_id_employee_id: { payroll_run_id: run.id, employee_id: e.id } }, include: { payslip_lines: true } });
    const manual = (existing?.payslip_lines || []).filter((l) => l.is_manual).map((l) => ({ kind: l.kind, code: l.code, name: l.name, amount: num(l.amount), taxable: l.taxable, account_id: l.account_id }));
    const r = computePayslip({ employee: e, start, end, settings, holidays, attendance: byEmp.get(String(e.id)) || [], components, manualLines: manual });
    const data = { ...r.figures, snapshot: snapshotOf(e), warnings: r.warnings, updated_at: new Date() };
    const slip = existing
      ? await tx.payslips.update({ where: { id: existing.id }, data })
      : await tx.payslips.create({ data: { company_id: companyId, payroll_run_id: run.id, employee_id: e.id, payslip_number: `${run.run_number}-${e.employee_number}`, ...data } });
    await tx.payslip_lines.deleteMany({ where: { payslip_id: slip.id } });
    if (r.lines.length) {
      await tx.payslip_lines.createMany({
        data: r.lines.map((l) => ({
          payslip_id: slip.id, component_id: l.component_id || null, kind: l.kind, code: l.code || null, name: String(l.name).slice(0, 255),
          amount: l.amount, taxable: !!l.taxable, account_id: l.account_id || null, is_manual: !!l.is_manual, sort_order: l.sort_order,
        })),
      });
    }
  }
  return refreshTotals(tx, run.id);
};

const refreshTotals = async (tx, runId) => {
  const [t] = await tx.$queryRaw`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(gross),0)::float AS gross, COALESCE(SUM(total_deductions),0)::float AS ded,
           COALESCE(SUM(employer_total),0)::float AS emp, COALESCE(SUM(net),0)::float AS net
    FROM payslips WHERE payroll_run_id = ${runId}`;
  return tx.payroll_runs.update({
    where: { id: runId },
    data: { employee_count: t.n, total_gross: round2(t.gross), total_deductions: round2(t.ded), total_employer: round2(t.emp), total_net: round2(t.net), updated_at: new Date() },
  });
};

const createRun = async (tx, { company, periodStart, periodEnd, payDate, notes, userId }) => {
  if (periodEnd < periodStart) throw new HttpError(400, "The period end is before its start");
  if (hr.addDays(periodStart, 62) < periodEnd) throw new HttpError(400, "A payroll period can be at most two months");
  const overlap = await tx.payroll_runs.findFirst({
    where: { company_id: company.id, status: { not: "void" }, period_start: { lte: hr.toDate(periodEnd) }, period_end: { gte: hr.toDate(periodStart) } },
  });
  if (overlap) throw new HttpError(409, `Payroll ${overlap.run_number} already covers part of this period`);
  const run = await tx.payroll_runs.create({
    data: {
      company_id: company.id, run_number: await nextNumber(tx, company.id, "PR"), period_start: hr.toDate(periodStart), period_end: hr.toDate(periodEnd),
      pay_date: hr.toDate(payDate || periodEnd), notes: notes ? String(notes).slice(0, 2000) : null, created_by: userId ? BigInt(userId) : null,
    },
  });
  const built = await buildRun(tx, { company, run });
  if (!built.employee_count) throw new HttpError(400, "No employees are on the payroll for this period");
  return built;
};

// Journal entry for an approved run.
const runJournalLines = async (tx, companyId, runId) => {
  const lines = await tx.payslip_lines.findMany({ where: { payslips: { payroll_run_id: runId } } });
  const slips = await tx.payslips.findMany({ where: { payroll_run_id: runId }, select: { net: true } });
  const agg = new Map(); // key -> { account, debit, credit }
  const put = (account, debit, credit) => {
    const k = String(account);
    const a = agg.get(k) || { account, debit: 0, credit: 0 };
    a.debit = round2(a.debit + debit);
    a.credit = round2(a.credit + credit);
    agg.set(k, a);
  };
  for (const l of lines) {
    const amt = num(l.amount);
    if (l.kind === "earning") put(l.account_id || "wages", amt, 0);
    else if (l.kind === "deduction") put(l.account_id || "payroll_liabilities", 0, amt);
    else {
      put("payroll_taxes", amt, 0);
      put(l.account_id || "payroll_liabilities", 0, amt);
    }
  }
  put("wages_payable", 0, round2(slips.reduce((s, p) => s + num(p.net), 0)));
  // net each account to one side
  return [...agg.values()].map((a) => {
    const n = round2(a.debit - a.credit);
    return n >= 0 ? { account: a.account, debit: n } : { account: a.account, credit: -n };
  });
};

const approveRun = async (tx, { company, runId, userId }) => {
  const run = await lockRun(tx, company.id, runId);
  if (run.status !== "draft") throw new HttpError(400, `This payroll is ${run.status}`);
  const fresh = await buildRun(tx, { company, run }); // recalculate with the latest attendance
  if (!fresh.employee_count) throw new HttpError(400, "There are no payslips in this run");
  const negative = await tx.payslips.findFirst({ where: { payroll_run_id: run.id, net: { lt: 0 } }, select: { payslip_number: true } });
  if (negative) throw new HttpError(400, `Payslip ${negative.payslip_number} has negative net pay. Fix it before approving.`);
  await ledger.post(tx, {
    companyId: company.id, date: run.period_end, sourceType: "payroll", sourceId: run.id, userId,
    memo: `Payroll ${run.run_number} (${hr.toStr(run.period_start)} to ${hr.toStr(run.period_end)})`,
    lines: await runJournalLines(tx, company.id, run.id),
  });
  return tx.payroll_runs.update({ where: { id: run.id }, data: { status: "approved", approved_by: userId ? BigInt(userId) : null, approved_at: new Date(), updated_at: new Date() } });
};

const payRun = async (tx, { company, runId, accountId, paidAt, reference, userId }) => {
  const run = await lockRun(tx, company.id, runId);
  if (run.status !== "approved") throw new HttpError(400, run.status === "draft" ? "Approve the payroll first" : `This payroll is ${run.status}`);
  const books = ledger.accountingSettings(company).enabled;
  let account = null;
  if (accountId) account = (await ledger.assertMoneyAccount(tx, company.id, accountId)).id;
  else if (books) account = await ledger.accountId(tx, company.id, "bank");
  const date = paidAt || hr.toStr(run.pay_date);
  await ledger.post(tx, {
    companyId: company.id, date, sourceType: "payroll_payment", sourceId: run.id, userId,
    memo: `Salaries paid, payroll ${run.run_number}${reference ? ` (${reference})` : ""}`,
    lines: [{ account: "wages_payable", debit: num(run.total_net) }, { account: account || "bank", credit: num(run.total_net) }],
  });
  return tx.payroll_runs.update({
    where: { id: run.id },
    data: { status: "paid", paid_at: hr.toDate(date), paid_account_id: account, paid_reference: reference ? String(reference).slice(0, 255) : null, updated_at: new Date() },
  });
};

const unpayRun = async (tx, { company, runId, userId }) => {
  const run = await lockRun(tx, company.id, runId);
  if (run.status !== "paid") throw new HttpError(400, "This payroll isn't marked as paid");
  await ledger.reverse(tx, { companyId: company.id, sourceType: "payroll_payment", sourceId: run.id, userId, memo: `Payment of payroll ${run.run_number} undone` });
  return tx.payroll_runs.update({ where: { id: run.id }, data: { status: "approved", paid_at: null, paid_account_id: null, paid_reference: null, updated_at: new Date() } });
};

const voidRun = async (tx, { company, runId, userId }) => {
  const run = await lockRun(tx, company.id, runId);
  if (run.status === "void") return run;
  if (run.status === "paid") throw new HttpError(400, "Undo the payment first");
  if (run.status === "approved") {
    await ledger.reverse(tx, { companyId: company.id, sourceType: "payroll", sourceId: run.id, userId, memo: `Void payroll ${run.run_number}` });
  }
  return tx.payroll_runs.update({ where: { id: run.id }, data: { status: "void", updated_at: new Date() } });
};

module.exports = { KINDS, CALCS, computePayslip, buildRun, createRun, refreshTotals, approveRun, payRun, unpayRun, voidRun, lockRun, runJournalLines, snapshotOf };
