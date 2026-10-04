-- =============================================================================
-- 004: stock per flavour, landed costs on goods receipts, in-transit transfers,
--      returns to suppliers. ADDITIVE: only new tables/columns. Two unique
--      constraints are WIDENED (cart lines and stock levels now also key on the
--      flavour); no rows are changed or removed. Safe to run more than once.
-- =============================================================================

-- ---------- flavours (variants) ----------
-- One row per flavour of a product, for its own SKU and barcode. The flavour list itself stays in products.flavors.
CREATE TABLE IF NOT EXISTS product_variants (
  id          BIGSERIAL PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  flavor      VARCHAR(255) NOT NULL,
  sku         VARCHAR(255),
  barcode     VARCHAR(64),
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_product_flavor_unique UNIQUE (product_id, flavor)
);
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON product_variants(barcode);

INSERT INTO product_variants (product_id, flavor)
SELECT DISTINCT p.id, btrim(f) FROM products p, unnest(p.flavors) AS f
WHERE p.flavors IS NOT NULL AND btrim(f) <> ''
ON CONFLICT (product_id, flavor) DO NOTHING;

-- '' = no flavour (products without flavours, or stock recorded before flavours were tracked)
ALTER TABLE inventory_levels       ADD COLUMN IF NOT EXISTS flavor VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE inventory_lots         ADD COLUMN IF NOT EXISTS flavor VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE stock_movements        ADD COLUMN IF NOT EXISTS flavor VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE purchase_order_items   ADD COLUMN IF NOT EXISTS flavor VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE goods_receipt_items    ADD COLUMN IF NOT EXISTS flavor VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE stock_transfer_items   ADD COLUMN IF NOT EXISTS flavor VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE quote_items            ADD COLUMN IF NOT EXISTS flavor VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE cart_items             ADD COLUMN IF NOT EXISTS flavor VARCHAR(255) NOT NULL DEFAULT '';

-- stock levels: one row per warehouse + product + flavour
ALTER TABLE inventory_levels DROP CONSTRAINT IF EXISTS inventory_levels_warehouse_product_unique;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_levels_wh_product_flavor_unique') THEN
    ALTER TABLE inventory_levels ADD CONSTRAINT inventory_levels_wh_product_flavor_unique UNIQUE (warehouse_id, product_id, flavor);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_inventory_lots_wh_product_flavor ON inventory_lots(warehouse_id, product_id, flavor);

-- cart: the same product can be in the cart once per flavour
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_product_unique;
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS unique_user_product_cart;
DROP INDEX IF EXISTS cart_items_user_product_unique;
DROP INDEX IF EXISTS unique_user_product_cart;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_user_product_flavor_unique') THEN
    ALTER TABLE cart_items ADD CONSTRAINT cart_items_user_product_flavor_unique UNIQUE (user_id, product_id, flavor);
  END IF;
END $$;

-- ---------- landed costs ----------
-- Freight, duty and other costs of a delivery, spread over the received lines and added to their cost.
ALTER TABLE goods_receipts      ADD COLUMN IF NOT EXISTS landed_cost        DECIMAL(38,2) NOT NULL DEFAULT 0;
ALTER TABLE goods_receipts      ADD COLUMN IF NOT EXISTS landed_allocation  VARCHAR(16);           -- value | quantity
ALTER TABLE goods_receipts      ADD COLUMN IF NOT EXISTS landed_notes       VARCHAR(255);
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS landed_unit_cost   DECIMAL(38,4);         -- unit cost incl. landed costs

-- ---------- in-transit transfers ----------
-- status: completed (instant, as before) | in_transit | received | cancelled
ALTER TABLE stock_transfers      ADD COLUMN IF NOT EXISTS shipped_at     TIMESTAMPTZ(6);
ALTER TABLE stock_transfers      ADD COLUMN IF NOT EXISTS expected_date  DATE;
ALTER TABLE stock_transfers      ADD COLUMN IF NOT EXISTS received_at    TIMESTAMPTZ(6);
ALTER TABLE stock_transfers      ADD COLUMN IF NOT EXISTS received_by    BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stock_transfers      ADD COLUMN IF NOT EXISTS carrier        VARCHAR(255);
ALTER TABLE stock_transfers      ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(255);
ALTER TABLE stock_transfer_items ADD COLUMN IF NOT EXISTS quantity_received INT;
ALTER TABLE stock_transfer_items ADD COLUMN IF NOT EXISTS lots JSONB;   -- lots taken from the source: [{lot_number, expiry_date, unit_cost, quantity}]
UPDATE stock_transfer_items SET quantity_received = quantity
WHERE quantity_received IS NULL AND stock_transfer_id IN (SELECT id FROM stock_transfers WHERE status = 'completed');

-- ---------- returns to suppliers ----------
CREATE TABLE IF NOT EXISTS supplier_returns (
  id                 BIGSERIAL PRIMARY KEY,
  company_id         BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id        BIGINT NOT NULL REFERENCES suppliers(id),
  warehouse_id       BIGINT NOT NULL REFERENCES warehouses(id),
  purchase_order_id  BIGINT REFERENCES purchase_orders(id) ON DELETE SET NULL,
  return_number      VARCHAR(32) NOT NULL,
  status             VARCHAR(32) NOT NULL DEFAULT 'draft',  -- draft | shipped | credited | closed | cancelled
  reason             VARCHAR(64) NOT NULL,                   -- damaged | defective | expired | wrong_item | overstock | recall | other
  notes              TEXT,
  total_amount       DECIMAL(38,2) NOT NULL DEFAULT 0,       -- value of the goods at cost
  credit_amount      DECIMAL(38,2),                          -- what the supplier credited / refunded
  credit_reference   VARCHAR(255),
  shipped_at         TIMESTAMPTZ(6),
  credited_at        TIMESTAMPTZ(6),
  created_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT supplier_returns_company_number_unique UNIQUE (company_id, return_number)
);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_company_status ON supplier_returns(company_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_supplier ON supplier_returns(supplier_id);

CREATE TABLE IF NOT EXISTS supplier_return_items (
  id                  BIGSERIAL PRIMARY KEY,
  supplier_return_id  BIGINT NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
  product_id          BIGINT NOT NULL REFERENCES products(id),
  flavor              VARCHAR(255) NOT NULL DEFAULT '',
  lot_id              BIGINT REFERENCES inventory_lots(id) ON DELETE SET NULL,
  quantity            INT NOT NULL CHECK (quantity > 0),
  unit_cost           DECIMAL(38,4) NOT NULL DEFAULT 0,
  line_total          DECIMAL(38,2) NOT NULL DEFAULT 0
);
