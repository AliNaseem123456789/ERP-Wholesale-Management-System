// Copies the app's database (everything in the "public" schema) from one Postgres to another, e.g. Supabase -> RDS.
// The source is only read. The target must be empty (no tables), so a live database can't be overwritten by mistake.
//
//   COPY_FROM_DATABASE_URL=postgresql://...supabase...  COPY_TO_DATABASE_URL=postgresql://...rds...  node scripts/db-copy.js
//
// Needs pg_dump / pg_restore version 17 or newer on this machine (deploy/setup-ec2.sh installs them).
// Steps: dump the source, restore it into the target, then count the rows of every table on both sides and
// compare the id counters, and say whether the copy is exact. Stop the app (or keep visitors off it) while copying:
// anything written to the source after the dump isn't in the copy.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Client } = require("pg");

const FROM = process.env.COPY_FROM_DATABASE_URL;
const TO = process.env.COPY_TO_DATABASE_URL;

const host = (u) => { try { const x = new URL(u); return `${x.hostname}:${x.port || 5432}${x.pathname}`; } catch { return "?"; } };
const isLocal = (u) => /^(localhost|127\.0\.0\.1)$/.test(new URL(u).hostname);
/** Address for pg_dump / pg_restore: only libpq settings, TLS unless local or disabled. */
const forLibpq = (u) => {
  const url = new URL(u);
  const mode = url.searchParams.get("sslmode");
  for (const k of [...url.searchParams.keys()]) url.searchParams.delete(k);
  url.searchParams.set("sslmode", mode === "disable" || (!mode && isLocal(u)) ? "disable" : "require");
  return url.toString();
};
/** Client for the pg library (same rules; it doesn't verify the certificate of RDS / Supabase). */
const client = async (u) => {
  const url = new URL(u);
  const noTls = isLocal(u) || url.searchParams.get("sslmode") === "disable";
  for (const k of [...url.searchParams.keys()]) url.searchParams.delete(k);
  const c = new Client({ connectionString: url.toString(), ssl: noTls ? false : { rejectUnauthorized: false } });
  await c.connect();
  return c;
};
const tool = (name) => {
  const r = spawnSync(name, ["--version"], { encoding: "utf8" });
  if (r.error) throw new Error(`${name} isn't installed. On the server run deploy/setup-ec2.sh (installs postgresql-client-17).`);
  const major = Number((r.stdout.match(/(\d+)\./) || [])[1]);
  return major;
};

// row count of every table and the current value of every id counter, one round trip each
const snapshot = async (u) => {
  const c = await client(u);
  try {
    const counts = (await c.query(`SELECT tablename AS t, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', tablename), false, true, '')))[1]::text::bigint AS n
      FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).rows;
    const seqs = (await c.query("SELECT sequencename AS s, last_value AS v FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1")).rows;
    const version = (await c.query("SHOW server_version")).rows[0].server_version;
    return { counts: Object.fromEntries(counts.map((r) => [r.t, Number(r.n)])), seqs: Object.fromEntries(seqs.map((r) => [r.s, r.v === null ? null : String(r.v)])), version };
  } finally {
    await c.end();
  }
};

(async () => {
  if (!FROM || !TO) throw new Error("Set COPY_FROM_DATABASE_URL (the database to copy) and COPY_TO_DATABASE_URL (the empty target).");
  if (host(FROM) === host(TO)) throw new Error("Source and target are the same database.");
  const dumpV = tool("pg_dump");
  tool("pg_restore");

  console.log(`From ${host(FROM)}\nTo   ${host(TO)}\n`);
  const [src, dst] = await Promise.all([snapshot(FROM), snapshot(TO)]);
  console.log(`Source Postgres ${src.version}, target Postgres ${dst.version}, pg_dump ${dumpV}`);
  if (Number.parseInt(src.version, 10) > dumpV) throw new Error(`pg_dump ${dumpV} is older than the source (Postgres ${src.version}); install a newer postgresql-client.`);
  if (Object.keys(dst.counts).length) throw new Error(`The target already has ${Object.keys(dst.counts).length} tables. Copy only into an empty database (create a new one, e.g. CREATE DATABASE wholesale2).`);
  const rows = Object.values(src.counts).reduce((s, n) => s + n, 0);
  console.log(`Copying ${Object.keys(src.counts).length} tables, ${rows.toLocaleString()} rows.\n`);

  const file = path.join(os.tmpdir(), `db-copy-${Date.now()}.dump`);
  try {
    let t = Date.now();
    const d = spawnSync("pg_dump", [forLibpq(FROM), "--schema=public", "--no-owner", "--no-privileges", "--format=custom", `--file=${file}`], { encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] });
    if (d.status !== 0) throw new Error(`Reading the source failed: ${d.stderr.trim().slice(0, 800)}`);
    console.log(`1/3 read in ${Math.round((Date.now() - t) / 1000)} s (${(fs.statSync(file).size / 1048576).toFixed(1)} MB compressed)`);

    t = Date.now();
    const r = spawnSync("pg_restore", ["--dbname", forLibpq(TO), "--no-owner", "--no-privileges", file], { encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] });
    // the empty target already has a "public" schema; that one message is expected
    const problems = (r.stderr || "").split("\n").filter((l) => /error/i.test(l) && !/schema "public" already exists/.test(l) && !/errors ignored on restore/.test(l));
    console.log(`2/3 written in ${Math.round((Date.now() - t) / 1000)} s${problems.length ? `, ${problems.length} problem(s):` : ""}`);
    for (const p of problems.slice(0, 20)) console.log(`    ${p.trim()}`);
  } finally {
    fs.rmSync(file, { force: true });
  }

  const [a, b] = await Promise.all([snapshot(FROM), snapshot(TO)]);
  const diff = Object.keys(a.counts).filter((t) => a.counts[t] !== b.counts[t]);
  const seqDiff = Object.keys(a.seqs).filter((s) => a.seqs[s] !== b.seqs[s]);
  if (!diff.length && !seqDiff.length) console.log(`3/3 exact: ${Object.keys(a.counts).length} tables and ${Object.keys(a.seqs).length} id counters match`);
  else {
    console.log(`3/3 ${diff.length} table(s) and ${seqDiff.length} id counter(s) differ:`);
    for (const t of diff.slice(0, 20)) console.log(`    ${t.padEnd(32)} source ${a.counts[t]}  target ${b.counts[t] ?? "missing"}`);
    for (const s of seqDiff.slice(0, 10)) console.log(`    ${s.padEnd(32)} source ${a.seqs[s]}  target ${b.seqs[s] ?? "missing"}`);
    console.log("    (rows written to the source during the copy show up here too; if the app was running, stop it and copy again into a fresh database)");
    process.exitCode = 1;
  }
})().catch((e) => { console.error(`\nFailed: ${e.message}`); process.exit(1); });
