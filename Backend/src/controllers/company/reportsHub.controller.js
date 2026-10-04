// Reports hub: run any report now (preview or CSV), and schedule reports by email.
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { stringify, sendCsv } = require("../../services/csv");
const reports = require("../../services/reports");
const { executeSchedule } = require("../../services/scheduler");

const allowed = (req, key) => {
  const def = reports.REPORTS[key];
  if (!def) throw new HttpError(404, `Unknown report: ${key}`);
  if (!def.perm.some((p) => req.can(p))) throw new HttpError(403, "You don't have permission to run this report");
  return def;
};
const iso = /^\d{4}-\d{2}-\d{2}$/;

const catalog = async (req, res) => {
  res.json({
    data: Object.entries(reports.REPORTS).filter(([, d]) => d.perm.some((p) => req.can(p))).map(([key, d]) => ({ key, label: d.label, period: !!d.period })),
  });
};

// GET /company/reports/run/:key?from&to&format=csv&state
const runNow = async (req, res) => {
  allowed(req, req.params.key);
  const today = new Date().toISOString().slice(0, 10);
  const to = iso.test(String(req.query.to || "")) ? String(req.query.to) : today;
  const from = iso.test(String(req.query.from || "")) ? String(req.query.from) : `${to.slice(0, 7)}-01`;
  if (from > to) throw new HttpError(400, "From is after To");
  const r = await reports.runReport(req.company, req.params.key, { from, to }, { state: req.query.state ? String(req.query.state).toUpperCase() : null, reportableOnly: req.query.reportable === "1" });
  if (req.query.format === "csv") {
    await audit(req, "report.download", { entity: "report", entityId: null, changes: { report: req.params.key, from, to, rows: r.rows.length } });
    return sendCsv(res, `${req.params.key}-${from}-${to}.csv`, stringify(r.rows, r.columns));
  }
  res.json({ data: { ...r, from, to, rows: r.rows.slice(0, 1000), row_count: r.rows.length } });
};

// ---- schedules ----

const scheduleData = (req, b, existing = null) => {
  const data = {};
  if (b.name !== undefined) {
    data.name = String(b.name || "").trim().slice(0, 255);
    if (!data.name) throw new HttpError(400, "Name the schedule");
  }
  if (b.report !== undefined) {
    allowed(req, b.report);
    data.report = b.report;
  }
  const freq = b.frequency ?? existing?.frequency;
  if (!["daily", "weekly", "monthly"].includes(freq)) throw new HttpError(400, "Frequency must be daily, weekly or monthly");
  data.frequency = freq;
  if (b.day_of_week !== undefined || freq === "weekly") {
    const d = Number(b.day_of_week ?? existing?.day_of_week ?? 1);
    if (!Number.isInteger(d) || d < 0 || d > 6) throw new HttpError(400, "Day of week must be 0 (Sunday) to 6");
    data.day_of_week = d;
  }
  if (b.day_of_month !== undefined || freq === "monthly") {
    const d = Number(b.day_of_month ?? existing?.day_of_month ?? 1);
    if (!Number.isInteger(d) || d < 1 || d > 28) throw new HttpError(400, "Day of month must be 1-28");
    data.day_of_month = d;
  }
  if (b.hour !== undefined) {
    const h = Number(b.hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) throw new HttpError(400, "Hour must be 0-23");
    data.hour = h;
  }
  if (b.timezone !== undefined) {
    if (!reports.validTimeZone(String(b.timezone))) throw new HttpError(400, "Unknown time zone");
    data.timezone = String(b.timezone);
  }
  if (b.recipients !== undefined) {
    const list = (Array.isArray(b.recipients) ? b.recipients : String(b.recipients).split(/[,;\s]+/)).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    const uniq = [...new Set(list)];
    if (!uniq.length) throw new HttpError(400, "Add at least one email address");
    if (uniq.length > 20) throw new HttpError(400, "Up to 20 recipients");
    const bad = uniq.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad) throw new HttpError(400, `"${bad}" isn't a valid email`);
    data.recipients = uniq;
  }
  if (b.is_active !== undefined) data.is_active = !!b.is_active;
  return data;
};

const shape = (s) => ({ ...s, report_label: reports.REPORTS[s.report]?.label || s.report });

const listSchedules = async (req, res) => {
  const rows = await prisma.report_schedules.findMany({ where: { company_id: req.company.id }, orderBy: { id: "asc" } });
  res.json({ data: rows.filter((s) => reports.REPORTS[s.report]?.perm.some((p) => req.can(p))).map(shape) });
};

const createSchedule = async (req, res) => {
  const data = scheduleData(req, req.body);
  if (!data.report || !data.name || !data.recipients) throw new HttpError(400, "Choose a report, a name and recipients");
  const s = { timezone: "UTC", hour: 8, ...data };
  s.next_run_at = reports.nextRun(s);
  const row = await prisma.report_schedules.create({ data: { ...s, company_id: req.company.id, created_by: BigInt(req.user.id) } });
  await audit(req, "report_schedule.create", { entity: "report_schedule", entityId: row.id, changes: { report: row.report, frequency: row.frequency, recipients: row.recipients } });
  res.status(201).json({ message: `"${row.name}" scheduled. Next: ${row.next_run_at.toISOString().replace("T", " ").slice(0, 16)} UTC`, data: shape(row) });
};

const findSchedule = async (req) => {
  const s = await prisma.report_schedules.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!s) throw new HttpError(404, "Schedule not found");
  allowed(req, s.report);
  return s;
};

const updateSchedule = async (req, res) => {
  const s = await findSchedule(req);
  const data = scheduleData(req, req.body, s);
  const merged = { ...s, ...data };
  data.next_run_at = merged.is_active ? reports.nextRun(merged) : null;
  const row = await prisma.report_schedules.update({ where: { id: s.id }, data: { ...data, updated_at: new Date() } });
  res.json({ message: row.is_active ? "Schedule saved" : "Schedule paused", data: shape(row) });
};

const deleteSchedule = async (req, res) => {
  const s = await findSchedule(req);
  await prisma.report_schedules.delete({ where: { id: s.id } });
  await audit(req, "report_schedule.delete", { entity: "report_schedule", entityId: s.id });
  res.json({ message: "Schedule deleted" });
};

const runScheduleNow = async (req, res) => {
  const s = await findSchedule(req);
  const run = await executeSchedule(s, { userId: req.user.id });
  if (run.status === "failed") throw new HttpError(500, `The report failed: ${run.error}`);
  res.json({ message: `Sent to ${s.recipients.length} recipient(s)`, data: { id: run.id, row_count: run.row_count } });
};

const listRuns = async (req, res) => {
  const rows = await prisma.report_runs.findMany({
    where: { company_id: req.company.id, ...(req.query.schedule_id ? { schedule_id: toId(req.query.schedule_id, "schedule_id") } : {}) },
    orderBy: { id: "desc" }, take: 100,
    select: { id: true, schedule_id: true, report: true, title: true, period_from: true, period_to: true, row_count: true, summary: true, status: true, error: true, recipients: true, created_at: true },
  });
  res.json({ data: rows.filter((r) => reports.REPORTS[r.report]?.perm.some((p) => req.can(p))) });
};

const runCsv = async (req, res) => {
  const run = await prisma.report_runs.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!run) throw new HttpError(404, "Report not found");
  allowed(req, run.report);
  sendCsv(res, `${run.report}-${run.id}.csv`, run.csv);
};

module.exports = { catalog, runNow, listSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow, listRuns, runCsv };
