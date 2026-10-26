// A simulated clock for the demo generator. Replaces the global Date so the app (running in this process)
// believes it is some day in the past. The database still stamps rows with its own clock (DEFAULT now()),
// so every switch of the simulated time is recorded as a segment of real time, and fixTimestamps() later
// moves every database-written timestamp from real time to the simulated time of its segment.
const RealDate = Date;
let offset = 0;
const segments = []; // contiguous: { rs (real ms when it started), off (sim - real) }

class SimDate extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(RealDate.now() + offset);
    else super(...a);
  }
  static now() { return RealDate.now() + offset; }
}
SimDate.UTC = RealDate.UTC;
SimDate.parse = RealDate.parse;
global.Date = SimDate;

const realNow = () => RealDate.now();
const now = () => RealDate.now() + offset;
/** Simulated time becomes t (ms). Time keeps running from there. */
const set = (t) => {
  const r = RealDate.now();
  offset = t - r;
  const last = segments[segments.length - 1];
  if (last && last.rs === r) last.off = offset;
  else segments.push({ rs: r, off: offset });
};
const advance = (ms) => set(now() + ms);
const advanceTo = (t) => { if (t > now()) set(t); };

/** Moves database-written timestamps (within the generator's run) to simulated time. */
const fixTimestamps = async (db) => {
  if (!segments.length) return;
  const end = RealDate.now();
  await db.query("DROP TABLE IF EXISTS _demo_segs");
  await db.query("CREATE TEMP TABLE _demo_segs (rs timestamptz PRIMARY KEY, off_ms double precision NOT NULL)");
  for (let i = 0; i < segments.length; i += 1000) {
    const chunk = segments.slice(i, i + 1000);
    const vals = chunk.map((s, j) => `($${j * 2 + 1}::timestamptz, $${j * 2 + 2})`).join(",");
    await db.query(`INSERT INTO _demo_segs VALUES ${vals} ON CONFLICT (rs) DO UPDATE SET off_ms = EXCLUDED.off_ms`, chunk.flatMap((s) => [new RealDate(s.rs).toISOString(), s.off]));
  }
  const first = new RealDate(segments[0].rs).toISOString();
  const last = new RealDate(end + 1000).toISOString();
  const cols = (await db.query(`SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type IN ('timestamp with time zone', 'timestamp without time zone')
      AND table_name NOT LIKE '\\_%'`)).rows;
  let moved = 0;
  for (const c of cols) {
    const col = `"${c.column_name}"`;
    const tz = c.data_type === "timestamp with time zone";
    const v = tz ? `t.${col}` : `(t.${col} AT TIME ZONE 'UTC')`;
    const r = await db.query(`UPDATE "${c.table_name}" t SET ${col} = t.${col} + make_interval(secs => (
        SELECT s.off_ms FROM _demo_segs s WHERE s.rs <= ${v} ORDER BY s.rs DESC LIMIT 1) / 1000.0)
      WHERE ${v} >= $1::timestamptz AND ${v} < $2::timestamptz`, [first, last]);
    moved += r.rowCount;
  }
  // dates the database fills in with CURRENT_DATE (e.g. a purchase order's order date): take the row's (fixed) creation day
  const realDays = [...new Set([new RealDate(segments[0].rs), new RealDate(end)].map((d) => d.toISOString().slice(0, 10)))];
  const dates = (await db.query(`SELECT c.table_name, c.column_name FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.data_type = 'date' AND c.column_default ILIKE '%CURRENT_DATE%' AND c.column_name NOT ILIKE '%due%'
      AND EXISTS (SELECT 1 FROM information_schema.columns x WHERE x.table_schema = 'public' AND x.table_name = c.table_name AND x.column_name = 'created_at')`)).rows;
  for (const c of dates) {
    const r = await db.query(`UPDATE "${c.table_name}" SET "${c.column_name}" = (created_at AT TIME ZONE 'UTC')::date WHERE "${c.column_name}" = ANY($1::date[]) AND (created_at AT TIME ZONE 'UTC')::date <> "${c.column_name}"`, [realDays]);
    moved += r.rowCount;
  }
  return moved;
};

module.exports = { set, advance, advanceTo, now, realNow, fixTimestamps, segments, RealDate };
