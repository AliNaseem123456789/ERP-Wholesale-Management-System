// CSV export and import.
//   GET  /company/export/:type          -> CSV download (products, inventory, customers, orders, order_lines, invoices, suppliers, employees, journal)
//   GET  /company/import/:type/template -> an empty CSV with the right headers
//   POST /company/import/:type { csv, dry_run }  -> checks every row; with dry_run=false applies them (all or nothing)
const prisma = require("../../prisma");
const { HttpError } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { round2, num } = require("../../services/money");
const { nextNumber } = require("../../services/sequences");
const { parseRecords, stringify, sendCsv } = require("../../services/csv");
const { productData } = require("../../services/productInput");
const inv = require("../../services/inventory");
const { applyCount } = require("../../services/stockcount");
const compliance = require("../../services/compliance");
const hr = require("../../services/hr");
const { ensureCompanyBrand } = require("./products.controller");

const MAX_ROWS = 5000;
const today = () => new Date().toISOString().slice(0, 10);
const dateRange = (q) => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = re.test(String(q.from || "")) ? new Date(`${q.from}T00:00:00Z`) : null;
  const to = re.test(String(q.to || "")) ? new Date(`${q.to}T23:59:59.999Z`) : null;
  return from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
};
const yes = (v) => /^(1|y|yes|true|x)$/i.test(String(v || "").trim());
const name = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(" ");

// ---------------------------------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------------------------------

