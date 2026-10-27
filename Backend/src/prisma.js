// The one and only PrismaClient for the whole app.
const { PrismaClient, Prisma } = require("@prisma/client");
const { isProd } = require("./config");

const { trackQuery } = require("./lib/requestTiming");

// Every query (models and raw SQL, inside transactions too) is timed for the request that made it.
const create = () =>
  new PrismaClient({
    log: isProd ? ["error"] : ["warn", "error"],
    // Prisma's defaults (wait 2 s for a connection, 5 s per transaction) are too tight when the database is far
    // away: at 200 ms a round trip, a 9-step product save already takes 5 s. These only matter if work is slow.
    transactionOptions: { maxWait: 10000, timeout: 30000 },
  }).$extends({
    query: { $allOperations: ({ args, query }) => trackQuery(() => query(args)) },
  });

/** @type {PrismaClient} */
const prisma = /** @type {any} */ (global).__prisma || create();
if (!isProd) global.__prisma = prisma;

// Keep JSON responses identical to what the old Supabase client returned:
// bigint ids and numeric/decimal columns come back as plain JS numbers.
BigInt.prototype.toJSON = function () {
  const n = Number(this);
  return Number.isSafeInteger(n) ? n : this.toString();
};
Prisma.Decimal.prototype.toJSON = function () {
  return this.toNumber();
};

module.exports = prisma;
