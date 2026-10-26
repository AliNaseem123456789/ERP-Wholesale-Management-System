// Real photos for the demo marketplace, in place of the drawn pictures.
//
//   npm run demo:photos                 -> downloads a matching photo for every demo product, category tile and
//                                          seller banner into scripts/demo/photos/ (resumes where it stopped),
//                                          then shows what --apply would change. Changes nothing in the database.
//   npm run demo:photos -- --apply      -> uploads the photos and points the demo rows at them (one transaction)
//   npm run demo:photos -- --undo       -> points the demo rows back at the drawn pictures
//
// Where photos come from, tried in this order for each picture (Openverse and Wikimedia need no account):
//   Pixabay    if PIXABAY_API_KEY is set (free, instant key: https://pixabay.com/api/docs/)      no credit needed
//   Pexels     if PEXELS_API_KEY is set (https://www.pexels.com/api/)                            no credit needed
//   Openverse  no key; only public-domain photos (CC0 / public domain mark)                     no credit needed
//   Wikimedia Commons  no key; only public-domain photos                                         no credit needed
// Where each photo came from is saved in scripts/demo/photos/credits.json.
// If a service says "slow down", the script waits or moves on to the next one; if all of them are out for now,
// it stops and simply continues where it left off when run again.
//
// Only demo rows (ids from 5,000,000 up) are changed, and only their picture links. Seller logos stay drawn.
// To use a different search for a picture, put it in scripts/demo/photos/queries.json
// ({ "products/xyz.jpg": "your search words" }), delete that photo file, and run again.
const fs = require("fs");
const path = require("path");
const { connect } = require("./_pg");

const MODE = process.argv.includes("--apply") ? "apply" : process.argv.includes("--undo") ? "undo" : "download";
const BASE = 5000000;
const DIR = path.join(__dirname, "demo", "photos");
const LIST = require("./demo/data/images.json");
const UA = "WholesaleDemoPhotos/1.0 (demo catalogue pictures; one request per second)";
// overridable for testing
const URLS = {
  pixabay: process.env.PIXABAY_API_BASE || "https://pixabay.com/api/",
  pexels: process.env.PEXELS_API_BASE || "https://api.pexels.com/v1",
  openverse: process.env.OPENVERSE_API_BASE || "https://api.openverse.org/v1",
  wikimedia: process.env.WIKIMEDIA_API_BASE || "https://commons.wikimedia.org/w/api.php",
};

// what to search for a seller's storefront banner
const BANNERS = {
  meridian: "warehouse shelves", harbor: "beauty products", voltedge: "electronics store",
  roadready: "auto parts", urbanthread: "clothing store", paperline: "office supplies",
  pawpantry: "pet shop", funfactory: "toy store", summit: "candy store", cloudnine: "tobacco shop",
  maisonlumen: "perfume bottles",
};

/** Search words for one picture: the product name without sizes and counts, or the category / seller theme. */
const queryFor = (img, overrides) => {
  if (overrides[img.file]) return overrides[img.file];
  if (img.kind === "banner") return BANNERS[path.basename(img.file).replace(/-banner\.\w+$/, "")] || "wholesale store";
  const words = String(img.title)
    .replace(/\(.*?\)/g, " ")
    .replace(/\b\d+([.,]\d+)?\s*(-?\s*(oz|fl oz|ml|l|lb|lbs|g|kg|ct|count|pk|pack|pc|pcs|ft|in|inch|mah|w|v|mg|x|gal))\b/gi, " ")
    .replace(/\b\d+(-ct|-pack|-pk)\b/gi, " ")
    .replace(/[&+/|,%Ω]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words || img.title;
};

/** Searches to try, most specific first: the full name, its last two words ("Potato Chips"), the sub-category. */
const queriesFor = (img, overrides) => {
  const first = queryFor(img, overrides);
  const out = [first];
  const words = first.split(" ");
  if (img.kind === "product" && words.length > 2) out.push(words.slice(-2).join(" "));
  if (img.kind === "product" && img.sub) out.push(img.sub.replace(/-/g, " "));
  return [...new Set(out)];
};

const sizeFor = (img) => (img.kind === "banner" ? { w: 1600, h: 500, landscape: true } : { w: 800, h: 800, landscape: false });

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class SlowDown extends Error {}

/** GET as JSON; a 429 (or 403 from a rate limit) becomes SlowDown with how long to wait. */
const getJson = async (url, headers = {}) => {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...headers } });
  if (res.status === 429) throw Object.assign(new SlowDown("rate limited"), { wait: Number(res.headers.get("retry-after")) * 1000 || 0 });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
};

