// What a customer currently owes one company (used for credit limits).
//   = open invoice balances
//   + on-account orders that haven't been invoiced yet (and aren't cancelled)
const prisma = require("../prisma");
const { round2 } = require("./money");

const outstandingFor = async (db, companyId, userId) => {
  const [inv] = await db.$queryRaw`
    SELECT COALESCE(SUM(total_amount - amount_paid - amount_credited), 0)::float AS balance
    FROM invoices
    WHERE company_id = ${BigInt(companyId)} AND user_id = ${BigInt(userId)} AND status IN ('issued', 'partially_paid')`;
  const [ord] = await db.$queryRaw`
    SELECT COALESCE(SUM(o.total_amount), 0)::float AS pending
    FROM orders o
    WHERE o.company_id = ${BigInt(companyId)} AND o.user_id = ${BigInt(userId)}
      AND o.payment_method = 'on_account' AND COALESCE(o.status, 'pending') <> 'cancelled'
      AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status <> 'void')`;
  return round2(Number(inv.balance) + Number(ord.pending));
};

module.exports = { outstandingFor, prisma };
