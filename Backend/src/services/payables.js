// Accounts payable: supplier bills, bill payments and supplier (vendor) credits.
// All functions take a transaction client and lock the rows they change.
const crypto = require("crypto");
const { HttpError } = require("../utils/http");
const { round2, num } = require("./money");
const { nextNumber } = require("./sequences");
const ledger = require("./ledger");

const BILL_PAYMENT_METHODS = ["bank_transfer", "check", "cash", "card", "other"];
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const billBalance = (b) => round2(num(b.total_amount) - num(b.amount_paid) - num(b.amount_credited));
const billStatus = (b) => {
  if (b.status === "void") return "void";
  const settled = round2(num(b.amount_paid) + num(b.amount_credited));
  if (settled >= num(b.total_amount) - 0.004) return "paid";
  return settled > 0 ? "partially_paid" : "open";
};
const isOverdue = (b) => ["open", "partially_paid"].includes(b.status) && billBalance(b) > 0 && new Date(b.due_date) < today();

const lockBill = async (tx, companyId, id) => {
  const [row] = await tx.$queryRaw`SELECT id FROM bills WHERE id = ${BigInt(id)} AND company_id = ${BigInt(companyId)} FOR UPDATE`;
  if (!row) throw new HttpError(404, "Bill not found");
  return tx.bills.findUnique({ where: { id: row.id }, include: { bill_items: true } });
};

const refreshBill = async (tx, billId) => {
  const b = await tx.bills.findUnique({ where: { id: billId } });
  const status = billStatus(b);
  return status === b.status ? b : tx.bills.update({ where: { id: b.id }, data: { status, updated_at: new Date() } });
};

// Bill: Dr each line's account (expense / inventory / goods-received-not-invoiced) / Cr Accounts payable.
const postBill = (tx, bill, supplierName, userId) =>
  ledger.post(tx, {
    companyId: bill.company_id, date: bill.bill_date, sourceType: "bill", sourceId: bill.id, userId,
    memo: `Bill ${bill.bill_number} from ${supplierName}${bill.supplier_invoice_number ? ` (${bill.supplier_invoice_number})` : ""}`,
    lines: [
      ...bill.bill_items.map((i) => ({ account: i.account_id, debit: num(i.line_total), description: i.description, supplierId: bill.supplier_id })),
      { account: "ap", credit: num(bill.total_amount), supplierId: bill.supplier_id, description: bill.bill_number },
    ],
  });

/**
 * lines: [{ account_id, description, quantity?, unit_cost? | amount?, product_id? }]
 */
const createBill = async (tx, { companyId, supplier, purchaseOrderId = null, supplierInvoiceNumber = null, billDate = null, dueDate = null, notes = null, lines, userId }) => {
  if (!Array.isArray(lines) || !lines.length) throw new HttpError(400, "Add at least one line");
  const items = [];
  for (const [idx, l] of lines.entries()) {
    const acc = await ledger.assertAccount(tx, companyId, l.account_id, { types: ["expense", "asset", "liability", "equity"] });
    const qty = l.quantity === undefined || l.quantity === "" ? 1 : Number(l.quantity);
    const unit = l.unit_cost !== undefined && l.unit_cost !== "" ? Number(l.unit_cost) : Number(l.amount);
    if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, `Line ${idx + 1}: quantity must be more than 0`);
    if (!Number.isFinite(unit)) throw new HttpError(400, `Line ${idx + 1}: enter an amount`);
    const total = round2(qty * unit);
    if (total === 0) continue;
    items.push({
      account_id: acc.id,
      product_id: l.product_id ? BigInt(l.product_id) : null,
      description: String(l.description || acc.name).slice(0, 500),
      quantity: qty,
      unit_cost: Math.round(unit * 10000) / 10000,
      line_total: total,
    });
  }
  const total = round2(items.reduce((s, i) => s + i.line_total, 0));
  if (!(total > 0)) throw new HttpError(400, "The bill total must be more than 0");
  const issue = billDate || today();
  const due = dueDate || new Date(issue.getTime() + (supplier.payment_terms_days || 0) * 86400000);
  if (due < issue) throw new HttpError(400, "The due date can't be before the bill date");
  const bill = await tx.bills.create({
    data: {
      company_id: BigInt(companyId),
      supplier_id: supplier.id,
      purchase_order_id: purchaseOrderId,
      bill_number: await nextNumber(tx, companyId, "BILL"),
      supplier_invoice_number: supplierInvoiceNumber ? String(supplierInvoiceNumber).slice(0, 255) : null,
      bill_date: issue,
      due_date: due,
      total_amount: total,
      notes: notes ? String(notes).slice(0, 5000) : null,
      created_by: userId ? BigInt(userId) : null,
      bill_items: { create: items },
    },
    include: { bill_items: true },
  });
  await postBill(tx, bill, supplier.name, userId);
  // open supplier credits are used up first
  await applyOpenCredits(tx, { companyId, supplierId: supplier.id });
  return tx.bills.findUnique({ where: { id: bill.id } });
};

