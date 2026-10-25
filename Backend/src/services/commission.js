// Platform commission. Each order keeps the company's commission rate from when it was placed (a database trigger
// copies it). A statement groups a company's delivered orders of a period that aren't on a statement yet:
//   commissionable amount = order subtotal - order discount - credit notes issued for that order (returns)
//   commission            = commissionable amount x the order's rate
// Shipping and tax are not commissioned. Buyers pay sellers directly, so a statement is what the seller owes the platform;
// a platform admin marks it paid (with a reference) or voids it (its orders become billable again).
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");
const { num, round2 } = require("./money");

const dateOnly = (v, label) => {
  const s = String(v || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, `${label} must be a date (YYYY-MM-DD)`);
  return new Date(`${s}T00:00:00Z`);
};
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Billable orders of a company (delivered, not on a statement), optionally within [from, to] (order dates, inclusive). */
const billableOrders = async (db, companyId, from = null, to = null) => {
  const cid = BigInt(companyId);
  const company = await db.companies.findUnique({ where: { id: cid }, select: { commission_rate: true } });
  const orders = await db.orders.findMany({
    where: {
      company_id: cid, status: "delivered", commission_statement_id: null,
      ...(from || to ? { created_at: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86400000) } : {}) } } : {}),
    },
    select: { id: true, order_number: true, created_at: true, subtotal_amount: true, discount_amount: true, total_amount: true, shipping_amount: true, tax_amount: true, commission_rate: true },
    orderBy: { created_at: "asc" },
  });
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  // credit notes for these orders, through their invoices or their returns
  const credits = await db.$queryRaw`
    SELECT coalesce(i.order_id, r.order_id) AS order_id, sum(cn.subtotal)::float AS amount
    FROM credit_notes cn
    LEFT JOIN invoices i ON i.id = cn.invoice_id
    LEFT JOIN return_requests r ON r.id = cn.return_id
    WHERE cn.company_id = ${cid} AND cn.status <> 'void' AND coalesce(i.order_id, r.order_id) = ANY(${ids})
    GROUP BY 1`;
  const credited = new Map(credits.map((c) => [String(c.order_id), num(c.amount)]));
  return orders.map((o) => {
    // orders from before subtotals were stored: total minus shipping and tax
    const subtotal = o.subtotal_amount !== null ? num(o.subtotal_amount) : num(o.total_amount) - num(o.shipping_amount) - num(o.tax_amount) + num(o.discount_amount);
    const base = Math.max(0, round2(subtotal - num(o.discount_amount) - (credited.get(String(o.id)) || 0)));
    const rate = o.commission_rate !== null ? num(o.commission_rate) : num(company?.commission_rate);
    return { id: o.id, order_number: o.order_number, created_at: o.created_at, sales: base, credited: round2(credited.get(String(o.id)) || 0), rate, commission: round2((base * rate) / 100) };
  });
};

const summarize = (rows) => ({
  order_count: rows.length,
  sales_amount: round2(rows.reduce((s, r) => s + r.sales, 0)),
  commission_amount: round2(rows.reduce((s, r) => s + r.commission, 0)),
});

/** Admin overview: per active company, what isn't billed yet. */
const unbilledByCompany = async () => {
  const companies = await prisma.companies.findMany({ where: { status: { in: ["active", "suspended"] } }, select: { id: true, name: true, slug: true, commission_rate: true }, orderBy: { name: "asc" } });
  const out = [];
  for (const c of companies) {
    const rows = await billableOrders(prisma, c.id);
    const last = await prisma.commission_statements.findFirst({ where: { company_id: c.id, status: { not: "void" } }, orderBy: { period_end: "desc" }, select: { period_end: true } });
    const open = await prisma.commission_statements.aggregate({ where: { company_id: c.id, status: "issued" }, _sum: { commission_amount: true }, _count: true });
    out.push({
      company: { id: c.id, name: c.name, slug: c.slug }, rate: num(c.commission_rate), ...summarize(rows),
      first_order: rows[0] ? iso(rows[0].created_at) : null, last_order: rows.length ? iso(rows[rows.length - 1].created_at) : null,
      last_period_end: iso(last?.period_end), outstanding: round2(num(open._sum.commission_amount)), outstanding_count: open._count,
    });
  }
  return out;
};

