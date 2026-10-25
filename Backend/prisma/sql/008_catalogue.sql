-- =============================================================================
-- 008: catalogue foundation for a general B2B marketplace.
--   - product lifecycle (draft / published / hidden / discontinued / archived), URL slugs,
--     minimum order quantity, order multiples, pack size, featured flag, image gallery
--   - categories as real records (from the existing free-text product categories)
--   - brands as real records with slugs + company <-> brand links (a brand can be sold by many companies)
--   - variants: options, own price, own cost, status, image, minimum order quantity
--     (stock keeps using the existing variant key, the `flavor` column, so no stock row changes)
--   - typed category attributes / specifications
--   - products visible only to selected customer groups
--
-- ADDITIVE ONLY: new tables, new columns, new indexes, triggers that fill the new columns.
-- Existing values are never changed or removed. One unique constraint is WIDENED
-- (price list tiers may now target one variant). Safe to run more than once.
-- =============================================================================

-- ---------- helper: URL slug ----------
CREATE OR REPLACE FUNCTION app_slugify(txt TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(left(trim(both '-' from regexp_replace(lower(COALESCE(txt, '')), '[^a-z0-9]+', '-', 'g')), 120), ''), 'item')
$$;

-- =============================================================================
-- Products
-- =============================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS status        VARCHAR(16) NOT NULL DEFAULT 'published';
ALTER TABLE products ADD COLUMN IF NOT EXISTS slug          VARCHAR(255);
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_id      BIGINT REFERENCES brands(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_order_qty INT NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS order_multiple INT NOT NULL DEFAULT 1;   -- sold in multiples of (e.g. 10 = cases of 10)
ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_size     INT;                        -- units inside one selling unit (information)
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_featured   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS visibility    VARCHAR(16) NOT NULL DEFAULT 'public'; -- public | groups
ALTER TABLE products ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ(6);
ALTER TABLE products ADD COLUMN IF NOT EXISTS short_description VARCHAR(500);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_status_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_status_check CHECK (status IN ('draft','published','hidden','discontinued','archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_visibility_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_visibility_check CHECK (visibility IN ('public','groups'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_order_qty_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_order_qty_check CHECK (min_order_qty >= 1 AND order_multiple >= 1 AND (pack_size IS NULL OR pack_size >= 1));
  END IF;
END $$;

-- lifecycle from the existing active flag (new column only)
UPDATE products SET status = 'hidden' WHERE is_active = false AND status = 'published';
UPDATE products SET published_at = COALESCE(created_at, now()) WHERE published_at IS NULL AND status = 'published';

-- slugs: "title" when unique, otherwise "title-<id>"
WITH base AS (
  SELECT id, app_slugify(title) AS s, count(*) OVER (PARTITION BY app_slugify(title)) AS n FROM products
)
UPDATE products p SET slug = CASE WHEN b.n = 1 THEN b.s ELSE b.s || '-' || p.id END
FROM base b WHERE b.id = p.id AND p.slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_slug_unique ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(company_id, status);
CREATE INDEX IF NOT EXISTS idx_products_brand_id ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(company_id, sku);

-- Keeps the old `is_active` flag and the new `status` in step whichever one a piece of code writes,
-- fills the slug and brand_id when a product is created or renamed.
CREATE OR REPLACE FUNCTION app_products_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  candidate TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS NULL OR (NEW.status = 'published' AND NEW.is_active = false) THEN
      NEW.status := CASE WHEN NEW.is_active THEN 'published' ELSE 'hidden' END;
    END IF;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NULL; -- status written explicitly: is_active follows below
    ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      NEW.status := CASE WHEN NEW.is_active THEN 'published' ELSE CASE WHEN OLD.status = 'published' THEN 'hidden' ELSE OLD.status END END;
    END IF;
  END IF;
  NEW.is_active := (NEW.status = 'published');
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;

  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    candidate := app_slugify(NEW.title);
    IF EXISTS (SELECT 1 FROM products WHERE slug = candidate AND id IS DISTINCT FROM NEW.id) THEN
      candidate := candidate || '-' || NEW.id;
    END IF;
    NEW.slug := candidate;
  END IF;

  IF NEW.brand IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.brand IS DISTINCT FROM OLD.brand) AND (TG_OP = 'INSERT' OR NEW.brand_id IS NOT DISTINCT FROM OLD.brand_id) THEN
    NEW.brand_id := (SELECT id FROM brands WHERE lower(name) = lower(trim(NEW.brand)) ORDER BY id LIMIT 1);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_products_sync ON products;
CREATE TRIGGER trg_products_sync BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION app_products_sync();

-- ---------- image gallery ----------
-- Products without gallery rows keep showing their original image (product-images/<id>/<n>.webp).
-- products.url is left alone: for imported products it holds the source page link, not an image.
CREATE TABLE IF NOT EXISTS product_images (
  id           BIGSERIAL PRIMARY KEY,
  product_id   BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_key  VARCHAR(255),                 -- shown for one variant (its `flavor` key); NULL = whole product
  url          VARCHAR(1000) NOT NULL,
  storage_path VARCHAR(500),                 -- object path when uploaded through the app
  alt_text     VARCHAR(255),
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order);
-- only products whose url really is an uploaded image get it as their first gallery image
INSERT INTO product_images (product_id, url, sort_order)
SELECT p.id, p.url, 0 FROM products p
WHERE p.url IS NOT NULL
  AND (p.url LIKE '%/storage/v1/object/public/product-images/%' OR p.url ~* '\.(jpe?g|png|webp|gif|avif)(\?.*)?$')
  AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id);

-- ---------- visible only to some customer groups ----------
CREATE TABLE IF NOT EXISTS product_visible_groups (
  product_id        BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_group_id BIGINT NOT NULL REFERENCES customer_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, customer_group_id)
);

