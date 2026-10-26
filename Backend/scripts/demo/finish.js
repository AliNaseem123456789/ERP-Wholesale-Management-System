// The end of the demo year: storefronts, collections, saved carts, stock alerts, moderation,
// and a few things left open on purpose (a draft PO, a pending leave request, a sent quote...).
module.exports = async (ctx) => {
  const { W, Client, q, clock, setDay, int, pick, chance, shuffle, round2, slugify, log, IMG, PASSWORD } = ctx;
  const LAST = ctx.lastDay;
  const M = W.companies.meridian;
  const { team, employees } = ctx.extra;
  const soft = { soft: true };
  const T = (role) => team[role] || M.co;

  // ---- collections and storefronts
  setDay(LAST - 20, 100);
  const meridianCollections = [];
  const coll = async (company, name, description, products, extra = {}) => {
    const who = company.key === "meridian" ? T("MANAGER") : company.co;
    const r = await who.post("/company/collections", { name, description, status: "published", is_enabled: true, product_ids: products.map((p) => p.id), cover_image_url: `${IMG}/companies/${company.key}-banner.jpg`, ...extra }, soft);
    return r?.data;
  };
  const bySub = (company, subs) => company.products.filter((p) => subs.includes(p.sub));
  for (const [name, desc, subs] of [
    ["Cold & flu season", "Everything pharmacies and c-stores need when sniffles start.", ["cold-allergy", "pain-relief", "vitamins-supplements"]],
    ["Summer hydration", "Water, sports and energy drinks that fly off the cooler.", ["bottled-water", "energy-drinks", "soft-drinks-juice"]],
    ["Checkout lane favourites", "Impulse buys with the best margins.", ["chips-snacks", "chargers-cables", "car-air-fresheners"]],
    ["Janitorial essentials", "Restock cleaning, paper and trash bags in one order.", ["cleaning-supplies", "paper-goods", "trash-bags"]],
  ]) {
    const c = await coll(M, name, desc, bySub(M, subs).slice(0, 16));
    if (c) meridianCollections.push(c);
  }
  for (const c of Object.values(W.companies).filter((x) => x.key !== "meridian")) {
    const best = shuffle(c.products).slice(0, Math.min(10, c.products.length));
    const r = await coll(c, "Best sellers", `Our most ordered products at ${c.info.name}.`, best);
    c.collection = r;
  }
  // platform collection on the marketplace homepage
  await W.admin.post("/admin/collections", { name: "New on the marketplace", description: "Fresh suppliers and lines added this year.", status: "published", is_enabled: true, product_ids: shuffle(W.products.filter((p) => !["cloudnine", "maisonlumen"].includes(p.company))).slice(0, 18).map((p) => p.id) }, soft);

  const brandIds = async (company) => (await q("SELECT cb.brand_id FROM company_brands cb WHERE cb.company_id = $1 LIMIT 8", [company.id])).map((r) => String(r.brand_id));
  const catIds = (company) => [...new Set(company.products.map((p) => W.cats[p.sub]).filter((c) => c && Number(c.id) >= 5000000).map((c) => String(c.id)))].slice(0, 12);
  for (const c of Object.values(W.companies)) {
    setDay(LAST - int(10, 18), int(100, 400));
    const who = c.key === "meridian" ? T("MANAGER") : c.co;
    const feat = c.products.filter((p) => p.o.feat).concat(shuffle(c.products)).slice(0, 8).map((p) => String(p.id));
    const sections = [
      { type: "hero", title: c.info.tagline, subtitle: `${c.info.city}, ${c.info.state} · Ships in ${c.info.lead} business days`, layout: "full", image_url: `${IMG}/companies/${c.key}-banner.jpg`, image_alt: c.info.name, text: c.info.description.slice(0, 300), link: `/companies/${slugify(c.info.name)}`, link_label: "Shop all products" },
      { type: "announcement", title: "", text: c.key === "meridian" ? "Free delivery on orders over $600 · Net 30 terms for approved accounts" : `Minimum order $${c.info.min_order}. Free freight over $${c.info.min_order * 4}.`, layout: "bar" },
      { type: "featured_products", title: "Featured products", product_ids: feat, layout: "carousel", limit: 8 },
    ];
    const cats = catIds(c);
    if (cats.length) sections.push({ type: "category_tiles", title: "Shop by category", category_ids: cats, layout: "tiles" });
    if (c.key === "meridian") for (const col of meridianCollections.slice(0, 2)) sections.push({ type: "collection", title: col.name, collection_id: String(col.id), layout: "grid", limit: 8 });
    else if (c.collection) sections.push({ type: "collection", title: "Best sellers", collection_id: String(c.collection.id), layout: "grid", limit: 8 });
    sections.push({ type: "deals", title: "Wholesale offers", layout: "grid", limit: 8 });
    const brands = await brandIds(c);
    if (brands.length) sections.push({ type: "featured_brands", title: "Brands we carry", brand_ids: brands, layout: "logos" });
    sections.push({ type: "about", title: `About ${c.info.name}`, text: c.info.description, layout: "text" });
    sections.push({ type: "contact", title: "Ordering & terms", layout: "card" });
    const theme = { meridian: "modern", harbor: "bold", voltedge: "modern", cloudnine: "bold", maisonlumen: "minimal" }[c.key] || pick(["classic", "modern", "minimal"]);
    await who.put("/company/storefront", { config: { theme, colors: { primary: c.info.color, accent: c.key === "meridian" ? "#f59e0b" : "#0ea5e9" }, sections } }, soft);
    await who.post("/company/storefront/publish", {}, soft);
    if (c.key === "meridian") {
      // a second, newer version (so the version history has something in it)
      clock.advance(5 * 86400000);
      sections.splice(2, 0, { type: "promo_banners", title: "This month", layout: "row", items: [
        { image_url: `${IMG}/categories/snacks-beverages.jpg`, title: "Snacks & drinks", link: "/categories/snacks-beverages" },
        { image_url: `${IMG}/categories/household-cleaning.jpg`, title: "Cleaning & paper", link: "/categories/household-cleaning" },
        { image_url: `${IMG}/categories/health-wellness.jpg`, title: "Health & wellness", link: "/categories/health-wellness" },
      ] });
      await who.put("/company/storefront", { config: { theme, colors: { primary: c.info.color, accent: "#f59e0b" }, sections } }, soft);
      await who.post("/company/storefront/publish", {}, soft);
    }
  }

  // ---- a couple of time-limited deals right now
  setDay(LAST - 3, 200);
  for (const p of shuffle(W.products).slice(0, 14)) {
    const co = W.companies[p.company];
    const who = co.key === "meridian" ? T("MANAGER") : co.co;
    await who.patch(`/company/products/${p.id}`, { sale_percent: pick([5, 8, 10, 12, 15, 20]), sale_label: pick(["Clearance", "Weekly deal", "Limited time", "Holiday special"]), sale_starts_at: new Date(clock.now() - 2 * 86400000).toISOString(), sale_ends_at: new Date(clock.now() + int(10, 40) * 86400000).toISOString() }, soft);
  }

  // ---- buyers: saved carts, stock alerts, notifications read
  for (const b of shuffle(W.buyers).slice(0, 14)) {
    setDay(LAST - int(0, 30), int(100, 500));
    const last = W.orders.filter((o) => o.buyer === b).pop();
    if (!last) continue;
    const items = await q("SELECT product_id, flavor, quantity FROM order_items WHERE order_id = $1", [last.id]);
    await b.c.post("/cart/save-cart-template", { cartName: pick(["Weekly restock", "Monthly order", "Holiday stock-up", "Cooler refill"]), items: items.map((i) => ({ product_id: Number(i.product_id), quantity: i.quantity, flavor: i.flavor || undefined })) }, soft);
    await b.c.post("/notifications/read-all", {}, soft);
  }
  const out = await q(`SELECT l.product_id, l.flavor FROM inventory_levels l JOIN products p ON p.id = l.product_id WHERE p.id >= 5000000 GROUP BY 1, 2 HAVING sum(l.on_hand - l.reserved) <= 0 LIMIT 12`);
  for (const o of out) {
    const b = pick(W.buyers);
    await b.c.post("/account/stock-alerts", { product_id: o.product_id, flavor: o.flavor || undefined }, soft);
  }

  // ---- moderation and the report desk
  setDay(LAST - 2, 300);
  const reports = (await W.admin.get("/admin/reports", soft))?.data || [];
  for (const r of reports.filter((x) => Number(x.id) >= 5000000)) {
    const company = Object.values(W.companies).find((c) => String(c.id) === String(r.company_id));
    if (company && chance(0.8)) await (company.key === "meridian" ? T("SALES") : company.co).post(`/company/reports/${r.id}/respond`, { response: "We've issued a credit for the damaged cases and spoken to our driver." }, soft);
    clock.advance(86400000);
    if (chance(0.7)) await W.admin.patch(`/admin/reports/${r.id}`, { status: "resolved", resolution: "Seller credited the buyer.", admin_note: "Checked with both sides." }, soft);
  }
  // a seller flags a review it thinks is unfair; the team keeps it
  const low = (await q("SELECT id, company_id FROM reviews WHERE id >= 5000000 AND rating <= 2 ORDER BY id LIMIT 1"))[0];
  if (low) {
    const company = Object.values(W.companies).find((c) => String(c.id) === String(low.company_id));
    const rep = await (company.key === "meridian" ? T("SALES") : company.co).post(`/company/reviews/${low.id}/report`, { reason: "not_relevant", details: "This was a delivery delay, not a product problem." }, soft);
    if (rep?.data) await W.admin.patch(`/admin/reports/${rep.data.id}`, { status: "dismissed", resolution: "Review describes a real experience; kept." }, soft);
  }

  // ---- left open on purpose, so every list has something to act on
  setDay(LAST, 200);
  const p = M.products.slice(0, 3);
  await T("MANAGER").post("/company/purchase-orders", { supplier_id: W.vendors.MPR.id, warehouse_id: M.wh.main, notes: "Draft: waiting for new price list", items: p.map((x) => ({ product_id: x.id, flavor: x.variants[0] || undefined, quantity: 12 })) }, soft);
  const e = employees.find((x) => x.s[0] === "Hannah");
  const annual = (await T("HR").get("/company/hr/leave-types")).data.find((t) => t.name === "Annual leave");
  if (e && annual) await T("HR").post("/company/hr/leave", { employee_id: e.id, leave_type_id: annual.id, start_date: ctx.ymd(ctx.at(LAST + 20, 0)), end_date: ctx.ymd(ctx.at(LAST + 24, 0)), reason: "Thanksgiving trip" }, soft);
  // staff with a login ask for their own leave
  const sales = team.SALES;
  if (sales) await sales.post("/company/me/hr/leave", { leave_type_id: annual?.id, start_date: ctx.ymd(ctx.at(LAST + 35, 0)), end_date: ctx.ymd(ctx.at(LAST + 37, 0)), reason: "Family visit" }, soft);
  log("finish done");
};
