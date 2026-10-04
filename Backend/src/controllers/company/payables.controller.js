// Accounts payable (supplier bills, payments, supplier credits, AP aging) and expenses.
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { round2, num } = require("../../services/money");
const ledger = require("../../services/ledger");
const ap = require("../../services/payables");
const { nextNumber } = require("../../services/sequences");

const TX = { timeout: 30000, maxWait: 10000 };
const parseDate = (v, name) => {
  if (v === undefined || v === null || v === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new HttpError(400, `${name} must be a date (YYYY-MM-DD)`);
  return new Date(`${v}T00:00:00Z`);
};
const todayStr = () => new Date().toISOString().slice(0, 10);
const accountSelect = { id: true, code: true, name: true, type: true, subtype: true };

const shapeBill = ({ suppliers, bill_items, bill_payments, vendor_credit_applications, ...b }) => ({
  ...b,
  supplier: suppliers,
  items: bill_items?.map(({ accounts, products, ...i }) => ({ ...i, account: accounts, product: products })),
  payments: bill_payments?.map(({ accounts, ...p }) => ({ ...p, account: accounts })),
  credits: vendor_credit_applications?.map(({ vendor_credits, ...a }) => ({ ...a, credit_number: vendor_credits?.credit_number })),
  balance: b.status === "void" ? 0 : ap.billBalance(b),
  overdue: ap.isOverdue(b),
});

// Bills, supplier credits and expenses live in the books: accounting has to be set up first.
const requireBooks = (req) => {
  if (!ledger.accountingSettings(req.company).enabled) throw new HttpError(400, "Set up accounting first (Accounting > Overview)");
};

const findSupplier = async (req, id) => {
  const s = await prisma.suppliers.findFirst({ where: { id: toId(id, "supplier_id"), company_id: req.company.id } });
  if (!s) throw new HttpError(404, "Supplier not found");
  return s;
};

// GET /company/bills?status=open|overdue|paid|void&supplier_id&search&page
const listBills = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = 25;
  const status = String(req.query.status || "");
  const search = String(req.query.search || "").trim();
  const where = {
    company_id: req.company.id,
    ...(status === "open" ? { status: { in: ["open", "partially_paid"] } } : {}),
    ...(status === "overdue" ? { status: { in: ["open", "partially_paid"] }, due_date: { lt: ap.today() } } : {}),
    ...(["paid", "void"].includes(status) ? { status } : {}),
    ...(req.query.supplier_id ? { supplier_id: toId(req.query.supplier_id, "supplier_id") } : {}),
    ...(search ? { OR: [
      { bill_number: { contains: search, mode: "insensitive" } },
      { supplier_invoice_number: { contains: search, mode: "insensitive" } },
      { suppliers: { is: { name: { contains: search, mode: "insensitive" } } } },
    ] } : {}),
  };
  const t = todayStr();
  const [rows, totalCount, [sums]] = await Promise.all([
    prisma.bills.findMany({ where, orderBy: [{ due_date: "asc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit, include: { suppliers: { select: { id: true, name: true } } } }),
    prisma.bills.count({ where }),
    prisma.$queryRaw`
      SELECT COALESCE(SUM(total_amount - amount_paid - amount_credited) FILTER (WHERE status IN ('open','partially_paid')), 0)::float AS outstanding,
             COALESCE(SUM(total_amount - amount_paid - amount_credited) FILTER (WHERE status IN ('open','partially_paid') AND due_date < ${t}::date), 0)::float AS overdue,
             COALESCE(SUM(total_amount - amount_paid - amount_credited) FILTER (WHERE status IN ('open','partially_paid') AND due_date BETWEEN ${t}::date AND (${t}::date + 7)), 0)::float AS due_this_week
      FROM bills WHERE company_id = ${req.company.id}`,
  ]);
  res.json({
    data: rows.map(shapeBill),
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
    summary: { outstanding: round2(sums.outstanding), overdue: round2(sums.overdue), due_this_week: round2(sums.due_this_week) },
  });
};

const loadBill = async (req, id = req.params.id) => {
  const b = await prisma.bills.findFirst({
    where: { id: toId(id), company_id: req.company.id },
    include: {
      suppliers: { select: { id: true, name: true, email: true, payment_terms_days: true } },
      bill_items: { orderBy: { id: "asc" }, include: { accounts: { select: accountSelect }, products: { select: { id: true, title: true } } } },
      bill_payments: { orderBy: { id: "asc" }, include: { accounts: { select: accountSelect } } },
      vendor_credit_applications: { include: { vendor_credits: { select: { credit_number: true } } } },
    },
  });
  if (!b) throw new HttpError(404, "Bill not found");
  const shaped = shapeBill(b);
  if (b.purchase_order_id) shaped.purchase_order = await prisma.purchase_orders.findUnique({ where: { id: b.purchase_order_id }, select: { id: true, po_number: true } });
  shaped.open_credits = (await prisma.vendor_credits.findMany({ where: { company_id: req.company.id, supplier_id: b.supplier_id, status: "open" } })).map((c) => ({ ...c, remaining: ap.creditRemaining(c) }));
  return shaped;
};

const getBill = async (req, res) => res.json({ data: await loadBill(req) });

// GET /company/purchase-orders/:id/bill-draft -> suggested bill lines for what was received.
// Receipts posted to the books clear "Goods received not invoiced"; receipts from before accounting
// started were part of the opening stock value, so they go against Opening balance equity.
const billDraftFromPo = async (req, res) => {
  requireBooks(req);
  const po = await prisma.purchase_orders.findFirst({
    where: { id: toId(req.params.id), company_id: req.company.id },
    include: { purchase_order_items: { include: { products: { select: { title: true } } } }, suppliers: true },
  });
  if (!po) throw new HttpError(404, "Purchase order not found");
  const [grni, opening, cogs, receipts, bills] = await Promise.all([
    ledger.accountId(prisma, req.company.id, "grni"),
    ledger.accountId(prisma, req.company.id, "opening_balance"),
    ledger.accountId(prisma, req.company.id, "cogs"),
    prisma.goods_receipts.findMany({ where: { purchase_order_id: po.id }, select: { id: true, landed_cost: true, goods_receipt_items: { select: { purchase_order_item_id: true, quantity: true } } } }),
    prisma.bills.findMany({ where: { purchase_order_id: po.id, status: { not: "void" } }, select: { id: true, bill_number: true, total_amount: true } }),
  ]);
  const posted = new Set((await prisma.journal_entries.findMany({
    where: { company_id: req.company.id, source_type: "goods_receipt", source_id: { in: receipts.map((r) => String(r.id)) }, reversal_of_id: null },
    select: { source_id: true },
  })).map((e) => e.source_id));
  const items = new Map(po.purchase_order_items.map((i) => [String(i.id), i]));
  const qty = new Map(); // `${itemId}:${posted}` -> quantity
  let landedPosted = 0, landedOpening = 0;
  for (const r of receipts) {
    const p = posted.has(String(r.id));
    if (p) landedPosted += num(r.landed_cost); else landedOpening += num(r.landed_cost);
    for (const gi of r.goods_receipt_items) {
      if (!gi.purchase_order_item_id) continue;
      const k = `${gi.purchase_order_item_id}:${p}`;
      qty.set(k, (qty.get(k) || 0) + gi.quantity);
    }
  }
  const lines = [];
  for (const [k, q] of qty) {
    const [itemId, p] = k.split(":");
    const i = items.get(itemId);
    if (!i || q <= 0) continue;
    const name = `${i.description || i.products.title}${i.flavor && !(i.description || "").includes(i.flavor) ? ` (${i.flavor})` : ""}`;
    lines.push({
      account_id: p === "true" ? grni : opening, product_id: i.product_id, quantity: q, unit_cost: num(i.unit_cost),
      description: p === "true" ? name : `${name} (received before accounting started)`,
    });
  }
  if (landedPosted > 0) lines.push({ account_id: grni, quantity: 1, unit_cost: round2(landedPosted), description: "Freight & landed costs (already in stock cost)" });
  if (landedOpening > 0) lines.push({ account_id: opening, quantity: 1, unit_cost: round2(landedOpening), description: "Freight & landed costs (received before accounting started)" });
  const extraShipping = round2(num(po.shipping_amount) - landedPosted - landedOpening);
  if (extraShipping > 0) lines.push({ account_id: cogs, quantity: 1, unit_cost: extraShipping, description: "Shipping" });
  if (num(po.tax_amount) > 0) lines.push({ account_id: cogs, quantity: 1, unit_cost: num(po.tax_amount), description: "Tax" });
  res.json({
    data: {
      supplier: { id: po.supplier_id, name: po.suppliers.name, payment_terms_days: po.suppliers.payment_terms_days },
      purchase_order: { id: po.id, po_number: po.po_number },
      lines,
      existing_bills: bills,
    },
  });
};

// POST /company/bills { supplier_id, purchase_order_id?, supplier_invoice_number?, bill_date?, due_date?, notes?, lines: [{ account_id, description, quantity?, unit_cost? | amount }] }
const createBill = async (req, res) => {
  requireBooks(req);
  const b = req.body;
  const supplier = await findSupplier(req, b.supplier_id);
  let poId = null;
  if (b.purchase_order_id) {
    const po = await prisma.purchase_orders.findFirst({ where: { id: toId(b.purchase_order_id, "purchase_order_id"), company_id: req.company.id, supplier_id: supplier.id } });
    if (!po) throw new HttpError(400, "That purchase order isn't from this supplier");
    poId = po.id;
  }
  const bill = await prisma.$transaction((tx) => ap.createBill(tx, {
    companyId: req.company.id, supplier, purchaseOrderId: poId, supplierInvoiceNumber: b.supplier_invoice_number,
    billDate: parseDate(b.bill_date, "Bill date"), dueDate: parseDate(b.due_date, "Due date"), notes: b.notes, lines: b.lines, userId: req.user.id,
  }), TX);
  await audit(req, "bill.create", { entity: "bill", entityId: bill.id, changes: { number: bill.bill_number, supplier: supplier.name, total: num(bill.total_amount) } });
  res.status(201).json({ message: `Bill ${bill.bill_number} recorded`, data: await loadBill(req, bill.id) });
};

// POST /company/bills/:id/payments { amount, method, account_id?, reference?, paid_at?, notes? }
const payBill = async (req, res) => {
  requireBooks(req);
  const r = await prisma.$transaction((tx) => ap.payBill(tx, {
    companyId: req.company.id, billId: toId(req.params.id), amount: Number(req.body.amount), method: String(req.body.method || "bank_transfer"),
    accountId: req.body.account_id ? toId(req.body.account_id, "account_id") : null, reference: req.body.reference,
    paidAt: parseDate(req.body.paid_at, "Payment date"), notes: req.body.notes, userId: req.user.id,
  }), TX);
  await audit(req, "bill.payment", { entity: "bill", entityId: r.bill.id, changes: { amount: num(r.payment.amount), method: r.payment.method } });
  res.status(201).json({ message: `Payment of ${num(r.payment.amount).toFixed(2)} recorded`, data: await loadBill(req) });
};

const removeBillPayment = async (req, res) => {
  const r = await prisma.$transaction((tx) => ap.deleteBillPayment(tx, { companyId: req.company.id, billId: toId(req.params.id), paymentId: toId(req.params.paymentId, "payment id"), userId: req.user.id }), TX);
  await audit(req, "bill.payment.delete", { entity: "bill", entityId: r.bill.id, changes: { amount: num(r.payment.amount) } });
  res.json({ message: "Payment removed", data: await loadBill(req) });
};

const voidBill = async (req, res) => {
  const b = await prisma.$transaction((tx) => ap.voidBill(tx, { companyId: req.company.id, billId: toId(req.params.id), userId: req.user.id }), TX);
  await audit(req, "bill.void", { entity: "bill", entityId: b.id, changes: { number: b.bill_number } });
  res.json({ message: `Bill ${b.bill_number} voided`, data: await loadBill(req) });
};

// ---- supplier credits ----

const listCredits = async (req, res) => {
  const rows = await prisma.vendor_credits.findMany({
    where: { company_id: req.company.id, ...(req.query.supplier_id ? { supplier_id: toId(req.query.supplier_id, "supplier_id") } : {}) },
    orderBy: { id: "desc" },
    take: 300,
    include: { suppliers: { select: { id: true, name: true } }, vendor_credit_applications: { include: { bills: { select: { id: true, bill_number: true } } } } },
  });
  res.json({ data: rows.map(({ suppliers, vendor_credit_applications, ...c }) => ({ ...c, supplier: suppliers, remaining: ap.creditRemaining(c), applications: vendor_credit_applications.map((a) => ({ amount: a.amount, bill: a.bills })) })) });
};

// POST /company/vendor-credits { supplier_id, amount, account_id, reference?, notes? }  (a credit not linked to a return, e.g. a rebate)
const createCredit = async (req, res) => {
  requireBooks(req);
  const supplier = await findSupplier(req, req.body.supplier_id);
  const amount = round2(Number(req.body.amount));
  if (!(amount > 0)) throw new HttpError(400, "Amount must be more than 0");
  const c = await prisma.$transaction(async (tx) => {
    const acc = await ledger.assertAccount(tx, req.company.id, toId(req.body.account_id, "account_id"), { types: ["expense", "asset", "revenue"] });
    const credit = await ap.createVendorCredit(tx, { companyId: req.company.id, supplierId: supplier.id, amount, reference: req.body.reference, notes: req.body.notes, userId: req.user.id });
    // Dr Accounts payable / Cr the account the credit is for (e.g. purchase price variance, other income)
    await ledger.post(tx, {
      companyId: req.company.id, sourceType: "vendor_credit", sourceId: credit.id, userId: req.user.id,
      memo: `Supplier credit ${credit.credit_number} from ${supplier.name}`,
      lines: [{ account: "ap", debit: amount, supplierId: supplier.id }, { account: acc.id, credit: amount }],
    });
    return credit;
  }, TX);
  await audit(req, "vendor_credit.create", { entity: "vendor_credit", entityId: c.id, changes: { amount, supplier: supplier.name } });
  res.status(201).json({ message: `Supplier credit ${c.credit_number} recorded`, data: c });
};

const applyCredit = async (req, res) => {
  const r = await prisma.$transaction((tx) => ap.applyCredit(tx, { companyId: req.company.id, creditId: toId(req.params.id), billId: toId(req.body.bill_id, "bill_id"), amount: req.body.amount }), TX);
  res.json({ message: `${r.amount.toFixed(2)} applied to ${r.bill.bill_number}` });
};

// GET /company/reports/ap-aging
const apAging = async (req, res) => {
  const t = todayStr();
  const rows = await prisma.$queryRaw`
    SELECT b.supplier_id, s.name AS supplier, COUNT(*)::int AS bills,
           SUM(b.total_amount - b.amount_paid - b.amount_credited) FILTER (WHERE b.due_date >= ${t}::date)::float AS current,
           SUM(b.total_amount - b.amount_paid - b.amount_credited) FILTER (WHERE (${t}::date - b.due_date) BETWEEN 1 AND 30)::float AS d1_30,
           SUM(b.total_amount - b.amount_paid - b.amount_credited) FILTER (WHERE (${t}::date - b.due_date) BETWEEN 31 AND 60)::float AS d31_60,
           SUM(b.total_amount - b.amount_paid - b.amount_credited) FILTER (WHERE (${t}::date - b.due_date) BETWEEN 61 AND 90)::float AS d61_90,
           SUM(b.total_amount - b.amount_paid - b.amount_credited) FILTER (WHERE (${t}::date - b.due_date) > 90)::float AS d90_plus,
           SUM(b.total_amount - b.amount_paid - b.amount_credited)::float AS total
    FROM bills b JOIN suppliers s ON s.id = b.supplier_id
    WHERE b.company_id = ${req.company.id} AND b.status IN ('open', 'partially_paid')
    GROUP BY b.supplier_id, s.name
    HAVING SUM(b.total_amount - b.amount_paid - b.amount_credited) > 0
    ORDER BY total DESC`;
  const keys = ["current", "d1_30", "d31_60", "d61_90", "d90_plus", "total"];
  const data = rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, round2(r[k] || 0)])) }));
  res.json({ data, totals: Object.fromEntries(keys.map((k) => [k, round2(data.reduce((s, r) => s + r[k], 0))])), as_of: t });
};

