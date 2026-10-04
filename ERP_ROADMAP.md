# Wholesale marketplace → multi-company ERP

The platform is a **multi-tenant marketplace**:
- **Companies** are tenants. Each company owns its staff, brands, products, orders, and in later phases its
  warehouses, suppliers, books and payroll.
- **Customers** browse every active company, buy from several in one cart, and the checkout splits the cart
  into one order per company.
- **Platform admins** approve and suspend companies and move brands between them.

| Phase | Scope | Status |
|---|---|---|
| 1 | Email, password reset/verification, multi-tenancy, roles & permissions, invitations, company back office, split checkout, audit log | ✅ Done |
| 2 | Supply chain: suppliers, purchase orders, warehouses & bins, stock per flavour, receiving with landed costs, transfers (instant or in transit), adjustments, reorder alerts, batch/expiry, pick-pack-ship, returns to suppliers | ✅ Done |
| 3 | Sales: customer groups & price lists, credit limits & terms, quotes → orders, PDF invoices, credit notes, returns (RMA), promo codes | ✅ Done |
| 4 | Accounting: chart of accounts, double-entry general ledger auto-posted from sales, purchases, stock and payments, AR & AP (invoices, bills, supplier credits, payments, aging), expenses, bank reconciliation, closing periods; reports (P&L, balance sheet, trial balance, cash flow, general ledger) | ✅ Done |
| 5 | HR & payroll: employees, departments, attendance, holidays, leave (requests, approvals, balances), configurable allowances/deductions/employer contributions, income-tax brackets, payroll runs, payslip PDFs, self-service "My HR", posted to the GL | ✅ Done |

All five phases are built, plus the operations add-ons (KPIs, notifications, CSV, scanning, tobacco compliance, scheduled reports). Roles and permissions cover every module: `inventory.*`, `purchasing.*`, `accounting.*`, `hr.*` and `payroll.*`.

---

## Operations add-ons: KPIs, notifications, CSV, scanning, tobacco compliance, scheduled reports

None of these use an outside service:
- Emails go through your existing SMTP.
- Scanners act as a keyboard, and the phone camera uses the browser's built-in barcode reader.
- Tax rules are entered by each company.
- The scheduler runs inside the API.

### Admin dashboard with KPIs (`/admin` → Overview)
- **Headline numbers** for the last 7, 30 or 90 days or a year, each compared with the period before:
  - sales (GMV), orders, average order
  - buying customers, repeat-buyer rate, cancellation rate
  - new sign-ups and new companies
