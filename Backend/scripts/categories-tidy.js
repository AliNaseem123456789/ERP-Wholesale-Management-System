// Tidies the categories that came from the old free-text tags into a clean tree:
//
//   Smoking & Vape: Disposables & Pods, E-Liquids, Salt Nic, Devices & Kits, Coils & Tanks, Batteries & Chargers,
//                   Dry Herb & Wax Vaporizers, Glass, Papers & Wraps, Lighters, Nicotine Pouches, Accessories
//   Fragrances:     Women, Men, Unisex
//
// Each product goes into one of these. Perfume tags become product details you can filter by
// (Concentration, Fragrance family, For). The old categories are hidden, not deleted, and their addresses send
// visitors on (a brand-named category to the brand page, "Disposable/Pods" to "Disposables & Pods"...).
// Products, prices, stock, orders and accounting are not touched.
//
//   npm run categories:tidy                      -> preview only (nothing changes); writes category-tidy-preview.csv
//   npm run categories:tidy -- --apply           -> makes the change (one transaction) and keeps a backup
//   npm run categories:tidy -- --undo            -> puts back exactly what was there before the last --apply
const fs = require("fs");
const path = require("path");
const { connect } = require("./_pg");

const MODE = process.argv.includes("--apply") ? "apply" : process.argv.includes("--undo") ? "undo" : "preview";

const slugOf = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---- the new tree --------------------------------------------------------------------------------
// slug: the address it gets. Where a category with that slug already exists it is reused (renamed if needed).
const TREE = [
  { key: "smoking", name: "Smoking & Vape", slug: "smoking-vape", parent: null, sort: 1, featured: true },
  { key: "disposables", name: "Disposables & Pods", slug: "disposables-pods", parent: "smoking", sort: 1 },
  { key: "eliquids", name: "E-Liquids", slug: "e-liquids", parent: "smoking", sort: 2 },
  { key: "saltnic", name: "Salt Nic", slug: "salt-nic", parent: "smoking", sort: 3 },
  { key: "devices", name: "Devices & Kits", slug: "devices-kits", parent: "smoking", sort: 4 },
  { key: "coils", name: "Coils & Tanks", slug: "coils-tanks", parent: "smoking", sort: 5 },
  { key: "batteries", name: "Batteries & Chargers", slug: "batteries-chargers", parent: "smoking", sort: 6 },
  { key: "dryherb", name: "Dry Herb & Wax Vaporizers", slug: "dry-herb-wax-vaporizers", parent: "smoking", sort: 7 },
  { key: "glass", name: "Glass", slug: "glass", parent: "smoking", sort: 8 },
  { key: "papers", name: "Papers & Wraps", slug: "papers-wraps", parent: "smoking", sort: 9 },
  { key: "lighters", name: "Lighters", slug: "lighters", parent: "smoking", sort: 10 },
  { key: "pouches", name: "Nicotine Pouches", slug: "nicotine-pouches", parent: "smoking", sort: 11 },
  { key: "accessories", name: "Accessories", slug: "accessories", parent: "smoking", sort: 12 },
  { key: "fragrances", name: "Fragrances", slug: "fragrances", parent: null, sort: 2, featured: true },
  { key: "women", name: "Women", slug: "women", parent: "fragrances", sort: 1 },
  { key: "men", name: "Men", slug: "men", parent: "fragrances", sort: 2 },
  { key: "unisex", name: "Unisex", slug: "unisex", parent: "fragrances", sort: 3 },
];
const TOP = { smoking: true, fragrances: true };

// ---- old tags -> meaning -------------------------------------------------------------------------
// old category (normalised name) -> new category key, for categories that are real product types
const TYPE_TAGS = {
  "disposable pods": "disposables", "disposables": "disposables",
  "e liquids salt nic": "eliquids", "e juice promotion": "eliquids",
  "salt nic": "saltnic", "nkd100 salt": "saltnic", "monster vape labs salts": "saltnic", "zenith salts": "saltnic", "vgod saltnic labs": "saltnic",
  "devices pods coils tanks": "devices", "open pod system": "devices",
  "coils pods": "coils", "tanks": "coils", "one tank": "coils",
  "batteries chargers": "batteries",
  "dry herb wax vaporizers": "dryherb",
  "hy bird glass": "glass",
  "papers wraps": "papers",
  "lighters": "lighters", "zippo": "lighters", "bic": "lighters",
  "alt nicotine": "pouches", "nicotine pouches": "pouches",
  "accessories": "accessories", "protects from accidental dents scratches or scrapes": "accessories",
};
// e-liquid brands (tags that mean "this is a juice" when nothing more specific is known)
const JUICE_BRANDS = ["ferrum city", "naked100", "nkd100", "juice head", "monster vape labs", "coastal clouds", "vapetasia", "usa vape labs", "salt bae 50", "zenith ejuice", "zenith", "yogi e liquids", "moo e liquids", "zooka moo e liquids", "air factory e liquids", "air factory", "four seasons", "keep it 100", "micro brew vapors", "bar juice"];