// ---- expenses ----

const shapeExpense = ({ accounts, paid_from, ...e }) => ({ ...e, account: accounts, paid_from });

// GET /company/expenses?from&to&account_id&search
const listExpenses = async (req, res) => {
  const search = String(req.query.search || "").trim();
  const where = {
    company_id: req.company.id,
    ...(req.query.account_id ? { account_id: toId(req.query.account_id, "account_id") } : {}),
    ...(req.query.from || req.query.to ? { expense_date: { ...(req.query.from ? { gte: parseDate(req.query.from, "From") } : {}), ...(req.query.to ? { lte: parseDate(req.query.to, "To") } : {}) } } : {}),
    ...(search ? { OR: [{ payee: { contains: search, mode: "insensitive" } }, { reference: { contains: search, mode: "insensitive" } }, { expense_number: { contains: search, mode: "insensitive" } }] } : {}),
  };
  const rows = await prisma.expenses.findMany({ where, orderBy: [{ expense_date: "desc" }, { id: "desc" }], take: 500, include: { accounts: { select: accountSelect }, paid_from: { select: accountSelect } } });
  const data = rows.map(shapeExpense);
  const byAccount = {};
  for (const e of data.filter((x) => x.status === "posted")) {
    const k = `${e.account.code} ${e.account.name}`;
    byAccount[k] = round2((byAccount[k] || 0) + num(e.amount));
  }
  res.json({ data, total: round2(data.filter((x) => x.status === "posted").reduce((s, e) => s + num(e.amount), 0)), by_account: byAccount });
};

