require("dotenv").config();
const { Client } = require("pg");

// Connects the maintenance scripts (migrations, exports, demo data...) to DATABASE_URL.
// Settings meant for Prisma or libpq (sslmode, sslaccept, pgbouncer, connection_limit...) are taken out of the
// address: the pg library would otherwise insist on verifying the server certificate, which fails on Amazon RDS
// and Supabase. Remote databases are always reached over TLS; local ones (and sslmode=disable) without.
const connect = async () => {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const url = new URL(raw);
  const noTls = /^(localhost|127\.0\.0\.1)$/.test(url.hostname) || url.searchParams.get("sslmode") === "disable";
  for (const k of [...url.searchParams.keys()]) url.searchParams.delete(k);
  const client = new Client({ connectionString: url.toString(), ssl: noTls ? false : { rejectUnauthorized: false } });
  await client.connect();
  return client;
};

module.exports = { connect };
