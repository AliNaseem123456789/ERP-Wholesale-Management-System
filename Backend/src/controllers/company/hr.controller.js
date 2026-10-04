// HR: departments, employees, pay components, holidays, leave types, payroll settings, attendance, leave requests,
// and employee self-service ("My HR").
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { round2, num } = require("../../services/money");
const { nextNumber } = require("../../services/sequences");
const { queueEmail } = require("../../services/email/outbox");
const ledger = require("../../services/ledger");
const hr = require("../../services/hr");
const { KINDS, CALCS } = require("../../services/payroll");

const TX = { timeout: 30000, maxWait: 10000 };
const text = (v, max = 255) => (v === undefined ? undefined : v === null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
const P2002 = (msg) => (e) => {
  if (e.code === "P2002") throw new HttpError(409, msg);
  throw e;
};

// ---- settings ----------------------------------------------------------------------------------

const getSettings = async (req, res) => res.json({ data: hr.payrollSettings(req.company) });

const updateSettings = async (req, res) => {
  const next = hr.validateSettings(req.body || {}, hr.payrollSettings(req.company));
  const settings = { ...(req.company.settings || {}), payroll: next };
  await prisma.companies.update({ where: { id: req.company.id }, data: { settings, updated_at: new Date() } });
  await audit(req, "payroll.settings", { entity: "company", entityId: req.company.id, changes: next });
  res.json({ message: "Payroll settings saved", data: next });
};

// ---- departments --------------------------------------------------------------------------------

const listDepartments = async (req, res) => {
  const rows = await prisma.departments.findMany({
    where: { company_id: req.company.id },
    orderBy: { name: "asc" },
    include: { manager: { select: { id: true, first_name: true, last_name: true } }, _count: { select: { employees: { where: { status: "active" } } } } },
  });
  res.json({ data: rows.map(({ _count, manager, ...d }) => ({ ...d, manager: manager ? { id: manager.id, name: hr.employeeName(manager) } : null, employee_count: _count.employees })) });
};

const departmentData = async (req, b) => {
  const data = {};
  if (b.name !== undefined) {
    data.name = text(b.name);
    if (!data.name) throw new HttpError(400, "Department name is required");
  }
  if (b.code !== undefined) data.code = text(b.code, 32);
  if (b.description !== undefined) data.description = text(b.description, 2000);
  if (b.is_active !== undefined) data.is_active = !!b.is_active;
  if (b.manager_employee_id !== undefined) {
    if (!b.manager_employee_id) data.manager_employee_id = null;
    else {
      const m = await prisma.employees.findFirst({ where: { id: toId(b.manager_employee_id, "manager"), company_id: req.company.id } });
      if (!m) throw new HttpError(400, "Manager not found");
      data.manager_employee_id = m.id;
    }
  }
  return data;
};

const createDepartment = async (req, res) => {
  const data = await departmentData(req, req.body);
  if (!data.name) throw new HttpError(400, "Department name is required");
  const d = await prisma.departments.create({ data: { ...data, company_id: req.company.id } }).catch(P2002(`There's already a department called "${data.name}"`));
  await audit(req, "department.create", { entity: "department", entityId: d.id, changes: data });
  res.status(201).json({ message: `Department ${d.name} created`, data: d });
};

const updateDepartment = async (req, res) => {
  const d = await prisma.departments.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!d) throw new HttpError(404, "Department not found");
  const data = await departmentData(req, req.body);
  const u = await prisma.departments.update({ where: { id: d.id }, data: { ...data, updated_at: new Date() } }).catch(P2002("That department name is already used"));
  res.json({ message: "Department saved", data: u });
};

const deleteDepartment = async (req, res) => {
  const d = await prisma.departments.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id }, include: { _count: { select: { employees: true } } } });
  if (!d) throw new HttpError(404, "Department not found");
  if (d._count.employees) throw new HttpError(400, "This department has employees. Move them first, or mark it inactive.");
  await prisma.departments.delete({ where: { id: d.id } });
  res.json({ message: "Department deleted" });
};

// ---- employees ----------------------------------------------------------------------------------

const PAY_FIELDS = ["pay_type", "base_salary", "hourly_rate", "payment_method", "bank_name", "bank_account_number", "bank_routing"];
const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"];

const shapeEmployee = (req, e) => {
  const { departments, employee_pay_components, ...rest } = e;
  const out = { ...rest, name: hr.employeeName(e), department: departments ? { id: departments.id, name: departments.name } : null };
  if (req.can("payroll.view")) {
    if (employee_pay_components) out.pay_components = employee_pay_components.map(({ pay_components, ...x }) => ({ ...x, component: pay_components }));
  } else {
    for (const f of PAY_FIELDS) delete out[f];
  }
  return out;
};