// POST /company/expenses { expense_date?, payee, account_id, paid_from_account_id, amount, method?, reference?, notes?, supplier_id? }
const createExpense = async (req, res) => {
  requireBooks(req);
  const b = req.body;
  const payee = String(b.payee || "").trim().slice(0, 255);
  if (!payee) throw new HttpError(400, "Who was paid?");
  const amount = round2(Number(b.amount));
  if (!(amount > 0)) throw new HttpError(400, "Amount must be more than 0");
  const e = await prisma.$transaction(async (tx) => {
    const acc = await ledger.assertAccount(tx, req.company.id, toId(b.account_id, "account_id"), { types: ["expense", "asset"] });
    const from = await ledger.assertMoneyAccount(tx, req.company.id, toId(b.paid_from_account_id, "paid_from_account_id"));
    const date = parseDate(b.expense_date, "Date") || ap.today();
    const supplierId = b.supplier_id ? (await findSupplier(req, b.supplier_id)).id : null;
    const exp = await tx.expenses.create({
      data: {
        company_id: req.company.id, expense_number: await nextNumber(tx, req.company.id, "EXP"), expense_date: date, payee,
        account_id: acc.id, paid_from_account_id: from.id, supplier_id: supplierId, amount, method: b.method ? String(b.method).slice(0, 32) : null,
        reference: b.reference ? String(b.reference).slice(0, 255) : null, notes: b.notes ? String(b.notes).slice(0, 2000) : null, created_by: BigInt(req.user.id),
      },
    });
    // Dr expense / Cr cash, bank or credit card
    await ledger.post(tx, {
      companyId: req.company.id, date, sourceType: "expense", sourceId: exp.id, userId: req.user.id, memo: `${exp.expense_number}: ${payee}`,
      lines: [{ account: acc.id, debit: amount, description: payee, supplierId }, { account: from.id, credit: amount, description: payee }],
    });
    return exp;
  }, TX);
  await audit(req, "expense.create", { entity: "expense", entityId: e.id, changes: { payee, amount } });
  res.status(201).json({ message: `Expense ${e.expense_number} recorded`, data: e });
};

const voidExpense = async (req, res) => {
  const e = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw`SELECT id, status FROM expenses WHERE id = ${toId(req.params.id)} AND company_id = ${req.company.id} FOR UPDATE`;
    if (!row) throw new HttpError(404, "Expense not found");
    if (row.status === "void") throw new HttpError(400, "Already void");
    await ledger.reverse(tx, { companyId: req.company.id, sourceType: "expense", sourceId: row.id, userId: req.user.id, memo: "Expense voided" });
    return tx.expenses.update({ where: { id: row.id }, data: { status: "void" } });
  }, TX);
  await audit(req, "expense.void", { entity: "expense", entityId: e.id });
  res.json({ message: `Expense ${e.expense_number} voided` });
};

module.exports = {
  listBills, getBill, billDraftFromPo, createBill, payBill, removeBillPayment, voidBill,
  listCredits, createCredit, applyCredit, apAging,
  listExpenses, createExpense, voidExpense,
};
