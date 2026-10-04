// PDF documents: invoices, credit notes, quotes and payslips (pdfkit, built-in Helvetica, A4).
// pdfFor(kind, id) -> { filename, content: Buffer } is also used to attach PDFs to emails.
const PDFDocument = require("pdfkit");
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");
const { num, round2 } = require("./money");

const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const moneyFmt = (currency) => {
  let f;
  try {
    f = new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" });
  } catch {
    f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  }
  return (n) => f.format(Number(n || 0));
};
const join = (...parts) => parts.filter((p) => p !== null && p !== undefined && String(p).trim() !== "").join(", ");

const companyBlock = (c) => ({
  name: c.legal_name || c.name,
  lines: [
    join(c.address_line1, c.address_line2),
    join(c.city, c.state, c.postal_code),
    c.country && c.country !== "USA" ? c.country : null,
    c.phone,
    c.email,
    c.tax_id ? `Tax ID: ${c.tax_id}` : null,
  ].filter(Boolean),
});

const partyFromUser = (u, address, extra = {}) => ({
  name: extra.business_name || u?.business_name || [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.email || "Customer",
  lines: [
    u?.business_name && (u.first_name || u.last_name) ? [u.first_name, u.last_name].filter(Boolean).join(" ") : null,
    address ? join(address.address_line1 || address.street || address.line1, address.address_line2 || address.line2) : null,
    address ? join(address.city, address.state, address.postal_code || address.zip || address.zip_code) : null,
    u?.email,
    u?.phone,
    extra.tax_id ? `Tax ID: ${extra.tax_id}` : null,
  ].filter(Boolean),
});

/**
 * Generic business document.
 * doc = { title, number, company, party: {label, name, lines}, meta: [[label, value]], items: [{description, quantity, unit_price, line_total}],
 *         totals: [[label, value, bold?]], notes, footer, currency, stamp }
 */
const render = (doc) =>
  new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 48, info: { Title: `${doc.title} ${doc.number}` } });
    const chunks = [];
    pdf.on("data", (c) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    const m = moneyFmt(doc.currency);
    const L = 48;
    const R = pdf.page.width - 48;
    const W = R - L;
    const grey = "#6b7280";
    const dark = "#111827";

    // header: company left, title right
    pdf.fillColor(dark).font("Helvetica-Bold").fontSize(16).text(doc.company.name, L, 48, { width: W * 0.55 });
    pdf.font("Helvetica").fontSize(9).fillColor(grey);
    for (const line of doc.company.lines) pdf.text(line, { width: W * 0.55 });
    const leftBottom = pdf.y;

    pdf.fillColor(dark).font("Helvetica-Bold").fontSize(20).text(doc.title.toUpperCase(), L + W * 0.55, 48, { width: W * 0.45, align: "right" });
    pdf.font("Helvetica").fontSize(10).fillColor(dark).text(doc.number, { width: W * 0.45, align: "right" });
    pdf.moveDown(0.4);
    // label / value pairs in two fixed columns (right side of the header)
    let my = pdf.y;
    const meta = doc.meta.filter(([, v]) => v !== null && v !== undefined && v !== "");
    pdf.fontSize(9);
    const vw = Math.min(W * 0.33, Math.max(40, ...meta.map(([, v]) => pdf.widthOfString(String(v)) + 2)));
    const lw = W * 0.2;
    for (const [label, value] of meta) {
      const h = pdf.heightOfString(String(value), { width: vw });
      pdf.fillColor(grey).text(`${label}:`, R - vw - 8 - lw, my, { width: lw, align: "right" });
      pdf.fillColor(dark).text(String(value), R - vw, my, { width: vw, align: "right" });
      my += Math.max(h, 11) + 2;
    }
    if (doc.stamp) {
      pdf.font("Helvetica-Bold").fontSize(11).fillColor(doc.stamp.color || "#b91c1c").text(doc.stamp.text, L + W * 0.55, my + 4, { width: W * 0.45, align: "right" });
      pdf.font("Helvetica");
      my = pdf.y;
    }
    pdf.y = my;
    let y = Math.max(leftBottom, pdf.y) + 22;

    // bill-to
    pdf.fillColor(grey).fontSize(8).text(doc.party.label.toUpperCase(), L, y);
    pdf.fillColor(dark).font("Helvetica-Bold").fontSize(11).text(doc.party.name, L, pdf.y + 2, { width: W * 0.6 });
    pdf.font("Helvetica").fontSize(9).fillColor("#374151");
    for (const line of doc.party.lines) pdf.text(line, { width: W * 0.6 });
    y = pdf.y + 20;

    // items table
    const cols = [
      { key: "description", label: "Description", x: L, w: W * 0.52, align: "left" },
      { key: "quantity", label: "Qty", x: L + W * 0.52, w: W * 0.1, align: "right" },
      { key: "unit_price", label: "Unit price", x: L + W * 0.62, w: W * 0.18, align: "right" },
      { key: "line_total", label: "Amount", x: L + W * 0.8, w: W * 0.2, align: "right" },
    ];
    const header = () => {
      pdf.rect(L, y, W, 20).fill("#f3f4f6");
      pdf.fillColor("#374151").font("Helvetica-Bold").fontSize(9);
      for (const c of cols) pdf.text(c.label, c.x + 4, y + 6, { width: c.w - 8, align: c.align });
      pdf.font("Helvetica");
      y += 24;
    };
    header();
    for (const item of doc.items) {
      const cells = {
        description: item.description,
        quantity: String(item.quantity),
        unit_price: m(item.unit_price),
        line_total: m(item.line_total),
      };
      pdf.fontSize(9);
      const h = Math.max(...cols.map((c) => pdf.heightOfString(cells[c.key], { width: c.w - 8 }))) + 8;
      if (y + h > pdf.page.height - 120) {
        pdf.addPage();
        y = 48;
        header();
      }
      pdf.fillColor(dark);
      for (const c of cols) pdf.text(cells[c.key], c.x + 4, y + 2, { width: c.w - 8, align: c.align });
      y += h;
      pdf.moveTo(L, y - 2).lineTo(R, y - 2).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
    }
    if (!doc.items.length) {
      pdf.fillColor(grey).fontSize(9).text("No items", L + 4, y + 2);
      y += 18;
    }

    // totals
    y += 8;
    if (y > pdf.page.height - 48 - doc.totals.length * 16) {
      pdf.addPage();
      y = 48;
    }
    for (const [label, value, bold] of doc.totals) {
      pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9.5).fillColor(dark);
      pdf.text(label, L + W * 0.5, y, { width: W * 0.3, align: "right" });
      pdf.text(typeof value === "number" ? m(value) : String(value), L + W * 0.8, y, { width: W * 0.2 - 4, align: "right" });
      y += bold ? 18 : 15;
    }
    pdf.font("Helvetica");

    if (doc.notes) {
      y += 14;
      if (y > pdf.page.height - 100) {
        pdf.addPage();
        y = 48;
      }
      pdf.fillColor(grey).fontSize(8).text("NOTES", L, y);
      pdf.fillColor("#374151").fontSize(9).text(doc.notes, L, pdf.y + 2, { width: W });
    }
    if (doc.footer) {
      pdf.fillColor(grey).fontSize(8).text(doc.footer, L, pdf.page.height - 70, { width: W, align: "center" });
    }
    pdf.end();
  });