const employeeData = async (req, b, existing = null) => {
  const data = {};
  for (const f of ["first_name", "last_name", "job_title", "national_id", "tax_number", "emergency_contact_name", "bank_name"]) if (b[f] !== undefined) data[f] = text(b[f]);
  for (const f of ["phone", "emergency_contact_phone", "bank_account_number", "bank_routing"]) if (b[f] !== undefined) data[f] = text(b[f], 64);
  if (b.address !== undefined) data.address = text(b.address, 2000);
  if (b.notes !== undefined) data.notes = text(b.notes, 5000);
  if (b.email !== undefined) {
    data.email = text(b.email);
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new HttpError(400, "Enter a valid email");
    if (data.email) data.email = data.email.toLowerCase();
  }
  if (data.first_name === null || (!existing && !data.first_name)) throw new HttpError(400, "First name is required");
  if (b.employment_type !== undefined) {
    if (!EMPLOYMENT_TYPES.includes(b.employment_type)) throw new HttpError(400, `Employment type must be one of: ${EMPLOYMENT_TYPES.join(", ")}`);
    data.employment_type = b.employment_type;
  }
  if (b.hire_date !== undefined || !existing) data.hire_date = hr.toDate(hr.parseDate(b.hire_date, "Hire date", hr.today()));
  if (b.date_of_birth !== undefined) data.date_of_birth = b.date_of_birth ? hr.toDate(hr.parseDate(b.date_of_birth, "Date of birth")) : null;
  if (b.department_id !== undefined) {
    if (!b.department_id) data.department_id = null;
    else {
      const d = await prisma.departments.findFirst({ where: { id: toId(b.department_id, "department"), company_id: req.company.id } });
      if (!d) throw new HttpError(400, "Department not found");
      data.department_id = d.id;
    }
  }
  if (b.user_id !== undefined) {
    if (!b.user_id) data.user_id = null;
    else {
      const m = await prisma.company_members.findUnique({ where: { company_id_user_id: { company_id: req.company.id, user_id: toId(b.user_id, "user") } } });
      if (!m) throw new HttpError(400, "That login isn't a member of this company. Invite them on the Team page first.");
      data.user_id = m.user_id;
    }
  }
  const payTouched = PAY_FIELDS.some((f) => b[f] !== undefined);
  if (payTouched && !req.can("payroll.manage")) throw new HttpError(403, "You don't have permission to change pay details");
  if (b.pay_type !== undefined) {
    if (!["salary", "hourly"].includes(b.pay_type)) throw new HttpError(400, "Pay type must be salary or hourly");
    data.pay_type = b.pay_type;
  }
  if (b.base_salary !== undefined) {
    data.base_salary = round2(Number(b.base_salary || 0));
    if (!(data.base_salary >= 0)) throw new HttpError(400, "Salary can't be negative");
  }
  if (b.hourly_rate !== undefined) {
    data.hourly_rate = Math.round(Number(b.hourly_rate || 0) * 10000) / 10000;
    if (!(data.hourly_rate >= 0)) throw new HttpError(400, "Hourly rate can't be negative");
  }
  if (b.payment_method !== undefined) {
    if (!["bank_transfer", "cash", "check"].includes(b.payment_method)) throw new HttpError(400, "Payment method must be bank_transfer, cash or check");
    data.payment_method = b.payment_method;
  }
  return data;
};

const employeeInclude = (req) => ({
  departments: { select: { id: true, name: true } },
  ...(req.can("payroll.view") ? { employee_pay_components: { include: { pay_components: true } } } : {}),
});

// GET /company/hr/employees?status=active|terminated|all&department_id&search
const listEmployees = async (req, res) => {
  const status = String(req.query.status || "active");
  const search = String(req.query.search || "").trim();
  const rows = await prisma.employees.findMany({
    where: {
      company_id: req.company.id,
      ...(status === "all" ? {} : { status }),
      ...(req.query.department_id ? { department_id: toId(req.query.department_id, "department_id") } : {}),
      ...(search ? { OR: [
        { first_name: { contains: search, mode: "insensitive" } }, { last_name: { contains: search, mode: "insensitive" } },
        { employee_number: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } },
        { job_title: { contains: search, mode: "insensitive" } },
      ] } : {}),
    },
    orderBy: [{ first_name: "asc" }, { id: "asc" }],
    include: { departments: { select: { id: true, name: true } } },
  });
  const data = rows.map((e) => shapeEmployee(req, e));
  const payroll = req.can("payroll.view")
    ? { monthly_salaries: round2(rows.filter((e) => e.status === "active" && e.pay_type === "salary").reduce((s, e) => s + num(e.base_salary), 0)) }
    : undefined;
  res.json({ data, summary: { count: rows.length, ...payroll } });
};

const loadEmployee = async (req, id = req.params.id) => {
  const e = await prisma.employees.findFirst({ where: { id: toId(id), company_id: req.company.id }, include: employeeInclude(req) });
  if (!e) throw new HttpError(404, "Employee not found");
  return e;
};

const getEmployee = async (req, res) => {
  const e = await loadEmployee(req);
  const year = new Date().getUTCFullYear();
  const [balances, leave, payslips, user] = await Promise.all([
    hr.leaveBalances(prisma, req.company.id, e.id, year),
    prisma.leave_requests.findMany({ where: { employee_id: e.id }, orderBy: { start_date: "desc" }, take: 20, include: { leave_types: { select: { name: true, paid: true } } } }),
    req.can("payroll.view")
      ? prisma.payslips.findMany({ where: { employee_id: e.id, payroll_runs: { status: { not: "void" } } }, orderBy: { id: "desc" }, take: 24, include: { payroll_runs: { select: { run_number: true, period_start: true, period_end: true, status: true, pay_date: true } } } })
      : [],
    e.user_id ? prisma.users.findUnique({ where: { id: e.user_id }, select: { id: true, email: true } }) : null,
  ]);
  res.json({
    data: {
      ...shapeEmployee(req, e), user,
      leave_balances: balances,
      leave_requests: leave.map(({ leave_types, ...l }) => ({ ...l, leave_type: leave_types })),
      payslips: payslips.map(({ payroll_runs, ...p }) => ({ id: p.id, payslip_number: p.payslip_number, gross: p.gross, net: p.net, run: payroll_runs })),
    },
  });
};

