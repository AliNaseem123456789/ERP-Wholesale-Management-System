// DEVELOPER TOOL: draws the demo pictures (product pack shots, category tiles, company logos and banners)
// from scripts/demo/data/images.json into scripts/demo/images/. Needs Playwright with Chromium.
//   node scripts/demo/render-images.js
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const OUT = process.env.IMG_OUT || path.join(__dirname, "images");
const list = JSON.parse(fs.readFileSync(process.env.IMG_LIST || path.join(__dirname, "data", "images.json"), "utf8"));
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const PALETTE = ["#0f766e", "#1d4ed8", "#b91c1c", "#7c3aed", "#c2410c", "#0e7490", "#15803d", "#a16207", "#be185d", "#334155", "#4338ca", "#047857", "#9a3412", "#6d28d9"];
const brandColor = (b) => PALETTE[hash(b) % PALETTE.length];
const tint = (hex, a) => { const n = parseInt(hex.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255; const m = (c) => Math.round(c + (255 - c) * a); return `rgb(${m(r)},${m(g)},${m(b)})`; };

// which package shape each sub-category gets
const SHAPE = {
  "chips-snacks": "bag", "candy-chocolate": "bar", "gum-mints": "box", "energy-drinks": "can", "soft-drinks-juice": "can", "coffee-tea": "pouch", "bottled-water": "bottle",
  "skin-care": "tube", "hair-care": "bottle", cosmetics: "tube", "bath-body-care": "bottle", "oral-care": "tube", shaving: "box",
  "cleaning-supplies": "spray", "paper-goods": "roll", laundry: "jug", "trash-bags": "box", "air-fresheners": "jar",
  "chargers-cables": "card", "power-banks": "card", "earbuds-headphones": "card", "phone-cases": "card", "speakers-gadgets": "box",
  "pain-relief": "pills", "vitamins-supplements": "pills", "first-aid": "box", "cold-allergy": "box",
  "car-air-fresheners": "card", "car-care": "spray", "motor-oil-fluids": "jug", "car-accessories": "box",
  "hats-caps": "tag", sunglasses: "tag", socks: "tag", "bags-wallets": "tag", "t-shirts-basics": "tag",
  "writing-supplies": "card", "paper-notebooks": "box", "tape-desk": "box",
  "dog-food-treats": "bag", "cat-supplies": "bag", "pet-accessories": "card",
  "toys-games": "box", "party-supplies": "bag", seasonal: "box",
  "disposables-pods": "box", "e-liquids": "bottle", "coils-tanks": "box", "papers-wraps": "box", lighters: "card",
  women: "perfume", men: "perfume", unisex: "perfume",
};
const CHILDREN = Object.fromEntries(require("./catalogue").CATEGORIES.map((t) => [t.slug, t.children.map((c) => c[0])]));

// a package silhouette with a label area; w x h around (300, 300)
const pack = (shape, c, label) => {
  const L = label;
  const shadow = `<ellipse cx="300" cy="520" rx="150" ry="18" fill="rgba(0,0,0,.12)"/>`;
  const shapes = {
    bag: `<path d="M170 130 Q300 105 430 130 L445 500 Q300 520 155 500 Z" fill="${c}"/><path d="M170 130 Q300 105 430 130 L432 160 Q300 135 168 160 Z" fill="rgba(255,255,255,.25)"/>${L(190, 230, 220, 190)}`,
    bar: `<rect x="120" y="230" width="360" height="170" rx="14" fill="${c}"/><rect x="120" y="230" width="360" height="22" rx="10" fill="rgba(255,255,255,.25)"/>${L(140, 262, 320, 125)}`,
    box: `<path d="M170 150 L430 150 L430 500 L170 500 Z" fill="${c}"/><path d="M170 150 L210 115 L470 115 L430 150 Z" fill="${tint(c, 0.3)}"/><path d="M430 150 L470 115 L470 465 L430 500 Z" fill="rgba(0,0,0,.18)"/>${L(185, 220, 230, 200)}`,
    can: `<rect x="200" y="120" width="200" height="390" rx="26" fill="${c}"/><rect x="200" y="120" width="200" height="26" rx="12" fill="#cbd5e1"/><rect x="200" y="484" width="200" height="26" rx="12" fill="#94a3b8"/>${L(212, 200, 176, 230)}`,
    bottle: `<path d="M265 90 h70 v50 q60 30 60 90 v270 q0 20 -20 20 h-150 q-20 0 -20 -20 v-270 q0 -60 60 -90 z" fill="${c}"/><rect x="262" y="72" width="76" height="30" rx="6" fill="#334155"/>${L(215, 260, 170, 190)}`,
    pouch: `<path d="M180 120 L420 120 L440 500 Q300 515 160 500 Z" fill="${c}"/><rect x="180" y="120" width="240" height="30" fill="rgba(0,0,0,.15)"/>${L(195, 220, 210, 200)}`,
    tube: `<path d="M240 90 L360 90 L380 470 L220 470 Z" fill="${c}"/><rect x="255" y="470" width="90" height="50" rx="8" fill="#334155"/>${L(240, 180, 120, 230)}`,
    spray: `<path d="M240 200 h120 v300 q0 15 -15 15 h-90 q-15 0 -15 -15 z" fill="${c}"/><path d="M260 140 h70 l30 25 v35 h-110 z" fill="#334155"/><rect x="330" y="150" width="60" height="16" rx="6" fill="#334155"/>${L(250, 280, 100, 190)}`,
    roll: `<rect x="150" y="160" width="300" height="330" rx="40" fill="${c}"/><ellipse cx="300" cy="160" rx="150" ry="36" fill="${tint(c, 0.5)}"/><ellipse cx="300" cy="160" rx="40" ry="10" fill="rgba(0,0,0,.25)"/>${L(175, 230, 250, 200)}`,
    jug: `<path d="M190 170 q0 -40 40 -40 h70 v-30 h60 v30 h20 q40 0 40 40 v320 q0 20 -20 20 h-190 q-20 0 -20 -20 z" fill="${c}"/><path d="M400 180 q60 0 60 60 v60 q0 40 -50 40" stroke="${c}" stroke-width="22" fill="none"/>${L(205, 240, 190, 200)}`,
    jar: `<rect x="185" y="200" width="230" height="300" rx="30" fill="${c}"/><rect x="200" y="160" width="200" height="50" rx="10" fill="#334155"/>${L(200, 260, 200, 180)}`,
    card: `<rect x="160" y="100" width="280" height="410" rx="22" fill="${c}"/><circle cx="300" cy="130" r="14" fill="#f8fafc"/><rect x="190" y="180" width="220" height="150" rx="16" fill="rgba(255,255,255,.18)"/>${L(180, 345, 240, 145)}`,
    pills: `<rect x="210" y="190" width="180" height="310" rx="24" fill="#f8fafc" stroke="${c}" stroke-width="6"/><rect x="200" y="140" width="200" height="60" rx="12" fill="${c}"/>${L(222, 250, 156, 200, true)}`,
    tag: `<path d="M180 120 h240 v390 h-240 z" fill="${c}"/><circle cx="300" cy="150" r="12" fill="#f8fafc"/>${L(195, 200, 210, 230)}`,
    perfume: `<rect x="190" y="210" width="220" height="290" rx="34" fill="${c}" opacity=".9"/><rect x="265" y="150" width="70" height="60" rx="8" fill="#d4af37"/><rect x="250" y="110" width="100" height="45" rx="10" fill="#1f2937"/>${L(210, 270, 180, 170)}`,
  };
  return shadow + (shapes[shape] || shapes.box);
};

const productSvg = (img) => {
  const c = brandColor(img.brand);
  const words = String(img.title).split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) { if ((cur + " " + w).trim().length > 16) { lines.push(cur.trim()); cur = w; } else cur += " " + w; }
  if (cur.trim()) lines.push(cur.trim());
  const label = (x, y, w, h, dark = false) => {
    const tc = dark ? "#0f172a" : "#ffffff";
    const brand = esc(img.brand.toUpperCase());
    const fs = Math.max(14, Math.min(30, Math.floor(w / Math.max(6, brand.length) * 1.6)));
    let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${dark ? "rgba(255,255,255,.0)" : "rgba(255,255,255,.12)"}"/>`;
    out += `<text x="${x + w / 2}" y="${y + fs + 10}" font-family="Inter" font-weight="900" font-size="${fs}" fill="${tc}" text-anchor="middle" letter-spacing="1">${brand}</text>`;
    const ls = lines.slice(0, 3);
    const lfs = Math.max(11, Math.min(18, Math.floor((w / 16) * 1.25)));
    ls.forEach((l, i) => { out += `<text x="${x + w / 2}" y="${y + fs + 22 + (i + 1) * (lfs + 4)}" font-family="Inter" font-weight="600" font-size="${lfs}" fill="${tc}" opacity=".95" text-anchor="middle">${esc(l)}</text>`; });
    out += `<text x="${x + w / 2}" y="${y + h - 12}" font-family="Inter" font-weight="700" font-size="${Math.max(11, lfs - 2)}" fill="${tc}" opacity=".85" text-anchor="middle">${esc(img.size || "")}</text>`;
    return out;
  };
  const bg1 = tint(img.color || "#64748b", 0.86), bg2 = tint(img.color || "#64748b", 0.7);
  const caseBadge = img.pack > 1 ? `<g><rect x="430" y="40" width="130" height="44" rx="22" fill="#0f172a"/><text x="495" y="69" font-family="Inter" font-weight="800" font-size="18" fill="#fff" text-anchor="middle">${img.pack} / ${esc((img.unit || "case").split(" ")[0])}</text></g>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
    <defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></radialGradient></defs>
    <rect width="600" height="600" fill="url(#g)"/>${pack(img.shape, c, label)}${caseBadge}</svg>`;
};

