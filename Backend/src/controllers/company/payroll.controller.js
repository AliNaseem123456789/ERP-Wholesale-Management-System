// Payroll runs, payslips (with one-off lines), approval and payment, payslip PDFs/emails,
// and paying over payroll liabilities (taxes and deductions withheld).
const crypto = require("crypto");
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { round2, num } = require("../../services/money");
const { queueEmail } = require("../../services/email/outbox");
const { sendPdf } = require("../../services/documents");
const ledger = require("../../services/ledger");
const hr = require("../../services/hr");
const payroll = require("../../services/payroll");

const TX = { timeout: 120000, maxWait: 10000 };

const shapeSlip = ({ payslip_lines, employees, ...p }) => ({
  ...p,
  employee: employees ? { id: employees.id, name: hr.employeeName(employees), employee_number: employees.employee_number, email: employees.email } : undefined,
  lines: payslip_lines?.sort((a, b) => a.sort_order - b.sort_order),
});

const loadRun = async (req, id = req.params.id) => {
  const run = await prisma.payroll_runs.findFirst({
    where: { id: toId(id), company_id: req.company.id },
    include: {
      payslips: {
        orderBy: { id: "asc" },
        include: { payslip_lines: true, employees: { select: { id: true, first_name: true, last_name: true, employee_number: true, email: true } } },
      },
    },
  });
  if (!run) throw new HttpError(404, "Payroll run not found");
  const { payslips, ...r } = run;
  const lines = payslips.flatMap((p) => p.payslip_lines);
  const byComponent = {};
  for (const l of lines) {
    const k = `${l.kind}:${l.name.replace(/\s*\(.*\)$/, "")}`;
    byComponent[k] = round2((byComponent[k] || 0) + num(l.amount));
  }
  const entry = await prisma.journal_entries.findFirst({ where: { company_id: req.company.id, source_type: "payroll", source_id: String(run.id), reversal_of_id: null }, select: { id: true, entry_number: true } });
  const paidAccount = r.paid_account_id ? await prisma.accounts.findUnique({ where: { id: r.paid_account_id }, select: { id: true, code: true, name: true } }) : null;
  return {
    ...r,
    payslips: payslips.map(shapeSlip),
    breakdown: Object.entries(byComponent).map(([k, amount]) => ({ kind: k.split(":")[0], name: k.slice(k.indexOf(":") + 1), amount })),
    warnings: payslips.filter((p) => (p.warnings || []).length).map((p) => ({ payslip_id: p.id, employee: hr.employeeName(p.employees), warnings: p.warnings })),
    journal_entry: entry, paid_account: paidAccount,
  };
};

// GET /company/payroll/runs?status
const listRuns = async (req, res) => {
  const status = String(req.query.status || "");
  const rows = await prisma.payroll_runs.findMany({
    where: { company_id: req.company.id, ...(status ? { status } : {}) },
    orderBy: [{ period_start: "desc" }, { id: "desc" }],
    take: 120,
  });
  const ytdYear = new Date().getUTCFullYear();
  const ytd = rows.filter((r) => ["approved", "paid"].includes(r.status) && hr.toStr(r.period_start).startsWith(String(ytdYear)));
  res.json({
    data: rows,
    summary: {
      year: ytdYear,
      gross: round2(ytd.reduce((s, r) => s + num(r.total_gross), 0)),
      net: round2(ytd.reduce((s, r) => s + num(r.total_net), 0)),
      employer: round2(ytd.reduce((s, r) => s + num(r.total_employer), 0)),
    },
  });
};

const getRun = async (req, res) => res.json({ data: await loadRun(req) });