// perfume tags
const GENDER = { women: "Women", men: "Men", unisex: "Unisex" };
const CONCENTRATION = {
  "eau de parfum": "Eau de Parfum", "eau de toilette": "Eau de Toilette", "cologne": "Eau de Cologne", "parfum": "Parfum", "perfume": "Parfum",
  "perfume oil": "Perfume Oil", "body spray": "Body Mist", "deodorant": "Deodorant", "after shave": "After Shave", "bath body": "Bath & Body", "tester": "Tester",
};
const FAMILY_WORDS = { floral: "Floral", woody: "Woody", oriental: "Oriental", fresh: "Fresh", citrus: "Citrus", gourmand: "Gourmand", aromatic: "Aromatic", chypre: "Chypre", fougere: "Fougère", aquatic: "Aquatic", fruity: "Fruity", spicy: "Spicy", green: "Green", musk: "Musk", amber: "Amber", vanilla: "Vanilla", lavender: "Lavender", mossy: "Mossy" };
const isFamilyTag = (t) => t.split(" ").every((w) => FAMILY_WORDS[w]);
const FRAGRANCE_TAGS = new Set(["fragrances", ...Object.keys(GENDER), ...Object.keys(CONCENTRATION)]);
const isFragranceTag = (t) => FRAGRANCE_TAGS.has(t) || isFamilyTag(t);

// product details created for fragrances (same keys as the "Perfumes & fragrances" template)
const ATTRS = {
  concentration: { name: "Concentration", data_type: "select", scope: "both", options: ["Parfum", "Eau de Parfum", "Eau de Toilette", "Eau de Cologne", "Body Mist", "Perfume Oil", "Deodorant", "After Shave", "Bath & Body", "Tester"] },
  fragrance_family: { name: "Fragrance family", data_type: "multiselect", scope: "product", options: Object.values(FAMILY_WORDS) },
  target_gender: { name: "For", data_type: "select", scope: "product", options: ["Men", "Women", "Unisex"] },
};

// title words, used when the tags say nothing specific
const TITLE_RULES = [
  [/\b(zippo|bic|clipper)\b/i, "lighters"],
  [/\b(pouch|pouches)\b/i, "pouches"],
  [/\b(lighter|torch|butane)\b/i, "lighters"],
  [/\b(paper|papers|wrap|wraps|cones?|blunt|rolling)\b/i, "papers"],
  [/\b(bong|pipe|rig|bubbler|glass|ash ?catcher|bowl)\b/i, "glass"],
  [/\b(charger|battery|batteries|18650)\b/i, "batteries"],
  [/\b(dry herb|wax|vaporizer|vaporiser|concentrate)\b/i, "dryherb"],
  [/\b(coil|coils|tank|tanks|cartridge|cartridges|replacement pod|pods? \d+ ?pk|\d+ ?pk pods?)\b/i, "coils"],
  [/\b(disposable|puffs?)\b|\d{3,6} ?puffs/i, "disposables"],
  [/\bsalt\b/i, "saltnic"],
  [/\b(e-?juice|e-?liquid|\d+ ?ml)\b/i, "eliquids"],
  [/\b(kit|mod|device|starter)\b/i, "devices"],
];

