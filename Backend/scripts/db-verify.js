// Data-safety check for migrations. Read-only.
//   npm run db:verify -- snapshot before.json   -> fingerprints every table (row count + hash of every column)
//   npm run db:verify -- compare  before.json   -> re-checks the same tables and columns and reports anything that changed
// Columns or tables added later are ignored, so an additive migration must report "no existing data changed".
// Also prints business totals (stock, orders, invoices, ledger balance) so they can be compared by eye.
const fs = require("fs");
const { connect } = require("./_pg");

const [mode, file] = process.argv.slice(2);
if (!["snapshot", "compare"].includes(mode) || !file) {
  console.error("usage: node scripts/db-verify.js snapshot|compare <file.json>");
  process.exit(1);
}

const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

const fingerprint = async (db, table, columns) => {
  const { rows: pk } = await db.query(
    `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY a.attnum`,
    [q(table)],
  );
  const order = (pk.length ? pk.map((r) => q(r.attname)) : columns.map(q)).join(", ");
  const row = `json_build_array(${columns.map(q).join(", ")})::text`;
  const { rows } = await db.query(
    `SELECT count(*)::int AS n, md5(coalesce(string_agg(${row}, E'\\n' ORDER BY ${order}), '')) AS h FROM ${q(table)}`,
  );
  return { count: rows[0].n, hash: rows[0].h };
};

const totals = async (db) => {
  const one = async (sql) => {
    try {
      return (await db.query(sql)).rows[0];
    } catch {
      return null;
    }
  };
  return {
    stock: await one("SELECT coalesce(sum(on_hand),0)::bigint AS on_hand, coalesce(sum(reserved),0)::bigint AS reserved FROM inventory_levels"),
    lots: await one("SELECT coalesce(sum(quantity),0)::bigint AS qty, coalesce(sum(quantity*coalesce(unit_cost,0)),0)::numeric(38,2) AS value FROM inventory_lots"),
    movements: await one("SELECT count(*)::int AS n, coalesce(sum(quantity),0)::bigint AS qty FROM stock_movements"),
    orders: await one("SELECT count(*)::int AS n, coalesce(sum(total_amount),0)::numeric(38,2) AS total FROM orders"),
    order_lines: await one("SELECT count(*)::int AS n, coalesce(sum(quantity*price_at_time),0)::numeric(38,2) AS value FROM order_items"),
    invoices: await one("SELECT count(*)::int AS n, coalesce(sum(total_amount),0)::numeric(38,2) AS total FROM invoices"),
    ledger: await one("SELECT coalesce(sum(debit),0)::numeric(38,2) AS debit, coalesce(sum(credit),0)::numeric(38,2) AS credit FROM journal_lines"),
    products: await one("SELECT count(*)::int AS n, count(*) FILTER (WHERE is_active)::int AS active, coalesce(sum(price),0)::numeric(38,2) AS price_sum FROM products"),
  };
};

(async () => {
  const db = await connect();
  try {
    if (mode === "snapshot") {
      const { rows } = await db.query(
        `SELECT c.table_name, array_agg(c.column_name::text ORDER BY c.ordinal_position) AS cols
         FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
         WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' GROUP BY c.table_name ORDER BY 1`,
      );
      const out = { taken_at: new Date().toISOString(), tables: {}, totals: await totals(db) };
      for (const r of rows) out.tables[r.table_name] = { columns: r.cols, ...(await fingerprint(db, r.table_name, r.cols)) };
      fs.writeFileSync(file, JSON.stringify(out, null, 1));
      const n = Object.values(out.tables).reduce((s, t) => s + t.count, 0);
      console.log(`Snapshot of ${rows.length} tables (${n} rows) written to ${file}`);
      console.log(JSON.stringify(out.totals));
      return;
    }
    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    const problems = [];
    let checked = 0;
    for (const [table, t] of Object.entries(before.tables)) {
      const { rows } = await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
        [table],
      );
      const now = new Set(rows.map((r) => r.column_name));
      if (!now.size) {
        problems.push(`${table}: table is missing`);
        continue;
      }
      const missing = t.columns.filter((c) => !now.has(c));
      if (missing.length) problems.push(`${table}: column(s) missing: ${missing.join(", ")}`);
      const f = await fingerprint(db, table, t.columns.filter((c) => now.has(c)));
      if (f.count !== t.count) problems.push(`${table}: ${t.count} rows before, ${f.count} now`);
      else if (!missing.length && f.hash !== t.hash) problems.push(`${table}: existing values changed (same row count)`);
      checked++;
    }
    const after = await totals(db);
    console.log("totals before:", JSON.stringify(before.totals));
    console.log("totals now:   ", JSON.stringify(after));
    if (problems.length) {
      console.log(`\n${problems.length} difference(s):\n - ${problems.join("\n - ")}`);
      process.exitCode = 2;
    } else {
      console.log(`\nOK: ${checked} tables checked, no existing data changed.`);
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
