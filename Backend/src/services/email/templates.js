// Email templates. Every template returns { subject, html, text }.
// All dynamic values go through esc() so user input can't inject HTML.
const { appName, appUrl } = require("../../config");

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const button = (href, label) =>
  `<p style="margin:28px 0"><a href="${esc(href)}" style="background:#2563eb;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${esc(label)}</a></p>
   <p style="font-size:12px;color:#6b7280">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all">${esc(href)}</span></p>`;

const layout = (title, body) => `<!doctype html>
<html><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#111827;color:#fff;padding:18px 24px;font-size:18px;font-weight:700">${esc(appName)}</td></tr>
<tr><td style="padding:28px 24px;font-size:15px;line-height:1.55">
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
${body}
</td></tr>
<tr><td style="padding:16px 24px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb">
This message was sent by ${esc(appName)}. Products may contain nicotine. Nicotine is an addictive chemical.
</td></tr></table></td></tr></table></body></html>`;

const plain = (...lines) => lines.filter(Boolean).join("\n\n");

const itemsTable = (items) => `
<table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:12px 0">
<tr style="background:#f9fafb;text-align:left"><th>Product</th><th align="center">Qty</th><th align="right">Price</th></tr>
${items
  .map(
    (i) => `<tr style="border-top:1px solid #e5e7eb"><td>${esc(i.title)}</td><td align="center">${esc(i.quantity)}</td><td align="right">${money(i.price * i.quantity)}</td></tr>`,
  )
  .join("")}
</table>`;