const EXPORTS = {
  products: {
    perm: "products.view",
    run: async (req) => {
      const rows = await prisma.products.findMany({ where: { company_id: req.company.id }, orderBy: { id: "asc" } });
      return {
        rows,
        columns: ["sku", "barcode", "title", "brand", "price", "cost_price", "unit", { key: "flavors", label: "flavors" }, "categories", "reorder_point", "reorder_quantity",
          { key: "is_active", label: "is_active", value: (r) => (r.is_active ? "yes" : "no") }, "compliance_category", "nicotine_ml",
          { key: "is_flavored", label: "is_flavored", value: (r) => (r.is_flavored ? "yes" : "no") }, "description"],
      };
    },
  },
  inventory: {
    perm: "inventory.view",
    run: async (req) => {
      const rows = await prisma.$queryRaw`
        SELECT w.code AS warehouse, w.name AS warehouse_name, p.sku, p.barcode, p.title, l.flavor, l.on_hand, l.reserved,
               (l.on_hand - l.reserved) AS available, p.cost_price::float AS cost_price, ROUND((l.on_hand * p.cost_price)::numeric, 2)::float AS value
        FROM inventory_levels l JOIN warehouses w ON w.id = l.warehouse_id JOIN products p ON p.id = l.product_id
        WHERE l.company_id = ${req.company.id} ORDER BY w.code, p.title, l.flavor`;
      return { rows, columns: ["warehouse", "warehouse_name", "sku", "barcode", "title", { key: "flavor", label: "flavor" }, "on_hand", "reserved", "available", "cost_price", "value"] };
    },
  },
  customers: {
    perm: "customers.view",
    run: async (req) => {
      const [rows, licenses] = await Promise.all([
        prisma.company_customers.findMany({
          where: { company_id: req.company.id }, orderBy: { id: "asc" },
          include: { users: { select: { email: true, first_name: true, last_name: true, business_name: true, phone: true } }, customer_groups: { select: { name: true } } },
        }),
        prisma.customer_licenses.findMany({ where: { company_id: req.company.id } }),
      ]);
      const lic = (uid) => licenses.filter((l) => String(l.user_id) === String(uid)).map((l) => `${l.state}:${l.license_number}${l.expires_on ? `:${l.expires_on.toISOString().slice(0, 10)}` : ""}`).join("|");
      return {
        rows,
        columns: [
          { label: "email", value: (r) => r.users.email }, { label: "name", value: (r) => name(r.users) }, { label: "business_name", value: (r) => r.users.business_name },
          { label: "phone", value: (r) => r.users.phone }, { label: "group", value: (r) => r.customer_groups?.name }, "payment_terms_days", "credit_limit", "status",
          { label: "tax_exempt", value: (r) => (r.tax_exempt ? "yes" : "no") }, "tax_id", { label: "licenses", value: (r) => lic(r.user_id) },
        ],
      };
    },
  },
  orders: {
    perm: "orders.view",
    run: async (req) => {
      const rows = await prisma.orders.findMany({
        where: { company_id: req.company.id, ...(dateRange(req.query) ? { created_at: dateRange(req.query) } : {}), ...(req.query.status ? { status: String(req.query.status) } : {}) },
        orderBy: { id: "asc" }, take: 50000,
        include: { users: { select: { email: true } }, addresses_orders_shipping_address_idToaddresses: { select: { city: true, state: true } }, _count: { select: { order_items: true } } },
      });
      const ship = (r) => r.addresses_orders_shipping_address_idToaddresses;
      return {
        rows,
        columns: ["order_number", { label: "date", value: (r) => r.created_at }, "status", { label: "customer", value: (r) => r.users?.email }, "business_name",
          { label: "city", value: (r) => ship(r)?.city }, { label: "state", value: (r) => ship(r)?.state }, "payment_method", { label: "lines", value: (r) => r._count.order_items },
          "subtotal_amount", "discount_amount", "shipping_amount", "tax_amount", "excise_amount", "total_amount", "tracking_number", "promo_code"],
      };
    },
  },
  order_lines: {
    perm: "orders.view",
    run: async (req) => {
      const rows = await prisma.order_items.findMany({
        where: { orders: { is: { company_id: req.company.id, ...(dateRange(req.query) ? { created_at: dateRange(req.query) } : {}) } } },
        orderBy: { id: "asc" }, take: 100000,
        include: { orders: { select: { order_number: true, created_at: true, status: true } }, products: { select: { sku: true, title: true } } },
      });
      return {
        rows,
        columns: [{ label: "order_number", value: (r) => r.orders.order_number }, { label: "date", value: (r) => r.orders.created_at }, { label: "status", value: (r) => r.orders.status },
          { label: "sku", value: (r) => r.products?.sku }, { label: "title", value: (r) => r.products?.title }, "flavor", "quantity",
          { label: "unit_price", value: (r) => num(r.price_at_time) }, { label: "line_total", value: (r) => round2(num(r.price_at_time) * r.quantity) }],
      };
    },
  },
  invoices: {
    perm: "invoices.view",
    run: async (req) => {
      const rows = await prisma.invoices.findMany({
        where: { company_id: req.company.id, ...(dateRange(req.query) ? { issue_date: dateRange(req.query) } : {}) },
        orderBy: { id: "asc" }, take: 50000, include: { users: { select: { email: true } }, orders: { select: { order_number: true } } },
      });
      return {
        rows,
        columns: ["invoice_number", { label: "order", value: (r) => r.orders?.order_number }, "issue_date", "due_date", { label: "customer", value: (r) => r.users?.email }, "status",
          "subtotal", "discount_amount", "shipping_amount", "tax_amount", "excise_amount", "total_amount", "amount_paid", "amount_credited",
          { label: "balance", value: (r) => (r.status === "void" ? 0 : round2(num(r.total_amount) - num(r.amount_paid) - num(r.amount_credited))) }],
      };
    },
  },
  suppliers: {
    perm: "purchasing.view",
    run: async (req) => ({
      rows: await prisma.suppliers.findMany({ where: { company_id: req.company.id }, orderBy: { name: "asc" } }),
      columns: ["name", "code", "contact_name", "email", "phone", "website", "address_line1", "address_line2", "city", "state", "postal_code", "country", "tax_id", "payment_terms_days", "currency",
        { key: "is_active", label: "is_active", value: (r) => (r.is_active ? "yes" : "no") }, "notes"],
    }),
  },
  employees: {
    perm: ["hr.view", "hr.manage", "payroll.view"],
    run: async (req) => {
      const rows = await prisma.employees.findMany({ where: { company_id: req.company.id }, orderBy: { id: "asc" }, include: { departments: { select: { name: true } } } });
      const pay = req.can("payroll.view") ? ["pay_type", "base_salary", "hourly_rate", "payment_method", "bank_name", "bank_account_number", "bank_routing"] : [];
      return {
        rows,
        columns: ["employee_number", "first_name", "last_name", "email", "phone", { label: "department", value: (r) => r.departments?.name }, "job_title", "employment_type", "status",
          "hire_date", "termination_date", "date_of_birth", "national_id", "tax_number", "address", ...pay],
      };
    },
  },
  journal: {
    perm: ["accounting.view", "accounting.manage"],
    run: async (req) => {
      const rows = await prisma.$queryRaw`
        SELECT e.entry_number, e.entry_date, e.source_type, e.memo, a.code AS account_code, a.name AS account_name,
               l.description, l.debit::float AS debit, l.credit::float AS credit
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
        WHERE e.company_id = ${req.company.id}
          AND (${req.query.from || null}::date IS NULL OR e.entry_date >= ${req.query.from || null}::date)
          AND (${req.query.to || null}::date IS NULL OR e.entry_date <= ${req.query.to || null}::date)
        ORDER BY e.entry_date, e.id, l.id`;
      return { rows, columns: ["entry_number", "entry_date", "source_type", "memo", "account_code", "account_name", "description", "debit", "credit"] };
    },
  },
};