// ---- loaders --------------------------------------------------------------------------

const userSelect = { id: true, email: true, first_name: true, last_name: true, business_name: true, phone: true };

const invoiceDoc = async (id, companyId) => {
  const inv = await prisma.invoices.findFirst({
    where: { id: BigInt(id), ...(companyId ? { company_id: BigInt(companyId) } : {}) },
    include: { companies: true, invoice_items: { orderBy: { id: "asc" } }, orders: { select: { order_number: true } }, users: { select: userSelect } },
  });
  if (!inv) throw new HttpError(404, "Invoice not found");
  const snap = inv.billing_snapshot || {};
  const balance = round2(num(inv.total_amount) - num(inv.amount_paid) - num(inv.amount_credited));
  const overdue = inv.status !== "void" && balance > 0 && new Date(inv.due_date) < new Date(new Date().toISOString().slice(0, 10));
  const totals = [["Subtotal", num(inv.subtotal)]];
  if (num(inv.discount_amount)) totals.push(["Discount", -num(inv.discount_amount)]);
  if (num(inv.shipping_amount)) totals.push(["Shipping", num(inv.shipping_amount)]);
  if (num(inv.tax_amount)) totals.push(["Tax", num(inv.tax_amount)]);
  if (num(inv.excise_amount)) totals.push(["Excise tax", num(inv.excise_amount)]);
  totals.push(["Total", num(inv.total_amount), true]);
  if (num(inv.amount_paid)) totals.push(["Paid", -num(inv.amount_paid)]);
  if (num(inv.amount_credited)) totals.push(["Credited", -num(inv.amount_credited)]);
  totals.push(["Balance due", inv.status === "void" ? 0 : balance, true]);
  const terms = Math.round((new Date(inv.due_date) - new Date(inv.issue_date)) / 86400000);
  return {
    filename: `${inv.invoice_number}.pdf`,
    doc: {
      title: "Invoice",
      number: inv.invoice_number,
      currency: inv.currency,
      company: companyBlock(inv.companies),
      party: { label: "Bill to", ...partyFromUser(snap.user || inv.users, snap.address, { business_name: snap.business_name, tax_id: snap.tax_id }) },
      meta: [
        ["Issue date", fmtDate(inv.issue_date)],
        ["Due date", fmtDate(inv.due_date)],
        ["Terms", terms > 0 ? `Net ${terms}` : inv.payment_method === "cash_on_delivery" ? "Cash on delivery" : "Due on receipt"],
        ["Order", inv.orders?.order_number],
      ],
      stamp: inv.status === "void" ? { text: "VOID" } : inv.status === "paid" ? { text: "PAID", color: "#047857" } : overdue ? { text: "OVERDUE" } : null,
      items: inv.invoice_items,
      totals,
      notes: inv.notes,
      footer: `${inv.companies.name} · Invoice ${inv.invoice_number}`,
    },
  };
};