const templates = {
  verifyEmail: ({ name, token }) => {
    const link = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
    return {
      subject: `Verify your email for ${appName}`,
      html: layout("Confirm your email", `<p>Hi ${esc(name || "there")},</p><p>Please confirm this email address for your ${esc(appName)} account.</p>${button(link, "Verify email")}<p>This link expires in 48 hours.</p>`),
      text: plain(`Confirm your email for ${appName}:`, link, "This link expires in 48 hours."),
    };
  },

  passwordReset: ({ name, token }) => {
    const link = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    return {
      subject: `Reset your ${appName} password`,
      html: layout("Reset your password", `<p>Hi ${esc(name || "there")},</p><p>We received a request to reset your password.</p>${button(link, "Choose a new password")}<p>This link expires in 1 hour. If you didn't ask for this, you can ignore this email; your password won't change.</p>`),
      text: plain("Reset your password:", link, "This link expires in 1 hour. If you didn't request it, ignore this email."),
    };
  },

  passwordChanged: ({ name }) => ({
    subject: `Your ${appName} password was changed`,
    html: layout("Password changed", `<p>Hi ${esc(name || "there")},</p><p>Your password was just changed and all other sessions were signed out.</p><p>If this wasn't you, reset your password immediately and contact us.</p>${button(`${appUrl}/forgot-password`, "Reset password")}`),
    text: plain("Your password was changed and other sessions were signed out.", `If this wasn't you, reset it: ${appUrl}/forgot-password`),
  }),

  invitation: ({ companyName, role, inviterName, token }) => {
    const link = `${appUrl}/accept-invite?token=${encodeURIComponent(token)}`;
    return {
      subject: `You're invited to join ${companyName} on ${appName}`,
      html: layout(`Join ${companyName}`, `<p>${esc(inviterName || "A team member")} invited you to join <b>${esc(companyName)}</b> as <b>${esc(role)}</b>.</p>${button(link, "Accept invitation")}<p>This invitation expires in 7 days.</p>`),
      text: plain(`You're invited to join ${companyName} as ${role}.`, link),
    };
  },

  companyStatus: ({ companyName, status }) => ({
    subject: `${companyName} is now ${status} on ${appName}`,
    html: layout(`Business ${status}`, `<p><b>${esc(companyName)}</b> is now <b>${esc(status)}</b>.</p>${status === "active" ? `<p>Your products are now visible to customers.</p>${button(`${appUrl}/business`, "Open your business dashboard")}` : "<p>Contact support if you have questions.</p>"}`),
    text: plain(`${companyName} is now ${status}.`, `${appUrl}/business`),
  }),

  newCompanyPending: ({ companyName, ownerEmail }) => ({
    subject: `New business waiting for approval: ${companyName}`,
    html: layout("New business registration", `<p><b>${esc(companyName)}</b> (${esc(ownerEmail)}) registered and is waiting for approval.</p>${button(`${appUrl}/admin`, "Review in admin")}`),
    text: plain(`${companyName} (${ownerEmail}) is waiting for approval.`, `${appUrl}/admin`),
  }),

  orderConfirmation: ({ name, orders }) => {
    const total = orders.reduce((s, o) => s + Number(o.total), 0);
    const body = orders
      .map(
        (o) => `<h3 style="font-size:16px;margin:22px 0 4px">${esc(o.companyName)} &middot; ${esc(o.orderNumber)}</h3>
        ${itemsTable(o.items)}
        <p style="text-align:right;margin:0">${o.discount ? `Discount: -${money(o.discount)}<br>` : ""}Shipping: ${money(o.shipping)}<br>${o.tax ? `Tax: ${money(o.tax)}<br>` : ""}<b>Order total: ${money(o.total)}</b><br><span style="font-size:12px;color:#6b7280">${o.paymentMethod === "on_account" ? "Payment: on account (invoice to follow)" : "Payment: cash on delivery"}</span></p>`,
      )
      .join("");
    return {
      subject: `Order confirmation (${orders.map((o) => o.orderNumber).join(", ")})`,
      html: layout("Thanks for your order!", `<p>Hi ${esc(name || "there")},</p><p>We've received your order${orders.length > 1 ? `s. Your cart was split into ${orders.length} orders, one per seller` : ""}.</p>${body}<p style="font-size:16px;text-align:right"><b>Grand total: ${money(total)}</b></p>${button(`${appUrl}/account?tab=orders`, "View your orders")}`),
      text: plain(
        "Thanks for your order!",
        ...orders.map((o) => `${o.companyName} ${o.orderNumber}: ${money(o.total)}`),
        `Grand total: ${money(total)}`,
        `${appUrl}/account?tab=orders`,
      ),
    };
  },

  newOrderForCompany: ({ companyName, orderNumber, customerEmail, businessName, items, total }) => ({
    subject: `New order ${orderNumber} for ${companyName}`,
    html: layout(`New order ${orderNumber}`, `<p>${esc(businessName || customerEmail)} placed an order with <b>${esc(companyName)}</b>.</p>${itemsTable(items)}<p style="text-align:right"><b>Total: ${money(total)}</b></p>${button(`${appUrl}/business/orders`, "Open orders")}`),
    text: plain(`New order ${orderNumber} from ${businessName || customerEmail}: ${money(total)}`, `${appUrl}/business/orders`),
  }),

  orderStatus: ({ name, orderNumber, companyName, status, trackingNumber }) => {
    const messages = {
      confirmed: "has been confirmed by the seller",
      processing: "is being prepared",
      shipped: "has shipped",
      delivered: "was delivered",
      cancelled: "was cancelled",
    };
    return {
      subject: `Order ${orderNumber} ${messages[status] || `is now ${status}`}`,
      html: layout(`Order ${orderNumber} update`, `<p>Hi ${esc(name || "there")},</p><p>Your order <b>${esc(orderNumber)}</b> from ${esc(companyName)} ${esc(messages[status] || `is now ${status}`)}.</p>${trackingNumber ? `<p>Tracking number: <b>${esc(trackingNumber)}</b></p>` : ""}${button(`${appUrl}/account?tab=orders`, "View order")}`),
      text: plain(`Order ${orderNumber} from ${companyName} ${messages[status] || `is now ${status}`}.`, trackingNumber && `Tracking: ${trackingNumber}`, `${appUrl}/account?tab=orders`),
    };
  },

  lowStock: ({ companyName, items }) => ({
    subject: `Low stock: ${items.length} product${items.length > 1 ? "s" : ""} at ${companyName}`,
    html: layout("Low stock alert", `<p>These products are at or below their reorder point:</p>
      <table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:12px 0">
      <tr style="background:#f9fafb;text-align:left"><th>Product</th><th>SKU</th><th align="right">Available</th><th align="right">Reorder at</th></tr>
      ${items.map((i) => `<tr style="border-top:1px solid #e5e7eb"><td>${esc(i.title)}</td><td>${esc(i.sku || "")}</td><td align="right"><b>${esc(i.available)}</b></td><td align="right">${esc(i.reorderPoint)}</td></tr>`).join("")}
      </table>${button(`${appUrl}/business/reorder`, "Create purchase orders")}`),
    text: plain("Low stock:", ...items.map((i) => `${i.title}: ${i.available} available (reorder at ${i.reorderPoint})`), `${appUrl}/business/reorder`),
  }),

  purchaseOrder: ({ companyName, companyEmail, companyPhone, companyAddress, supplierName, poNumber, orderDate, expectedDate, warehouse, items, subtotal, tax, shipping, total, notes }) => ({
    subject: `Purchase order ${poNumber} from ${companyName}`,
    html: layout(`Purchase order ${poNumber}`, `<p>Dear ${esc(supplierName)},</p>
      <p>Please supply the following items. Reply to this email to confirm the order${expectedDate ? ` and delivery by <b>${esc(expectedDate)}</b>` : ""}.</p>
      <p style="font-size:13px;color:#374151"><b>Order date:</b> ${esc(orderDate)}<br><b>Deliver to:</b> ${esc(warehouse)}</p>
      <table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:12px 0">
      <tr style="background:#f9fafb;text-align:left"><th>Item</th><th>Your SKU</th><th align="center">Qty</th><th align="right">Unit</th><th align="right">Total</th></tr>
      ${items.map((i) => `<tr style="border-top:1px solid #e5e7eb"><td>${esc(i.title)}</td><td>${esc(i.supplierSku || "")}</td><td align="center">${esc(i.quantity)}</td><td align="right">${money(i.unitCost)}</td><td align="right">${money(i.lineTotal)}</td></tr>`).join("")}
      </table>
      <p style="text-align:right;margin:0">Subtotal: ${money(subtotal)}<br>Tax: ${money(tax)}<br>Shipping: ${money(shipping)}<br><b>Total: ${money(total)}</b></p>
      ${notes ? `<p><b>Notes:</b> ${esc(notes)}</p>` : ""}
      <p style="font-size:13px;color:#374151">${esc(companyName)}${companyAddress ? `<br>${esc(companyAddress)}` : ""}${companyPhone ? `<br>${esc(companyPhone)}` : ""}${companyEmail ? `<br>${esc(companyEmail)}` : ""}</p>`),
    text: plain(
      `Purchase order ${poNumber} from ${companyName}`,
      `Deliver to: ${warehouse}${expectedDate ? `, by ${expectedDate}` : ""}`,
      ...items.map((i) => `${i.quantity} x ${i.title}${i.supplierSku ? ` (${i.supplierSku})` : ""} @ ${money(i.unitCost)} = ${money(i.lineTotal)}`),
      `Total: ${money(total)}`,
      notes && `Notes: ${notes}`,
    ),
  }),
  invoice: ({ name, companyName, invoiceNumber, orderNumber, total, balance, dueDate, onAccount }) => ({
    subject: `Invoice ${invoiceNumber} from ${companyName}`,
    html: layout(`Invoice ${invoiceNumber}`, `<p>Hi ${esc(name || "there")},</p>
      <p>${esc(companyName)} has issued invoice <b>${esc(invoiceNumber)}</b>${orderNumber ? ` for order ${esc(orderNumber)}` : ""}. The PDF is attached.</p>
      <p style="font-size:15px">Total: <b>${money(total)}</b><br>Balance due: <b>${money(balance)}</b>${balance > 0 && onAccount ? `<br>Due date: <b>${esc(dueDate)}</b>` : ""}</p>
      ${balance <= 0 ? "<p>This invoice is paid. Thank you!</p>" : onAccount ? "" : "<p>Payment is collected on delivery.</p>"}
      ${button(`${appUrl}/account?tab=invoices`, "View your invoices")}`),
    text: plain(`Invoice ${invoiceNumber} from ${companyName}`, `Total: ${money(total)}. Balance due: ${money(balance)}${balance > 0 && onAccount ? `, due ${dueDate}` : ""}.`, `${appUrl}/account?tab=invoices`),
  }),

  paymentReceived: ({ name, companyName, invoiceNumber, amount, balance }) => ({
    subject: `Payment received for ${invoiceNumber}`,
    html: layout("Payment received", `<p>Hi ${esc(name || "there")},</p><p>${esc(companyName)} received your payment of <b>${money(amount)}</b> for invoice <b>${esc(invoiceNumber)}</b>.</p><p>${balance > 0 ? `Remaining balance: <b>${money(balance)}</b>` : "The invoice is now fully paid. Thank you!"}</p>${button(`${appUrl}/account?tab=invoices`, "View your invoices")}`),
    text: plain(`${companyName} received ${money(amount)} for invoice ${invoiceNumber}.`, balance > 0 ? `Remaining balance: ${money(balance)}` : "The invoice is fully paid."),
  }),

  creditNote: ({ name, companyName, creditNoteNumber, total, invoiceNumber, applied, refunded, reason }) => ({
    subject: `Credit note ${creditNoteNumber} from ${companyName}`,
    html: layout(`Credit note ${creditNoteNumber}`, `<p>Hi ${esc(name || "there")},</p><p>${esc(companyName)} issued you a credit of <b>${money(total)}</b>${reason ? ` (${esc(reason)})` : ""}. The PDF is attached.</p>
      ${applied ? `<p>${money(applied)} was applied to invoice ${esc(invoiceNumber || "")}.</p>` : ""}${refunded ? `<p>${money(refunded)} will be refunded to you.</p>` : ""}
      ${button(`${appUrl}/account?tab=invoices`, "View your account")}`),
    text: plain(`${companyName} issued credit note ${creditNoteNumber} for ${money(total)}.`, applied && `${money(applied)} applied to invoice ${invoiceNumber || ""}.`, refunded && `${money(refunded)} will be refunded.`),
  }),

  quoteSent: ({ name, companyName, quoteNumber, total, validUntil }) => ({
    subject: `Quotation ${quoteNumber} from ${companyName}`,
    html: layout(`Your quotation ${quoteNumber}`, `<p>Hi ${esc(name || "there")},</p><p>${esc(companyName)} sent you a quotation for <b>${money(total)}</b>${validUntil ? `, valid until <b>${esc(validUntil)}</b>` : ""}. The PDF is attached.</p><p>You can accept it online and it becomes an order at these prices.</p>${button(`${appUrl}/account?tab=quotes`, "Review the quote")}`),
    text: plain(`${companyName} sent you quotation ${quoteNumber} for ${money(total)}${validUntil ? `, valid until ${validUntil}` : ""}.`, `${appUrl}/account?tab=quotes`),
  }),

  quoteRequested: ({ companyName, quoteNumber, customer, items, notes }) => ({
    subject: `Quote request ${quoteNumber} from ${customer}`,
    html: layout(`Quote request ${quoteNumber}`, `<p><b>${esc(customer)}</b> asked <b>${esc(companyName)}</b> for a quotation:</p>${itemsTable(items)}${notes ? `<p><b>Notes:</b> ${esc(notes)}</p>` : ""}${button(`${appUrl}/business/quotes`, "Prepare the quote")}`),
    text: plain(`Quote request ${quoteNumber} from ${customer}:`, ...items.map((i) => `${i.quantity} x ${i.title}`), notes && `Notes: ${notes}`, `${appUrl}/business/quotes`),
  }),

  quoteResponse: ({ companyName, quoteNumber, customer, accepted, orderNumber }) => ({
    subject: `Quote ${quoteNumber} ${accepted ? "accepted" : "declined"} by ${customer}`,
    html: layout(`Quote ${quoteNumber} ${accepted ? "accepted" : "declined"}`, `<p><b>${esc(customer)}</b> ${accepted ? `accepted quotation ${esc(quoteNumber)}. It is now order <b>${esc(orderNumber)}</b> at ${esc(companyName)}.` : `declined quotation ${esc(quoteNumber)}.`}</p>${button(`${appUrl}/business/${accepted ? "orders" : "quotes"}`, accepted ? "Open orders" : "Open quotes")}`),
    text: plain(`${customer} ${accepted ? `accepted quote ${quoteNumber} -> order ${orderNumber}` : `declined quote ${quoteNumber}`}.`),
  }),

  returnRequested: ({ companyName, rmaNumber, orderNumber, customer, reason, items, notes }) => ({
    subject: `Return request ${rmaNumber} for order ${orderNumber}`,
    html: layout(`Return request ${rmaNumber}`, `<p><b>${esc(customer)}</b> wants to return items from order <b>${esc(orderNumber)}</b> (${esc(companyName)}).</p><p>Reason: <b>${esc(reason)}</b></p>${itemsTable(items)}${notes ? `<p><b>Customer notes:</b> ${esc(notes)}</p>` : ""}${button(`${appUrl}/business/returns`, "Review the return")}`),
    text: plain(`Return request ${rmaNumber} for ${orderNumber} from ${customer}. Reason: ${reason}`, ...items.map((i) => `${i.quantity} x ${i.title}`), `${appUrl}/business/returns`),
  }),

  returnUpdate: ({ name, companyName, rmaNumber, orderNumber, status, staffNotes, creditTotal }) => {
    const messages = {
      approved: "was approved. Please send the items back to the seller and include the return number in the package.",
      rejected: "was not approved.",
      received: "arrived at the seller and is being checked.",
      closed: creditTotal ? `is complete. A credit of ${money(creditTotal)} was issued to you.` : "is complete.",
    };
    const msg = messages[status] || `is now ${status}.`;
    return {
      subject: `Return ${rmaNumber} ${status}`,
      html: layout(`Return ${rmaNumber}`, `<p>Hi ${esc(name || "there")},</p><p>Your return <b>${esc(rmaNumber)}</b> for order ${esc(orderNumber)} from ${esc(companyName)} ${esc(msg)}</p>${staffNotes ? `<p><b>Message from the seller:</b> ${esc(staffNotes)}</p>` : ""}${button(`${appUrl}/account?tab=returns`, "View your returns")}`),
      text: plain(`Return ${rmaNumber} (order ${orderNumber}, ${companyName}) ${msg}`, staffNotes && `Seller: ${staffNotes}`),
    };
  },
  supplierReturn: ({ companyName, companyEmail, companyPhone, supplierName, returnNumber, poNumber, reason, notes, items, total }) => ({
    subject: `Return ${returnNumber} from ${companyName}`,
    html: layout(`Goods return ${returnNumber}`, `<p>Dear ${esc(supplierName)},</p>
      <p>We are returning the following goods${poNumber ? ` from purchase order <b>${esc(poNumber)}</b>` : ""}. Reason: <b>${esc(reason)}</b>.</p>
      <table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:12px 0">
      <tr style="background:#f9fafb;text-align:left"><th>Item</th><th>Lot</th><th align="center">Qty</th><th align="right">Unit</th><th align="right">Total</th></tr>
      ${items.map((i) => `<tr style="border-top:1px solid #e5e7eb"><td>${esc(i.title)}</td><td>${esc(i.lot || "")}</td><td align="center">${esc(i.quantity)}</td><td align="right">${money(i.unitCost)}</td><td align="right">${money(i.lineTotal)}</td></tr>`).join("")}
      </table>
      <p style="text-align:right"><b>Value: ${money(total)}</b></p>
      ${notes ? `<p><b>Notes:</b> ${esc(notes)}</p>` : ""}
      <p>Please confirm and send us a credit note for this return, quoting <b>${esc(returnNumber)}</b>.</p>
      <p style="font-size:13px;color:#374151">${esc(companyName)}${companyPhone ? `<br>${esc(companyPhone)}` : ""}${companyEmail ? `<br>${esc(companyEmail)}` : ""}</p>`),
    text: plain(
      `Goods return ${returnNumber} from ${companyName}${poNumber ? ` (PO ${poNumber})` : ""}. Reason: ${reason}`,
      ...items.map((i) => `${i.quantity} x ${i.title}${i.lot ? ` (lot ${i.lot})` : ""} @ ${money(i.unitCost)} = ${money(i.lineTotal)}`),
      `Value: ${money(total)}`,
      notes && `Notes: ${notes}`,
      `Please send a credit note quoting ${returnNumber}.`,
    ),
  }),

  scheduledReport: ({ companyName, title, period, summary, columns, rows, rowCount, scheduleName }) => ({
    subject: `${title}${period ? ` · ${period}` : ""} · ${companyName}`,
    html: layout(title, `<p style="color:#6b7280;margin-top:0">${esc(companyName)}${period ? ` · ${esc(period)}` : ""}</p>
      ${(summary || []).length ? `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:8px 0 16px">${summary.map(([k, v]) => `<tr><td style="color:#6b7280">${esc(k)}</td><td style="font-weight:bold">${esc(v)}</td></tr>`).join("")}</table>` : ""}
      ${(rows || []).length ? `<table width="100%" cellpadding="5" cellspacing="0" style="border-collapse:collapse;font-size:12px"><tr style="background:#f9fafb;text-align:left">${columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr>
      ${rows.map((r) => `<tr style="border-top:1px solid #e5e7eb">${columns.map((c) => `<td>${esc(r[c.key] ?? "")}</td>`).join("")}</tr>`).join("")}</table>
      ${rowCount > rows.length ? `<p style="font-size:12px;color:#6b7280">Showing ${rows.length} of ${rowCount} rows. The full report is attached as CSV.</p>` : `<p style="font-size:12px;color:#6b7280">The report is attached as CSV.</p>`}` : "<p>Nothing to report for this period.</p>"}
      <p style="font-size:12px;color:#9ca3af">Scheduled report "${esc(scheduleName || title)}". Change or stop it in Reports &gt; Scheduled.</p>`),
    text: plain(`${title} · ${companyName}${period ? ` · ${period}` : ""}`, ...(summary || []).map(([k, v]) => `${k}: ${v}`), `${rowCount} row(s); full report attached as CSV.`),
  }),

  payslip: ({ name, companyName, period, net, payDate, payslipNumber }) => ({
    subject: `Your payslip for ${period} from ${companyName}`,
    html: layout(`Payslip ${payslipNumber}`, `<p>Hi ${esc(name || "there")},</p><p>Your payslip from <b>${esc(companyName)}</b> for <b>${esc(period)}</b> is attached.</p><p>Net pay: <b>${money(net)}</b>${payDate ? `, paid on <b>${esc(payDate)}</b>` : ""}.</p><p style="font-size:13px;color:#6b7280">Questions about your pay? Reply to your HR team.</p>`),
    text: plain(`Your payslip from ${companyName} for ${period} is attached.`, `Net pay: ${money(net)}${payDate ? `, paid on ${payDate}` : ""}.`),
  }),

  leaveRequested: ({ companyName, employee, leaveType, from, to, days, reason }) => ({
    subject: `Leave request: ${employee}, ${days} day(s) of ${leaveType}`,
    html: layout("Leave request", `<p><b>${esc(employee)}</b> asked for <b>${esc(days)}</b> day(s) of <b>${esc(leaveType)}</b> (${esc(from)} to ${esc(to)}) at ${esc(companyName)}.</p>${reason ? `<p><b>Reason:</b> ${esc(reason)}</p>` : ""}${button(`${appUrl}/business/leave`, "Review the request")}`),
    text: plain(`${employee} asked for ${days} day(s) of ${leaveType} (${from} to ${to}).`, reason && `Reason: ${reason}`, `${appUrl}/business/leave`),
  }),

  leaveDecision: ({ name, companyName, leaveType, from, to, days, status, notes }) => ({
    subject: `Your leave request was ${status}`,
    html: layout(`Leave ${status}`, `<p>Hi ${esc(name || "there")},</p><p>Your request for <b>${esc(days)}</b> day(s) of <b>${esc(leaveType)}</b> (${esc(from)} to ${esc(to)}) at ${esc(companyName)} was <b>${esc(status)}</b>.</p>${notes ? `<p><b>Note:</b> ${esc(notes)}</p>` : ""}`),
    text: plain(`Your request for ${days} day(s) of ${leaveType} (${from} to ${to}) was ${status}.`, notes && `Note: ${notes}`),
  }),
};

module.exports = { templates, esc, money };
