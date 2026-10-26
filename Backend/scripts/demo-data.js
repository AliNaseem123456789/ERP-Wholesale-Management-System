// Demo marketplace: adds (or removes) a complete, invented marketplace you can show people.
//
//   10 new categories (Snacks & Beverages, Health & Beauty, Household, Phone & Electronics, Health & Wellness,
//   Automotive, Apparel, Office & School, Pet Supplies, Toys & Party) with 45 sub-categories, 11 sellers,
//   266 products (143 variants) with pictures, 45 buyer businesses, and a year of activity: about 2,000 orders,
//   invoices, payments, quotes, RFQs, returns, reviews, purchasing, stock, accounting, HR, attendance, leave and
//   monthly payroll. Showcase seller: Meridian Trade Co. (15 staff). Showcase buyer: Corner Market & Deli.
//
//   npm run demo:data                 -> preview only: checks everything, changes nothing
//   npm run demo:data -- --apply      -> adds the demo (one transaction: all or nothing)
//   npm run demo:data -- --undo       -> removes every demo row again (and anything created on demo accounts later)
//   npm run demo:data -- --reset      -> undo + apply (puts the demo back the way it was, e.g. after visitors used it)
//
// Your own data is never changed: demo rows use ids from 5,000,000 up, so they can always be told apart.
// Pictures are uploaded to your Supabase storage (site-assets/demo/...); without Supabase they are copied to
// Frontend/public/demo and served by the website.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { connect } = require("./_pg");

const MODE = process.argv.includes("--reset") ? "reset" : process.argv.includes("--apply") ? "apply" : process.argv.includes("--undo") ? "undo" : "preview";
const BASE = 5000000;
const DATA = path.join(__dirname, "demo", "data", "demo-data.json.gz");
const IMAGES = path.join(__dirname, "demo", "images"); // made by render-images.js (developer tool)
const IMAGE_PACK = path.join(__dirname, "demo", "data", "images.pack.gz"); // the same pictures in one file
const LOGINS = [
  ["Seller (Meridian Trade Co., owner)", "demo@meridian-trade.example.com"],
  ["Buyer (Corner Market & Deli)", "demo@corner-market.example.com"],
  ["Seller staff: manager", "priya.shah@meridian-trade.example.com"],
  ["Seller staff: accountant", "marcus.bell@meridian-trade.example.com"],
  ["Seller staff: HR & payroll", "olivia.grant@meridian-trade.example.com"],
  ["Seller staff: warehouse", "ethan.cole@meridian-trade.example.com"],
  ["Seller staff: sales", "sofia.martinez@meridian-trade.example.com"],
];
const PASSWORD = "DemoPass2026!";
const REQUIRED_MIGRATIONS = 13;

const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;

// ------------------------------------------------------------------------------------------------ schema helpers
const loadSchema = async (db) => {
  const q = async (sql, p) => (await db.query(sql, p)).rows;
  const cols = {};
  for (const r of await q(`SELECT c.relname AS t, a.attname AS col, a.attnotnull AS notnull, format_type(a.atttypid, a.atttypmod) AS type
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`)) (cols[r.t] ||= {})[r.col] = r;
  const fks = await q(`SELECT tc.table_name AS t, kcu.column_name AS col, ccu.table_name AS ref, rc.delete_rule AS rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);
  return { cols, fks };
};

// parents before children; a nullable foreign key that closes a loop is filled in afterwards
const insertOrder = (names, fks, cols) => {
  const set = new Set(names);
  const edges = fks.filter((f) => set.has(f.t) && set.has(f.ref) && f.t !== f.ref);
  const order = [];
  const deferred = [];
  const left = new Set(names);
  while (left.size) {
    const ready = [...left].filter((t) => !edges.some((e) => e.t === t && left.has(e.ref) && !deferred.includes(e)));
    if (ready.length) { ready.sort(); for (const t of ready) { order.push(t); left.delete(t); } continue; }
    const loop = edges.find((e) => left.has(e.t) && left.has(e.ref) && !deferred.includes(e) && !cols[e.t][e.col].notnull);
    if (!loop) throw new Error(`Can't order the demo tables (${[...left].join(", ")})`);
    deferred.push(loop);
  }
  return { order, deferred };
};

