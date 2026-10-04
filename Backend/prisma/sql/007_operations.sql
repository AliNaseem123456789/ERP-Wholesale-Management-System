-- =============================================================================
-- 007: operations. In-app notifications, per-state tobacco tax & compliance
--      rules, customer tobacco licences, scheduled email reports, and the
--      product / order / invoice columns they need. ADDITIVE ONLY. Safe to re-run.
-- =============================================================================

-- ---- notifications centre ----
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  type        VARCHAR(48) NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        VARCHAR(1000),
  link        VARCHAR(500),
  dedupe_key  VARCHAR(160),          -- same key for the same user = one notification (e.g. daily alerts)
  read_at     TIMESTAMPTZ(6),
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedupe_unique ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ---- tobacco / vapor compliance ----
ALTER TABLE products ADD COLUMN IF NOT EXISTS compliance_category VARCHAR(32) NOT NULL DEFAULT 'none';
  -- none | cigarettes | cigars | smokeless | pipe_tobacco | vapor_closed | vapor_open | e_liquid | nicotine_pouch | other_tobacco
ALTER TABLE products ADD COLUMN IF NOT EXISTS nicotine_ml DECIMAL(10,3);          -- liquid volume per unit (per-ml taxes)
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_flavored BOOLEAN NOT NULL DEFAULT false; -- characterising flavour (other than tobacco)

CREATE TABLE IF NOT EXISTS compliance_rules (
  id                BIGSERIAL PRIMARY KEY,
  company_id        BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  state             VARCHAR(2) NOT NULL,          -- US state code
  category          VARCHAR(32) NOT NULL DEFAULT '*', -- product compliance category, '*' = every regulated category
  tax_type          VARCHAR(16) NOT NULL DEFAULT 'none', -- none | percent | per_ml | per_unit
  tax_rate          DECIMAL(12,4) NOT NULL DEFAULT 0,
  flavor_ban        BOOLEAN NOT NULL DEFAULT false,
  license_required  BOOLEAN NOT NULL DEFAULT false,
  ship_banned       BOOLEAN NOT NULL DEFAULT false,
  age_verification  BOOLEAN NOT NULL DEFAULT false,
  report_shipments  BOOLEAN NOT NULL DEFAULT false,  -- include in the state shipment report (e.g. PACT Act)
  notes             VARCHAR(1000),
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT compliance_rules_unique UNIQUE (company_id, state, category)
);

CREATE TABLE IF NOT EXISTS customer_licenses (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state           VARCHAR(2) NOT NULL,
  license_number  VARCHAR(128) NOT NULL,
  expires_on      DATE,
  notes           VARCHAR(500),
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT customer_licenses_unique UNIQUE (company_id, user_id, state)
);

ALTER TABLE orders   ADD COLUMN IF NOT EXISTS excise_amount DECIMAL(38,2) NOT NULL DEFAULT 0;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS compliance JSONB;   -- { state, lines: [...], flags: [...] }
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS excise_amount DECIMAL(38,2) NOT NULL DEFAULT 0;
ALTER TABLE quotes   ADD COLUMN IF NOT EXISTS excise_amount DECIMAL(38,2) NOT NULL DEFAULT 0;

-- ---- scheduled reports ----
CREATE TABLE IF NOT EXISTS report_schedules (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  report       VARCHAR(48) NOT NULL,
  frequency    VARCHAR(16) NOT NULL,            -- daily | weekly | monthly
  day_of_week  INT,                             -- weekly: 0 = Sunday
  day_of_month INT,                             -- monthly: 1-28
  hour         INT NOT NULL DEFAULT 8,          -- local hour 0-23
  timezone     VARCHAR(64) NOT NULL DEFAULT 'UTC',
  recipients   TEXT[] NOT NULL DEFAULT '{}',
  is_active    BOOLEAN NOT NULL DEFAULT true,
  next_run_at  TIMESTAMPTZ(6),
  last_run_at  TIMESTAMPTZ(6),
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_schedules_due ON report_schedules(next_run_at) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS report_runs (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  schedule_id  BIGINT REFERENCES report_schedules(id) ON DELETE SET NULL,
  report       VARCHAR(48) NOT NULL,
  title        VARCHAR(255) NOT NULL,
  period_from  DATE,
  period_to    DATE,
  row_count    INT NOT NULL DEFAULT 0,
  csv          TEXT NOT NULL DEFAULT '',
  summary      JSONB NOT NULL DEFAULT '[]'::jsonb,
  status       VARCHAR(16) NOT NULL DEFAULT 'ok',   -- ok | failed
  error        TEXT,
  recipients   TEXT[] NOT NULL DEFAULT '{}',
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_runs_company ON report_runs(company_id, created_at DESC);
