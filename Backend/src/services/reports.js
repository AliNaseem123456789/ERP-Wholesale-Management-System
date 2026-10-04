// Reports that can be run on demand or emailed on a schedule. Each returns
// { title, columns: [{ key, label }], rows, summary: [[label, value]] } for a period { from, to } (YYYY-MM-DD).
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");
const { round2, num } = require("./money");
const inv = require("./inventory");
const hr = require("./hr");

const col = (key, label = key.replace(/_/g, " ")) => ({ key, label });
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const agingCols = [col("current", "not due"), col("d1_30", "1-30 days"), col("d31_60", "31-60 days"), col("d61_90", "61-90 days"), col("d90_plus", "90+ days"), col("total")];
const agingKeys = ["current", "d1_30", "d31_60", "d61_90", "d90_plus", "total"];
const fixAging = (rows) => rows.map((r) => ({ ...r, ...Object.fromEntries(agingKeys.map((k) => [k, round2(r[k] || 0)])) }));

const REPORTS = {
  sales_summary: {
    label: "Sales summary", perm: ["reports.view", "orders.view"], period: true,
    run: async (cid, { from, to }) => {
      const rows = await prisma.$queryRaw`
        SELECT to_char(d::date, 'YYYY-MM-DD') AS date,
               COUNT(o.id)::int AS orders,
               COALESCE(SUM(o.total_amount), 0)::float AS revenue,
               COALESCE(SUM(o.excise_amount), 0)::float AS excise
        FROM generate_series(${from}::date, ${to}::date, interval '1 day') d
        LEFT JOIN orders o ON o.company_id = ${cid} AND o.created_at::date = d::date AND COALESCE(o.status, 'pending') <> 'cancelled'
        GROUP BY d ORDER BY d`;
      const orders = rows.reduce((s, r) => s + r.orders, 0);
      const revenue = round2(rows.reduce((s, r) => s + r.revenue, 0));
      const [top] = await prisma.$queryRaw`
        SELECT p.title, SUM(oi.quantity)::int AS units FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
        WHERE o.company_id = ${cid} AND COALESCE(o.status,'pending') <> 'cancelled' AND o.created_at::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY p.title ORDER BY units DESC LIMIT 1`;
      const [cust] = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS n FROM company_customers WHERE company_id = ${cid} AND created_at::date BETWEEN ${from}::date AND ${to}::date`;
      return {
        title: "Sales summary",
        columns: [col("date"), col("orders"), col("revenue"), col("excise", "excise tax")],
        rows: rows.map((r) => ({ ...r, revenue: round2(r.revenue), excise: round2(r.excise) })),
        summary: [["Orders", orders], ["Revenue", money(revenue)], ["Average order", money(orders ? revenue / orders : 0)], ["New customers", cust.n], ["Top product", top ? `${top.title} (${top.units})` : "—"]],
      };
    },
  },
  sales_by_product: {
    label: "Sales by product", perm: ["reports.view", "orders.view"], period: true,
    run: async (cid, { from, to }) => {
      const rows = await prisma.$queryRaw`
        SELECT p.sku, p.title, COALESCE(NULLIF(oi.flavor, ''), '') AS flavor, SUM(oi.quantity)::int AS units, SUM(oi.quantity * oi.price_at_time)::float AS revenue
        FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
        WHERE o.company_id = ${cid} AND COALESCE(o.status,'pending') <> 'cancelled' AND o.created_at::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY p.sku, p.title, oi.flavor ORDER BY revenue DESC`;
      const total = round2(rows.reduce((s, r) => s + r.revenue, 0));
      return { title: "Sales by product", columns: [col("sku"), col("title"), col("flavor"), col("units"), col("revenue")], rows: rows.map((r) => ({ ...r, revenue: round2(r.revenue) })), summary: [["Products sold", rows.length], ["Units", rows.reduce((s, r) => s + r.units, 0)], ["Revenue", money(total)]] };
    },
  },
  ar_aging: {
    label: "Customers owing (A/R aging)", perm: ["invoices.view", "reports.view"],
    run: async (cid, { to }) => {
      const rows = fixAging(await prisma.$queryRaw`
        SELECT COALESCE(NULLIF(u.business_name, ''), u.email) AS customer, COUNT(*)::int AS invoices,
          SUM(i.total_amount - i.amount_paid - i.amount_credited) FILTER (WHERE i.due_date >= ${to}::date)::float AS current,
          SUM(i.total_amount - i.amount_paid - i.amount_credited) FILTER (WHERE (${to}::date - i.due_date) BETWEEN 1 AND 30)::float AS d1_30,
          SUM(i.total_amount - i.amount_paid - i.amount_credited) FILTER (WHERE (${to}::date - i.due_date) BETWEEN 31 AND 60)::float AS d31_60,
          SUM(i.total_amount - i.amount_paid - i.amount_credited) FILTER (WHERE (${to}::date - i.due_date) BETWEEN 61 AND 90)::float AS d61_90,
          SUM(i.total_amount - i.amount_paid - i.amount_credited) FILTER (WHERE (${to}::date - i.due_date) > 90)::float AS d90_plus,
          SUM(i.total_amount - i.amount_paid - i.amount_credited)::float AS total
        FROM invoices i LEFT JOIN users u ON u.id = i.user_id
        WHERE i.company_id = ${cid} AND i.status IN ('issued','partially_paid')
        GROUP BY u.business_name, u.email HAVING SUM(i.total_amount - i.amount_paid - i.amount_credited) > 0 ORDER BY total DESC`);
      const total = round2(rows.reduce((s, r) => s + r.total, 0));
      const overdue = round2(rows.reduce((s, r) => s + r.total - r.current, 0));
      return { title: "Customers owing (A/R aging)", columns: [col("customer"), col("invoices"), ...agingCols], rows, summary: [["Owed to you", money(total)], ["Overdue", money(overdue)], ["Customers", rows.length]] };
    },
  },
  ap_aging: {
    label: "Bills to pay (A/P aging)", perm: ["accounting.view", "accounting.manage"],
    run: async (cid, { to }) => {
      const rows = fixAging(await prisma.$queryRaw`
        SELECT s.name AS supplier, COUNT(*)::int AS bills,
          SUM(b.total_amount - b.amount_paid - b.amount_credited) FILTER (WHERE b.due_date >= ${to}::date)::float AS current,
          SUM(b.total_amount - b.amount_paid - b.amount_credited) FILTER (WHERE (${to}::date - b.due_date) BETWEEN 1 AND 30)::float AS d1_30,
          SUM(b.total_amount - b.amount_paid - b.amount_credited) FILTER (WHERE (${to}::date - b.due_date) BETWEEN 31 AND 60)::float AS d31_60,
          SUM(b.total_amount - b.amount_paid - b.amount_credited) FILTER (WHERE (${to}::date - b.due_date) BETWEEN 61 AND 90)::float AS d61_90,
          SUM(b.total_amount - b.amount_paid - b.amount_credited) FILTER (WHERE (${to}::date - b.due_date) > 90)::float AS d90_plus,
          SUM(b.total_amount - b.amount_paid - b.amount_credited)::float AS total
        FROM bills b JOIN suppliers s ON s.id = b.supplier_id
        WHERE b.company_id = ${cid} AND b.status IN ('open','partially_paid')
        GROUP BY s.name HAVING SUM(b.total_amount - b.amount_paid - b.amount_credited) > 0 ORDER BY total DESC`);
      return { title: "Bills to pay (A/P aging)", columns: [col("supplier"), col("bills"), ...agingCols], rows, summary: [["You owe", money(rows.reduce((s, r) => s + r.total, 0))], ["Overdue", money(rows.reduce((s, r) => s + r.total - r.current, 0))]] };
    },
  },
  low_stock: {
    label: "Low stock", perm: ["inventory.view"],
    run: async (cid) => {
      const products = await prisma.products.findMany({ where: { company_id: cid, is_active: true, reorder_point: { gt: 0 } }, select: { id: true, title: true, sku: true, flavors: true, reorder_point: true, reorder_quantity: true } });
      const low = await inv.lowLines(products);
      const rows = low.map((l) => ({ sku: l.product.sku, title: l.product.title, flavor: l.flavor, available: l.available, reorder_point: l.product.reorder_point, reorder_quantity: l.product.reorder_quantity }));
      return { title: "Low stock", columns: [col("sku"), col("title"), col("flavor"), col("available"), col("reorder_point", "reorder point"), col("reorder_quantity", "reorder qty")], rows, summary: [["Items at or below reorder point", rows.length], ["Out of stock", rows.filter((r) => r.available <= 0).length]] };
    },
  },
  inventory_valuation: {
    label: "Stock valuation", perm: ["inventory.view"],
    run: async (cid) => {
      const rows = await prisma.$queryRaw`
        SELECT w.code AS warehouse, w.name, COUNT(DISTINCT l.product_id) FILTER (WHERE l.on_hand > 0)::int AS products,
               COALESCE(SUM(l.on_hand), 0)::int AS units, COALESCE(SUM(l.on_hand * p.cost_price), 0)::float AS value
        FROM warehouses w LEFT JOIN inventory_levels l ON l.warehouse_id = w.id LEFT JOIN products p ON p.id = l.product_id
        WHERE w.company_id = ${cid} GROUP BY w.id ORDER BY w.code`;
      const total = round2(rows.reduce((s, r) => s + r.value, 0));
      return { title: "Stock valuation", columns: [col("warehouse"), col("name"), col("products"), col("units"), col("value")], rows: rows.map((r) => ({ ...r, value: round2(r.value) })), summary: [["Units", rows.reduce((s, r) => s + r.units, 0)], ["Value (average cost)", money(total)]] };
    },
  },
  expiring_lots: {
    label: "Lots expiring in 60 days", perm: ["inventory.view"],
    run: async (cid, { to }) => {
      const rows = await prisma.$queryRaw`
        SELECT w.code AS warehouse, p.sku, p.title, l.flavor, l.lot_number, to_char(l.expiry_date, 'YYYY-MM-DD') AS expiry_date, l.quantity
        FROM inventory_lots l JOIN products p ON p.id = l.product_id JOIN warehouses w ON w.id = l.warehouse_id
        WHERE l.company_id = ${cid} AND l.quantity > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= (${to}::date + 60)
        ORDER BY l.expiry_date, p.title`;
      return { title: "Lots expiring in 60 days", columns: [col("warehouse"), col("sku"), col("title"), col("flavor"), col("lot_number", "lot"), col("expiry_date", "expires"), col("quantity")], rows, summary: [["Lots", rows.length], ["Already expired", rows.filter((r) => r.expiry_date < to).length]] };
    },
  },
  profit_loss: {
    label: "Profit & loss", perm: ["accounting.view", "accounting.manage"], period: true,
    run: async (cid, { from, to }) => {
      const { plFor } = require("../controllers/company/accounting.controller");
      const pl = await plFor(BigInt(cid), from, to);
      const sec = (name, list) => list.map((a) => ({ section: name, code: a.code, account: a.name, amount: a.amount }));
      const rows = [...sec("Income", pl.sections.income), ...sec("Cost of sales", pl.sections.cogs), ...sec("Expenses", pl.sections.expenses), ...sec("Other income", pl.sections.otherIncome), ...sec("Other expenses", pl.sections.otherExpenses)];
      return { title: "Profit & loss", columns: [col("section"), col("code"), col("account"), col("amount")], rows, summary: [["Income", money(pl.totals.revenue)], ["Gross profit", money(pl.totals.grossProfit)], ["Expenses", money(pl.totals.expenses)], ["Net profit", money(pl.totals.netIncome)]] };
    },
  },
  excise_by_state: {
    label: "Tobacco excise by state", perm: ["reports.view", "accounting.view", "invoices.view"], period: true,
    run: async (cid, { from, to }) => {
      const rows = await prisma.$queryRaw`
        SELECT COALESCE(o.compliance->>'state', '?') AS state, COALESCE(x->>'category', '?') AS category,
               COUNT(DISTINCT i.id)::int AS invoices, COALESCE(SUM((x->>'amount')::numeric), 0)::float AS excise
        FROM invoices i JOIN orders o ON o.id = i.order_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.compliance->'lines', '[]'::jsonb)) x
        WHERE i.company_id = ${cid} AND i.status <> 'void' AND i.issue_date BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2 ORDER BY 1, 2`;
      return { title: "Tobacco excise by state", columns: [col("state"), col("category"), col("invoices"), col("excise")], rows: rows.map((r) => ({ ...r, excise: round2(r.excise) })), summary: [["Excise collected", money(rows.reduce((s, r) => s + r.excise, 0))], ["States", new Set(rows.map((r) => r.state)).size]] };
    },
  },
  state_shipments: {
    label: "Regulated shipments by state", perm: ["reports.view", "orders.view"], period: true,
    run: async (cid, { from, to }, opts = {}) => {
      const rows = await prisma.$queryRaw`
        SELECT to_char(i.issue_date, 'YYYY-MM-DD') AS date, i.invoice_number, o.order_number,
               COALESCE(NULLIF(u.business_name, ''), u.email) AS customer, a.address_line1 AS address, a.city, COALESCE(o.compliance->>'state', a.state) AS state, a.postal_code,
               lic.license_number AS license, p.sku, p.title AS product, p.compliance_category AS category, oi.flavor, oi.quantity,
               (oi.quantity * oi.price_at_time)::float AS value
        FROM invoices i JOIN orders o ON o.id = i.order_id JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
        LEFT JOIN users u ON u.id = o.user_id LEFT JOIN addresses a ON a.id = o.shipping_address_id
        LEFT JOIN customer_licenses lic ON lic.company_id = o.company_id AND lic.user_id = o.user_id AND lic.state = o.compliance->>'state'
        WHERE i.company_id = ${cid} AND i.status <> 'void' AND p.compliance_category <> 'none' AND i.issue_date BETWEEN ${from}::date AND ${to}::date
          AND (${opts.state || null}::text IS NULL OR o.compliance->>'state' = ${opts.state || null}::text)
          AND (${opts.reportableOnly ? true : false} = false OR EXISTS (
                SELECT 1 FROM compliance_rules r WHERE r.company_id = o.company_id AND r.state = o.compliance->>'state' AND r.report_shipments = true
                  AND (r.category = p.compliance_category OR r.category = '*')))
        ORDER BY i.issue_date, i.invoice_number`;
      return {
        title: "Regulated shipments by state",
        columns: ["date", "invoice_number", "order_number", "customer", "address", "city", "state", "postal_code", "license", "sku", "product", "category", "flavor", "quantity", "value"].map((k) => col(k)),
        rows: rows.map((r) => ({ ...r, value: round2(r.value) })),
        summary: [["Shipment lines", rows.length], ["Units", rows.reduce((s, r) => s + r.quantity, 0)], ["States", new Set(rows.map((r) => r.state)).size]],
      };
    },
  },
  payroll_summary: {
    label: "Payroll summary", perm: ["payroll.view", "payroll.manage"], period: true,
    run: async (cid, { from, to }) => {
      const rows = await prisma.$queryRaw`
        SELECT r.run_number, to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end, r.status,
               s.snapshot->>'name' AS employee, s.snapshot->>'employee_number' AS employee_number, s.gross::float AS gross,
               s.total_deductions::float AS deductions, s.net::float AS net, s.employer_total::float AS employer
        FROM payroll_runs r JOIN payslips s ON s.payroll_run_id = r.id
        WHERE r.company_id = ${cid} AND r.status IN ('approved','paid') AND r.period_end BETWEEN ${from}::date AND ${to}::date
        ORDER BY r.period_start, employee`;
      const sum = (k) => money(rows.reduce((s, r) => s + r[k], 0));
      return { title: "Payroll summary", columns: ["run_number", "period_start", "period_end", "status", "employee", "employee_number", "gross", "deductions", "net", "employer"].map((k) => col(k)), rows, summary: [["Payslips", rows.length], ["Gross", sum("gross")], ["Net", sum("net")], ["Employer cost", sum("employer")]] };
    },
  },
  attendance_summary: {
    label: "Attendance summary", perm: ["hr.view", "hr.attendance", "hr.manage"], period: true,
    run: async (cid, { from, to }) => {
      const rows = await prisma.$queryRaw`
        SELECT e.employee_number, CONCAT_WS(' ', e.first_name, e.last_name) AS employee,
          COALESCE(SUM(a.day_units) FILTER (WHERE a.status = 'present'), 0)::float AS present,
          COALESCE(SUM(a.day_units) FILTER (WHERE a.status = 'absent'), 0)::float AS absent,
          COUNT(a.id) FILTER (WHERE a.status = 'half_day')::int AS half_days,
          COALESCE(SUM(a.day_units) FILTER (WHERE a.status IN ('paid_leave','unpaid_leave')), 0)::float AS leave,
          COALESCE(SUM(a.hours), 0)::float AS hours, COALESCE(SUM(a.overtime_hours), 0)::float AS overtime
        FROM employees e LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date BETWEEN ${from}::date AND ${to}::date
        WHERE e.company_id = ${cid} AND e.status = 'active' GROUP BY e.id ORDER BY e.first_name`;
      return { title: "Attendance summary", columns: ["employee_number", "employee", "present", "absent", "half_days", "leave", "hours", "overtime"].map((k) => col(k)), rows, summary: [["Employees", rows.length], ["Absences", rows.reduce((s, r) => s + r.absent, 0)], ["Overtime hours", rows.reduce((s, r) => s + r.overtime, 0)]] };
    },
  },
};

// ---- periods ---------------------------------------------------------------------------------------

// Local calendar date (YYYY-MM-DD) of an instant in a time zone.
const localDate = (date, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const validTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// The period a scheduled report covers when it runs at `now`: yesterday / the last 7 days / last month.
const periodFor = (frequency, now = new Date(), tz = "UTC") => {
  const today = localDate(now, tz);
  const yesterday = hr.addDays(today, -1);
  if (frequency === "daily") return { from: yesterday, to: yesterday };
  if (frequency === "weekly") return { from: hr.addDays(today, -7), to: yesterday };
  const [y, m] = today.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const ym = prev.toISOString().slice(0, 7);
  return hr.monthBounds(ym);
};

// UTC instant of a local wall-clock time in a time zone.
const zonedTime = (dateStr, hour, tz) => {
  const guess = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess).map((p) => [p.type, p.value]));
  const asLocal = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
};

// Next time a schedule should run, strictly after `after`.
const nextRun = (s, after = new Date()) => {
  const tz = s.timezone || "UTC";
  let d = localDate(after, tz);
  for (let i = 0; i < 400; i++, d = hr.addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    const dom = Number(d.slice(8, 10));
    if (s.frequency === "weekly" && dow !== Number(s.day_of_week ?? 1)) continue;
    if (s.frequency === "monthly" && dom !== Number(s.day_of_month ?? 1)) continue;
    const t = zonedTime(d, Number(s.hour ?? 8), tz);
    if (t > after) return t;
  }
  throw new Error("Could not work out the next run");
};

const runReport = async (company, key, period, opts) => {
  const def = REPORTS[key];
  if (!def) throw new HttpError(400, `Unknown report: ${key}`);
  return def.run(company.id, period, opts);
};

module.exports = { REPORTS, runReport, periodFor, nextRun, localDate, validTimeZone, zonedTime };