const createEmployee = async (req, res) => {
  const data = await employeeData(req, req.body);
  const number = text(req.body.employee_number, 32);
  const e = await prisma.$transaction(async (tx) => tx.employees.create({
    data: { ...data, company_id: req.company.id, employee_number: number || (await nextNumber(tx, req.company.id, "EMP")) },
  }), TX).catch(P2002(number ? `Employee number ${number} is already used` : "That login is already linked to another employee"));
  await audit(req, "employee.create", { entity: "employee", entityId: e.id, changes: { name: hr.employeeName(e), number: e.employee_number } });
  res.status(201).json({ message: `${hr.employeeName(e)} added (${e.employee_number})`, data: shapeEmployee(req, await loadEmployee(req, e.id)) });
};

const updateEmployee = async (req, res) => {
  const e = await loadEmployee(req);
  const data = await employeeData(req, req.body, e);
  if (req.body.employee_number !== undefined) {
    data.employee_number = text(req.body.employee_number, 32);
    if (!data.employee_number) throw new HttpError(400, "Employee number can't be empty");
  }
  const u = await prisma.employees.update({ where: { id: e.id }, data: { ...data, updated_at: new Date() } }).catch(P2002("That employee number or login is already used"));
  const changes = { ...data };
  for (const f of ["base_salary", "hourly_rate"]) if (changes[f] !== undefined) changes[f] = `${num(e[f])} -> ${changes[f]}`;
  await audit(req, "employee.update", { entity: "employee", entityId: e.id, changes });
  res.json({ message: "Employee saved", data: shapeEmployee(req, await loadEmployee(req, u.id)) });
};

// POST /company/hr/employees/:id/terminate { termination_date, reason? }  /  .../reinstate
const terminateEmployee = async (req, res) => {
  const e = await loadEmployee(req);
  const date = hr.parseDate(req.body.termination_date, "Last working day", hr.today());
  if (date < hr.toStr(e.hire_date)) throw new HttpError(400, "The last day can't be before the hire date");
  const u = await prisma.employees.update({
    where: { id: e.id },
    data: { status: "terminated", termination_date: hr.toDate(date), notes: req.body.reason ? [e.notes, `Left ${date}: ${String(req.body.reason).slice(0, 500)}`].filter(Boolean).join("\n") : e.notes, updated_at: new Date() },
  });
  await audit(req, "employee.terminate", { entity: "employee", entityId: e.id, changes: { termination_date: date } });
  res.json({ message: `${hr.employeeName(u)} marked as left on ${date}. They're paid up to that day.`, data: shapeEmployee(req, await loadEmployee(req, u.id)) });
};

const reinstateEmployee = async (req, res) => {
  const e = await loadEmployee(req);
  const u = await prisma.employees.update({ where: { id: e.id }, data: { status: "active", termination_date: null, updated_at: new Date() } });
  await audit(req, "employee.reinstate", { entity: "employee", entityId: e.id });
  res.json({ message: `${hr.employeeName(u)} is active again`, data: shapeEmployee(req, await loadEmployee(req, u.id)) });
};

// PUT /company/hr/employees/:id/pay-components { components: [{ component_id, amount?, percent?, excluded? }] }  (replaces the list)
const setEmployeeComponents = async (req, res) => {
  const e = await loadEmployee(req);
  const list = Array.isArray(req.body.components) ? req.body.components : [];
  const comps = await prisma.pay_components.findMany({ where: { company_id: req.company.id } });
  const byId = new Map(comps.map((c) => [String(c.id), c]));
  const rows = [];
  const seen = new Set();
  for (const x of list) {
    const c = byId.get(String(x.component_id));
    if (!c) throw new HttpError(400, "Pay component not found");
    if (seen.has(String(c.id))) continue;
    seen.add(String(c.id));
    const amount = x.amount === undefined || x.amount === null || x.amount === "" ? null : round2(Number(x.amount));
    const percent = x.percent === undefined || x.percent === null || x.percent === "" ? null : Number(x.percent);
    if ((amount !== null && !(amount >= 0)) || (percent !== null && !(percent >= 0 && percent <= 100))) throw new HttpError(400, `${c.name}: enter a valid amount or %`);
    rows.push({ employee_id: e.id, component_id: c.id, amount, percent, excluded: !!x.excluded });
  }
  await prisma.$transaction([
    prisma.employee_pay_components.deleteMany({ where: { employee_id: e.id } }),
    prisma.employee_pay_components.createMany({ data: rows }),
  ]);
  await audit(req, "employee.pay_components", { entity: "employee", entityId: e.id, changes: { components: rows.length } });
  res.json({ message: "Pay components saved", data: shapeEmployee(req, await loadEmployee(req)) });
};

// ---- pay components ---------------------------------------------------------------------------

