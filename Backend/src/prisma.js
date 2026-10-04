// The one and only PrismaClient for the whole app.
const { PrismaClient, Prisma } = require("@prisma/client");
const { isProd } = require("./config");

/** @type {PrismaClient} */
const prisma =
  /** @type {any} */ (global).__prisma ||
  new PrismaClient({ log: isProd ? ["error"] : ["warn", "error"] });
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
