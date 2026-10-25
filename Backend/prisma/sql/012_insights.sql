-- =============================================================================
-- 012: seller analytics, sales & storefront offers, platform commission, reviews, reports.
--   - analytics_events: storefront / product views, search impressions, add-to-cart (no personal data: visitor is a hash)
--   - products.sale_*: a time-limited % off for every buyer; promotions.show_on_storefront
--   - orders.commission_*: the platform commission rate is copied onto each new order (trigger);
--     commission_statements group delivered orders per company and period
--   - reviews: verified-buyer ratings of products and suppliers, seller replies, moderation
--   - issue_reports: problems reported by buyers (a listing, an order, a seller) for the platform team
-- ADDITIVE ONLY: new tables and columns. Existing rows are not changed. Safe to run more than once.
-- =============================================================================

-- ---- analytics -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_events (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id  BIGINT REFERENCES products(id) ON DELETE SET NULL,
  kind        VARCHAR(24) NOT NULL,          -- storefront_view | product_view | search_impression | add_to_cart
  query       VARCHAR(200),                  -- search words (search_impression)
  visitor     VARCHAR(64) NOT NULL,          -- sha256 of the user id or of a random browser id; never an IP or email
  is_buyer    BOOLEAN NOT NULL DEFAULT false,-- signed in when it happened
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT analytics_events_kind_check CHECK (kind IN ('storefront_view','product_view','search_impression','add_to_cart'))
);
CREATE INDEX IF NOT EXISTS idx_analytics_company_time ON analytics_events(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_product_time ON analytics_events(product_id, created_at DESC) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_dedupe ON analytics_events(visitor, kind, created_at DESC);

-- ---- sales and offers ----------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_percent   NUMERIC(5,2);      -- % off the base price for every buyer
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_starts_at TIMESTAMPTZ(6);
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_ends_at   TIMESTAMPTZ(6);
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_label     VARCHAR(60);       -- e.g. "Summer sale"
DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_sale_percent_check CHECK (sale_percent IS NULL OR (sale_percent > 0 AND sale_percent < 100));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_products_on_sale ON products(company_id) WHERE sale_percent IS NOT NULL;

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS show_on_storefront BOOLEAN NOT NULL DEFAULT false; -- advertise the code publicly

-- ---- platform commission -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commission_statements (
  id                BIGSERIAL PRIMARY KEY,
  company_id        BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  statement_number  VARCHAR(32) NOT NULL,
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  order_count       INT NOT NULL DEFAULT 0,
  sales_amount      NUMERIC(38,2) NOT NULL DEFAULT 0,   -- commissionable sales (subtotal - discounts - credits)
  commission_amount NUMERIC(38,2) NOT NULL DEFAULT 0,
  status            VARCHAR(16) NOT NULL DEFAULT 'issued', -- issued | paid | void
  paid_at           TIMESTAMPTZ(6),
  payment_reference VARCHAR(120),
  notes             TEXT,
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT commission_statements_status_check CHECK (status IN ('issued','paid','void')),
  CONSTRAINT commission_statements_number_unique UNIQUE (statement_number)
);
CREATE INDEX IF NOT EXISTS idx_commission_statements_company ON commission_statements(company_id, period_start DESC);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_rate         NUMERIC(5,2);   -- copied from the company when the order is created
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_amount       NUMERIC(38,2);  -- set when the order goes on a statement
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_statement_id BIGINT REFERENCES commission_statements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_commission_statement ON orders(commission_statement_id);

CREATE OR REPLACE FUNCTION orders_copy_commission_rate() RETURNS trigger AS $$
BEGIN
  IF NEW.commission_rate IS NULL AND NEW.company_id IS NOT NULL THEN
    SELECT commission_rate INTO NEW.commission_rate FROM companies WHERE id = NEW.company_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_orders_commission_rate ON orders;
CREATE TRIGGER trg_orders_commission_rate BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION orders_copy_commission_rate();

-- ---- reviews -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id    BIGINT REFERENCES products(id) ON DELETE CASCADE,   -- NULL = a review of the supplier
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id      BIGINT REFERENCES orders(id) ON DELETE SET NULL,     -- the delivered order that makes it "verified"
  rating        SMALLINT NOT NULL,
  title         VARCHAR(120),
  body          TEXT,
  status        VARCHAR(16) NOT NULL DEFAULT 'published',             -- published | hidden
  hidden_reason VARCHAR(255),
  seller_reply  TEXT,
  replied_at    TIMESTAMPTZ(6),
  replied_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT reviews_status_check CHECK (status IN ('published','hidden'))
);
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_product ON reviews(user_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_supplier ON reviews(user_id, company_id) WHERE product_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, created_at DESC) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_company ON reviews(company_id, created_at DESC);

-- ---- reports -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS issue_reports (
  id               BIGSERIAL PRIMARY KEY,
  report_number    VARCHAR(32) NOT NULL,
  reporter_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  kind             VARCHAR(16) NOT NULL,                 -- listing | order | seller | review
  reason           VARCHAR(40) NOT NULL,
  details          TEXT,
  company_id       BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  product_id       BIGINT REFERENCES products(id) ON DELETE SET NULL,
  order_id         BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  review_id        BIGINT REFERENCES reviews(id) ON DELETE SET NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'open',  -- open | in_review | resolved | dismissed
  seller_response  TEXT,
  seller_responded_at TIMESTAMPTZ(6),
  admin_note       TEXT,                                 -- internal
  resolution       TEXT,                                 -- shown to the reporter
  handled_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at      TIMESTAMPTZ(6),
  created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT issue_reports_kind_check CHECK (kind IN ('listing','order','seller','review')),
  CONSTRAINT issue_reports_status_check CHECK (status IN ('open','in_review','resolved','dismissed')),
  CONSTRAINT issue_reports_number_unique UNIQUE (report_number)
);
CREATE INDEX IF NOT EXISTS idx_issue_reports_status ON issue_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_reports_company ON issue_reports(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_reports_reporter ON issue_reports(reporter_id, created_at DESC);