const listComponents = async (req, res) => {
  const rows = await prisma.pay_components.findMany({ where: { company_id: req.company.id }, orderBy: [{ kind: "asc" }, { sort_order: "asc" }, { id: "asc" }], include: { _count: { select: { employee_pay_components: { where: { excluded: false } } } } } });
  res.json({ data: rows.map(({ _count, ...c }) => ({ ...c, assigned: _count.employee_pay_components })), kinds: KINDS, calcs: CALCS });
};

const componentData = async (req, b, existing = null) => {
  const data = {};
  if (b.code !== undefined) {
    data.code = String(b.code || "").trim().toUpperCase().slice(0, 32);
    if (!/^[A-Z0-9_-]+$/.test(data.code)) throw new HttpError(400, "Code: letters, numbers, dashes and underscores");
  }
  if (b.name !== undefined) {
    data.name = text(b.name);
    if (!data.name) throw new HttpError(400, "Name is required");
  }
  const kind = b.kind !== undefined ? b.kind : existing?.kind;
  if (!KINDS.includes(kind)) throw new HttpError(400, `Type must be one of: ${KINDS.join(", ")}`);
  if (b.kind !== undefined) data.kind = kind;
  const calc = b.calc !== undefined ? b.calc : existing?.calc || "fixed";
  if (!CALCS[kind].includes(calc)) throw new HttpError(400, `For ${kind} components the calculation must be one of: ${CALCS[kind].join(", ")}`);
  data.calc = calc;
  if (b.amount !== undefined) {
    data.amount = round2(Number(b.amount || 0));
    if (!(data.amount >= 0)) throw new HttpError(400, "Amount can't be negative");
  }
  if (b.percent !== undefined) {
    data.percent = Number(b.percent || 0);
    if (!(data.percent >= 0 && data.percent <= 100)) throw new HttpError(400, "% must be between 0 and 100");
  }
  if (b.taxable !== undefined) data.taxable = !!b.taxable;
  if (b.applies_to_all !== undefined) data.applies_to_all = !!b.applies_to_all;
  if (b.is_active !== undefined) data.is_active = !!b.is_active;
  if (b.sort_order !== undefined) data.sort_order = parseInt(b.sort_order, 10) || 0;
  if (b.account_id !== undefined) {
    if (!b.account_id) data.account_id = null;
    else {
      const acc = await ledger.assertAccount(prisma, req.company.id, toId(b.account_id, "account"), { types: kind === "earning" ? ["expense"] : ["liability"] });
      data.account_id = acc.id;
    }
  }
  return data;
};

const createComponent = async (req, res) => {
  const data = await componentData(req, req.body);
  if (!data.code || !data.name) throw new HttpError(400, "Code and name are required");
  const c = await prisma.pay_components.create({ data: { ...data, company_id: req.company.id } }).catch(P2002(`Code ${data.code} is already used`));
  await audit(req, "pay_component.create", { entity: "pay_component", entityId: c.id, changes: data });
  res.status(201).json({ message: `${c.name} added`, data: c });
};

const updateComponent = async (req, res) => {
  const c = await prisma.pay_components.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!c) throw new HttpError(404, "Pay component not found");
  const data = await componentData(req, req.body, c);
  const u = await prisma.pay_components.update({ where: { id: c.id }, data: { ...data, updated_at: new Date() } }).catch(P2002("That code is already used"));
  await audit(req, "pay_component.update", { entity: "pay_component", entityId: c.id, changes: data });
  res.json({ message: `${u.name} saved`, data: u });
};

// ---- holidays & leave types ---------------------------------------------------------------------

const listHolidays = async (req, res) => {
  const year = parseInt(req.query.year, 10) || new Date().getUTCFullYear();
  const rows = await prisma.holidays.findMany({ where: { company_id: req.company.id, holiday_date: { gte: hr.toDate(`${year}-01-01`), lte: hr.toDate(`${year}-12-31`) } }, orderBy: { holiday_date: "asc" } });
  res.json({ data: rows });
};
const createHoliday = async (req, res) => {
  const date = hr.parseDate(req.body.holiday_date, "Date");
  const name = text(req.body.name);
  if (!name) throw new HttpError(400, "Name the holiday");
  await hr.assertPayrollOpen(prisma, req.company.id, date, date, date);
  const h = await prisma.holidays.create({ data: { company_id: req.company.id, holiday_date: hr.toDate(date), name } }).catch(P2002(`${date} is already a holiday`));
  res.status(201).json({ message: `${name} added`, data: h });
};
const deleteHoliday = async (req, res) => {
  const h = await prisma.holidays.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!h) throw new HttpError(404, "Holiday not found");
  await hr.assertPayrollOpen(prisma, req.company.id, hr.toStr(h.holiday_date), hr.toStr(h.holiday_date), hr.toStr(h.holiday_date));
  await prisma.holidays.delete({ where: { id: h.id } });
  res.json({ message: "Holiday removed" });
};

