// Recurring orders: the same lines every week / 2 weeks / month.
//   mode "auto":   the order is placed automatically (same checks as checkout); if it can't be, a cart with the
//                  lines is prepared instead and the customer is told why
//   mode "review": a cart with the lines is prepared and the customer is asked to check and order it
// Run by the scheduler (claimed with FOR UPDATE SKIP LOCKED, so several API instances never run one twice).
const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const inv = require("./inventory");
const { publicWhere } = require("./catalog");
const { loadRules, lineProblem } = require("./orderRules");
const carts = require("./carts");
const { queueEmail } = require("./email/outbox");
const { getPermissions } = require("./users");

const FREQUENCIES = ["weekly", "biweekly", "monthly"];
const DAY = 86400000;
const dateOnly = (d) => new Date(`${new Date(d).toISOString().slice(0, 10)}T00:00:00Z`);
const today = () => dateOnly(new Date());
const iso = (d) => new Date(d).toISOString().slice(0, 10);

/** First date on or after `from` matching the schedule. */
const firstRun = (frequency, dayOfWeek, dayOfMonth, from = today()) => {
  const d = dateOnly(from);
  if (frequency === "monthly") {
    const candidate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), dayOfMonth));
    return candidate >= d ? candidate : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, dayOfMonth));
  }
  const diff = (dayOfWeek - d.getUTCDay() + 7) % 7;
  return new Date(d.getTime() + diff * DAY);
};

/** The run after `date`. */
const nextAfter = (frequency, dayOfMonth, date) => {
  const d = dateOnly(date);
  if (frequency === "weekly") return new Date(d.getTime() + 7 * DAY);
  if (frequency === "biweekly") return new Date(d.getTime() + 14 * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, dayOfMonth));
};

/** Validated schedule + lines from a form. */
const recurringData = async (req, b, existing = null) => {
  const d = {};
  if (!existing || b.name !== undefined) {
    d.name = String(b.name || "").trim().slice(0, 120);
    if (!d.name) throw new HttpError(400, "Give the recurring order a name");
  }
  const frequency = b.frequency ?? existing?.frequency;
  if (!FREQUENCIES.includes(frequency)) throw new HttpError(400, `How often must be one of: ${FREQUENCIES.join(", ")}`);
  d.frequency = frequency;
  if (frequency === "monthly") {
    const dom = Number(b.day_of_month ?? existing?.day_of_month ?? 1);
    if (!Number.isInteger(dom) || dom < 1 || dom > 28) throw new HttpError(400, "Day of the month must be 1 to 28");
    d.day_of_month = dom;
    d.day_of_week = null;
  } else {
    const dow = Number(b.day_of_week ?? existing?.day_of_week ?? 1);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) throw new HttpError(400, "Choose a day of the week");
    d.day_of_week = dow;
    d.day_of_month = null;
  }
  if (b.mode !== undefined || !existing) {
    const mode = b.mode || "review";
    if (!["auto", "review"].includes(mode)) throw new HttpError(400, "Mode must be auto or review");
    d.mode = mode;
  }
  if (b.status !== undefined) {
    if (!["active", "paused"].includes(b.status)) throw new HttpError(400, "Status must be active or paused");
    d.status = b.status;
  }
  for (const [k, label] of [["shipping_address_id", "Delivery address"], ["billing_address_id", "Billing address"]]) {
    if (b[k] === undefined) continue;
    if (!b[k]) { d[k] = null; continue; }
    const a = await prisma.addresses.findFirst({ where: { id: toId(b[k], k), user_id: BigInt(req.user.id) } });
    if (!a) throw new HttpError(400, `${label}: choose one of your saved addresses`);
    d[k] = a.id;
  }
  if ((d.mode || existing?.mode) === "auto" && !(d.shipping_address_id ?? existing?.shipping_address_id)) throw new HttpError(400, "Automatic orders need a delivery address");
  if (b.payment_methods !== undefined) {
    const pm = {};
    for (const [k, v] of Object.entries(b.payment_methods || {})) {
      if (!/^\d+$/.test(k) || !["cash_on_delivery", "on_account"].includes(v)) throw new HttpError(400, "Invalid payment choice");
      pm[k] = v;
    }
    d.payment_methods = pm;
  }
  if (b.skip_next !== undefined) d.skip_next = !!b.skip_next;
  // schedule: recompute when it changed (or on create); an explicit start date wins
  const changed = !existing || ["frequency", "day_of_week", "day_of_month"].some((k) => d[k] !== undefined && d[k] !== existing[k]) || b.start_on;
  if (changed) {
    const from = b.start_on ? dateOnly(b.start_on) : new Date(today().getTime() + DAY); // never today: give time to review
    if (Number.isNaN(from.getTime())) throw new HttpError(400, "Start date isn't valid");
    if (from < today()) throw new HttpError(400, "The start date is in the past");
    d.next_run_on = firstRun(d.frequency, d.day_of_week, d.day_of_month, from);
  }
  return d;
};

/** Validated lines: [{ product_id, flavor, quantity }] (visible to the customer, option still sold, buying rules). */
const linesData = async (req, items) => {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, "Add at least one product");
  if (items.length > 200) throw new HttpError(400, "At most 200 lines");
  const ids = items.map((i) => toId(i.product_id, "product"));
  const products = await prisma.products.findMany({ where: { ...publicWhere(req), id: { in: ids } }, select: { id: true, title: true, flavors: true } });
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const rules = await loadRules(ids);
  const out = [];
  for (const [i, it] of items.entries()) {
    const p = byId.get(String(ids[i]));
    if (!p) throw new HttpError(400, `Line ${i + 1}: that product isn't available`);
    const flavor = inv.resolveFlavor(p, it.flavor);
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new HttpError(400, `Line ${i + 1}: quantity must be a whole number`);
    const msg = lineProblem(rules, p.id, flavor, qty);
    if (msg) throw new HttpError(400, msg);
    const dup = out.find((o) => String(o.product_id) === String(p.id) && o.flavor === flavor);
    if (dup) dup.quantity += qty;
    else out.push({ product_id: p.id, flavor, quantity: qty });
  }
  return out;
};

