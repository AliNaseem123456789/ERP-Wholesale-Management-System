// Quote workflow extras: margins, versions, messages / counter-offers, requests to several sellers (RFQ), reminders.
const prisma = require("../prisma");
const { HttpError } = require("../utils/http");
const { num, round2 } = require("./money");
const inv = require("./inventory");
const { getSalesSettings } = require("./salesSettings");
const { queueEmail } = require("./email/outbox");
const { notifyStaff } = require("./inapp");

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/**
 * Cost and margin of every line, using the variant's average cost when it has one.
 * Returns { lines: [{ item_id, cost, margin_percent, below_cost, below_min }], cost, margin_percent, below_cost, below_min, min_margin }.
 */
const marginFor = async (db, quote, company) => {
  const items = quote.quote_items || (await db.quote_items.findMany({ where: { quote_id: quote.id } }));
  const settings = getSalesSettings(company);
  const minMargin = settings.minMarginPercent === null || settings.minMarginPercent === undefined || settings.minMarginPercent === "" ? null : Number(settings.minMarginPercent);
  const pids = [...new Set(items.map((i) => i.product_id))];
  const [products, variants] = await Promise.all([
    db.products.findMany({ where: { id: { in: pids } }, select: { id: true, cost_price: true } }),
    db.product_variants.findMany({ where: { product_id: { in: pids } }, select: { product_id: true, flavor: true, cost_price: true } }),
  ]);
  let totalCost = 0;
  let totalSales = 0;
  const lines = items.map((i) => {
    const v = i.flavor ? variants.find((x) => x.product_id === i.product_id && x.flavor === i.flavor) : null;
    const cost = num(v?.cost_price ?? products.find((p) => p.id === i.product_id)?.cost_price ?? 0);
    const unit = num(i.unit_price);
    totalCost += cost * i.quantity;
    totalSales += unit * i.quantity;
    const margin = unit > 0 ? round2(((unit - cost) / unit) * 100) : cost > 0 ? -100 : 0;
    return { item_id: i.id, cost: round2(cost), margin_percent: margin, below_cost: cost > 0 && unit < cost, below_min: minMargin !== null && cost > 0 && margin < minMargin };
  });
  const margin = totalSales > 0 ? round2(((totalSales - totalCost) / totalSales) * 100) : 0;
  return {
    lines, cost: round2(totalCost), margin_percent: margin, min_margin: minMargin, block_below_cost: !!settings.blockBelowCost,
    below_cost: lines.some((l) => l.below_cost), below_min: lines.some((l) => l.below_min),
  };
};

/** Margin problems as readable warnings. */
const marginWarnings = (m, items) => {
  const name = (id) => { const i = items.find((x) => String(x.id) === String(id)); return i ? inv.label(i.products?.title || "item", i.flavor) : "a line"; };
  const out = [];
  for (const l of m.lines) {
    if (l.below_cost) out.push(`${name(l.item_id)} is priced below cost (cost ${l.cost.toFixed(2)})`);
    else if (l.below_min) out.push(`${name(l.item_id)} has a ${l.margin_percent}% margin, below your minimum of ${m.min_margin}%`);
  }
  return out;
};

/** What the customer sees for one version. */
const snapshotOf = (quote, items) => ({
  items: items.map((i) => ({ item_id: Number(i.id), title: inv.label(i.products?.title || "Item", i.flavor), quantity: i.quantity, unit_price: num(i.unit_price), line_total: num(i.line_total) })),
  subtotal: num(quote.subtotal), discount: num(quote.discount_amount), shipping: num(quote.shipping_amount), tax: num(quote.tax_amount),
  total: num(quote.total_amount), valid_until: iso(quote.valid_until), lead_time_days: quote.lead_time_days ?? null, notes: quote.notes || null,
});

const messagesOf = async (db, quoteId) => {
  const rows = await db.quote_messages.findMany({ where: { quote_id: BigInt(quoteId) }, orderBy: { created_at: "asc" } });
  const users = await db.users.findMany({ where: { id: { in: rows.map((r) => r.author_id).filter(Boolean) } }, select: { id: true, first_name: true, last_name: true, email: true, business_name: true } });
  return rows.map((r) => {
    const u = users.find((x) => x.id === r.author_id);
    return { ...r, author: u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || u.business_name || u.email : null };
  });
};

const versionsOf = (db, quoteId) => db.quote_versions.findMany({ where: { quote_id: BigInt(quoteId) }, orderBy: { version: "desc" }, select: { version: true, snapshot: true, created_at: true } });

/**
 * Validates a customer's counter-offer against the quote's lines.
 * body.lines: [{ item_id, unit_price?, quantity? }]; body.total? (target total). At least one change or a message.
 */
