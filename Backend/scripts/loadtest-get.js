// Speed test of every GET endpoint, one request at a time (no parallel users).
//
//   npm run loadtest:get                         -> every GET endpoint, 10 times each, against http://localhost:5000
//   npm run loadtest:get -- --runs=5             -> 5 times each
//   npm run loadtest:get -- --only=marketplace   -> only endpoints whose path contains "marketplace" (comma = several)
//   npm run loadtest:get -- --skip=pdf,export    -> leave those out
//   npm run loadtest:get -- --url=https://api.example.com
//
// It reads the endpoints from src/app.js and src/routes/*.js, so new ones are included automatically, and calls
// each as the kind of user it is for:
//   marketplace, products, public pages -> a visitor (not signed in) and the demo buyer
//   account, cart, orders, notifications -> the demo buyer
//   company (back office)                -> the demo seller's owner, with its company selected
//   admin                                -> the platform admin (only if LOADTEST_ADMIN_EMAIL and _PASSWORD are set)
// Log-ins (change in .env): LOADTEST_BUYER, LOADTEST_SELLER, LOADTEST_PASSWORD (defaults: the demo accounts).
//
// Ids and slugs in paths (/company/orders/:id) are taken from the matching list (/company/orders), so only
// records that user can see are used. GET requests only: nothing is changed. Endpoints it can't fill in are
// listed as skipped with the reason.
//
// Results: a table in the terminal (slowest first) and loadtest-reports/get-<time>.csv / .json with every
// endpoint's status, min / median / p95 / max / mean time, the first (cold) call, and the server's own figures
// (time in the database, queries and round trips per request, from the Server-Timing header).
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const arg = (name, fallback) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
};
const RUNS = Math.max(1, Number(arg("runs", process.env.LOADTEST_RUNS || 10)) || 10);
const BASE = String(arg("url", process.env.LOADTEST_URL || `http://localhost:${process.env.PORT || 5000}`)).replace(/\/$/, "");
const ONLY = String(arg("only", "")).split(",").map((x) => x.trim()).filter(Boolean);
const SKIP = String(arg("skip", "")).split(",").map((x) => x.trim()).filter(Boolean);
const TIMEOUT = Number(process.env.LOADTEST_TIMEOUT_MS) || 60000;
const PASSWORD = process.env.LOADTEST_PASSWORD || "DemoPass2026!";
const USERS = {
  buyer: { email: process.env.LOADTEST_BUYER || "demo@corner-market.example.com", password: PASSWORD },
  seller: { email: process.env.LOADTEST_SELLER || "demo@meridian-trade.example.com", password: PASSWORD },
  admin: process.env.LOADTEST_ADMIN_EMAIL && process.env.LOADTEST_ADMIN_PASSWORD ? { email: process.env.LOADTEST_ADMIN_EMAIL, password: process.env.LOADTEST_ADMIN_PASSWORD } : null,
};