// Each source: search(query, size) -> [{ id, image (address to download), credit }]
const SOURCES = [
  {
    name: "Pixabay", enabled: () => !!process.env.PIXABAY_API_KEY,
    search: async (q, z) => (await getJson(`${URLS.pixabay}?${new URLSearchParams({ key: process.env.PIXABAY_API_KEY, q: q.slice(0, 100), image_type: "photo", safesearch: "true", per_page: "20", orientation: z.landscape ? "horizontal" : "all" })}`))
      .hits?.map((h) => ({ id: `pixabay:${h.id}`, image: z.landscape ? h.largeImageURL : h.webformatURL, credit: { by: h.user, page: h.pageURL, license: "Pixabay Content License" } })) || [],
  },
  {
    name: "Pexels", enabled: () => !!process.env.PEXELS_API_KEY,
    search: async (q, z) => (await getJson(`${URLS.pexels}/search?${new URLSearchParams({ query: q, per_page: "15", orientation: z.landscape ? "landscape" : "square" })}`, { Authorization: process.env.PEXELS_API_KEY }))
      .photos?.map((p) => ({ id: `pexels:${p.id}`, image: `${p.src.original}?auto=compress&cs=tinysrgb&fit=crop&w=${z.w}&h=${z.h}`, credit: { by: p.photographer, page: p.url, license: "Pexels License" } })) || [],
  },
  {
    name: "Openverse", enabled: () => true,
    search: async (q) => (await getJson(`${URLS.openverse}/images/?${new URLSearchParams({ q, license: "cc0,pdm", category: "photograph", page_size: "20", mature: "false" })}`))
      .results?.map((r) => ({ id: `openverse:${r.id}`, image: `${URLS.openverse}/images/${r.id}/thumb/`, fallback: r.url, credit: { by: r.creator || null, page: r.foreign_landing_url || null, license: String(r.license || "").toUpperCase() } })) || [],
  },
  {
    name: "Wikimedia Commons", enabled: () => true,
    search: async (q, z) => {
      const data = await getJson(`${URLS.wikimedia}?${new URLSearchParams({ action: "query", format: "json", generator: "search", gsrsearch: `${q} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "20", prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: String(z.w) })}`);
      const free = (m) => /^(cc0|public domain|pd\b|pdm)/i.test(m?.LicenseShortName?.value || "") || /publicdomain/i.test(m?.LicenseUrl?.value || "");
      return Object.values(data.query?.pages || {})
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .map((p) => ({ p, ii: p.imageinfo?.[0] }))
        .filter(({ ii }) => ii?.thumburl && free(ii.extmetadata))
        .map(({ p, ii }) => ({ id: `wikimedia:${p.pageid}`, image: ii.thumburl, credit: { by: String(ii.extmetadata?.Artist?.value || "").replace(/<[^>]+>/g, "").trim() || null, page: ii.descriptionurl || null, license: ii.extmetadata?.LicenseShortName?.value || "Public domain" } }));
    },
  },
];

/** Downloads an image; null unless it really is an image of a sensible size. */
const fetchImage = async (url) => {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok || !/^image\/(jpeg|png|webp)/.test(res.headers.get("content-type") || "")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 4000 && bytes.length < 8e6 ? bytes : null;
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------------------------------------ download
const download = async () => {
  const wanted = LIST.filter((i) => i.kind !== "logo");
  fs.mkdirSync(DIR, { recursive: true });
  const overrides = readJson(path.join(DIR, "queries.json"), {});
  const creditsFile = path.join(DIR, "credits.json");
  const credits = readJson(creditsFile, {});
  const used = new Set(Object.values(credits).map((c) => c.id));
  const todo = wanted.filter((i) => !fs.existsSync(path.join(DIR, i.file)));
  console.log(`${wanted.length - todo.length} of ${wanted.length} photos already downloaded.`);
  if (!todo.length) return true;
  const sources = SOURCES.filter((x) => x.enabled());
  console.log(`Searching ${sources.map((x) => x.name).join(", then ")}.`);
  const resting = new Map(); // source -> time it may be asked again
  const count = {};
  const missing = [];
  let done = 0;
  for (const img of todo) {
    const z = sizeFor(img);
    let got = null;
    search: for (const q of queriesFor(img, overrides)) {
      for (const src of sources) {
        if ((resting.get(src) || 0) > Date.now()) continue;
        let hits;
        try {
          hits = await src.search(q, z);
        } catch (e) {
          if (e instanceof SlowDown) {
            // a short wait is fine; a long one means: use the other sources for now
            if (e.wait && e.wait <= 90000) { await sleep(e.wait); try { hits = await src.search(q, z); } catch { hits = null; } }
            if (!hits) { resting.set(src, Date.now() + Math.max(e.wait, 15 * 60000)); console.log(`  ${src.name} asked to slow down; using the others for now`); continue; }
          } else { console.log(`  ${src.name}: ${e.message}`); continue; }
        }
        await sleep(src.name === "Wikimedia Commons" || src.name === "Openverse" ? 1000 : 200);
        for (const h of hits.filter((x) => !used.has(x.id)).slice(0, 4)) {
          const bytes = (await fetchImage(h.image)) || (h.fallback && (await fetchImage(h.fallback)));
          if (bytes) { got = { ...h, bytes, query: q, source: src.name }; break search; }
        }
      }
    }
    if (!got) {
      if (sources.every((x) => (resting.get(x) || 0) > Date.now())) {
        console.log(`\nEvery photo service asked to slow down after ${done} photos. Run this again in 15 to 60 minutes; it continues from here.`);
        process.exitCode = 1;
        break;
      }
      missing.push(`${img.file} ("${queryFor(img, overrides)}")`);
      continue;
    }
    const dest = path.join(DIR, ...img.file.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, got.bytes);
    used.add(got.id);
    count[got.source] = (count[got.source] || 0) + 1;
    credits[img.file] = { id: got.id, source: got.source, query: got.query, ...got.credit };
    fs.writeFileSync(creditsFile, JSON.stringify(credits, null, 1));
    if (++done % 25 === 0) console.log(`  ${done}/${todo.length}`);
  }
  console.log(`Downloaded ${done} photos into scripts/demo/photos${done ? ` (${Object.entries(count).map(([k, v]) => `${v} from ${k}`).join(", ")})` : ""}.`);
  if (missing.length) {
    console.log(`\nNo photo found for ${missing.length}; they keep their drawn picture. Better search words can go in scripts/demo/photos/queries.json, e.g. { "products/x.jpg": "chocolate bar" }:`);
    for (const m of missing.slice(0, 20)) console.log(`  ${m}`);
  }
  return true;
};

// ------------------------------------------------------------------------------------------------ apply / undo
/** Uploads the downloaded photos; returns the address prefix they are served from. */
const upload = async (files) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const { createClient } = require("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const queue = [...files];
    const worker = async () => {
      while (queue.length) {
        const rel = queue.shift();
        const { error } = await sb.storage.from("site-assets").upload(`demo-photos/${rel}`, fs.readFileSync(path.join(DIR, rel)), { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
        if (error) throw new Error(`Uploading ${rel}: ${error.message}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return sb.storage.from("site-assets").getPublicUrl("demo-photos").data.publicUrl.replace(/\/$/, "");
  }
  const target = path.join(__dirname, "..", "..", "Frontend", "public", "demo-photos");
  for (const rel of files) {
    const dest = path.join(target, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(DIR, rel), dest);
  }
  return `${(process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "")}/demo-photos`;
};