const exportCsv = async (req, res) => {
  const def = EXPORTS[req.params.type];
  if (!def) throw new HttpError(404, `Unknown export: ${req.params.type}`);
  const perms = [].concat(def.perm);
  if (!perms.some((p) => req.can(p))) throw new HttpError(403, "You don't have permission to export this");
  if (req.params.type === "journal") for (const k of ["from", "to"]) if (req.query[k] && !/^\d{4}-\d{2}-\d{2}$/.test(String(req.query[k]))) throw new HttpError(400, `${k} must be YYYY-MM-DD`);
  const { rows, columns } = await def.run(req);
  await audit(req, "data.export", { entity: "export", entityId: null, changes: { type: req.params.type, rows: rows.length } });
  sendCsv(res, `${req.company.slug || "company"}-${req.params.type}-${today()}.csv`, stringify(rows, columns));
};

// ---------------------------------------------------------------------------------------------------
// IMPORTS
// Each importer: { perm, columns: [...template headers], required: [...], check(row, ctx) -> { action, data } | throws message,
//                  apply(tx, item, ctx) }
// ---------------------------------------------------------------------------------------------------

class RowError extends Error {}
const fail = (msg) => { throw new RowError(msg); };
const numOrNull = (v, label, { int = false, min = 0 } = {}) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < min || (int && !Number.isInteger(n))) fail(`${label} must be ${int ? "a whole number" : "a number"}${min === 0 ? ", 0 or more" : ""}`);
  return n;
};
const dateOrNull = (v, label) => {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(`${label} must be YYYY-MM-DD`);
  return v;
};
const list = (v) => (v ? String(v).split(/[|;]/).map((s) => s.trim()).filter(Boolean) : undefined);

