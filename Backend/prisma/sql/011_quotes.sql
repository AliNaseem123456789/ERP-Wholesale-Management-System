-- =============================================================================
-- 011: quotes.
--   - requests for quotation sent to several sellers at once (rfqs, rfq_items; quotes.rfq_id)
--   - quote versions (a snapshot each time the seller sends) and a message thread with counter-offers
--   - follow-up / expiry reminder markers, lead time on quotes
-- ADDITIVE ONLY: new tables and columns. Existing quotes become version 1 when next sent. Safe to run more than once.
-- =============================================================================

CREATE TABLE IF NOT EXISTS rfqs (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rfq_number        VARCHAR(32) NOT NULL,
  title             VARCHAR(255) NOT NULL,
  notes             TEXT,
  needed_by         DATE,
  status            VARCHAR(16) NOT NULL DEFAULT 'open',   -- open | awarded | closed | cancelled
  awarded_quote_id  BIGINT,                                -- the quote that was accepted
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT rfqs_status_check CHECK (status IN ('open','awarded','closed','cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS rfqs_number_unique ON rfqs(rfq_number);
CREATE INDEX IF NOT EXISTS idx_rfqs_user ON rfqs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rfq_items (
  id           BIGSERIAL PRIMARY KEY,
  rfq_id       BIGINT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  description  VARCHAR(500) NOT NULL,                  -- what the buyer needs, in their words
  quantity     INT NOT NULL CHECK (quantity > 0),
  product_id   BIGINT REFERENCES products(id) ON DELETE SET NULL,  -- an example product, when they picked one
  flavor       VARCHAR(255) NOT NULL DEFAULT '',
  sort_order   INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rfq_items_rfq ON rfq_items(rfq_id);

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS rfq_id                  BIGINT REFERENCES rfqs(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS version                 INT NOT NULL DEFAULT 0;   -- number of times sent
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lead_time_days          INT;                      -- seller's delivery time for this offer
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS follow_up_sent_at       TIMESTAMPTZ(6);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at TIMESTAMPTZ(6);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS countered_at            TIMESTAMPTZ(6);
CREATE INDEX IF NOT EXISTS idx_quotes_rfq ON quotes(rfq_id);
UPDATE quotes SET version = 1 WHERE version = 0 AND sent_at IS NOT NULL;

-- what was sent each time (lines, totals, validity), so both sides can see how an offer changed
CREATE TABLE IF NOT EXISTS quote_versions (
  id          BIGSERIAL PRIMARY KEY,
  quote_id    BIGINT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  snapshot    JSONB NOT NULL,     -- { items: [{ title, quantity, unit_price, line_total }], subtotal, discount, shipping, tax, total, valid_until, lead_time_days }
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT quote_versions_unique UNIQUE (quote_id, version)
);

-- messages between buyer and seller; a customer message may carry a counter-offer
CREATE TABLE IF NOT EXISTS quote_messages (
  id          BIGSERIAL PRIMARY KEY,
  quote_id    BIGINT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  author_side VARCHAR(16) NOT NULL,                    -- customer | seller
  author_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT,
  proposal    JSONB,                                   -- { lines: [{ item_id, quantity?, unit_price? }], total? }
  version     INT,                                     -- the quote version it answers
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT quote_messages_side_check CHECK (author_side IN ('customer','seller'))
);
CREATE INDEX IF NOT EXISTS idx_quote_messages_quote ON quote_messages(quote_id, created_at);
