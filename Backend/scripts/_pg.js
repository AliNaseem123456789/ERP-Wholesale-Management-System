require("dotenv").config();
const { Client } = require("pg");

const connect = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const client = new Client({
    connectionString: url,
    ssl: isLocal || /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
};

module.exports = { connect };
