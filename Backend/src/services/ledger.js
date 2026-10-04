// General ledger: chart of accounts and double-entry posting.
//
// Every business event that moves money or stock posts one balanced journal entry
// (sum of debits == sum of credits), inside the same transaction as the event itself.
// Posting only happens once a company has switched accounting on (settings.accounting.enabled),
// and never into a closed period (on or before settings.accounting.lockDate).
// Entries are never edited or deleted: a mistake is undone with a reversing entry.
const { Prisma } = require("@prisma/client");
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");
const { round2 } = require("./money");
const { nextNumber } = require("./sequences");

// The default chart (US small business). system_key = accounts the system posts to automatically.
const DEFAULT_CHART = [
  // assets
  { code: "1000", name: "Cash on hand", type: "asset", subtype: "cash", key: "cash" },
  { code: "1010", name: "Bank account", type: "asset", subtype: "bank", key: "bank" },
  { code: "1100", name: "Accounts receivable", type: "asset", subtype: "receivable", key: "ar" },
  { code: "1150", name: "Supplier returns receivable", type: "asset", subtype: "current_asset", key: "supplier_returns" },
  { code: "1200", name: "Inventory", type: "asset", subtype: "inventory", key: "inventory" },
  { code: "1300", name: "Prepaid expenses", type: "asset", subtype: "current_asset" },
  { code: "1500", name: "Equipment & furniture", type: "asset", subtype: "fixed_asset" },
  { code: "1510", name: "Vehicles", type: "asset", subtype: "fixed_asset" },
  { code: "1590", name: "Accumulated depreciation", type: "asset", subtype: "fixed_asset" },
  // liabilities
  { code: "2000", name: "Accounts payable", type: "liability", subtype: "payable", key: "ap" },
  { code: "2050", name: "Goods received not invoiced", type: "liability", subtype: "current_liability", key: "grni" },
  { code: "2100", name: "Sales tax payable", type: "liability", subtype: "current_liability", key: "sales_tax" },
  { code: "2110", name: "Excise tax payable (tobacco/vapor)", type: "liability", subtype: "current_liability", key: "excise_tax" },
  { code: "2200", name: "Credit card", type: "liability", subtype: "current_liability" },
  { code: "2300", name: "Payroll liabilities", type: "liability", subtype: "current_liability", key: "payroll_liabilities" },
  { code: "2310", name: "Wages payable", type: "liability", subtype: "current_liability", key: "wages_payable" },
  { code: "2500", name: "Loans payable", type: "liability", subtype: "long_term_liability" },
  // equity
  { code: "3000", name: "Owner's equity", type: "equity", subtype: "equity", key: "owner_equity" },
  { code: "3100", name: "Opening balance equity", type: "equity", subtype: "equity", key: "opening_balance" },
  { code: "3200", name: "Owner's drawings", type: "equity", subtype: "equity" },
  { code: "3900", name: "Retained earnings", type: "equity", subtype: "equity", key: "retained_earnings" },
  // revenue
  { code: "4000", name: "Sales", type: "revenue", subtype: "income", key: "sales" },
  { code: "4010", name: "Sales returns & allowances", type: "revenue", subtype: "contra_revenue", key: "sales_returns" },
  { code: "4020", name: "Sales discounts", type: "revenue", subtype: "contra_revenue", key: "sales_discounts" },
  { code: "4100", name: "Shipping income", type: "revenue", subtype: "income", key: "shipping_income" },
  { code: "4900", name: "Other income", type: "revenue", subtype: "other_income" },
  // cost of sales
  { code: "5000", name: "Cost of goods sold", type: "expense", subtype: "cogs", key: "cogs" },
  { code: "5100", name: "Inventory shrinkage & adjustments", type: "expense", subtype: "cogs", key: "inventory_adjustments" },
  { code: "5150", name: "Purchase price variance", type: "expense", subtype: "cogs", key: "purchase_variance" },
  // expenses
  { code: "6000", name: "Advertising & marketing", type: "expense", subtype: "expense" },
  { code: "6100", name: "Bank & payment fees", type: "expense", subtype: "expense" },
  { code: "6200", name: "Rent", type: "expense", subtype: "expense" },
  { code: "6300", name: "Utilities", type: "expense", subtype: "expense" },
  { code: "6400", name: "Salaries & wages", type: "expense", subtype: "expense", key: "wages" },
  { code: "6450", name: "Payroll taxes", type: "expense", subtype: "expense", key: "payroll_taxes" },
  { code: "6500", name: "Office supplies", type: "expense", subtype: "expense" },
  { code: "6600", name: "Shipping & delivery", type: "expense", subtype: "expense" },
  { code: "6700", name: "Software & subscriptions", type: "expense", subtype: "expense" },
  { code: "6800", name: "Professional fees", type: "expense", subtype: "expense" },
  { code: "6900", name: "Insurance", type: "expense", subtype: "expense" },
  { code: "6950", name: "Taxes & licenses", type: "expense", subtype: "expense", key: "taxes_licenses" },
  { code: "6990", name: "Other expenses", type: "expense", subtype: "other_expense" },
];