// ------------------------------------------------------------------------------------------------ undo
/** Every row to remove: demo ids, plus rows that would block their removal (created on demo accounts later). */
const removalPlan = async (db, { cols, fks }) => {
  const tables = Object.keys(cols).filter((t) => !t.startsWith("_") && !["site_settings", "kv_store_9bf79e4a"].includes(t));
  await db.query("CREATE TEMP TABLE IF NOT EXISTS _demo_del (t text NOT NULL, id bigint NOT NULL, PRIMARY KEY (t, id)) ON COMMIT DROP");
  for (const t of tables) if (cols[t].id) await db.query(`INSERT INTO _demo_del SELECT $1, id FROM ${quote(t)} WHERE id >= ${BASE} ON CONFLICT DO NOTHING`, [t]);
  // rows the app made later that name a demo account or record without a database link
  // (notifications, queued emails, scheduled report runs, audit entries, analytics...)
  for (const t of tables) {
    if (!cols[t].id) continue;
    const loose = Object.values(cols[t]).filter((c) => c.col !== "id" && c.type === "bigint" && /(_id|_by)$/.test(c.col) && !fks.some((f) => f.t === t && f.col === c.col));
    if (loose.length) await db.query(`INSERT INTO _demo_del SELECT $1, id FROM ${quote(t)} WHERE ${loose.map((c) => `${quote(c.col)} >= ${BASE}`).join(" OR ")} ON CONFLICT DO NOTHING`, [t]);
  }
  if (cols.email_outbox?.to_email) await db.query(`INSERT INTO _demo_del SELECT 'email_outbox', id FROM email_outbox WHERE lower(to_email) IN (SELECT lower(email) FROM users WHERE id >= ${BASE}) ON CONFLICT DO NOTHING`);
  // follow CASCADE / RESTRICT links (SET NULL links are left to the database)
  for (let round = 0; round < 12; round++) {
    let added = 0;
    for (const f of fks) {
      if (f.rule === "SET NULL" || f.rule === "SET DEFAULT" || !cols[f.t]?.id) continue;
      const r = await db.query(`INSERT INTO _demo_del SELECT $1, c.id FROM ${quote(f.t)} c JOIN _demo_del d ON d.t = $2 AND d.id = c.${quote(f.col)} ON CONFLICT DO NOTHING`, [f.t, f.ref]);
      added += r.rowCount;
    }
    if (!added) break;
  }
  const counts = (await db.query(`SELECT t, count(*)::int AS n, count(*) FILTER (WHERE id < ${BASE})::int AS later FROM _demo_del GROUP BY t ORDER BY 2 DESC`)).rows;
  return { tables, counts };
};

const removeAll = async (db, schema) => {
  const { tables } = await removalPlan(db, schema);
  const { fks, cols } = schema;
  // link tables without an id: rows pointing at anything being removed
  for (const t of tables.filter((x) => !cols[x].id)) {
    const links = fks.filter((f) => f.t === t);
    if (!links.length) continue;
    await db.query(`DELETE FROM ${quote(t)} x WHERE ${links.map((f) => `EXISTS (SELECT 1 FROM _demo_del d WHERE d.t = '${f.ref}' AND d.id = x.${quote(f.col)})`).join(" OR ")}`);
  }
  // children first
  const withRows = (await db.query("SELECT DISTINCT t FROM _demo_del")).rows.map((r) => r.t);
  const blocking = fks.filter((f) => f.rule !== "SET NULL");
  const { order, deferred } = insertOrder(withRows, blocking, cols);
  // break only the links that close a loop, and self references, inside the rows being removed
  const breakers = [...deferred, ...blocking.filter((f) => f.t === f.ref && withRows.includes(f.t) && !cols[f.t][f.col].notnull)];
  for (const f of breakers) {
    await db.query(`UPDATE ${quote(f.t)} x SET ${quote(f.col)} = NULL FROM _demo_del d WHERE d.t = $1 AND d.id = x.id AND x.${quote(f.col)} IN (SELECT id FROM _demo_del WHERE t = $2)`, [f.t, f.ref]);
  }
  let n = 0;
  for (const t of order.reverse()) {
    const r = await db.query(`DELETE FROM ${quote(t)} x USING _demo_del d WHERE d.t = $1 AND d.id = x.id`, [t]);
    n += r.rowCount;
  }
  return n;
};

// ------------------------------------------------------------------------------------------------ apply
const readData = () => {
  if (!fs.existsSync(DATA)) throw new Error(`Missing ${DATA}`);
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(DATA)).toString("utf8"));
};