const payBill = async (tx, { companyId, billId, amount, method, accountId = null, reference = null, paidAt = null, notes = null, userId = null }) => {
  const bill = await lockBill(tx, companyId, billId);
  if (bill.status === "void") throw new HttpError(400, "This bill is void");
  const amt = round2(amount);
  if (!(amt > 0)) throw new HttpError(400, "Amount must be more than 0");
  const balance = billBalance(bill);
  if (amt > balance + 0.004) throw new HttpError(400, `Amount is more than the balance due (${balance.toFixed(2)})`);
  if (!BILL_PAYMENT_METHODS.includes(method)) throw new HttpError(400, `Payment method must be one of: ${BILL_PAYMENT_METHODS.join(", ")}`);
  const account = accountId
    ? (await ledger.assertMoneyAccount(tx, companyId, accountId)).id
    : await ledger.accountId(tx, companyId, ledger.defaultMoneyAccount(method));
  const payment = await tx.bill_payments.create({
    data: {
      company_id: BigInt(companyId), bill_id: bill.id, account_id: account, amount: amt, method,
      reference: reference ? String(reference).slice(0, 255) : null, paid_at: paidAt || today(),
      notes: notes ? String(notes).slice(0, 2000) : null, recorded_by: userId ? BigInt(userId) : null,
    },
  });
  // Dr Accounts payable / Cr Cash or Bank
  await ledger.post(tx, {
    companyId, date: payment.paid_at, sourceType: "bill_payment", sourceId: payment.id, userId,
    memo: `Payment of ${bill.bill_number}${reference ? ` (${reference})` : ""}`,
    lines: [{ account: "ap", debit: amt, supplierId: bill.supplier_id, description: bill.bill_number }, { account: account, credit: amt }],
  });
  await tx.bills.update({ where: { id: bill.id }, data: { amount_paid: round2(num(bill.amount_paid) + amt), updated_at: new Date() } });
  return { payment, bill: await refreshBill(tx, bill.id) };
};

const deleteBillPayment = async (tx, { companyId, billId, paymentId, userId = null }) => {
  const bill = await lockBill(tx, companyId, billId);
  const p = await tx.bill_payments.findFirst({ where: { id: BigInt(paymentId), bill_id: bill.id } });
  if (!p) throw new HttpError(404, "Payment not found");
  await ledger.reverse(tx, { companyId, sourceType: "bill_payment", sourceId: p.id, userId, memo: `Payment of ${bill.bill_number} removed` });
  await tx.bill_payments.delete({ where: { id: p.id } });
  await tx.bills.update({ where: { id: bill.id }, data: { amount_paid: round2(num(bill.amount_paid) - num(p.amount)), updated_at: new Date() } });
  return { payment: p, bill: await refreshBill(tx, bill.id) };
};

const voidBill = async (tx, { companyId, billId, userId = null }) => {
  const bill = await lockBill(tx, companyId, billId);
  if (bill.status === "void") return bill;
  if (num(bill.amount_paid) > 0 || num(bill.amount_credited) > 0) throw new HttpError(400, "This bill has payments or credits applied. Remove them first.");
  await ledger.reverse(tx, { companyId, sourceType: "bill", sourceId: bill.id, userId, memo: `Void bill ${bill.bill_number}` });
  return tx.bills.update({ where: { id: bill.id }, data: { status: "void", voided_at: new Date(), updated_at: new Date() } });
};