const DEFAULT_LEAVE_TYPES = [
  { name: "Annual leave", paid: true, annual_days: 14 },
  { name: "Sick leave", paid: true, annual_days: 8 },
  { name: "Unpaid leave", paid: false, annual_days: 0 },
];
const listLeaveTypes = async (req, res) => {
  if (!(await prisma.leave_types.count({ where: { company_id: req.company.id } }))) {
    await prisma.leave_types.createMany({ data: DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, company_id: req.company.id })), skipDuplicates: true });
  }
  res.json({ data: await prisma.leave_types.findMany({ where: { company_id: req.company.id }, orderBy: { name: "asc" } }) });
};
const leaveTypeData = (b) => {
  const data = {};
  if (b.name !== undefined) {
    data.name = text(b.name);
    if (!data.name) throw new HttpError(400, "Name is required");
  }
  if (b.paid !== undefined) data.paid = !!b.paid;
  if (b.annual_days !== undefined) {
    data.annual_days = Number(b.annual_days || 0);
    if (!(data.annual_days >= 0 && data.annual_days <= 366)) throw new HttpError(400, "Days per year must be 0-366");
  }
  if (b.is_active !== undefined) data.is_active = !!b.is_active;
  return data;
};
const createLeaveType = async (req, res) => {
  const data = leaveTypeData(req.body);
  if (!data.name) throw new HttpError(400, "Name is required");
  const t = await prisma.leave_types.create({ data: { ...data, company_id: req.company.id } }).catch(P2002(`"${data.name}" already exists`));
  res.status(201).json({ message: `${t.name} added`, data: t });
};
const updateLeaveType = async (req, res) => {
  const t = await prisma.leave_types.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!t) throw new HttpError(404, "Leave type not found");
  const u = await prisma.leave_types.update({ where: { id: t.id }, data: leaveTypeData(req.body) }).catch(P2002("That name is already used"));
  res.json({ message: `${u.name} saved`, data: u });
};

// ---- attendance ---------------------------------------------------------------------------------

const ATT_STATUSES = ["present", "absent", "half_day", "paid_leave", "unpaid_leave", "holiday"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const hoursBetween = (a, b) => {
  const [h1, m1] = a.split(":").map(Number);
  const [h2, m2] = b.split(":").map(Number);
  let mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60; // overnight shift
  return round2(mins / 60);
};

// GET /company/hr/attendance?date=YYYY-MM-DD -> every employee on the books that day, with their record
const dayAttendance = async (req, res) => {
  const date = hr.parseDate(req.query.date, "Date", hr.today());
  const settings = hr.payrollSettings(req.company);
  const [employees, records, holidays] = await Promise.all([
    prisma.employees.findMany({
      where: { company_id: req.company.id, hire_date: { lte: hr.toDate(date) }, OR: [{ termination_date: null, status: "active" }, { termination_date: { gte: hr.toDate(date) } }] },
      orderBy: [{ first_name: "asc" }, { id: "asc" }],
      include: { departments: { select: { name: true } } },
    }),
    prisma.attendance.findMany({ where: { company_id: req.company.id, work_date: hr.toDate(date) } }),
    hr.loadHolidays(prisma, req.company.id, date, date),
  ]);
  const byEmp = new Map(records.map((r) => [String(r.employee_id), r]));
  res.json({
    date,
    working_day: hr.isWorkingDay(date, settings, holidays),
    holiday: holidays.get(date) || null,
    hours_per_day: settings.hoursPerDay,
    data: employees.map((e) => ({
      employee: { id: e.id, name: hr.employeeName(e), employee_number: e.employee_number, department: e.departments?.name || null, pay_type: req.can("payroll.view") ? e.pay_type : undefined },
      record: byEmp.get(String(e.id)) || null,
    })),
  });
};

// PUT /company/hr/attendance { date, records: [{ employee_id, status ('' clears), check_in?, check_out?, hours?, overtime_hours?, notes? }] }
const saveAttendance = async (req, res) => {
  const date = hr.parseDate(req.body.date, "Date");
  if (date > hr.today()) throw new HttpError(400, "Attendance can't be recorded for a future date");
  const records = Array.isArray(req.body.records) ? req.body.records : [];
  if (!records.length) throw new HttpError(400, "Nothing to save");
  await hr.assertPayrollOpen(prisma, req.company.id, date, date, date);
  const saved = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (const [i, r] of records.entries()) {
      const emp = await tx.employees.findFirst({ where: { id: toId(r.employee_id, "employee_id"), company_id: req.company.id } });
      if (!emp) throw new HttpError(400, `Row ${i + 1}: employee not found`);
      const name = hr.employeeName(emp);
      const existing = await tx.attendance.findUnique({ where: { employee_id_work_date: { employee_id: emp.id, work_date: hr.toDate(date) } } });
      if (existing?.leave_request_id && r.status !== existing.status) {
        throw new HttpError(400, `${name} is on approved leave that day. Cancel the leave to change it.`);
      }
      if (!r.status) {
        if (existing) { await tx.attendance.delete({ where: { id: existing.id } }); count++; }
        continue;
      }
      if (!ATT_STATUSES.includes(r.status)) throw new HttpError(400, `${name}: status must be one of ${ATT_STATUSES.join(", ")}`);
      if (["paid_leave", "unpaid_leave"].includes(r.status) && !existing?.leave_request_id) {
        throw new HttpError(400, `${name}: record leave through a leave request, so balances stay right`);
      }
      if (date < hr.toStr(emp.hire_date) || (emp.termination_date && date > hr.toStr(emp.termination_date))) throw new HttpError(400, `${name} wasn't employed on ${date}`);
      const checkIn = text(r.check_in, 5);
      const checkOut = text(r.check_out, 5);
      for (const t of [checkIn, checkOut]) if (t && !TIME_RE.test(t)) throw new HttpError(400, `${name}: times must be HH:MM`);
      let hours = r.hours === undefined || r.hours === null || r.hours === "" ? null : Number(r.hours);
      if (hours === null && checkIn && checkOut) hours = hoursBetween(checkIn, checkOut);
      if (hours !== null && !(hours >= 0 && hours <= 24)) throw new HttpError(400, `${name}: hours must be 0-24`);
      const overtime = Number(r.overtime_hours || 0);
      if (!(overtime >= 0 && overtime <= 24)) throw new HttpError(400, `${name}: overtime must be 0-24 hours`);
      const data = {
        status: r.status, day_units: 1, check_in: checkIn || null, check_out: checkOut || null, hours, overtime_hours: overtime,
        notes: text(r.notes, 500) || null, recorded_by: BigInt(req.user.id), updated_at: new Date(),
      };
      if (!existing?.leave_request_id) data.leave_request_id = null;
      await tx.attendance.upsert({
        where: { employee_id_work_date: { employee_id: emp.id, work_date: hr.toDate(date) } },
        create: { company_id: req.company.id, employee_id: emp.id, work_date: hr.toDate(date), ...data },
        update: data,
      });
      count++;
    }
    return count;
  }, TX);
  await audit(req, "attendance.save", { entity: "attendance", entityId: null, changes: { date, records: saved } });
  res.json({ message: `Attendance saved for ${date} (${saved} record${saved === 1 ? "" : "s"})` });
};