const creditNoteDoc = async (id, companyId) => {
  const cn = await prisma.credit_notes.findFirst({
    where: { id: BigInt(id), ...(companyId ? { company_id: BigInt(companyId) } : {}) },
    include: {
      companies: true,
      credit_note_items: { orderBy: { id: "asc" } },
      invoices: { select: { invoice_number: true, billing_snapshot: true } },
      return_requests: { select: { rma_number: true } },
      users: { select: userSelect },
    },
  });
  if (!cn) throw new HttpError(404, "Credit note not found");
  const snap = cn.invoices?.billing_snapshot || {};
  const remaining = round2(num(cn.total_amount) - num(cn.amount_applied) - num(cn.amount_refunded));
  const totals = [["Subtotal", num(cn.subtotal)]];
  if (num(cn.tax_amount)) totals.push(["Tax", num(cn.tax_amount)]);
  totals.push(["Credit total", num(cn.total_amount), true]);
  if (num(cn.amount_applied)) totals.push(["Applied to invoices", -num(cn.amount_applied)]);
  if (num(cn.amount_refunded)) totals.push(["Refunded", -num(cn.amount_refunded)]);
  totals.push(["Credit remaining", cn.status === "void" ? 0 : remaining, true]);
  return {
    filename: `${cn.credit_note_number}.pdf`,
    doc: {
      title: "Credit note",
      number: cn.credit_note_number,
      currency: cn.companies.currency,
      company: companyBlock(cn.companies),
      party: { label: "Credit to", ...partyFromUser(snap.user || cn.users, snap.address, { business_name: snap.business_name, tax_id: snap.tax_id }) },
      meta: [
        ["Date", fmtDate(cn.created_at)],
        ["Invoice", cn.invoices?.invoice_number],
        ["Return", cn.return_requests?.rma_number],
        ["Reason", cn.reason],
      ],
      stamp: cn.status === "void" ? { text: "VOID" } : null,
      items: cn.credit_note_items,
      totals,
      notes: cn.notes,
      footer: `${cn.companies.name} · Credit note ${cn.credit_note_number}`,
    },
  };
};

const quoteDoc = async (id, companyId) => {
  const q = await prisma.quotes.findFirst({
    where: { id: BigInt(id), ...(companyId ? { company_id: BigInt(companyId) } : {}) },
    include: {
      companies: true,
      quote_items: { orderBy: { id: "asc" }, include: { products: { select: { title: true, sku: true } } } },
      users: { select: userSelect },
    },
  });
  if (!q) throw new HttpError(404, "Quote not found");
  const totals = [["Subtotal", num(q.subtotal)]];
  if (num(q.discount_amount)) totals.push(["Discount", -num(q.discount_amount)]);
  totals.push(["Shipping", num(q.shipping_amount)]);
  if (num(q.tax_amount)) totals.push(["Tax", num(q.tax_amount)]);
  totals.push(["Total", num(q.total_amount), true]);
  return {
    filename: `${q.quote_number}.pdf`,
    doc: {
      title: "Quotation",
      number: q.quote_number,
      currency: q.companies.currency,
      company: companyBlock(q.companies),
      party: { label: "Prepared for", ...partyFromUser(q.users) },
      meta: [
        ["Date", fmtDate(q.sent_at || q.created_at)],
        ["Valid until", fmtDate(q.valid_until)],
      ],
      stamp: ["declined", "expired", "cancelled"].includes(q.status) ? { text: q.status.toUpperCase() } : q.status === "accepted" ? { text: "ACCEPTED", color: "#047857" } : null,
      items: q.quote_items.map((i) => ({
        description: i.description || [i.products?.title, i.flavor ? `- ${i.flavor}` : null, i.products?.sku ? `(${i.products.sku})` : null].filter(Boolean).join(" "),
        quantity: i.quantity,
        unit_price: i.unit_price,
        line_total: i.line_total,
      })),
      totals,
      notes: q.notes,
      footer: `${q.companies.name} · Quotation ${q.quote_number} · Prices valid until ${fmtDate(q.valid_until) || "further notice"}`,
    },
  };
};