// ---- supplier credits ----

const creditRemaining = (c) => round2(num(c.amount) - num(c.amount_applied));

// Records a credit from a supplier (no journal entry here: the caller posts what the credit is for).
const createVendorCredit = async (tx, { companyId, supplierId, amount, reference = null, supplierReturnId = null, notes = null, userId = null }) => {
  const credit = await tx.vendor_credits.create({
    data: {
      company_id: BigInt(companyId), supplier_id: BigInt(supplierId), supplier_return_id: supplierReturnId ? BigInt(supplierReturnId) : null,
      credit_number: await nextNumber(tx, companyId, "VC"), reference: reference ? String(reference).slice(0, 255) : null,
      amount: round2(amount), notes, created_by: userId ? BigInt(userId) : null,
    },
  });
  await applyOpenCredits(tx, { companyId, supplierId });
  return tx.vendor_credits.findUnique({ where: { id: credit.id } });
};

const applyCredit = async (tx, { companyId, creditId, billId, amount = null }) => {
  const [c] = await tx.$queryRaw`SELECT id FROM vendor_credits WHERE id = ${BigInt(creditId)} AND company_id = ${BigInt(companyId)} FOR UPDATE`;
  if (!c) throw new HttpError(404, "Supplier credit not found");
  const credit = await tx.vendor_credits.findUnique({ where: { id: c.id } });
  const bill = await lockBill(tx, companyId, billId);
  if (credit.status === "void") throw new HttpError(400, "This credit is void");
  if (bill.status === "void") throw new HttpError(400, "That bill is void");
  if (String(bill.supplier_id) !== String(credit.supplier_id)) throw new HttpError(400, "The credit and the bill are from different suppliers");
  const max = Math.min(creditRemaining(credit), billBalance(bill));
  const amt = round2(amount === null || amount === undefined || amount === "" ? max : Number(amount));
  if (!(amt > 0)) throw new HttpError(400, "Nothing to apply");
  if (amt > max + 0.004) throw new HttpError(400, `You can apply at most ${max.toFixed(2)}`);
  await tx.vendor_credit_applications.create({ data: { vendor_credit_id: credit.id, bill_id: bill.id, amount: amt } });
  const applied = round2(num(credit.amount_applied) + amt);
  await tx.vendor_credits.update({ where: { id: credit.id }, data: { amount_applied: applied, status: applied >= num(credit.amount) - 0.004 ? "applied" : "open" } });
  await tx.bills.update({ where: { id: bill.id }, data: { amount_credited: round2(num(bill.amount_credited) + amt), updated_at: new Date() } });
  return { amount: amt, bill: await refreshBill(tx, bill.id) };
};

// Applies a supplier's open credits to their open bills, oldest first. (Both are AP: no journal entry.)
const applyOpenCredits = async (tx, { companyId, supplierId }) => {
  const credits = await tx.vendor_credits.findMany({ where: { company_id: BigInt(companyId), supplier_id: BigInt(supplierId), status: "open" }, orderBy: { id: "asc" } });
  for (const c of credits) {
    let left = creditRemaining(c);
    if (left <= 0) continue;
    const bills = await tx.bills.findMany({ where: { company_id: BigInt(companyId), supplier_id: BigInt(supplierId), status: { in: ["open", "partially_paid"] } }, orderBy: [{ due_date: "asc" }, { id: "asc" }] });
    for (const b of bills) {
      if (left <= 0) break;
      const bal = billBalance(b);
      if (bal <= 0) continue;
      const r = await applyCredit(tx, { companyId, creditId: c.id, billId: b.id, amount: Math.min(left, bal) });
      left = round2(left - r.amount);
    }
  }
};

module.exports = {
  BILL_PAYMENT_METHODS, billBalance, billStatus, isOverdue, creditRemaining, today,
  createBill, payBill, deleteBillPayment, voidBill, createVendorCredit, applyCredit, applyOpenCredits, uid: () => crypto.randomUUID(),
};