// GET /company/hr/attendance/summary?from&to
const attendanceSummary = async (req, res) => {
  const to = hr.parseDate(req.query.to, "To", hr.today());
  const from = hr.parseDate(req.query.from, "From", `${to.slice(0, 7)}-01`);
  if (from > to) throw new HttpError(400, "From is after To");
  const settings = hr.payrollSettings(req.company);
  const holidays = await hr.loadHolidays(prisma, req.company.id, from, to);
  const working = hr.workingDays(from, to, settings, holidays).length;
  const rows = await prisma.$queryRaw`
    SELECT e.id, e.first_name, e.last_name, e.employee_number,
      COALESCE(SUM(a.day_units) FILTER (WHERE a.status = 'present'), 0)::float AS present,
      COALESCE(SUM(a.day_units) FILTER (WHERE a.status = 'absent'), 0)::float AS absent,
      COUNT(a.id) FILTER (WHERE a.status = 'half_day')::int AS half_days,
      COALESCE(SUM(a.day_units) FILTER (WHERE a.status = 'paid_leave'), 0)::float AS paid_leave,
      COALESCE(SUM(a.day_units) FILTER (WHERE a.status = 'unpaid_leave'), 0)::float AS unpaid_leave,
      COALESCE(SUM(a.hours), 0)::float AS hours,
      COALESCE(SUM(a.overtime_hours), 0)::float AS overtime,
      COUNT(a.id)::int AS recorded
    FROM employees e
    LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date BETWEEN ${from}::date AND ${to}::date
    WHERE e.company_id = ${req.company.id} AND e.hire_date <= ${to}::date AND (e.termination_date IS NULL OR e.termination_date >= ${from}::date)
      AND NOT (e.status = 'terminated' AND e.termination_date IS NULL)
    GROUP BY e.id ORDER BY e.first_name, e.id`;
  res.json({ from, to, working_days: working, data: rows.map((r) => ({ ...r, name: hr.employeeName(r) })) });
};

// ---- leave --------------------------------------------------------------------------------------

const leaveInclude = { employees: { select: { id: true, first_name: true, last_name: true, employee_number: true, email: true } }, leave_types: { select: { id: true, name: true, paid: true } } };
const shapeLeave = ({ employees, leave_types, ...l }) => ({ ...l, employee: employees ? { ...employees, name: hr.employeeName(employees) } : null, leave_type: leave_types });

const listLeave = async (req, res) => {
  const status = String(req.query.status || "");
  const rows = await prisma.leave_requests.findMany({
    where: {
      company_id: req.company.id,
      ...(status ? { status } : {}),
      ...(req.query.employee_id ? { employee_id: toId(req.query.employee_id, "employee_id") } : {}),
    },
    orderBy: [{ start_date: "desc" }, { id: "desc" }],
    take: 300,
    include: leaveInclude,
  });
  const pending = await prisma.leave_requests.count({ where: { company_id: req.company.id, status: "pending" } });
  res.json({ data: rows.map(shapeLeave), pending });
};