// never called: secrets in the address, or not a page
const NEVER = [/\/invitations\/:token/, /\/seo\/share\//];

// where a path parameter comes from when it isn't "the list just above it"
//   path pattern -> { from: list path (may hold params itself), pick: field holding the list, field: value to use }
const SOURCES = [
  [/^\/api\/products\/product\/:id$/, { from: "/api/marketplace/products", field: "slug" }],
  [/^\/api\/products\/brand\/:brand$/, { from: "/api/products/brands", field: "name" }],
  [/^\/api\/products\/category\/:category$/, { from: "/api/products/categories", field: "name" }],
  [/^\/api\/marketplace\/companies\/:slug\/collections\/:collection$/, { from: "/api/marketplace/companies/:slug", pick: "collections", field: "slug" }],
  [/^\/api\/account\/orders\/:id\/returnable$/, { from: "/api/orders/my-orders", field: "id" }],
  [/^\/api\/cart\/saved-cart-templates-details\/:id$/, { from: "/api/cart/saved-cart-templates", field: "id" }],
  [/^\/api\/company\/export\/:type$/, { from: "/api/company/data/types", pick: "exports", field: "type", where: (x) => x.allowed !== false }],
  [/^\/api\/company\/import\/:type\/template$/, { from: "/api/company/data/types", field: "type", where: (x) => x.allowed !== false }],
  [/^\/api\/company\/reports\/run\/:key$/, { from: "/api/company/reports/catalog", field: "key" }],
  [/^\/api\/company\/me\/hr\/payslips\/:id\/pdf$/, { from: "/api/company/me/hr", pick: "payslips", field: "id" }],
  [/^\/api\/company\/payroll\/payslips\/:id\/pdf$/, { from: "/api/company/payroll/runs/:id", pick: "payslips", field: "id" }],
  [/^\/api\/company\/inventory\/products\/:id$/, { from: "/api/company/products", field: "id" }],
  [/^\/api\/company\/scan\/orders\/:id$/, { from: "/api/company/orders", field: "id" }],
  [/^\/api\/company\/scan\/purchase-orders\/:id$/, { from: "/api/company/purchase-orders", field: "id" }],
  [/^\/api\/account\/credit-notes\/:id\/pdf$/, { from: "/api/account/invoices", pick: "credit_notes", field: "id" }],
  [/^\/api\/admin\/commission\/statements\/:id$/, { from: "/api/admin/commission", pick: "statements", field: "id" }],
  [/^\/api\/company\/commission\/statements\/:id$/, { from: "/api/company/commission", field: "id" }],
  [/^\/api\/marketplace\/collections\/:slug$/, { from: "/api/marketplace/home", pick: "collections", field: "slug" }],
];

// endpoints that need a query parameter to answer: path -> { param, from, field, where }
const QUERIES = [
  ["/api/company/inventory/lookup", { param: "code", from: "/api/company/products", field: "sku" }],
  ["/api/company/scan/lookup", { param: "code", from: "/api/company/products", field: "sku" }],
  ["/api/company/accounting/reports/general-ledger", { param: "account_id", from: "/api/company/accounting/accounts", field: "id" }],
  ["/api/company/accounting/reconcile", { param: "account_id", from: "/api/company/accounting/accounts", field: "id", where: (a) => ["bank", "cash"].includes(a.subtype) || a.code === "1010" }],
];

// ------------------------------------------------------------------------------------------------ endpoints
const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(f, "utf8");

/** [{ path: "/api/company/orders/:id", file }] from app.js and the route files (each file under its first mount). */
const discover = () => {
  const app = read(path.join(SRC, "app.js"));
  const vars = Object.fromEntries([...app.matchAll(/const (\w+) = require\("\.\/routes\/([\w.]+)"\)/g)].map((m) => [m[1], m[2]]));
  const mounts = [];
  for (const m of app.matchAll(/app\.use\(\s*"([^"]+)"\s*,\s*(?:require\("\.\/routes\/([\w.]+)"\)|(\w+))\s*\)/g)) {
    const file = m[2] || vars[m[3]];
    if (file && !mounts.some((x) => x.file === file)) mounts.push({ base: m[1], file });
  }
  const out = [];
  for (const { base, file } of mounts) {
    const src = read(path.join(SRC, "routes", file.endsWith(".js") ? file : `${file}.js`));
    for (const m of src.matchAll(/router\.get\(\s*(["'`])([^"'`]+)\1/g)) out.push({ path: (base + (m[2] === "/" ? "" : m[2])).replace(/\/+$/, "") || base, file });
  }
  for (const m of app.matchAll(/app\.get\(\s*"(\/api[^"]+)"/g)) out.push({ path: m[1], file: "app.js" });
  return [...new Map(out.map((e) => [e.path, e])).values()];
};

const roleFor = (p) => {
  if (p.startsWith("/api/admin")) return ["admin"];
  if (p.startsWith("/api/company")) return ["seller"];
  if (/^\/api\/(marketplace|products|seo|health|companies|invitations)/.test(p)) return ["visitor", "buyer"];
  return ["buyer"];
};

// ------------------------------------------------------------------------------------------------ http
class Session {
  constructor(name, creds) { this.name = name; this.creds = creds; this.jar = new Map(); this.headers = {}; }
  cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  keep(res) { for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(";"); const i = kv.indexOf("="); this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); } }
  async raw(method, p, body) {
    const res = await fetch(BASE + p, {
      method, signal: AbortSignal.timeout(TIMEOUT),
      headers: { ...(this.jar.size ? { cookie: this.cookie() } : {}), ...(body ? { "content-type": "application/json" } : {}), ...this.headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    this.keep(res);
    return res;
  }
  async login() {
    if (!this.creds) return;
    const res = await this.raw("POST", "/api/auth/login", this.creds);
    if (!res.ok) throw new Error(`${this.name} log-in as ${this.creds.email} failed (${res.status}): ${(await res.text()).slice(0, 120)}`);
  }
  /** GET; on 401 (an expired session during a long run) refreshes once and tries again. */
  async get(p) {
    let res = await this.raw("GET", p);
    if (res.status === 401 && this.creds) {
      await res.arrayBuffer();
      const r = await this.raw("POST", "/api/auth/refresh");
      if (!r.ok) await this.login();
      res = await this.raw("GET", p);
    }
    return res;
  }
  async json(p) {
    const res = await this.get(p);
    if (!res.ok) { await res.arrayBuffer(); return null; }
    try { return await res.json(); } catch { return null; }
  }
}

/** The first list of objects in a response: the response itself, data, or an array inside data (pick = its name). */
const listIn = (j, pick) => {
  const cands = [];
  const add = (v) => { if (Array.isArray(v)) cands.push(v); };
  if (pick) { add(j?.[pick]); add(j?.data?.[pick]); } else {
    add(j); add(j?.data); add(j?.data?.data);
    for (const o of [j?.data, j]) if (o && typeof o === "object" && !Array.isArray(o)) for (const v of Object.values(o)) add(v);
  }
  return cands.find((a) => a.length && typeof a[0] === "object") || [];
};

// ------------------------------------------------------------------------------------------------ filling in paths
const cache = new Map(); // "<session> <list path>" -> response
/** Fills a path's parameters left to right; an entry in SOURCES applies to the last one. */
const fill = async (s, tpl, depth = 0, values = {}) => {
  let p = tpl;
  for (const [k, v] of Object.entries(values)) p = p.replace(`:${k}`, v);
  const remaining = [...p.matchAll(/:(\w+)/g)].map((m) => m[1]);
  if (!remaining.length) {
    const q = depth === 0 && QUERIES.find(([x]) => x === tpl)?.[1];
    if (!q) return { path: p };
    const key = `${s.name} ${q.from}`;
    if (!cache.has(key)) cache.set(key, await s.json(q.from));
    const item = listIn(cache.get(key)).find((x) => x[q.field] !== undefined && x[q.field] !== null && (!q.where || q.where(x)));
    if (!item) return { skip: `no ${q.field} found in ${q.from} for ?${q.param}=` };
    return { path: `${p}?${q.param}=${encodeURIComponent(String(item[q.field]))}` };
  }
  if (depth > 4) return { skip: "too many nested parameters" };
  const param = remaining[0];
  const rule = remaining.length === 1 ? SOURCES.find(([re]) => re.test(tpl))?.[1] : null;
  const from = rule?.from || p.slice(0, p.indexOf(`/:${param}`));
  const src = await fill(s, from, depth + 1, values);
  if (src.skip) return src;
  const key = `${s.name} ${src.path}`;
  if (!cache.has(key)) cache.set(key, await s.json(src.path));
  const j = cache.get(key);
  if (!j) return { skip: `couldn't read ${src.path}` };
  const field = rule?.field || (param === "slug" ? "slug" : param === "id" ? "id" : param);
  const item = listIn(j, rule?.pick).find((x) => x[field] !== undefined && x[field] !== null && (!rule?.where || rule.where(x)));
  if (!item) return { skip: `no ${field} found in ${src.path}` };
  return fill(s, tpl, depth + 1, { ...values, [param]: encodeURIComponent(String(item[field])) });
};

// ------------------------------------------------------------------------------------------------ measuring
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)]; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const serverTiming = (h) => {
  const v = h.get("server-timing") || "";
  const db = Number(v.match(/db;dur=([\d.]+)/)?.[1]);
  const total = Number(v.match(/total;dur=([\d.]+)/)?.[1]);
  const m = v.match(/desc="(\d+) queries, (\d+) round trips"/);
  return { db: Number.isFinite(db) ? db : null, server: Number.isFinite(total) ? total : null, queries: m ? Number(m[1]) : null, trips: m ? Number(m[2]) : null };
};

const measure = async (s, p) => {
  const times = []; const statuses = {}; const st = []; let bytes = 0; let error = null;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    try {
      const res = await s.get(p);
      const body = await res.arrayBuffer();
      times.push(performance.now() - t0);
      statuses[res.status] = (statuses[res.status] || 0) + 1;
      bytes = body.byteLength;
      st.push(serverTiming(res.headers));
    } catch (e) {
      times.push(performance.now() - t0);
      statuses.error = (statuses.error || 0) + 1;
      error = e.name === "TimeoutError" ? `timed out after ${TIMEOUT} ms` : e.cause?.code || e.message;
    }
  }
  const num = (k) => st.map((x) => x[k]).filter((x) => x !== null);
  return {
    first: times[0], min: Math.min(...times), median: pct(times, 50), p95: pct(times, 95), max: Math.max(...times), mean: avg(times),
    server: avg(num("server")), db: avg(num("db")), queries: avg(num("queries")), trips: avg(num("trips")),
    statuses, ok: Object.keys(statuses).every((k) => Number(k) >= 200 && Number(k) < 400), bytes, error,
  };
};

// ------------------------------------------------------------------------------------------------ main
(async () => {
  const health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(10000) }).catch((e) => ({ ok: false, statusText: e.cause?.code || e.message }));
  if (!health.ok) { console.error(`The API at ${BASE} isn't answering (${health.statusText || health.status}). Start it with npm run dev, or pass --url=...`); process.exit(1); }

  const sessions = { visitor: new Session("visitor", null) };
  for (const role of ["buyer", "seller", "admin"]) {
    if (!USERS[role]) continue;
    const s = new Session(role, USERS[role]);
    try { await s.login(); sessions[role] = s; } catch (e) { console.log(`  ${e.message}; skipping ${role} endpoints`); }
  }
  if (sessions.seller) {
    const m = await sessions.seller.json("/api/company/memberships");
    const companyId = m?.data?.[0]?.companyId;
    if (companyId) sessions.seller.headers["x-company-id"] = String(companyId);
    else { console.log("  The seller log-in isn't a member of any company; skipping company endpoints"); delete sessions.seller; }
  }
  if (!USERS.admin) console.log("  Admin endpoints skipped: set LOADTEST_ADMIN_EMAIL and LOADTEST_ADMIN_PASSWORD in .env to include them.");

  let endpoints = discover().filter((e) => !NEVER.some((re) => re.test(e.path)));
  if (ONLY.length) endpoints = endpoints.filter((e) => ONLY.some((x) => e.path.includes(x)));
  if (SKIP.length) endpoints = endpoints.filter((e) => !SKIP.some((x) => e.path.includes(x)));
  const jobs = endpoints.flatMap((e) => roleFor(e.path).filter((r) => sessions[r]).map((r) => ({ ...e, role: r })));
  console.log(`\n${jobs.length} endpoint calls to measure (${endpoints.length} GET endpoints), ${RUNS} times each, one at a time, against ${BASE}\n`);

  const results = [];
  const skipped = [];
  const started = Date.now();
  for (const [n, job] of jobs.entries()) {
    const s = sessions[job.role];
    const f = await fill(s, job.path);
    if (f.skip) { skipped.push({ ...job, reason: f.skip }); continue; }
    const r = await measure(s, f.path);
    results.push({ endpoint: job.path, called: f.path, role: job.role, ...r });
    const code = Object.entries(r.statuses).map(([k, v]) => (v === RUNS ? k : `${k}×${v}`)).join(" ");
    console.log(`${String(n + 1).padStart(4)}/${jobs.length} ${job.role.padEnd(7)} ${String(Math.round(r.median)).padStart(6)} ms median ${String(Math.round(r.p95)).padStart(6)} p95  ${code.padEnd(7)} ${f.path.slice(0, 90)}${r.error ? `  (${r.error})` : ""}`);
  }

  // ---- report
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const dir = path.join(__dirname, "..", "loadtest-reports");
  fs.mkdirSync(dir, { recursive: true });
  const r1 = (x) => (x === null || x === undefined || Number.isNaN(x) ? "" : Math.round(x * 10) / 10);
  const cols = ["endpoint", "role", "called", "status", "first_ms", "min_ms", "median_ms", "p95_ms", "max_ms", "mean_ms", "server_ms", "db_ms", "queries", "round_trips", "bytes", "error"];
  const csv = [cols.join(",")].concat(results.map((r) => [r.endpoint, r.role, r.called, Object.entries(r.statuses).map(([k, v]) => `${k}x${v}`).join(" "), r1(r.first), r1(r.min), r1(r.median), r1(r.p95), r1(r.max), r1(r.mean), r1(r.server), r1(r.db), r1(r.queries), r1(r.trips), r.bytes, r.error || ""]
    .map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")));
  for (const s of skipped) csv.push([s.path, s.role, "", "skipped", "", "", "", "", "", "", "", "", "", "", "", s.reason].map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(","));
  fs.writeFileSync(path.join(dir, `get-${stamp}.csv`), csv.join("\n"));
  fs.writeFileSync(path.join(dir, `get-${stamp}.json`), JSON.stringify({ base: BASE, runs: RUNS, at: new Date().toISOString(), results, skipped }, null, 1));

  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  console.log(`\nSlowest 25 by median (${RUNS} calls each):`);
  console.log(`  ${"median".padStart(7)} ${"p95".padStart(7)} ${"first".padStart(7)} ${"db".padStart(7)} ${"queries".padStart(7)} ${"trips".padStart(5)}  role     endpoint`);
  for (const r of [...ok].sort((a, b) => b.median - a.median).slice(0, 25)) {
    console.log(`  ${String(Math.round(r.median)).padStart(7)} ${String(Math.round(r.p95)).padStart(7)} ${String(Math.round(r.first)).padStart(7)} ${String(Math.round(r.db)).padStart(7)} ${String(Math.round(r.queries)).padStart(7)} ${String(Math.round(r.trips)).padStart(5)}  ${r.role.padEnd(8)} ${r.endpoint}`);
  }
  if (bad.length) {
    console.log(`\nNot OK (${bad.length}):`);
    for (const r of bad) console.log(`  ${Object.entries(r.statuses).map(([k, v]) => `${k}×${v}`).join(" ").padEnd(10)} ${r.role.padEnd(8)} ${r.called}${r.error ? `  (${r.error})` : ""}`);
  }
  if (skipped.length) {
    console.log(`\nSkipped (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s.role.padEnd(8)} ${s.path}  (${s.reason})`);
  }
  const all = ok.map((r) => r.median);
  console.log(`\n${results.length} measured, ${ok.length} OK, ${bad.length} not OK, ${skipped.length} skipped in ${Math.round((Date.now() - started) / 1000)} s.`);
  if (all.length) console.log(`Median of medians ${Math.round(pct(all, 50))} ms; ${all.filter((x) => x > 1000).length} endpoints over 1 s, ${all.filter((x) => x > 3000).length} over 3 s.`);
  console.log(`Report: loadtest-reports/get-${stamp}.csv (and .json)`);
})().catch((e) => { console.error(`\nFailed: ${e.message}`); process.exit(1); });