const notify = async (userId, data) => {
  const u = await prisma.users.findUnique({ where: { id: BigInt(userId) }, select: { email: true } });
  if (u) await queueEmail({ to: u.email, template: "notice", data });
};

/**
 * Runs one recurring order now. Doesn't move the schedule (the caller does).
 * Returns the result stored in last_result.
 */
const runOne = async (ro) => {
  const { placeOrders, linesToItems, sendOrderEmails } = require("./placeOrder");
  const user = await prisma.users.findUnique({ where: { id: ro.user_id }, select: { id: true, role: true, email: true } });
  const lines = await prisma.recurring_order_items.findMany({ where: { recurring_order_id: ro.id }, include: { products: { select: { title: true } } } });
  const req = { user: { id: String(user.id), role: user.role } };
  const prepareCart = async () => {
    const cart = await prisma.carts.create({ data: { user_id: ro.user_id, name: `${ro.name} · ${iso(new Date())}`.slice(0, 120), address_id: ro.shipping_address_id } });
    const r = await carts.addLines(req, cart, lines.map((l) => ({ product_id: l.product_id, flavor: l.flavor, quantity: l.quantity, title: l.products?.title })));
    return { cart, ...r };
  };

  if (ro.mode === "auto") {
    let reason = null;
    if (user.role === "SUBACCOUNT" && !(await getPermissions(req.user))?.can_place_order) reason = "your account can't place orders";
    if (!ro.shipping_address_id) reason = "it has no delivery address";
    if (!reason) {
      try {
        const created = await placeOrders({
          user: req.user,
          loadItems: (tx) => linesToItems(tx, lines),
          shippingId: ro.shipping_address_id, billingId: ro.billing_address_id || ro.shipping_address_id,
          promoCodes: [], paymentMethods: ro.payment_methods || {}, recurringOrderId: ro.id,
        });
        await sendOrderEmails(ro.user_id, created, { recurringName: ro.name });
        const numbers = created.map((c) => c.order.order_number);
        await notify(ro.user_id, { type: "recurring.placed", title: `Recurring order "${ro.name}" placed`, lines: [`Order(s) ${numbers.join(", ")} were placed automatically.`], link: "/account?tab=orders", linkLabel: "View orders" });
        return { ok: true, message: `Placed ${numbers.join(", ")}`, order_numbers: numbers };
      } catch (err) {
        reason = err instanceof HttpError ? err.message : "something went wrong";
        if (!(err instanceof HttpError)) console.error(`recurring order ${ro.id} failed:`, err.message);
      }
    }
    const prep = await prepareCart();
    await notify(ro.user_id, {
      type: "recurring.failed", title: `Recurring order "${ro.name}" needs you`,
      lines: [`It couldn't be placed automatically: ${reason}.`, `We put the items in a cart called "${prep.cart.name}" so you can check and order them.`],
      link: `/cart?cart=${prep.cart.id}`, linkLabel: "Open the cart",
    });
    return { ok: false, message: reason, cart_id: Number(prep.cart.id), added: prep.added.length, skipped: prep.skipped };
  }

  const prep = await prepareCart();
  await notify(ro.user_id, {
    type: "recurring.review", title: `Your recurring order "${ro.name}" is ready to check`,
    lines: [`${prep.added.length} item(s) are in the cart "${prep.cart.name}".`, ...(prep.skipped.length ? [`Needs attention: ${prep.skipped.map((s) => `${s.title} (${s.reason})`).join("; ")}`] : [])],
    link: `/cart?cart=${prep.cart.id}`, linkLabel: "Review and order",
  });
  return { ok: true, message: `Cart "${prep.cart.name}" prepared`, cart_id: Number(prep.cart.id), added: prep.added.length, skipped: prep.skipped };
};

/** Claims due recurring orders (moving their next date first) and runs them. */
const runDue = async () => {
  const claimed = await prisma.$transaction(async (tx) => {
    const due = await tx.$queryRaw`SELECT id FROM recurring_orders WHERE status = 'active' AND next_run_on <= ${today()} ORDER BY next_run_on LIMIT 20 FOR UPDATE SKIP LOCKED`;
    const out = [];
    for (const { id } of due) {
      const ro = await tx.recurring_orders.findUnique({ where: { id } });
      await tx.recurring_orders.update({ where: { id }, data: { next_run_on: nextAfter(ro.frequency, ro.day_of_month, ro.next_run_on), skip_next: false, last_run_at: new Date(), updated_at: new Date() } });
      out.push(ro);
    }
    return out;
  });
  for (const ro of claimed) {
    let result;
    if (ro.skip_next) result = { ok: true, message: "Skipped (you chose to skip this one)" };
    else {
      try {
        result = await runOne(ro);
      } catch (err) {
        console.error(`recurring order ${ro.id}:`, err.message);
        result = { ok: false, message: "Something went wrong; please order manually this time" };
      }
    }
    await prisma.recurring_orders.update({ where: { id: ro.id }, data: { last_result: { ...result, ran_on: iso(new Date()) } } });
  }
  return claimed.length;
};

module.exports = { FREQUENCIES, firstRun, nextAfter, recurringData, linesData, runOne, runDue, iso };
