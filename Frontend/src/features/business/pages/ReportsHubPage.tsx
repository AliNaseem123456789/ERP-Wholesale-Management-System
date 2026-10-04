import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Play, Download, Plus, Pause, Trash2, Send, Clock, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { opsApi, downloadCsv } from "../api/ops.api";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Modal, Field, FilterTabs, dateOnly, dateTime, inputCls, inputBase, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

const today = () => new Date().toISOString().slice(0, 10);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const localTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
const describe = (s: any) =>
  `${s.frequency === "daily" ? "Every day" : s.frequency === "weekly" ? `Every ${DAYS[s.day_of_week ?? 1]}` : `Monthly on day ${s.day_of_month}`} at ${String(s.hour).padStart(2, "0")}:00 (${s.timezone})`;

const RunTab: React.FC<{ catalog: { key: string; label: string; period: boolean }[] }> = ({ catalog }) => {
  const { companyId } = useBusiness();
  const [key, setKey] = useState(catalog[0]?.key || "");
  const [range, setRange] = useState({ from: `${today().slice(0, 7)}-01`, to: today() });
  const [r, setR] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const def = catalog.find((c) => c.key === key);
  const run = async () => {
    setBusy(true);
    try {
      setR(await opsApi.runReport(companyId!, key, range));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { setR(null); }, [key]);
  return (
    <div className="space-y-3">
      <Card className="p-4 flex flex-wrap gap-3 items-end text-sm">
        <Field label="Report">
          <select aria-label="Report" className={`${inputBase} w-64`} value={key} onChange={(e) => setKey(e.target.value)}>
            {catalog.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        {def?.period ? (
          <>
            <Field label="From"><input type="date" className={inputBase} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
            <Field label="To"><input type="date" className={inputBase} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          </>
        ) : <p className="text-gray-500 pb-2">As of today</p>}
        <button disabled={busy || !key} onClick={run} className={btnPrimary}><Play size={16} /> Run</button>
        <button disabled={!key} onClick={() => downloadCsv(companyId!, `/company/reports/run/${key}?from=${range.from}&to=${range.to}&format=csv`, `${key}.csv`).catch((e) => toast.error(errorMessage(e)))} className={btnSecondary}><Download size={16} /> CSV</button>
      </Card>
      {r && (
        <Card className="overflow-x-auto">
          <div className="p-4 flex flex-wrap gap-4">
            {r.summary.map(([k, v]: [string, any]) => <div key={k} className="bg-gray-50 rounded-xl px-3 py-2"><p className="text-[10px] uppercase font-bold text-gray-400">{k}</p><p className="font-black text-gray-900">{String(v)}</p></div>)}
          </div>
          {r.rows.length === 0 ? <p className="px-4 pb-4 text-sm text-gray-500">No rows.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-y">{r.columns.map((c: any) => <th key={c.key} className="px-3 py-2">{c.label}</th>)}</tr></thead>
              <tbody>{r.rows.map((row: any, i: number) => <tr key={i} className="border-b border-gray-50">{r.columns.map((c: any) => <td key={c.key} className="px-3 py-1.5">{String(row[c.key] ?? "")}</td>)}</tr>)}</tbody>
            </table>
          )}
          {r.row_count > r.rows.length && <p className="p-3 text-xs text-gray-500">Showing {r.rows.length} of {r.row_count}. Download the CSV for everything.</p>}
        </Card>
      )}
    </div>
  );
};

const ScheduleModal: React.FC<{ catalog: { key: string; label: string }[]; onClose: () => void; onSaved: () => void }> = ({ catalog, onClose, onSaved }) => {
  const { companyId } = useBusiness();
  const [f, setF] = useState({ name: "", report: catalog[0]?.key || "", frequency: "weekly", day_of_week: 1, day_of_month: 1, hour: 8, timezone: localTz(), recipients: "" });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      toast.success((await opsApi.createSchedule(companyId!, { ...f, name: f.name || catalog.find((c) => c.key === f.report)?.label })).message);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal title="Email a report on a schedule" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <Field label="Report">
          <select className={inputCls} value={f.report} onChange={(e) => setF({ ...f, report: e.target.value })}>
            {catalog.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Name"><input className={inputCls} value={f.name} placeholder={catalog.find((c) => c.key === f.report)?.label} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="How often">
            <select className={inputCls} value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
              <option value="daily">Daily (yesterday)</option><option value="weekly">Weekly (last 7 days)</option><option value="monthly">Monthly (last month)</option>
            </select>
          </Field>
          {f.frequency === "weekly" && <Field label="Day"><select className={inputCls} value={f.day_of_week} onChange={(e) => setF({ ...f, day_of_week: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>}
          {f.frequency === "monthly" && <Field label="Day of month"><input type="number" min="1" max="28" className={inputCls} value={f.day_of_month} onChange={(e) => setF({ ...f, day_of_month: Number(e.target.value) })} /></Field>}
          <Field label="Hour"><select className={inputCls} value={f.hour} onChange={(e) => setF({ ...f, hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></Field>
        </div>
        <Field label="Time zone"><input className={inputCls} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
        <Field label="Send to" hint="Email addresses, separated by commas"><input required className={inputCls} value={f.recipients} onChange={(e) => setF({ ...f, recipients: e.target.value })} placeholder="owner@company.com, accounts@company.com" /></Field>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Schedule</button></div>
      </form>
    </Modal>
  );
};

const ScheduledTab: React.FC<{ catalog: { key: string; label: string; period: boolean }[] }> = ({ catalog }) => {
  const { companyId } = useBusiness();
  const [rows, setRows] = useState<any[] | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    opsApi.schedules(companyId!).then(setRows).catch((e) => toast.error(errorMessage(e)));
    opsApi.reportRuns(companyId!).then(setRuns).catch(() => {});
  }, [companyId]);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<any>) => {
    try {
      toast.success((await fn()).message);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button onClick={() => setAdding(true)} className={btnPrimary}><Plus size={16} /> Schedule a report</button></div>
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : rows.length === 0 ? <EmptyState icon={<CalendarClock size={36} />} title="No scheduled reports" text="Get sales, stock, money owed or payroll emailed to you every day, week or month, with the CSV attached." /> : rows.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-50 text-sm">
            <div className="flex-1 min-w-60">
              <p className="font-semibold text-gray-900">{s.name} {!s.is_active && <StatusBadge status="inactive" />}</p>
              <p className="text-gray-500">{s.report_label} · {describe(s)}</p>
              <p className="text-xs text-gray-400">To {s.recipients.join(", ")}{s.next_run_at ? ` · next ${dateTime(s.next_run_at)}` : ""}{s.last_run_at ? ` · last ${dateTime(s.last_run_at)}` : ""}</p>
            </div>
            <button onClick={() => act(() => opsApi.runSchedule(companyId!, s.id))} className={btnSecondary}><Send size={14} /> Send now</button>
            <button onClick={() => act(() => opsApi.updateSchedule(companyId!, s.id, { is_active: !s.is_active }))} className={btnSecondary}>{s.is_active ? <><Pause size={14} /> Pause</> : <><Clock size={14} /> Resume</>}</button>
            <button onClick={() => window.confirm("Delete this schedule?") && act(() => opsApi.deleteSchedule(companyId!, s.id))} className={btnDanger} aria-label={`Delete ${s.name}`}><Trash2 size={14} /></button>
          </div>
        ))}
      </Card>
      {runs.length > 0 && (
        <Card className="overflow-hidden">
          <p className="font-bold px-4 pt-4 pb-2">Sent reports</p>
          <table className="w-full text-sm"><tbody>{runs.slice(0, 30).map((r) => (
            <tr key={r.id} className="border-b border-gray-50">
              <td className="px-4 py-2">{dateTime(r.created_at)}</td><td className="font-semibold">{r.title}</td>
              <td className="text-gray-500">{r.period_from ? `${dateOnly(r.period_from)}${r.period_to !== r.period_from ? ` – ${dateOnly(r.period_to)}` : ""}` : ""}</td>
              <td>{r.status === "ok" ? `${r.row_count} rows` : <span className="text-red-700">{r.error}</span>}</td>
              <td className="text-right pr-4">{r.status === "ok" && <button onClick={() => downloadCsv(companyId!, `/company/reports/runs/${r.id}/csv`, `${r.report}-${r.id}.csv`).catch((e) => toast.error(errorMessage(e)))} className="text-gray-500 hover:text-blue-700" aria-label="Download CSV"><Download size={15} /></button>}</td>
            </tr>
          ))}</tbody></table>
        </Card>
      )}
      {adding && <ScheduleModal catalog={catalog} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
};

export const ReportsHubPage: React.FC = () => {
  const { companyId } = useBusiness();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "run";
  const [catalog, setCatalog] = useState<any[] | null>(null);
  useEffect(() => { opsApi.reportCatalog(companyId!).then(setCatalog).catch((e) => toast.error(errorMessage(e))); }, [companyId]);
  return (
    <div>
      <PageHeader title="Reports" subtitle="Run any report now, or have it emailed to you on a schedule" />
      <div className="mb-3"><FilterTabs value={tab} onChange={(v) => setParams({ tab: v })} options={[{ value: "run", label: "Run a report" }, { value: "scheduled", label: "Scheduled emails" }]} /></div>
      {!catalog ? <Spinner /> : catalog.length === 0 ? <Card className="p-6 text-sm text-gray-500">No reports are available for your role.</Card> : tab === "run" ? <RunTab catalog={catalog} /> : <ScheduledTab catalog={catalog} />}
    </div>
  );
};
