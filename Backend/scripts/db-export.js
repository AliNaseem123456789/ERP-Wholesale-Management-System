// Exports every table in the public schema to JSON files: backups/db-export-<timestamp>/<table>.json
// Read-only. Run it before migrations:  npm run db:export
const fs = require("fs");
const path = require("path");
const { connect } = require("./_pg");

(async () => {
  const db = await connect();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(__dirname, "..", "backups", `db-export-${stamp}`);
  fs.mkdirSync(out, { recursive: true });
  try {
    const { rows: tables } = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1",
    );
    let total = 0;
    for (const { table_name } of tables) {
      const { rows } = await db.query(`SELECT * FROM "${table_name}"`);
      fs.writeFileSync(path.join(out, `${table_name}.json`), JSON.stringify(rows, null, 1));
      console.log(`${table_name.padEnd(28)} ${rows.length} rows`);
      total += rows.length;
    }
    console.log(`\nExported ${tables.length} tables (${total} rows) to ${out}`);
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