// POST /company/payroll/runs { month: "YYYY-MM" } or { period_start, period_end }, pay_date?, notes?
const createRun = async (req, res) => {
  let start, end;
  if (req.body.month) {
    if (!/^\d{4}-\d{2}$/.test(String(req.body.month))) throw new HttpError(400, "Month must be YYYY-MM");
    ({ start, end } = hr.monthBounds(String(req.body.month)));
  } else {
    start = hr.parseDate(req.body.period_start, "Period start");
    end = hr.parseDate(req.body.period_end, "Period end");
  }
  const payDate = hr.parseDate(req.body.pay_date, "Pay date", end);
  const run = await prisma.$transaction((tx) => payroll.createRun(tx, { company: req.company, periodStart: start, periodEnd: end, payDate, notes: req.body.notes, userId: req.user.id }), TX)
    .catch((e) => {
      if (e.code === "P2002") throw new HttpError(409, "There's already a payroll for this period");
      throw e;
    });
  await audit(req, "payroll.create", { entity: "payroll_run", entityId: run.id, changes: { period: `${start}..${end}`, employees: run.employee_count, net: num(run.total_net) } });
  res.status(201).json({ message: `Payroll ${run.run_number} drafted for ${run.employee_count} employee(s)`, data: await loadRun(req, run.id) });
};

const assertDraft = async (tx, req, id) => {
  const run = await payroll.lockRun(tx, req.company.id, id);
  if (run.status !== "draft") throw new HttpError(400, `This payroll is ${run.status}: it can't be changed`);
  return run;
};

// POST /company/payroll/runs/:id/recalculate  (picks up new attendance, salary changes, new hires)
const recalcRun = async (req, res) => {
  await prisma.$transaction(async (tx) => {
    const run = await assertDraft(tx, req, req.params.id);
    if (req.body?.pay_date) await tx.payroll_runs.update({ where: { id: run.id }, data: { pay_date: hr.toDate(hr.parseDate(req.body.pay_date, "Pay date")) } });
    if (req.body?.notes !== undefined) await tx.payroll_runs.update({ where: { id: run.id }, data: { notes: req.body.notes ? String(req.body.notes).slice(0, 2000) : null } });
    await payroll.buildRun(tx, { company: req.company, run });
  }, TX);
  res.json({ message: "Payroll recalculated", data: await loadRun(req) });
};

// PUT /company/payroll/payslips/:id/adjustments { lines: [{ kind: earning|deduction, name, amount, taxable? }] }  (one-off lines; replaces them)
const setAdjustments = async (req, res) => {
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  const slip = await prisma.payslips.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!slip) throw new HttpError(404, "Payslip not found");
  const clean = lines.map((l, i) => {
    if (!["earning", "deduction"].includes(l.kind)) throw new HttpError(400, `Line ${i + 1}: choose earning or deduction`);
    const name = String(l.name || "").trim().slice(0, 255);
    if (!name) throw new HttpError(400, `Line ${i + 1}: describe it (e.g. Bonus, Advance repayment)`);
    const amount = round2(Number(l.amount));
    if (!(amount > 0)) throw new HttpError(400, `Line ${i + 1}: amount must be more than 0`);
    return { kind: l.kind, name, amount, taxable: l.kind === "earning" ? l.taxable !== false : false };
  });
  await prisma.$transaction(async (tx) => {
    const run = await assertDraft(tx, req, slip.payroll_run_id);
    await tx.payslip_lines.deleteMany({ where: { payslip_id: slip.id, is_manual: true } });
    if (clean.length) {
      await tx.payslip_lines.createMany({ data: clean.map((l) => ({ payslip_id: slip.id, kind: l.kind, code: l.kind === "earning" ? "ADJ_EARN" : "ADJ_DED", name: l.name, amount: l.amount, taxable: l.taxable, is_manual: true, sort_order: 999 })) });
    }
    await payroll.buildRun(tx, { company: req.company, run, onlyEmployeeId: slip.employee_id });
    await payroll.refreshTotals(tx, run.id);
  }, TX);
  await audit(req, "payslip.adjust", { entity: "payslip", entityId: slip.id, changes: { lines: clean } });
  res.json({ message: "Payslip updated", data: await loadRun(req, slip.payroll_run_id) });
};

