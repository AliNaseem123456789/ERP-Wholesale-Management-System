// DEVELOPER TOOL: after generate.js, writes the demo rows (every row with an id of 5,000,000 or more, plus the
// link rows that point at them) to scripts/demo/data/demo-data.json.gz for scripts/demo-data.js to load.
//   DATABASE_URL=postgres://.../copy node scripts/demo/export.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { Client } = require("pg");

const BASE = 5000000;
const SKIP = new Set(["refresh_tokens", "user_tokens", "email_outbox", "_app_migrations", "kv_store_9bf79e4a", "site_settings", "category_tidy_runs"]);
// how rows that already exist in the target database are found again (their ids can differ there)
const NATURAL = {
  categories: "slug",
  users: "email",
  attribute_definitions: "key",
  brands: "name",
  companies: "slug",
};
const ASSET = "https://demo-assets.invalid/demo";

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async (sql, p) => (await db.query(sql, p)).rows;
  const tables = (await q(`SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`)).map((r) => r.t).filter((t) => !SKIP.has(t) && !t.startsWith("_"));
  const cols = {};
  for (const r of await q(`SELECT c.relname AS t, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type, a.attnum
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' ORDER BY a.attnum`)) {
    (cols[r.t] ||= []).push({ name: r.col, type: r.type });
  }
  const fks = await q(`SELECT tc.table_name AS t, kcu.column_name AS col, ccu.table_name AS ref, ccu.column_name AS refcol
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);
  const fkOf = (t) => fks.filter((f) => f.t === t);

  const out = { version: 1, base: BASE, generated_at: new Date().toISOString(), tables: [], refs: {} };
  const refsWanted = {};
  let total = 0;
  for (const t of tables) {
    const hasId = cols[t].some((c) => c.name === "id");
    const links = fkOf(t);
    let where;
    if (hasId) where = `id >= ${BASE}`;
    else if (links.length) where = links.map((f) => `"${f.col}" >= ${BASE}`).join(" OR ");
    else continue;
    const list = cols[t];
    const rows = await q(`SELECT json_build_array(${list.map((c) => `"${c.name}"::text`).join(", ")}) AS r FROM "${t}" WHERE ${where} ORDER BY ${hasId ? "id" : list.map((c) => `"${c.name}"::text`).slice(0, 2).join(", ")}`);
    if (!rows.length) continue;
    const data = rows.map((x) => x.r.map((v) => (typeof v === "string" && v.includes(ASSET) ? v.split(ASSET).join("{{DEMO_ASSETS}}") : v)));
    // references to rows that were already there
    for (const f of links) {
      const i = list.findIndex((c) => c.name === f.col);
      for (const r of data) if (r[i] !== null && Number(r[i]) < BASE) (refsWanted[f.ref] ||= new Set()).add(r[i]);
    }
    out.tables.push({ name: t, columns: list, rows: data });
    total += data.length;
  }
  for (const [t, ids] of Object.entries(refsWanted)) {
    if (t === "attribute_options") {
      const rows = await q(`SELECT o.id::text, a.key, o.value FROM attribute_options o JOIN attribute_definitions a ON a.id = o.attribute_id WHERE o.id = ANY($1::bigint[])`, [[...ids]]);
      out.refs[t] = Object.fromEntries(rows.map((r) => [r.id, { key: r.key, value: r.value }]));
      continue;
    }
    const key = NATURAL[t];
    if (!key) throw new Error(`demo rows point at existing ${t} rows (${[...ids].slice(0, 5).join(", ")}); add a natural key for ${t}`);
    const rows = await q(`SELECT id::text, "${key}" AS k${t === "users" ? ", role" : ""} FROM "${t}" WHERE id = ANY($1::bigint[])`, [[...ids]]);
    out.refs[t] = Object.fromEntries(rows.map((r) => [r.id, t === "users" ? { email: r.k, role: r.role } : r.k]));
  }
  const file = path.join(__dirname, "data", "demo-data.json.gz");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 }));
  console.log(`${total} rows in ${out.tables.length} tables -> ${file} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
  for (const t of out.tables.sort((a, b) => b.rows.length - a.rows.length)) console.log(`  ${t.name.padEnd(28)} ${t.rows.length}`);
  console.log("existing rows referenced:", Object.fromEntries(Object.entries(out.refs).map(([k, v]) => [k, Object.keys(v).length])));
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