// the demo picture links: [table, column, which rows]
const LINKS = [
  ["product_images", "url", `id >= ${BASE} AND product_id >= ${BASE}`],
  ["categories", "image_url", `id >= ${BASE}`],
  ["companies", "banner_url", `id >= ${BASE}`],
];

/** Repoints demo rows: from ".../demo/<file>" to "<prefix>/<file>" (apply) or back (undo). One statement per table. */
const repoint = async (db, toPhotos, prefix, files) => {
  let n = 0;
  await db.query("BEGIN");
  try {
    for (const [t, col, where] of LINKS) {
      const r = toPhotos
        ? await db.query(`UPDATE ${t} SET ${col} = $1 || '/' || substring(${col} from '/demo/([^?]+)')
            WHERE ${where} AND substring(${col} from '/demo/([^?]+)') = ANY($2::text[])`, [prefix, [...files]])
        // the drawn pictures still sit in demo/, next to where the photos were uploaded
        : await db.query(`UPDATE ${t} SET ${col} = regexp_replace(${col}, '/demo-photos/', '/demo/') WHERE ${where} AND ${col} LIKE '%/demo-photos/%'`);
      n += r.rowCount;
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  }
  return n;
};

(async () => {
  if (MODE === "download") {
    await download();
    const have = LIST.filter((i) => i.kind !== "logo" && fs.existsSync(path.join(DIR, i.file))).length;
    if (have) console.log(`\n${have} photos ready. Run: npm run demo:photos -- --apply   (changes only the demo's picture links)`);
    return;
  }
  const db = await connect();
  try {
    if (!(await db.query(`SELECT 1 FROM users WHERE id >= ${BASE} LIMIT 1`)).rows.length) {
      console.log("The demo isn't loaded. Run npm run demo:data -- --apply first.");
      process.exitCode = 1;
      return;
    }
    if (MODE === "undo") {
      const n = await repoint(db, false);
      console.log(`Pointed ${n} demo pictures back at the drawn ones.`);
      return;
    }
    const files = new Set(LIST.filter((i) => i.kind !== "logo" && fs.existsSync(path.join(DIR, i.file))).map((i) => i.file));
    if (!files.size) { console.log("No photos downloaded yet. Run npm run demo:photos first."); process.exitCode = 1; return; }
    console.log(`Uploading ${files.size} photos...`);
    const prefix = await upload([...files]);
    const n = await repoint(db, true, prefix, files);
    console.log(`Done: ${n} demo pictures now use real photos. Restart the backend (or wait a minute) to see them everywhere.`);
    console.log("To go back to the drawn pictures: npm run demo:photos -- --undo");
  } finally {
    await db.end();
  }
})().catch((e) => { console.error(`\nFailed: ${e.message}`); process.exit(1); });