// Validates and creates a leave request (shared by HR and self-service).
const createLeaveRequest = async (tx, { company, employee, body, userId }) => {
  const type = await tx.leave_types.findFirst({ where: { id: toId(body.leave_type_id, "leave type"), company_id: company.id, is_active: true } });
  if (!type) throw new HttpError(400, "Choose a leave type");
  const start = hr.parseDate(body.start_date, "Start date");
  const end = hr.parseDate(body.end_date, "End date", start);
  if (end < start) throw new HttpError(400, "The end date is before the start date");
  if (start.slice(0, 4) !== end.slice(0, 4)) throw new HttpError(400, "Split leave that crosses the new year into two requests");
  if (start < hr.toStr(employee.hire_date)) throw new HttpError(400, "That's before the employee's hire date");
  const settings = hr.payrollSettings(company);
  const holidays = await hr.loadHolidays(tx, company.id, start, end);
  const days = hr.leaveDays(start, end, !!body.half_day, settings, holidays);
  if (!days) throw new HttpError(400, "There are no working days in those dates");
  const overlap = await tx.leave_requests.findFirst({
    where: { employee_id: employee.id, status: { in: ["pending", "approved"] }, start_date: { lte: hr.toDate(end) }, end_date: { gte: hr.toDate(start) } },
  });
  if (overlap) throw new HttpError(409, "There's already a leave request for some of those days");
  if (type.paid && num(type.annual_days) > 0) {
    const u = (await hr.leaveUsage(tx, employee.id, start.slice(0, 4))).get(String(type.id)) || { taken: 0, pending: 0 };
    const left = round2(num(type.annual_days) - u.taken - u.pending);
    if (days > left) throw new HttpError(400, `Only ${left} day(s) of ${type.name} left this year`);
  }
  return tx.leave_requests.create({
    data: {
      company_id: company.id, employee_id: employee.id, leave_type_id: type.id, start_date: hr.toDate(start), end_date: hr.toDate(end),
      half_day: !!body.half_day, days, reason: text(body.reason, 2000) || null, requested_by: userId ? BigInt(userId) : null,
    },
    include: leaveInclude,
  });
};

const decide = async (tx, { company, requestId, status, notes, userId }) => {
  const [row] = await tx.$queryRaw`SELECT id FROM leave_requests WHERE id = ${BigInt(requestId)} AND company_id = ${company.id} FOR UPDATE`;
  if (!row) throw new HttpError(404, "Leave request not found");
  const r = await tx.leave_requests.findUnique({ where: { id: row.id }, include: leaveInclude });
  const from = hr.toStr(r.start_date);
  const to = hr.toStr(r.end_date);
  if (status === "approved") {
    if (r.status !== "pending") throw new HttpError(400, `This request is ${r.status}`);
    await hr.assertPayrollOpen(tx, company.id, from, to, "these dates");
    const settings = hr.payrollSettings(company);
    const holidays = await hr.loadHolidays(tx, company.id, from, to);
    await hr.applyLeave(tx, { companyId: company.id, request: r, leaveType: r.leave_types, settings, holidays, userId });
  } else if (status === "rejected") {
    if (r.status !== "pending") throw new HttpError(400, `This request is ${r.status}`);
  } else if (status === "cancelled") {
    if (!["pending", "approved"].includes(r.status)) throw new HttpError(400, `This request is ${r.status}`);
    if (r.status === "approved") {
      await hr.assertPayrollOpen(tx, company.id, from, to, "these dates");
      await tx.attendance.deleteMany({ where: { leave_request_id: r.id } });
    }
  }
  return tx.leave_requests.update({
    where: { id: r.id },
    data: { status, decided_by: userId ? BigInt(userId) : null, decided_at: new Date(), decision_notes: text(notes, 2000) ?? r.decision_notes },
    include: leaveInclude,
  });
};

const notifyDecision = async (company, r) => {
  if (!r.employees?.email || !["approved", "rejected"].includes(r.status)) return;
  await queueEmail({
    to: r.employees.email, template: "leaveDecision", companyId: company.id,
    data: { name: r.employees.first_name, companyName: company.name, leaveType: r.leave_types.name, from: hr.toStr(r.start_date), to: hr.toStr(r.end_date), days: num(r.days), status: r.status, notes: r.decision_notes },
  });
};

// POST /company/hr/leave { employee_id, leave_type_id, start_date, end_date?, half_day?, reason?, approve? }
const createLeave = async (req, res) => {
  const employee = await prisma.employees.findFirst({ where: { id: toId(req.body.employee_id, "employee"), company_id: req.company.id } });
  if (!employee) throw new HttpError(400, "Employee not found");
  const r = await prisma.$transaction(async (tx) => {
    const created = await createLeaveRequest(tx, { company: req.company, employee, body: req.body, userId: req.user.id });
    return req.body.approve ? decide(tx, { company: req.company, requestId: created.id, status: "approved", userId: req.user.id }) : created;
  }, TX);
  await audit(req, "leave.create", { entity: "leave_request", entityId: r.id, changes: { employee: hr.employeeName(employee), days: num(r.days), status: r.status } });
  if (r.status === "approved") await notifyDecision(req.company, r);
  res.status(201).json({ message: `${num(r.days)} day(s) of ${r.leave_types.name} ${r.status === "approved" ? "approved" : "requested"} for ${hr.employeeName(employee)}`, data: shapeLeave(r) });
};

const decideLeave = (status) => async (req, res) => {
  const r = await prisma.$transaction((tx) => decide(tx, { company: req.company, requestId: toId(req.params.id), status, notes: req.body?.notes, userId: req.user.id }), TX);
  await audit(req, `leave.${status}`, { entity: "leave_request", entityId: r.id, changes: { employee: hr.employeeName(r.employees), days: num(r.days) } });
  await notifyDecision(req.company, r);
  res.json({ message: `Leave ${status}`, data: shapeLeave(r) });
};