const approveRun = async (req, res) => {
  const run = await prisma.$transaction((tx) => payroll.approveRun(tx, { company: req.company, runId: toId(req.params.id), userId: req.user.id }), TX);
  await audit(req, "payroll.approve", { entity: "payroll_run", entityId: run.id, changes: { net: num(run.total_net), gross: num(run.total_gross) } });
  const books = ledger.accountingSettings(req.company).enabled;
  await require("../../services/inapp").notifyStaff(req.company.id, "payroll.pay", {
    type: "payroll.approved", title: `Payroll ${run.run_number} approved: ready to pay`, body: `$${num(run.total_net).toFixed(2)} net to ${run.employee_count} employee(s)`,
    link: `/business/payroll/${run.id}`, dedupeKey: `payroll-approved:${run.id}`,
  });
  res.json({ message: `Payroll ${run.run_number} approved${books ? " and posted to the books" : ""}`, data: await loadRun(req) });
};

// POST /company/payroll/runs/:id/pay { account_id?, paid_at?, reference?, email_payslips? }
const payRun = async (req, res) => {
  const run = await prisma.$transaction((tx) => payroll.payRun(tx, {
    company: req.company, runId: toId(req.params.id), accountId: req.body.account_id ? toId(req.body.account_id, "account_id") : null,
    paidAt: req.body.paid_at ? hr.parseDate(req.body.paid_at, "Payment date") : null, reference: req.body.reference, userId: req.user.id,
  }), TX);
  await audit(req, "payroll.pay", { entity: "payroll_run", entityId: run.id, changes: { net: num(run.total_net), reference: run.paid_reference } });
  let emailed = 0;
  if (req.body.email_payslips) emailed = await emailPayslips(req.company, run.id);
  res.json({ message: `Payroll ${run.run_number} marked as paid${emailed ? `; ${emailed} payslip(s) emailed` : ""}`, data: await loadRun(req) });
};

const unpayRun = async (req, res) => {
  const run = await prisma.$transaction((tx) => payroll.unpayRun(tx, { company: req.company, runId: toId(req.params.id), userId: req.user.id }), TX);
  await audit(req, "payroll.unpay", { entity: "payroll_run", entityId: run.id });
  res.json({ message: `Payment of ${run.run_number} undone`, data: await loadRun(req) });
};

const voidRun = async (req, res) => {
  const run = await prisma.$transaction((tx) => payroll.voidRun(tx, { company: req.company, runId: toId(req.params.id), userId: req.user.id }), TX);
  await audit(req, "payroll.void", { entity: "payroll_run", entityId: run.id });
  res.json({ message: `Payroll ${run.run_number} voided`, data: await loadRun(req) });
};

const emailPayslips = async (company, runId, onlyId = null) => {
  const run = await prisma.payroll_runs.findUnique({ where: { id: BigInt(runId) } });
  const slips = await prisma.payslips.findMany({ where: { payroll_run_id: run.id, ...(onlyId ? { id: BigInt(onlyId) } : {}) }, include: { employees: { select: { email: true, first_name: true } } } });
  let n = 0;
  for (const p of slips) {
    if (!p.employees.email) continue;
    await queueEmail({
      to: p.employees.email, template: "payslip", companyId: company.id, attachments: [{ kind: "payslip", id: p.id }],
      data: { name: p.employees.first_name, companyName: company.name, period: `${hr.toStr(run.period_start)} to ${hr.toStr(run.period_end)}`, net: num(p.net), payDate: hr.toStr(run.paid_at || run.pay_date), payslipNumber: p.payslip_number },
    });
    await prisma.payslips.update({ where: { id: p.id }, data: { emailed_at: new Date() } });
    n++;
  }
  return n;
};

