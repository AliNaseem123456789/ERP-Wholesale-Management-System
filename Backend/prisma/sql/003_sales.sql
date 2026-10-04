-- =============================================================================
-- 003: sales: customer accounts per company, customer groups, price lists
--      (volume tiers), promotions, invoices & payments, credit notes, returns
--      (RMA), quotes. ADDITIVE ONLY. Safe to run more than once.
-- =============================================================================

-- ---------- pricing ----------
CREATE TABLE IF NOT EXISTS price_lists (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  is_default   BOOLEAN NOT NULL DEFAULT false,   -- applies to every customer without a group list
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT price_lists_company_name_unique UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS price_list_items (
  id             BIGSERIAL PRIMARY KEY,
  price_list_id  BIGINT NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id     BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_quantity   INT NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
  price          DECIMAL(38,4) NOT NULL CHECK (price >= 0),
  CONSTRAINT price_list_items_unique UNIQUE (price_list_id, product_id, min_quantity)
);
CREATE INDEX IF NOT EXISTS idx_price_list_items_product ON price_list_items(product_id);

CREATE TABLE IF NOT EXISTS customer_groups (
  id                BIGSERIAL PRIMARY KEY,
  company_id        BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  discount_percent  DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  price_list_id     BIGINT REFERENCES price_lists(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT customer_groups_company_name_unique UNIQUE (company_id, name)
);

-- ---------- a buyer's account with one seller ----------
CREATE TABLE IF NOT EXISTS company_customers (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_group_id   BIGINT REFERENCES customer_groups(id) ON DELETE SET NULL,
  payment_terms_days  INT NOT NULL DEFAULT 0,          -- 0 = pay on delivery only
  credit_limit        DECIMAL(38,2),                   -- NULL = no buying on account
  status              VARCHAR(32) NOT NULL DEFAULT 'active', -- active | blocked
  tax_exempt          BOOLEAN NOT NULL DEFAULT false,
  tax_id              VARCHAR(255),
  notes               TEXT,
  created_at          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT company_customers_company_user_unique UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_company_customers_user ON company_customers(user_id);

-- ---------- promotions ----------
CREATE TABLE IF NOT EXISTS promotions (
  id                     BIGSERIAL PRIMARY KEY,
  company_id             BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code                   VARCHAR(64) NOT NULL,
  description            VARCHAR(255),
  type                   VARCHAR(32) NOT NULL,          -- percent | fixed | free_shipping
  value                  DECIMAL(38,2) NOT NULL DEFAULT 0,
  min_order_amount       DECIMAL(38,2) NOT NULL DEFAULT 0,
  starts_at              TIMESTAMPTZ(6),
  ends_at                TIMESTAMPTZ(6),
  max_uses               INT,
  max_uses_per_customer  INT,
  uses_count             INT NOT NULL DEFAULT 0,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT promotions_company_code_unique UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id            BIGSERIAL PRIMARY KEY,
  promotion_id  BIGINT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  order_id      BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  amount        DECIMAL(38,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_promo_user ON promotion_redemptions(promotion_id, user_id);

-- ---------- order fields ----------
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS subtotal_amount    DECIMAL(38,2);
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS discount_amount    DECIMAL(38,2) NOT NULL DEFAULT 0;
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS tax_amount         DECIMAL(38,2) NOT NULL DEFAULT 0;
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS payment_method     VARCHAR(32);
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS payment_terms_days INT;
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS promo_code         VARCHAR(64);
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS quote_id           BIGINT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS list_price         DECIMAL(38,4);

-- ---------- invoices & payments ----------
CREATE TABLE IF NOT EXISTS invoices (
  id                BIGSERIAL PRIMARY KEY,
  company_id        BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  order_id          BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  invoice_number    VARCHAR(32) NOT NULL,
  status            VARCHAR(32) NOT NULL DEFAULT 'issued',  -- issued | partially_paid | paid | void
  issue_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  currency          VARCHAR(3) NOT NULL DEFAULT 'USD',
  subtotal          DECIMAL(38,2) NOT NULL DEFAULT 0,
  discount_amount   DECIMAL(38,2) NOT NULL DEFAULT 0,
  tax_amount        DECIMAL(38,2) NOT NULL DEFAULT 0,
  shipping_amount   DECIMAL(38,2) NOT NULL DEFAULT 0,
  total_amount      DECIMAL(38,2) NOT NULL DEFAULT 0,
  amount_paid       DECIMAL(38,2) NOT NULL DEFAULT 0,
  amount_credited   DECIMAL(38,2) NOT NULL DEFAULT 0,
  payment_method    VARCHAR(32),
  billing_snapshot  JSONB,
  notes             TEXT,
  sent_at           TIMESTAMPTZ(6),
  voided_at         TIMESTAMPTZ(6),
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT invoices_company_number_unique UNIQUE (company_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_company_status ON invoices(company_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_order_unique ON invoices(order_id) WHERE order_id IS NOT NULL AND status <> 'void';

CREATE TABLE IF NOT EXISTS invoice_items (
  id           BIGSERIAL PRIMARY KEY,
  invoice_id   BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id   BIGINT REFERENCES products(id) ON DELETE SET NULL,
  description  VARCHAR(500) NOT NULL,
  quantity     INT NOT NULL,
  unit_price   DECIMAL(38,4) NOT NULL,
  line_total   DECIMAL(38,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id   BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount       DECIMAL(38,2) NOT NULL CHECK (amount > 0),
  method       VARCHAR(32) NOT NULL,   -- cash_on_delivery | cash | check | bank_transfer | card | other
  reference    VARCHAR(255),
  paid_at      DATE NOT NULL DEFAULT CURRENT_DATE,
  notes        TEXT,
  recorded_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);

-- ---------- returns ----------
CREATE TABLE IF NOT EXISTS return_requests (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id        BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  rma_number      VARCHAR(32) NOT NULL,
  status          VARCHAR(32) NOT NULL DEFAULT 'requested', -- requested | approved | rejected | received | closed
  reason          VARCHAR(64) NOT NULL,
  customer_notes  TEXT,
  staff_notes     TEXT,
  resolution      VARCHAR(32),                               -- credit_invoice | refund
  warehouse_id    BIGINT REFERENCES warehouses(id) ON DELETE SET NULL,
  credit_note_id  BIGINT,
  approved_at     TIMESTAMPTZ(6),
  received_at     TIMESTAMPTZ(6),
  closed_at       TIMESTAMPTZ(6),
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT return_requests_company_number_unique UNIQUE (company_id, rma_number)
);
CREATE INDEX IF NOT EXISTS idx_return_requests_company_status ON return_requests(company_id, status);

CREATE TABLE IF NOT EXISTS return_items (
  id                 BIGSERIAL PRIMARY KEY,
  return_id          BIGINT NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  order_item_id      BIGINT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  product_id         BIGINT REFERENCES products(id) ON DELETE SET NULL,
  quantity           INT NOT NULL CHECK (quantity > 0),
  quantity_received  INT NOT NULL DEFAULT 0,
  condition          VARCHAR(32),          -- resellable | damaged | expired
  restock            BOOLEAN NOT NULL DEFAULT true
);

-- ---------- credit notes ----------
CREATE TABLE IF NOT EXISTS credit_notes (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  invoice_id          BIGINT REFERENCES invoices(id) ON DELETE SET NULL,
  return_id           BIGINT REFERENCES return_requests(id) ON DELETE SET NULL,
  credit_note_number  VARCHAR(32) NOT NULL,
  status              VARCHAR(32) NOT NULL DEFAULT 'issued', -- issued | applied | refunded | void
  reason              VARCHAR(255),
  subtotal            DECIMAL(38,2) NOT NULL DEFAULT 0,
  tax_amount          DECIMAL(38,2) NOT NULL DEFAULT 0,
  total_amount        DECIMAL(38,2) NOT NULL DEFAULT 0,
  amount_applied      DECIMAL(38,2) NOT NULL DEFAULT 0,
  amount_refunded     DECIMAL(38,2) NOT NULL DEFAULT 0,
  notes               TEXT,
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT credit_notes_company_number_unique UNIQUE (company_id, credit_note_number)
);
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes(invoice_id);

CREATE TABLE IF NOT EXISTS credit_note_items (
  id              BIGSERIAL PRIMARY KEY,
  credit_note_id  BIGINT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  product_id      BIGINT REFERENCES products(id) ON DELETE SET NULL,
  description     VARCHAR(500) NOT NULL,
  quantity        INT NOT NULL,
  unit_price      DECIMAL(38,4) NOT NULL,
  line_total      DECIMAL(38,2) NOT NULL
);

-- ---------- quotes ----------
CREATE TABLE IF NOT EXISTS quotes (
  id               BIGSERIAL PRIMARY KEY,
  company_id       BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quote_number     VARCHAR(32) NOT NULL,
  status           VARCHAR(32) NOT NULL DEFAULT 'draft', -- requested | draft | sent | accepted | declined | expired | cancelled
  valid_until      DATE,
  subtotal         DECIMAL(38,2) NOT NULL DEFAULT 0,
  discount_amount  DECIMAL(38,2) NOT NULL DEFAULT 0,
  tax_amount       DECIMAL(38,2) NOT NULL DEFAULT 0,
  shipping_amount  DECIMAL(38,2) NOT NULL DEFAULT 0,
  total_amount     DECIMAL(38,2) NOT NULL DEFAULT 0,
  customer_notes   TEXT,
  notes            TEXT,
  order_id         BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  sent_at          TIMESTAMPTZ(6),
  accepted_at      TIMESTAMPTZ(6),
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT quotes_company_number_unique UNIQUE (company_id, quote_number)
);
CREATE INDEX IF NOT EXISTS idx_quotes_company_status ON quotes(company_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);

CREATE TABLE IF NOT EXISTS quote_items (
  id           BIGSERIAL PRIMARY KEY,
  quote_id     BIGINT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id   BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  description  VARCHAR(500),
  quantity     INT NOT NULL CHECK (quantity > 0),
  unit_price   DECIMAL(38,4) NOT NULL DEFAULT 0,
  line_total   DECIMAL(38,2) NOT NULL DEFAULT 0
);

-- ---------- email attachments (generated when the email is sent) ----------
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS attachments JSONB;

-- ---------- backfill ----------
-- Existing orders: subtotal = total - shipping; payment method cash on delivery.
UPDATE orders SET subtotal_amount = COALESCE(total_amount, 0) - COALESCE(shipping_amount, 0) WHERE subtotal_amount IS NULL;
UPDATE orders SET payment_method = 'cash_on_delivery' WHERE payment_method IS NULL;
UPDATE order_items SET list_price = price_at_time WHERE list_price IS NULL;

-- Every buyer who already ordered from a company gets a customer account there.
INSERT INTO company_customers (company_id, user_id)
SELECT DISTINCT o.company_id, o.user_id FROM orders o
WHERE o.company_id IS NOT NULL AND o.user_id IS NOT NULL
ON CONFLICT (company_id, user_id) DO NOTHING;
