// Invoices, payments and credit notes (accounts receivable).
// Every function takes a transaction client `tx` and locks the rows it changes.
const { HttpError } = require("../utils/http");
const { round2, num } = require("./money");
const { nextNumber } = require("./sequences");
const { getSalesSettings } = require("./salesSettings");
// lazy: postings -> ledger -> sequences; avoids a require cycle at load time
const gl = () => require("./postings");

const PAYMENT_METHODS = ["cash_on_delivery", "cash", "check", "bank_transfer", "card", "other"];

// "Today" as a DATE value (UTC midnight of the server's current date).
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const addDays = (d, days) => new Date(d.getTime() + days * 86400000);
const parseDate = (v, name) => {
  if (v === undefined || v === null || v === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new HttpError(400, `${name} must be a date (YYYY-MM-DD)`);
  return new Date(`${v}T00:00:00Z`);
};

const invoiceBalance = (inv) => round2(num(inv.total_amount) - num(inv.amount_paid) - num(inv.amount_credited));
const creditRemaining = (cn) => round2(num(cn.total_amount) - num(cn.amount_applied) - num(cn.amount_refunded));
const isOverdue = (inv) =>
  ["issued", "partially_paid"].includes(inv.status) && invoiceBalance(inv) > 0 && new Date(inv.due_date) < today();

const statusFor = (inv) => {
  if (inv.status === "void") return "void";
  const settled = round2(num(inv.amount_paid) + num(inv.amount_credited));
  if (settled >= num(inv.total_amount) - 0.004) return "paid";
  return settled > 0 ? "partially_paid" : "issued";
};

const lockInvoice = async (tx, id, companyId) => {
  const [row] = await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${BigInt(id)} AND company_id = ${BigInt(companyId)} FOR UPDATE`;
  if (!row) throw new HttpError(404, "Invoice not found");
  return tx.invoices.findUnique({ where: { id: row.id } });
};

const lockCreditNote = async (tx, id, companyId) => {
  const [row] = await tx.$queryRaw`SELECT id FROM credit_notes WHERE id = ${BigInt(id)} AND company_id = ${BigInt(companyId)} FOR UPDATE`;
  if (!row) throw new HttpError(404, "Credit note not found");
  return tx.credit_notes.findUnique({ where: { id: row.id } });
};

// Keeps the order's payment record in step with its invoice: settled -> completed, else pending.
const syncOrderPayment = async (tx, inv) => {
  if (!inv.order_id) return;
  if (inv.status === "paid") {
    await tx.payment_history.updateMany({ where: { order_id: inv.order_id, status: "pending" }, data: { status: "completed" } });
  } else if (inv.status !== "void") {
    await tx.payment_history.updateMany({ where: { order_id: inv.order_id, status: "completed" }, data: { status: "pending" } });
  }
};

// Re-derives the invoice status after a payment/credit change.
const refreshInvoice = async (tx, invoiceId) => {
  const inv = await tx.invoices.findUnique({ where: { id: invoiceId } });
  const status = statusFor(inv);
  const updated = status === inv.status ? inv : await tx.invoices.update({ where: { id: inv.id }, data: { status, updated_at: new Date() } });
  await syncOrderPayment(tx, updated);
  return updated;
};

/**
 * Creates the invoice for an order (idempotent: returns the existing one if the order already has an open invoice).
 * -> { invoice, created }
 */
const createInvoiceForOrder = async (tx, { company, orderId, userId = null }) => {
  const [locked] = await tx.$queryRaw`SELECT id FROM orders WHERE id = ${BigInt(orderId)} AND company_id = ${company.id} FOR UPDATE`;
  if (!locked) throw new HttpError(404, "Order not found");
  const existing = await tx.invoices.findFirst({ where: { order_id: locked.id, status: { not: "void" } } });
  if (existing) return { invoice: existing, created: false };

  const order = await tx.orders.findUnique({
    where: { id: locked.id },
    include: {
      users: { select: { id: true, email: true, first_name: true, last_name: true, business_name: true, phone: true } },
      addresses_orders_billing_address_idToaddresses: true,
      addresses_orders_shipping_address_idToaddresses: true,
      order_items: { orderBy: { id: "asc" }, include: { products: { select: { title: true, sku: true } } } },
      payment_history: { select: { status: true } },
    },
  });
  if ((order.status || "pending") === "cancelled") throw new HttpError(400, "A cancelled order can't be invoiced");

  const customer = order.user_id
    ? await tx.company_customers.findUnique({ where: { company_id_user_id: { company_id: company.id, user_id: order.user_id } } })
    : null;
  const terms = order.payment_method === "on_account" ? order.payment_terms_days ?? customer?.payment_terms_days ?? 0 : 0;
  const issue = today();
  const settings = getSalesSettings(company);

  const items = order.order_items.map((i) => ({
    product_id: i.product_id,
    description: [i.products?.title || "Item", i.flavor ? `- ${i.flavor}` : null, i.products?.sku ? `(${i.products.sku})` : null].filter(Boolean).join(" ").slice(0, 500),
    quantity: i.quantity,
    unit_price: num(i.price_at_time),
    line_total: round2(num(i.price_at_time) * i.quantity),
  }));
  const subtotal = order.subtotal_amount !== null ? num(order.subtotal_amount) : round2(items.reduce((s, i) => s + i.line_total, 0));
  const address = order.addresses_orders_billing_address_idToaddresses || order.addresses_orders_shipping_address_idToaddresses;

  const invoice = await tx.invoices.create({
    data: {
      company_id: company.id,
      user_id: order.user_id,
      order_id: order.id,
      invoice_number: await nextNumber(tx, company.id, "invoice", "INV"),
      issue_date: issue,
      due_date: addDays(issue, terms),
      currency: company.currency || "USD",
      subtotal,
      discount_amount: num(order.discount_amount),
      tax_amount: num(order.tax_amount),
      shipping_amount: num(order.shipping_amount),
      excise_amount: num(order.excise_amount),
      total_amount: num(order.total_amount),
      payment_method: order.payment_method,
      billing_snapshot: JSON.parse(JSON.stringify({
        user: order.users,
        business_name: order.business_name || order.users?.business_name || null,
        address,
        tax_id: customer?.tax_id || null,
      })),
      notes: settings.invoiceNotes || null,
      created_by: userId ? BigInt(userId) : null,
      invoice_items: { create: items },
    },
  });

  await gl().postInvoice(tx, invoice, userId);

  // Invoicing an already-paid cash-on-delivery order: record the collected cash against it.
  if (order.payment_history.some((p) => p.status === "completed") && num(invoice.total_amount) > 0) {
    const payment = await tx.invoice_payments.create({
      data: { company_id: company.id, invoice_id: invoice.id, amount: num(invoice.total_amount), method: order.payment_method || "cash_on_delivery", reference: order.order_number, recorded_by: userId ? BigInt(userId) : null },
    });
    await gl().postInvoicePayment(tx, invoice, payment, userId);
    await tx.invoices.update({ where: { id: invoice.id }, data: { amount_paid: num(invoice.total_amount), status: "paid" } });
    return { invoice: await tx.invoices.findUnique({ where: { id: invoice.id } }), created: true };
  }
  return { invoice, created: true };
};

const recordPayment = async (tx, { companyId, invoiceId, amount, method, reference = null, paidAt = null, notes = null, userId = null, accountId = null }) => {
  const inv = await lockInvoice(tx, invoiceId, companyId);
  if (inv.status === "void") throw new HttpError(400, "This invoice is void");
  const amt = round2(amount);
  if (!(amt > 0)) throw new HttpError(400, "Amount must be more than 0");
  const balance = invoiceBalance(inv);
  if (amt > balance + 0.004) throw new HttpError(400, `Amount is more than the balance due (${balance.toFixed(2)})`);
  if (!PAYMENT_METHODS.includes(method)) throw new HttpError(400, `Payment method must be one of: ${PAYMENT_METHODS.join(", ")}`);
  if (accountId) await require("./ledger").assertMoneyAccount(tx, companyId, accountId);
  const payment = await tx.invoice_payments.create({
    data: {
      company_id: inv.company_id, invoice_id: inv.id, amount: amt, method,
      reference: reference ? String(reference).slice(0, 255) : null,
      paid_at: paidAt || today(),
      notes: notes ? String(notes).slice(0, 2000) : null,
      recorded_by: userId ? BigInt(userId) : null,
      account_id: accountId ? BigInt(accountId) : null,
    },
  });
  await gl().postInvoicePayment(tx, inv, payment, userId);
  await tx.invoices.update({ where: { id: inv.id }, data: { amount_paid: round2(num(inv.amount_paid) + amt), updated_at: new Date() } });
  return { payment, invoice: await refreshInvoice(tx, inv.id) };
};

const deletePayment = async (tx, { companyId, invoiceId, paymentId }) => {
  const inv = await lockInvoice(tx, invoiceId, companyId);
  if (inv.status === "void") throw new HttpError(400, "This invoice is void");
  const p = await tx.invoice_payments.findFirst({ where: { id: BigInt(paymentId), invoice_id: inv.id } });
  if (!p) throw new HttpError(404, "Payment not found");
  await gl().reverseInvoicePayment(tx, inv.company_id, p);
  await tx.invoice_payments.delete({ where: { id: p.id } });
  await tx.invoices.update({ where: { id: inv.id }, data: { amount_paid: round2(num(inv.amount_paid) - num(p.amount)), updated_at: new Date() } });
  return { payment: p, invoice: await refreshInvoice(tx, inv.id) };
};

const voidInvoice = async (tx, { companyId, invoiceId }) => {
  const inv = await lockInvoice(tx, invoiceId, companyId);
  if (inv.status === "void") return inv;
  if (num(inv.amount_paid) > 0 || num(inv.amount_credited) > 0) {
    throw new HttpError(400, "This invoice has payments or credits. Remove the payments, or issue a credit note for the balance instead.");
  }
  await gl().voidInvoice(tx, inv);
  return tx.invoices.update({ where: { id: inv.id }, data: { status: "void", voided_at: new Date(), updated_at: new Date() } });
};

/**
 * items: [{ product_id?, description, quantity, unit_price }]; tax: amount (already calculated).
 */
const createCreditNote = async (tx, { companyId, userId, invoiceId = null, returnId = null, reason = null, items, tax = 0, notes = null, createdBy = null }) => {
  const lines = items
    .filter((i) => i.quantity > 0)
    .map((i) => ({
      product_id: i.product_id ? BigInt(i.product_id) : null,
      description: String(i.description || "Credit").slice(0, 500),
      quantity: i.quantity,
      unit_price: round2(i.unit_price * 10000) / 10000,
      line_total: round2(i.unit_price * i.quantity),
    }));
  if (!lines.length) throw new HttpError(400, "A credit note needs at least one line");
  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));
  const total = round2(subtotal + round2(tax));
  if (!(total > 0)) throw new HttpError(400, "Credit amount must be more than 0");
  const cn = await tx.credit_notes.create({
    data: {
      company_id: BigInt(companyId),
      user_id: userId ? BigInt(userId) : null,
      invoice_id: invoiceId ? BigInt(invoiceId) : null,
      return_id: returnId ? BigInt(returnId) : null,
      credit_note_number: await nextNumber(tx, companyId, "credit_note", "CN"),
      reason: reason ? String(reason).slice(0, 255) : null,
      subtotal,
      tax_amount: round2(tax),
      total_amount: total,
      notes: notes ? String(notes).slice(0, 2000) : null,
      created_by: createdBy ? BigInt(createdBy) : null,
      credit_note_items: { create: lines },
    },
  });
  await gl().postCreditNote(tx, cn, createdBy);
  return cn;
};

const cnStatus = (cn) => {
  if (cn.status === "void") return "void";
  if (creditRemaining(cn) > 0.004) return "issued";
  return num(cn.amount_applied) > 0 ? "applied" : "refunded";
};

// Uses (part of) a credit note to pay down an invoice of the same customer. amount defaults to the most possible.
const applyCreditNote = async (tx, { companyId, creditNoteId, invoiceId, amount = null }) => {
  const cn = await lockCreditNote(tx, creditNoteId, companyId);
  const inv = await lockInvoice(tx, invoiceId, companyId);
  if (cn.status === "void") throw new HttpError(400, "This credit note is void");
  if (inv.status === "void") throw new HttpError(400, "That invoice is void");
  if (String(cn.user_id) !== String(inv.user_id)) throw new HttpError(400, "The credit note and invoice belong to different customers");
  const max = Math.min(creditRemaining(cn), invoiceBalance(inv));
  const amt = round2(amount === null || amount === undefined || amount === "" ? max : Number(amount));
  if (!(amt > 0)) throw new HttpError(400, max > 0 ? "Amount must be more than 0" : "Nothing to apply: the credit is used up or the invoice is already settled");
  if (amt > max + 0.004) throw new HttpError(400, `You can apply at most ${max.toFixed(2)}`);
  await tx.invoices.update({ where: { id: inv.id }, data: { amount_credited: round2(num(inv.amount_credited) + amt), updated_at: new Date() } });
  const after = { ...cn, amount_applied: round2(num(cn.amount_applied) + amt) };
  const updatedCn = await tx.credit_notes.update({
    where: { id: cn.id },
    data: { amount_applied: after.amount_applied, status: cnStatus(after), invoice_id: cn.invoice_id ?? inv.id },
  });
  return { creditNote: updatedCn, invoice: await refreshInvoice(tx, inv.id), amount: amt };
};

const refundCreditNote = async (tx, { companyId, creditNoteId, amount = null, accountId = null, userId = null }) => {
  const cn = await lockCreditNote(tx, creditNoteId, companyId);
  if (cn.status === "void") throw new HttpError(400, "This credit note is void");
  const max = creditRemaining(cn);
  const amt = round2(amount === null || amount === undefined || amount === "" ? max : Number(amount));
  if (!(amt > 0)) throw new HttpError(400, "Nothing left to refund");
  if (amt > max + 0.004) throw new HttpError(400, `You can refund at most ${max.toFixed(2)}`);
  if (accountId) await require("./ledger").assertMoneyAccount(tx, companyId, accountId);
  await gl().postCreditRefund(tx, cn, amt, accountId ? BigInt(accountId) : null, userId);
  const after = { ...cn, amount_refunded: round2(num(cn.amount_refunded) + amt) };
  return tx.credit_notes.update({
    where: { id: cn.id },
    data: { amount_refunded: after.amount_refunded, status: cnStatus(after), ...(accountId ? { refund_account_id: BigInt(accountId) } : {}) },
  });
};

const voidCreditNote = async (tx, { companyId, creditNoteId }) => {
  const cn = await lockCreditNote(tx, creditNoteId, companyId);
  if (cn.status === "void") return cn;
  if (num(cn.amount_applied) > 0 || num(cn.amount_refunded) > 0) throw new HttpError(400, "This credit note has already been used, so it can't be voided");
  await gl().voidCreditNote(tx, cn);
  return tx.credit_notes.update({ where: { id: cn.id }, data: { status: "void" } });
};

module.exports = {
  PAYMENT_METHODS,
  today, addDays, parseDate,
  invoiceBalance, creditRemaining, isOverdue, statusFor,
  createInvoiceForOrder, recordPayment, deletePayment, voidInvoice, refreshInvoice,
  createCreditNote, applyCreditNote, refundCreditNote, voidCreditNote,
};