/** Ids of rows the demo points at that already exist (found again by slug / email / key). */
const resolveRefs = async (db, refs) => {
  const map = {};
  const problems = [];
  for (const [t, byId] of Object.entries(refs)) {
    map[t] = {};
    for (const [oldId, key] of Object.entries(byId)) {
      let rows;
      if (t === "users") {
        rows = (await db.query("SELECT id FROM users WHERE lower(email) = lower($1)", [key.email])).rows;
        if (!rows.length && key.role === "ADMIN") rows = (await db.query("SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id LIMIT 1")).rows;
      } else if (t === "attribute_options") {
        rows = (await db.query("SELECT o.id FROM attribute_options o JOIN attribute_definitions a ON a.id = o.attribute_id WHERE a.key = $1 AND a.company_id IS NULL AND lower(o.value) = lower($2)", [key.key, key.value])).rows;
      } else if (t === "attribute_definitions") {
        rows = (await db.query("SELECT id FROM attribute_definitions WHERE key = $1 AND company_id IS NULL", [key])).rows;
      } else if (t === "brands") {
        rows = (await db.query("SELECT id FROM brands WHERE lower(name) = lower($1) ORDER BY id LIMIT 1", [key])).rows;
      } else {
        rows = (await db.query(`SELECT id FROM ${quote(t)} WHERE slug = $1`, [key])).rows;
      }
      if (rows.length) map[t][oldId] = String(rows[0].id);
      else problems.push(`${t} "${typeof key === "object" ? Object.values(key).join(" / ") : key}"`);
    }
  }
  return { map, problems };
};

const collisions = async (db, data) => {
  const out = [];
  const t = (name) => data.tables.find((x) => x.name === name);
  const col = (tab, c) => tab.columns.findIndex((x) => x.name === c);
  const check = async (name, column, sql, label) => {
    const tab = t(name);
    if (!tab) return;
    const vals = tab.rows.map((r) => r[col(tab, column)]).filter(Boolean);
    const rows = (await db.query(sql, [vals])).rows;
    for (const r of rows) out.push(`${label} "${r.v}" is already used`);
  };
  await check("users", "email", "SELECT email AS v FROM users WHERE id < 5000000 AND lower(email) = ANY(SELECT lower(x) FROM unnest($1::text[]) x)", "Email");
  await check("companies", "slug", "SELECT slug AS v FROM companies WHERE id < 5000000 AND slug = ANY($1::text[])", "Company address");
  await check("categories", "slug", "SELECT slug AS v FROM categories WHERE id < 5000000 AND slug = ANY($1::text[])", "Category address");
  await check("products", "slug", "SELECT slug AS v FROM products WHERE id < 5000000 AND slug = ANY($1::text[])", "Product address");
  await check("brands", "slug", "SELECT slug AS v FROM brands WHERE id < 5000000 AND slug = ANY($1::text[])", "Brand address");
  return out;
};

/** Every demo picture as [relative path, bytes]: from the packed file, or else the rendered folder. */
const readImages = () => {
  if (fs.existsSync(IMAGE_PACK)) return Object.entries(JSON.parse(zlib.gunzipSync(fs.readFileSync(IMAGE_PACK)).toString("utf8"))).map(([rel, b64]) => [rel, Buffer.from(b64, "base64")]);
  if (fs.existsSync(IMAGES)) {
    const out = [];
    const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else out.push([path.relative(IMAGES, p).split(path.sep).join("/"), fs.readFileSync(p)]); } };
    walk(IMAGES);
    return out;
  }
  return [];
};

