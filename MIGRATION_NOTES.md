# Prisma migration & fixes (2026-10-03)

All database access in the backend now goes through **Prisma**. Supabase is only used for
**Storage** (product images and homepage banners). **No database changes were made**: the
Prisma schema was introspected from the live database with `prisma db pull`, so it matches the
existing tables exactly and no data is touched.

A full copy of the code before these changes is in `_backups/before-prisma-migration-2026-10-03.tar.gz`.

## How it was tested
- `prisma validate` and `prisma generate` against the pulled schema.
- Every Prisma query in the code was type-checked against the generated client.
- A 96-step end-to-end test ran the real API over HTTP against a throwaway Postgres
  with the same tables. It covered auth, refresh and logout-all, addresses, cart, saved carts, checkout,
  sub-accounts and permissions, every admin action, and access checks between users. All steps pass.
- The frontend production build (`vite build`) succeeds.

## ⚠️ Data safety rules (read before touching the database)
- **Never** run `prisma migrate dev`, `prisma migrate reset` or `prisma db push` against the
  Supabase database. They can drop or rewrite tables.
- The old `prisma/migrations` folder did not match the real database. It was renamed to
  `prisma/_old_migrations_DO_NOT_APPLY` so it can't be applied by accident.
- To change the database: write *additive* SQL (`ALTER TABLE … ADD COLUMN IF NOT EXISTS …`), run it in
  the Supabase SQL editor, then run `npx prisma db pull` and `npx prisma generate`.
- On Windows/PowerShell, `npx prisma db pull --print > file` writes UTF-16. Use plain `npx prisma db pull`
  (it updates `schema.prisma` in place) or `npm run db:pull:preview`.

## Things you must do
1. **Rotate the Supabase secret key** (Supabase → Project Settings → API keys). The old one was committed in
   `src/lib/supabaseAdmin.js`, so treat it as leaked. Put the new key in `Backend/.env` and on Render as
   `SUPABASE_SERVICE_ROLE_KEY`.
2. **Use a strong `JWT_SECRET`.** The current one is 8 characters. Generate one with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Changing it signs everyone
   out once.
3. **Lock down direct database access.** The publishable (anon) key was shipped in the frontend bundle. The
   backend no longer needs it, so in Supabase either enable Row Level Security (with no policies) on every
   table, or revoke `anon`/`authenticated` access. Otherwise anyone with that key can read tables
   such as `users` directly. This is safe because the backend connects as the `postgres` role through
   `DATABASE_URL`, which bypasses RLS.
4. **Render environment variables** (Dashboard → Environment):
   `NODE_ENV=production`, `DATABASE_URL` (use the **Session pooler** string from Supabase → Connect,
   because the direct `db.<ref>.supabase.co` host is IPv6-only), `JWT_SECRET`, `JWT_REFRESH_SECRET`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS`, `SHIPPING_FEE`.
   Build command: `npm install` (it runs `prisma generate` automatically). Start command: `npm start`.
5. **Vercel**: nothing to set. `vercel.json` proxies `/api/*` to the Render backend, so the browser talks
   to the same domain and the login cookies are first-party, which makes login work in Safari as well.
   If your Render URL changes, update it in `Frontend/vercel.json`.

## Running locally
```
cd Backend  && npm install && npm run dev     # http://localhost:5000
cd Frontend && npm install && npm run dev     # http://localhost:5173 (proxies /api to :5000)
```

## What changed

### Backend
- All 7 controllers rewritten with Prisma, using a single shared client (`src/prisma.js`). The JSON shapes match
  what the old Supabase calls returned. IDs and money values are still plain numbers.
- Secrets moved to `.env` (`.env.example` added). Removed hard-coded Supabase keys and the unused anon client.
- CORS bug fixed: the duplicate `origin` key meant only localhost was allowed. Origins now come from `CORS_ORIGINS`.
- `PORT` is read from the environment.
- **Auth:** 15-minute access cookie plus a 30-day refresh cookie. Refresh tokens are stored hashed in the
  existing `refresh_tokens` table and rotated on every refresh. New endpoints: `POST /api/auth/refresh` and
  `POST /api/auth/logout-all`. Users are no longer kicked out every 15 minutes. Email login is
  case-insensitive.
- **Security fixes:**
  - The public `POST /products/addProducts` was removed. Use admin `POST /admin/products`.
  - Saved carts and addresses are now checked against the logged-in user, so one user can no longer read
    or change another's.
  - Prices are only returned to logged-in users.
  - Admin product updates only accept known fields (title, brand, price, …).
- **Checkout:**
  - Uses real prices. Previously the price wasn't fetched, so every order total was $0.
  - Adds `SHIPPING_FEE` (default $10, as shown in the UI).
  - Saves the order, its items, a pending cash-on-delivery payment record and the emptied cart in one
    transaction.
  - Products with no price are refused with a clear message.
  - Sub-accounts need `can_place_order`.
- **Sub-accounts:** the permission chosen in the form is now saved (it was always `true`). The permission
  is stored correctly in the TEXT column. `parent_id` is set.
- **New endpoints:**
  - `GET /products/brands`
  - `GET /orders/checkout-summary`
  - `DELETE /cart/saved-cart-templates/:id`
  - `POST /cart/saved-cart-templates/:id/restore`
  - `/api/credit/my-history` (alias of `/api/account/my-history`)
- **Admin safety rules:**
  - Products that appear in past orders can't be deleted.
  - Users with orders, payments or sub-accounts can't be deleted. Change their role instead.
  - Admins can't delete or demote themselves.
  - New brands are added to `brands` automatically.
- Removed: test route, broken `authMiddleware.js`, `controllers-backup`, unused packages (passport,
  json-web-token, express-list-endpoints), backend `tsconfig.json`.

### Frontend
- API base URL from env (default same-origin `/api`), Vite dev proxy, Vercel `/api` rewrite.
- One axios client with automatic token refresh (shared across parallel requests).
  Public catalogue pages fall back to logged-out mode instead of redirecting to login.
- Fixed `useOrders`, which was hard-coded to `http://localhost:8080`. The Orders table now uses the right field names.
- `/admin-product-management` is now behind the admin guard.
- Checkout totals come from the server. Order placement uses toasts and clears the cart badge.
- Saved carts: *Restore to cart*, *Delete* and *Print* now work.
- Logged-in users see prices on product cards and the product page.
- The add-member form sends the "can place order" checkbox.
- Removed the unused Supabase client file (it contained the anon key).

## Known gaps (not changed)
- **Flavor:** the flavor picked on the product page isn't stored in the cart. `cart_items` has no
  flavor column and allows only one row per product. Supporting it needs a schema change.
- **Quick Order modal** on the home page is UI-only and doesn't add to the cart.
- **Payments:** only cash on delivery exists. There is no online payment provider.