// GET /company/hr/leave/balances?year
const leaveBalancesReport = async (req, res) => {
  const year = parseInt(req.query.year, 10) || new Date().getUTCFullYear();
  const employees = await prisma.employees.findMany({ where: { company_id: req.company.id, status: "active" }, orderBy: [{ first_name: "asc" }, { id: "asc" }] });
  const data = [];
  for (const e of employees) data.push({ employee: { id: e.id, name: hr.employeeName(e), employee_number: e.employee_number }, balances: await hr.leaveBalances(prisma, req.company.id, e.id, year) });
  res.json({ year, data });
};

// ---- self-service ("My HR") ---------------------------------------------------------------------

const myEmployee = async (req) => prisma.employees.findFirst({ where: { company_id: req.company.id, user_id: BigInt(req.user.id) }, include: { departments: { select: { id: true, name: true } } } });

const myHr = async (req, res) => {
  const e = await myEmployee(req);
  if (!e) return res.json({ data: null });
  const year = new Date().getUTCFullYear();
  const [balances, requests, payslips, types] = await Promise.all([
    hr.leaveBalances(prisma, req.company.id, e.id, year),
    prisma.leave_requests.findMany({ where: { employee_id: e.id }, orderBy: { start_date: "desc" }, take: 30, include: leaveInclude }),
    prisma.payslips.findMany({
      where: { employee_id: e.id, payroll_runs: { status: { in: ["approved", "paid"] } } },
      orderBy: { id: "desc" }, take: 24,
      include: { payroll_runs: { select: { run_number: true, period_start: true, period_end: true, pay_date: true, status: true } } },
    }),
    prisma.leave_types.findMany({ where: { company_id: req.company.id, is_active: true }, orderBy: { name: "asc" } }),
  ]);
  const { base_salary, hourly_rate, bank_account_number, bank_routing, notes, ...profile } = e;
  res.json({
    data: {
      employee: { ...profile, name: hr.employeeName(e), department: e.departments, bank_account_last4: bank_account_number ? String(bank_account_number).slice(-4) : null },
      leave_balances: balances, leave_types: types,
      leave_requests: requests.map(shapeLeave),
      payslips: payslips.map(({ payroll_runs, ...p }) => ({ id: p.id, payslip_number: p.payslip_number, gross: p.gross, total_deductions: p.total_deductions, net: p.net, run: payroll_runs })),
    },
  });
};

const myLeaveRequest = async (req, res) => {
  const e = await myEmployee(req);
  if (!e) throw new HttpError(403, "Your login isn't linked to an employee record. Ask HR to link it.");
  if (e.status !== "active") throw new HttpError(400, "Your employment has ended");
  const r = await prisma.$transaction((tx) => createLeaveRequest(tx, { company: req.company, employee: e, body: req.body, userId: req.user.id }), TX);
  await audit(req, "leave.request", { entity: "leave_request", entityId: r.id, changes: { days: num(r.days) } });
  if (req.company.email) {
    await queueEmail({
      to: req.company.email, template: "leaveRequested", companyId: req.company.id,
      data: { companyName: req.company.name, employee: hr.employeeName(e), leaveType: r.leave_types.name, from: hr.toStr(r.start_date), to: hr.toStr(r.end_date), days: num(r.days), reason: r.reason },
    });
  }
  await require("../../services/inapp").notifyStaff(req.company.id, "hr.leave", {
    type: "leave.requested", title: `Leave request from ${hr.employeeName(e)}`, body: `${num(r.days)} day(s) of ${r.leave_types.name}, ${hr.toStr(r.start_date)} to ${hr.toStr(r.end_date)}`,
    link: "/business/leave", dedupeKey: `leave-request:${r.id}`,
  });
  res.status(201).json({ message: `Leave requested: ${num(r.days)} day(s) of ${r.leave_types.name}`, data: shapeLeave(r) });
};

const myLeaveCancel = async (req, res) => {
  const e = await myEmployee(req);
  const r = e && (await prisma.leave_requests.findFirst({ where: { id: toId(req.params.id), employee_id: e.id } }));
  if (!r) throw new HttpError(404, "Leave request not found");
  if (r.status !== "pending") throw new HttpError(400, "Only pending requests can be withdrawn. Ask HR to cancel approved leave.");
  await prisma.leave_requests.update({ where: { id: r.id }, data: { status: "cancelled", decided_at: new Date(), decided_by: BigInt(req.user.id) } });
  res.json({ message: "Leave request withdrawn" });
};

const myPayslipPdf = async (req, res) => {
  const e = await myEmployee(req);
  const p = e && (await prisma.payslips.findFirst({ where: { id: toId(req.params.id), employee_id: e.id, payroll_runs: { status: { in: ["approved", "paid"] } } } }));
  if (!p) throw new HttpError(404, "Payslip not found");
  const { sendPdf } = require("../../services/documents");
  await sendPdf(res, "payslip", p.id, req.company.id);
};

module.exports = {
  getSettings, updateSettings,
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listEmployees, getEmployee, createEmployee, updateEmployee, terminateEmployee, reinstateEmployee, setEmployeeComponents,
  listComponents, createComponent, updateComponent,
  listHolidays, createHoliday, deleteHoliday,
  listLeaveTypes, createLeaveType, updateLeaveType,
  dayAttendance, saveAttendance, attendanceSummary,
  listLeave, createLeave, decideLeave, leaveBalancesReport,
  myHr, myLeaveRequest, myLeaveCancel, myPayslipPdf,
};