-- =============================================================================
-- Categories (global; companies may add new ones)
-- =============================================================================
CREATE TABLE IF NOT EXISTS categories (
  id                     BIGSERIAL PRIMARY KEY,
  name                   VARCHAR(255) NOT NULL,
  slug                   VARCHAR(255) NOT NULL,
  parent_id              BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  description            TEXT,
  image_url              VARCHAR(1000),
  is_featured            BOOLEAN NOT NULL DEFAULT false,
  sort_order             INT NOT NULL DEFAULT 0,
  status                 VARCHAR(16) NOT NULL DEFAULT 'active',   -- active | hidden
  created_by_company_id  BIGINT REFERENCES companies(id) ON DELETE SET NULL,
  created_by             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT categories_slug_unique UNIQUE (slug)
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_parent_name_unique ON categories(COALESCE(parent_id, 0), lower(name));
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

CREATE TABLE IF NOT EXISTS product_categories (
  product_id   BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id  BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  sort_order   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_product_categories_category ON product_categories(category_id);

-- one category per distinct name (ignoring case/spaces), spelled the way most products spell it
WITH names AS (
  SELECT btrim(c) AS name, lower(btrim(c)) AS k, count(*) AS n
  FROM products p, unnest(p.categories) AS c
  WHERE btrim(c) <> '' GROUP BY 1, 2
), best AS (
  SELECT DISTINCT ON (k) k, name FROM names ORDER BY k, n DESC, name
), slugs AS (
  SELECT k, name, app_slugify(name) AS s, row_number() OVER (PARTITION BY app_slugify(name) ORDER BY name) AS rn FROM best
)
INSERT INTO categories (name, slug)
SELECT s.name, CASE WHEN s.rn = 1 THEN s.s ELSE s.s || '-' || s.rn END FROM slugs s
WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.parent_id IS NULL AND lower(c.name) = s.k)
ON CONFLICT DO NOTHING;

INSERT INTO product_categories (product_id, category_id, sort_order)
SELECT DISTINCT ON (p.id, c.id) p.id, c.id, x.ord - 1
FROM products p, unnest(p.categories) WITH ORDINALITY AS x(name, ord)
JOIN categories c ON c.parent_id IS NULL AND lower(c.name) = lower(btrim(x.name))
ORDER BY p.id, c.id, x.ord
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Brands
-- =============================================================================
ALTER TABLE brands ADD COLUMN IF NOT EXISTS slug        VARCHAR(255);
ALTER TABLE brands ADD COLUMN IF NOT EXISTS logo_url    VARCHAR(1000);
ALTER TABLE brands ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS website     VARCHAR(255);
ALTER TABLE brands ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now();
ALTER TABLE brands ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now();

WITH base AS (SELECT id, app_slugify(name) AS s, row_number() OVER (PARTITION BY app_slugify(name) ORDER BY id) AS rn FROM brands)
UPDATE brands b SET slug = CASE WHEN base.rn = 1 THEN base.s ELSE base.s || '-' || b.id END
FROM base WHERE base.id = b.id AND b.slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS brands_slug_unique ON brands(slug);

-- No two brands that differ only in capitals. Only added when the data allows it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'brands_name_lower_unique') THEN
    IF EXISTS (SELECT lower(btrim(name)) FROM brands GROUP BY 1 HAVING count(*) > 1) THEN
      RAISE NOTICE 'Brands differing only in capitals exist: merge them in Admin > Brands, then run: CREATE UNIQUE INDEX brands_name_lower_unique ON brands (lower(btrim(name)));';
    ELSE
      CREATE UNIQUE INDEX brands_name_lower_unique ON brands (lower(btrim(name)));
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_brands_slug() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate TEXT;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    candidate := app_slugify(NEW.name);
    IF EXISTS (SELECT 1 FROM brands WHERE slug = candidate AND id IS DISTINCT FROM NEW.id) THEN
      candidate := candidate || '-' || NEW.id;
    END IF;
    NEW.slug := candidate;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_brands_slug ON brands;