const uploadImages = async () => {
  const files = readImages();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const { createClient } = require("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false } });
    let done = 0;
    const queue = [...files];
    const worker = async () => {
      while (queue.length) {
        const [rel, bytes] = queue.shift();
        const { error } = await sb.storage.from("site-assets").upload(`demo/${rel}`, bytes, { contentType: rel.endsWith(".png") ? "image/png" : "image/jpeg", upsert: true, cacheControl: "604800" });
        if (error) throw new Error(`Uploading ${rel}: ${error.message}`);
        if (++done % 50 === 0) process.stdout.write(`  ${done}/${files.length} pictures\n`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { prefix: sb.storage.from("site-assets").getPublicUrl("demo").data.publicUrl.replace(/\/$/, ""), where: `Supabase storage (site-assets/demo, ${files.length} files)` };
  }
  const target = path.join(__dirname, "..", "..", "Frontend", "public", "demo");
  for (const [rel, bytes] of files) {
    const dest = path.join(target, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
  }
  const site = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
  return { prefix: `${site}/demo`, where: `Frontend/public/demo (served at ${site}/demo; set SUPABASE_URL to upload them instead)` };
};

const insertAll = async (db, data, schema, refMap, assetPrefix) => {
  const { cols, fks } = schema;
  const names = data.tables.map((t) => t.name);
  const { order, deferred } = insertOrder(names, fks, cols);
  let n = 0;
  const later = [];
  for (const name of order) {
    const tab = data.tables.find((t) => t.name === name);
    const columns = tab.columns.filter((c) => cols[name][c.name]);
    const idx = columns.map((c) => tab.columns.findIndex((x) => x.name === c.name));
    // foreign keys to rows that existed before: use their ids in this database
    const remap = columns.map((c) => {
      const f = fks.find((x) => x.t === name && x.col === c.name);
      return f ? (v) => (v === null || Number(v) >= BASE ? v : refMap[f.ref]?.[v] ?? v) : null;
    });
    const deferCols = new Set(deferred.filter((d) => d.t === name).map((d) => d.col));
    const rows = tab.rows.map((r) => idx.map((i, k) => {
      let v = r[i];
      if (typeof v === "string" && v.includes("{{DEMO_ASSETS}}")) v = v.split("{{DEMO_ASSETS}}").join(assetPrefix);
      if (remap[k]) v = remap[k](v);
      return v;
    }));
    for (const c of deferCols) {
      const k = columns.findIndex((x) => x.name === c);
      for (const r of rows) if (r[k] !== null) { later.push({ table: name, col: c, id: r[columns.findIndex((x) => x.name === "id")], value: r[k] }); r[k] = null; }
    }
    const per = Math.max(1, Math.min(500, Math.floor(30000 / columns.length)));
    for (let i = 0; i < rows.length; i += per) {
      const chunk = rows.slice(i, i + per);
      const params = [];
      const values = chunk.map((r) => `(${r.map((v, k) => { params.push(v); return `$${params.length}::${columns[k].type}`; }).join(", ")})`).join(", ");
      await db.query(`INSERT INTO ${quote(name)} (${columns.map((c) => quote(c.name)).join(", ")}) VALUES ${values}`, params);
      n += chunk.length;
    }
    process.stdout.write(`  ${name.padEnd(28)} ${rows.length}\n`);
  }
  for (const l of later) await db.query(`UPDATE ${quote(l.table)} SET ${quote(l.col)} = $1 WHERE id = $2`, [l.value, l.id]);
  return n;
};

// ------------------------------------------------------------------------------------------------ main
(async () => {
  const db = await connect();
  try {
    const migrations = (await db.query("SELECT count(*)::int AS n FROM _app_migrations").catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
    const schema = await loadSchema(db);
    const loaded = (await db.query(`SELECT count(*)::int AS n FROM users WHERE id >= ${BASE}`)).rows[0].n;

    let removed = null; // reset: rows removed inside the transaction that also re-adds the demo
    if (MODE === "undo" || (MODE === "preview" && loaded)) {
      await db.query("BEGIN");
      const { counts } = await removalPlan(db, schema);
      const total = counts.reduce((s, c) => s + c.n, 0);
      const later = counts.reduce((s, c) => s + c.later, 0);
      if (MODE === "preview") {
        await db.query("ROLLBACK");
        console.log(`The demo is loaded (${total} rows). --undo would remove them${later ? `, including ${later} rows created later on demo accounts` : ""}:`);
        for (const c of counts.slice(0, 25)) console.log(`  ${c.t.padEnd(28)} ${c.n}${c.later ? ` (${c.later} made after loading)` : ""}`);
        console.log("\nNothing was changed. Use --undo to remove it or --reset to put it back to how it was.");
        return;
      }
      if (!total) { await db.query("ROLLBACK"); console.log("No demo data found."); }
      else {
        const n = await removeAll(db, schema);
        await db.query("COMMIT");
        console.log(`Removed ${n} demo rows${later ? ` (${later} of them were created on demo accounts after loading)` : ""}.`);
      }
      console.log("Restart the backend so cached menus and categories refresh.");
      return;
    }

    // ---- preview / apply
    const data = readData();
    const problems = [];
    if (migrations < REQUIRED_MIGRATIONS) problems.push(`Only ${migrations} of ${REQUIRED_MIGRATIONS} database updates are applied. Run: npm run db:migrate`);
    for (const t of data.tables) {
      if (!schema.cols[t.name]) { problems.push(`Table ${t.name} is missing (run npm run db:migrate)`); continue; }
      for (const c of t.columns) if (!schema.cols[t.name][c.name]) problems.push(`Column ${t.name}.${c.name} is missing (run npm run db:migrate)`);
    }
    if (!problems.length) {
      if (MODE === "reset") {
        // the demo's own addresses and e-mails are about to be removed and re-added, so they don't count as taken
        const { problems: missing } = await resolveRefs(db, data.refs);
        for (const m of missing) problems.push(`The demo uses ${m}, which isn't in this database`);
      }
    }
    if (!problems.length && MODE !== "reset") {
      const { problems: missing } = await resolveRefs(db, data.refs);
      for (const m of missing) problems.push(`The demo uses ${m}, which isn't in this database`);
      problems.push(...(await collisions(db, data)));
    }
    const rows = data.tables.reduce((s, t) => s + t.rows.length, 0);
    const count = (name) => data.tables.find((t) => t.name === name)?.rows.length || 0;
    console.log(`Demo marketplace: ${rows} rows in ${data.tables.length} tables`);
    console.log(`  ${count("companies")} sellers, ${count("users")} people, ${count("products")} products (${count("product_variants")} variants), ${count("categories")} categories`);
    console.log(`  ${count("orders")} orders, ${count("invoices")} invoices, ${count("purchase_orders")} purchase orders, ${count("quotes")} quotes, ${count("return_requests")} returns, ${count("reviews")} reviews`);
    console.log(`  ${count("employees")} employees, ${count("payroll_runs")} payroll runs (${count("payslips")} payslips), ${count("attendance")} attendance days, ${count("journal_entries")} journal entries`);
    if (problems.length) {
      console.log("\nCan't load it yet:");
      for (const p of problems.slice(0, 30)) console.log(`  - ${p}`);
      process.exitCode = 1;
      return;
    }
    if (MODE === "preview") {
      console.log("\nEverything checks out. Nothing was changed. Run with --apply to add it.");
      return;
    }
    console.log("\nPictures...");
    const assets = await uploadImages();
    console.log(`  ${assets.where}`);
    console.log("Adding rows (one transaction)...");
    await db.query("BEGIN");
    try {
      if (MODE === "reset") {
        const { counts } = await removalPlan(db, schema);
        removed = counts.reduce((s, c) => s + c.n, 0) ? await removeAll(db, schema) : 0;
        await db.query("DROP TABLE IF EXISTS _demo_del");
        const clash = await collisions(db, data);
        if (clash.length) throw new Error(clash.slice(0, 5).join("; "));
      }
      const { map } = await resolveRefs(db, data.refs);
      const n = await insertAll(db, data, schema, map, assets.prefix);
      // show the demo's departments on the homepage next to the featured categories already there
      await db.query(`UPDATE categories SET is_featured = true WHERE id >= ${BASE} AND parent_id IS NULL`);
      // the demo was recorded up to a fixed day: move schedules that are already due to their next date ahead
      await db.query(`UPDATE recurring_orders SET next_run_on = CASE
          WHEN frequency = 'monthly' THEN (date_trunc('month', current_date) + make_interval(months => CASE WHEN extract(day FROM current_date) < coalesce(day_of_month, 1) THEN 0 ELSE 1 END, days => coalesce(day_of_month, 1) - 1))::date
          ELSE next_run_on + (ceil((current_date - next_run_on + 1)::numeric / CASE frequency WHEN 'biweekly' THEN 14 ELSE 7 END) * CASE frequency WHEN 'biweekly' THEN 14 ELSE 7 END)::int END
        WHERE id >= ${BASE} AND status = 'active' AND next_run_on <= current_date`);
      await db.query("COMMIT");
      if (removed !== null) console.log(`\nRemoved the old demo (${removed} rows) and added it again.`);
      console.log(`\nAdded ${n} rows. Restart the backend so cached menus and categories refresh.\n`);
      console.log(`Demo log-ins (password for all: ${PASSWORD}):`);
      for (const [who, email] of LOGINS) console.log(`  ${who.padEnd(38)} ${email}`);
      console.log("\nTo remove it again: npm run demo:data -- --undo");
    } catch (e) {
      await db.query("ROLLBACK").catch(() => {});
      throw e;
    }
  } finally {
    await db.end();
  }
})().catch((e) => { console.error(`\nFailed, nothing was changed: ${e.message}`); process.exit(1); });
