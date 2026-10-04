// Accounting: setup, chart of accounts, journal, financial statements, bank reconciliation.
const { Prisma } = require("@prisma/client");
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { audit } = require("../../services/audit");
const { round2, num } = require("../../services/money");
const ledger = require("../../services/ledger");
const inv = require("../../services/inventory");

const TX = { timeout: 60000, maxWait: 10000 };
const todayStr = () => new Date().toISOString().slice(0, 10);
const dateParam = (v, name, fallback = null) => {
  if (v === undefined || v === null || v === "") return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new HttpError(400, `${name} must be a date (YYYY-MM-DD)`);
  return String(v);
};
const prevDay = (d) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);

const accountsWithBalances = async (companyId, opts = {}) => {
  await ledger.ensureChart(prisma, companyId);
  const [accounts, bal] = await Promise.all([
    prisma.accounts.findMany({ where: { company_id: companyId }, orderBy: { code: "asc" } }),
    ledger.balances(prisma, companyId, opts),
  ]);
  return accounts.map((a) => {
    const b = bal.get(String(a.id)) || { debit: 0, credit: 0, net: 0 };
    return { ...a, debit: b.debit, credit: b.credit, balance: ledger.debitNormal(a.type) ? b.net : round2(-b.net) };
  });
};

// ---- setup & settings ---------------------------------------------------------------------

const getSettings = async (req, res) => {
  const s = ledger.accountingSettings(req.company);
  const entries = await prisma.journal_entries.count({ where: { company_id: req.company.id } });
  res.json({ data: { ...s, inventoryTracked: inv.isInventoryTracked(req.company), entries } });
};