/** The new category, and the perfume details, for one product. */
const classify = (product, tags) => {
  const t = tags.map(norm);
  const title = product.title || "";
  const fragrance = t.some(isFragranceTag) || (!t.some((x) => TYPE_TAGS[x]) && /\b(eau de|parfum|cologne)\b/i.test(title));
  if (fragrance) {
    const g = new Set(t.filter((x) => GENDER[x]).map((x) => GENDER[x]));
    if (!g.size) {
      if (/\bunisex\b/i.test(title)) g.add("Unisex");
      if (/\b(women|woman|her|ladies)\b/i.test(title)) g.add("Women");
      if (/\b(men|man|him)\b/i.test(title)) g.add("Men");
    }
    const gender = g.has("Unisex") || g.size > 1 ? "Unisex" : [...g][0] || null;
    let conc = t.map((x) => CONCENTRATION[x]).find((v) => v && v !== "Tester") || t.map((x) => CONCENTRATION[x]).find(Boolean) || null;
    if (!conc) conc = /eau de parfum|\bedp\b/i.test(title) ? "Eau de Parfum" : /eau de toilette|\bedt\b/i.test(title) ? "Eau de Toilette" : /cologne/i.test(title) ? "Eau de Cologne" : null;
    const families = [...new Set(t.filter(isFamilyTag).flatMap((x) => x.split(" ").map((w) => FAMILY_WORDS[w])))];
    return { key: gender ? gender.toLowerCase() : "fragrances", why: gender ? "fragrance tags" : "fragrance, no gender known", details: { concentration: conc, fragrance_family: families, target_gender: gender } };
  }
  // smoking: the most specific product-type tag wins
  const typeKeys = t.map((x) => TYPE_TAGS[x]).filter(Boolean);
  const pick = (k) => typeKeys.includes(k);
  let key = null;
  let why = "tags";
  if (pick("saltnic") || (pick("eliquids") && /\bsalt\b/i.test(title))) key = "saltnic";
  else if (pick("eliquids")) key = "eliquids";
  else {
    for (const k of ["pouches", "disposables", "coils", "batteries", "dryherb", "glass", "papers", "lighters"]) if (pick(k)) { key = k; break; }
    if (!key && pick("devices")) key = /\b(coil|coils|tank|cartridge|replacement)\b/i.test(title) ? "coils" : "devices";
  }
  if (!key) {
    const hit = TITLE_RULES.find(([re]) => re.test(title));
    if (hit) { key = hit[1]; why = "title"; }
  }
  if (!key && (t.some((x) => JUICE_BRANDS.includes(x)) || JUICE_BRANDS.includes(norm(product.brand)))) { key = /\bsalt\b/i.test(title) ? "saltnic" : "eliquids"; why = "juice brand tag"; }
  if (!key && pick("accessories")) key = "accessories";
  if (!key) { key = "accessories"; why = "nothing specific: please check"; }
  return { key, why, details: null };
};

// ---- load ------------------------------------------------------------------------------------------
const load = async (db) => {
  const categories = (await db.query("SELECT id, name, slug, parent_id, status, sort_order, is_featured, redirect_to, description, image_url, updated_at::text AS updated_at FROM categories ORDER BY id")).rows;
  const links = (await db.query("SELECT product_id, category_id, sort_order FROM product_categories ORDER BY product_id, sort_order")).rows;
  const products = (await db.query("SELECT id, title, brand, categories, status FROM products ORDER BY id")).rows;
  const brands = (await db.query("SELECT id, name, slug FROM brands WHERE slug IS NOT NULL")).rows;
  return { categories, links, products, brands };
};

