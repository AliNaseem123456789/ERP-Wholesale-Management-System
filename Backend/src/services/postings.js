// Journal entries for each kind of business event (what gets debited and credited).
// All functions run inside the caller's transaction and do nothing while accounting is off.
const crypto = require("crypto");
const ledger = require("./ledger");
const { round2, num } = require("./money");

const uid = () => crypto.randomUUID();

// Perpetual inventory accounting needs inventory tracking. With tracking off, purchases go straight
// to cost of goods sold (shipments don't post cost), and stock-only events (adjustments, transfer
// losses, restocked returns) don't post.
const tracked = async (tx, companyId) => {
  const c = await ledger.loadCompany(tx, companyId);
  return c?.settings?.inventory?.tracking === true;
};

// Value of stock taken out by inventory.issue(): each lot at its own cost, else the product's average cost.
const chunksValue = (chunks, fallbackCost = 0) =>
  round2(chunks.reduce((s, c) => s + c.quantity * Number(c.lot?.unit_cost ?? c.unit_cost ?? fallbackCost ?? 0), 0));

// ---- sales ------------------------------------------------------------------------------

// Invoice: Dr Receivable (total) / Cr Sales, Dr Discounts, Cr Shipping income, Cr Sales tax.
const invoiceLines = (inv) => [
  { account: "ar", debit: num(inv.total_amount), customerId: inv.user_id, description: inv.invoice_number },
  { account: "sales", credit: num(inv.subtotal) },
  { account: "sales_discounts", debit: num(inv.discount_amount) },
  { account: "shipping_income", credit: num(inv.shipping_amount) },
  { account: "sales_tax", credit: num(inv.tax_amount) },
  { account: "excise_tax", credit: num(inv.excise_amount) },
];

const postInvoice = (tx, inv, userId = null) =>
  ledger.post(tx, {
    companyId: inv.company_id, date: inv.issue_date, sourceType: "invoice", sourceId: inv.id, userId,
    memo: `Invoice ${inv.invoice_number}`, lines: invoiceLines(inv),
  });

// Voiding: reverse the invoice entry. Invoices from before accounting started have no entry: nothing to undo.
const voidInvoice = (tx, inv, userId = null) =>
  ledger.reverse(tx, { companyId: inv.company_id, sourceType: "invoice", sourceId: inv.id, memo: `Void invoice ${inv.invoice_number}`, userId });

// Customer payment: Dr Cash/Bank / Cr Receivable.
const postInvoicePayment = async (tx, inv, payment, userId = null) => {
  const money = payment.account_id || (await ledger.accountId(tx, inv.company_id, ledger.defaultMoneyAccount(payment.method)));
  return ledger.post(tx, {
    companyId: inv.company_id, date: payment.paid_at, sourceType: "invoice_payment", sourceId: payment.id, userId,
    memo: `Payment for ${inv.invoice_number}${payment.reference ? ` (${payment.reference})` : ""}`,
    lines: [
      { account: money, debit: num(payment.amount) },
      { account: "ar", credit: num(payment.amount), customerId: inv.user_id, description: inv.invoice_number },
    ],
  });
};

const reverseInvoicePayment = (tx, companyId, payment, userId = null) =>
  ledger.reverse(tx, { companyId, sourceType: "invoice_payment", sourceId: payment.id, userId, memo: "Payment removed" });

// Credit note: Dr Sales returns (net), Dr Sales tax / Cr Receivable.
const postCreditNote = (tx, cn, userId = null) =>
  ledger.post(tx, {
    companyId: cn.company_id, date: cn.created_at, sourceType: "credit_note", sourceId: cn.id, userId,
    memo: `Credit note ${cn.credit_note_number}${cn.reason ? `: ${cn.reason}` : ""}`,
    lines: [
      { account: "sales_returns", debit: num(cn.subtotal) },
      { account: "sales_tax", debit: num(cn.tax_amount) },
      { account: "ar", credit: num(cn.total_amount), customerId: cn.user_id, description: cn.credit_note_number },
    ],
  });

const voidCreditNote = (tx, cn, userId = null) =>
  ledger.reverse(tx, { companyId: cn.company_id, sourceType: "credit_note", sourceId: cn.id, userId, memo: `Void credit note ${cn.credit_note_number}` });

// Refunding credit to a customer: Dr Receivable / Cr Cash/Bank.
const postCreditRefund = async (tx, cn, amount, accountId = null, userId = null) => {
  const money = accountId || (await ledger.accountId(tx, cn.company_id, "bank"));
  return ledger.post(tx, {
    companyId: cn.company_id, sourceType: "credit_refund", sourceId: `${cn.id}:${uid()}`, userId,
    memo: `Refund of credit note ${cn.credit_note_number}`,
    lines: [
      { account: "ar", debit: amount, customerId: cn.user_id, description: cn.credit_note_number },
      { account: money, credit: amount },
    ],
  });
};

