// DEVELOPER TOOL (not needed to load the demo): builds the demo marketplace by driving the real API, so every
// record is made by the same code real users go through (stock, postings, invoices, payroll...).
//
// Run it against a throw-away COPY of a database whose sequences have been moved to the demo id range
// (5,000,000+), never against a real database:
//   DATABASE_URL=postgres://.../copy node scripts/demo/generate.js
// A simulated clock walks through the last 12 months, so history is spread over time. Afterwards every
// timestamp the database wrote by itself is moved to the simulated time it belongs to.
// Then scripts/demo/export.js writes the demo rows to scripts/demo/data/.
const path = require("path");
const fs = require("fs");
const clock = require("./clock");

process.env.SMTP_HOST = "";
process.env.EMAIL_WORKER = "false";
process.env.SCHEDULER_ENABLED = "false";
process.env.AUTH_RATE_LIMIT = "100000000";
process.env.ACCESS_TOKEN_TTL = "3650d";
if (process.env.DEMO_PRELOAD) require(process.env.DEMO_PRELOAD);
// the app logs every request in development; keep the output readable
const rawLog = console.log;
console.log = (...a) => { if (typeof a[0] === "string" && /^\d{1,2}:\d{2}:\d{2}\s?[AP]?M? (GET|POST|PUT|PATCH|DELETE) /.test(a[0])) return; rawLog(...a); };

const SRC = path.join(__dirname, "..", "..", "src");
// emails are captured here instead of being queued (no demo address ever receives anything)
const outbox = require(path.join(SRC, "services/email/outbox"));
const mails = [];
outbox.queueEmail = async (m) => { mails.push(m); return null; };
const { Pool } = require("pg");

const C = require("./catalogue");
const BASE_ID = 5000000n;
const PASSWORD = process.env.DEMO_PASSWORD || "DemoPass2026!";
const DAY = 86400000;
const OUT = path.join(__dirname, "data");
const IMG = "https://demo-assets.invalid/demo";

// ---------------------------------------------------------------- helpers
let seed = 20261026;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const weighted = (obj) => { const e = Object.entries(obj); const t = e.reduce((s, [, w]) => s + w, 0); let x = rnd() * t; for (const [k, w] of e) { if ((x -= w) <= 0) return k; } return e[0][0]; };
const round2 = (n) => Math.round(n * 100) / 100;
const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const log = (...a) => rawLog(`[${ymd(clock.now())}]`, ...a);