// POST /company/payroll/runs/:id/email { payslip_id? }
const emailRun = async (req, res) => {
  const run = await prisma.payroll_runs.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!run) throw new HttpError(404, "Payroll run not found");
  if (!["approved", "paid"].includes(run.status)) throw new HttpError(400, "Approve the payroll before sending payslips");
  const n = await emailPayslips(req.company, run.id, req.body?.payslip_id ? toId(req.body.payslip_id, "payslip_id") : null);
  res.json({ message: n ? `${n} payslip(s) emailed` : "No employees with an email address on this payroll" });
};

const payslipPdf = async (req, res) => {
  const p = await prisma.payslips.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!p) throw new HttpError(404, "Payslip not found");
  await sendPdf(res, "payslip", p.id, req.company.id);
};

// ---- payroll liabilities (taxes & deductions withheld, employer contributions) ------------------

// GET /company/payroll/liabilities -> balance of each liability account payroll posts to
const liabilities = async (req, res) => {
  if (!ledger.accountingSettings(req.company).enabled) return res.json({ data: [], total: 0, enabled: false });
  const keyId = await ledger.accountId(prisma, req.company.id, "payroll_liabilities");
  const overrides = await prisma.pay_components.findMany({ where: { company_id: req.company.id, account_id: { not: null }, kind: { in: ["deduction", "employer"] } }, select: { account_id: true } });
  const ids = [...new Set([String(keyId), ...overrides.map((o) => String(o.account_id))])].map(BigInt);
  const [accounts, bal] = await Promise.all([prisma.accounts.findMany({ where: { id: { in: ids } } }), ledger.balances(prisma, req.company.id)]);
  const data = accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, balance: round2(-((bal.get(String(a.id)) || { net: 0 }).net)) }));
  const [wp] = await prisma.accounts.findMany({ where: { company_id: req.company.id, system_key: "wages_payable" } });
  const wagesPayable = wp ? round2(-((bal.get(String(wp.id)) || { net: 0 }).net)) : 0;
  res.json({ data, total: round2(data.reduce((s, a) => s + a.balance, 0)), wages_payable: wagesPayable, enabled: true });
};

// POST /company/payroll/remittances { account_id (liability), paid_from_account_id, amount, paid_at?, reference? }
const remit = async (req, res) => {
  if (!ledger.accountingSettings(req.company).enabled) throw new HttpError(400, "Set up accounting first");
  const amount = round2(Number(req.body.amount));
  if (!(amount > 0)) throw new HttpError(400, "Amount must be more than 0");
  const date = hr.parseDate(req.body.paid_at, "Date", hr.today());
  const e = await prisma.$transaction(async (tx) => {
    const liab = req.body.account_id
      ? await ledger.assertAccount(tx, req.company.id, toId(req.body.account_id, "account_id"), { types: ["liability"] })
      : { id: await ledger.accountId(tx, req.company.id, "payroll_liabilities"), name: "Payroll liabilities" };
    const from = await ledger.assertMoneyAccount(tx, req.company.id, toId(req.body.paid_from_account_id, "paid_from_account_id"));
    return ledger.post(tx, {
      companyId: req.company.id, date, sourceType: "payroll_remittance", sourceId: crypto.randomUUID(), userId: req.user.id,
      memo: `Paid ${liab.name}${req.body.reference ? ` (${String(req.body.reference).slice(0, 100)})` : ""}`,
      lines: [{ account: liab.id, debit: amount }, { account: from.id, credit: amount }],
    });
  }, TX);
  await audit(req, "payroll.remit", { entity: "journal_entry", entityId: e.id, changes: { amount } });
  res.status(201).json({ message: `Payment of ${amount.toFixed(2)} recorded (${e.entry_number})`, data: e });
};

module.exports = { listRuns, getRun, createRun, recalcRun, setAdjustments, approveRun, payRun, unpayRun, voidRun, emailRun, payslipPdf, liabilities, remit };