const IMPORTS = {
  products: {
    perm: "products.manage",
    columns: ["sku", "title", "brand", "price", "cost_price", "barcode", "unit", "flavors", "categories", "reorder_point", "reorder_quantity", "is_active", "compliance_category", "nicotine_ml", "is_flavored", "description"],
    required: ["sku"],
    prepare: async (req, records) => ({
      existing: new Map((await prisma.products.findMany({ where: { company_id: req.company.id, sku: { in: records.map((r) => r.sku).filter(Boolean), mode: "insensitive" } } })).map((p) => [p.sku.toLowerCase(), p])),
      brands: new Map(),
    }),
    check: async (r, ctx, req) => {
      if (!r.sku) fail("sku is required (it's how rows are matched to products)");
      const existing = ctx.existing.get(r.sku.toLowerCase());
      const body = {};
      for (const f of ["title", "brand", "price", "cost_price", "barcode", "unit", "reorder_point", "reorder_quantity", "compliance_category", "nicotine_ml", "description"]) {
        if (r[f] !== undefined && r[f] !== "") body[f] = ["price", "cost_price", "nicotine_ml"].includes(f) ? String(r[f]).replace(/[$,\s]/g, "") : r[f];
      }
      if (r.flavors !== undefined && r.flavors !== "") body.flavors = list(r.flavors);
      if (r.categories !== undefined && r.categories !== "") body.categories = list(r.categories);
      if (r.is_active !== undefined && r.is_active !== "") body.is_active = yes(r.is_active);
      if (r.is_flavored !== undefined && r.is_flavored !== "") body.is_flavored = r.is_flavored;
      body.sku = r.sku;
      let data;
      try { data = productData(body); } catch (e) { fail(e.message); }
      if (!existing && (!data.title || !data.brand)) fail("title and brand are required for a new product");
      if (data.brand && (!existing || data.brand !== existing.brand)) {
        const key = data.brand.toLowerCase();
        if (!ctx.brands.has(key)) {
          const b = await prisma.brands.findFirst({ where: { name: { equals: data.brand, mode: "insensitive" } } });
          ctx.brands.set(key, b && b.company_id && b.company_id !== req.company.id ? "taken" : "ok");
        }
        if (ctx.brands.get(key) === "taken") fail(`The brand "${data.brand}" belongs to another company`);
      }
      if (existing && data.flavors) {
        const removed = inv.flavorsOf(existing).filter((f) => !data.flavors.some((n) => n.toLowerCase() === f.toLowerCase()));
        if (removed.length) {
          const stocked = await prisma.inventory_levels.count({ where: { product_id: existing.id, flavor: { in: removed }, on_hand: { gt: 0 } } });
          if (stocked) fail(`Can't remove flavour ${removed.join(", ")}: it still has stock`);
        }
      }
      return { action: existing ? "update" : "create", data, existing, label: data.title || existing?.title };
    },
    apply: async (tx, item, ctx, req) => {
      if (item.data.brand) await ensureCompanyBrand(req.company.id, item.data.brand);
      if (item.existing) {
        if (item.data.flavors) await inv.syncVariants(tx, item.existing, item.data.flavors);
        await tx.products.update({ where: { id: item.existing.id }, data: { ...item.data, updated_at: new Date() } });
      } else {
        const p = await tx.products.create({ data: { categories: [], flavors: [], ...item.data, company_id: req.company.id, updated_at: new Date() } });
        if (item.data.flavors) await inv.syncVariants(tx, { id: p.id, flavors: [] }, item.data.flavors);
      }
    },
  },

  inventory: {
    perm: "inventory.manage",
    columns: ["warehouse", "sku", "barcode", "flavor", "quantity", "unit_cost"],
    required: ["warehouse", "quantity"],
    note: "Sets on-hand stock to the counted quantity (a stock count). Rows are matched by SKU or barcode (a flavour's own SKU/barcode works too).",
    prepare: async (req) => ({
      warehouses: new Map((await prisma.warehouses.findMany({ where: { company_id: req.company.id } })).flatMap((w) => [[w.code.toLowerCase(), w], [w.name.toLowerCase(), w]])),
      seen: new Set(),
    }),
    check: async (r, ctx, req) => {
      if (!inv.isInventoryTracked(req.company)) fail("Turn on inventory tracking first (Stock settings)");
      const w = ctx.warehouses.get(String(r.warehouse || "").toLowerCase());
      if (!w) fail(`Warehouse "${r.warehouse}" not found (use its code)`);
      if (!w.is_active) fail(`Warehouse ${w.code} is inactive`);
      const code = r.sku || r.barcode;
      if (!code) fail("Give a sku or barcode");
      let product = await prisma.products.findFirst({ where: { company_id: req.company.id, OR: [{ sku: { equals: code, mode: "insensitive" } }, { barcode: code }] } });
      let flavor = r.flavor || "";
      if (!product) {
        const v = await prisma.product_variants.findFirst({ where: { products: { is: { company_id: req.company.id } }, OR: [{ barcode: code }, { sku: { equals: code, mode: "insensitive" } }] }, include: { products: true } });
        if (!v) fail(`No product with SKU or barcode "${code}"`);
        product = v.products;
        flavor = v.flavor;
      }
      try { flavor = inv.resolveFlavor(product, flavor, { allowUnassigned: true }); } catch (e) { fail(e.message); }
      const qty = numOrNull(r.quantity, "quantity", { int: true });
      if (qty === null) fail("quantity is required");
      const key = `${w.id}:${product.id}:${flavor}`;
      if (ctx.seen.has(key)) fail("The same product/flavour appears twice for this warehouse");
      ctx.seen.add(key);
      if (qty > 0 && !flavor && inv.hasFlavors(product)) {
        const cur = await prisma.inventory_levels.findUnique({ where: { warehouse_id_product_id_flavor: { warehouse_id: w.id, product_id: product.id, flavor: "" } } });
        if ((cur?.on_hand || 0) < qty) fail(`Give the flavour of "${product.title}"`);
      }
      const level = await prisma.inventory_levels.findUnique({ where: { warehouse_id_product_id_flavor: { warehouse_id: w.id, product_id: product.id, flavor } } });
      const before = level?.on_hand || 0;
      if (qty < (level?.reserved || 0)) fail(`${qty} is less than the ${level.reserved} reserved for confirmed orders`);
      return { action: qty === before ? "skip" : "update", label: `${inv.label(product.title, flavor)} @ ${w.code}: ${before} -> ${qty}`, data: { w, product, flavor, qty, unitCost: numOrNull(r.unit_cost, "unit_cost") } };
    },
    apply: async (tx, item, ctx, req) => {
      const d = item.data;
      await applyCount(tx, { companyId: req.company.id, warehouse: d.w, product: d.product, flavor: d.flavor, counted: d.qty, unitCost: d.unitCost, userId: req.user.id, notes: "CSV stock import" });
      ctx.touched = [...(ctx.touched || []), d.product.id];
    },
  },

  suppliers: {
    perm: "purchasing.manage",
    columns: ["name", "code", "contact_name", "email", "phone", "website", "address_line1", "address_line2", "city", "state", "postal_code", "country", "tax_id", "payment_terms_days", "currency", "is_active", "notes"],
    required: ["name"],
    prepare: async (req) => ({ existing: new Map((await prisma.suppliers.findMany({ where: { company_id: req.company.id } })).map((s) => [s.name.toLowerCase(), s])), seen: new Set() }),
    check: async (r, ctx) => {
      if (!r.name) fail("name is required");
      if (ctx.seen.has(r.name.toLowerCase())) fail("Duplicate supplier name in the file");
      ctx.seen.add(r.name.toLowerCase());
      if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) fail("email isn't valid");
      const data = {};
      for (const f of ["code", "contact_name", "email", "phone", "website", "address_line1", "address_line2", "city", "state", "postal_code", "country", "tax_id", "notes"]) if (r[f] !== undefined && r[f] !== "") data[f] = r[f].slice(0, 255);
      if (r.payment_terms_days) data.payment_terms_days = numOrNull(r.payment_terms_days, "payment_terms_days", { int: true });
      if (r.currency) {
        if (!/^[A-Za-z]{3}$/.test(r.currency)) fail("currency must be a 3-letter code");
        data.currency = r.currency.toUpperCase();
      }
      if (r.is_active) data.is_active = yes(r.is_active);
      const existing = ctx.existing.get(r.name.toLowerCase());
      return { action: existing ? "update" : "create", label: r.name, data, existing, name: r.name.slice(0, 255) };
    },
    apply: async (tx, item, ctx, req) => {
      if (item.existing) await tx.suppliers.update({ where: { id: item.existing.id }, data: { ...item.data, updated_at: new Date() } });
      else await tx.suppliers.create({ data: { ...item.data, name: item.name, company_id: req.company.id } });
    },
  },

  employees: {
    perm: "hr.manage",
    columns: ["employee_number", "first_name", "last_name", "email", "phone", "department", "job_title", "employment_type", "hire_date", "date_of_birth", "national_id", "tax_number", "address", "pay_type", "base_salary", "hourly_rate", "payment_method", "bank_name", "bank_account_number", "bank_routing"],
    required: ["first_name"],
    note: "Rows with an existing employee_number update that employee; blank employee_number creates a new one. Unknown departments are created.",
    prepare: async (req, records) => ({
      existing: new Map((await prisma.employees.findMany({ where: { company_id: req.company.id } })).map((e) => [e.employee_number.toLowerCase(), e])),
      departments: new Map((await prisma.departments.findMany({ where: { company_id: req.company.id } })).map((d) => [d.name.toLowerCase(), d])),
    }),
    check: async (r, ctx, req) => {
      const existing = r.employee_number ? ctx.existing.get(r.employee_number.toLowerCase()) : null;
      if (!existing && !r.first_name) fail("first_name is required");
      const data = {};
      for (const f of ["first_name", "last_name", "job_title", "national_id", "tax_number", "bank_name"]) if (r[f]) data[f] = r[f].slice(0, 255);
      for (const f of ["phone", "bank_account_number", "bank_routing"]) if (r[f]) data[f] = r[f].slice(0, 64);
      if (r.address) data.address = r.address;
      if (r.email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) fail("email isn't valid");
        data.email = r.email.toLowerCase();
      }
      if (r.employment_type) {
        if (!["full_time", "part_time", "contract", "intern"].includes(r.employment_type)) fail("employment_type: full_time, part_time, contract or intern");
        data.employment_type = r.employment_type;
      }
      const hire = dateOrNull(r.hire_date, "hire_date");
      if (hire) data.hire_date = hr.toDate(hire);
      else if (!existing) data.hire_date = hr.toDate(today());
      const dob = dateOrNull(r.date_of_birth, "date_of_birth");
      if (dob) data.date_of_birth = hr.toDate(dob);
      const payCols = ["pay_type", "base_salary", "hourly_rate", "payment_method"].filter((f) => r[f]);
      if (payCols.length && !req.can("payroll.manage")) fail("You can't import pay details (needs payroll permission)");
      if (r.pay_type) {
        if (!["salary", "hourly"].includes(r.pay_type)) fail("pay_type: salary or hourly");
        data.pay_type = r.pay_type;
      }
      if (r.base_salary) data.base_salary = numOrNull(r.base_salary, "base_salary");
      if (r.hourly_rate) data.hourly_rate = numOrNull(r.hourly_rate, "hourly_rate");
      if (r.payment_method) {
        if (!["bank_transfer", "cash", "check"].includes(r.payment_method)) fail("payment_method: bank_transfer, cash or check");
        data.payment_method = r.payment_method;
      }
      return { action: existing ? "update" : "create", label: [r.first_name || existing?.first_name, r.last_name].filter(Boolean).join(" "), data, existing, department: r.department || null, number: r.employee_number || null };
    },
    apply: async (tx, item, ctx, req) => {
      const data = { ...item.data };
      if (item.department) {
        const key = item.department.toLowerCase();
        let d = ctx.departments.get(key);
        if (!d) {
          d = await tx.departments.create({ data: { company_id: req.company.id, name: item.department.slice(0, 255) } });
          ctx.departments.set(key, d);
        }
        data.department_id = d.id;
      }
      if (item.existing) await tx.employees.update({ where: { id: item.existing.id }, data: { ...data, updated_at: new Date() } });
      else await tx.employees.create({ data: { ...data, company_id: req.company.id, employee_number: item.number || (await nextNumber(tx, req.company.id, "EMP")) } });
    },
  },

  customers: {
    perm: "customers.manage",
    columns: ["email", "group", "payment_terms_days", "credit_limit", "status", "tax_exempt", "tax_id", "license_state", "license_number", "license_expires"],
    required: ["email"],
    note: "Customers must already be registered on the marketplace. Rows add them as your customers and set their terms, group and tobacco licence.",
    prepare: async (req) => ({
      groups: new Map((await prisma.customer_groups.findMany({ where: { company_id: req.company.id } })).map((g) => [g.name.toLowerCase(), g])),
      seen: new Set(),
    }),
    check: async (r, ctx, req) => {
      if (!r.email) fail("email is required");
      const email = r.email.toLowerCase();
      if (ctx.seen.has(email)) fail("Duplicate email in the file");
      ctx.seen.add(email);
      const user = await prisma.users.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
      if (!user) fail(`${email} isn't registered on the marketplace`);
      const existing = await prisma.company_customers.findUnique({ where: { company_id_user_id: { company_id: req.company.id, user_id: user.id } } });
      const data = {};
      if (r.group) {
        const g = ctx.groups.get(r.group.toLowerCase());
        if (!g) fail(`Customer group "${r.group}" not found`);
        data.customer_group_id = g.id;
      }
      if (r.payment_terms_days) data.payment_terms_days = numOrNull(r.payment_terms_days, "payment_terms_days", { int: true });
      if (r.credit_limit) data.credit_limit = numOrNull(r.credit_limit, "credit_limit");
      if (r.status) {
        if (!["active", "blocked"].includes(r.status)) fail("status: active or blocked");
        data.status = r.status;
      }
      if (r.tax_exempt) data.tax_exempt = yes(r.tax_exempt);
      if (r.tax_id) data.tax_id = r.tax_id.slice(0, 255);
      let license = null;
      if (r.license_state || r.license_number) {
        const state = compliance.normalizeState(r.license_state);
        if (!state) fail("license_state must be a US state");
        if (!r.license_number) fail("license_number is required with license_state");
        license = { state, license_number: r.license_number.slice(0, 128), expires_on: dateOrNull(r.license_expires, "license_expires") };
      }
      return { action: existing ? "update" : "create", label: email, data, userId: user.id, license };
    },
    apply: async (tx, item, ctx, req) => {
      await tx.company_customers.upsert({
        where: { company_id_user_id: { company_id: req.company.id, user_id: item.userId } },
        create: { company_id: req.company.id, user_id: item.userId, ...item.data },
        update: { ...item.data, updated_at: new Date() },
      });
      if (item.license) {
        const l = { license_number: item.license.license_number, expires_on: item.license.expires_on ? new Date(`${item.license.expires_on}T00:00:00Z`) : null, updated_at: new Date() };
        await tx.customer_licenses.upsert({
          where: { company_id_user_id_state: { company_id: req.company.id, user_id: item.userId, state: item.license.state } },
          create: { company_id: req.company.id, user_id: item.userId, state: item.license.state, ...l },
          update: l,
        });
      }
    },
  },
};