// Payslip: its own layout (earnings and deductions side by side).
const renderPayslip = (d) =>
  new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Payslip ${d.number}` } });
    const chunks = [];
    pdf.on("data", (c) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    const m = moneyFmt(d.currency);
    const L = 48, R = pdf.page.width - 48, W = R - L;
    const grey = "#6b7280", dark = "#111827";

    pdf.fillColor(dark).font("Helvetica-Bold").fontSize(16).text(d.company.name, L, 48, { width: W * 0.6 });
    pdf.font("Helvetica").fontSize(9).fillColor(grey);
    for (const line of d.company.lines) pdf.text(line, { width: W * 0.6 });
    const leftBottom = pdf.y;
    pdf.fillColor(dark).font("Helvetica-Bold").fontSize(20).text("PAYSLIP", L + W * 0.6, 48, { width: W * 0.4, align: "right" });
    pdf.font("Helvetica").fontSize(9).fillColor(grey).text(d.number, { width: W * 0.4, align: "right" });
    pdf.fillColor(dark).text(`Pay period: ${d.period}`, { width: W * 0.4, align: "right" });
    pdf.text(`Pay date: ${d.payDate}`, { width: W * 0.4, align: "right" });
    if (d.stamp) pdf.font("Helvetica-Bold").fontSize(11).fillColor(d.stamp.color).text(d.stamp.text, { width: W * 0.4, align: "right" });
    let y = Math.max(leftBottom, pdf.y) + 20;

    // employee box
    pdf.rect(L, y, W, 64).fill("#f9fafb");
    const col = (label, value, x, yy, w) => {
      pdf.fillColor(grey).font("Helvetica").fontSize(7.5).text(label.toUpperCase(), x, yy, { width: w });
      pdf.fillColor(dark).fontSize(9.5).text(value || "-", x, yy + 10, { width: w });
    };
    const cw = W / 4;
    col("Employee", d.employee.name, L + 10, y + 10, cw - 10);
    col("Employee no.", d.employee.number, L + cw, y + 10, cw);
    col("Department", d.employee.department, L + cw * 2, y + 10, cw);
    col("Job title", d.employee.title, L + cw * 3, y + 10, cw - 10);
    col("Pay basis", d.employee.basis, L + 10, y + 36, cw - 10);
    col("Paid days", d.days, L + cw, y + 36, cw);
    col("Overtime", d.overtime, L + cw * 2, y + 36, cw);
    col("Paid to", d.employee.paidTo, L + cw * 3, y + 36, cw - 10);
    y += 82;

    // earnings | deductions
    const half = (W - 16) / 2;
    const table = (title, rows, x, total) => {
      let yy = y;
      pdf.rect(x, yy, half, 20).fill("#f3f4f6");
      pdf.fillColor("#374151").font("Helvetica-Bold").fontSize(9).text(title, x + 6, yy + 6, { width: half / 2 });
      pdf.text("Amount", x + half / 2, yy + 6, { width: half / 2 - 6, align: "right" });
      yy += 24;
      pdf.font("Helvetica").fillColor(dark);
      if (!rows.length) { pdf.fillColor(grey).text("None", x + 6, yy); yy += 16; }
      for (const r of rows) {
        const h = pdf.heightOfString(r.name, { width: half * 0.65 }) + 6;
        pdf.fillColor(dark).text(r.name, x + 6, yy, { width: half * 0.65 });
        pdf.text(m(r.amount), x + half * 0.65, yy, { width: half * 0.35 - 6, align: "right" });
        yy += h;
        pdf.moveTo(x, yy - 2).lineTo(x + half, yy - 2).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
      }
      pdf.font("Helvetica-Bold").text(`Total ${title.toLowerCase()}`, x + 6, yy + 4, { width: half * 0.65 });
      pdf.text(m(total), x + half * 0.65, yy + 4, { width: half * 0.35 - 6, align: "right" });
      return yy + 22;
    };
    const y1 = table("Earnings", d.earnings, L, d.gross);
    const y2 = table("Deductions", d.deductions, L + half + 16, d.totalDeductions);
    y = Math.max(y1, y2) + 10;

    pdf.rect(L, y, W, 34).fill("#ecfdf5");
    pdf.fillColor("#065f46").font("Helvetica-Bold").fontSize(13).text("NET PAY", L + 12, y + 11);
    pdf.text(m(d.net), L, y + 11, { width: W - 12, align: "right" });
    y += 50;

    pdf.font("Helvetica").fontSize(8.5).fillColor(grey);
    if (d.employer.length) {
      pdf.text(`Paid by the employer on top of your pay (not deducted): ${d.employer.map((e) => `${e.name} ${m(e.amount)}`).join(", ")}`, L, y, { width: W });
      y = pdf.y + 8;
    }
    if (d.notes) pdf.text(d.notes, L, y, { width: W });
    pdf.fontSize(8).text(`${d.company.name} · ${d.number} · This payslip is confidential.`, L, pdf.page.height - 70, { width: W, align: "center" });
    pdf.end();
  });

const payslipDoc = async (id, companyId) => {
  const p = await prisma.payslips.findFirst({
    where: { id: BigInt(id), ...(companyId ? { company_id: BigInt(companyId) } : {}) },
    include: { payslip_lines: { orderBy: { sort_order: "asc" } }, payroll_runs: true },
  });
  if (!p) throw new HttpError(404, "Payslip not found");
  const company = await prisma.companies.findUnique({ where: { id: p.company_id } });
  const s = p.snapshot || {};
  const run = p.payroll_runs;
  const m = moneyFmt(company.currency);
  const lines = (k) => p.payslip_lines.filter((l) => l.kind === k).map((l) => ({ name: l.name, amount: num(l.amount) }));
  return {
    filename: `Payslip-${p.payslip_number}.pdf`,
    render: () => renderPayslip({
      number: p.payslip_number,
      currency: company.currency,
      company: companyBlock(company),
      period: `${fmtDate(run.period_start)} to ${fmtDate(run.period_end)}`,
      payDate: fmtDate(run.paid_at || run.pay_date),
      stamp: run.status === "void" ? { text: "VOID", color: "#b91c1c" } : run.status === "draft" ? { text: "DRAFT", color: "#b45309" } : run.status === "paid" ? { text: "PAID", color: "#047857" } : null,
      employee: {
        name: s.name, number: s.employee_number, department: s.department, title: s.job_title,
        basis: s.pay_type === "hourly" ? `Hourly, ${m(s.hourly_rate)}/h` : `Monthly salary, ${m(s.base_salary)}`,
        paidTo: s.payment_method === "bank_transfer" ? `${s.bank_name || "Bank"}${s.bank_account_last4 ? ` ****${s.bank_account_last4}` : ""}` : s.payment_method === "check" ? "Check" : "Cash",
      },
      days: `${num(p.paid_days)} of ${num(p.working_days)}${num(p.unpaid_days) ? ` (${num(p.unpaid_days)} unpaid)` : ""}`,
      overtime: num(p.overtime_hours) ? `${num(p.overtime_hours)} h` : "-",
      earnings: lines("earning"), deductions: lines("deduction"), employer: lines("employer"),
      gross: num(p.gross), totalDeductions: num(p.total_deductions), net: num(p.net),
      notes: company.settings?.payroll?.payslipNotes || null,
    }),
  };
};

const LOADERS = { invoice: invoiceDoc, credit_note: creditNoteDoc, quote: quoteDoc, payslip: payslipDoc };

const pdfFor = async (kind, id, companyId = null) => {
  const load = LOADERS[kind];
  if (!load) throw new Error(`Unknown document kind: ${kind}`);
  const loaded = await load(id, companyId);
  return { filename: loaded.filename, content: loaded.render ? await loaded.render() : await render(loaded.doc) };
};

// Email attachment: PDFs, or a scheduled report's CSV.
const attachmentFor = async (kind, id) => {
  if (kind === "report_run") {
    const run = await prisma.report_runs.findUnique({ where: { id: BigInt(id) } });
    if (!run) throw new Error("Report run not found");
    const name = `${run.title.replace(/[^A-Za-z0-9 _-]+/g, "").replace(/\s+/g, "-")}${run.period_to ? `-${fmtDate(run.period_to)}` : ""}.csv`;
    return { filename: name, content: Buffer.from(run.csv, "utf8"), contentType: "text/csv" };
  }
  const { filename, content } = await pdfFor(kind, id);
  return { filename, content, contentType: "application/pdf" };
};

// Express helper: streams a PDF (inline so the browser can preview it).
const sendPdf = async (res, kind, id, companyId) => {
  const { filename, content } = await pdfFor(kind, id, companyId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(content);
};

module.exports = { pdfFor, sendPdf, render, attachmentFor };
