// Applies the additive SQL files in prisma/sql/ in order, each exactly once, each in a transaction.
//   npm run db:migrate            -> apply pending files
//   npm run db:migrate -- --dry   -> only list what would run
// Applied files are recorded in the table _app_migrations (with a checksum).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { connect } = require("./_pg");

const DIR = path.join(__dirname, "..", "prisma", "sql");
const dry = process.argv.includes("--dry");

(async () => {
  const db = await connect();
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS _app_migrations (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const applied = new Map(
      (await db.query("SELECT name, checksum FROM _app_migrations")).rows.map((r) => [r.name, r.checksum]),
    );

    const files = fs.readdirSync(DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    let ran = 0;
    for (const file of files) {
      const sql = fs.readFileSync(path.join(DIR, file), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      if (applied.has(file)) {
        if (applied.get(file) !== checksum) {
          console.warn(`! ${file} was changed after it was applied (ignored). Put changes in a new file.`);
        }
        continue;
      }
      if (dry) {
        console.log(`would apply ${file}`);
        continue;
      }
      process.stdout.write(`applying ${file} ... `);
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query("INSERT INTO _app_migrations (name, checksum) VALUES ($1, $2)", [file, checksum]);
        await db.query("COMMIT");
        console.log("ok");
        ran++;
      } catch (err) {
        await db.query("ROLLBACK");
        console.log("FAILED (rolled back, nothing changed)");
        throw err;
      }
    }
    console.log(dry ? "dry run done" : ran ? `${ran} migration(s) applied` : "database is up to date");
    if (!dry && ran) console.log("Next: npx prisma generate (or restart `npm run dev`).");
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
