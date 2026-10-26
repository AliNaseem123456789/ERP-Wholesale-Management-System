// Real photos for the demo marketplace, in place of the drawn pictures.
//
//   npm run demo:photos                 -> downloads a matching photo for every demo product, category tile and
//                                          seller banner into scripts/demo/photos/ (resumes where it stopped),
//                                          then shows what --apply would change. Changes nothing in the database.
//   npm run demo:photos -- --apply      -> uploads the photos and points the demo rows at them (one transaction)
//   npm run demo:photos -- --undo       -> points the demo rows back at the drawn pictures
//
// Photos come from Pexels (free to use, no attribution required: https://www.pexels.com/license/).
// Get a free API key at https://www.pexels.com/api/ and add it to Backend/.env as PEXELS_API_KEY=...
// Pexels allows 200 searches an hour; there are about 330 pictures, so the download may need a second run an
// hour later. It picks up where it stopped.
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
const API = process.env.PEXELS_API_BASE || "https://api.pexels.com/v1"; // overridable for testing
const KEY = process.env.PEXELS_API_KEY;

// what to search for a seller's storefront banner
const BANNERS = {
  meridian: "wholesale warehouse shelves", harbor: "beauty products shelf", voltedge: "electronics accessories store",
  roadready: "auto parts store", urbanthread: "clothing rack store", paperline: "office supplies desk",
  pawpantry: "pet store shelves", funfactory: "toy store", summit: "candy store", cloudnine: "smoke shop",
  maisonlumen: "perfume bottles",
};

/** Search words for one picture: the product name without sizes and counts, or the category / seller theme. */
const queryFor = (img, overrides) => {
  if (overrides[img.file]) return overrides[img.file];
  if (img.kind === "banner") return BANNERS[path.basename(img.file).replace(/-banner\.\w+$/, "")] || "wholesale store";
  const words = String(img.title)
    .replace(/\(.*?\)/g, " ")
    .replace(/\b\d+([.,]\d+)?\s*(-?\s*(oz|fl oz|ml|l|lb|lbs|g|kg|ct|count|pk|pack|pc|pcs|ft|in|inch|mah|w|v|mg|x))\b/gi, " ")
    .replace(/\b\d+(-ct|-pack|-pk)\b/gi, " ")
    .replace(/[&+/|,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words || img.title;
};

const sizeFor = (img) => (img.kind === "banner" ? { w: 1600, h: 500, orientation: "landscape" } : { w: 800, h: 800, orientation: "square" });

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };

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
  if (!KEY) {
    console.log("\nSet PEXELS_API_KEY in Backend/.env first (free key: https://www.pexels.com/api/).");
    process.exitCode = 1;
    return false;
  }
  let done = 0;
  let missing = [];
  for (const img of todo) {
    const q = queryFor(img, overrides);
    const { w, h, orientation } = sizeFor(img);
    const res = await fetch(`${API}/search?${new URLSearchParams({ query: q, per_page: "15", orientation })}`, { headers: { Authorization: KEY } });
    if (res.status === 429 || res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
      console.log(`\nPexels' hourly limit reached after ${done} photos.${reset ? ` It resets at ${new Date(reset).toLocaleTimeString()}.` : ""} Run this again then; it continues from here.`);
      process.exitCode = 1;
      return false;
    }
    if (res.status === 401 || res.status === 403) throw new Error("Pexels refused the API key. Check PEXELS_API_KEY in Backend/.env.");
    if (!res.ok) throw new Error(`Pexels search failed (${res.status}) for "${q}"`);
    const photos = (await res.json()).photos || [];
    const photo = photos.find((p) => !used.has(p.id)) || photos[0];
    if (!photo) { missing.push(`${img.file} ("${q}")`); continue; }
    const src = `${photo.src.original}?auto=compress&cs=tinysrgb&fit=crop&w=${w}&h=${h}`;
    const bytes = Buffer.from(await (await fetch(src)).arrayBuffer());
    const dest = path.join(DIR, ...img.file.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    used.add(photo.id);
    credits[img.file] = { id: photo.id, query: q, photographer: photo.photographer, page: photo.url };
    fs.writeFileSync(creditsFile, JSON.stringify(credits, null, 1));
    if (++done % 25 === 0) console.log(`  ${done}/${todo.length}`);
  }
  console.log(`Downloaded ${done} photos into scripts/demo/photos.`);
  if (missing.length) {
    console.log(`\nNo photo found for ${missing.length} (they keep their drawn picture). Add better search words in scripts/demo/photos/queries.json:`);
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