CREATE TRIGGER trg_brands_slug BEFORE INSERT OR UPDATE ON brands FOR EACH ROW EXECUTE FUNCTION app_brands_slug();

-- which companies sell a brand, and how (brands.company_id is kept as it was)
CREATE TABLE IF NOT EXISTS company_brands (
  company_id    BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  brand_id      BIGINT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  relationship  VARCHAR(32) NOT NULL DEFAULT 'reseller',  -- manufacturer | authorized_distributor | distributor | reseller
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, brand_id)
);
CREATE INDEX IF NOT EXISTS idx_company_brands_brand ON company_brands(brand_id);

INSERT INTO company_brands (company_id, brand_id)
SELECT company_id, id FROM brands WHERE company_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO company_brands (company_id, brand_id)
SELECT DISTINCT p.company_id, b.id FROM products p JOIN brands b ON lower(b.name) = lower(btrim(p.brand))
WHERE p.company_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- products -> brand record (the brand text stays)
UPDATE products p SET brand_id = b.id
FROM brands b WHERE p.brand_id IS NULL AND lower(b.name) = lower(btrim(p.brand));

-- =============================================================================
-- Variants (product_variants already holds one row per flavour; the key column stays `flavor`)
-- =============================================================================
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS name          VARCHAR(255);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS price         DECIMAL(38,2);   -- NULL = product price
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS cost_price    DECIMAL(38,4);   -- moving average for this variant; NULL = product cost
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS status        VARCHAR(16) NOT NULL DEFAULT 'active'; -- active | discontinued | archived
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS min_order_qty INT;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS image_url     VARCHAR(1000);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS sort_order    INT NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_status_check') THEN
    ALTER TABLE product_variants ADD CONSTRAINT product_variants_status_check CHECK (status IN ('active','discontinued','archived'));
  END IF;
END $$;
UPDATE product_variants v SET sort_order = x.ord - 1
FROM products p, unnest(p.flavors) WITH ORDINALITY AS x(f, ord)
WHERE p.id = v.product_id AND btrim(x.f) = v.flavor AND v.sort_order = 0 AND x.ord > 1;
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(sku);

-- price list tiers may target a single variant ('' = every variant of the product)
ALTER TABLE price_list_items ADD COLUMN IF NOT EXISTS flavor VARCHAR(255) NOT NULL DEFAULT '';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'price_list_items_variant_unique') THEN
    ALTER TABLE price_list_items ADD CONSTRAINT price_list_items_variant_unique UNIQUE (price_list_id, product_id, flavor, min_quantity);
  END IF;
END $$;
ALTER TABLE price_list_items DROP CONSTRAINT IF EXISTS price_list_items_unique;

