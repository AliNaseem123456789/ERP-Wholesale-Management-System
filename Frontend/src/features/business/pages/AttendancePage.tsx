import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { hrApi, ATTENDANCE_STATUSES } from "../api/hr.api";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, FilterTabs, inputBase, btnPrimary, btnSecondary } from "../components/ui";

const todayStr = () => new Date().toISOString().slice(0, 10);
const shift = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
type Row = { employee_id: number; name: string; number: string; department: string | null; status: string; check_in: string; check_out: string; hours: string; overtime_hours: string; notes: string; leave: boolean; dirty: boolean };
const EDITABLE = ["present", "absent", "half_day", "holiday"];

const DaySheet: React.FC = () => {
  const { companyId } = useBusiness();
  const [date, setDate] = useState(todayStr());
  const [meta, setMeta] = useState<any>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(date);
  const load = useCallback(() => {
    setRows(null);
    latest.current = date;
    hrApi.attendanceDay(companyId!, date).then((r) => {
      if (r.date !== latest.current) return; // a slower answer for a date no longer shown
      setMeta(r);
      setRows(r.data.map((x: any) => ({
        employee_id: x.employee.id, name: x.employee.name, number: x.employee.employee_number, department: x.employee.department,
        status: x.record?.status || "", check_in: x.record?.check_in || "", check_out: x.record?.check_out || "",
        hours: x.record?.hours != null ? String(x.record.hours) : "", overtime_hours: x.record?.overtime_hours ? String(x.record.overtime_hours) : "",
        notes: x.record?.notes || "", leave: !!x.record?.leave_request_id, dirty: false,
      })));
    }).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, date]);
  useEffect(load, [load]);
  const set = (i: number, p: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...p, dirty: true } : r)));
  const save = async () => {
    const changed = rows!.filter((r) => r.dirty && !r.leave);
    if (!changed.length) return toast.info("Nothing changed");
    setBusy(true);
    try {
      toast.success((await hrApi.saveAttendance(companyId!, date, changed.map((r) => ({ employee_id: r.employee_id, status: r.status, check_in: r.check_in, check_out: r.check_out, hours: r.hours, overtime_hours: r.overtime_hours || 0, notes: r.notes })))).message);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const future = date > todayStr();
  return (
    <>
      <Card className="p-3 mb-3 flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => setDate(shift(date, -1))} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Previous day"><ChevronLeft size={18} /></button>
        <input type="date" aria-label="Date" className={inputBase} value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={() => setDate(shift(date, 1))} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Next day"><ChevronRight size={18} /></button>
        <span className="font-semibold">{new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" })}</span>
        {meta?.holiday && <StatusBadge status="holiday" />}
        {meta?.holiday && <span className="text-gray-600">{meta.holiday}</span>}
        {meta && !meta.working_day && !meta.holiday && <span className="text-gray-500">Not a working day</span>}
        <span className="flex-1" />
        {rows && !future && <button onClick={() => setRows(rows.map((r) => (!r.status && !r.leave ? { ...r, status: "present", dirty: true } : r)))} className={btnSecondary}>Mark the rest present</button>}
        <button onClick={save} disabled={busy || future} className={btnPrimary}>Save attendance</button>
      </Card>
      <Card className="overflow-x-auto">
        {!rows ? <Spinner /> : rows.length === 0 ? <EmptyState icon={<CalendarCheck size={36} />} title="Nobody on the books this day" /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Employee</th><th>Status</th><th>In</th><th>Out</th><th>Hours</th><th>Overtime h</th><th className="pr-4">Notes</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.employee_id} className={`border-b border-gray-50 ${r.dirty ? "bg-amber-50/50" : ""}`}>
                <td className="px-4 py-2"><span className="font-semibold">{r.name}</span><span className="block text-xs text-gray-400">{r.number}{r.department ? ` · ${r.department}` : ""}</span></td>
                <td>{r.leave ? <StatusBadge status={r.status} /> : (
                  <select aria-label={`${r.name} status`} className={`${inputBase} w-32`} value={r.status} disabled={future} onChange={(e) => set(i, { status: e.target.value })}>
                    <option value="">Not marked</option>
                    {EDITABLE.map((s) => <option key={s} value={s}>{ATTENDANCE_STATUSES[s]}</option>)}
                  </select>
                )}</td>
                <td><input type="time" aria-label={`${r.name} in`} disabled={r.leave || !["present", "half_day"].includes(r.status)} className={`${inputBase} w-28`} value={r.check_in} onChange={(e) => set(i, { check_in: e.target.value, hours: "" })} /></td>
                <td><input type="time" aria-label={`${r.name} out`} disabled={r.leave || !["present", "half_day"].includes(r.status)} className={`${inputBase} w-28`} value={r.check_out} onChange={(e) => set(i, { check_out: e.target.value, hours: "" })} /></td>
                <td><input type="number" min="0" max="24" step="0.25" aria-label={`${r.name} hours`} disabled={r.leave || !["present", "half_day"].includes(r.status)} placeholder={r.check_in && r.check_out ? "auto" : String(meta?.hours_per_day || 8)} className={`${inputBase} w-20`} value={r.hours} onChange={(e) => set(i, { hours: e.target.value })} /></td>
                <td><input type="number" min="0" max="24" step="0.25" aria-label={`${r.name} overtime`} disabled={r.leave || !r.status} className={`${inputBase} w-20`} value={r.overtime_hours} onChange={(e) => set(i, { overtime_hours: e.target.value })} /></td>
                <td className="pr-4"><input aria-label={`${r.name} notes`} disabled={r.leave} className={`${inputBase} w-full min-w-32`} value={r.notes} onChange={(e) => set(i, { notes: e.target.value })} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <p className="text-xs text-gray-400 mt-2">Leave is recorded from approved leave requests. Absences and half days are unpaid for salaried staff; hourly staff are paid for the hours recorded.</p>
    </>
  );
};

const Summary: React.FC = () => {
  const { companyId } = useBusiness();
  const [range, setRange] = useState({ from: `${todayStr().slice(0, 7)}-01`, to: todayStr() });
  const [d, setD] = useState<any>(null);
  useEffect(() => { hrApi.attendanceSummary(companyId!, range).then(setD).catch((e) => toast.error(errorMessage(e))); }, [companyId, range]);
  return (
    <>
      <Card className="p-3 mb-3 flex flex-wrap gap-2 items-center text-sm">
        <input type="date" aria-label="From" className={inputBase} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className="text-gray-400">to</span>
        <input type="date" aria-label="To" className={inputBase} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        {d && <span className="text-gray-500 ml-2">{d.working_days} working days</span>}
      </Card>
      <Card className="overflow-x-auto">
        {!d ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Employee</th><th className="text-right">Present</th><th className="text-right">Absent</th><th className="text-right">Half days</th><th className="text-right">Paid leave</th><th className="text-right">Unpaid leave</th><th className="text-right">Hours</th><th className="text-right pr-4">Overtime h</th></tr></thead>
            <tbody>{d.data.map((r: any) => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="px-4 py-2 font-semibold">{r.name} <span className="text-xs text-gray-400 font-normal">{r.employee_number}</span>{r.recorded === 0 && <span className="text-xs text-amber-700 ml-2">no records</span>}</td>
                <td className="text-right">{r.present}</td><td className={`text-right ${r.absent ? "text-red-700 font-semibold" : ""}`}>{r.absent}</td><td className="text-right">{r.half_days}</td>
                <td className="text-right">{r.paid_leave}</td><td className="text-right">{r.unpaid_leave}</td><td className="text-right">{r.hours}</td><td className="text-right pr-4">{r.overtime}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
};

export const AttendancePage: React.FC = () => {
  const [tab, setTab] = useState("day");
  return (
    <div>
      <PageHeader title="Attendance" subtitle="Who was in, hours and overtime. Payroll reads it." />
      <div className="mb-3"><FilterTabs value={tab} onChange={setTab} options={[{ value: "day", label: "Daily sheet" }, { value: "summary", label: "Summary" }]} /></div>
      {tab === "day" ? <DaySheet /> : <Summary />}
    </div>
  );
};
