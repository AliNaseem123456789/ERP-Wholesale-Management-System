// Seller analytics: what buyers look at, search for and add to carts, plus orders and quotes, per company.
// Events carry no personal data: the visitor is an HMAC of the user id (signed in) or of a random browser id.
// Repeat events from the same visitor within 30 minutes are counted once. A company's own staff aren't counted.
const crypto = require("crypto");
const prisma = require("../prisma");
const { jwtSecret } = require("../config");
const { HttpError } = require("../utils/http");
const { num, round2 } = require("./money");

const KINDS = ["storefront_view", "product_view", "search_impression", "add_to_cart"];
const DEDUPE_MINUTES = 30;

const visitorOf = (req, browserId) => {
  const raw = req.user ? `u:${req.user.id}` : /^[a-zA-Z0-9-]{16,64}$/.test(String(browserId || "")) ? `b:${browserId}` : null;
  return raw ? crypto.createHmac("sha256", `${jwtSecret}:analytics`).update(raw).digest("hex").slice(0, 64) : null;
};

/** Companies the signed-in user works for (their own views aren't counted). */
const staffOf = async (req) => {
  if (!req.user) return new Set();
  const rows = await prisma.company_members.findMany({ where: { user_id: BigInt(req.user.id), status: "active" }, select: { company_id: true } });
  return new Set(rows.map((r) => String(r.company_id)));
};

/** Records events [{ company_id, product_id?, kind, query? }] for one visitor, skipping repeats. */
const record = async (req, events, browserId) => {
  const visitor = visitorOf(req, browserId);
  if (!visitor || !events.length) return 0;
  const staff = await staffOf(req);
  // only active members count as staff
  const since = new Date(Date.now() - DEDUPE_MINUTES * 60000);
  let n = 0;
  for (const e of events.slice(0, 30)) {
    if (!KINDS.includes(e.kind) || !e.company_id || staff.has(String(e.company_id))) continue;
    const query = e.query ? String(e.query).trim().toLowerCase().slice(0, 200) : null;
    const dup = await prisma.analytics_events.findFirst({
      where: { visitor, kind: e.kind, company_id: BigInt(e.company_id), product_id: e.product_id ? BigInt(e.product_id) : null, query, created_at: { gte: since } },
      select: { id: true },
    });
    if (dup) continue;
    await prisma.analytics_events.create({
      data: { visitor, kind: e.kind, company_id: BigInt(e.company_id), product_id: e.product_id ? BigInt(e.product_id) : null, query, is_buyer: !!req.user },
    });
    n++;
  }
  return n;
};

/**
 * Turns what the page reports into events. body: { kind: storefront|product|search, company_slug?, product_id?, query?, product_ids?, visitor }.
 * Only public, published things are accepted.
 */
const track = async (req, body) => {
  const { publicWhere } = require("./catalog");
  const kind = String(body.kind || "");
  if (kind === "storefront") {
    const c = await prisma.companies.findFirst({ where: { slug: String(body.company_slug || "").toLowerCase(), status: "active", storefront_published: true }, select: { id: true } });
    if (!c) return 0;
    return record(req, [{ company_id: c.id, kind: "storefront_view" }], body.visitor);
  }
  if (kind === "product") {
    if (!/^\d+$/.test(String(body.product_id || ""))) return 0;
    const p = await prisma.products.findFirst({ where: { ...publicWhere(req), id: BigInt(body.product_id) }, select: { id: true, company_id: true } });
    if (!p) return 0;
    return record(req, [{ company_id: p.company_id, product_id: p.id, kind: "product_view" }], body.visitor);
  }
  if (kind === "search") {
    const q = String(body.query || "").trim();
    const ids = (Array.isArray(body.product_ids) ? body.product_ids : []).filter((x) => /^\d+$/.test(String(x))).slice(0, 60);
    if (!q || !ids.length) return 0;
    const rows = await prisma.products.findMany({ where: { ...publicWhere(req), id: { in: ids.map((x) => BigInt(x)) } }, select: { company_id: true } });
    const companies = [...new Set(rows.map((r) => String(r.company_id)))];
    return record(req, companies.map((c) => ({ company_id: c, kind: "search_impression", query: q })), body.visitor);
  }
  throw new HttpError(400, "Unknown event");
};