const importTemplate = async (req, res) => {
  const def = IMPORTS[req.params.type];
  if (!def) throw new HttpError(404, `Unknown import: ${req.params.type}`);
  sendCsv(res, `${req.params.type}-template.csv`, stringify([], def.columns));
};

const importTypes = async (req, res) => {
  res.json({ data: Object.entries(IMPORTS).map(([k, d]) => ({ type: k, columns: d.columns, required: d.required, note: d.note || null, allowed: req.can(d.perm) })), exports: Object.entries(EXPORTS).map(([k, d]) => ({ type: k, allowed: [].concat(d.perm).some((p) => req.can(p)) })) });
};

const importCsv = async (req, res) => {
  const def = IMPORTS[req.params.type];
  if (!def) throw new HttpError(404, `Unknown import: ${req.params.type}`);
  if (!req.can(def.perm)) throw new HttpError(403, "You don't have permission to import this");
  const text = String(req.body.csv || "");
  if (!text.trim()) throw new HttpError(400, "The file is empty");
  if (text.length > 5 * 1024 * 1024) throw new HttpError(400, "The file is too big (max 5 MB)");
  const { headers, records } = parseRecords(text);
  if (!records.length) throw new HttpError(400, "No rows found under the header line");
  if (records.length > MAX_ROWS) throw new HttpError(400, `Up to ${MAX_ROWS} rows per import`);
  const missing = def.required.filter((c) => !headers.includes(c));
  if (missing.length) throw new HttpError(400, `Missing column(s): ${missing.join(", ")}. Download the template for the right headers.`);
  const unknown = headers.filter((h) => !def.columns.includes(h));

  const ctx = await def.prepare(req, records);
  const items = [];
  const errors = [];
  for (const r of records) {
    try {
      items.push({ line: r._line, ...(await def.check(r, ctx, req)) });
    } catch (e) {
      if (!(e instanceof RowError) && !(e instanceof HttpError)) throw e;
      errors.push({ line: r._line, message: e.message });
    }
  }
  const summary = { rows: records.length, create: items.filter((i) => i.action === "create").length, update: items.filter((i) => i.action === "update").length, skip: items.filter((i) => i.action === "skip").length, errors: errors.length };
  const preview = items.slice(0, 50).map((i) => ({ line: i.line, action: i.action, label: i.label }));
  const dryRun = req.body.dry_run !== false && req.body.dry_run !== "false";
  if (dryRun || errors.length) {
    return res.json({ dry_run: true, applied: false, summary, errors: errors.slice(0, 200), preview, ignored_columns: unknown, message: errors.length ? `${errors.length} row(s) need fixing before anything is imported` : "Looks good: nothing imported yet" });
  }
  const applyCtx = { ...(await def.prepare(req, records)) };
  await prisma.$transaction(async (tx) => {
    for (const item of items) if (item.action !== "skip") await def.apply(tx, item, applyCtx, req);
  }, { timeout: 120000, maxWait: 10000 });
  if (applyCtx.touched?.length) {
    await inv.checkLowStock(req.company.id, applyCtx.touched);
    await inv.resetLowStockFlags(applyCtx.touched);
  }
  await audit(req, "data.import", { entity: "import", entityId: null, changes: { type: req.params.type, ...summary } });
  res.json({ dry_run: false, applied: true, summary, errors: [], preview, ignored_columns: unknown, message: `Imported: ${summary.create} created, ${summary.update} updated${summary.skip ? `, ${summary.skip} unchanged` : ""}` });
};

module.exports = { exportCsv, importCsv, importTemplate, importTypes, EXPORTS };