const categorySvg = (img) => {
  const c = img.color || "#334155";
  const place = (shape, cx, cy, sc, fill) => `<g transform="translate(${cx - 300 * sc} ${cy - 300 * sc}) scale(${sc})">${pack(shape, fill, () => "")}</g>`;
  const set = (img.shapes || ["box", "bottle", "can"]);
  const shapes = place(set[0], 560, 230, 0.55, tint(c, 0.55)) + place(set[1], 680, 260, 0.5, "#ffffff") + place(set[2], 470, 290, 0.42, tint(c, 0.2));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${tint(c, 0.35)}"/></linearGradient></defs>
    <rect width="800" height="600" fill="url(#g)"/><circle cx="660" cy="120" r="240" fill="rgba(255,255,255,.08)"/><circle cx="120" cy="560" r="200" fill="rgba(0,0,0,.08)"/>
    ${shapes}
    <text x="56" y="470" font-family="Inter" font-weight="900" font-size="${img.title.length > 18 ? 48 : 60}" fill="#fff">${esc(img.title)}</text>
    <text x="58" y="520" font-family="Inter" font-weight="600" font-size="24" fill="rgba(255,255,255,.85)">Wholesale · by the case</text></svg>`;
};

const initials = (name) => name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const logoSvg = (img) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
  <rect width="320" height="320" rx="64" fill="${img.color}"/><circle cx="250" cy="70" r="90" fill="rgba(255,255,255,.12)"/>
  <text x="160" y="196" font-family="Inter" font-weight="900" font-size="128" fill="#fff" text-anchor="middle" letter-spacing="-4">${esc(initials(img.title))}</text></svg>`;
const bannerSvg = (img) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="500" viewBox="0 0 1600 500">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${img.color}"/><stop offset="1" stop-color="${tint(img.color, 0.45)}"/></linearGradient></defs>
  <rect width="1600" height="500" fill="url(#g)"/>
  ${["box", "can", "bottle", "bag", "jar"].map((s, i) => `<g transform="translate(${1040 + i * 105 - 150} ${250 - 150 + (i % 2) * 40}) scale(.5)" opacity="${0.75 + (i % 2) * 0.25}">${pack(s, i % 2 ? "#ffffff" : tint(img.color, 0.5), () => "")}</g>`).join("")}
  <text x="90" y="230" font-family="Inter" font-weight="900" font-size="76" fill="#fff">${esc(img.title)}</text>
  <text x="94" y="300" font-family="Inter" font-weight="600" font-size="34" fill="rgba(255,255,255,.88)">${esc(img.tagline || "")}</text></svg>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  let n = 0;
  for (const img of list) {
    const file = path.join(OUT, img.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (img.kind === "product") img.shape = SHAPE[img.sub] || "box";
    if (img.kind === "category") {
      const slug = path.basename(img.file, ".jpg");
      const subs = Object.keys(SHAPE).filter((k) => k === slug || (CHILDREN[slug] || []).includes(k));
      const own = [...new Set(subs.map((k) => SHAPE[k]))];
      img.shapes = [...own, "box", "bottle", "can"].slice(0, 3);
    }
    const svg = img.kind === "product" ? productSvg(img) : img.kind === "category" ? categorySvg(img) : img.kind === "logo" ? logoSvg(img) : bannerSvg(img);
    const [w, h] = img.kind === "product" ? [600, 600] : img.kind === "category" ? [800, 600] : img.kind === "logo" ? [320, 320] : [1600, 500];
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    const isPng = file.endsWith(".png");
    await page.screenshot({ path: file, type: isPng ? "png" : "jpeg", quality: isPng ? undefined : 80, omitBackground: isPng, clip: { x: 0, y: 0, width: w, height: h } });
    n++;
  }
  await browser.close();
  console.log(`${n} images in ${OUT}`);
  // one file for the repository: { "products/x.jpg": base64, ... } (what demo-data.js loads)
  const pack = {};
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else pack[path.relative(OUT, p).split(path.sep).join("/")] = fs.readFileSync(p).toString("base64"); } };
  walk(OUT);
  fs.writeFileSync(path.join(__dirname, "data", "images.pack.gz"), require("zlib").gzipSync(JSON.stringify(pack)));
  console.log(`packed into scripts/demo/data/images.pack.gz`);
})();