- **A sales-per-day chart** (hover a bar for the day's sales and orders).
- **Top companies and products**, orders by status, companies waiting for approval, and email health over the last 7 days (sent, pending, failed).

### Notifications centre
- **A bell** in the header with an unread count (it refreshes every minute and when you return to the tab), a drop-down of the latest items, and a full page at `/notifications`.
- **Every email sent to a registered user also lands in their bell.** This covers:
  - new orders, order status changes, invoices, payments and credit notes
  - quotes and returns
  - low stock
  - leave requests and decisions, payslips
  - company approval and scheduled reports
- **In-app only:** payroll approved (ready to pay) and leave requests (to HR).
- **Daily alerts** (sent once a day, never repeated):
  - overdue invoices
  - bills due within 3 days
  - stock lots expiring within 30 days
  - customer tobacco licences expiring or expired
- Clicking a notification opens the right page, switching to the right company first.

### CSV import & export (Company → Import & export)
- **Export:** products, stock levels, customers (with licences), orders, order lines, invoices, suppliers, employees (pay details only for payroll roles), and journal lines. Orders, order lines, invoices and journal take a date range.
- **Import:** products (matched by SKU), stock counts per warehouse, suppliers, employees, and customers (with group, terms and tobacco licence).
  - **Check file** first: every row is validated and errors are listed by line number.
  - **Nothing is imported until the whole file is clean**, then it's applied all at once.
  - Stock imports post their differences to the books.
  - Templates can be downloaded. Spreadsheet formulas are neutralised in exports.

### Barcode / SKU scanning (Inventory → Scan station)
- Works with **USB or Bluetooth scanners**, which type the code and press Enter, with **phone cameras** (Chrome / Android), or by typing a SKU. It beeps on each scan.
- **Look up:** stock per warehouse and flavour, plus lots and bins in pick order.
- **Stock count:** scan items in one warehouse, adjust the counts, then save. Only the items you scanned are set to the counted quantity, and differences post to the books.
- **Pick & pack:** choose a confirmed order and scan each item. It flags wrong or extra items, shows state compliance warnings, then **Verify & ship** (with a tracking number). Verified packs are written to the activity log.
- **Receive:** choose a purchase order, scan what arrived, and receive it.

### Per-state tobacco tax & compliance (Sales → Tobacco compliance)
- **Each product gets a compliance category:** cigarettes, cigars, smokeless, pipe tobacco, vapor closed or open system, e-liquid, nicotine pouches, or other. It also records ml of liquid per unit and whether it's flavored. Set these on the product form or by CSV.
- **State rules** apply to one category, or to all regulated products in a state:
  - excise tax as a % of the wholesale price, per ml, or per unit
  - flavor ban
  - tobacco licence required
  - shipping banned
  - adult signature / age check (21+)
  - include in the state shipment report
- **Checkout follows the delivery address:**
  - excise tax is added per seller
  - banned products, missing or expired licences, and banned states block the order with a clear message
  - accepted quotes are checked the same way
- **Orders, invoices and their PDFs show the excise tax.** Order, packing-slip and pack-screen warnings show the age-check and reporting flags.
- **In the books:** excise posts to the new **Excise tax payable** account.
- **Customer licences:** each has a state, number and expiry, with alerts before it expires.
- **Reports:**
  - excise collected by state and category
  - a shipment report (customer, address, licence, product, quantity, value) for states marked for reporting, the information PACT Act-style monthly filings ask for
- **You enter the rules:** the system ships with none, so check current state law.

### Scheduled reports by email (Company → Reports)
- **Run any report now**, either as a preview or a CSV:
  - sales summary, sales by product
  - customers owing, bills to pay
  - low stock, stock valuation, expiring lots
  - profit & loss
  - excise by state, regulated shipments
  - payroll summary, attendance
- **Schedule any of them** daily (covers yesterday), weekly (the last 7 days) or monthly (last month), at a set hour in your time zone, to up to 20 email addresses.
  - The email has the key figures and the first 50 rows, with the full CSV attached.
  - Past reports can be downloaded again, and a schedule can be sent now, paused or deleted.
- Each report keeps its permission: you can only run or schedule reports your role can see.
- **The scheduler** checks every minute. Running several API servers is safe, because a due report is claimed once. Set `SCHEDULER_ENABLED=false` to turn it off on a server.

### Fixed along the way
- A Phase 2 test had a hard-coded expiry date that broke once that date passed.

### Verified
- 83 new API checks (`e2e-p7.mjs`). All earlier suites still pass: **738 API checks in total**.
- 8 new browser checks, **93 in total**, with no browser errors.

### Deploying
1. `npm run db:export` (backup), then `npm run db:migrate -- --dry`. It should list `007_operations.sql`.
2. `npm run db:migrate`. It **adds** 5 tables and new columns:
   - on products: compliance category (default "Not regulated"), ml, flavored
   - excise amount on orders, invoices and quotes
   - nothing existing is changed
3. `npx prisma generate`, then restart or deploy.
4. **Optional environment variables:**
   - `SCHEDULER_ENABLED=false` turns the scheduler off on a server.
   - `SCHEDULER_INTERVAL_MS` sets how often it checks (default 60000).
5. **Each company:**
   - set product compliance categories and its state rules
   - add customer licences where needed
   - schedule the reports it wants

### Known limits (possible later additions)
- Credit notes and returns don't refund excise automatically. Adjust it with a manual credit or journal entry.
- Rules are per state: there's no county or city tobacco tax.
- Camera scanning needs a browser with the built-in barcode reader (Chrome on Android). Desktop browsers use a scanner or typing.
- Notifications refresh every minute rather than instantly, and there are no per-user notification settings yet.

---

## Phase 5: HR & payroll

People, time and pay for each company. When accounting is set up, payroll posts to the books.

### Setting up (HR settings)
- **Departments**, each with an optional manager.
- **Pay components**, defined once:
  - **Allowances**: a fixed monthly amount, or a % of basic pay. Mark each one as taxable or not.
  - **Deductions**: a fixed amount, a % of basic, a % of gross, or the **income-tax table**.
  - **Employer contributions**: costs on top of pay, such as employer pension or social security.
  - A component can apply to **everyone** or only to the employees you switch it on for. Any employee can have their own amount or %.
- **Payroll settings:**
  - working days (Mon–Fri by default)
  - hours per day
  - overtime rate (1.5x by default)
  - **income-tax brackets**: yearly, progressive, like Pakistan's slab system
  - a note printed on payslips
- **Leave types:** Annual 14, Sick 8 and Unpaid are created for you. Each is paid or unpaid, with days per year.
- **Holidays:** these don't count as working days for pay or leave.

### Employees
- Profile, job, department, employment type, hire date, emergency contact, national ID and tax number.
- **Pay:** a monthly salary or an hourly rate, the payment method, and bank details.
- **Link a staff login** to give that person **My HR**: their payslips, leave balances and leave requests.
- **Mark as left** with a last working day: they're paid up to that day, then drop off later payrolls. They can be reinstated.
- Pay details are only visible to roles that can see payroll. Managers see profiles but not salaries.

### Attendance
- A **daily sheet** with present / absent / half day / holiday, check-in and check-out times (hours are worked out from them), overtime hours and notes.
- **"Mark the rest present"** fills in everyone not yet marked.
- A **summary** for any period: days present, absent, half days, paid and unpaid leave, hours and overtime.
- Leave appears automatically from approved leave requests. It can't be typed in by hand, so balances stay right.

### Leave
- Employees request leave in My HR. Managers and HR approve or decline it, and the employee gets an email.
- HR can also book leave directly.
- Weekends and holidays aren't counted. Half days are supported.
- A request can't go over the remaining allowance or overlap another request.
- **Balances** per employee and year: allowance, taken, pending and remaining.

### Payroll
1. **Run payroll** for a month. A draft payslip is made for everyone employed in that month:
   - **Salaried:** salary × days employed ÷ working days (so joiners and leavers are pro-rated), less **unpaid days** (absences, half days, unpaid leave) at salary ÷ working days.
   - **Hourly:** hours from attendance, plus paid leave at hours-per-day.
   - **Overtime:** hours × hourly rate × the overtime rate.
   - **Allowances:** fixed ones are pro-rated by paid days.
   - **Tax:** taxable pay × 12 is run through the brackets, then divided by 12.
   - Net pay = gross − deductions.
   - Warnings flag problems, such as no attendance for an hourly employee or negative net pay.
2. **Review and adjust.** Add one-off lines to any payslip (a bonus, commission or advance repayment). **Recalculate** picks up new attendance and salary changes and keeps the one-off lines.
3. **Approve.** Payslips are locked. With accounting on, the payroll posts to the books (dated the last day of the period):
   - Debit: Salaries & wages (gross) and Payroll taxes (employer contributions).
   - Credit: Payroll liabilities (deductions and employer contributions) and **Wages payable** (net).
   - Attendance and leave inside an approved payroll can't be changed any more.
4. **Mark as paid** from a bank or cash account: Wages payable / Bank. You can email every employee their **payslip PDF** at the same time.
   - A payment can be **undone**. An approved run can be **voided**, which reverses its entry so the month can be run again.
5. **Pay over taxes & deductions:** Payroll shows what's owed to the tax office or pension fund, and records the payment (Payroll liabilities / Bank). The cash-flow report shows "Salaries paid" and "Payroll taxes & deductions paid".

### Roles
| Role | Can |
|---|---|
| **HR** | everything in HR and payroll |
| **MANAGER** | view employees (without pay), record attendance, approve leave |
| **ACCOUNTANT** | view payroll, mark it paid, pay over liabilities |
| **OWNER** | everything |
| **Any staff member with a linked login** | My HR |

### Fixed along the way
- After a payment was undone, paying the same payroll (or any document) again didn't post a new journal entry. It does now.
- Negative amounts now display as -$190.91 instead of $-190.91.

### Verified
- 92 new API checks (`e2e-p6.mjs`), with exact figures for:
  - salary pro-rating
  - unpaid days
  - overtime
  - % and fixed allowances
  - progressive tax
  - percentage pension (employee and employer)
  - employee-specific overrides
  - hourly pay from check-in and check-out times
  - one-off lines
  - leave allowances and overlap
  - self-service
  - approval locks
  - the journal entries, payment, undo and void
  - liabilities and cash flow
  - permissions
- All earlier suites still pass: **655 API checks in total**.
- 9 new click-through browser checks, 85 in total, with no browser errors.

### Deploying Phase 5
1. `npm run db:export` (backup), then `npm run db:migrate -- --dry`. It should list `006_hr_payroll.sql`.
2. `npm run db:migrate`. It only **adds** 11 tables; no existing data is changed.
3. `npx prisma generate`, then restart or deploy. No new environment variables.
4. In *HR settings*:
   - set the working days and tax brackets
   - add your pay components
   - add employees, and link the logins of staff who should use My HR

### Known limits (possible later additions)
- Only monthly payroll: no weekly or bi-weekly runs.
- Each run is paid in one payment. There's no per-employee payment and no bank-file export.
- Tax is the bracket method on monthly taxable pay × 12. There are no year-to-date tax adjustments and no tax filing.
- Leave allowances don't carry over or accrue monthly. Each year starts fresh.
- There's no clock-in from a phone or device: attendance is entered on the daily sheet.

---

## Phase 4: accounting

A full **double-entry general ledger** for each company. Every event that moves money or stock posts one balanced
journal entry, inside the same database transaction as the event. Entries are never edited or deleted: a mistake is undone
with a reversing entry.

### Turning it on
- *Accounting → Overview → Set up your books* (OWNER or ACCOUNTANT). Choose a **start date** and enter opening **cash** and **bank** balances.
- The opening entry also brings in **stock on hand at average cost** (including stock in transit) and **unpaid customer invoices less open credit notes**. The other side goes to *Opening balance equity*.
- A standard US small-business **chart of accounts** is created. You can add accounts and rename any of them. The ones the system posts to automatically (marked with a lock) can't be retyped or deactivated.
- **Nothing posts until accounting is set up**, so existing companies behave exactly as before.
- Supplier bills still owed from before the start date are entered as bills afterwards. A bill made from a purchase order received before the start date goes against *Opening balance equity* automatically.

### What posts automatically
| Event | Debit | Credit |
|---|---|---|
| Invoice issued | Accounts receivable | Sales, Shipping income, Sales tax payable (Sales discounts debited) |
| Customer payment / cash on delivery | Cash or Bank (you choose the account) | Accounts receivable |
| Credit note | Sales returns & allowances, Sales tax | Accounts receivable |
| Credit refunded | Accounts receivable | Bank (you choose the account) |
| Goods shipped | Cost of goods sold (at the cost of the lots that left) | Inventory |
| Customer return restocked | Inventory | Cost of goods sold |
| Goods received on a PO (incl. landed cost) | Inventory | Goods received not invoiced (GRNI) |
| Supplier bill | The line accounts (GRNI for PO goods, or any expense/asset) | Accounts payable |
| Bill payment | Accounts payable | Cash, Bank or credit card |
| Stock adjustment / lost in transit | Inventory or Shrinkage & adjustments | the other one |
| Return to supplier shipped | Supplier returns receivable | Inventory |
| Supplier credit for a return | Accounts payable (+ price variance) | Supplier returns receivable |
| Supplier credit (rebate etc.) | Accounts payable | the account you choose |
| Expense | the expense account | Cash, Bank or credit card |

- Voiding an invoice, credit note, bill or expense, or removing a payment, posts the reversing entry.
- With inventory tracking **off**, purchases go straight to cost of goods sold, and stock-only events don't post.

### Screens (Accounting section in /business)
- **Overview:** cash and bank balances, inventory, what customers owe, what you owe suppliers (overdue and due within 7 days), and this month's profit. Also **closing periods**: lock the books up to a date, after which nothing can be posted on or before it. This can be reopened.
- **Bills:**
  - Enter a supplier bill by hand, or with **"Enter bill"** on a received purchase order, which pre-fills what was received.
  - Partial payments from any money account.
  - Supplier credits are applied to open bills automatically, oldest first.
  - **AP aging:** not due, 1–30, 31–60, 61–90 and 90+ days.
- **Expenses:** spending paid straight from cash, bank or card, with totals by category for any period.
- **Financial reports:**
  - **Profit & loss**, with an optional comparison to the previous period and gross margin.
  - **Balance sheet**: shows whether it balances, and includes profit to date.
  - **Cash flow**: operating, investing and financing.
  - **Trial balance**.
  - **General ledger** per account, with a running balance. Click any line to see its entry.
- **Journal:** every entry, filterable by source, date or text. **Manual entries** (owner investment, loans, depreciation and so on) can only be posted when they balance. Manual and opening entries can be reversed.
- **Chart of accounts:** balances by type. Click a balance to open its ledger.
- **Reconcile:**
  1. Pick the bank or card account and enter the statement's end date and balance.
  2. Tick the transactions that appear on the statement.
  3. It only finishes when the difference is 0.00. Cleared items don't show again.
- **Invoices:** the payment form and the credit-note refund now ask which account the money went into or came out of.

### Roles
- **OWNER and ACCOUNTANT** (`accounting.*`) do everything above.
- **MANAGER** (`accounting.view`) can view reports, bills, expenses and the journal, but can't post.
- **WAREHOUSE and SALES** have no access to the books. Their actions, like shipping and receiving, still post automatically.

### Verified
- 94 new API checks (`e2e-p5.mjs`). All earlier suites still pass: **563 checks in total**. Among the new checks:
  - each automatic posting above, with exact amounts
  - opening balances
  - bills from POs, before and after the start date
  - partial and removed payments
  - supplier credits and AP aging
  - expenses on a credit card, and voiding them
  - manual entries: unbalanced ones are rejected, and reversal works
  - P&L, balance sheet and cash-flow figures
  - reconciliation
  - closed periods
  - account rules
  - role permissions
  - the trial balance and balance sheet balance after every step
  - **book inventory = stock valuation**
- The Phase 3 and Phase 2-gap suites were also re-run **with accounting switched on**. The trial balance and balance sheet balanced, and book inventory matched the stock valuation, within $0.01 from landed-cost rounding.
- 12 new click-through browser checks, 76 in total, with no browser errors.

### Deploying Phase 4
1. `npm run db:export` (backup), then `npm run db:migrate -- --dry`. It should list `005_accounting.sql`.
2. `npm run db:migrate`.
   - It only **adds** 10 tables and 2 columns: `invoice_payments.account_id` and `credit_notes.refund_account_id`.
   - No existing data is changed.
3. `npx prisma generate`, then restart or deploy. No new environment variables.
4. Each company sets up its books from *Accounting → Overview* when ready.

### Known limits (possible later additions)
- Voiding an invoice issued **before** the accounting start date doesn't post a reversal. That invoice was part of the opening receivables, so post a journal entry if it matters.
- A credit note entered as a plain amount (not from returned lines) has no tax share, so all of it goes to Sales returns.
- No multi-currency, no budgets, and no automatic year-end close. Retained earnings are shown as "profit to date" until you post a closing entry.
- Tax returns and filing aren't included. Sales tax payable is tracked for you to file.
- Payroll posting arrives with Phase 5. The *Salaries & wages*, *Payroll taxes* and *Payroll liabilities* accounts are already in place.

---

## Added after Phase 2/3: stock per flavour, landed costs, transfers in transit, returns to suppliers

These were the items left out of Phase 2. They are now built and tested.

### Stock per flavour
- A product's **flavours** are now real stock-keeping variants. Stock levels, lots, movements, purchase-order lines, transfers, quotes, cart lines and order lines all record the flavour.
- Each flavour can have its **own SKU and barcode** (Products → edit → *Flavours: stock, SKU & barcode*). Scanning a flavour barcode picks the product *and* the flavour.
- **Customers must choose a flavour** for products that have flavours. Each flavour is its own cart line. The product page and Quick Order show stock per flavour, and checkout won't accept more of a flavour than is in stock.
- **Quick Order works now:** enter quantities for several flavours and add them all to the cart. It used to have no add button, and it was missing on the search, brand and company pages.
- Volume price tiers count the product's **total quantity across flavours** ("mix and match": 5 Mango + 5 Mint reaches the 10+ tier).
- **Reorder point and low-stock alerts apply per flavour.** Reorder suggestions list "Fruit Pod (Mango)" separately.
- **Existing stock is kept.** Stock counted before a product had flavours shows as **"unassigned"** on the Stock page. Click it to move it to a flavour, or write it off with Adjust stock.
- A flavour can't be removed from a product while it still has stock.
- **Saved carts and old cart lines:** cart lines saved without a flavour can't be checked out. The cart shows "Choose a flavour" on them, and restoring a saved cart skips them and says so.

### Landed costs
- When receiving a purchase order, enter **freight, duty or other costs** for that delivery. They are spread over the received lines **by line value or by quantity** and added to their unit cost.
- Stock value, the average cost and margins therefore include them.
- The form pre-fills the PO's shipping amount that hasn't been allocated yet.
- The PO and each goods receipt show the landed cost.

### Transfers in transit
- *Transfer → "Ship it (in transit)"* takes the stock out of the source warehouse now. It arrives when the destination **receives** it, with optional carrier, tracking number and expected date.
- **Receive** under *Stock reports → Transfers*. If fewer units arrive, the difference is recorded as **lost in transit**. Lot numbers, expiry dates and costs travel with the stock.
- An in-transit transfer can be **cancelled**, which puts the stock back.
- Stock valuation shows a separate **"In transit"** line. Reorder suggestions count in-transit stock as incoming.
- Instant transfers work as before.

### Returns to suppliers (RTV)
- *Purchasing → Supplier returns*, or **"Return to supplier"** on a received purchase order. The PO's lines are pre-filled and costs default to the PO cost.
- The workflow:
  1. **Draft**
  2. **Ship**: the stock leaves the warehouse and the supplier gets an email with the RTV number. Warehouse staff can ship.
  3. **Record the supplier's credit** (amount and their credit-note number), or **close** it without credit.
- With accounting set up (Phase 4), shipping the return and recording the credit post to the books.

### Verified
- 64 new API checks. All earlier suites still pass, 469 checks in total. Among the new checks:
  - stock per flavour through purchasing, sales, returns and quotes
  - the exact landed-cost split
  - transit receive, loss and cancel
  - the supplier return cycle
  - the ledger still balances per flavour
- 13 new click-through browser checks (64 in total), with no browser errors.

### Deploying
1. `npm run db:export` (backup), then `npm run db:migrate -- --dry`. It should list `004_variants_logistics.sql`.
2. `npm run db:migrate`.
   - It adds tables and columns. No data is changed or deleted.
   - It widens two unique rules: a cart line and a stock level are now unique per product **and flavour**.
   - Every product's existing flavours get a variant row.
3. `npx prisma generate`, then restart or deploy. No new environment variables.
4. Optional: add per-flavour barcodes, and assign any "unassigned" stock to its flavours.

---

## Phase 3: sales

### How selling works now
- **Customer accounts per company:** every buyer who orders from a company gets an account there automatically, and staff can add one by email first. Each account has:
  - a **customer group**
  - **payment terms** (Net N days) and a **credit limit**
  - an **on hold** switch, **tax exempt** flag, tax ID and internal notes
- **Pricing:** the customer's price for a product, in order:
  1. their group's **price list**, using the best **volume tier** for the quantity (for example 1+ at $9, 10+ at $8)
  2. the company's **default price list**
  3. the base price minus the group's **discount %**
  - Logged-in customers see their own price everywhere (product cards, product page, cart, checkout), with the list price struck through and their volume tiers. Visitors who aren't logged in still see no prices.
- **Promo codes** per company: % off, fixed amount off or free shipping. Each has a minimum order, start and end dates, a total use limit and a per-customer limit. Usage is counted safely when two checkouts run at once.
- **Checkout:**
  - Per seller: discount, shipping (fee and free-shipping threshold set per company), sales tax (rate per company; none for tax-exempt customers) and total.
  - The customer picks how to pay each seller: **cash on delivery**, or **on account** when that seller gave them terms.
  - On account is refused when the order would go over the credit limit: open invoices plus orders not invoiced yet.
- **Invoices:**
  - Created and emailed **automatically when an order ships** (can be switched off), or by hand from the order.
  - Numbered INV-00001 per company. Due date = issue date + terms.
  - **PDF** download, and the PDF is attached to the email.
  - Record payments (bank transfer, check, cash, card…), with a receipt email to the customer. A payment recorded by mistake can be removed.
  - Cash on delivery: delivering the order records the payment and the invoice becomes paid.
  - Cancelling an order voids its unpaid invoice. An order whose invoice has payments can't be cancelled; issue a credit note instead.
- **Credit notes (CN-…)**, with PDF and email:
  - against an invoice (price adjustment, goodwill), applied to its balance
  - from a return
  - open credit can later be applied to another invoice of the same customer, or marked as refunded
- **Returns (RMA-…):**
  1. The customer requests a return from a delivered order: items, quantities, reason. There's a return window (default 30 days after shipping). Staff can also open a return themselves.
  2. Staff **approve** (with a message, e.g. where to send it) or **reject**.
  3. The warehouse **receives** it: quantity and condition per item. Resellable items go **back into stock** with a "return" movement when tracking is on.
  4. Staff **close** it: credit note applied to the invoice, credit note refunded, or no credit. The credit uses the price paid, less the order's discount share, plus tax.
  - The customer is emailed at every step.
- **Quotes (Q-…):**
  - A customer asks for a quote from the cart ("Request a quote" per seller), or staff prepare one.
  - Staff set prices, discount, shipping and validity, then send it. It's emailed with a PDF.
  - The customer **accepts** (it becomes an order at the quoted prices, after stock and credit checks) or declines. Quotes past their date expire.

### Screens
- **Business → Sales:**
  - **Customers:** balance, overdue, terms, group; the account editor.
  - **Pricing & promos:** groups, price lists with volume tiers, promo codes with usage.
  - **Quotes:** list and quote editor.
  - **Invoices:** outstanding and overdue totals; invoice detail with payments, credits, PDF and email; a credit notes tab.
  - **Returns:** review, receive and resolve.
  - **Sales reports:** sales by day, month, product (with margin) or customer; **receivables aging** (current, 1–30, 31–60, 61–90, 90+ days).
  - **Sales settings:** tax, shipping, free shipping, cash on delivery on or off, auto-invoice, invoice notes, quote validity, return window.
- **Orders:** shows discount, tax, payment method and terms, links to the order's invoices and returns, and "Create invoice" / "Start a return".
- **My Account:**
  - new **Invoices** tab: what you owe, overdue, PDFs, credit notes
  - new **Quotes** tab: accept, decline, PDF
  - new **Returns** tab
  - The order page has invoice PDFs and "Request a return". It no longer calls itself an invoice or says "paid by card".
- **Checkout:** a promo code box and a payment choice per seller.

### Roles
- **SALES:** customers, pricing, promos, quotes, returns (approve and resolve), view invoices, sales reports.
- **ACCOUNTANT:** invoices, payments, credit notes, customer terms and credit limits, view quotes and returns, reports.
- **WAREHOUSE:** view and receive returns.
- **MANAGER:** all of the above, plus sales settings. **OWNER:** everything.

### Verified
- 124 new Phase 3 API checks. The earlier 281 still pass (405 in total). They cover:
  - every pricing rule and tier
  - promo limits
  - credit limits on checkout and on quotes
  - automatic invoices on shipping and on COD delivery
  - partial and full payments, payment removal, credits, refunds and voids
  - returns end to end with restock and the exact credit amount
  - quotes: request, edit, send, accept, decline and expire
  - A/R aging, permissions per role, and the emailed PDFs (checked as real PDFs arriving at a local mail server)
- 19 new browser click-throughs (51 in total), with no browser errors.

### Deploying Phase 3
1. In `Backend`: `npm install` (adds `pdfkit` for the PDFs).
2. `npm run db:export` (backup), then `npm run db:migrate -- --dry`. It should list `003_sales.sql`.
3. `npm run db:migrate`. It only adds tables and columns. Existing orders get their subtotal filled in and the payment method "cash on delivery", and every buyer who ordered from a company gets a customer account there.
4. `npx prisma generate`, then restart or deploy the backend and frontend. No new environment variables.
5. Each company: open **Sales settings** and set the tax rate, shipping and invoice notes (bank details). Then set up groups, price lists and terms for customers who need them.

### Not included (possible later additions)
- Online card payments: invoices are paid offline and recorded by staff. A payment gateway (Stripe) can come later, once you decide who receives the money.
- Multiple tax rates per product or region. The rate is one per company.
- Accounting entries for sales and payments: these get posted to the general ledger in Phase 4.

---

## Phase 2: supply chain

### How stock works
- **Inventory tracking is opt-in per company:** *Inventory → Turn on*.
  - While tracking is off, orders don't touch stock, so nothing changed for existing sellers.
  - Enter stock first, either with *Adjust stock → Set counted quantity* or by receiving purchase orders. Then turn tracking on.
- When tracking is on:
  - **Confirm** an order → its stock is **reserved** in a warehouse (the default one, or the one you pick).
  - **Ship** → the stock is **deducted**, using the earliest-expiring lots first.
  - **Cancel** → the reservation is released.
  - Customers see *in stock / out of stock*, and logged-in customers see the available quantity.
  - The cart and checkout won't accept more than is available.
- Stock is kept per **product × warehouse**, broken down by **lot / batch, expiry date and bin**.
- Every change is written to an append-only **movement ledger**: received, adjustment, sold, transfer in/out.
- **Average cost:** each product's cost is a moving average, updated whenever stock is received with a cost. It drives stock valuation now and the cost of goods sold in Phase 4.
- Concurrency-safe: stock rows are locked during changes, so two orders can never reserve the same last units.
  This is tested with a real race.

### Screens (in /business)
- **Stock:**
  - Totals: units, value, low stock, out of stock.
  - Filter by warehouse, low or out of stock, and search, including by barcode scan.
  - Click a product to see its stock per warehouse, its lots and bins, the incoming purchase orders and its movement history.
  - **Adjust stock** (add / remove / set counted quantity, with a reason, lot, expiry, bin and cost) and **Transfer** between warehouses.
- **Warehouses:** add, edit, set the default, deactivate, and manage bins (shelf/aisle locations).
- **Suppliers:**
  - Contact details, payment terms, currency.
  - A **price list** per supplier (their SKU, cost, lead time) and a preferred supplier per product.
- **Purchase orders:**
  - Draft → **email to supplier** (or mark as sent) → **receive**. You can receive partially, with lot, expiry and bin.
  - Then the order is *received*, or you **close** it early. Drafts and sent orders can be cancelled.
  - Every receipt gets a numbered goods receipt (GRN). The PO page prints cleanly.
- **Reorder:**
  - Products whose available stock plus stock already on order is at or below their **reorder point**, grouped by preferred supplier.
  - Select the lines and get one draft PO per supplier.
- **Low stock email** to inventory staff when stock crosses a reorder point, at most once a day per product.
- **Stock reports:** valuation per warehouse, expiring stock (30–365 days, plus already expired), the movement ledger with filters, and transfers.
- **Orders:**
  - Choose the fulfilment warehouse when confirming.
  - **Pick list & packing slip**: what to pick from which bin and lot, earliest expiry first. Printable.
- **Product form:** barcode, unit, cost, reorder point and quantity, preferred supplier.
- **Dashboard:** stock value, low and out-of-stock counts, open POs.

### Roles
- **WAREHOUSE:** stock, warehouses, receiving POs, pick/pack/ship. Can't create POs or confirm orders.
- **MANAGER:** everything in inventory and purchasing.
- **SALES** and **ACCOUNTANT:** view stock and POs only.

### Verified
- 86 Phase 2 API checks on top of the earlier 195 (281 in total). They cover:
  - the full buy → receive → sell → ship cycle
  - lots and expiry order
  - average cost
  - transfers and adjustments
  - tracking on and off
  - a reservation race
  - low-stock alerts and reorder suggestions
  - permissions and isolation between companies
  - integrity: each warehouse's stock equals the sum of its lots, the movement ledger adds up to stock on hand, and nothing is ever negative
- 16 more browser click-throughs.
- The testing found and fixed:
  - Emails were sent one connection at a time. They're now pooled, and a 12-email burst went from about 5 s to 0.2 s.
  - A dropdown bug cleared the picked product inside dialogs.

### Deploying Phase 2
1. In `Backend`: `npm run db:export` (backup), then `npm run db:migrate -- --dry`. It should list `002_supply_chain.sql`.
2. `npm run db:migrate`. It only adds tables and columns, and every company gets a "Main warehouse".
3. `npx prisma generate`, then restart or deploy the backend and frontend. No new environment variables.
4. Each company: enter its stock, then turn on tracking under *Inventory*.

### Added later
Stock per flavour, landed costs, transfers in transit and returns to suppliers were added after Phase 3 (see the section above).

---

## Phase 1: what was added

### Customers
- Forgot password → email link → reset. All sessions are signed out and a confirmation email is sent.
- Email verification on sign-up, with a banner and resend button. **Unverified users can still shop.**
- Change password from *My Account*. Other devices are signed out.
- **Suppliers directory** (`/companies`) and a store page per company (`/companies/:slug`) with brand filters.
- Header search works (`/search?q=`): it matches title, brand and SKU.
- The cart is grouped by seller. Checkout shows each seller's items, shipping and total, then places one order per seller.
  The customer gets one confirmation email.
- *My orders* shows the seller, order number and tracking number.

### Company staff: `/business`
- **Dashboard:** 30-day revenue, open orders, products, team, recent orders, top products.
- **Orders:**
  - Search and filter.
  - Order detail with customer and address.
  - Workflow: pending → confirmed → processing → shipped → delivered, or cancelled.
  - Tracking number and internal notes.
  - The customer is emailed when an order is confirmed, shipped, delivered or cancelled.
  - On cash-on-delivery orders, the payment is marked completed on delivery and voided on cancellation.
- **Products:**
  - Create, edit, show or hide, and image upload.
  - Products with order history are hidden instead of deleted.
  - Brands are owned per company. A company can't use another company's brand.
- **Team:**
  - Invite by email with a role. The invite link creates the account or joins an existing one.
  - Change roles, disable or remove members. The last owner is protected.
- **Settings:** company profile and logo.
- **Activity log:** who changed what.
- **Roles:** OWNER, MANAGER, ACCOUNTANT, WAREHOUSE, SALES, HR. See `Backend/src/services/permissions.js`.
- Any logged-in user can **register a business** from `/business`. It stays *pending* until a platform admin approves it.

### Platform admin: `/admin`
- **Companies:** approve, suspend and reactivate (the owners are emailed), create a company with an owner invite, and set the commission % (stored for future payouts).
- **Brands:** move a brand **and all its products** to another company.
- **Emails:** outbox with status and errors, SMTP health check, send a test email, retry failed emails.

### Platform
- Email is sent through an **outbox table**. Messages survive restarts and are retried with backoff (5 attempts), and you can see what was sent.
- Rate limits on login, register and the password endpoints. Security headers via helmet.
- An audit log of company actions.

### Verified
- 195 API checks against a database with your real structure, using a real local SMTP server to capture emails:
  the original 97 plus 98 for Phase 1.
- 16 click-through browser tests of the new screens, with no browser errors.
- The migration was tested on a copy of the current structure with existing data: every row was backfilled, and running it twice is safe.

---

## Deploying Phase 1 (in this order)

1. **Install the new packages:** in `Backend`, run `npm install`.
2. **Back up the data:** `npm run db:export`. This writes every table to `Backend/backups/db-export-<time>/` as JSON. It's read-only, and the folder is git-ignored.
3. **Preview the migration:** `npm run db:migrate -- --dry`. It should list `001_multitenancy_auth_email.sql`.
4. **Apply it:** `npm run db:migrate`.
   - It only adds tables and columns, and it runs in one transaction, so if anything fails nothing changes.
   - Afterwards every existing product, brand, order and payment belongs to the company **"Smoke Wholesale"**, and existing admins are its owners.
5. Run `npx prisma generate` (or restart `npm run dev`).
6. **Email (Gmail SMTP):**
   - Turn on 2-Step Verification on the Gmail account.
   - Create an App Password at https://myaccount.google.com/apppasswords.
   - Set these in `Backend/.env` and on Render:
     ```
     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=465
     SMTP_USER=you@gmail.com
     SMTP_PASS=<16-character app password>
     EMAIL_FROM="Smoke Wholesale <you@gmail.com>"
     APP_URL=https://smoke-wholesale.vercel.app   # on Render; http://localhost:5173 locally
     ```
   - Then open **/admin → Emails → Send test email**.
   - Gmail allows about 500 emails a day. For more volume, use a transactional provider's SMTP (Brevo, Postmark, Amazon SES) with the same variables.
7. Deploy the backend (Render), then the frontend (Vercel).
8. In **/admin → Companies**, rename "Smoke Wholesale" if you like. Create your real companies with an owner email, and in **Brands**, move each brand to its company.

> The migration runner uses `DATABASE_URL`, so whichever database `.env` points at is the one that gets migrated.
> Run it once against production from your PC. Render doesn't need to run it.