const TYPES = ["asset", "liability", "equity", "revenue", "expense"];
const SUBTYPES = {
  asset: ["cash", "bank", "receivable", "inventory", "current_asset", "fixed_asset"],
  liability: ["payable", "current_liability", "long_term_liability"],
  equity: ["equity"],
  revenue: ["income", "other_income", "contra_revenue"],
  expense: ["cogs", "expense", "other_expense"],
};
// Debit-normal accounts have positive balances when debits exceed credits.
const debitNormal = (type) => type === "asset" || type === "expense";

const accountingSettings = (company) => {
  const a = company?.settings?.accounting || {};
  return { enabled: a.enabled === true, startDate: a.startDate || null, lockDate: a.lockDate || null };
};

const toDateStr = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || new Date().toISOString()).slice(0, 10));

// Creates the default chart for a company (once). Safe to call any time.
const ensureChart = async (db, companyId) => {
  const cid = BigInt(companyId);
  const count = await db.accounts.count({ where: { company_id: cid } });
  if (count) return;
  for (const a of DEFAULT_CHART) {
    await db.$executeRaw`
      INSERT INTO accounts (company_id, code, name, type, subtype, system_key)
      VALUES (${cid}, ${a.code}, ${a.name}, ${a.type}, ${a.subtype}, ${a.key || null})
      ON CONFLICT DO NOTHING`;
  }
};

// Account id for a system key (creates the default chart / the missing system account if needed).
const accountId = async (db, companyId, key) => {
  const cid = BigInt(companyId);
  let acc = await db.accounts.findFirst({ where: { company_id: cid, system_key: key }, select: { id: true } });
  if (acc) return acc.id;
  await ensureChart(db, cid);
  acc = await db.accounts.findFirst({ where: { company_id: cid, system_key: key }, select: { id: true } });
  if (acc) return acc.id;
  // the company renamed/removed it: recreate it with a free code
  const def = DEFAULT_CHART.find((a) => a.key === key);
  if (!def) throw new Error(`Unknown system account: ${key}`);
  let code = def.code;
  while (await db.accounts.findFirst({ where: { company_id: cid, code } })) code = String(Number(code) + 1);
  const created = await db.accounts.create({ data: { company_id: cid, code, name: def.name, type: def.type, subtype: def.subtype, system_key: key } });
  return created.id;
};

const loadCompany = async (db, companyId) => db.companies.findUnique({ where: { id: BigInt(companyId) }, select: { id: true, settings: true } });

const assertOpen = (settings, dateStr) => {
  if (settings.lockDate && dateStr <= settings.lockDate) {
    throw new HttpError(400, `The books are closed up to ${settings.lockDate}. Use a later date or reopen the period.`);
  }
};

/**
 * Posts a balanced journal entry. Returns the entry, or null when accounting is off for the company.
 * lines: [{ account: "ar" (system key) | accountId (bigint/number), debit?, credit?, description?, customerId?, supplierId? }]
 * Idempotent per (sourceType, sourceId): posting the same source twice returns the first entry
 * (unless that entry was reversed, e.g. a payment undone and made again).
 * force: post even when accounting is off (manual and opening entries).
 */
const post = async (db, { companyId, date = new Date(), sourceType, sourceId = null, memo = null, lines, userId = null, force = false, reversalOf = null }) => {
  const company = await loadCompany(db, companyId);
  const settings = accountingSettings(company);
  if (!settings.enabled && !force) return null;
  const dateStr = toDateStr(date);
  assertOpen(settings, dateStr);

  if (sourceId != null && !reversalOf) {
    const existing = await db.journal_entries.findFirst({
      where: { company_id: BigInt(companyId), source_type: sourceType, source_id: String(sourceId), reversal_of_id: null, reversed: false },
    });
    if (existing) return existing;
  }

  const resolved = [];
  for (const l of lines) {
    const debit = round2(l.debit || 0);
    const credit = round2(l.credit || 0);
    if (debit < 0 || credit < 0) {
      // negative amounts flip sides
      resolved.push({ ...l, debit: Math.max(0, debit) + Math.max(0, -credit), credit: Math.max(0, credit) + Math.max(0, -debit) });
    } else {
      resolved.push({ ...l, debit, credit });
    }
  }
  const nonZero = resolved.filter((l) => l.debit > 0 || l.credit > 0);
  const dr = round2(nonZero.reduce((s, l) => s + l.debit, 0));
  const cr = round2(nonZero.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.005) throw new HttpError(400, `Journal entry doesn't balance: debits ${dr.toFixed(2)}, credits ${cr.toFixed(2)}`);
  if (!nonZero.length || dr === 0) return null; // nothing to post (e.g. a zero-value receipt)

  const data = [];
  for (const l of nonZero) {
    const acc = typeof l.account === "string" && !/^\d+$/.test(l.account) ? await accountId(db, companyId, l.account) : BigInt(l.account);
    data.push({
      account_id: acc,
      debit: new Prisma.Decimal(l.debit.toFixed(2)),
      credit: new Prisma.Decimal(l.credit.toFixed(2)),
      description: l.description ? String(l.description).slice(0, 500) : null,
      customer_id: l.customerId ? BigInt(l.customerId) : null,
      supplier_id: l.supplierId ? BigInt(l.supplierId) : null,
      company_id: BigInt(companyId),
    });
  }
  return db.journal_entries.create({
    data: {
      company_id: BigInt(companyId),
      entry_number: await nextNumber(db, companyId, "JE"),
      entry_date: new Date(`${dateStr}T00:00:00Z`),
      memo: memo ? String(memo).slice(0, 500) : null,
      source_type: sourceType,
      source_id: sourceId != null ? String(sourceId) : null,
      reversal_of_id: reversalOf,
      total: new Prisma.Decimal(dr.toFixed(2)),
      created_by: userId ? BigInt(userId) : null,
      journal_lines: { create: data },
    },
    include: { journal_lines: true },
  });
};

