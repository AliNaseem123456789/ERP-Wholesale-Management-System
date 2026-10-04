# Smoke Wholesale

A multi-company B2B wholesale marketplace with a built-in ERP, made for tobacco, vape and convenience distributors.

Retailers browse every approved seller, buy from several of them in one cart, and get one order per seller at checkout. Each seller (company) runs its whole business from its own back office: catalogue, stock, purchasing, sales, invoicing, accounting, HR and payroll. Platform admins approve companies and watch the marketplace.

## What's inside

**Marketplace (customers)**
- Catalogue by category, brand and seller, with per-flavour stock and volume price tiers
- Multi-seller cart and checkout (one order per seller), quick order, saved carts
- Customer price lists, promo codes, payment terms and credit limits
- Quotes that turn into orders, invoices and credit notes as PDFs, online returns (RMA)
- State tobacco rules applied at checkout: excise tax, flavour bans, licence checks, shipping bans

**Company back office (`/business`)**
- Team with roles and permissions (Owner, Manager, Accountant, Warehouse, Sales, HR), invitations, activity log
- **Inventory:** warehouses and bins, stock per flavour, lots with expiry (FEFO), transfers in transit, adjustments, reorder suggestions, valuation, barcode scan station (USB scanners or phone camera) for look-ups, stock counts, pick & pack and receiving
- **Purchasing:** suppliers, purchase orders, receiving with landed costs, returns to suppliers
- **Sales:** customer groups, price lists, promotions, quotes, invoices, payments, credit notes, returns, A/R aging
- **Accounting:** chart of accounts and a double-entry general ledger posted automatically from sales, purchases, stock and payroll; supplier bills, expenses, bank reconciliation, closing periods; P&L, balance sheet, cash flow, trial balance, general ledger
- **HR & payroll:** employees, departments, attendance, holidays, leave requests and balances, configurable allowances/deductions, progressive income-tax brackets, payroll runs, payslip PDFs, self-service "My HR"
- **Operations:** notifications centre, CSV import/export, tobacco compliance (state rules, customer licences, excise and shipment reports), reports hub with scheduled email reports

**Platform admin (`/admin`)**
- Marketplace KPIs (sales, orders, average order, repeat buyers, cancellations) with period comparison and a daily sales chart
- Company approval, brands, users, products, homepage features, email outbox

## Tech stack

| | |
|---|---|
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS 4, Redux Toolkit, React Router 7 |
| Backend | Node.js, Express 5, Prisma ORM |
| Database | PostgreSQL (Supabase) |
| Other | JWT auth (httpOnly cookies), Nodemailer (SMTP outbox), PDFKit, Supabase Storage for images |

No other external services are needed: reports, alerts and emails run inside the API process.

## Project structure

```
Backend/    Express API (src/), Prisma schema, additive SQL migrations (prisma/sql), DB scripts
Frontend/   React app (src/features/* per area: products, cart, checkout, account, admin, business)
ERP_ROADMAP.md       What each phase added, how it works and how to deploy it
MIGRATION_NOTES.md   Notes on the move from Supabase queries to Prisma
```

## Getting started

Requirements: Node.js 20+, a PostgreSQL database.

```bash
# API
cd Backend
cp .env.example .env          # fill in DATABASE_URL, JWT secrets, SMTP...
npm install
npm run db:export             # optional: back up the database first
npm run db:migrate            # applies prisma/sql/*.sql (additive, safe to re-run)
npm run dev                   # http://localhost:5000

# Web app
cd ../Frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:5173 (proxies /api to the backend)
```

Database changes are plain, additive SQL files in `Backend/prisma/sql`. `npm run db:migrate` records which ones were applied, so it never re-runs or drops anything.

## License

See `Backend/LICENSE.md` and `Frontend/LICENSE.md`.
