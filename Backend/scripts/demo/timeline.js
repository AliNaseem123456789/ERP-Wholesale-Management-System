// The demo year, day by day: operations set-up, buyers, orders, purchasing, money, HR and payroll,
// quotes, returns, reviews... all through the API. Called by generate.js.
module.exports = async (ctx) => {
  const { W, C, Client, register, login, q, clock, setDay, at, dow, isWorkday, rnd, int, pick, chance, shuffle, weighted, round2, slugify, ymd, log, stats, mails, IMG, DAY, PASSWORD } = ctx;
  const LAST = ctx.lastDay;
  const M = W.companies.meridian;
  const dayOf = (t) => Math.floor((t - at(0, 0) + 12 * 3600000) / DAY);
  const dateStr = (d) => ymd(at(d, 0));
  const soft = { soft: true };
  const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);
  const lastMail = (to, template) => [...mails].reverse().find((m) => m.to === to && (!template || m.template === template));
  const monthOf = (d) => dateStr(d).slice(0, 7);
  const monthEnd = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const dayIndexOf = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - at(0, 0) + 12 * 3600000) / DAY);
  const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

  // =====================================================================================================
  // 1. Meridian: team, warehouses, accounting, HR, vendors, pricing
  // =====================================================================================================
  setDay(1, 20);
  const mco = M.co;
  // team: invite, accept (creates the login), then each member works with their own client
  const team = {};
  for (const s of C.STAFF.filter((x) => x[6] && x[6] !== "OWNER")) {
    const [first, last, , , , , role] = s;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@meridian-trade.example.com`;
    await mco.post("/company/invitations", { email, role });
    const token = lastMail(email, "invitation").data.token;
    clock.advance(int(1, 6) * 3600000);
    const anon = new Client(email);
    await anon.post(`/invitations/${token}/accept`, { password: PASSWORD, firstName: first, lastName: last });
    const c = await login(email);
    team[role] = c.as(M.id);
    team[role].email = email;
  }
  team.OWNER = mco;
  const T = (role) => team[role] || mco;
  log("meridian team", Object.keys(team).join(", "));

  // warehouses & bins
  const whs = (await mco.get("/company/warehouses")).data;
  const main = whs[0];
  await mco.patch(`/company/warehouses/${main.id}`, { name: "Newark Distribution Center", code: "NWK", address_line1: "1200 Port Logistics Blvd", city: "Newark", state: "NJ", postal_code: "07114", country: "USA", phone: "(973) 555-0142" });
  const phl = (await mco.post("/company/warehouses", { name: "Philadelphia Cross-Dock", code: "PHL", address_line1: "7600 Essington Ave", city: "Philadelphia", state: "PA", postal_code: "19153", country: "USA" })).data;
  const hfd = (await mco.post("/company/warehouses", { name: "Hartford Depot", code: "HFD", address_line1: "40 Brainard Rd", city: "Hartford", state: "CT", postal_code: "06114", country: "USA" })).data;
  M.wh = { main: main.id, phl: phl.id, hfd: hfd.id };
  const bins = { [main.id]: [], [phl.id]: [], [hfd.id]: [] };
  for (const aisle of ["A", "B", "C", "D", "E", "F"]) for (let r = 1; r <= 6; r++) {
    const b = (await mco.post(`/company/warehouses/${main.id}/bins`, { code: `${aisle}-${String(r).padStart(2, "0")}`, description: `Aisle ${aisle}, rack ${r}` })).data;
    bins[main.id].push(b.id);
  }
  for (const [wid, pre] of [[phl.id, "P"], [hfd.id, "H"]]) for (let r = 1; r <= 6; r++) {
    bins[wid].push((await mco.post(`/company/warehouses/${wid}/bins`, { code: `${pre}-${String(r).padStart(2, "0")}`, description: `Bay ${r}` })).data.id);
  }

  // accounting from day 1, with opening cash and bank
  await T("ACCOUNTANT").post("/company/accounting/setup", { start_date: dateStr(1), cash: 12500, bank: 240000 });
  const accounts = (await T("ACCOUNTANT").get("/company/accounting/accounts")).data;
  const acc = (code) => accounts.find((a) => a.code === code)?.id;
  M.acc = { cash: acc("1000"), bank: acc("1010"), rent: acc("6200"), util: acc("6300"), wages: acc("6400"), office: acc("6500"), ship: acc("6600"), soft: acc("6700"), prof: acc("6800"), ins: acc("6900"), mkt: acc("6000"), fees: acc("6100"), other: acc("6990"), otherIncome: acc("4900"), cogs: acc("5000"), equip: acc("1500"), vehicles: acc("1510"), loan: acc("2500"), card: acc("2200"), prepaid: acc("1300") };
  // a delivery van bought on a loan, recorded by hand
  await T("ACCOUNTANT").post("/company/accounting/journal", { entry_date: dateStr(3), memo: "Delivery van (Ford Transit) financed over 48 months", lines: [{ account_id: M.acc.vehicles, debit: 46800, description: "2025 Ford Transit 250" }, { account_id: M.acc.loan, credit: 46800, description: "Vehicle loan" }] });
  await T("ACCOUNTANT").post("/company/accounting/journal", { entry_date: dateStr(4), memo: "Warehouse racking and scanners", lines: [{ account_id: M.acc.equip, debit: 18250 }, { account_id: M.acc.bank, credit: 18250 }] });

  // HR settings, departments, leave, holidays, pay components
  const HR = T("HR");
  await mco.patch("/company/hr/settings", { workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, overtimeMultiplier: 1.5, taxBrackets: [{ upTo: 11600, rate: 10 }, { upTo: 47150, rate: 12 }, { upTo: 100525, rate: 22 }, { upTo: null, rate: 24 }], payslipNotes: "Questions about your pay? Contact payroll@meridian-trade.example.com" });
  const depts = {};
  for (const [name, code] of C.DEPARTMENTS) depts[code] = (await HR.post("/company/hr/departments", { name, code, description: `${name} team` })).data;
  const leaveTypes = {};
  for (const [name, paid, days] of [["Annual leave", true, 15], ["Sick leave", true, 8], ["Unpaid leave", false, 0], ["Bereavement", true, 3]]) {
    leaveTypes[name] = (await HR.post("/company/hr/leave-types", { name, paid, annual_days: days })).data;
  }
  const holidaysUS = (y) => [[`${y}-01-01`, "New Year's Day"], [`${y}-05-25`, "Memorial Day"], [`${y}-07-04`, "Independence Day"], [`${y}-09-07`, "Labor Day"], [`${y}-11-26`, "Thanksgiving Day"], [`${y}-11-27`, "Day after Thanksgiving"], [`${y}-12-25`, "Christmas Day"]];
  const holidaySet = new Set();
  for (const y of [Number(dateStr(0).slice(0, 4)), Number(dateStr(LAST).slice(0, 4))]) {
    for (const [d, name] of holidaysUS(y)) {
      if (d < dateStr(1) || d > addDays(dateStr(LAST), 60) || holidaySet.has(d)) continue;
      holidaySet.add(d);
      await HR.post("/company/hr/holidays", { holiday_date: d, name }, soft);
    }
  }
  const comp = {};
  const pc = async (code, name, kind, calc, extra = {}) => { comp[code] = (await mco.post("/company/payroll/components", { code, name, kind, calc, ...extra })).data; };
  await pc("TRANSPORT", "Transport allowance", "earning", "fixed", { amount: 150, taxable: true, applies_to_all: true });
  await pc("SHIFT", "Warehouse shift allowance", "earning", "fixed", { amount: 120, taxable: true, applies_to_all: false });
  await pc("FIT", "Federal income tax", "deduction", "tax_table", { applies_to_all: true });
  await pc("SS-EE", "Social Security (employee)", "deduction", "percent_gross", { percent: 6.2, applies_to_all: true });
  await pc("MED-EE", "Medicare (employee)", "deduction", "percent_gross", { percent: 1.45, applies_to_all: true });
  await pc("401K", "401(k) contribution", "deduction", "percent_base", { percent: 4, applies_to_all: false });
  await pc("HEALTH", "Health insurance premium", "deduction", "fixed", { amount: 135, applies_to_all: false });
  await pc("SS-ER", "Social Security (employer)", "employer", "percent_gross", { percent: 6.2, applies_to_all: true });
  await pc("MED-ER", "Medicare (employer)", "employer", "percent_gross", { percent: 1.45, applies_to_all: true });
  await pc("SUTA", "State unemployment (employer)", "employer", "percent_gross", { percent: 1.2, applies_to_all: true });
  await pc("401K-ER", "401(k) employer match", "employer", "percent_base", { percent: 3, applies_to_all: false });

  // employees (people hired before the demo year are created now with their real hire date)
  const memberUsers = Object.fromEntries((await q("SELECT u.email, u.id FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = $1", [M.id])).map((r) => [r.email, r.id]));
  const employees = [];
  const createEmployee = async (s, i) => {
    const [first, last, title, dept, salary, monthsAgo, role] = s;
    const hourly = /Picker|Associate|Forklift/.test(title);
    const hire = ymd(clock.realNow() - monthsAgo * 30.4 * DAY);
    const email = role === "OWNER" ? ctx.OWNER_EMAIL("meridian") : `${first.toLowerCase()}.${last.toLowerCase()}@meridian-trade.example.com`;
    const e = (await HR.post("/company/hr/employees", {
      employee_number: `MTC-${String(101 + i)}`, first_name: first, last_name: last, job_title: title, email, phone: `(973) 555-${String(1000 + i * 37).slice(-4)}`,
      department_id: depts[dept].id, employment_type: first === "Mei" ? "part_time" : "full_time", hire_date: hire, date_of_birth: `${int(1968, 2001)}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`,
      address: `${int(10, 990)} ${pick(["Broad St", "Ferry St", "Elm Ave", "Park Pl", "Market St", "Lincoln Ave"])}, ${pick(["Newark", "Elizabeth", "Kearny", "Harrison", "Bayonne"])}, NJ`,
      emergency_contact_name: `${pick(["Maria", "John", "Linda", "James", "Ana", "Robert"])} ${last}`, emergency_contact_phone: `(201) 555-${String(int(1000, 9999))}`,
      bank_name: pick(["Chase", "Bank of America", "TD Bank", "Wells Fargo", "PNC"]), bank_account_number: `****${int(1000, 9999)}`, bank_routing: "021000021",
      pay_type: hourly ? "hourly" : "salary", base_salary: hourly ? 0 : salary, hourly_rate: hourly ? round2(salary / 173) : 0, payment_method: "bank_transfer",
      user_id: memberUsers[email] ? String(memberUsers[email]) : undefined,
    })).data;
    const extra = [];
    if (["WHS", "DEL"].includes(dept)) extra.push({ component_id: comp.SHIFT.id });
    if (chance(0.6)) extra.push({ component_id: comp["401K"].id }, { component_id: comp["401K-ER"].id });
    if (chance(0.7)) extra.push({ component_id: comp.HEALTH.id });
    if (extra.length) await mco.put(`/company/hr/employees/${e.id}/pay-components`, { components: extra });
    employees.push({ ...e, s, dept, hourly, hire });
    return e;
  };
  const laterHires = [];
  for (const [i, s] of C.STAFF.entries()) {
    if (s[5] * 30.4 > (clock.realNow() - at(1, 0)) / DAY) await createEmployee(s, i);
    else laterHires.push([s, i]);
  }
  for (const code of Object.keys(depts)) {
    const mgr = employees.find((e) => e.dept === code && /Manager|Supervisor|Lead|Director|Dispatcher|Buyer/.test(e.s[2]));
    if (mgr) await HR.patch(`/company/hr/departments/${depts[code].id}`, { manager_employee_id: mgr.id });
  }
  log(`meridian employees ${employees.length} (+${laterHires.length} later)`);

  // vendors (external suppliers) and what Meridian buys from each
  const vendorOf = {};
  for (const v of C.VENDORS) {
    const [name, code, contact, email, city, state, terms, brands] = v;
    const sup = (await T("MANAGER").post("/company/suppliers", { name, code, contact_name: contact, email, phone: `(800) 555-${String(int(1000, 9999))}`, city, state, country: state === "Guangdong" ? "China" : "USA", payment_terms_days: terms, currency: "USD", notes: `Account manager: ${contact}` })).data;
    W.vendors[code] = { ...sup, terms, lead: code === "CHG" ? 14 : int(3, 7), brands };
    for (const b of brands) vendorOf[b] = code;
  }
  for (const p of M.products) {
    const code = vendorOf[p.brand] || "SPC";
    p.vendor = code;
    await T("MANAGER").put(`/company/suppliers/${W.vendors[code].id}/products`, { product_id: p.id, supplier_sku: `${code}-${int(10000, 99999)}`, unit_cost: p.cost, lead_time_days: W.vendors[code].lead, preferred: true });
    p.reorder_point = int(24, 48); p.reorder_qty = int(72, 144);
    await T("MANAGER").patch(`/company/products/${p.id}`, { reorder_point: p.reorder_point, reorder_quantity: p.reorder_qty, preferred_supplier_id: W.vendors[code].id });
  }

  // customer groups, price lists, promotions, compliance-free sales settings
  const S = T("SALES");
  const volume = (await S.post("/company/price-lists", { name: "Volume pricing", description: "Case-quantity breaks for every account", is_default: true })).data;
  const keyList = (await S.post("/company/price-lists", { name: "Key account pricing", description: "Negotiated prices for chain and multi-store accounts" })).data;
  for (const p of shuffle(M.products).slice(0, 40)) {
    await S.put(`/company/price-lists/${volume.id}/products/${p.id}`, { tiers: [{ min_quantity: 10, price: round2(p.price * 0.96) }, { min_quantity: 25, price: round2(p.price * 0.92) }] });
  }
  for (const p of shuffle(M.products).slice(0, 30)) await S.put(`/company/price-lists/${keyList.id}/products/${p.id}`, { tiers: [{ min_quantity: 1, price: round2(p.price * 0.93) }] });
  M.groups = {
    key: (await S.post("/company/customer-groups", { name: "Key accounts", description: "Chains and multi-store operators", discount_percent: 0, price_list_id: keyList.id })).data,
    pharm: (await S.post("/company/customer-groups", { name: "Pharmacy partners", description: "Independent pharmacies", discount_percent: 3 })).data,
    retail: (await S.post("/company/customer-groups", { name: "Independent retail", description: "Convenience stores, delis and markets", discount_percent: 0 })).data,
    auto: (await S.post("/company/customer-groups", { name: "Gas & auto", description: "Gas stations and auto shops", discount_percent: 2 })).data,
  };
  log("meridian set up");

  // =====================================================================================================
  // 2. the other sellers: books, opening stock, simple pricing
  // =====================================================================================================
  for (const c of Object.values(W.companies)) {
    c.whMain = (await c.co.get("/company/warehouses")).data[0].id;
    if (c.key === "meridian") continue;
    setDay(26, int(0, 300));
    for (const p of c.products) {
      const keys = p.variants.length ? p.variants : [null];
      for (const k of keys) {
        await c.co.post("/company/inventory/adjust", {
          warehouse_id: c.whMain, product_id: p.id, flavor: k || undefined, mode: "add", quantity: int(25, 70) * (p.price > 80 ? 1 : 2) / (keys.length > 2 ? 2 : 1) | 0 || 10,
          reason: "other", notes: "Opening stock count", unit_cost: p.cost, lot_number: p.shelf ? `L${int(10000, 99999)}` : undefined,
          expiry_date: p.shelf ? ymd(clock.now() + p.shelf * 30 * DAY) : undefined,
        });
      }
    }
    clock.advance(3600000);
    await c.co.post("/company/accounting/setup", { start_date: dateStr(26), cash: int(2, 8) * 1000, bank: int(30, 120) * 1000, include_inventory: true });
    c.acc = Object.fromEntries((await c.co.get("/company/accounting/accounts")).data.map((a) => [a.code, a.id]));
    if (chance(0.6)) {
      const pl = (await c.co.post("/company/price-lists", { name: "Volume pricing", is_default: true })).data;
      for (const p of shuffle(c.products).slice(0, 6)) await c.co.put(`/company/price-lists/${pl.id}/products/${p.id}`, { tiers: [{ min_quantity: 6, price: round2(p.price * 0.95) }, { min_quantity: 12, price: round2(p.price * 0.9) }] });
    }
  }
  // Cloud Nine: state rules for regulated products
  const cn = W.companies.cloudnine.co;
  await cn.post("/company/compliance/rules", { state: "TX", category: "*", tax_type: "none", license_required: true, age_verification: true, notes: "Texas: retailer cigarette/e-cigarette permit required" });
  await cn.post("/company/compliance/rules", { state: "NJ", category: "e_liquid", tax_type: "per_ml", tax_rate: 0.1, license_required: true, flavor_ban: false, notes: "NJ liquid nicotine tax $0.10/ml" });
  await cn.post("/company/compliance/rules", { state: "MA", category: "*", ship_banned: true, notes: "No flavoured vapor sales into MA" });

  // =====================================================================================================
  // 3. Meridian's opening stock: real purchase orders, received into bins with lots
  // =====================================================================================================
  const poQueue = [];
  const openPos = [];
  const createPO = async (vendorCode, lines, d, whId = M.wh.main, note) => {
    const v = W.vendors[vendorCode];
    const po = (await T("MANAGER").post("/company/purchase-orders", {
      supplier_id: v.id, warehouse_id: whId, expected_date: dateStr(d + v.lead), supplier_reference: null, notes: note || null,
      shipping_amount: lines.length > 6 ? int(80, 260) : 0, items: lines.map((l) => ({ product_id: l.p.id, flavor: l.flavor || undefined, quantity: l.qty })),
    })).data;
    await T("MANAGER").post(`/company/purchase-orders/${po.id}/send`, { email: true });
    openPos.push({ id: po.id, vendor: vendorCode, due: d + v.lead + (chance(0.2) ? int(1, 4) : 0), wh: whId, lines });
    return po;
  };
  {
    setDay(26, 60);
    const byVendor = {};
    for (const p of M.products) (byVendor[p.vendor] ||= []).push(p);
    for (const [code, list] of Object.entries(byVendor)) {
      const lines = [];
      for (const p of list) {
        if (p.variants.length) for (const k of p.variants) lines.push({ p, flavor: k, qty: Math.ceil(p.reorder_qty * 1.2 / Math.min(3, p.variants.length)) });
        else lines.push({ p, qty: Math.ceil(p.reorder_qty * 1.6) });
      }
      const po = await createPO(code, lines, 26, M.wh.main, "Opening stock");
      openPos[openPos.length - 1].due = 27 + int(0, 2);
      void po;
    }
  }

  const receivePO = async (po, d) => {
    const full = (await T("WAREHOUSE").get(`/company/purchase-orders/${po.id}`)).data;
    const items = full.purchase_order_items || full.items || [];
    const partial = chance(0.12);
    const lines = items.map((it) => {
      const rest = it.quantity_ordered - (it.quantity_received || 0);
      const qty = partial && chance(0.5) ? Math.max(0, Math.floor(rest * 0.6)) : rest;
      const p = W.products.find((x) => String(x.id) === String(it.product_id));
      return { item_id: it.id, quantity: qty, bin_id: pick(bins[po.wh]), lot_number: p?.shelf ? `${po.vendor}${dateStr(d).replace(/-/g, "").slice(2)}${int(10, 99)}` : undefined, expiry_date: p?.shelf ? ymd(at(d) + (p.shelf * 30 - int(0, 40)) * DAY) : undefined };
    }).filter((l) => l.quantity > 0);
    if (!lines.length) return;
    await T("WAREHOUSE").post(`/company/purchase-orders/${po.id}/receive`, { lines, notes: partial ? "Short shipment, rest on back order" : null, landed_cost: chance(0.25) ? int(40, 180) : undefined });
    po.received = (po.received || 0) + 1;
    if (partial) {
      po.due = d + int(3, 8);
      if (po.received >= 2 || chance(0.3)) { await T("MANAGER").post(`/company/purchase-orders/${po.id}/close`, {}, soft); po.done = true; }
    } else po.done = true;
    // the vendor's invoice arrives with the goods: enter the bill from the receipt
    const draft = await T("ACCOUNTANT").get(`/company/purchase-orders/${po.id}/bill-draft`, soft);
    if (draft?.data?.lines?.length) {
      const v = W.vendors[po.vendor];
      const bill = (await T("ACCOUNTANT").post("/company/bills", {
        supplier_id: v.id, purchase_order_id: po.id, supplier_invoice_number: `${po.vendor}-INV-${int(100000, 999999)}`, bill_date: dateStr(d), due_date: dateStr(d + v.terms),
        lines: draft.data.lines.map((l) => ({ ...l })), notes: null,
      }, soft))?.data;
      if (bill) W.bills.push({ id: bill.id, due: d + v.terms, total: Number(bill.total_amount), vendor: po.vendor });
    }
  };
  W.bills = [];

  // =====================================================================================================
  // 4. buyers
  // =====================================================================================================
  const buyerDays = C.BUYERS.map((_, i) => (i < 16 ? 27 + Math.round(i * 1.4) : 50 + Math.round(((i - 16) / (C.BUYERS.length - 16)) * 235) + int(0, 6)));
  W.demoBuyerEmail = "demo@corner-market.example.com";
  const onboardBuyer = async (b, i) => {
    const [business, first, last, city, state, zip, street, kind] = b;
    setDay(buyerDays[i], int(0, 500));
    const email = i === 0 ? W.demoBuyerEmail : `${first.toLowerCase()}@${slugify(business)}.example.com`;
    const c = await register(email, first, last, business);
    await c.patch("/account/update-profile", { firstName: first, lastName: last, businessName: business, phone: `(${int(201, 989)}) 555-${int(1000, 9999)}` }, soft);
    await c.post("/address", { full_name: `${first} ${last}`, company: business, address_line1: street, city, state, postal_code: zip, country: "USA", phone: `(${int(201, 989)}) 555-${int(1000, 9999)}`, is_default: true });
    if (chance(0.25)) await c.post("/address", { full_name: `${first} ${last}`, company: `${business} (2nd store)`, address_line1: `${int(100, 999)} ${pick(["Main St", "Route 9", "Center Ave"])}`, city, state, postal_code: zip, country: "USA" }, soft);
    const addrs = await c.get("/address");
    const list = addrs.data || addrs;
    const buyer = { i, email, c, business, first, last, city, state, zip, street, kind, addr: list[0].id, sellers: C.BUYS_FROM[kind], joined: buyerDays[i], every: kind === "conv" || kind === "cafe" ? int(3, 6) : int(5, 11), next: buyerDays[i] + int(1, 5), terms: {} };
    W.buyers.push(buyer);
    return buyer;
  };
  const onboardTerms = async (buyer) => {
    // Meridian gives payment terms and groups to established accounts
    const cust = (await S.get(`/company/customers?search=${encodeURIComponent(buyer.email)}`)).data?.[0];
    if (!cust) return;
    const group = { conv: M.groups.retail, cafe: M.groups.retail, pharm: M.groups.pharm, auto: M.groups.auto }[buyer.kind] || M.groups.retail;
    const isKey = buyer.i === 0 || buyer.i === 3 || buyer.i === 8 || buyer.i === 28;
    const terms = isKey || chance(0.45);
    await S.patch(`/company/customers/${cust.id}`, {
      customer_group_id: (isKey ? M.groups.key : group).id, payment_terms_days: terms ? (isKey ? 30 : pick([15, 30])) : 0, credit_limit: terms ? (isKey ? 15000 : pick([2500, 5000, 7500])) : null,
      tax_id: `NJ-${int(100000, 999999)}`, notes: isKey ? "Key account: weekly delivery, call before Friday" : null,
    });
    if (terms) buyer.terms[M.id] = true;
  };

  // =====================================================================================================
  // 5. orders
  // =====================================================================================================
  const pipeline = []; // { id, company, buyer, placed, next, step }
  const avail = async (companyId, warehouseId = null) => {
    const rows = await q(`SELECT l.product_id, l.flavor, sum(l.on_hand - l.reserved) AS a FROM inventory_levels l WHERE l.company_id = $1 AND ($2::bigint IS NULL OR l.warehouse_id = $2) GROUP BY 1, 2`, [companyId, warehouseId]);
    const pend = await q(`SELECT oi.product_id, coalesce(oi.flavor, '') AS flavor, sum(oi.quantity) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.company_id = $1 AND o.status = 'pending' GROUP BY 1, 2`, [companyId]);
    const m = new Map(rows.map((r) => [`${r.product_id}|${r.flavor || ""}`, Number(r.a)]));
    for (const p of pend) m.set(`${p.product_id}|${p.flavor}`, (m.get(`${p.product_id}|${p.flavor}`) || 0) - Number(p.n));
    return m;
  };
  const popularity = new Map(W.products.map((p) => [p.id, (p.o.feat ? 3 : 1) * (0.5 + rnd())]));
  const pickProducts = (company, n) => {
    const list = company.products;
    const out = new Set();
    let guard = 0;
    while (out.size < Math.min(n, list.length) && guard++ < 200) {
      const tot = sum(list, (p) => popularity.get(p.id));
      let x = rnd() * tot;
      for (const p of list) { if ((x -= popularity.get(p.id)) <= 0) { out.add(p); break; } }
    }
    return [...out];
  };
  const activePromos = (company, d) => (company.promos || []).filter((p) => p.from <= d && p.to >= d);
  const placeOrder = async (buyer, d, { client = null, sellers = null, note = null, addr = null } = {}) => {
    const keys = sellers || [weighted(buyer.sellers)];
    if (chance(0.15) && !sellers) { const k2 = weighted(buyer.sellers); if (!keys.includes(k2)) keys.push(k2); }
    const c = client || buyer.c;
    await q("DELETE FROM cart_items WHERE user_id IN (SELECT id FROM users WHERE email = $1 OR parent_id = (SELECT id FROM users WHERE email = $1))", [buyer.email]);
    const promos = [];
    let any = false;
    for (const key of keys) {
      const company = W.companies[key];
      const stock = await avail(company.id);
      const big = buyer.i === 0 || buyer.i === 3 || buyer.i === 8 ? 1.6 : 1;
      const growth = 0.75 + (d / LAST) * 0.6;
      const wanted = pickProducts(company, Math.round(int(3, key === "meridian" ? 9 : 5) * big));
      let value = 0;
      for (const p of wanted) {
        const flavor = p.variants.length ? pick(p.variants) : "";
        const a = stock.get(`${p.id}|${flavor}`) || 0;
        let qty = Math.max(1, Math.round(int(1, p.price > 60 ? 3 : 6) * big * growth * (key === "meridian" ? 3 : 1)));
        if (p.o.mult) qty = Math.ceil(qty / p.o.mult) * p.o.mult;
        if (p.o.moq) qty = Math.max(qty, p.o.moq);
        if (a < qty) continue;
        const r = await c.post("/cart/add", { productId: p.id, flavor: flavor || undefined, quantity: qty }, soft);
        if (r) { value += qty * p.price; stock.set(`${p.id}|${flavor}`, a - qty); }
      }
      // reach the seller's minimum order
      let guard = 0;
      while (value < company.info.min_order * 1.05 && guard++ < 6) {
        const p = pick(company.products);
        const flavor = p.variants.length ? pick(p.variants) : "";
        const a = stock.get(`${p.id}|${flavor}`) || 0;
        const qty = Math.max(p.o.moq || 1, 2);
        if (a < qty) continue;
        const r = await c.post("/cart/add", { productId: p.id, flavor: flavor || undefined, quantity: qty }, soft);
        if (r) { value += qty * p.price; stock.set(`${p.id}|${flavor}`, a - qty); }
      }
      if (value > 0) any = true;
      const pr = activePromos(company, d).filter((p) => value >= (p.min || 0) && !(p.code === "WELCOME10" && (buyer.used || []).includes(p.code)));
      if (pr.length && chance(0.35)) promos.push(pick(pr).code);
    }
    if (!any) return [];
    const payment_methods = {};
    for (const key of keys) if (buyer.terms[W.companies[key].id] && chance(0.85)) payment_methods[W.companies[key].id] = "on_account";
    const shipTo = addr || buyer.addr;
    let r = await c.post("/orders/checkout", { shipping_address_id: shipTo, promo_codes: promos, payment_methods, business_name: buyer.business }, soft);
    if (!r && promos.length) r = await c.post("/orders/checkout", { shipping_address_id: shipTo, payment_methods, business_name: buyer.business }, soft);
    if (!r && Object.keys(payment_methods).length) r = await c.post("/orders/checkout", { shipping_address_id: shipTo, business_name: buyer.business }, soft);
    if (r && promos.length) buyer.used = [...(buyer.used || []), ...promos];
    if (!r) { await q("DELETE FROM cart_items WHERE user_id = (SELECT id FROM users WHERE email = $1)", [buyer.email]); return []; }
    const out = [];
    for (const o of r.orders) {
      const company = Object.values(W.companies).find((x) => String(x.id) === String(o.company?.id ?? o.company));
      const rec = { id: o.id, number: o.orderNumber, client: client || null, company: company?.key, buyer, placed: d, next: d + (chance(0.7) ? 0 : 1), step: "confirm", onAccount: o.payment_method === "on_account", total: Number(o.total), note };
      pipeline.push(rec); W.orders.push(rec); out.push(rec); stats.orders++;
    }
    return out;
  };

  const staffFor = (company, step) => {
    if (company.key !== "meridian") return company.co;
    if (step === "confirm") return chance(0.5) ? T("MANAGER") : T("SALES");
    return T("WAREHOUSE");
  };
  const advanceOrders = async (d) => {
    for (const o of pipeline.filter((x) => x.next <= d && !x.done)) {
      const company = W.companies[o.company];
      const who = staffFor(company, o.step);
      if (o.step === "confirm") {
        if (chance(0.025)) { await who.patch(`/company/orders/${o.id}/status`, { status: "cancelled", notes: pick(["Customer called to cancel", "Duplicate order", "Store closed for renovation"]) }, soft); o.done = true; o.cancelled = true; continue; }
        // ship from the nearest warehouse that has everything, else the main one
        let wh = company.whMain;
        if (company.key === "meridian") {
          const prefer = o.buyer.state === "PA" ? M.wh.phl : o.buyer.state === "CT" ? M.wh.hfd : M.wh.main;
          const ok = await q(`SELECT l.warehouse_id FROM order_items oi JOIN inventory_levels l ON l.product_id = oi.product_id AND l.flavor = coalesce(oi.flavor, '')
            WHERE oi.order_id = $1 AND l.on_hand - l.reserved >= oi.quantity GROUP BY l.warehouse_id HAVING count(*) = (SELECT count(*) FROM order_items WHERE order_id = $1)`, [o.id]);
          const ids = ok.map((x) => String(x.warehouse_id));
          wh = ids.includes(String(prefer)) ? prefer : ids.includes(String(M.wh.main)) ? M.wh.main : ids[0] || M.wh.main;
        }
        const r = await who.patch(`/company/orders/${o.id}/status`, { status: "confirmed", warehouse_id: wh }, soft);
        if (!r) { o.next = d + 1; o.tries = (o.tries || 0) + 1; if (o.tries > 4) { await who.patch(`/company/orders/${o.id}/status`, { status: "cancelled", notes: "Out of stock" }, soft); o.done = true; } continue; }
        o.step = chance(0.6) ? "process" : "ship"; o.next = d + (chance(0.6) ? 0 : 1);
      } else if (o.step === "process") {
        if (company.key === "meridian" && chance(0.3)) await who.get(`/company/orders/${o.id}/pick-list`, soft);
        await who.patch(`/company/orders/${o.id}/status`, { status: "processing" }, soft);
        o.step = "ship"; o.next = d + int(0, 1);
      } else if (o.step === "ship") {
        if (company.key === "meridian" && chance(0.25)) {
          const pack = await who.get(`/company/scan/orders/${o.id}`, soft);
          if (pack?.data?.lines) await who.post(`/company/scan/orders/${o.id}/verify`, { scanned: pack.data.lines.map((l) => ({ order_item_id: l.order_item_id, quantity: l.quantity })) }, soft);
        }
        const r = await who.patch(`/company/orders/${o.id}/status`, { status: "shipped", tracking_number: `${pick(["1Z", "94", "77"])}${int(100000000, 999999999)}${int(10, 99)}` }, soft);
        if (!r) { o.next = d + 1; o.shipTries = (o.shipTries || 0) + 1; if (o.shipTries > 3) o.done = true; continue; }
        o.step = "deliver"; o.next = d + int(1, 3); o.shipped = d;
      } else if (o.step === "deliver") {
        await who.patch(`/company/orders/${o.id}/status`, { status: "delivered" }, soft);
        o.step = "done"; o.done = true; o.delivered = d;
        if (o.onAccount) o.payDue = d + (o.buyer.i === 0 ? 30 : 20) + int(-6, 12);
        afterDelivery.push(o);
      }
    }
  };
  const afterDelivery = [];

  // on-account invoices get paid around their due date (a few late, a few still open at the end)
  const payInvoices = async (d) => {
    for (const o of W.orders.filter((x) => x.payDue && !x.paid && x.payDue <= d)) {
      const company = W.companies[o.company];
      if (o.buyer.i % 9 === 4 && d > LAST - 70) continue; // one slow payer
      const inv = await q("SELECT id, total_amount, amount_paid, amount_credited, status FROM invoices WHERE order_id = $1 AND status IN ('issued', 'partially_paid') LIMIT 1", [o.id]);
      if (!inv.length) { o.paid = true; continue; }
      const due = Number(inv[0].total_amount) - Number(inv[0].amount_paid) - Number(inv[0].amount_credited);
      if (due <= 0.005) { o.paid = true; continue; }
      const who = company.key === "meridian" ? T("ACCOUNTANT") : company.co;
      const partial = chance(0.08) && !o.partial;
      const amount = partial ? round2(due * pick([0.4, 0.5, 0.6])) : round2(due);
      await who.post(`/company/invoices/${inv[0].id}/payments`, { amount, method: pick(["bank_transfer", "bank_transfer", "check", "card"]), reference: `${pick(["ACH", "CHK", "WIRE"])}-${int(100000, 999999)}`, paid_at: dateStr(d), notify: true }, soft);
      if (partial) { o.partial = true; o.payDue = d + int(7, 20); } else o.paid = true;
    }
  };

  // =====================================================================================================
  // 6. money, HR, payroll (Meridian)
  // =====================================================================================================
  const expense = async (d, payee, account, amount, reference, notes, paidFrom = M.acc.bank, method = "bank_transfer") =>
    T("ACCOUNTANT").post("/company/expenses", { expense_date: dateStr(d), payee, account_id: account, paid_from_account_id: paidFrom, amount: round2(amount), method, reference, notes }, soft);

  const attendance = async (d) => {
    const date = dateStr(d);
    if (holidaySet.has(date)) return;
    const onLeave = new Set((await q("SELECT employee_id FROM leave_requests WHERE company_id = $1 AND status = 'approved' AND start_date <= $2 AND end_date >= $2", [M.id, date])).map((r) => String(r.employee_id)));
    const records = [];
    for (const e of employees) {
      if (e.hire > date || (e.left && e.left < date) || onLeave.has(String(e.id))) continue;
      const r = rnd();
      if (r < 0.025) records.push({ employee_id: e.id, status: "absent", notes: pick(["No show", "Car trouble", "Family emergency"]) });
      else if (r < 0.045) records.push({ employee_id: e.id, status: "half_day", check_in: "08:00", check_out: "12:00" });
      else {
        const late = chance(0.08) ? int(5, 40) : int(0, 4);
        const ot = ["WHS", "DEL"].includes(e.dept) && chance(0.18) ? pick([1, 1.5, 2, 3]) : 0;
        const inH = `0${7 + (late > 30 ? 1 : 0)}:${String((late % 30) + (e.dept === "WHS" ? 0 : 25)).padStart(2, "0")}`.slice(-5);
        const outMin = 16 * 60 + 30 + ot * 60 + int(0, 20);
        records.push({ employee_id: e.id, status: "present", check_in: inH, check_out: `${String(Math.floor(outMin / 60)).padStart(2, "0")}:${String(outMin % 60).padStart(2, "0")}`, overtime_hours: ot });
      }
    }
    if (records.length) await HR.put("/company/hr/attendance", { date, records }, soft);
  };

  const payroll = async (ym, d) => {
    const P = T("HR");
    const run = (await P.post("/company/payroll/runs", { month: ym, pay_date: dateStr(d + 1), notes: `Payroll for ${ym}` }, soft))?.data;
    if (!run) return;
    // a bonus or two, a correction now and then
    const full = (await P.get(`/company/payroll/runs/${run.id}`)).data;
    const slips = full.payslips || [];
    for (const s of shuffle(slips).slice(0, ym.endsWith("-12") ? slips.length : int(0, 2))) {
      await mco.put(`/company/payroll/payslips/${s.id}/adjustments`, { lines: [ym.endsWith("-12") ? { kind: "earning", name: "Year-end bonus", amount: int(3, 10) * 100, taxable: true } : pick([{ kind: "earning", name: "Sales commission", amount: int(150, 900), taxable: true }, { kind: "deduction", name: "Uniform", amount: 45, taxable: false }, { kind: "earning", name: "Referral bonus", amount: 250, taxable: true }])] }, soft);
    }
    clock.advance(2 * 3600000);
    await mco.post(`/company/payroll/runs/${run.id}/approve`, {}, soft);
    clock.advance(20 * 3600000);
    await T("ACCOUNTANT").post(`/company/payroll/runs/${run.id}/pay`, { account_id: M.acc.bank, paid_at: dateStr(d + 1), reference: `PAYROLL-${ym}`, email_payslips: true }, soft);
  };

  const reconcile = async (ym) => {
    const statementDate = monthEnd(ym);
    const view = await T("ACCOUNTANT").get(`/company/accounting/reconcile?account_id=${M.acc.bank}&statement_date=${statementDate}`, soft);
    const lines = view?.data?.lines || view?.lines || [];
    if (!lines.length) return;
    const cleared = lines.filter((l) => !(String(l.entry_date || l.date || "").slice(0, 10) > addDays(statementDate, -3) && chance(0.5)));
    const opening = Number(view.data?.cleared_balance ?? view.data?.opening_balance ?? 0);
    const bal = round2(opening + sum(cleared, (l) => Number(l.debit || 0) - Number(l.credit || 0)));
    await T("ACCOUNTANT").post("/company/accounting/reconcile", { account_id: M.acc.bank, statement_date: statementDate, statement_balance: bal, line_ids: cleared.map((l) => l.id) }, soft);
  };

  // =====================================================================================================
  // 7. the year
  // =====================================================================================================
  const reviewTexts = {
    5: [["Always reliable", "Delivered next day, everything well packed. Our best-selling line."], ["Great value", "Margins are good and customers keep coming back for it."], ["Exactly as listed", "Arrived on time, correct quantities, long expiry dates."], ["Top seller in our store", "Reordering every week."]],
    4: [["Good product", "Sells well. One case had a crushed corner but nothing inside was damaged."], ["Solid", "Good price for the quantity. Would like more flavours."], ["Happy with it", "Delivery took a day longer than usual but product is great."]],
    3: [["OK", "Sells slowly in our area. Fine quality."], ["Average", "Packaging changed and customers noticed."]],
    2: [["Short dated", "Expiry was only a few months out. Support sorted it quickly though."]],
    1: [["Not for us", "Arrived damaged and took a while to get credited."]],
  };
  const sellerTexts = [["Great supplier", "Easy ordering, fast delivery and helpful sales team."], ["Dependable", "Orders are always complete and invoices are clear."], ["Good terms", "Net 30 terms helped us a lot. Recommended."], ["Fast and friendly", "Driver is always on time and helpful."]];
  const replies = ["Thank you for the kind words! We look forward to your next order.", "Thanks for the feedback. We've passed this on to our warehouse team.", "We're sorry about that. Your account manager will reach out today.", "Thanks! New flavours are arriving next month."];

  const quotes = [];
  const rfqs = [];
  const returns = [];
  const recurring = [];
  const subAccounts = [];
  M.promos = [];
  const promo = async (company, code, body, from, to) => {
    const who = company.key === "meridian" ? T("SALES") : company.co;
    const r = await who.post("/company/promotions", { code, ...body, starts_at: new Date(at(from, -12 * 60)).toISOString(), ends_at: new Date(at(to, 12 * 60)).toISOString(), is_active: true, show_on_storefront: true }, soft);
    if (r) (company.promos ||= []).push({ id: r.data.id, code, from, to, min: body.min_order_amount || 0 });
  };
  let nextHire = 0;
  let laterIdx = 0;
  const staffLeaving = employees.find((e) => e.s[0] === "Jordan");

  for (let d = 26; d <= LAST; d++) {
    const date = dateStr(d);
    const work = isWorkday(d) && !holidaySet.has(date);
    // ---- seasonal promotions
    if (d === 27) {
      await promo(M, "WELCOME10", { description: "10% off your first order with Meridian", type: "percent", value: 10, min_order_amount: 200, max_uses_per_customer: 1 }, 27, LAST + 60);
      await promo(W.companies.harbor, "GLOW15", { description: "15% off orders over $300", type: "percent", value: 15, min_order_amount: 300 }, 27, 120);
      await promo(W.companies.voltedge, "FREESHIP", { description: "Free shipping on $250+", type: "free_shipping", value: 0, min_order_amount: 250 }, 27, LAST + 30);
    }
    for (const [code, desc, type, value, min, mFrom, mTo] of [["BLACKFRIDAY12", "Black Friday: 12% off everything", "percent", 12, 250, "11-24", "12-01"], ["HOLIDAY50", "$50 off holiday stock-up orders over $800", "fixed", 50, 800, "12-01", "12-20"], ["SPRING25", "$25 off orders over $500", "fixed", 25, 500, "03-15", "04-30"], ["SUMMER8", "8% off summer drinks & water", "percent", 8, 300, "06-01", "08-31"], ["BACK2SCHOOL", "10% off back-to-school orders", "percent", 10, 250, "07-20", "09-10"]]) {
      if (date.slice(5) === mFrom) {
        const to = Math.min(LAST + 10, dayIndexOf(`${date.slice(0, 4)}-${mTo}`));
        const company = code === "BACK2SCHOOL" ? W.companies.paperline : M;
        await promo(company, code, { description: desc, type, value, min_order_amount: min }, d, to);
      }
    }
    // ---- buyers join over time
    for (const [i, b] of C.BUYERS.entries()) if (buyerDays[i] === d) {
      const buyer = await onboardBuyer(b, i);
      if (buyer.kind === "vape") {
        setDay(d, 540);
        await cn.post("/company/customers", { email: buyer.email }, soft);
        await cn.post("/company/compliance/licenses", { email: buyer.email, state: buyer.state, license_number: `${buyer.state}-TOB-${int(100000, 999999)}`, expires_on: addDays(date, 365 + int(0, 200)), notes: "Copy on file" }, soft);
      }
      if (i === 0 || i === 4 || i === 12) {
        setDay(d, int(300, 500));
        const sub = { email: `${pick(["store", "manager", "buyer"])}.${slugify(buyer.first)}${i}@${slugify(buyer.business)}.example.com`, firstName: pick(["Ravi", "Jess", "Carlos", "Dana"]), lastName: buyer.last };
        await buyer.c.post("/account/add-subaccount", { ...sub, password: PASSWORD, canPlaceOrder: true }, soft);
        const sc = await login(sub.email).catch(() => null);
        if (sc) {
          await sc.post("/address", { full_name: `${sub.firstName} ${sub.lastName}`, company: buyer.business, address_line1: buyer.street, city: buyer.city, state: buyer.state, postal_code: buyer.zip, country: "USA", is_default: true }, soft);
          const a = await sc.get("/address", soft);
          subAccounts.push({ buyer, c: sc, addr: (a?.data || a || [])[0]?.id });
        }
      }
    }
    // ---- payment terms after a few orders
    for (const b of W.buyers) if (!b.termsChecked && b.joined + 25 <= d && W.orders.some((o) => o.buyer === b && o.company === "meridian")) {
      setDay(d, int(60, 200));
      b.termsChecked = true;
      await onboardTerms(b);
    }

    if (work) {
      // ---- the morning: warehouse moves orders along, receives purchase orders
      setDay(d, int(0, 90));
      await advanceOrders(d);
      for (const po of openPos.filter((x) => !x.done && x.due <= d)) { setDay(d, int(60, 200)); await receivePO(po, d); }

      // ---- new orders through the day
      for (const b of W.buyers) {
        if (b.next > d) continue;
        setDay(d, int(120, 520));
        const via = subAccounts.find((s) => s.buyer === b && chance(0.3));
        await placeOrder(b, d, { client: via?.c, addr: via?.addr });
        b.next = d + Math.max(2, Math.round(b.every * (0.6 + rnd() * 0.8) * (1.2 - (d / LAST) * 0.55)));
      }
      // ---- an afternoon round of confirmations
      setDay(d, int(420, 520));
      await advanceOrders(d);

      // ---- purchasing: twice a week Nina's team re-orders what's low
      if (dow(d) === 1 || dow(d) === 4) {
        setDay(d, int(200, 300));
        const stock = await avail(M.id, M.wh.main);
        const incoming = new Set(openPos.filter((x) => !x.done).flatMap((x) => x.lines.map((l) => `${l.p.id}|${l.flavor || ""}`)));
        // units sold per day over the last four weeks
        const sold = new Map((await q(`SELECT oi.product_id, coalesce(oi.flavor, '') AS f, sum(oi.quantity) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.company_id = $1 AND o.status <> 'cancelled' AND o.created_at >= $2 GROUP BY 1, 2`, [M.id, new Date(at(d, 0) - 28 * DAY)])).map((r) => [`${r.product_id}|${r.f}`, Number(r.n) / 28]));
        const need = {};
        for (const p of M.products) for (const k of p.variants.length ? p.variants : [""]) {
          const a = stock.get(`${p.id}|${k}`) || 0;
          const rate = sold.get(`${p.id}|${k}`) || 0;
          const lead = W.vendors[p.vendor].lead + 4;
          const min = Math.max(p.reorder_point / (p.variants.length ? 2 : 1), rate * (lead + 7));
          if (a <= min && !incoming.has(`${p.id}|${k}`)) (need[p.vendor] ||= []).push({ p, flavor: k, qty: Math.max(Math.ceil(p.reorder_qty / (p.variants.length ? 2 : 1)), Math.ceil(rate * 28)) });
        }
        for (const [code, lines] of Object.entries(need)) if (lines.length) await createPO(code, lines, d);
      }
      // ---- the other sellers restock when low (a stock count with new stock)
      if (dow(d) === 3) {
        for (const c of Object.values(W.companies).filter((x) => x.key !== "meridian")) {
          setDay(d, int(100, 400));
          const stock = await avail(c.id);
          for (const p of c.products) for (const k of p.variants.length ? p.variants : [""]) {
            if ((stock.get(`${p.id}|${k}`) || 0) < 8) {
              await c.co.post("/company/inventory/adjust", { warehouse_id: c.whMain, product_id: p.id, flavor: k || undefined, mode: "add", quantity: int(20, 45), reason: "other", notes: "Restock delivery", unit_cost: p.cost, lot_number: p.shelf ? `R${int(10000, 99999)}` : undefined, expiry_date: p.shelf ? ymd(at(d) + p.shelf * 30 * DAY) : undefined }, soft);
            }
          }
        }
      }
      // ---- accounts: bills, invoices, expenses
      setDay(d, int(300, 450));
      await payInvoices(d);
      for (const b of W.bills.filter((x) => !x.paid && x.due <= d + 2)) {
        const [row] = await q("SELECT total_amount - amount_paid - amount_credited AS due FROM bills WHERE id = $1", [b.id]);
        b.paid = true;
        if (!row || Number(row.due) <= 0.005) continue;
        await T("ACCOUNTANT").post(`/company/bills/${b.id}/payments`, { amount: round2(Number(row.due)), method: pick(["bank_transfer", "bank_transfer", "check"]), account_id: M.acc.bank, paid_at: dateStr(d), reference: `PMT-${int(10000, 99999)}` }, soft);
        b.paid = true;
      }
      if (dow(d) === 5) await expense(d, "Shell Fleet Card", M.acc.ship, int(520, 940) + rnd(), `FLEET-${date}`, "Weekly fuel for delivery vans", M.acc.card, "card");
      // ---- HR: attendance, leave
      setDay(d, int(480, 530));
      await attendance(d);
      if (chance(0.09)) {
        const e = pick(employees.filter((x) => !x.left && x.hire < date));
        const type = chance(0.65) ? leaveTypes["Annual leave"] : chance(0.7) ? leaveTypes["Sick leave"] : leaveTypes["Unpaid leave"];
        const start = addDays(date, type === leaveTypes["Sick leave"] ? 0 : int(5, 30));
        const len = type === leaveTypes["Sick leave"] ? int(0, 1) : int(0, 4);
        let end = addDays(start, len);
        if (end.slice(0, 4) !== start.slice(0, 4)) end = `${start.slice(0, 4)}-12-31`;
        const r = await HR.post("/company/hr/leave", { employee_id: e.id, leave_type_id: type.id, start_date: start, end_date: end, reason: type === leaveTypes["Sick leave"] ? "Flu" : pick(["Family trip", "Personal", "Moving house", "Wedding"]) }, soft);
        if (r?.data) {
          clock.advance(int(2, 30) * 3600000);
          if (chance(0.88) || type === leaveTypes["Sick leave"]) await T("MANAGER").post(`/company/hr/leave/${r.data.id}/approve`, {}, soft);
          else if (d < LAST - 10) await T("MANAGER").post(`/company/hr/leave/${r.data.id}/reject`, { notes: "Peak season, please pick other dates" }, soft);
        }
      }
      // ---- inventory housekeeping
      if (dow(d) === 2) {
        setDay(d, int(450, 520));
        const W2 = T("WAREHOUSE");
        for (const p of shuffle(M.products).slice(0, 4)) {
          const k = p.variants.length ? pick(p.variants) : undefined;
          const [lv] = await q("SELECT on_hand FROM inventory_levels WHERE warehouse_id = $1 AND product_id = $2 AND flavor = $3", [M.wh.main, p.id, k || ""]);
          if (!lv || lv.on_hand < 3) continue;
          const diff = chance(0.7) ? 0 : pick([-2, -1, -1, 1]);
          if (chance(0.5)) await W2.post("/company/scan/count", { warehouse_id: M.wh.main, lines: [{ product_id: p.id, flavor: k, counted: lv.on_hand + diff }], notes: "Weekly cycle count" }, soft);
          else await W2.post("/company/inventory/adjust", { warehouse_id: M.wh.main, product_id: p.id, flavor: k, mode: "set", quantity: lv.on_hand + diff, reason: "stock_count", notes: "Weekly cycle count" }, soft);
        }
        if (chance(0.3)) {
          const p = pick(M.products);
          const k = p.variants.length ? pick(p.variants) : undefined;
          await W2.post("/company/inventory/adjust", { warehouse_id: M.wh.main, product_id: p.id, flavor: k, mode: "remove", quantity: 1, reason: "damaged", notes: "Forklift damage" }, soft);
        }
      }
      // ---- keep the satellite warehouses stocked (transfers)
      if (dow(d) === 3 && d > 40) {
        setDay(d, int(200, 300));
        for (const target of [M.wh.phl, M.wh.hfd]) {
          const items = [];
          for (const p of shuffle(M.products).slice(0, 8)) {
            const k = p.variants.length ? pick(p.variants) : "";
            const [lv] = await q("SELECT on_hand - reserved AS a FROM inventory_levels WHERE warehouse_id = $1 AND product_id = $2 AND flavor = $3", [M.wh.main, p.id, k]);
            const [there] = await q("SELECT on_hand FROM inventory_levels WHERE warehouse_id = $1 AND product_id = $2 AND flavor = $3", [target, p.id, k]);
            if (lv && lv.a > Math.max(30, p.reorder_point * 3) && (!there || there.on_hand < 8)) items.push({ product_id: p.id, flavor: k || undefined, quantity: int(4, 8) });
          }
          if (!items.length) continue;
          const t = await T("WAREHOUSE").post("/company/inventory/transfers", { from_warehouse_id: M.wh.main, to_warehouse_id: target, items, in_transit: true, expected_date: dateStr(d + 1), carrier: "Meridian fleet", notes: "Weekly replenishment" }, soft);
          if (t?.data) W.transfers = [...(W.transfers || []), { id: t.data.id, due: d + 1 }];
        }
      }
      for (const t of (W.transfers || []).filter((x) => !x.done && x.due <= d)) {
        setDay(d, int(60, 120));
        await T("WAREHOUSE").post(`/company/inventory/transfers/${t.id}/receive`, {}, soft);
        t.done = true;
      }
    }

    // ---- month end & start
    const tomorrow = dateStr(d + 1);
    if (tomorrow.slice(8) === "01") {
      const ym = date.slice(0, 7);
      setDay(d, 560);
      await T("ACCOUNTANT").post("/company/accounting/journal", { entry_date: date, memo: `Depreciation ${ym}`, lines: [{ account_id: M.acc.other, debit: 1355, description: "Vehicles & equipment" }, { account_id: accounts.find((a) => a.code === "1590").id, credit: 1355 }] }, soft);
      await T("ACCOUNTANT").post("/company/accounting/journal", { entry_date: date, memo: `Van loan payment ${ym}`, lines: [{ account_id: M.acc.loan, debit: 850 }, { account_id: M.acc.other, debit: 190, description: "Interest" }, { account_id: M.acc.bank, credit: 1040 }] }, soft);
    }
    if (date.slice(8) === "01" && d > 26) {
      const prev = dateStr(d - 1).slice(0, 7);
      setDay(d, int(10, 60));
      await expense(d, "Port Logistics Properties LLC", M.acc.rent, 9800, `RENT-${date.slice(0, 7)}`, "Warehouse & office rent, Newark");
      await expense(d, "Delaware Valley Storage", M.acc.rent, 2600, `RENT-PHL-${date.slice(0, 7)}`, "Philadelphia cross-dock");
      await expense(d, "Brainard Road Realty", M.acc.rent, 1400, `RENT-HFD-${date.slice(0, 7)}`, "Hartford depot");
      await expense(d, "NetSuite & Microsoft 365", M.acc.soft, 640, `SUB-${date.slice(0, 7)}`, null, M.acc.card, "card");
      // payroll for the month that just ended (first business days of the month)
      let pd = d; while (!isWorkday(pd)) pd++;
      setDay(pd, 120);
      if (dayIndexOf(`${prev}-01`) >= 0) await payroll(prev, pd);
      setDay(pd, 400);
      await reconcile(prev);
      // the platform bills its commission for last month
      W.admin && (await (async () => {
        clock.set(at(pd + 1, 100));
        for (const c of Object.values(W.companies)) {
          const st = await W.admin.post("/admin/commission/statements", { company_id: c.id, period_start: `${prev}-01`, period_end: monthEnd(prev), notes: `Commission ${prev}` }, soft);
          if (st?.data) (W.statements ||= []).push({ id: st.data.id, due: pd + int(6, 18) });
        }
      })());
    }
    if (d === 32) {
      setDay(d, 300);
      W.schedules = [];
      for (const [name, report, frequency, extra] of [["Weekly sales summary", "sales_summary", "weekly", { day_of_week: 1 }], ["Monthly P&L", "profit_loss", "monthly", { day_of_month: 2 }], ["Low stock alert", "low_stock", "daily", {}], ["AR aging (monthly)", "ar_aging", "monthly", { day_of_month: 1 }], ["Payroll summary", "payroll_summary", "monthly", { day_of_month: 3 }]]) {
        const r = await mco.post("/company/reports/schedules", { name, report, frequency, hour: 7, timezone: "America/New_York", recipients: [ctx.OWNER_EMAIL("meridian"), "marcus.bell@meridian-trade.example.com"], is_active: true, ...extra }, soft);
        if (r?.data) W.schedules.push({ id: r.data.id, frequency, ...extra });
      }
    }
    for (const sc of W.schedules || []) {
      const due = sc.frequency === "daily" ? work && chance(0.25) : sc.frequency === "weekly" ? dow(d) === sc.day_of_week : Number(date.slice(8)) === sc.day_of_month;
      if (due) { setDay(d, 0); await mco.post(`/company/reports/schedules/${sc.id}/run`, {}, soft); }
    }
    if (work && chance(0.04) && team.SALES) {
      const annual = leaveTypes["Annual leave"];
      setDay(d, int(100, 400));
      let start = addDays(date, int(10, 40));
      while ([0, 6].includes(new Date(`${start}T00:00:00Z`).getUTCDay())) start = addDays(start, 1);
      const r = await team[pick(["SALES", "WAREHOUSE", "ACCOUNTANT"])].post("/company/me/hr/leave", { leave_type_id: annual.id, start_date: start, end_date: addDays(start, int(0, 2)), reason: pick(["Long weekend", "Doctor's appointment", "Kids' school event"]) }, soft);
      if (r?.data?.id) { clock.advance(int(4, 30) * 3600000); await HR.post(`/company/hr/leave/${r.data.id}/approve`, {}, soft); }
    }
    if (date.slice(8) === "10" && d > 26) { setDay(d, 200); await expense(d, "PSE&G", M.acc.util, int(2100, 3600) + rnd(), `UTIL-${date.slice(0, 7)}`, "Electricity & gas, Newark DC"); await expense(d, "Verizon Business", M.acc.util, 389.5, `TEL-${date.slice(0, 7)}`, "Phones & internet"); }
    if (date.slice(8) === "15" && d > 40) {
      setDay(d, 300);
      const liab = await T("ACCOUNTANT").get("/company/payroll/liabilities", soft);
      for (const l of liab?.data || []) if (Number(l.balance) > 0 && l.id !== accounts.find((a) => a.code === "2310")?.id) {
        await T("ACCOUNTANT").post("/company/payroll/remittances", { account_id: l.id, paid_from_account_id: M.acc.bank, amount: round2(Number(l.balance)), paid_at: date, reference: `EFTPS-${date}` }, soft);
      }
    }
    if (["01-05", "04-05", "07-05", "10-05"].includes(date.slice(5)) && d > 26) { setDay(d, 250); await expense(d, "Hartford Mutual Insurance", M.acc.ins, 4860, `INS-Q-${date.slice(0, 7)}`, "Quarterly general liability & fleet insurance"); }
    if (date.slice(8) === "20" && chance(0.5) && d > 26) { setDay(d, 260); await expense(d, pick(["Staples", "Uline", "Office Depot"]), M.acc.office, int(180, 520) + rnd(), null, "Office & packing supplies", M.acc.card, "card"); }
    if (date.slice(8) === "25" && chance(0.4) && d > 26) { setDay(d, 270); await expense(d, pick(["Google Ads", "Meta Ads", "NACS trade show"]), M.acc.mkt, int(400, 2200), null, "Marketing", M.acc.card, "card"); }
    for (const st of (W.statements || []).filter((x) => !x.done && x.due <= d)) { setDay(d, 330); await W.admin.patch(`/admin/commission/statements/${st.id}`, { status: "paid", payment_reference: `STRIPE-${int(100000, 999999)}` }, soft); st.done = true; }

    if (!work) continue;
    // ---- quotes (requests from buyers, quotes from the sales team)
    if (chance(0.16)) {
      const b = pick(W.buyers.filter((x) => x.sellers.meridian));
      if (b) {
        setDay(d, int(100, 300));
        const items = pickProducts(M, int(2, 5)).map((p) => ({ product_id: p.id, flavor: p.variants.length ? pick(p.variants) : undefined, quantity: int(6, 18) }));
        const r = await b.c.post("/account/quotes", { company_id: M.id, items, notes: pick(["Pricing for a bulk order, please", "We're opening a second store and need a starter order", "Can you beat our current supplier?", "Monthly volume quote please"]) }, soft);
        if (r?.data) quotes.push({ id: r.data.id, buyer: b, step: "price", next: d + int(0, 2), company: M });
      }
    }
    if (chance(0.06)) {
      const b = pick(W.buyers.filter((x) => x.sellers.meridian));
      if (b) {
        setDay(d, int(200, 400));
        const items = pickProducts(M, int(3, 6)).map((p) => ({ product_id: p.id, flavor: p.variants.length ? pick(p.variants) : undefined, quantity: int(6, 20), unit_price: round2(p.price * (0.88 + rnd() * 0.06)) }));
        const r = await T("SALES").post("/company/quotes", { customer_email: b.email, items, notes: "As discussed on the phone. Prices held for 21 days.", send: true }, soft);
        if (r?.data) quotes.push({ id: r.data.id, buyer: b, step: "answer", next: d + int(1, 5), company: M });
      }
    }
    for (const qt of quotes.filter((x) => !x.done && x.next <= d)) {
      setDay(d, int(150, 450));
      if (qt.step === "price") {
        const full = (await T("SALES").get(`/company/quotes/${qt.id}`)).data;
        const items = (full.quote_items || full.items || []).map((i) => ({ product_id: i.product_id, flavor: i.flavor || undefined, quantity: i.quantity, unit_price: round2(Number(i.unit_price) * (0.9 + rnd() * 0.05)) }));
        await T("SALES").patch(`/company/quotes/${qt.id}`, { items, notes: "Volume pricing applied. Free delivery on this order.", shipping_amount: 0 }, soft);
        await T("SALES").post(`/company/quotes/${qt.id}/send`, {}, soft);
        qt.step = "answer"; qt.next = d + int(1, 4);
      } else if (qt.step === "answer") {
        const r = rnd();
        if (r < 0.5 || qt.countered) {
          let acc2 = await qt.buyer.c.post(`/account/quotes/${qt.id}/accept`, { shipping_address_id: qt.buyer.addr, payment_method: qt.buyer.terms[M.id] ? "on_account" : "cash_on_delivery" }, soft);
          if (!acc2 && qt.buyer.terms[M.id]) acc2 = await qt.buyer.c.post(`/account/quotes/${qt.id}/accept`, { shipping_address_id: qt.buyer.addr, payment_method: "cash_on_delivery" }, soft);
          const oid = acc2?.data?.order?.id || acc2?.order?.id || acc2?.data?.order_id;
          if (oid) { const rec = { id: oid, company: "meridian", buyer: qt.buyer, placed: d, next: d + 1, step: "confirm", onAccount: !!qt.buyer.terms[M.id] }; pipeline.push(rec); W.orders.push(rec); stats.orders++; }
          qt.done = true;
        } else if (r < 0.7) {
          const full = (await qt.buyer.c.get(`/account/quotes/${qt.id}`)).data;
          const items = full.quote_items || full.items || [];
          await qt.buyer.c.post(`/account/quotes/${qt.id}/counter`, { lines: items.slice(0, 2).map((i) => ({ item_id: i.id, unit_price: round2(Number(i.unit_price) * 0.95) })), message: "Can you do 5% better on these two? Then we have a deal." }, soft);
          qt.countered = true; qt.step = "counter"; qt.next = d + int(1, 2);
        } else if (r < 0.85) {
          await qt.buyer.c.post(`/account/quotes/${qt.id}/decline`, { reason: pick(["Found a better price", "Budget was cut", "Ordering later this year"]) }, soft);
          qt.done = true;
        } else qt.done = true; // no answer: expires
      } else if (qt.step === "counter") {
        const full = (await T("SALES").get(`/company/quotes/${qt.id}`)).data;
        const msg = [...(full.quote_messages || full.messages || [])].reverse().find((m) => m.author_side === "customer" && m.proposal);
        if (msg && chance(0.75)) await T("SALES").post(`/company/quotes/${qt.id}/apply-counter`, { message_id: msg.id }, soft);
        else await T("SALES").post(`/company/quotes/${qt.id}/messages`, { body: "We can do 3% on those two, that's our best price." }, soft);
        await T("SALES").post(`/company/quotes/${qt.id}/send`, { override_margin: true }, soft);
        qt.step = "answer"; qt.next = d + int(1, 3);
      }
    }
    // ---- RFQs to several sellers
    if (chance(0.035) && d > 60) {
      const b = pick(W.buyers);
      const sellers = Object.keys(b.sellers).slice(0, 3).map((k) => W.companies[k]);
      setDay(d, int(100, 300));
      const prod = sellers.flatMap((s) => pickProducts(s, 1));
      const r = await b.c.post("/account/rfqs", { title: pick(["Restock for summer", "Holiday season order", "New store opening", "Quarterly bulk buy"]), notes: "Please quote delivered prices.", needed_by: dateStr(d + 14), company_ids: sellers.map((s) => s.id), items: [...prod.map((p) => ({ product_id: p.id, flavor: p.variants[0] || undefined, quantity: int(20, 60) })), { description: "Countertop display rack", quantity: 1 }] }, soft);
      if (r?.data) rfqs.push({ id: r.data.id, buyer: b, sellers, next: d + int(1, 3) });
    }
    for (const rf of rfqs.filter((x) => !x.done && x.next <= d)) {
      setDay(d, int(150, 450));
      const detail = (await rf.buyer.c.get(`/account/rfqs/${rf.id}`)).data;
      const qs = (detail.offers || []).map((o) => ({ id: o.quote_id, company_id: o.company?.id, status: o.status, total: o.total }));
      if (!rf.priced) {
        for (const qq of qs) {
          const company = Object.values(W.companies).find((c) => String(c.id) === String(qq.company_id));
          if (!company || chance(0.15)) continue;
          const who = company.key === "meridian" ? T("SALES") : company.co;
          const full = (await who.get(`/company/quotes/${qq.id}`, soft))?.data;
          if (!full) continue;
          const items = (full.items || full.quote_items || []).map((i) => ({ product_id: i.product_id || undefined, description: i.description, flavor: i.flavor || undefined, quantity: i.quantity, unit_price: i.product_id ? round2(Number(i.unit_price || 10) * (0.9 + rnd() * 0.08)) : int(35, 80) }));
          await who.patch(`/company/quotes/${qq.id}`, { items, notes: "Delivered price, valid 14 days" }, soft);
          await who.post(`/company/quotes/${qq.id}/send`, { override_margin: true }, soft);
        }
        rf.priced = true; rf.next = d + int(1, 4);
      } else {
        const sent = qs.filter((x) => x.status === "sent");
        if (sent.length && chance(0.75)) {
          const best = sent.sort((a, b) => Number(a.total) - Number(b.total))[0];
          const r = await rf.buyer.c.post(`/account/rfqs/${rf.id}/award`, { quote_id: best.id, shipping_address_id: rf.buyer.addr }, soft);
          const oid = r?.data?.order?.id || r?.order?.id || r?.data?.order_id;
          const company = Object.values(W.companies).find((c) => String(c.id) === String(best.company_id));
          if (oid && company) { const rec = { id: oid, company: company.key, buyer: rf.buyer, placed: d, next: d + 1, step: "confirm" }; pipeline.push(rec); W.orders.push(rec); stats.orders++; }
        } else await rf.buyer.c.post(`/account/rfqs/${rf.id}/cancel`, {}, soft);
        rf.done = true;
      }
    }
    // ---- after delivery: reviews, problem reports, returns
    for (const o of afterDelivery.splice(0)) {
      const company = W.companies[o.company];
      const bc = o.client || o.buyer.c;
      if (chance(0.22)) {
        setDay(Math.min(LAST, d), int(300, 530));
        const items = await q("SELECT product_id FROM order_items WHERE order_id = $1", [o.id]);
        const stars = weighted({ 5: 55, 4: 28, 3: 10, 2: 4, 1: 3 });
        const [title, body] = pick(reviewTexts[stars]);
        o.buyer.reviewed ||= new Set();
        const candidates = items.filter((it) => !o.buyer.reviewed.has(String(it.product_id)));
        const target = candidates.length ? pick(candidates).product_id : null;
        if (target) o.buyer.reviewed.add(String(target));
        const r = target ? await bc.post("/account/reviews", { product_id: target, rating: Number(stars), title, body }, soft) : null;
        if (r?.data && (Number(stars) <= 3 || chance(0.35))) {
          clock.advance(int(3, 30) * 3600000);
          await (company.key === "meridian" ? T("SALES") : company.co).post(`/company/reviews/${r.data.id}/reply`, { reply: pick(replies) }, soft);
        }
      }
      if (chance(0.07) && !(o.buyer.reviewedSellers ||= new Set()).has(company.key)) {
        o.buyer.reviewedSellers.add(company.key);
        const [title, body] = pick(sellerTexts);
        await bc.post("/account/reviews", { company_id: company.id, rating: pick([5, 5, 4]), title, body }, soft);
      }
      if (company.key === "meridian" && chance(0.07)) {
        setDay(Math.min(LAST, d), int(200, 500));
        const lines = (await bc.get(`/account/orders/${o.id}/returnable`, soft))?.data || [];
        const line = lines.find((l) => (l.returnable ?? l.max ?? l.quantity) > 0);
        if (line) {
          const r = await bc.post("/account/returns", { order_id: o.id, reason: pick(["damaged", "damaged", "expired", "wrong_item", "not_as_described"]), notes: pick(["Two cases crushed in transit", "Short-dated stock", "Received the wrong flavour", "Seal broken on arrival"]), items: [{ order_item_id: line.order_item_id || line.id, quantity: Math.max(1, Math.min(2, line.returnable ?? line.quantity)) }] }, soft);
          if (r?.data) returns.push({ id: r.data.id, next: d + int(1, 2), step: "approve", order: o });
        }
      }
      if (chance(0.012)) {
        await bc.post("/account/reports", { kind: "order", order_id: o.id, reason: pick(["damaged", "wrong_items", "not_received"]), details: "Driver left the pallet outside, two cases were wet." }, soft);
      }
    }
    for (const r of returns.filter((x) => !x.done && x.next <= d)) {
      setDay(d, int(100, 400));
      if (r.step === "approve") {
        if (chance(0.15)) { await T("SALES").post(`/company/returns/${r.id}/reject`, { staff_notes: "Photos show the damage happened after delivery" }, soft); r.done = true; continue; }
        await T("SALES").post(`/company/returns/${r.id}/approve`, { warehouse_id: M.wh.main, staff_notes: "Driver will collect on next delivery" }, soft);
        r.step = "receive"; r.next = d + int(2, 6);
      } else if (r.step === "receive") {
        const full = (await T("WAREHOUSE").get(`/company/returns/${r.id}`)).data;
        await T("WAREHOUSE").post(`/company/returns/${r.id}/receive`, { warehouse_id: M.wh.main, items: (full.return_items || full.items || []).map((i) => ({ id: i.id, quantity_received: i.quantity, condition: chance(0.6) ? "damaged" : "resellable" })) }, soft);
        r.step = "resolve"; r.next = d + int(0, 2);
      } else {
        await T("SALES").post(`/company/returns/${r.id}/resolve`, { resolution: r.order.onAccount ? "credit_invoice" : "refund", staff_notes: "Credited in full" }, soft);
        r.done = true;
      }
    }
    // ---- recurring orders: a few regulars automate their weekly restock
    if (d === 70 || d === 110 || d === 160 || d === 220) {
      for (const b of W.buyers.filter((x) => x.sellers.meridian && !x.recurring).slice(0, 2)) {
        setDay(d, int(200, 400));
        const last = W.orders.filter((o) => o.buyer === b && o.company === "meridian").pop();
        if (!last) continue;
        const frequency = pick(["weekly", "biweekly", "biweekly"]);
        const r = await b.c.post("/account/recurring-orders", { name: `${pick(["Weekly", "Regular", "Standing"])} restock`, from_order_id: last.id, frequency, day_of_week: pick([1, 2, 3]), mode: "auto", shipping_address_id: b.addr, payment_methods: b.terms[M.id] ? { [M.id]: "on_account" } : {} }, soft);
        if (r?.data) { b.recurring = true; recurring.push({ id: r.data.id, buyer: b, frequency, next: dayIndexOf(String(r.data.next_run_on).slice(0, 10)) }); b.every = Math.round(b.every * 1.6); }
      }
    }
    for (const ro of recurring.filter((x) => x.next <= d)) {
      setDay(d, 30);
      const r = await ro.buyer.c.post(`/account/recurring-orders/${ro.id}/run`, {}, soft);
      for (const num of r?.data?.order_numbers || []) {
        const [o] = await q("SELECT id, payment_method FROM orders WHERE order_number = $1", [num]);
        if (o) { const rec = { id: o.id, company: "meridian", buyer: ro.buyer, placed: d, next: d + 1, step: "confirm", onAccount: o.payment_method === "on_account" }; pipeline.push(rec); W.orders.push(rec); stats.orders++; }
      }
      ro.next = d + (ro.frequency === "biweekly" ? 14 : 7);
      // "run now" leaves the schedule alone; keep the stored next date in step with the simulated calendar
      await q("UPDATE recurring_orders SET next_run_on = $1 WHERE id = $2", [dateStr(ro.next), ro.id]);
      if (d > LAST - 50 && chance(0.1)) { await ro.buyer.c.patch(`/account/recurring-orders/${ro.id}`, { status: "paused" }, soft); ro.next = 1e9; }
    }
    // ---- staff changes
    if (laterIdx < laterHires.length) {
      const [s, i] = laterHires[laterIdx];
      const hireDay = dayIndexOf(ymd(clock.realNow() - s[5] * 30.4 * DAY));
      if (d >= hireDay) { setDay(d, 60); await createEmployee(s, i); laterIdx++; }
    }
    if (staffLeaving && !staffLeaving.left && d === LAST - 60) {
      setDay(d, 300);
      await HR.post(`/company/hr/employees/${staffLeaving.id}/terminate`, { termination_date: dateStr(d + 14), reason: "Resigned, moving to Florida" }, soft);
      staffLeaving.left = dateStr(d + 14);
    }
    // ---- supplier returns & vendor credits
    if (chance(0.03) && d > 50) {
      const p = pick(M.products.filter((x) => x.shelf));
      const v = W.vendors[p.vendor];
      setDay(d, int(200, 400));
      const r = await T("MANAGER").post("/company/supplier-returns", { supplier_id: v.id, warehouse_id: M.wh.main, reason: pick(["damaged", "expired", "defective", "recall"]), notes: pick(["Damaged in transit", "Short-dated stock", "Recalled lot"]) + ". RMA approved by vendor", items: [{ product_id: p.id, flavor: p.variants[0] || undefined, quantity: int(2, 6) }] }, soft);
      if (r?.data) {
        await T("WAREHOUSE").post(`/company/supplier-returns/${r.data.id}/ship`, { email: true }, soft);
        clock.advance(int(3, 9) * DAY / 3);
        const full = (await T("MANAGER").get(`/company/supplier-returns/${r.data.id}`, soft))?.data;
        if (full) await T("MANAGER").post(`/company/supplier-returns/${r.data.id}/credit`, { credit_amount: round2(Number(full.total_value || full.value || p.cost * 3)), credit_reference: `CM-${int(10000, 99999)}` }, soft);
      }
    }
    if (["03-31", "06-30", "09-30", "12-31"].includes(date.slice(5))) {
      setDay(d, 300);
      await T("ACCOUNTANT").post("/company/vendor-credits", { supplier_id: W.vendors.VBG.id, amount: int(600, 1400), account_id: M.acc.cogs, reference: `REBATE-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`, notes: "Quarterly volume rebate" }, soft);
    }
    // ---- apply open vendor credits to the next bill
    if (dow(d) === 1) {
      const credits = await q("SELECT id, supplier_id FROM vendor_credits WHERE company_id = $1 AND amount - amount_applied > 0.005", [M.id]).catch(() => []);
      for (const vc of credits) {
        const [bill] = await q("SELECT id FROM bills WHERE company_id = $1 AND supplier_id = $2 AND status <> 'void' AND total_amount - amount_paid - amount_credited > 0.005 ORDER BY due_date LIMIT 1", [M.id, vc.supplier_id]);
        if (bill) { setDay(d, 350); await T("ACCOUNTANT").post(`/company/vendor-credits/${vc.id}/apply`, { bill_id: bill.id }, soft); }
      }
    }
    // ---- browsing (marketplace analytics). Written straight to the events table: these are page views,
    // not business records, and the API would only store the same rows one request at a time.
    {
      const views = Math.round((60 + (d / LAST) * 120) * (0.7 + rnd() * 0.6) * (work ? 1 : 0.55));
      const ev = [];
      for (let k = 0; k < views; k++) {
        const p = pick(W.products);
        const visitor = require("crypto").createHash("sha256").update(`demo-visitor-${int(1, 2500)}`).digest("hex").slice(0, 64);
        const when = new Date(at(d, int(-180, 780)));
        const r = rnd();
        if (r < 0.62) ev.push([visitor, "product_view", W.companies[p.company].id, p.id, null, chance(0.55), when]);
        else if (r < 0.8) ev.push([visitor, "storefront_view", W.companies[p.company].id, null, null, chance(0.5), when]);
        else if (r < 0.93) ev.push([visitor, "search_impression", W.companies[p.company].id, null, pick([p.brand, p.title.split(" ").slice(1, 3).join(" "), W.cats[p.sub]?.name || p.brand]).toLowerCase(), chance(0.5), when]);
        else ev.push([visitor, "add_to_cart", W.companies[p.company].id, p.id, null, true, when]);
      }
      if (ev.length) await q(`INSERT INTO analytics_events (visitor, kind, company_id, product_id, query, is_buyer, created_at) VALUES ${ev.map((_, i) => `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7})`).join(", ")}`, ev.flat());
    }
    if (d % 30 === 0) log(`day ${d}: ${stats.orders} orders, ${W.buyers.length} buyers, ${quotes.length} quotes, ${returns.length} returns, ${stats.soft} skipped`);
  }

  // =====================================================================================================
  // 8. storefronts, collections, report schedules, wish lists... (as they look today)
  // =====================================================================================================
  setDay(LAST, 100);
  const finishOrders = pipeline.filter((x) => !x.done).length;
  log(`orders still open at the end: ${finishOrders}`);
  ctx.extra = { quotes, rfqs, returns, recurring, subAccounts, employees, team, bins };
  await require("./finish")(ctx);
};