/**
 * Reverses the entry posted for a source (swaps debits and credits), dated `date`.
 * Returns the reversing entry, or null if nothing was posted for that source.
 */
const reverse = async (db, { companyId, sourceType, sourceId, entryId = null, date = new Date(), memo = null, userId = null }) => {
  const entry = await db.journal_entries.findFirst({
    where: entryId
      ? { id: BigInt(entryId), company_id: BigInt(companyId) }
      : { company_id: BigInt(companyId), source_type: sourceType, source_id: String(sourceId), reversal_of_id: null, reversed: false },
    include: { journal_lines: true },
  });
  if (!entry) return null;
  if (entry.reversed) throw new HttpError(400, `${entry.entry_number} was already reversed`);
  if (entry.reversal_of_id) throw new HttpError(400, "A reversing entry can't itself be reversed");
  const rev = await post(db, {
    companyId, date, sourceType: entry.source_type, sourceId: entry.source_id, memo: memo || `Reversal of ${entry.entry_number}${entry.memo ? `: ${entry.memo}` : ""}`,
    userId, force: true, reversalOf: entry.id,
    lines: entry.journal_lines.map((l) => ({
      account: l.account_id, debit: Number(l.credit), credit: Number(l.debit), description: l.description, customerId: l.customer_id, supplierId: l.supplier_id,
    })),
  });
  await db.journal_entries.update({ where: { id: entry.id }, data: { reversed: true } });
  return rev;
};

// Balance per account (debits - credits), optionally between dates (inclusive). Map<accountId, {debit, credit, net}>
const balances = async (db, companyId, { from = null, to = null } = {}) => {
  const cid = BigInt(companyId);
  const rows = await db.$queryRaw`
    SELECT l.account_id, COALESCE(SUM(l.debit), 0)::float AS debit, COALESCE(SUM(l.credit), 0)::float AS credit
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.company_id = ${cid}
      ${from ? Prisma.sql`AND e.entry_date >= ${from}::date` : Prisma.empty}
      ${to ? Prisma.sql`AND e.entry_date <= ${to}::date` : Prisma.empty}
    GROUP BY l.account_id`;
  return new Map(rows.map((r) => [String(r.account_id), { debit: round2(r.debit), credit: round2(r.credit), net: round2(r.debit - r.credit) }]));
};

// Cash/bank account to use for a payment method when none was chosen.
const defaultMoneyAccount = (method) => (["cash", "cash_on_delivery"].includes(method) ? "cash" : "bank");

// Validates that an account id is one of the company's active cash/bank accounts.
const assertMoneyAccount = async (db, companyId, id) => {
  const acc = await db.accounts.findFirst({ where: { id: BigInt(id), company_id: BigInt(companyId), is_active: true } });
  const isMoney = acc && (["cash", "bank"].includes(acc.subtype) || (acc.type === "liability" && acc.subtype === "current_liability" && !acc.system_key));
  if (!isMoney) {
    throw new HttpError(400, "Choose a cash, bank or credit card account");
  }
  return acc;
};

const assertAccount = async (db, companyId, id, { types = null } = {}) => {
  const acc = await db.accounts.findFirst({ where: { id: BigInt(id), company_id: BigInt(companyId) } });
  if (!acc) throw new HttpError(400, "Account not found");
  if (!acc.is_active) throw new HttpError(400, `Account ${acc.code} ${acc.name} is inactive`);
  if (types && !types.includes(acc.type)) throw new HttpError(400, `Account ${acc.code} ${acc.name} can't be used here`);
  return acc;
};

module.exports = {
  DEFAULT_CHART, TYPES, SUBTYPES, debitNormal, accountingSettings, toDateStr,
  ensureChart, accountId, post, reverse, balances, defaultMoneyAccount, assertMoneyAccount, assertAccount, assertOpen, loadCompany,
};