// What the opening entry would contain (preview for the setup screen).
const openingFigures = async (companyId, includeInventory) => {
  const [stock] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(l.on_hand * p.cost_price), 0)::float AS value
    FROM inventory_levels l JOIN products p ON p.id = l.product_id WHERE l.company_id = ${companyId}`;
  const transit = await prisma.stock_transfer_items.findMany({
    where: { stock_transfers: { is: { company_id: companyId, status: "in_transit" } } }, select: { lots: true },
  });
  const transitValue = transit.reduce((s, i) => s + (i.lots || []).reduce((a, c) => a + c.quantity * Number(c.unit_cost || 0), 0), 0);
  const [ar] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(total_amount - amount_paid - amount_credited), 0)::float AS value
    FROM invoices WHERE company_id = ${companyId} AND status IN ('issued', 'partially_paid')`;
  const [unappliedCredit] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(total_amount - amount_applied - amount_refunded), 0)::float AS value
    FROM credit_notes WHERE company_id = ${companyId} AND status = 'issued'`;
  return {
    inventory: includeInventory ? round2(stock.value + transitValue) : 0,
    receivables: round2(ar.value - unappliedCredit.value),
  };
};

const setupPreview = async (req, res) => {
  res.json({ data: await openingFigures(req.company.id, inv.isInventoryTracked(req.company)) });
};

/**
 * POST /company/accounting/setup
 * { start_date, cash?, bank?, include_inventory?: true, include_receivables?: true }
 * Creates the chart of accounts, posts the opening balances (against Opening balance equity) and turns posting on.
 */
const setup = async (req, res) => {
  const current = ledger.accountingSettings(req.company);
  if (current.enabled) throw new HttpError(400, "Accounting is already set up");
  const startDate = dateParam(req.body.start_date, "Start date", todayStr());
  const cash = round2(Number(req.body.cash || 0));
  const bank = round2(Number(req.body.bank || 0));
  if (cash < 0 || bank < 0) throw new HttpError(400, "Opening cash and bank balances can't be negative");
  const tracked = inv.isInventoryTracked(req.company);
  const figures = await openingFigures(req.company.id, tracked && req.body.include_inventory !== false);
  if (req.body.include_receivables === false) figures.receivables = 0;

  const entry = await prisma.$transaction(async (tx) => {
    await ledger.ensureChart(tx, req.company.id);
    const lines = [
      { account: "cash", debit: cash, description: "Opening cash" },
      { account: "bank", debit: bank, description: "Opening bank balance" },
      { account: "inventory", debit: figures.inventory, description: "Opening stock value (average cost)" },
      { account: "ar", debit: figures.receivables, description: "Unpaid customer invoices" },
    ];
    const total = round2(cash + bank + figures.inventory + figures.receivables);
    lines.push({ account: "opening_balance", credit: total });
    const e = total > 0
      ? await ledger.post(tx, { companyId: req.company.id, date: startDate, sourceType: "opening_balance", sourceId: "setup", memo: "Opening balances", lines, userId: req.user.id, force: true })
      : null;
    const settings = { ...(req.company.settings || {}), accounting: { enabled: true, startDate, lockDate: null } };
    await tx.companies.update({ where: { id: req.company.id }, data: { settings, updated_at: new Date() } });
    return e;
  }, TX);
  await audit(req, "accounting.setup", { entity: "company", entityId: req.company.id, changes: { startDate, cash, bank, ...figures } });
  res.status(201).json({ message: "Accounting is set up. From now on sales, purchases, stock and payments post to the books automatically.", data: { entry_number: entry?.entry_number || null, ...figures, cash, bank } });
};

// PATCH /company/accounting/settings { lockDate }  -> close the books up to a date (null reopens)
const updateSettings = async (req, res) => {
  const s = ledger.accountingSettings(req.company);
  if (!s.enabled) throw new HttpError(400, "Set up accounting first");
  const lockDate = req.body.lockDate === null || req.body.lockDate === "" ? null : dateParam(req.body.lockDate, "Lock date");
  if (lockDate && lockDate >= todayStr()) throw new HttpError(400, "You can only close periods that have ended (a date before today)");
  const settings = { ...(req.company.settings || {}), accounting: { ...(req.company.settings?.accounting || {}), lockDate } };
  await prisma.companies.update({ where: { id: req.company.id }, data: { settings, updated_at: new Date() } });
  await audit(req, "accounting.lock", { entity: "company", entityId: req.company.id, changes: { lockDate } });
  res.json({ message: lockDate ? `Books closed up to ${lockDate}` : "All periods are open", data: { ...s, lockDate } });
};

// ---- chart of accounts ----------------------------------------------------------------------

const listAccounts = async (req, res) => {
  res.json({ data: await accountsWithBalances(req.company.id), types: ledger.TYPES, subtypes: ledger.SUBTYPES });
};

const accountData = (b, existing = null) => {
  const data = {};
  if (b.code !== undefined) {
    data.code = String(b.code || "").trim().slice(0, 16);
    if (!/^[0-9A-Za-z.-]+$/.test(data.code)) throw new HttpError(400, "Code: letters, numbers, dots and dashes only");
  }
  if (b.name !== undefined) {
    data.name = String(b.name || "").trim().slice(0, 255);
    if (!data.name) throw new HttpError(400, "Name is required");
  }
  if (b.description !== undefined) data.description = b.description ? String(b.description).slice(0, 2000) : null;
  const type = b.type !== undefined ? String(b.type) : existing?.type;
  if (b.type !== undefined && !ledger.TYPES.includes(type)) throw new HttpError(400, `Type must be one of: ${ledger.TYPES.join(", ")}`);
  if (b.type !== undefined) data.type = type;
  if (b.subtype !== undefined || b.type !== undefined) {
    const subtype = String(b.subtype || existing?.subtype || "");
    if (!ledger.SUBTYPES[type].includes(subtype)) throw new HttpError(400, `For ${type} accounts the detail type must be one of: ${ledger.SUBTYPES[type].join(", ")}`);
    data.subtype = subtype;
  }
  if (b.is_active !== undefined) data.is_active = !!b.is_active;
  return data;
};

const createAccount = async (req, res) => {
  const data = accountData(req.body);
  if (!data.code || !data.name || !data.type) throw new HttpError(400, "Code, name and type are required");
  await ledger.ensureChart(prisma, req.company.id);
  const acc = await prisma.accounts.create({ data: { ...data, company_id: req.company.id } }).catch((e) => {
    if (e.code === "P2002") throw new HttpError(409, `Account code ${data.code} is already used`);
    throw e;
  });
  await audit(req, "account.create", { entity: "account", entityId: acc.id, changes: data });
  res.status(201).json({ message: `Account ${acc.code} ${acc.name} created`, data: acc });
};

const updateAccount = async (req, res) => {
  const acc = await prisma.accounts.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!acc) throw new HttpError(404, "Account not found");
  const data = accountData(req.body, acc);
  const used = await prisma.journal_lines.count({ where: { account_id: acc.id } });
  if (data.type && data.type !== acc.type && used) throw new HttpError(400, "This account has transactions, so its type can't change");
  if (acc.system_key && (data.type && data.type !== acc.type || data.is_active === false)) {
    throw new HttpError(400, "This account is used automatically by the system: it can be renamed but not deactivated or retyped");
  }
  if (data.is_active === false) {
    const bal = (await ledger.balances(prisma, req.company.id)).get(String(acc.id));
    if (bal && Math.abs(bal.net) > 0.004) throw new HttpError(400, "Only accounts with a zero balance can be deactivated");
  }
  const updated = await prisma.accounts.update({ where: { id: acc.id }, data: { ...data, updated_at: new Date() } }).catch((e) => {
    if (e.code === "P2002") throw new HttpError(409, `Account code ${data.code} is already used`);
    throw e;
  });
  await audit(req, "account.update", { entity: "account", entityId: acc.id, changes: data });
  res.json({ message: "Account saved", data: updated });
};

// ---- journal --------------------------------------------------------------------------------

const lineInclude = { journal_lines: { orderBy: { id: "asc" }, include: { accounts: { select: { id: true, code: true, name: true, type: true } } } } };
const shapeEntry = ({ journal_lines, ...e }) => ({
  ...e,
  lines: journal_lines?.map(({ accounts, ...l }) => ({ ...l, account: accounts })),
});

// GET /company/accounting/journal?from&to&source_type&account_id&search&page
const listJournal = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = 50;
  const from = dateParam(req.query.from, "From");
  const to = dateParam(req.query.to, "To");
  const search = String(req.query.search || "").trim();
  const where = {
    company_id: req.company.id,
    ...(from || to ? { entry_date: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}) } } : {}),
    ...(req.query.source_type ? { source_type: String(req.query.source_type) } : {}),
    ...(req.query.account_id ? { journal_lines: { some: { account_id: toId(req.query.account_id, "account_id") } } } : {}),
    ...(search ? { OR: [{ memo: { contains: search, mode: "insensitive" } }, { entry_number: { contains: search, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.journal_entries.findMany({ where, orderBy: [{ entry_date: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit, include: lineInclude }),
    prisma.journal_entries.count({ where }),
  ]);
  res.json({ data: rows.map(shapeEntry), totalCount: total, totalPages: Math.ceil(total / limit), currentPage: page });
};

const getEntry = async (req, res) => {
  const e = await prisma.journal_entries.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id }, include: lineInclude });
  if (!e) throw new HttpError(404, "Journal entry not found");
  res.json({ data: shapeEntry(e) });
};

// POST /company/accounting/journal { entry_date, memo, lines: [{ account_id, debit?, credit?, description? }] }
const createEntry = async (req, res) => {
  if (!ledger.accountingSettings(req.company).enabled) throw new HttpError(400, "Set up accounting first");
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (lines.length < 2) throw new HttpError(400, "A journal entry needs at least two lines");
  const memo = String(req.body.memo || "").trim();
  if (!memo) throw new HttpError(400, "Add a memo explaining the entry");
  const date = dateParam(req.body.entry_date, "Date", todayStr());
  const e = await prisma.$transaction(async (tx) => {
    await ledger.ensureChart(tx, req.company.id);
    const resolved = [];
    for (const [i, l] of lines.entries()) {
      const d = Number(l.debit || 0);
      const c = Number(l.credit || 0);
      if (!Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0) throw new HttpError(400, `Line ${i + 1}: amounts must be 0 or more`);
      if (d > 0 && c > 0) throw new HttpError(400, `Line ${i + 1}: use either a debit or a credit`);
      if (!d && !c) continue;
      const acc = await ledger.assertAccount(tx, req.company.id, toId(l.account_id, `Line ${i + 1} account`));
      resolved.push({ account: acc.id, debit: d, credit: c, description: l.description });
    }
    if (resolved.length < 2) throw new HttpError(400, "A journal entry needs at least two lines with amounts");
    const posted = await ledger.post(tx, { companyId: req.company.id, date, sourceType: "manual", memo, lines: resolved, userId: req.user.id, force: true });
    if (!posted) throw new HttpError(400, "Nothing to post");
    return posted;
  }, TX);
  await audit(req, "journal.create", { entity: "journal_entry", entityId: e.id, changes: { number: e.entry_number, total: num(e.total) } });
  res.status(201).json({ message: `Journal entry ${e.entry_number} posted`, data: e });
};

// POST /company/accounting/journal/:id/reverse { date? }  (manual and opening entries; documents are reversed by voiding them)
const reverseEntry = async (req, res) => {
  const e = await prisma.journal_entries.findFirst({ where: { id: toId(req.params.id), company_id: req.company.id } });
  if (!e) throw new HttpError(404, "Journal entry not found");
  if (!["manual", "opening_balance"].includes(e.source_type)) {
    throw new HttpError(400, "This entry was posted by a document (invoice, bill, payment...). Void or delete that document instead.");
  }
  const rev = await prisma.$transaction((tx) => ledger.reverse(tx, { companyId: req.company.id, entryId: e.id, date: dateParam(req.body?.date, "Date", todayStr()), userId: req.user.id }), TX);
  await audit(req, "journal.reverse", { entity: "journal_entry", entityId: e.id, changes: { reversal: rev.entry_number } });
  res.json({ message: `${e.entry_number} reversed by ${rev.entry_number}`, data: rev });
};

// ---- reports ----------------------------------------------------------------------------------

const trialBalance = async (req, res) => {
  const asOf = dateParam(req.query.as_of, "As of", todayStr());
  const rows = (await accountsWithBalances(req.company.id, { to: asOf })).filter((a) => a.debit || a.credit);
  const data = rows.map((a) => {
    const net = round2(a.debit - a.credit);
    return { id: a.id, code: a.code, name: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  });
  const totals = { debit: round2(data.reduce((s, r) => s + r.debit, 0)), credit: round2(data.reduce((s, r) => s + r.credit, 0)) };
  res.json({ as_of: asOf, data, totals, balanced: Math.abs(totals.debit - totals.credit) < 0.005 });
};

const plFor = async (companyId, from, to) => {
  const accounts = await accountsWithBalances(companyId, { from, to });
  const sec = (filter) => accounts.filter(filter).filter((a) => a.debit || a.credit).map((a) => ({ id: a.id, code: a.code, name: a.name, amount: a.balance }));
  // revenue accounts: balance = credits - debits (contra revenue comes out negative)
  const income = sec((a) => a.type === "revenue" && a.subtype !== "other_income");
  const otherIncome = sec((a) => a.type === "revenue" && a.subtype === "other_income");
  const cogs = sec((a) => a.type === "expense" && a.subtype === "cogs");
  const expenses = sec((a) => a.type === "expense" && a.subtype === "expense");
  const otherExpenses = sec((a) => a.type === "expense" && a.subtype === "other_expense");
  const sum = (l) => round2(l.reduce((s, x) => s + x.amount, 0));
  const revenue = sum(income);
  const grossProfit = round2(revenue - sum(cogs));
  const operatingIncome = round2(grossProfit - sum(expenses));
  const netIncome = round2(operatingIncome + sum(otherIncome) - sum(otherExpenses));
  return {
    from, to,
    sections: { income, cogs, expenses, otherIncome, otherExpenses },
    totals: { revenue, cogs: sum(cogs), grossProfit, expenses: sum(expenses), operatingIncome, otherIncome: sum(otherIncome), otherExpenses: sum(otherExpenses), netIncome },
    grossMargin: revenue ? round2((grossProfit / revenue) * 100) : null,
  };
};

// GET /company/accounting/reports/profit-loss?from&to&compare=previous
const profitLoss = async (req, res) => {
  const to = dateParam(req.query.to, "To", todayStr());
  const from = dateParam(req.query.from, "From", `${to.slice(0, 7)}-01`);
  const current = await plFor(req.company.id, from, to);
  let previous = null;
  if (req.query.compare === "previous") {
    const days = Math.round((new Date(to) - new Date(from)) / 86400000);
    const pTo = prevDay(from);
    const pFrom = new Date(new Date(`${pTo}T00:00:00Z`).getTime() - days * 86400000).toISOString().slice(0, 10);
    previous = await plFor(req.company.id, pFrom, pTo);
  }
  res.json({ data: current, previous });
};

// GET /company/accounting/reports/balance-sheet?as_of
const balanceSheet = async (req, res) => {
  const asOf = dateParam(req.query.as_of, "As of", todayStr());
  const accounts = (await accountsWithBalances(req.company.id, { to: asOf })).filter((a) => a.debit || a.credit);
  const pick = (type, subtypes) => accounts.filter((a) => a.type === type && (!subtypes || subtypes.includes(a.subtype))).map((a) => ({ id: a.id, code: a.code, name: a.name, amount: a.balance }));
  const sum = (l) => round2(l.reduce((s, x) => s + x.amount, 0));
  const currentAssets = pick("asset", ["cash", "bank", "receivable", "inventory", "current_asset"]);
  const fixedAssets = pick("asset", ["fixed_asset"]);
  const currentLiabilities = pick("liability", ["payable", "current_liability"]);
  const longTermLiabilities = pick("liability", ["long_term_liability"]);
  const equity = pick("equity");
  // profit not yet closed into retained earnings
  const pl = accounts.filter((a) => a.type === "revenue" || a.type === "expense");
  const earnings = round2(pl.reduce((s, a) => s + (a.type === "revenue" ? a.balance : -a.balance), 0));
  const totalAssets = round2(sum(currentAssets) + sum(fixedAssets));
  const totalLiabilities = round2(sum(currentLiabilities) + sum(longTermLiabilities));
  const totalEquity = round2(sum(equity) + earnings);
  res.json({
    as_of: asOf,
    assets: { current: currentAssets, fixed: fixedAssets, total: totalAssets },
    liabilities: { current: currentLiabilities, longTerm: longTermLiabilities, total: totalLiabilities },
    equity: { accounts: equity, earnings, total: totalEquity },
    balanced: Math.abs(totalAssets - totalLiabilities - totalEquity) < 0.005,
  });
};

// GET /company/accounting/reports/cash-flow?from&to  (direct method, from the cash, bank and card accounts)
const cashFlow = async (req, res) => {
  const to = dateParam(req.query.to, "To", todayStr());
  const from = dateParam(req.query.from, "From", `${to.slice(0, 7)}-01`);
  const money = await prisma.accounts.findMany({ where: { company_id: req.company.id, subtype: { in: ["cash", "bank"] } }, select: { id: true, code: true, name: true } });
  const ids = money.map((a) => a.id);
  if (!ids.length) return res.json({ from, to, opening: 0, closing: 0, sections: {}, net: 0 });
  const [opening] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(l.debit - l.credit), 0)::float AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.company_id = ${req.company.id} AND l.account_id IN (${Prisma.join(ids)}) AND e.entry_date < ${from}::date`;
  const rows = await prisma.$queryRaw`
    SELECT e.id, e.source_type, SUM(l.debit - l.credit)::float AS cash,
           (SELECT string_agg(DISTINCT a.type || ':' || a.subtype, ',') FROM journal_lines o JOIN accounts a ON a.id = o.account_id
             WHERE o.entry_id = e.id AND o.account_id NOT IN (${Prisma.join(ids)})) AS counter
    FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
    WHERE e.company_id = ${req.company.id} AND l.account_id IN (${Prisma.join(ids)}) AND e.entry_date BETWEEN ${from}::date AND ${to}::date
    GROUP BY e.id`;
  const LABELS = {
    invoice_payment: ["operating", "Received from customers"],
    credit_refund: ["operating", "Refunds to customers"],
    bill_payment: ["operating", "Paid to suppliers"],
    expense: ["operating", "Expenses paid"],
    payroll_payment: ["operating", "Salaries paid"],
    payroll_remittance: ["operating", "Payroll taxes & deductions paid"],
  };
  const sections = { operating: {}, investing: {}, financing: {} };
  for (const r of rows) {
    if (Math.abs(r.cash) < 0.005) continue;
    let [section, label] = LABELS[r.source_type] || [];
    if (!section) {
      const c = r.counter || "";
      if (r.source_type === "opening_balance") [section, label] = ["financing", "Opening balances"];
      else if (c.includes("fixed_asset")) [section, label] = ["investing", "Equipment & other assets"];
      else if (c.includes("equity") || c.includes("long_term_liability")) [section, label] = ["financing", r.cash > 0 ? "Owner / loan money in" : "Owner drawings / loan repayments"];
      else [section, label] = ["operating", "Other"];
    }
    sections[section][label] = round2((sections[section][label] || 0) + r.cash);
  }
  const totals = Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, round2(Object.values(v).reduce((s, x) => s + x, 0))]));
  const net = round2(totals.operating + totals.investing + totals.financing);
  res.json({ from, to, opening: round2(opening.v), sections, totals, net, closing: round2(opening.v + net), accounts: money });
};

