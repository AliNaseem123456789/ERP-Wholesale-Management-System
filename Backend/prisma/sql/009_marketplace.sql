-- =============================================================================
-- 009: marketplace and company storefronts.
--   - public company profile fields (banner, tagline, public contact, delivery / payment terms, minimum order)
--   - collections: a company's own (or the platform's, company_id NULL), hand-picked and ordered products
--   - storefront configuration per company: a draft and a published version of predefined sections,
--     with a history of published versions
-- ADDITIVE ONLY: new tables and columns. Existing values are never changed. Safe to run more than once.
-- =============================================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS tagline              VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS banner_url           VARCHAR(1000);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS public_email         VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS public_phone         VARCHAR(64);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS delivery_info        TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS payment_info         TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS min_order_value      DECIMAL(38,2);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS lead_time_days       INT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_featured          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS storefront_published BOOLEAN NOT NULL DEFAULT true; -- admins can unpublish a storefront

-- ---------- collections ----------
CREATE TABLE IF NOT EXISTS collections (
  id               BIGSERIAL PRIMARY KEY,
  company_id       BIGINT REFERENCES companies(id) ON DELETE CASCADE,   -- NULL = platform (global) collection
  name             VARCHAR(255) NOT NULL,
  slug             VARCHAR(255) NOT NULL,
  description      TEXT,
  cover_image_url  VARCHAR(1000),
  mode             VARCHAR(16) NOT NULL DEFAULT 'manual',   -- manual (rule-based later)
  rules            JSONB NOT NULL DEFAULT '{}',             -- reserved for rule-based collections
  status           VARCHAR(16) NOT NULL DEFAULT 'draft',    -- draft | published
  is_enabled       BOOLEAN NOT NULL DEFAULT true,
  starts_at        TIMESTAMPTZ(6),
  ends_at          TIMESTAMPTZ(6),
  sort_order       INT NOT NULL DEFAULT 0,
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT collections_status_check CHECK (status IN ('draft','published')),
  CONSTRAINT collections_mode_check CHECK (mode IN ('manual','rules'))
);
CREATE UNIQUE INDEX IF NOT EXISTS collections_owner_slug_unique ON collections(COALESCE(company_id, 0), slug);
CREATE INDEX IF NOT EXISTS idx_collections_company ON collections(company_id, status);

CREATE TABLE IF NOT EXISTS collection_products (
  collection_id  BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id     BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_products_product ON collection_products(product_id);

-- ---------- storefronts ----------
-- draft / published hold the validated section list and theme: { theme, colors, sections: [...] }
CREATE TABLE IF NOT EXISTS storefronts (
  company_id         BIGINT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  draft              JSONB NOT NULL DEFAULT '{}',
  published          JSONB,
  published_version  INT NOT NULL DEFAULT 0,
  published_at       TIMESTAMPTZ(6),
  published_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_by         BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS storefront_versions (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  version       INT NOT NULL,
  config        JSONB NOT NULL,
  published_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT storefront_versions_unique UNIQUE (company_id, version)
);

CREATE INDEX IF NOT EXISTS idx_products_published ON products(published_at DESC) WHERE status = 'published';