-- =============================================================================
-- Attributes & specifications
-- =============================================================================
CREATE TABLE IF NOT EXISTS attribute_definitions (
  id                     BIGSERIAL PRIMARY KEY,
  company_id             BIGINT REFERENCES companies(id) ON DELETE CASCADE,  -- NULL = global (platform)
  key                    VARCHAR(64) NOT NULL,         -- stable internal key, e.g. "storage_capacity"
  name                   VARCHAR(255) NOT NULL,        -- display name
  description            VARCHAR(500),
  data_type              VARCHAR(16) NOT NULL,         -- text | number | boolean | date | select | multiselect
  unit                   VARCHAR(32),                  -- e.g. "ml", "GB"
  validation             JSONB NOT NULL DEFAULT '{}',  -- { min, max, maxLength, pattern } (checked by the API)
  scope                  VARCHAR(16) NOT NULL DEFAULT 'product',  -- product | variant | both
  is_variant_option      BOOLEAN NOT NULL DEFAULT false, -- may define purchasable variants
  is_filterable          BOOLEAN NOT NULL DEFAULT false,
  is_searchable          BOOLEAN NOT NULL DEFAULT false,
  is_public              BOOLEAN NOT NULL DEFAULT true,
  sort_order             INT NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT attribute_definitions_type_check CHECK (data_type IN ('text','number','boolean','date','select','multiselect')),
  CONSTRAINT attribute_definitions_scope_check CHECK (scope IN ('product','variant','both'))
);
CREATE UNIQUE INDEX IF NOT EXISTS attribute_definitions_key_unique ON attribute_definitions(COALESCE(company_id, 0), key);

CREATE TABLE IF NOT EXISTS attribute_options (
  id            BIGSERIAL PRIMARY KEY,
  attribute_id  BIGINT NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  value         VARCHAR(255) NOT NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attribute_options_value_unique ON attribute_options(attribute_id, lower(value));

CREATE TABLE IF NOT EXISTS category_attributes (
  category_id   BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  attribute_id  BIGINT NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  is_required   BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, attribute_id)
);

-- one row per value; typed columns so filters and sorting can use indexes
CREATE TABLE IF NOT EXISTS product_attribute_values (
  id             BIGSERIAL PRIMARY KEY,
  product_id     BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id     BIGINT REFERENCES product_variants(id) ON DELETE CASCADE,  -- NULL = whole product
  attribute_id   BIGINT NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  option_id      BIGINT REFERENCES attribute_options(id) ON DELETE CASCADE,
  value_text     TEXT,
  value_number   DECIMAL(38,6),
  value_boolean  BOOLEAN,
  value_date     DATE,
  created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_attribute_values_unique
  ON product_attribute_values(product_id, COALESCE(variant_id, 0), attribute_id, COALESCE(option_id, 0));
CREATE INDEX IF NOT EXISTS idx_pav_option ON product_attribute_values(attribute_id, option_id);
CREATE INDEX IF NOT EXISTS idx_pav_number ON product_attribute_values(attribute_id, value_number);
CREATE INDEX IF NOT EXISTS idx_pav_variant ON product_attribute_values(variant_id);

-- The existing flavours become values of a global "Flavour" option, so they show up as variant options.
INSERT INTO attribute_definitions (key, name, data_type, scope, is_variant_option, is_filterable, validation)
VALUES ('flavour', 'Flavour', 'select', 'variant', true, true, '{"open": true}')
ON CONFLICT DO NOTHING;
INSERT INTO attribute_options (attribute_id, value)
SELECT DISTINCT ON (lower(v.flavor)) a.id, v.flavor
FROM product_variants v, attribute_definitions a
WHERE a.company_id IS NULL AND a.key = 'flavour' AND v.flavor <> ''
ORDER BY lower(v.flavor), v.flavor
ON CONFLICT DO NOTHING;
INSERT INTO product_attribute_values (product_id, variant_id, attribute_id, option_id)
SELECT v.product_id, v.id, a.id, o.id
FROM product_variants v
JOIN attribute_definitions a ON a.company_id IS NULL AND a.key = 'flavour'
JOIN attribute_options o ON o.attribute_id = a.id AND lower(o.value) = lower(v.flavor)
WHERE v.flavor <> ''
ON CONFLICT DO NOTHING;

-- open orders that still hold stock until the seller confirms them (used by the checkout stock check)
CREATE INDEX IF NOT EXISTS idx_orders_company_status ON orders(company_id, status);