let BASE;
class Client {
  constructor(name) { this.name = name; this.cookies = {}; this.company = null; }
  async req(method, p, body, { soft = false } = {}) {
    const headers = { "content-type": "application/json" };
    const c = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    if (c) headers.cookie = c;
    if (this.company) headers["x-company-id"] = String(this.company);
    const t0 = clock.realNow();
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const key = `${method} ${p.replace(/\?.*$/, "").replace(/\d+/g, ":id")}`;
    const pr = (stats.time[key] ||= { n: 0, ms: 0 }); pr.n++; pr.ms += clock.realNow() - t0;
    for (const sc of res.headers.getSetCookie?.() || []) { const [kv] = sc.split(";"); const i = kv.indexOf("="); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (res.status >= 400) {
      const err = new Error(`${this.name} ${method} ${p} -> ${res.status}: ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 400)}`);
      err.status = res.status; err.data = data;
      if (soft) { stats.soft++; if (process.env.DEMO_VERBOSE) console.warn("  (skipped)", err.message); return null; }
      throw err;
    }
    return data;
  }
  get(p, o) { return this.req("GET", p, undefined, o); }
  post(p, b = {}, o) { return this.req("POST", p, b, o); }
  patch(p, b = {}, o) { return this.req("PATCH", p, b, o); }
  put(p, b = {}, o) { return this.req("PUT", p, b, o); }
  del(p, o) { return this.req("DELETE", p, undefined, o); }
  as(companyId) { const c = Object.create(this); c.company = companyId; return c; }
}
const stats = { soft: 0, orders: 0, time: {} };

let db;
let pool;
const q = async (sql, params) => (await pool.query(sql, params)).rows;

// a moment inside business hours on day d (0 = first day of the demo year); minutes from 8:00 ET (12:00 UTC)
let T0;
const at = (d, minutes = int(0, 540)) => T0 + d * DAY + 12 * 3600000 + minutes * 60000;
const setDay = (d, minutes) => clock.set(at(d, minutes));
const dow = (d) => new Date(T0 + d * DAY).getUTCDay();
const isWorkday = (d) => dow(d) >= 1 && dow(d) <= 5;

// ---------------------------------------------------------------- the world
const W = {
  admin: null, attrs: {}, cats: {}, companies: {}, products: [], buyers: [], vendors: {}, staff: [],
  accounts: {}, warehouses: {}, groups: {}, promos: [], orders: [], images: [],
};

const register = async (email, first, last, business) => {
  const c = new Client(email);
  await c.post("/auth/register", { email, password: PASSWORD, firstName: first, lastName: last, businessName: business });
  await q("UPDATE users SET email_verified = true WHERE email = $1", [email]);
  const [u] = await q("SELECT id FROM users WHERE email = $1", [email]);
  c.userId = u.id;
  return c;
};
const login = async (email, password = PASSWORD) => {
  const c = new Client(email);
  await c.post("/auth/login", { email, password });
  return c;
};

// ---------------------------------------------------------------- stage 1: platform & catalogue
async function setupPlatform() {
  setDay(0, 30);
  // the platform admin of the copy (its password is set by the caller; only used here)
  W.admin = await login(process.env.DEMO_ADMIN_EMAIL, process.env.DEMO_ADMIN_PASSWORD);
  const existing = (await W.admin.get("/admin/attributes")).data;
  for (const a of existing) W.attrs[a.key] = a;
  for (const a of C.ATTRIBUTES) {
    if (W.attrs[a.key]) continue;
    const r = await W.admin.post("/admin/attributes", { ...a, scope: a.scope || "product" });
    W.attrs[a.key] = r.data;
  }
  const cats = (await W.admin.get("/admin/categories")).data;
  for (const c of cats) W.cats[c.slug] = c;
  const maxSort = Math.max(0, ...cats.filter((c) => !c.parent_id).map((c) => c.sort_order || 0));
  for (const [i, top] of C.CATEGORIES.entries()) {
    const parent = (await W.admin.post("/admin/categories", {
      name: top.name, slug: top.slug, description: top.description, sort_order: maxSort + 1 + i, image_url: `${IMG}/categories/${top.slug}.jpg`,
    })).data;
    W.cats[top.slug] = { ...parent, color: top.color, icon: top.icon };
    await W.admin.put(`/admin/categories/${parent.id}/attributes`, { attributes: top.attrs.map((k) => ({ attribute_id: W.attrs[k].id })) });
    for (const [j, [slug, name]] of top.children.entries()) {
      const child = (await W.admin.post("/admin/categories", { name, slug, parent_id: parent.id, sort_order: j, image_url: `${IMG}/categories/${slug}.jpg` })).data;
      W.cats[slug] = { ...child, color: top.color, icon: top.icon, top: top.slug };
      W.images.push({ kind: "category", file: `categories/${slug}.jpg`, title: name, color: top.color, icon: top.icon });
    }
    W.images.push({ kind: "category", file: `categories/${top.slug}.jpg`, title: top.name, color: top.color, icon: top.icon });
  }
  for (const [slug, c] of Object.entries(W.cats)) if (!c.color) {
    const fam = slug === "fragrances" || ["women", "men", "unisex"].includes(slug) ? ["#9d174d", "🌸"] : ["#0891b2", "💨"];
    c.color = fam[0]; c.icon = fam[1];
  }
  log(`attributes ${Object.keys(W.attrs).length}, categories ${Object.keys(W.cats).length}`);
}

const OWNER_EMAIL = (key) => (key === "meridian" ? "demo@meridian-trade.example.com" : `owner@${slugify(C.COMPANIES[key].name)}.example.com`);
const OWNERS = {
  meridian: ["Daniel", "Reyes"], harbor: ["Camila", "Torres"], voltedge: ["Jason", "Liu"], roadready: ["Frank", "Miller"],
  urbanthread: ["Aria", "Kapoor"], paperline: ["Helen", "Brooks"], pawpantry: ["Noah", "Bennett"], funfactory: ["Zoe", "Carter"],
  summit: ["Greg", "Novak"], cloudnine: ["Marco", "Ruiz"], maisonlumen: ["Céline", "Dubois"],
};

async function setupCompanies() {
  for (const [key, info] of Object.entries(C.COMPANIES)) {
    setDay(key === "meridian" ? 0 : int(1, 10), int(30, 400));
    const [first, last] = OWNERS[key];
    const owner = await register(OWNER_EMAIL(key), first, last, info.name);
    const reg = await owner.post("/company/register", {
      name: info.name, legal_name: info.legal_name || `${info.name} Inc.`, email: `sales@${slugify(info.name)}.example.com`, phone: info.phone,
      website: info.website || `https://${slugify(info.name)}.example.com`, address_line1: info.address_line1, city: info.city, state: info.state,
      postal_code: info.postal_code, country: "USA", tax_id: `${int(10, 99)}-${int(1000000, 9999999)}`,
    });
    const id = reg.data.id;
    clock.advance(int(2, 20) * 3600000);
    await W.admin.patch(`/admin/companies/${id}`, { status: "active", commission_rate: info.commission, is_featured: !!info.featured });
    const co = owner.as(id);
    await co.patch("/company/profile", {
      tagline: info.tagline, description: info.description, public_email: `sales@${slugify(info.name)}.example.com`, public_phone: info.phone,
      delivery_info: info.delivery_info || `Ships within ${info.lead} business days. Free freight over $${info.min_order * 4}.`,
      payment_info: info.payment_info || "Cash on delivery or net 30 for approved accounts.",
      min_order_value: info.min_order, lead_time_days: info.lead,
    });
    await q("UPDATE companies SET logo_url = $1, banner_url = $2 WHERE id = $3", [`${IMG}/companies/${key}-logo.png`, `${IMG}/companies/${key}-banner.jpg`, id]);
    W.images.push({ kind: "logo", file: `companies/${key}-logo.png`, title: info.name, color: info.color });
    W.images.push({ kind: "banner", file: `companies/${key}-banner.jpg`, title: info.name, tagline: info.tagline, color: info.color });
    await co.patch("/company/inventory/settings", { tracking: true, lowStockEmails: true });
    await co.patch("/company/sales/settings", { autoInvoice: true, allowCashOnDelivery: true, shippingFee: key === "meridian" ? 25 : 15, freeShippingOver: info.min_order * 4, returnWindowDays: 30, quoteValidityDays: 21, minMarginPercent: 12 });
    W.companies[key] = { key, id, info, owner, co, products: [], warehouses: [] };
  }
  log(`companies ${Object.keys(W.companies).length}`);
}

async function setupCatalogue() {
  let n = 0;
  for (const [sub, def] of Object.entries(C.PRODUCTS)) {
    const comp = W.companies[def.company];
    const cat = W.cats[sub];
    if (!cat) throw new Error(`unknown category ${sub}`);
    for (const [i, line] of def.items.entries()) {
      const [brand, title, size, pack, price, o = {}] = line;
      setDay(int(11, 25), int(0, 540));
      const unit = o.unit || "case";
      const fullTitle = `${brand} ${title}${size && !title.includes(size) ? ` ${size}` : ""}`;
      const key = `${def.company}-${slugify(fullTitle)}`.slice(0, 80);
      const cost = round2(price * (def.company === "meridian" ? 0.52 + rnd() * 0.1 : 0.6 + rnd() * 0.12)); // Meridian buys direct from manufacturers
      const sku = `${comp.info.name.replace(/[^A-Z]/g, "").slice(0, 3) || "SKU"}-${sub.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, "0")}`;
      const specs = [];
      const sp = (k, v) => { if (W.attrs[k] && v !== undefined && v !== null) specs.push({ attribute_id: W.attrs[k].id, value: v }); };
      const catAttrs = new Set([...(C.CATEGORIES.find((t) => t.slug === cat.top)?.attrs || [])]);
      if (catAttrs.has("net_contents")) sp("net_contents", size);
      if (catAttrs.has("case_pack") || pack > 1) sp("case_pack", pack);
      if (catAttrs.has("shelf_life_months") && o.shelf) sp("shelf_life_months", o.shelf);
      if (catAttrs.has("country_of_origin")) sp("country_of_origin", pick(["USA", "USA", "USA", "Canada", "Mexico", "China", "Vietnam"]));
      if (catAttrs.has("material")) sp("material", pick(["Cotton", "Polyester", "Cotton blend", "Nylon", "Plastic"]));
      if (catAttrs.has("warranty")) sp("warranty", o.spec?.warranty || "6 months");
      if (o.spec?.puff_count) sp("puff_count", o.spec.puff_count);
      if (o.spec?.nicotine_strength) sp("nicotine_strength", o.spec.nicotine_strength);
      if (o.ml) sp("size_ml", o.ml);
      if (o.frag) { sp("concentration", o.frag[0]); sp("fragrance_family", [o.frag[1]]); sp("target_gender", o.frag[2]); }
      const body = {
        title: fullTitle, brand, sku, price, cost_price: cost, status: "draft", category_ids: [cat.id], unit,
        pack_size: pack > 1 ? pack : null, min_order_qty: o.moq || null, order_multiple: o.mult || null,
        short_description: `${size}${pack > 1 ? ` · ${pack} per ${unit}` : ""}. ${brand} ${C.CATEGORIES.find((t) => t.slug === cat.top)?.name || ""}`.trim().slice(0, 300),
        description: `<p><strong>${fullTitle}</strong>. Sold by the ${unit}${pack > 1 ? ` of ${pack}` : ""}.</p><p>${brand} is one of our best-selling lines in ${cat.name.toLowerCase()}. Retail-ready packaging, shelf-stable and easy to merchandise.</p>`,
        reorder_point: Math.max(4, Math.round(40 / Math.max(1, price / 20))), reorder_quantity: Math.max(10, Math.round(120 / Math.max(1, price / 20))),
        barcode: `0${int(10000000000, 99999999999)}`, is_featured: !!o.feat, specifications: specs,
        compliance_category: def.compliance || "none", nicotine_ml: o.ml || null, is_flavored: def.compliance ? !!o.v : undefined,
      };
      const p = await comp.co.post("/company/products", body);
      const prod = { id: p.id, key, title: fullTitle, brand, price, cost, unit, pack, sub, company: def.company, o, variants: [], shelf: o.shelf || null, sku };
      if (o.v) {
        const [attrKey, values] = o.v;
        const attr = W.attrs[attrKey];
        const r = await comp.co.put(`/company/products/${p.id}/variants`, {
          option_attribute_ids: [String(attr.id)],
          variants: values.map((v, k) => ({ options: { [String(attr.id)]: v }, sku: `${sku}-${k + 1}`, price: k === 0 || chance(0.7) ? null : round2(price * (1 + int(-5, 8) / 100)) })),
        });
        prod.variants = r.data.map((v) => v.key);
      }
      await comp.co.post(`/company/products/${p.id}/images`, { url: `${IMG}/products/${key}.jpg`, alt_text: fullTitle });
      W.images.push({ kind: "product", sub, file: `products/${key}.jpg`, title, brand, size, color: cat.color, icon: cat.icon, accent: comp.info.color, pack, unit });
      await comp.co.patch(`/company/products/${p.id}`, { status: "published" });
      comp.products.push(prod);
      W.products.push(prod);
      n++;
    }
  }
  log(`products ${n}`);
}

// ---------------------------------------------------------------- main
(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  db = await pool.connect();
  const [{ max }] = await q("SELECT max(id) FROM users");
  if (BigInt(max || 0) < BASE_ID - 1n && (await q("SELECT last_value FROM users_id_seq"))[0].last_value < BASE_ID) {
    // sequences must already be in the demo range (see the header)
    const [{ last_value }] = await q("SELECT last_value FROM users_id_seq");
    if (BigInt(last_value) < BASE_ID) throw new Error("Move the sequences of this COPY to 5,000,000 first");
  }
  const realStart = clock.realNow();
  T0 = Math.floor((realStart - 366 * DAY) / DAY) * DAY; // midnight UTC, a year and a day ago
  clock.set(at(0, 0));

  const app = require(path.join(SRC, "app"));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  BASE = `http://127.0.0.1:${server.address().port}/api`;

  try {
    await setupPlatform();
    await setupCompanies();
    await setupCatalogue();
    const steps = (process.env.DEMO_STEPS || "all").split(",");
    if (steps.includes("all") || steps.includes("timeline")) await require("./timeline")({ lastDay: Math.min(Number(process.env.DEMO_LAST || 1e9), Math.floor((realStart - T0) / DAY) - 1), W, C, Client, register, login, q, clock, setDay, at, dow, isWorkday, rnd, int, pick, chance, shuffle, weighted, round2, slugify, ymd, log, stats, mails, IMG, DAY, PASSWORD, OWNER_EMAIL });
  } finally {
    clock.set(clock.realNow() - 3600000); // stop simulating before fixing timestamps
    server.close();
  }
  log("fixing database-written timestamps");
  await clock.fixTimestamps(db);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "images.json"), JSON.stringify(W.images, null, 1));
  fs.writeFileSync(path.join(OUT, "world.json"), JSON.stringify({
    demo: { supplier: OWNER_EMAIL("meridian"), buyer: W.demoBuyerEmail || null, password: PASSWORD },
    companies: Object.fromEntries(Object.entries(W.companies).map(([k, c]) => [k, { id: String(c.id), name: c.info.name, products: c.products.length }])),
    products: W.products.length, buyers: W.buyers.length, stats: { soft: stats.soft, orders: stats.orders }, generated_at: new Date(clock.realNow()).toISOString(), t0: new Date(T0).toISOString(),
  }, null, 1));
  for (const [k, v] of Object.entries(stats.time).sort((a, b) => b[1].ms - a[1].ms).slice(0, 15)) rawLog(`  ${k.padEnd(60)} ${v.n} calls ${(v.ms / 1000).toFixed(1)}s`);
  console.log(`done: ${stats.orders} orders, ${stats.soft} skipped actions, ${mails.length} emails suppressed`);
  db.release(); await pool.end();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