const plan = ({ categories, links, products, brands }) => {
  const byId = new Map(categories.map((c) => [String(c.id), c]));
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  const tagsOf = new Map();
  for (const l of links) {
    const c = byId.get(String(l.category_id));
    if (!c) continue;
    if (!tagsOf.has(String(l.product_id))) tagsOf.set(String(l.product_id), []);
    tagsOf.get(String(l.product_id)).push(c.name);
  }
  const productPlan = products.map((p) => {
    const tags = tagsOf.get(String(p.id)) || (p.categories || []);
    return { id: p.id, title: p.title, status: p.status, tags, ...classify(p, tags) };
  });

  // which old categories stay (they are the same as a new one) and where the others send visitors
  const newSlugs = new Set(TREE.map((n) => n.slug));
  const treeNode = (k) => TREE.find((n) => n.key === k);
  const counts = new Map(); // old category id -> Map(newKey -> n)
  for (const l of links) {
    const pp = productPlan.find((x) => String(x.id) === String(l.product_id));
    if (!pp) continue;
    const m = counts.get(String(l.category_id)) || new Map();
    m.set(pp.key, (m.get(pp.key) || 0) + 1);
    counts.set(String(l.category_id), m);
  }
  const brandOf = (c) => brands.find((b) => b.slug === c.slug || norm(b.name) === norm(c.name));
  const hide = [];
  for (const c of categories) {
    if (newSlugs.has(c.slug)) continue; // reused as part of the new tree
    if (c.status === "hidden" && c.redirect_to) continue; // tidied before
    const n = norm(c.name);
    let to = null;
    let reason = "";
    if (TYPE_TAGS[n]) { to = `/categories/${treeNode(TYPE_TAGS[n]).slug}`; reason = `now "${treeNode(TYPE_TAGS[n]).name}"`; }
    else if (brandOf(c)) { to = `/brands/${brandOf(c).slug}`; reason = "a brand: goes to the brand page"; }
    else if (GENDER[n]) { to = `/categories/${treeNode(n).slug}`; reason = "gender"; }
    else if (CONCENTRATION[n]) { to = `/categories/fragrances?attr_concentration=${encodeURIComponent(CONCENTRATION[n])}`; reason = "now the Concentration filter"; }
    else if (isFamilyTag(n)) { to = `/categories/fragrances?attr_fragrance_family=${encodeURIComponent(FAMILY_WORDS[n.split(" ")[0]])}`; reason = "now the Fragrance family filter"; }
    else {
      const m = [...(counts.get(String(c.id)) || new Map()).entries()].sort((a, b) => b[1] - a[1]);
      const total = m.reduce((s, [, v]) => s + v, 0);
      if (total && m[0][1] / total >= 0.6) { const node = treeNode(m[0][0]); to = `/categories/${node.slug}`; reason = `most of its products are now in "${node.name}"`; }
      else if (total) {
        const tops = new Set(m.map(([k]) => (TOP[k] ? k : treeNode(k).parent)));
        to = tops.size === 1 ? `/categories/${treeNode([...tops][0]).slug}` : "/categories";
        reason = "mixed products";
      } else { to = "/categories"; reason = "no products"; }
    }
    hide.push({ id: c.id, name: c.name, slug: c.slug, products: [...(counts.get(String(c.id)) || new Map()).values()].reduce((s, v) => s + v, 0), to, reason });
  }
  const nodes = TREE.map((n) => ({ ...n, existing: bySlug.get(n.slug) || null }));
  return { productPlan, hide, nodes };
};

// ---- preview ---------------------------------------------------------------------------------------
const csvCell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const printPlan = (p) => {
  const per = new Map();
  for (const x of p.productPlan) per.set(x.key, (per.get(x.key) || 0) + 1);
  console.log("\nNew categories (products in each):");
  for (const n of p.nodes) {
    const kids = TREE.filter((k) => k.parent === n.key).map((k) => per.get(k.key) || 0).reduce((s, v) => s + v, 0);
    const own = per.get(n.key) || 0;
    console.log(`${n.parent ? "    " : "  "}${n.name.padEnd(28)} ${String(n.parent ? own : own + kids).padStart(4)}${n.existing ? `   (reuses /categories/${n.slug}${n.existing.name !== n.name ? `, renamed from "${n.existing.name}"` : ""})` : "   (new)"}`);
  }
  const check = p.productPlan.filter((x) => /please check/.test(x.why));
  const noGender = p.productPlan.filter((x) => x.key === "fragrances");
  console.log(`\n${p.hide.length} old categories will be hidden (not deleted); their addresses send visitors on.`);
  const withDetails = p.productPlan.filter((x) => x.details);
  console.log(`${withDetails.filter((x) => x.details.concentration).length} fragrances get a Concentration, ${withDetails.filter((x) => x.details.fragrance_family.length).length} a Fragrance family, ${withDetails.filter((x) => x.details.target_gender).length} a "For" (men/women/unisex).`);
  if (noGender.length) console.log(`${noGender.length} fragrance(s) have no gender in their tags or title: they go straight into Fragrances.`);
  if (check.length) console.log(`${check.length} product(s) matched nothing specific and go into Accessories (marked "please check" in the CSV).`);
};
const writeCsv = (p, file) => {
  const nameOf = (k) => TREE.find((n) => n.key === k).name;
  const rows = [["product_id", "title", "status", "old categories", "new category", "how", "concentration", "fragrance family", "for"]];
  for (const x of p.productPlan) rows.push([x.id, x.title, x.status, x.tags.join(" | "), nameOf(x.key), x.why, x.details?.concentration || "", (x.details?.fragrance_family || []).join(", "), x.details?.target_gender || ""]);
  rows.push([]);
  rows.push(["old category", "products", "becomes", "sends visitors to"]);
  for (const h of p.hide) rows.push([h.name, h.products, h.reason, h.to]);
  fs.writeFileSync(file, rows.map((r) => r.map(csvCell).join(",")).join("\n"));
  console.log(`\nFull list: ${file}`);
};