/** Add-to-cart, recorded by the cart itself. Never fails the request. */
const recordAddToCart = (req, product) =>
  record(req, [{ company_id: product.company_id, product_id: product.id, kind: "add_to_cart" }]).catch((e) => console.error("analytics:", e.message));

const DAY = 86400000;
const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

/** The analytics page of one company for the last `days` days (and the same length before, for comparison). */
const report = async (companyId, days) => {
  const cid = BigInt(companyId);
  const end = new Date();
  const start = new Date(end.getTime() - days * DAY);
  const prevStart = new Date(start.getTime() - days * DAY);
  const ordersWhere = (from, to) => ({ company_id: cid, created_at: { gte: from, lt: to }, status: { not: "cancelled" } });

  const [byKind, prevByKind, visitors, prevVisitors, daily, topProductsRaw, searches, orders, prevOrders, orderDaily, lines, quotes, rfqs, customers] = await Promise.all([
    prisma.analytics_events.groupBy({ by: ["kind"], where: { company_id: cid, created_at: { gte: start } }, _count: true }),
    prisma.analytics_events.groupBy({ by: ["kind"], where: { company_id: cid, created_at: { gte: prevStart, lt: start } }, _count: true }),
    prisma.$queryRaw`SELECT count(DISTINCT visitor)::int AS n FROM analytics_events WHERE company_id = ${cid} AND created_at >= ${start} AND kind IN ('storefront_view','product_view')`,
    prisma.$queryRaw`SELECT count(DISTINCT visitor)::int AS n FROM analytics_events WHERE company_id = ${cid} AND created_at >= ${prevStart} AND created_at < ${start} AND kind IN ('storefront_view','product_view')`,
    prisma.$queryRaw`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, kind, count(*)::int AS n FROM analytics_events
                     WHERE company_id = ${cid} AND created_at >= ${start} GROUP BY 1, 2`,
    prisma.$queryRaw`SELECT product_id, sum((kind = 'product_view')::int)::int AS views, sum((kind = 'add_to_cart')::int)::int AS carts
                     FROM analytics_events WHERE company_id = ${cid} AND created_at >= ${start} AND product_id IS NOT NULL
                     GROUP BY 1 ORDER BY views DESC, carts DESC LIMIT 15`,
    prisma.$queryRaw`SELECT query, count(*)::int AS n FROM analytics_events WHERE company_id = ${cid} AND created_at >= ${start} AND kind = 'search_impression'
                     GROUP BY 1 ORDER BY n DESC LIMIT 15`,
    prisma.orders.aggregate({ where: ordersWhere(start, end), _count: true, _sum: { total_amount: true } }),
    prisma.orders.aggregate({ where: ordersWhere(prevStart, start), _count: true, _sum: { total_amount: true } }),
    prisma.$queryRaw`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n, coalesce(sum(total_amount), 0)::float AS revenue
                     FROM orders WHERE company_id = ${cid} AND created_at >= ${start} AND status <> 'cancelled' GROUP BY 1`,
    prisma.$queryRaw`SELECT oi.product_id, sum(oi.quantity)::int AS units, coalesce(sum(oi.quantity * oi.price_at_time), 0)::float AS revenue
                     FROM order_items oi JOIN orders o ON o.id = oi.order_id
                     WHERE o.company_id = ${cid} AND o.created_at >= ${start} AND o.status <> 'cancelled' AND oi.product_id IS NOT NULL
                     GROUP BY 1 ORDER BY revenue DESC LIMIT 15`,
    prisma.quotes.groupBy({ by: ["status"], where: { company_id: cid, created_at: { gte: start } }, _count: true }),
    prisma.$queryRaw`SELECT count(*)::int AS invited, sum((q.status = 'accepted')::int)::int AS won, sum((q.status IN ('sent','accepted','declined','expired') AND q.version > 0)::int)::int AS answered
                     FROM quotes q WHERE q.company_id = ${cid} AND q.rfq_id IS NOT NULL AND q.created_at >= ${start}`,
    prisma.$queryRaw`SELECT count(*)::int AS buyers, sum((first_at >= ${start})::int)::int AS new_buyers FROM (
                       SELECT user_id, min(created_at) AS first_at FROM orders WHERE company_id = ${cid} AND status <> 'cancelled' AND user_id IS NOT NULL GROUP BY 1
                     ) t WHERE t.user_id IN (SELECT user_id FROM orders WHERE company_id = ${cid} AND created_at >= ${start} AND status <> 'cancelled')`,
  ]);

  const count = (rows, k) => rows.find((r) => r.kind === k)?._count || 0;
  const pids = [...new Set([...topProductsRaw.map((r) => r.product_id), ...lines.map((r) => r.product_id)].map(String))];
  const products = pids.length ? await prisma.products.findMany({ where: { id: { in: pids.map((x) => BigInt(x)) } }, select: { id: true, title: true, slug: true, sku: true } }) : [];
  const name = (id) => products.find((p) => String(p.id) === String(id));

  // one row per product with views, add-to-carts, units and revenue
  const table = new Map();
  for (const r of topProductsRaw) table.set(String(r.product_id), { product_id: r.product_id, views: r.views, carts: r.carts, units: 0, revenue: 0 });
  for (const r of lines) {
    const t = table.get(String(r.product_id)) || { product_id: r.product_id, views: 0, carts: 0, units: 0, revenue: 0 };
    t.units = r.units; t.revenue = round2(r.revenue);
    table.set(String(r.product_id), t);
  }
  const top = [...table.values()].map((t) => ({ ...t, title: name(t.product_id)?.title || "Deleted product", slug: name(t.product_id)?.slug, sku: name(t.product_id)?.sku, view_to_cart: t.views ? round2((t.carts / t.views) * 100) : null }))
    .sort((a, b) => b.revenue - a.revenue || b.views - a.views).slice(0, 15);

  const series = [];
  for (let t = new Date(isoDay(start)).getTime(); t <= end.getTime(); t += DAY) {
    const day = isoDay(t);
    const ev = daily.filter((d) => d.day === day);
    const o = orderDaily.find((d) => d.day === day);
    series.push({
      day,
      views: ev.filter((d) => d.kind === "storefront_view" || d.kind === "product_view").reduce((s, d) => s + d.n, 0),
      carts: ev.find((d) => d.kind === "add_to_cart")?.n || 0,
      orders: o?.n || 0,
      revenue: round2(o?.revenue || 0),
    });
  }

  const qc = (s) => quotes.find((q) => q.status === s)?._count || 0;
  const sentQuotes = ["sent", "accepted", "declined", "expired", "countered"].reduce((s, k) => s + qc(k), 0);
  const v = visitors[0]?.n || 0;
  const pv = prevVisitors[0]?.n || 0;
  return {
    days, from: start, to: end,
    totals: {
      storefront_views: count(byKind, "storefront_view"), product_views: count(byKind, "product_view"),
      search_impressions: count(byKind, "search_impression"), add_to_carts: count(byKind, "add_to_cart"),
      visitors: v, orders: orders._count, revenue: round2(num(orders._sum.total_amount)),
      conversion: v ? round2((orders._count / v) * 100) : null,
      buyers: customers[0]?.buyers || 0, new_buyers: customers[0]?.new_buyers || 0,
    },
    previous: {
      storefront_views: count(prevByKind, "storefront_view"), product_views: count(prevByKind, "product_view"),
      search_impressions: count(prevByKind, "search_impression"), add_to_carts: count(prevByKind, "add_to_cart"),
      visitors: pv, orders: prevOrders._count, revenue: round2(num(prevOrders._sum.total_amount)),
    },
    series,
    top_products: top,
    top_searches: searches.map((s) => ({ query: s.query, impressions: s.n })),
    quotes: { sent: sentQuotes, accepted: qc("accepted"), win_rate: sentQuotes ? round2((qc("accepted") / sentQuotes) * 100) : null, requested: qc("requested") },
    rfqs: { invited: rfqs[0]?.invited || 0, answered: rfqs[0]?.answered || 0, won: rfqs[0]?.won || 0 },
  };
};

module.exports = { track, record, recordAddToCart, report, visitorOf };