/** Creates a statement for a company's billable orders in [period_start, period_end]. */
const createStatement = async ({ companyId, periodStart, periodEnd, notes, userId }) => {
  const from = dateOnly(periodStart, "Period start");
  const to = dateOnly(periodEnd, "Period end");
  if (to < from) throw new HttpError(400, "The period ends before it starts");
  if (to >= new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z")) throw new HttpError(400, "The period must end before today");
  return prisma.$transaction(async (tx) => {
    // one statement at a time per company
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('commission'), ${Number(companyId)}::int)`;
    const rows = await billableOrders(tx, companyId, from, to);
    if (!rows.length) throw new HttpError(400, "No delivered orders to bill in this period");
    const sum = summarize(rows);
    const count = await tx.commission_statements.count({ where: { company_id: BigInt(companyId) } });
    const st = await tx.commission_statements.create({
      data: {
        company_id: BigInt(companyId), statement_number: `CS-${iso(to).slice(0, 7).replace("-", "")}-${companyId}-${count + 1}`,
        period_start: from, period_end: to, ...sum, notes: notes ? String(notes).slice(0, 2000) : null, created_by: userId ? BigInt(userId) : null,
      },
    });
    for (const r of rows) await tx.orders.update({ where: { id: r.id }, data: { commission_statement_id: st.id, commission_amount: r.commission, commission_rate: r.rate } });
    return st;
  }, { timeout: 60000, maxWait: 10000 });
};

/** Statement with its orders (for admins, or for the company itself). */
const statementDetail = async (id, companyId = null) => {
  const st = await prisma.commission_statements.findFirst({ where: { id: BigInt(id), ...(companyId ? { company_id: BigInt(companyId) } : {}) } });
  if (!st) throw new HttpError(404, "Statement not found");
  const company = await prisma.companies.findUnique({ where: { id: st.company_id }, select: { id: true, name: true, slug: true } });
  const orders = await prisma.orders.findMany({
    where: { commission_statement_id: st.id }, orderBy: { created_at: "asc" },
    select: { id: true, order_number: true, created_at: true, subtotal_amount: true, discount_amount: true, total_amount: true, commission_rate: true, commission_amount: true },
  });
  return { ...st, period_start: iso(st.period_start), period_end: iso(st.period_end), company, orders };
};

const setStatus = async ({ id, status, reference, notes }) => {
  const st = await prisma.commission_statements.findUnique({ where: { id: BigInt(id) } });
  if (!st) throw new HttpError(404, "Statement not found");
  if (st.status === "void") throw new HttpError(400, "This statement was voided");
  if (status === "paid") {
    return prisma.commission_statements.update({ where: { id: st.id }, data: { status: "paid", paid_at: new Date(), payment_reference: reference ? String(reference).slice(0, 120) : null, ...(notes !== undefined ? { notes } : {}), updated_at: new Date() } });
  }
  if (status === "issued") {
    if (st.status !== "paid") throw new HttpError(400, "Only a paid statement can be marked unpaid");
    return prisma.commission_statements.update({ where: { id: st.id }, data: { status: "issued", paid_at: null, payment_reference: null, updated_at: new Date() } });
  }
  if (status === "void") {
    if (st.status === "paid") throw new HttpError(400, "Mark it unpaid before voiding it");
    return prisma.$transaction(async (tx) => {
      await tx.orders.updateMany({ where: { commission_statement_id: st.id }, data: { commission_statement_id: null, commission_amount: null } });
      return tx.commission_statements.update({ where: { id: st.id }, data: { status: "void", updated_at: new Date() } });
    });
  }
  throw new HttpError(400, "Status must be paid, issued or void");
};

const shape = (s) => ({ ...s, period_start: iso(s.period_start), period_end: iso(s.period_end), sales_amount: num(s.sales_amount), commission_amount: num(s.commission_amount) });

module.exports = { billableOrders, summarize, unbilledByCompany, createStatement, statementDetail, setStatus, shape };