// ---- apply -----------------------------------------------------------------------------------------
const apply = async (db, p, data) => {
  const open = (await db.query("SELECT id FROM category_tidy_runs WHERE undone_at IS NULL")).rows;
  if (open.length) throw new Error(`A tidy-up is already applied (run ${open[0].id}). Undo it first with --undo if you want to run it again.`);
  const backup = {
    categories: data.categories,
    links: data.links.map((l) => [String(l.product_id), String(l.category_id), l.sort_order]),
    texts: data.products.map((x) => [String(x.id), x.categories || []]),
    settings: (await db.query("SELECT value FROM site_settings WHERE key = 'marketplace'")).rows[0]?.value ?? null,
    storefronts: (await db.query("SELECT company_id, draft, published FROM storefronts")).rows,
    created: { categories: [], attributes: [], options: [], values: [], category_attributes: [] },
  };
  const created = backup.created;
  const idOf = {};
  // 1. the tree (reuse by slug, otherwise create)
  for (const n of p.nodes) {
    const parent = n.parent ? idOf[n.parent] : null;
    if (n.existing) {
      await db.query("UPDATE categories SET name = $2, parent_id = $3, status = 'active', sort_order = $4, is_featured = $5, redirect_to = NULL, updated_at = now() WHERE id = $1",
        [n.existing.id, n.name, parent, n.sort, !!n.featured || n.existing.is_featured]);
      idOf[n.key] = n.existing.id;
    } else {
      // a hidden category of the same name under the same parent would clash with the unique name rule
      const r = await db.query("INSERT INTO categories (name, slug, parent_id, sort_order, is_featured, status) VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id", [n.name, n.slug, parent, n.sort, !!n.featured]);
      idOf[n.key] = r.rows[0].id;
      created.categories.push(String(r.rows[0].id));
    }
  }
  // 2. hide the rest, with where their address now goes
  for (const h of p.hide) {
    await db.query("UPDATE categories SET status = 'hidden', redirect_to = $2, is_featured = false, updated_at = now() WHERE id = $1", [h.id, h.to]);
  }
  // hidden categories must not sit under a new category with the same name; move any children of hidden ones up
  await db.query("UPDATE categories SET parent_id = NULL WHERE status = 'hidden' AND parent_id IS NOT NULL");
  // 3. each product in its one new category (old links are in the backup)
  await db.query("DELETE FROM product_categories");
  for (const x of p.productPlan) {
    await db.query("INSERT INTO product_categories (product_id, category_id, sort_order) VALUES ($1, $2, 0)", [x.id, idOf[x.key]]);
  }
  // keep the old text column in step (as the app does)
  await db.query(`UPDATE products SET categories = (SELECT COALESCE(array_agg(c.name ORDER BY pc.sort_order), '{}') FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = products.id)`);
  // 4. perfume details
  const attrId = {};
  const optionId = {};
  for (const [key, def] of Object.entries(ATTRS)) {
    let a = (await db.query("SELECT id, data_type FROM attribute_definitions WHERE company_id IS NULL AND key = $1", [key])).rows[0];
    if (!a) {
      a = (await db.query("INSERT INTO attribute_definitions (key, name, data_type, scope, is_filterable, is_public) VALUES ($1, $2, $3, $4, true, true) RETURNING id, data_type", [key, def.name, def.data_type, def.scope])).rows[0];
      created.attributes.push(String(a.id));
    }
    attrId[key] = a.id;
    for (const [i, v] of def.options.entries()) {
      let o = (await db.query("SELECT id FROM attribute_options WHERE attribute_id = $1 AND lower(value) = lower($2)", [a.id, v])).rows[0];
      if (!o) {
        o = (await db.query("INSERT INTO attribute_options (attribute_id, value, sort_order) VALUES ($1, $2, $3) RETURNING id", [a.id, v, i])).rows[0];
        created.options.push(String(o.id));
      }
      optionId[`${key}|${v.toLowerCase()}`] = o.id;
    }
    const link = await db.query("INSERT INTO category_attributes (category_id, attribute_id, is_required, sort_order) VALUES ($1, $2, false, $3) ON CONFLICT DO NOTHING RETURNING category_id", [idOf.fragrances, a.id, Object.keys(ATTRS).indexOf(key)]);
    if (link.rows.length) created.category_attributes.push([String(idOf.fragrances), String(a.id)]);
  }
  for (const x of p.productPlan) {
    if (!x.details) continue;
    const vals = [["concentration", x.details.concentration], ...x.details.fragrance_family.map((f) => ["fragrance_family", f]), ["target_gender", x.details.target_gender]].filter(([, v]) => v);
    for (const [key, v] of vals) {
      // a value the product already has is kept as it is
      const has = (await db.query("SELECT 1 FROM product_attribute_values WHERE product_id = $1 AND variant_id IS NULL AND attribute_id = $2 LIMIT 1", [x.id, attrId[key]])).rows.length;
      if (has && key !== "fragrance_family") continue;
      const r = await db.query("INSERT INTO product_attribute_values (product_id, attribute_id, option_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id", [x.id, attrId[key], optionId[`${key}|${v.toLowerCase()}`]]);
      if (r.rows.length) created.values.push(String(r.rows[0].id));
    }
  }
  // 5. marketplace menu, featured categories and storefront sections pointing at hidden categories
  const redirectOf = new Map(p.hide.map((h) => [String(h.id), h.to]));
  const slugToKey = new Map(TREE.map((n) => [n.slug, n.key]));
  const newIdFor = (oldId) => {
    const to = redirectOf.get(String(oldId));
    if (!to) return String(oldId);
    const m = to.match(/^\/categories\/([a-z0-9-]+)/);
    return m && slugToKey.has(m[1]) ? String(idOf[slugToKey.get(m[1])]) : null;
  };
  if (backup.settings) {
    const s = JSON.parse(JSON.stringify(backup.settings));
    const oldBySlug = new Map(data.categories.map((c) => [c.slug, c]));
    s.nav = (s.nav || []).map((n) => {
      if (n.type !== "category") return n;
      const c = oldBySlug.get(n.ref);
      const to = c && redirectOf.get(String(c.id));
      if (!to) return n;
      const cat = to.match(/^\/categories\/([a-z0-9-]+)$/);
      const brand = to.match(/^\/brands\/([a-z0-9-]+)$/);
      return cat ? { ...n, ref: cat[1] } : brand ? { ...n, type: "brand", ref: brand[1] } : { ...n, type: "link", ref: to };
    });
    if (s.featured?.category_ids) s.featured.category_ids = [...new Set(s.featured.category_ids.map(newIdFor).filter(Boolean))];
    await db.query("UPDATE site_settings SET value = $1, updated_at = now() WHERE key = 'marketplace'", [s]);
  }
  for (const st of backup.storefronts) {
    const fix = (cfg) => {
      if (!cfg?.sections) return cfg;
      const c = JSON.parse(JSON.stringify(cfg));
      for (const sec of c.sections) {
        if (Array.isArray(sec.category_ids)) sec.category_ids = [...new Set(sec.category_ids.map(newIdFor).filter(Boolean))];
        if (sec.category_id) sec.category_id = newIdFor(sec.category_id);
      }
      return c;
    };
    await db.query("UPDATE storefronts SET draft = $2, published = $3 WHERE company_id = $1", [st.company_id, fix(st.draft), fix(st.published)]);
  }
  const per = {};
  for (const x of p.productPlan) per[TREE.find((n) => n.key === x.key).name] = (per[TREE.find((n) => n.key === x.key).name] || 0) + 1;
  const summary = { products: p.productPlan.length, per_category: per, hidden_categories: p.hide.length, new_categories: created.categories.length, detail_values: created.values.length };
  const run = await db.query("INSERT INTO category_tidy_runs (summary, backup) VALUES ($1, $2) RETURNING id", [summary, backup]);
  return { run: run.rows[0].id, summary };
};

