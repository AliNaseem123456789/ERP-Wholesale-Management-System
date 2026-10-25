-- =============================================================================
-- 010: buyer features.
--   - several live carts per user (e.g. one per store); every existing cart line goes into a "Main cart"
--   - saved carts can be shared with the account's sub-accounts
--   - recurring orders (weekly / every 2 weeks / monthly), placed automatically or prepared for review
--   - back-in-stock alerts
--   - pre-orders against incoming purchase orders (per product, off by default)
-- ADDITIVE: new tables and columns; existing cart lines only get their new cart_id filled in.
-- The cart line uniqueness is WIDENED from (user, product, variant) to (cart, product, variant) so the
-- same product can be in two carts. No row is deleted. Safe to run more than once.
-- =============================================================================

-- ---------- carts ----------
CREATE TABLE IF NOT EXISTS carts (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(120) NOT NULL DEFAULT 'Main cart',
  notes        VARCHAR(500),
  address_id   BIGINT REFERENCES addresses(id) ON DELETE SET NULL,  -- usual delivery address (e.g. a store)
  is_default   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carts_user ON carts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS carts_one_default_per_user ON carts(user_id) WHERE is_default;

ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS cart_id BIGINT REFERENCES carts(id) ON DELETE CASCADE;

-- a "Main cart" for everyone who has cart lines, then the lines move into it
INSERT INTO carts (user_id, name, is_default)
SELECT DISTINCT ci.user_id, 'Main cart', true FROM cart_items ci
WHERE NOT EXISTS (SELECT 1 FROM carts c WHERE c.user_id = ci.user_id AND c.is_default);
UPDATE cart_items ci SET cart_id = c.id FROM carts c
WHERE ci.cart_id IS NULL AND c.user_id = ci.user_id AND c.is_default;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_cart_product_flavor_unique') THEN
    ALTER TABLE cart_items ADD CONSTRAINT cart_items_cart_product_flavor_unique UNIQUE (cart_id, product_id, flavor);
  END IF;
END $$;
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_product_flavor_unique;
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);

-- ---------- saved carts shared with the team ----------
ALTER TABLE saved_carts ADD COLUMN IF NOT EXISTS shared_with_team BOOLEAN NOT NULL DEFAULT false;

-- ---------- recurring orders ----------
CREATE TABLE IF NOT EXISTS recurring_orders (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 VARCHAR(120) NOT NULL,
  frequency            VARCHAR(16) NOT NULL,              -- weekly | biweekly | monthly
  day_of_week          INT,                               -- 0 = Sunday ... 6 (weekly / biweekly)
  day_of_month         INT,                               -- 1..28 (monthly)
  next_run_on          DATE NOT NULL,
  mode                 VARCHAR(16) NOT NULL DEFAULT 'review',  -- auto (place the order) | review (prepare a cart to check)
  status               VARCHAR(16) NOT NULL DEFAULT 'active',  -- active | paused | cancelled
  shipping_address_id  BIGINT REFERENCES addresses(id) ON DELETE SET NULL,
  billing_address_id   BIGINT REFERENCES addresses(id) ON DELETE SET NULL,
  payment_methods      JSONB NOT NULL DEFAULT '{}',       -- { companyId: cash_on_delivery | on_account }
  skip_next            BOOLEAN NOT NULL DEFAULT false,
  last_run_at          TIMESTAMPTZ(6),
  last_result          JSONB,                             -- { ok, message, order_numbers, cart_id }
  created_at           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT recurring_orders_frequency_check CHECK (frequency IN ('weekly','biweekly','monthly')),
  CONSTRAINT recurring_orders_mode_check CHECK (mode IN ('auto','review')),
  CONSTRAINT recurring_orders_status_check CHECK (status IN ('active','paused','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_recurring_orders_due ON recurring_orders(next_run_on) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_recurring_orders_user ON recurring_orders(user_id);

CREATE TABLE IF NOT EXISTS recurring_order_items (
  id                  BIGSERIAL PRIMARY KEY,
  recurring_order_id  BIGINT NOT NULL REFERENCES recurring_orders(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  flavor              VARCHAR(255) NOT NULL DEFAULT '',
  quantity            INT NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_recurring_order_items_order ON recurring_order_items(recurring_order_id);

-- orders that came from a recurring order
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recurring_order_id BIGINT REFERENCES recurring_orders(id) ON DELETE SET NULL;

-- ---------- back-in-stock alerts ----------
CREATE TABLE IF NOT EXISTS stock_alerts (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id   BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  flavor       VARCHAR(255) NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  notified_at  TIMESTAMPTZ(6),
  CONSTRAINT stock_alerts_unique UNIQUE (user_id, product_id, flavor)
);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_waiting ON stock_alerts(product_id) WHERE notified_at IS NULL;

-- ---------- pre-orders ----------
ALTER TABLE products    ADD COLUMN IF NOT EXISTS allow_preorder   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS preorder_quantity INT NOT NULL DEFAULT 0;  -- part ordered ahead of incoming stock