const proposalFrom = (quote, body) => {
  const lines = [];
  for (const l of Array.isArray(body.lines) ? body.lines : []) {
    const item = quote.quote_items.find((i) => String(i.id) === String(l.item_id));
    if (!item) throw new HttpError(400, "One of the lines isn't part of this quote");
    const out = { item_id: Number(item.id) };
    if (l.unit_price !== undefined && l.unit_price !== null && l.unit_price !== "") {
      const p = Number(l.unit_price);
      if (!Number.isFinite(p) || p < 0) throw new HttpError(400, "Proposed prices must be 0 or more");
      if (p !== num(item.unit_price)) out.unit_price = round2(p * 10000) / 10000;
    }
    if (l.quantity !== undefined && l.quantity !== null && l.quantity !== "") {
      const q = Number(l.quantity);
      if (!Number.isInteger(q) || q < 1) throw new HttpError(400, "Proposed quantities must be whole numbers");
      if (q !== item.quantity) out.quantity = q;
    }
    if (out.unit_price !== undefined || out.quantity !== undefined) lines.push(out);
  }
  let total = null;
  if (body.total !== undefined && body.total !== null && body.total !== "") {
    total = Number(body.total);
    if (!Number.isFinite(total) || total < 0) throw new HttpError(400, "The target total must be 0 or more");
  }
  if (!lines.length && total === null) return null;
  return { lines, ...(total !== null ? { total } : {}) };
};

/** When one quote of a request is accepted, the others are declined and the request is marked awarded. */
const closeRfq = async (rfqId, winnerQuoteId) => {
  if (!rfqId) return;
  const others = await prisma.quotes.findMany({
    where: { rfq_id: BigInt(rfqId), NOT: { id: BigInt(winnerQuoteId) }, status: { in: ["requested", "draft", "sent", "countered"] } },
    include: { companies: { select: { id: true, name: true } }, users: { select: { email: true, business_name: true, first_name: true } } },
  });
  await prisma.$transaction([
    prisma.quotes.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: "declined", updated_at: new Date() } }),
    prisma.rfqs.update({ where: { id: BigInt(rfqId) }, data: { status: "awarded", awarded_quote_id: BigInt(winnerQuoteId), updated_at: new Date() } }),
  ]);
  for (const o of others) {
    await notifyStaff(o.company_id, "quotes.manage", {
      type: "quote.lost", title: `Quote ${o.quote_number} wasn't chosen`, body: `${o.users.business_name || o.users.first_name || o.users.email} accepted another offer`, link: "/business/quotes",
    });
  }
};

/**
 * Reminders (run by the scheduler; each is sent once):
 *  - sent quotes with no answer after the seller's follow-up days: reminder to the customer + note to the sales team
 *  - sent quotes expiring within 2 days: reminder to the customer
 *  - quote requests nobody has started after a day: note to the sales team
 */
const quoteReminders = async () => {
  const now = new Date();
  let n = 0;
  const sent = await prisma.quotes.findMany({
    where: { status: "sent", OR: [{ follow_up_sent_at: null }, { expiry_reminder_sent_at: null }] },
    include: { companies: true, users: { select: { email: true } } },
    take: 500,
  });
  for (const q of sent) {
    const settings = getSalesSettings(q.companies);
    const days = Number(settings.quoteFollowUpDays) || 0;
    const last = q.sent_at || q.updated_at;
    if (days > 0 && !q.follow_up_sent_at && last && now - last > days * 86400000) {
      const claimed = await prisma.quotes.updateMany({ where: { id: q.id, follow_up_sent_at: null }, data: { follow_up_sent_at: now } });
      if (claimed.count) {
        await queueEmail({ to: q.users.email, template: "notice", data: { type: "quote.followup", title: `Quotation ${q.quote_number} from ${q.companies.name} is waiting for you`, lines: [`Total ${num(q.total_amount).toFixed(2)}, valid until ${iso(q.valid_until)}.`, "Accept it, ask for changes, or decline it."], link: "/account?tab=quotes", linkLabel: "Open the quote" } });
        await notifyStaff(q.company_id, "quotes.manage", { type: "quote.no_answer", title: `No answer yet on quote ${q.quote_number}`, body: `Sent ${iso(last)}; maybe follow up with the customer`, link: `/business/quotes/${q.id}`, dedupeKey: `quote-followup:${q.id}` });
        n++;
      }
    }
    if (!q.expiry_reminder_sent_at && q.valid_until && q.valid_until - now < 2 * 86400000 && q.valid_until >= new Date(now.toISOString().slice(0, 10))) {
      const claimed = await prisma.quotes.updateMany({ where: { id: q.id, expiry_reminder_sent_at: null }, data: { expiry_reminder_sent_at: now } });
      if (claimed.count) {
        await queueEmail({ to: q.users.email, template: "notice", data: { type: "quote.expiring", title: `Quotation ${q.quote_number} expires on ${iso(q.valid_until)}`, lines: [`${q.companies.name}'s offer of ${num(q.total_amount).toFixed(2)} ends soon.`], link: "/account?tab=quotes", linkLabel: "Open the quote" } });
        n++;
      }
    }
  }
  const waiting = await prisma.quotes.findMany({ where: { status: { in: ["requested", "countered"] }, updated_at: { lt: new Date(now - 86400000) } }, select: { id: true, company_id: true, quote_number: true, status: true }, take: 500 });
  for (const q of waiting) {
    n += await notifyStaff(q.company_id, "quotes.manage", {
      type: "quote.waiting", title: q.status === "countered" ? `Customer asked for changes on ${q.quote_number}` : `Quote request ${q.quote_number} is waiting`,
      body: "Open it to prepare an answer", link: `/business/quotes/${q.id}`, dedupeKey: `quote-waiting:${q.id}:${q.status}`,
    });
  }
  return n;
};

module.exports = { marginFor, marginWarnings, snapshotOf, messagesOf, versionsOf, proposalFrom, closeRfq, quoteReminders, iso };