// ---- undo ------------------------------------------------------------------------------------------
const undo = async (db) => {
  const run = (await db.query("SELECT id, backup FROM category_tidy_runs WHERE undone_at IS NULL ORDER BY id DESC LIMIT 1")).rows[0];
  if (!run) throw new Error("Nothing to undo");
  const b = run.backup;
  // values and links made by the tidy-up
  if (b.created.values.length) await db.query("DELETE FROM product_attribute_values WHERE id = ANY($1::bigint[])", [b.created.values]);
  for (const [c, a] of b.created.category_attributes) await db.query("DELETE FROM category_attributes WHERE category_id = $1 AND attribute_id = $2", [c, a]);
  // products' categories exactly as they were (products added since keep theirs)
  const known = b.texts.map(([id]) => id);
  await db.query("DELETE FROM product_categories WHERE product_id = ANY($1::bigint[])", [known]);
  // categories back as they were (names, tree, status, addresses)
  for (const c of b.categories) {
    await db.query("UPDATE categories SET name = $2, slug = $3, parent_id = NULL, status = $4, sort_order = $5, is_featured = $6, redirect_to = $7, updated_at = now() WHERE id = $1",
      [c.id, `${c.name}~undo${c.id}`, c.slug, c.status, c.sort_order, c.is_featured, c.redirect_to]);
  }
  for (const c of b.categories) await db.query("UPDATE categories SET name = $2, parent_id = $3, updated_at = $4::timestamptz WHERE id = $1", [c.id, c.name, c.parent_id, c.updated_at]);
  for (const [pid, cid, sort] of b.links) await db.query("INSERT INTO product_categories (product_id, category_id, sort_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [pid, cid, sort]);
  for (const [pid, text] of b.texts) await db.query("UPDATE products SET categories = $2 WHERE id = $1", [pid, text]);
  // categories the tidy-up created: removed if nothing uses them now, otherwise hidden
  for (const id of b.created.categories) {
    const used = (await db.query("SELECT 1 FROM product_categories WHERE category_id = $1 LIMIT 1", [id])).rows.length;
    if (used) await db.query("UPDATE categories SET status = 'hidden' WHERE id = $1", [id]);
    else { await db.query("UPDATE categories SET parent_id = NULL WHERE parent_id = $1", [id]); await db.query("DELETE FROM categories WHERE id = $1", [id]); }
  }
  for (const id of b.created.options) {
    const used = (await db.query("SELECT 1 FROM product_attribute_values WHERE option_id = $1 LIMIT 1", [id])).rows.length;
    if (!used) await db.query("DELETE FROM attribute_options WHERE id = $1", [id]);
  }
  for (const id of b.created.attributes) {
    const used = (await db.query("SELECT 1 FROM product_attribute_values WHERE attribute_id = $1 LIMIT 1", [id])).rows.length;
    if (!used) await db.query("DELETE FROM attribute_definitions WHERE id = $1", [id]);
  }
  if (b.settings !== null) await db.query("UPDATE site_settings SET value = $1, updated_at = now() WHERE key = 'marketplace'", [b.settings]);
  for (const st of b.storefronts) await db.query("UPDATE storefronts SET draft = $2, published = $3 WHERE company_id = $1", [st.company_id, st.draft, st.published]);
  await db.query("UPDATE category_tidy_runs SET undone_at = now() WHERE id = $1", [run.id]);
  return run.id;
};

// ---- main ------------------------------------------------------------------------------------------
(async () => {
  const db = await connect();
  try {
    const has = (await db.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'categories' AND column_name = 'redirect_to'")).rows.length;
    if (!has) throw new Error("Run `npm run db:migrate` first (013_category_redirects.sql adds what this needs).");
    if (MODE === "undo") {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext('categories-tidy'))");
      const id = await undo(db);
      await db.query("COMMIT");
      console.log(`Undone: categories are back exactly as before tidy-up ${id}.`);
      return;
    }
    const data = await load(db);
    const p = plan(data);
    printPlan(p);
    if (MODE === "preview") {
      writeCsv(p, path.join(process.cwd(), "category-tidy-preview.csv"));
      console.log("\nPreview only: nothing was changed. Run with --apply to make the change.");
      return;
    }
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('categories-tidy'))");
    try {
      const r = await apply(db, p, data);
      await db.query("COMMIT");
      console.log(`\nDone (tidy-up ${r.run}). ${r.summary.products} products sorted, ${r.summary.hidden_categories} old categories hidden.`);
      console.log("To put everything back: npm run categories:tidy -- --undo");
    } catch (err) {
      await db.query("ROLLBACK");
      console.log("\nFAILED: rolled back, nothing changed.");
      throw err;
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

module.exports = { classify, plan, TREE };
