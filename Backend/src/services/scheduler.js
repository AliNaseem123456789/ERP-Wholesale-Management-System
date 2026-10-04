// Background jobs inside the API process (no external scheduler needed):
//   - scheduled email reports (report_schedules.next_run_at), claimed with FOR UPDATE SKIP LOCKED so
//     several API instances never send the same report twice
//   - daily alerts in the notifications centre (overdue invoices, bills due, expiring lots & licences)
const { Prisma } = require("@prisma/client");
const prisma = require("../prisma");
const { queueEmail } = require("./email/outbox");
const { stringify } = require("./csv");
const reports = require("./reports");
const { notifyStaff } = require("./inapp");
const { round2 } = require("./money");

const PREVIEW_ROWS = 50;

/** Runs one schedule now: stores the run (CSV) and emails every recipient. */
const executeSchedule = async (schedule, { userId = null } = {}) => {
  const company = await prisma.companies.findUnique({ where: { id: schedule.company_id } });
  const period = reports.periodFor(schedule.frequency, new Date(), schedule.timezone);
  const periodLabel = reports.REPORTS[schedule.report]?.period ? (period.from === period.to ? period.from : `${period.from} to ${period.to}`) : `as of ${period.to}`;
  let run;
  try {
    const r = await reports.runReport(company, schedule.report, period);
    run = await prisma.report_runs.create({
      data: {
        company_id: company.id, schedule_id: schedule.id, report: schedule.report, title: r.title, period_from: new Date(`${period.from}T00:00:00Z`), period_to: new Date(`${period.to}T00:00:00Z`),
        row_count: r.rows.length, csv: stringify(r.rows, r.columns), summary: r.summary, recipients: schedule.recipients, created_by: userId ? BigInt(userId) : null,
      },
    });
    for (const to of schedule.recipients) {
      await queueEmail({
        to, template: "scheduledReport", companyId: company.id, attachments: [{ kind: "report_run", id: run.id }],
        data: { companyName: company.name, title: r.title, period: periodLabel, summary: r.summary.map(([k, v]) => [k, String(v)]), columns: r.columns, rows: r.rows.slice(0, PREVIEW_ROWS), rowCount: r.rows.length, scheduleName: schedule.name },
      });
    }
  } catch (err) {
    run = await prisma.report_runs.create({
      data: { company_id: company.id, schedule_id: schedule.id, report: schedule.report, title: schedule.name, status: "failed", error: String(err.message).slice(0, 2000), recipients: schedule.recipients, created_by: userId ? BigInt(userId) : null },
    });
    console.error(`Scheduled report ${schedule.id} failed:`, err.message);
  }
  await prisma.report_schedules.update({ where: { id: schedule.id }, data: { last_run_at: new Date() } });
  return run;
};

// Claims due schedules (moves next_run_at forward first) and runs them.
const runDueReports = async () => {
  const claimed = await prisma.$transaction(async (tx) => {
    // (compare with a JS timestamp, not SQL now(), so both sides go through the same driver conversion)
    const candidates = await tx.report_schedules.findMany({ where: { is_active: true, next_run_at: { lte: new Date() } }, orderBy: { next_run_at: "asc" }, take: 20, select: { id: true, company_id: true } });
    if (!candidates.length) return [];
    const active = new Set((await tx.companies.findMany({ where: { id: { in: candidates.map((c) => c.company_id) }, status: "active" }, select: { id: true } })).map((c) => String(c.id)));
    const ids = candidates.filter((c) => active.has(String(c.company_id))).map((c) => c.id);
    if (!ids.length) return [];
    const due = await tx.$queryRaw`SELECT id FROM report_schedules WHERE id IN (${Prisma.join(ids)}) FOR UPDATE SKIP LOCKED`;
    const out = [];
    for (const { id } of due) {
      const s = await tx.report_schedules.findUnique({ where: { id } });
      await tx.report_schedules.update({ where: { id }, data: { next_run_at: reports.nextRun(s, new Date()) } });
      out.push(s);
    }
    return out;
  });
  for (const s of claimed) await executeSchedule(s);
  return claimed.length;
};

// ---- daily alerts (deduplicated per day, so running every hour is harmless) ----
const dailyAlerts = async () => {
  const day = new Date().toISOString().slice(0, 10);
  const companies = await prisma.companies.findMany({ where: { status: "active" }, select: { id: true } });
  let n = 0;
  for (const { id } of companies) {
    const [inv] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount - amount_paid - amount_credited), 0)::float AS amount
      FROM invoices WHERE company_id = ${id} AND status IN ('issued','partially_paid') AND due_date < ${day}::date`;
    if (inv.n) n += await notifyStaff(id, "invoices.manage", { type: "invoice.overdue", title: `${inv.n} overdue invoice(s)`, body: `$${round2(inv.amount).toFixed(2)} past due`, link: "/business/invoices", dedupeKey: `overdue-invoices:${id}:${day}` });
    const [bills] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount - amount_paid - amount_credited), 0)::float AS amount
      FROM bills WHERE company_id = ${id} AND status IN ('open','partially_paid') AND due_date <= (${day}::date + 3)`;
    if (bills.n) n += await notifyStaff(id, "accounting.manage", { type: "bill.due", title: `${bills.n} bill(s) due within 3 days or overdue`, body: `$${round2(bills.amount).toFixed(2)} to pay`, link: "/business/bills", dedupeKey: `bills-due:${id}:${day}` });
    const [lots] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n FROM inventory_lots WHERE company_id = ${id} AND quantity > 0 AND expiry_date IS NOT NULL AND expiry_date <= (${day}::date + 30)`;
    if (lots.n) n += await notifyStaff(id, "inventory.view", { type: "stock.expiring", title: `${lots.n} lot(s) expire within 30 days`, body: "Sell, return or write them off", link: "/business/stock-reports", dedupeKey: `lots-expiring:${id}:${day}` });
    const licenses = await prisma.$queryRaw`
      SELECT l.id, l.state, l.license_number, to_char(l.expires_on, 'YYYY-MM-DD') AS expires_on, COALESCE(NULLIF(u.business_name,''), u.email) AS customer
      FROM customer_licenses l JOIN users u ON u.id = l.user_id
      WHERE l.company_id = ${id} AND l.expires_on IS NOT NULL AND l.expires_on <= (${day}::date + 30)`;
    for (const l of licenses) {
      n += await notifyStaff(id, "customers.manage", {
        type: "license.expiring", title: `${l.state} tobacco licence ${l.expires_on < day ? "expired" : "expiring"}: ${l.customer}`,
        body: `${l.license_number} · ${l.expires_on}`, link: "/business/compliance?tab=licenses", dedupeKey: `license:${l.id}:${l.expires_on}`,
      });
    }
  }
  return n;
};

let timer = null;
let lastAlerts = 0;
const tick = async () => {
  try {
    await runDueReports();
    if (Date.now() - lastAlerts > 60 * 60 * 1000) {
      lastAlerts = Date.now();
      await dailyAlerts();
    }
  } catch (err) {
    console.error("Scheduler tick failed:", err.message);
  }
};

const startScheduler = (intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS) || 60000) => {
  if (timer) return;
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 5000).unref?.();
  console.log(`Scheduler: every ${Math.round(intervalMs / 1000)}s (scheduled reports, daily alerts)`);
};

module.exports = { startScheduler, runDueReports, executeSchedule, dailyAlerts, tick };