// Goods shipped to a customer: Dr Cost of goods sold / Cr Inventory, at the cost of the lots that left.
const postShipment = (tx, { companyId, order, value, userId = null }) =>
  ledger.post(tx, {
    companyId, sourceType: "shipment", sourceId: order.id, userId, memo: `Cost of goods shipped, ${order.order_number}`,
    lines: [{ account: "cogs", debit: value }, { account: "inventory", credit: value }],
  });

// Customer return put back into stock: Dr Inventory / Cr Cost of goods sold.
const postCustomerReturn = async (tx, { companyId, ret, value, userId = null }) =>
  (await tracked(tx, companyId)) &&
  ledger.post(tx, {
    companyId, sourceType: "customer_return", sourceId: ret.id, userId, memo: `Restocked return ${ret.rma_number}`,
    lines: [{ account: "inventory", debit: value }, { account: "cogs", credit: value }],
  });

// ---- purchasing & stock ---------------------------------------------------------------------

// Goods received on a purchase order: Dr Inventory / Cr Goods received not invoiced (cleared by the supplier's bill).
const postGoodsReceipt = async (tx, { companyId, receipt, poNumber, value, supplierId, userId = null }) =>
  ledger.post(tx, {
    companyId, date: receipt.received_at, sourceType: "goods_receipt", sourceId: receipt.id, userId,
    memo: `Goods received ${receipt.receipt_number} (${poNumber})`,
    lines: [{ account: (await tracked(tx, companyId)) ? "inventory" : "cogs", debit: value }, { account: "grni", credit: value, supplierId }],
  });

// Stock adjustment: Dr/Cr Inventory against shrinkage & adjustments (or opening balance equity for opening stock).
const postStockAdjustment = async (tx, { companyId, value, reason, productTitle, userId = null }) => {
  if (!value || !(await tracked(tx, companyId))) return null;
  const other = reason === "opening_balance" ? "opening_balance" : "inventory_adjustments";
  const v = Math.abs(value);
  return ledger.post(tx, {
    companyId, sourceType: "stock_adjustment", sourceId: uid(), userId,
    memo: `Stock ${value > 0 ? "added" : "removed"}: ${productTitle} (${String(reason).replace(/_/g, " ")})`,
    lines: value > 0
      ? [{ account: "inventory", debit: v }, { account: other, credit: v }]
      : [{ account: other, debit: v }, { account: "inventory", credit: v }],
  });
};

// Units lost on an in-transit transfer: Dr Shrinkage / Cr Inventory.
const postTransferLoss = async (tx, { companyId, transfer, value, userId = null }) =>
  (await tracked(tx, companyId)) &&
  ledger.post(tx, {
    companyId, sourceType: "transfer_loss", sourceId: transfer.id, userId, memo: `Lost in transit, ${transfer.transfer_number}`,
    lines: [{ account: "inventory_adjustments", debit: value }, { account: "inventory", credit: value }],
  });

// Goods shipped back to a supplier: Dr Supplier returns receivable / Cr Inventory.
const postSupplierReturnShipped = async (tx, { companyId, rtv, value, userId = null }) =>
  ledger.post(tx, {
    companyId, sourceType: "supplier_return", sourceId: rtv.id, userId, memo: `Returned to supplier ${rtv.return_number}`,
    lines: [
      { account: "supplier_returns", debit: value, supplierId: rtv.supplier_id },
      { account: (await tracked(tx, companyId)) ? "inventory" : "cogs", credit: value },
    ],
  });

// Supplier credit for a return: Dr Accounts payable (credit) / Cr Supplier returns receivable (value); any difference is a price variance.
// Closing without credit writes the receivable off to shrinkage.
const postSupplierReturnSettled = (tx, { companyId, rtv, value, credit, userId = null }) => {
  const diff = round2(value - credit);
  return ledger.post(tx, {
    companyId, sourceType: "supplier_return_settled", sourceId: rtv.id, userId,
    memo: credit > 0 ? `Supplier credit for ${rtv.return_number}` : `No supplier credit for ${rtv.return_number}`,
    lines: [
      { account: "ap", debit: credit, supplierId: rtv.supplier_id },
      { account: credit > 0 ? "purchase_variance" : "inventory_adjustments", debit: diff },
      { account: "supplier_returns", credit: value, supplierId: rtv.supplier_id },
    ],
  });
};

module.exports = {
  chunksValue, tracked,
  postInvoice, voidInvoice, postInvoicePayment, reverseInvoicePayment,
  postCreditNote, voidCreditNote, postCreditRefund,
  postShipment, postCustomerReturn, postGoodsReceipt, postStockAdjustment, postTransferLoss,
  postSupplierReturnShipped, postSupplierReturnSettled,
};
