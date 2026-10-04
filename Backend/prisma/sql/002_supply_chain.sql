-- =============================================================================
-- 002: supply chain: warehouses & bins, suppliers, stock levels, lots/expiry,
--      stock movement ledger, purchase orders, goods receipts, stock transfers.
-- ADDITIVE ONLY: new tables + new nullable/defaulted columns. Nothing is dropped,
-- renamed or deleted. Safe to run more than once.
-- =============================================================================

-- ---------- per-company document numbering (PO-00001, GRN-00001, TR-00001) ----------
CREATE TABLE IF NOT EXISTS company_sequences (
  company_id  BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key         VARCHAR(32) NOT NULL,
  value       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, key)
);

-- ---------- warehouses & bins ----------
CREATE TABLE IF NOT EXISTS warehouses (
  id             BIGSERIAL PRIMARY KEY,
  company_id     BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  code           VARCHAR(32)  NOT NULL,
  address_line1  VARCHAR(255),
  address_line2  VARCHAR(255),
  city           VARCHAR(255),
  state          VARCHAR(255),
  postal_code    VARCHAR(255),
  country        VARCHAR(255) DEFAULT 'USA',
  phone          VARCHAR(255),
  is_default     BOOLEAN NOT NULL DEFAULT false,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT warehouses_company_code_unique UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_warehouses_company ON warehouses(company_id);

CREATE TABLE IF NOT EXISTS warehouse_bins (
  id            BIGSERIAL PRIMARY KEY,
  warehouse_id  BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  code          VARCHAR(64) NOT NULL,
  description   VARCHAR(255),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_bins_warehouse_code_unique UNIQUE (warehouse_id, code)
);

-- ---------- suppliers ----------
CREATE TABLE IF NOT EXISTS suppliers (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  code                VARCHAR(64),
  contact_name        VARCHAR(255),
  email               VARCHAR(255),
  phone               VARCHAR(255),
  website             VARCHAR(255),
  address_line1       VARCHAR(255),
  address_line2       VARCHAR(255),
  city                VARCHAR(255),
  state               VARCHAR(255),
  postal_code         VARCHAR(255),
  country             VARCHAR(255) DEFAULT 'USA',
  tax_id              VARCHAR(255),
  payment_terms_days  INT NOT NULL DEFAULT 30,
  currency            VARCHAR(3) NOT NULL DEFAULT 'USD',
  notes               TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_company ON suppliers(company_id);

-- What a supplier sells us, at what price.
CREATE TABLE IF NOT EXISTS supplier_products (
  id              BIGSERIAL PRIMARY KEY,
  supplier_id     BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id      BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_sku    VARCHAR(255),
  unit_cost       DECIMAL(38,4) NOT NULL DEFAULT 0,
  lead_time_days  INT,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT supplier_products_supplier_product_unique UNIQUE (supplier_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_products_product ON supplier_products(product_id);

-- ---------- product fields for inventory & purchasing ----------
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price            DECIMAL(38,4) NOT NULL DEFAULT 0;   -- moving average cost
ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_point         INT NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_quantity      INT NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode               VARCHAR(64);
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit                  VARCHAR(32) NOT NULL DEFAULT 'each';
ALTER TABLE products ADD COLUMN IF NOT EXISTS preferred_supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_alerted_at  TIMESTAMPTZ(6);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

-- ---------- stock ----------
-- Totals per warehouse & product. on_hand always equals the sum of the product's lots in that warehouse.
CREATE TABLE IF NOT EXISTS inventory_levels (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warehouse_id  BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  on_hand       INT NOT NULL DEFAULT 0,
  reserved      INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT inventory_levels_warehouse_product_unique UNIQUE (warehouse_id, product_id),
  CONSTRAINT inventory_levels_non_negative CHECK (on_hand >= 0 AND reserved >= 0)
);
CREATE INDEX IF NOT EXISTS idx_inventory_levels_company_product ON inventory_levels(company_id, product_id);

-- Stock broken down by lot / expiry / bin. Stock without a lot number has lot_number NULL.
CREATE TABLE IF NOT EXISTS inventory_lots (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warehouse_id  BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  bin_id        BIGINT REFERENCES warehouse_bins(id) ON DELETE SET NULL,
  lot_number    VARCHAR(64),
  expiry_date   DATE,
  quantity      INT NOT NULL DEFAULT 0,
  unit_cost     DECIMAL(38,4),
  received_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT inventory_lots_non_negative CHECK (quantity >= 0)
);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_wh_product ON inventory_lots(warehouse_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_company_expiry ON inventory_lots(company_id, expiry_date);

-- Append-only ledger of every stock change.
CREATE TABLE IF NOT EXISTS stock_movements (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warehouse_id    BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id      BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  lot_id          BIGINT REFERENCES inventory_lots(id) ON DELETE SET NULL,
  quantity        INT NOT NULL,             -- + in, - out
  type            VARCHAR(32) NOT NULL,     -- receipt | adjustment | sale | transfer_in | transfer_out | return
  reason          VARCHAR(64),
  reference_type  VARCHAR(32),              -- purchase_order | order | transfer | adjustment
  reference_id    VARCHAR(64),
  unit_cost       DECIMAL(38,4),
  balance_after   INT,
  notes           TEXT,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_company_created ON stock_movements(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id, created_at DESC);

-- ---------- purchasing ----------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id         BIGINT NOT NULL REFERENCES suppliers(id),
  warehouse_id        BIGINT NOT NULL REFERENCES warehouses(id),
  po_number           VARCHAR(32) NOT NULL,
  status              VARCHAR(32) NOT NULL DEFAULT 'draft', -- draft | sent | partially_received | received | closed | cancelled
  order_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date       DATE,
  currency            VARCHAR(3) NOT NULL DEFAULT 'USD',
  subtotal            DECIMAL(38,2) NOT NULL DEFAULT 0,
  tax_amount          DECIMAL(38,2) NOT NULL DEFAULT 0,
  shipping_amount     DECIMAL(38,2) NOT NULL DEFAULT 0,
  total_amount        DECIMAL(38,2) NOT NULL DEFAULT 0,
  supplier_reference  VARCHAR(255),
  notes               TEXT,
  sent_at             TIMESTAMPTZ(6),
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT purchase_orders_company_number_unique UNIQUE (company_id, po_number)
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_company_status ON purchase_orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                 BIGSERIAL PRIMARY KEY,
  purchase_order_id  BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id         BIGINT NOT NULL REFERENCES products(id),
  description        VARCHAR(500),
  quantity_ordered   INT NOT NULL CHECK (quantity_ordered > 0),
  quantity_received  INT NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit_cost          DECIMAL(38,4) NOT NULL DEFAULT 0,
  line_total         DECIMAL(38,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id                 BIGSERIAL PRIMARY KEY,
  company_id         BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  purchase_order_id  BIGINT REFERENCES purchase_orders(id) ON DELETE SET NULL,
  warehouse_id       BIGINT NOT NULL REFERENCES warehouses(id),
  receipt_number     VARCHAR(32) NOT NULL,
  received_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  received_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  notes              TEXT,
  CONSTRAINT goods_receipts_company_number_unique UNIQUE (company_id, receipt_number)
);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_po ON goods_receipts(purchase_order_id);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id                      BIGSERIAL PRIMARY KEY,
  goods_receipt_id        BIGINT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id  BIGINT REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  product_id              BIGINT NOT NULL REFERENCES products(id),
  quantity                INT NOT NULL CHECK (quantity > 0),
  unit_cost               DECIMAL(38,4) NOT NULL DEFAULT 0,
  lot_id                  BIGINT REFERENCES inventory_lots(id) ON DELETE SET NULL
);

-- ---------- warehouse-to-warehouse transfers ----------
CREATE TABLE IF NOT EXISTS stock_transfers (
  id                 BIGSERIAL PRIMARY KEY,
  company_id         BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  transfer_number    VARCHAR(32) NOT NULL,
  from_warehouse_id  BIGINT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id    BIGINT NOT NULL REFERENCES warehouses(id),
  status             VARCHAR(32) NOT NULL DEFAULT 'completed',
  notes              TEXT,
  created_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_company_number_unique UNIQUE (company_id, transfer_number)
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id                 BIGSERIAL PRIMARY KEY,
  stock_transfer_id  BIGINT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id         BIGINT NOT NULL REFERENCES products(id),
  quantity           INT NOT NULL CHECK (quantity > 0)
);

-- ---------- order fulfilment ----------
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS warehouse_id      BIGINT REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS reserved_quantity INT NOT NULL DEFAULT 0;

-- ---------- backfill: every company gets a default "Main warehouse" ----------
INSERT INTO warehouses (company_id, name, code, is_default, city, state, country)
SELECT c.id, 'Main warehouse', 'MAIN', true, c.city, c.state, COALESCE(c.country, 'USA')
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.company_id = c.id);
