-- =============================================================================
-- 001: companies (multi-tenancy), roles, invitations, auth tokens, email outbox,
--      audit log.
-- ADDITIVE ONLY: creates new tables and adds nullable columns. Nothing is dropped,
-- renamed or deleted. Safe to run more than once. Runs inside one transaction
-- (via `npm run db:migrate`), so it either fully applies or not at all.
-- =============================================================================

-- ---------- companies (tenants) ----------
CREATE TABLE IF NOT EXISTS companies (
  id               BIGSERIAL PRIMARY KEY,
  name             VARCHAR(255) NOT NULL,
  slug             VARCHAR(255) NOT NULL UNIQUE,
  legal_name       VARCHAR(255),
  email            VARCHAR(255),
  phone            VARCHAR(255),
  website          VARCHAR(255),
  logo_url         VARCHAR(500),
  description      TEXT,
  tax_id           VARCHAR(255),
  address_line1    VARCHAR(255),
  address_line2    VARCHAR(255),
  city             VARCHAR(255),
  state            VARCHAR(255),
  postal_code      VARCHAR(255),
  country          VARCHAR(255) DEFAULT 'USA',
  currency         VARCHAR(3)   NOT NULL DEFAULT 'USD',
  status           VARCHAR(32)  NOT NULL DEFAULT 'pending',   -- pending | active | suspended
  commission_rate  DECIMAL(5,2) NOT NULL DEFAULT 0,           -- reserved for a future platform cut
  settings         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);

-- ---------- company staff ----------
CREATE TABLE IF NOT EXISTS company_members (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(32) NOT NULL DEFAULT 'SALES',  -- OWNER | MANAGER | ACCOUNTANT | WAREHOUSE | SALES | HR
  status      VARCHAR(32) NOT NULL DEFAULT 'active', -- active | disabled
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT company_members_company_user_unique UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_company_members_user ON company_members(user_id);

CREATE TABLE IF NOT EXISTS company_invitations (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email        VARCHAR(255) NOT NULL,
  role         VARCHAR(32)  NOT NULL DEFAULT 'SALES',
  token_hash   VARCHAR(64)  NOT NULL UNIQUE,
  invited_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ(6) NOT NULL,
  accepted_at  TIMESTAMPTZ(6),
  revoked_at   TIMESTAMPTZ(6),
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_invitations_company ON company_invitations(company_id);

-- ---------- one-time auth tokens (password reset, email verification) ----------
CREATE TABLE IF NOT EXISTS user_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(32) NOT NULL,                 -- password_reset | email_verify
  token_hash  VARCHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ(6) NOT NULL,
  used_at     TIMESTAMPTZ(6),
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_tokens_user_type ON user_tokens(user_id, type);

-- ---------- email outbox (sent by a background worker, with retries) ----------
CREATE TABLE IF NOT EXISTS email_outbox (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT REFERENCES companies(id) ON DELETE SET NULL,
  to_email    VARCHAR(255) NOT NULL,
  subject     VARCHAR(500) NOT NULL,
  html        TEXT NOT NULL,
  text        TEXT,
  template    VARCHAR(64),
  status      VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | sent | failed
  attempts    INT NOT NULL DEFAULT 0,
  last_error  TEXT,
  send_after  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ(6),
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_pending ON email_outbox(status, send_after);

-- ---------- audit log ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(64)  NOT NULL,   -- e.g. product.create, order.status
  entity      VARCHAR(64),
  entity_id   VARCHAR(64),
  changes     JSONB,
  ip_address  VARCHAR(64),
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created ON audit_logs(company_id, created_at DESC);

-- ---------- tenant columns on existing tables (nullable, then backfilled) ----------
ALTER TABLE brands          ADD COLUMN IF NOT EXISTS company_id BIGINT REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE products        ADD COLUMN IF NOT EXISTS company_id BIGINT REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE products        ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE products        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ(6);
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS company_id BIGINT REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS order_number   VARCHAR(32);
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS checkout_group VARCHAR(64);
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS shipping_amount DECIMAL(38,2) DEFAULT 0;
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(255);
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS notes      TEXT;
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ(6);
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ(6);
ALTER TABLE payment_history ADD COLUMN IF NOT EXISTS company_id BIGINT REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE credit_history  ADD COLUMN IF NOT EXISTS company_id BIGINT REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_brands_company   ON brands(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_company_created ON orders(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_checkout_group  ON orders(checkout_group);
CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_unique ON orders(order_number);

-- ---------- backfill: everything that exists today belongs to one default company ----------
INSERT INTO companies (name, slug, status)
SELECT 'Smoke Wholesale', 'smoke-wholesale', 'active'
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE slug = 'smoke-wholesale');

UPDATE brands          SET company_id = (SELECT id FROM companies WHERE slug = 'smoke-wholesale') WHERE company_id IS NULL;
UPDATE products        SET company_id = (SELECT id FROM companies WHERE slug = 'smoke-wholesale') WHERE company_id IS NULL;
UPDATE orders          SET company_id = (SELECT id FROM companies WHERE slug = 'smoke-wholesale') WHERE company_id IS NULL;
UPDATE payment_history SET company_id = (SELECT id FROM companies WHERE slug = 'smoke-wholesale') WHERE company_id IS NULL;
UPDATE credit_history  SET company_id = (SELECT id FROM companies WHERE slug = 'smoke-wholesale') WHERE company_id IS NULL;
UPDATE orders SET order_number = 'ORD-' || LPAD(id::text, 6, '0') WHERE order_number IS NULL;

-- Brands that exist only as text on products get a brands row too, owned by the product's company.
INSERT INTO brands (name, company_id)
SELECT DISTINCT ON (p.brand) p.brand, p.company_id
FROM products p
WHERE p.brand IS NOT NULL AND p.brand <> ''
  AND NOT EXISTS (SELECT 1 FROM brands b WHERE b.name = p.brand)
ORDER BY p.brand, p.id;

-- Existing platform admins become owners of the default company.
INSERT INTO company_members (company_id, user_id, role)
SELECT c.id, u.id, 'OWNER'
FROM users u CROSS JOIN companies c
WHERE u.role = 'ADMIN' AND c.slug = 'smoke-wholesale'
ON CONFLICT (company_id, user_id) DO NOTHING;