// GET /company/accounting/reports/general-ledger?account_id&from&to
const generalLedger = async (req, res) => {
  const account = await prisma.accounts.findFirst({ where: { id: toId(req.query.account_id, "account_id"), company_id: req.company.id } });
  if (!account) throw new HttpError(404, "Account not found");
  const to = dateParam(req.query.to, "To", todayStr());
  const from = dateParam(req.query.from, "From", `${to.slice(0, 4)}-01-01`);
  const sign = ledger.debitNormal(account.type) ? 1 : -1;
  const [opening] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(l.debit - l.credit), 0)::float AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = ${account.id} AND e.entry_date < ${from}::date`;
  const lines = await prisma.$queryRaw`
    SELECT l.id, e.id AS entry_id, e.entry_number, e.entry_date, e.memo, e.source_type, e.source_id, l.description, l.debit::float AS debit, l.credit::float AS credit, l.cleared
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = ${account.id} AND e.entry_date BETWEEN ${from}::date AND ${to}::date
    ORDER BY e.entry_date, e.id, l.id
    LIMIT 5000`;
  let running = round2(sign * opening.v);
  const data = lines.map((l) => {
    running = round2(running + sign * (l.debit - l.credit));
    return { ...l, balance: running };
  });
  res.json({ account, from, to, opening: round2(sign * opening.v), closing: running, data });
};

// ---- overview ---------------------------------------------------------------------------------

const overview = async (req, res) => {
  const s = ledger.accountingSettings(req.company);
  if (!s.enabled) return res.json({ data: { enabled: false } });
  const to = todayStr();
  const from = `${to.slice(0, 7)}-01`;
  const [accounts, month, [ar], [ap]] = await Promise.all([
    accountsWithBalances(req.company.id),
    plFor(req.company.id, from, to),
    prisma.$queryRaw`SELECT COALESCE(SUM(total_amount - amount_paid - amount_credited), 0)::float AS total,
                     COALESCE(SUM(total_amount - amount_paid - amount_credited) FILTER (WHERE due_date < ${to}::date), 0)::float AS overdue
                     FROM invoices WHERE company_id = ${req.company.id} AND status IN ('issued','partially_paid')`,
    prisma.$queryRaw`SELECT COALESCE(SUM(total_amount - amount_paid - amount_credited), 0)::float AS total,
                     COALESCE(SUM(total_amount - amount_paid - amount_credited) FILTER (WHERE due_date < ${to}::date), 0)::float AS overdue,
                     COALESCE(SUM(total_amount - amount_paid - amount_credited) FILTER (WHERE due_date BETWEEN ${to}::date AND (${to}::date + 7)), 0)::float AS due_soon
                     FROM bills WHERE company_id = ${req.company.id} AND status IN ('open','partially_paid')`,
  ]);
  res.json({
    data: {
      enabled: true, ...s,
      money: accounts.filter((a) => ["cash", "bank"].includes(a.subtype) && a.is_active).map((a) => ({ id: a.id, code: a.code, name: a.name, balance: a.balance })),
      inventory: accounts.find((a) => a.system_key === "inventory")?.balance || 0,
      receivables: { total: round2(ar.total), overdue: round2(ar.overdue) },
      payables: { total: round2(ap.total), overdue: round2(ap.overdue), due_soon: round2(ap.due_soon) },
      month: { from, to, revenue: month.totals.revenue, grossProfit: month.totals.grossProfit, expenses: month.totals.expenses, netIncome: month.totals.netIncome },
    },
  });
};

// ---- bank reconciliation ----------------------------------------------------------------------

// GET /company/accounting/reconcile?account_id&statement_date -> uncleared lines up to the statement date
const reconcileView = async (req, res) => {
  const account = await ledger.assertMoneyAccount(prisma, req.company.id, toId(req.query.account_id, "account_id"));
  const date = dateParam(req.query.statement_date, "Statement date", todayStr());
  const [cleared] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(l.debit - l.credit), 0)::float AS v FROM journal_lines l WHERE l.account_id = ${account.id} AND l.cleared = true`;
  const lines = await prisma.$queryRaw`
    SELECT l.id, e.entry_number, e.entry_date, e.memo, e.source_type, l.description, l.debit::float AS debit, l.credit::float AS credit
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = ${account.id} AND l.cleared = false AND e.entry_date <= ${date}::date
    ORDER BY e.entry_date, e.id`;
  const history = await prisma.bank_reconciliations.findMany({ where: { account_id: account.id }, orderBy: { id: "desc" }, take: 12 });
  const [book] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(l.debit - l.credit), 0)::float AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = ${account.id} AND e.entry_date <= ${date}::date`;
  res.json({ data: { account, statement_date: date, cleared_balance: round2(cleared.v), book_balance: round2(book.v), lines, history } });
};

// POST /company/accounting/reconcile { account_id, statement_date, statement_balance, line_ids: [...] }
// Marks the ticked lines as cleared, only if the cleared balance then equals the bank statement.
const reconcile = async (req, res) => {
  const statementBalance = round2(Number(req.body.statement_balance));
  if (!Number.isFinite(statementBalance)) throw new HttpError(400, "Enter the statement's ending balance");
  const date = dateParam(req.body.statement_date, "Statement date", todayStr());
  const ids = (Array.isArray(req.body.line_ids) ? req.body.line_ids : []).map((id) => toId(id, "line"));
  const r = await prisma.$transaction(async (tx) => {
    const account = await ledger.assertMoneyAccount(tx, req.company.id, toId(req.body.account_id, "account_id"));
    await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${account.id} FOR UPDATE`;
    const lines = ids.length
      ? await tx.$queryRaw`
          SELECT l.id, (l.debit - l.credit)::float AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE l.id IN (${Prisma.join(ids)}) AND l.account_id = ${account.id} AND l.cleared = false AND e.entry_date <= ${date}::date`
      : [];
    if (lines.length !== ids.length) throw new HttpError(400, "Some lines aren't in this account, are already cleared, or are after the statement date");
    const [cleared] = await tx.$queryRaw`SELECT COALESCE(SUM(debit - credit), 0)::float AS v FROM journal_lines WHERE account_id = ${account.id} AND cleared = true`;
    const after = round2(cleared.v + lines.reduce((s, l) => s + l.v, 0));
    const diff = round2(statementBalance - after);
    if (Math.abs(diff) > 0.004) throw new HttpError(400, `Not reconciled yet: the cleared balance (${after.toFixed(2)}) is ${Math.abs(diff).toFixed(2)} ${diff > 0 ? "less" : "more"} than the statement`);
    const rec = await tx.bank_reconciliations.create({
      data: { company_id: req.company.id, account_id: account.id, statement_date: new Date(`${date}T00:00:00Z`), statement_balance: statementBalance, cleared_balance: after, lines_cleared: lines.length, notes: req.body.notes ? String(req.body.notes).slice(0, 1000) : null, created_by: BigInt(req.user.id) },
    });
    if (ids.length) await tx.journal_lines.updateMany({ where: { id: { in: ids } }, data: { cleared: true, reconciliation_id: rec.id } });
    return rec;
  }, TX);
  await audit(req, "bank.reconcile", { entity: "account", entityId: r.account_id, changes: { statement_date: date, balance: statementBalance, lines: r.lines_cleared } });
  res.status(201).json({ message: `Reconciled: ${r.lines_cleared} transaction(s) cleared, balance ${statementBalance.toFixed(2)}`, data: r });
};

module.exports = {
  getSettings, setupPreview, setup, updateSettings,
  listAccounts, createAccount, updateAccount,
  listJournal, getEntry, createEntry, reverseEntry,
  trialBalance, profitLoss, balanceSheet, cashFlow, generalLedger, overview,
  reconcileView, reconcile, plFor,
};
