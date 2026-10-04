// Customer accounts, customer groups, price lists, promotions, sales settings and sales reports.
const { Prisma } = require("@prisma/client");
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { round2, num } = require("../../services/money");
const { outstandingFor } = require("../../services/receivables");
const { getSalesSettings, SALES_DEFAULTS } = require("../../services/salesSettings");
const { today: todayDate } = require("../../services/invoicing");
const inv = require("../../services/inventory");

const text = (v, max = 255) => (v === undefined ? undefined : v === null || v === "" ? null : String(v).trim().slice(0, max));
const dec = (v, name, { min = 0, max = Infinity, nullable = false } = {}) => {
  if (v === undefined) return undefined;
  if ((v === null || v === "") && nullable) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} must be a number between ${min} and ${max === Infinity ? "∞" : max}`);
  return n;
};
// Turns a unique-constraint violation into a friendly 409.
const unique = (message) => (err) => {
  if (err?.code === "P2002") throw new HttpError(409, message);
  throw err;
};
const int = (v, name, opts) => {
  const n = dec(v, name, opts);
  if (n !== undefined && n !== null && !Number.isInteger(n)) throw new HttpError(400, `${name} must be a whole number`);
  return n;
};

// ---- sales settings -------------------------------------------------------------------

const getSettings = async (req, res) => {
  res.json({ data: getSalesSettings(req.company), defaults: SALES_DEFAULTS });
};

const updateSettings = async (req, res) => {
  const b = req.body;
  const sales = { ...(req.company.settings?.sales || {}) };
  if (b.taxRate !== undefined) sales.taxRate = dec(b.taxRate, "Tax rate", { max: 50 });
  if (b.shippingFee !== undefined) sales.shippingFee = dec(b.shippingFee, "Shipping fee", { nullable: true });
  if (b.freeShippingOver !== undefined) sales.freeShippingOver = dec(b.freeShippingOver, "Free shipping threshold", { nullable: true });
  if (b.autoInvoice !== undefined) sales.autoInvoice = !!b.autoInvoice;
  if (b.allowCashOnDelivery !== undefined) sales.allowCashOnDelivery = !!b.allowCashOnDelivery;
  if (b.invoiceNotes !== undefined) sales.invoiceNotes = String(b.invoiceNotes || "").slice(0, 2000);
  if (b.returnWindowDays !== undefined) sales.returnWindowDays = int(b.returnWindowDays, "Return window", { min: 0, max: 365 });
  if (b.quoteValidityDays !== undefined) sales.quoteValidityDays = int(b.quoteValidityDays, "Quote validity", { min: 1, max: 365 });
  const settings = { ...(req.company.settings || {}), sales };
  await prisma.companies.update({ where: { id: req.company.id }, data: { settings, updated_at: new Date() } });
  await audit(req, "sales.settings", { entity: "company", entityId: req.company.id, changes: sales });
  res.json({ message: "Sales settings saved", data: getSalesSettings({ settings }) });
};

// ---- customer accounts ----------------------------------------------------------------

// GET /company/customers?search&group_id&status
const listCustomers = async (req, res) => {
  const search = String(req.query.search || "").trim();
  const customers = await prisma.company_customers.findMany({
    where: {
      company_id: req.company.id,
      ...(req.query.group_id ? { customer_group_id: toId(req.query.group_id, "group_id") } : {}),
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(search
        ? { users: { is: { OR: [
            { email: { contains: search, mode: "insensitive" } },
            { business_name: { contains: search, mode: "insensitive" } },
            { first_name: { contains: search, mode: "insensitive" } },
            { last_name: { contains: search, mode: "insensitive" } },
          ] } } }
        : {}),
    },
    include: {
      users: { select: { id: true, email: true, first_name: true, last_name: true, business_name: true, phone: true } },
      customer_groups: { select: { id: true, name: true } },
    },
    orderBy: { created_at: "desc" },
  });

  const stats = await prisma.$queryRaw`
    SELECT o.user_id,
           COUNT(*) FILTER (WHERE COALESCE(o.status,'pending') <> 'cancelled')::int AS orders,
           COALESCE(SUM(o.total_amount) FILTER (WHERE COALESCE(o.status,'pending') <> 'cancelled'), 0)::float AS spent,
           MAX(o.created_at) AS last_order
    FROM orders o WHERE o.company_id = ${req.company.id} GROUP BY o.user_id`;
  const todayStr = todayDate().toISOString().slice(0, 10);
  const balances = await prisma.$queryRaw`
    SELECT user_id, COALESCE(SUM(total_amount - amount_paid - amount_credited), 0)::float AS balance,
           COALESCE(SUM(total_amount - amount_paid - amount_credited) FILTER (WHERE due_date < ${todayStr}::date), 0)::float AS overdue
    FROM invoices WHERE company_id = ${req.company.id} AND status IN ('issued','partially_paid') GROUP BY user_id`;
  const sBy = new Map(stats.map((s) => [String(s.user_id), s]));
  const bBy = new Map(balances.map((b) => [String(b.user_id), b]));

  res.json({
    data: customers.map(({ users, customer_groups, ...c }) => {
      const s = sBy.get(String(c.user_id));
      const b = bBy.get(String(c.user_id));
      return {
        ...c,
        user: users,
        group: customer_groups,
        orders: s?.orders || 0,
        spent: round2(s?.spent || 0),
        last_order: s?.last_order || null,
        balance: round2(b?.balance || 0),
        overdue: round2(b?.overdue || 0),
      };
    }),
  });
};

const findOwnCustomer = async (req) => {
  const c = await prisma.company_customers.findFirst({
    where: { id: toId(req.params.id), company_id: req.company.id },
    include: {
      users: { select: { id: true, email: true, first_name: true, last_name: true, business_name: true, phone: true, created_at: true } },
      customer_groups: true,
    },
  });
  if (!c) throw new HttpError(404, "Customer not found");
  return c;
};

const getCustomer = async (req, res) => {
  const c = await findOwnCustomer(req);
  const [orders, invoices, outstanding] = await Promise.all([
    prisma.orders.findMany({
      where: { company_id: req.company.id, user_id: c.user_id },
      orderBy: { created_at: "desc" },
      take: 25,
      select: { id: true, order_number: true, status: true, total_amount: true, payment_method: true, created_at: true },
    }),
    prisma.invoices.findMany({
      where: { company_id: req.company.id, user_id: c.user_id },
      orderBy: { id: "desc" },
      take: 25,
      select: { id: true, invoice_number: true, status: true, issue_date: true, due_date: true, total_amount: true, amount_paid: true, amount_credited: true },
    }),
    outstandingFor(prisma, req.company.id, c.user_id),
  ]);
  const { users, customer_groups, ...rest } = c;
  res.json({
    data: {
      ...rest,
      user: users,
      group: customer_groups,
      outstanding,
      credit_available: rest.credit_limit !== null ? round2(num(rest.credit_limit) - outstanding) : null,
      orders,
      invoices: invoices.map((i) => ({ ...i, balance: round2(num(i.total_amount) - num(i.amount_paid) - num(i.amount_credited)) })),
    },
  });
};

// POST /company/customers { email } -> open an account for an existing platform user (e.g. to set terms first)
const addCustomer = async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const user = await prisma.users.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user) throw new HttpError(404, "No customer with that email. Ask them to register on the marketplace first.");
  const existing = await prisma.company_customers.findUnique({
    where: { company_id_user_id: { company_id: req.company.id, user_id: user.id } },
  });
  if (existing) throw new HttpError(409, "This customer already has an account with you");
  const c = await prisma.company_customers.create({ data: { company_id: req.company.id, user_id: user.id } });
  await audit(req, "customer.add", { entity: "customer", entityId: c.id, changes: { email } });
  res.status(201).json({ message: `${email} added as a customer`, data: c });
};

// PATCH /company/customers/:id
const updateCustomer = async (req, res) => {
  const c = await findOwnCustomer(req);
  const b = req.body;
  const data = { updated_at: new Date() };
  if (b.customer_group_id !== undefined) {
    if (!b.customer_group_id) data.customer_group_id = null;
    else {
      const g = await prisma.customer_groups.findFirst({ where: { id: toId(b.customer_group_id, "customer_group_id"), company_id: req.company.id } });
      if (!g) throw new HttpError(400, "Customer group not found");
      data.customer_group_id = g.id;
    }
  }
  if (b.payment_terms_days !== undefined) data.payment_terms_days = int(b.payment_terms_days, "Payment terms", { max: 365 });
  if (b.credit_limit !== undefined) data.credit_limit = dec(b.credit_limit, "Credit limit", { nullable: true });
  if (b.status !== undefined) {
    if (!["active", "blocked"].includes(b.status)) throw new HttpError(400, "Status must be active or blocked");
    data.status = b.status;
  }
  if (b.tax_exempt !== undefined) data.tax_exempt = !!b.tax_exempt;
  if (b.tax_id !== undefined) data.tax_id = text(b.tax_id);
  if (b.notes !== undefined) data.notes = text(b.notes, 5000);
  const updated = await prisma.company_customers.update({ where: { id: c.id }, data });
  await audit(req, "customer.update", { entity: "customer", entityId: c.id, changes: data });
  res.json({ message: "Customer account saved", data: updated });
};

// ---- customer groups ------------------------------------------------------------------

const listGroups = async (req, res) => {
  const groups = await prisma.customer_groups.findMany({
    where: { company_id: req.company.id },
    orderBy: { name: "asc" },
    include: { price_lists: { select: { id: true, name: true } }, _count: { select: { company_customers: true } } },
  });
  res.json({ data: groups.map(({ _count, price_lists, ...g }) => ({ ...g, price_list: price_lists, customerCount: _count.company_customers })) });
};

const groupData = async (req) => {
  const b = req.body;
  const data = {};
  if (b.name !== undefined) {
    data.name = text(b.name);
    if (!data.name) throw new HttpError(400, "Group name is required");
  }
  if (b.description !== undefined) data.description = text(b.description, 2000);
  if (b.discount_percent !== undefined) data.discount_percent = dec(b.discount_percent, "Discount %", { max: 100 });
  if (b.price_list_id !== undefined) {
    if (!b.price_list_id) data.price_list_id = null;
    else {
      const l = await prisma.price_lists.findFirst({ where: { id: toId(b.price_list_id, "price_list_id"), company_id: req.company.id } });
      if (!l) throw new HttpError(400, "Price list not found");
      data.price_list_id = l.id;
    }
  }
  return data;
};

const createGroup = async (req, res) => {
  const data = await groupData(req);
  if (!data.name) throw new HttpError(400, "Group name is required");
  const g = await prisma.customer_groups.create({ data: { ...data, company_id: req.company.id } }).catch(unique("A group with this name already exists"));
  await audit(req, "customer_group.create", { entity: "customer_group", entityId: g.id, changes: data });
  res.status(201).json({ message: "Customer group created", data: g });
};

const updateGroup = async (req, res) => {
  const g = await prisma.customer_groups.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!g) throw new HttpError(404, "Customer group not found");
  const data = await groupData(req);
  const updated = await prisma.customer_groups.update({ where: { id: g.id }, data: { ...data, updated_at: new Date() } }).catch(unique("A group with this name already exists"));
  await audit(req, "customer_group.update", { entity: "customer_group", entityId: g.id, changes: data });
  res.json({ message: "Customer group saved", data: updated });
};

const deleteGroup = async (req, res) => {
  const g = await prisma.customer_groups.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!g) throw new HttpError(404, "Customer group not found");
  await prisma.customer_groups.delete({ where: { id: g.id } }); // customers fall back to no group (FK set null)
  await audit(req, "customer_group.delete", { entity: "customer_group", entityId: g.id, changes: { name: g.name } });
  res.json({ message: "Customer group deleted" });
};

// ---- price lists ----------------------------------------------------------------------

const listPriceLists = async (req, res) => {
  const lists = await prisma.price_lists.findMany({
    where: { company_id: req.company.id },
    orderBy: [{ is_default: "desc" }, { name: "asc" }],
    include: { _count: { select: { price_list_items: true, customer_groups: true } } },
  });
  res.json({ data: lists.map(({ _count, ...l }) => ({ ...l, itemCount: _count.price_list_items, groupCount: _count.customer_groups })) });
};

const findOwnList = async (req) => {
  const l = await prisma.price_lists.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!l) throw new HttpError(404, "Price list not found");
  return l;
};

const getPriceList = async (req, res) => {
  const l = await findOwnList(req);
  const items = await prisma.price_list_items.findMany({
    where: { price_list_id: l.id },
    orderBy: [{ product_id: "asc" }, { min_quantity: "asc" }],
    include: { products: { select: { id: true, title: true, sku: true, price: true } } },
  });
  res.json({ data: { ...l, items: items.map(({ products, ...i }) => ({ ...i, product: products })) } });
};

const savePriceList = async (req, res, existing) => {
  const name = req.body.name !== undefined ? text(req.body.name) : undefined;
  if (!existing && !name) throw new HttpError(400, "Name is required");
  const data = { updated_at: new Date() };
  if (name !== undefined) data.name = name;
  if (req.body.description !== undefined) data.description = text(req.body.description, 2000);
  if (req.body.is_active !== undefined) data.is_active = !!req.body.is_active;
  const makeDefault = req.body.is_default === true;
  if (req.body.is_default === false) data.is_default = false;

  const list = await prisma.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.price_lists.updateMany({ where: { company_id: req.company.id }, data: { is_default: false } });
      data.is_default = true;
    }
    return existing
      ? tx.price_lists.update({ where: { id: existing.id }, data })
      : tx.price_lists.create({ data: { ...data, company_id: req.company.id } });
  }).catch(unique("A price list with this name already exists"));
  await audit(req, existing ? "price_list.update" : "price_list.create", { entity: "price_list", entityId: list.id, changes: data });
  return list;
};

const createPriceList = async (req, res) => {
  const list = await savePriceList(req, res, null);
  res.status(201).json({ message: "Price list created", data: list });
};
const updatePriceList = async (req, res) => {
  const list = await savePriceList(req, res, await findOwnList(req));
  res.json({ message: "Price list saved", data: list });
};
const deletePriceList = async (req, res) => {
  const l = await findOwnList(req);
  await prisma.price_lists.delete({ where: { id: l.id } });
  await audit(req, "price_list.delete", { entity: "price_list", entityId: l.id, changes: { name: l.name } });
  res.json({ message: "Price list deleted" });
};

// PUT /company/price-lists/:id/products/:productId  { tiers: [{ min_quantity, price }] }  (empty tiers = remove)
const setProductPrices = async (req, res) => {
  const l = await findOwnList(req);
  const product = await inv.assertProduct(prisma, req.company.id, toId(req.params.productId, "product_id"));
  const tiers = Array.isArray(req.body.tiers) ? req.body.tiers : [];
  const clean = tiers.map((t) => ({
    min_quantity: int(t.min_quantity ?? 1, "Minimum quantity", { min: 1, max: 1000000 }),
    price: dec(t.price, "Price"),
  }));
  if (new Set(clean.map((t) => t.min_quantity)).size !== clean.length) throw new HttpError(400, "Each tier needs a different minimum quantity");
  await prisma.$transaction([
    prisma.price_list_items.deleteMany({ where: { price_list_id: l.id, product_id: product.id } }),
    prisma.price_list_items.createMany({
      data: clean.map((t) => ({ price_list_id: l.id, product_id: product.id, min_quantity: t.min_quantity, price: new Prisma.Decimal(t.price.toFixed(4)) })),
    }),
  ]);
  await audit(req, "price_list.prices", { entity: "price_list", entityId: l.id, changes: { product: product.id, tiers: clean } });
  res.json({ message: clean.length ? `Prices saved for ${product.title}` : `${product.title} removed from the price list` });
};

// ---- promotions -----------------------------------------------------------------------

const PROMO_TYPES = ["percent", "fixed", "free_shipping"];
const promoData = (b) => {
  const data = {};
  if (b.code !== undefined) {
    data.code = String(b.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 64);
    if (!data.code) throw new HttpError(400, "Code is required (letters, numbers, - and _)");
  }
  if (b.description !== undefined) data.description = text(b.description);
  if (b.type !== undefined) {
    if (!PROMO_TYPES.includes(b.type)) throw new HttpError(400, `Type must be one of: ${PROMO_TYPES.join(", ")}`);
    data.type = b.type;
  }
  if (b.value !== undefined) data.value = dec(b.value, "Value");
  if (b.min_order_amount !== undefined) data.min_order_amount = dec(b.min_order_amount || 0, "Minimum order");
  if (b.starts_at !== undefined) data.starts_at = b.starts_at ? new Date(b.starts_at) : null;
  if (b.ends_at !== undefined) data.ends_at = b.ends_at ? new Date(b.ends_at) : null;
  if (b.max_uses !== undefined) data.max_uses = int(b.max_uses, "Max uses", { min: 1, nullable: true });
  if (b.max_uses_per_customer !== undefined) data.max_uses_per_customer = int(b.max_uses_per_customer, "Max uses per customer", { min: 1, nullable: true });
  if (b.is_active !== undefined) data.is_active = !!b.is_active;
  if (data.type === "percent" && data.value > 100) throw new HttpError(400, "A percent discount can't be over 100");
  return data;
};

const listPromotions = async (req, res) => {
  const promos = await prisma.promotions.findMany({ where: { company_id: req.company.id }, orderBy: { created_at: "desc" } });
  const totals = await prisma.promotion_redemptions.groupBy({
    by: ["promotion_id"],
    where: { promotion_id: { in: promos.map((p) => p.id) } },
    _sum: { amount: true },
  });
  const tBy = new Map(totals.map((t) => [String(t.promotion_id), Number(t._sum.amount || 0)]));
  res.json({ data: promos.map((p) => ({ ...p, total_discount: round2(tBy.get(String(p.id)) || 0) })) });
};

const createPromotion = async (req, res) => {
  const data = promoData(req.body);
  if (!data.code || !data.type) throw new HttpError(400, "Code and type are required");
  if (data.type !== "free_shipping" && !(data.value > 0)) throw new HttpError(400, "Enter the discount value");
  const p = await prisma.promotions.create({ data: { ...data, company_id: req.company.id } }).catch(unique(`The code ${data.code} already exists`));
  await audit(req, "promotion.create", { entity: "promotion", entityId: p.id, changes: data });
  res.status(201).json({ message: `Promo code ${p.code} created`, data: p });
};

const updatePromotion = async (req, res) => {
  const p = await prisma.promotions.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!p) throw new HttpError(404, "Promotion not found");
  const data = promoData(req.body);
  const updated = await prisma.promotions.update({ where: { id: p.id }, data: { ...data, updated_at: new Date() } }).catch(unique(`The code ${data.code} already exists`));
  await audit(req, "promotion.update", { entity: "promotion", entityId: p.id, changes: data });
  res.json({ message: "Promotion saved", data: updated });
};

const deletePromotion = async (req, res) => {
  const p = await prisma.promotions.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!p) throw new HttpError(404, "Promotion not found");
  if (p.uses_count > 0) {
    await prisma.promotions.update({ where: { id: p.id }, data: { is_active: false, updated_at: new Date() } });
    return res.json({ message: "This code has been used, so it was deactivated instead of deleted.", deactivated: true });
  }
  await prisma.promotions.delete({ where: { id: p.id } });
  await audit(req, "promotion.delete", { entity: "promotion", entityId: p.id, changes: { code: p.code } });
  res.json({ message: "Promotion deleted" });
};

// ---- sales report ---------------------------------------------------------------------

// GET /company/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&group_by=day|month|product|customer
const salesReport = async (req, res) => {
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59Z`) : new Date();
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00Z`) : new Date(to.getTime() - 30 * 86400000);
  const groupBy = String(req.query.group_by || "day");
  const cid = req.company.id;

  const [summary] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS orders,
           COALESCE(SUM(o.total_amount), 0)::float AS revenue,
           COALESCE(SUM(COALESCE(o.subtotal_amount, o.total_amount - COALESCE(o.shipping_amount, 0))), 0)::float AS net_sales,
           COALESCE(SUM(o.discount_amount), 0)::float AS discounts,
           COALESCE(SUM(o.tax_amount), 0)::float AS tax,
           COALESCE(SUM(o.shipping_amount), 0)::float AS shipping,
           COUNT(DISTINCT o.user_id)::int AS customers
    FROM orders o
    WHERE o.company_id = ${cid} AND COALESCE(o.status,'pending') <> 'cancelled' AND o.created_at BETWEEN ${from} AND ${to}`;

  let rows;
  if (groupBy === "product") {
    rows = await prisma.$queryRaw`
      SELECT p.id AS key, p.title AS label, SUM(oi.quantity)::int AS units,
             SUM(oi.quantity * oi.price_at_time)::float AS sales,
             SUM(oi.quantity * p.cost_price)::float AS cost,
             COUNT(DISTINCT o.id)::int AS orders
      FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
      WHERE o.company_id = ${cid} AND COALESCE(o.status,'pending') <> 'cancelled' AND o.created_at BETWEEN ${from} AND ${to}
      GROUP BY p.id, p.title ORDER BY sales DESC`;
  } else if (groupBy === "customer") {
    rows = await prisma.$queryRaw`
      SELECT u.id AS key, COALESCE(NULLIF(u.business_name, ''), u.email) AS label, u.email,
             COUNT(*)::int AS orders, SUM(o.total_amount)::float AS sales
      FROM orders o JOIN users u ON u.id = o.user_id
      WHERE o.company_id = ${cid} AND COALESCE(o.status,'pending') <> 'cancelled' AND o.created_at BETWEEN ${from} AND ${to}
      GROUP BY u.id ORDER BY sales DESC`;
  } else {
    const unit = groupBy === "month" ? "month" : "day";
    rows = await prisma.$queryRaw`
      SELECT to_char(date_trunc(${unit}, o.created_at), ${unit === "month" ? "YYYY-MM" : "YYYY-MM-DD"}) AS key,
             COUNT(*)::int AS orders, SUM(o.total_amount)::float AS sales
      FROM orders o
      WHERE o.company_id = ${cid} AND COALESCE(o.status,'pending') <> 'cancelled' AND o.created_at BETWEEN ${from} AND ${to}
      GROUP BY 1 ORDER BY 1`;
  }

  res.json({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    group_by: groupBy,
    summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, typeof v === "number" ? round2(v) : v])),
    rows: rows.map((r) => {
      const out = { ...r };
      for (const k of ["sales", "cost"]) if (out[k] !== undefined && out[k] !== null) out[k] = round2(out[k]);
      if (out.cost !== undefined) out.margin = round2(out.sales - (out.cost || 0));
      return out;
    }),
  });
};

module.exports = {
  getSettings, updateSettings,
  listCustomers, getCustomer, addCustomer, updateCustomer,
  listGroups, createGroup, updateGroup, deleteGroup,
  listPriceLists, getPriceList, createPriceList, updatePriceList, deletePriceList, setProductPrices,
  listPromotions, createPromotion, updatePromotion, deletePromotion,
  salesReport,
};
