-- =============================================================================
-- 005: accounting. Chart of accounts, double-entry general ledger, supplier bills
--      (accounts payable), bill payments, supplier credits, expenses and bank
--      reconciliation. ADDITIVE ONLY. Safe to run more than once.
-- Accounting is switched on per company (companies.settings.accounting); until
-- then nothing is posted.
-- =============================================================================

CREATE TABLE IF NOT EXISTS accounts (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code         VARCHAR(16) NOT NULL,
  name         VARCHAR(255) NOT NULL,
  type         VARCHAR(16) NOT NULL,          -- asset | liability | equity | revenue | expense
  subtype      VARCHAR(32) NOT NULL,          -- cash | bank | receivable | inventory | current_asset | fixed_asset | payable | current_liability | long_term_liability | equity | income | other_income | contra_revenue | cogs | expense | other_expense
  system_key   VARCHAR(32),                   -- accounts the system posts to automatically (ar, ap, sales, cogs ...)
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT accounts_company_code_unique UNIQUE (company_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_company_system_key_unique ON accounts(company_id, system_key) WHERE system_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS journal_entries (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_number    VARCHAR(32) NOT NULL,
  entry_date      DATE NOT NULL,
  memo            VARCHAR(500),
  source_type     VARCHAR(32) NOT NULL,       -- invoice | invoice_payment | credit_note | credit_refund | shipment | customer_return | goods_receipt | stock_adjustment | transfer_loss | supplier_return | vendor_credit | bill | bill_payment | expense | manual | opening_balance
  source_id       VARCHAR(64),
  reversal_of_id  BIGINT REFERENCES journal_entries(id) ON DELETE SET NULL,
  reversed        BOOLEAN NOT NULL DEFAULT false,
  total           DECIMAL(38,2) NOT NULL DEFAULT 0,
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT journal_entries_company_number_unique UNIQUE (company_id, entry_number)
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company_date ON journal_entries(company_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries(company_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS journal_lines (
  id                 BIGSERIAL PRIMARY KEY,
  entry_id           BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  company_id         BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id         BIGINT NOT NULL REFERENCES accounts(id),
  debit              DECIMAL(38,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit             DECIMAL(38,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description        VARCHAR(500),
  customer_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  supplier_id        BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  cleared            BOOLEAN NOT NULL DEFAULT false,         -- bank reconciliation
  reconciliation_id  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_company_account ON journal_lines(company_id, account_id);

-- ---------- accounts payable ----------
CREATE TABLE IF NOT EXISTS bills (
  id                       BIGSERIAL PRIMARY KEY,
  company_id               BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id              BIGINT NOT NULL REFERENCES suppliers(id),
  purchase_order_id        BIGINT REFERENCES purchase_orders(id) ON DELETE SET NULL,
  bill_number              VARCHAR(32) NOT NULL,          -- our number (BILL-00001)
  supplier_invoice_number  VARCHAR(255),                  -- their invoice number
  status                   VARCHAR(32) NOT NULL DEFAULT 'open',  -- open | partially_paid | paid | void
  bill_date                DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date                 DATE NOT NULL DEFAULT CURRENT_DATE,
  total_amount             DECIMAL(38,2) NOT NULL DEFAULT 0,
  amount_paid              DECIMAL(38,2) NOT NULL DEFAULT 0,
  amount_credited          DECIMAL(38,2) NOT NULL DEFAULT 0,
  notes                    TEXT,
  created_by               BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  voided_at                TIMESTAMPTZ(6),
  CONSTRAINT bills_company_number_unique UNIQUE (company_id, bill_number)
);
CREATE INDEX IF NOT EXISTS idx_bills_company_status ON bills(company_id, status);
CREATE INDEX IF NOT EXISTS idx_bills_supplier ON bills(supplier_id);

CREATE TABLE IF NOT EXISTS bill_items (
  id           BIGSERIAL PRIMARY KEY,
  bill_id      BIGINT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  account_id   BIGINT NOT NULL REFERENCES accounts(id),
  product_id   BIGINT REFERENCES products(id) ON DELETE SET NULL,
  description  VARCHAR(500) NOT NULL,
  quantity     DECIMAL(38,4) NOT NULL DEFAULT 1,
  unit_cost    DECIMAL(38,4) NOT NULL DEFAULT 0,
  line_total   DECIMAL(38,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bill_payments (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bill_id      BIGINT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  account_id   BIGINT NOT NULL REFERENCES accounts(id),   -- paid from (cash / bank)
  amount       DECIMAL(38,2) NOT NULL CHECK (amount > 0),
  method       VARCHAR(32) NOT NULL,
  reference    VARCHAR(255),
  paid_at      DATE NOT NULL DEFAULT CURRENT_DATE,
  notes        TEXT,
  recorded_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);

-- Credits from suppliers (e.g. for returned goods), applied against their bills.
CREATE TABLE IF NOT EXISTS vendor_credits (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id         BIGINT NOT NULL REFERENCES suppliers(id),
  supplier_return_id  BIGINT REFERENCES supplier_returns(id) ON DELETE SET NULL,
  credit_number       VARCHAR(32) NOT NULL,
  reference           VARCHAR(255),
  credit_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  amount              DECIMAL(38,2) NOT NULL CHECK (amount > 0),
  amount_applied      DECIMAL(38,2) NOT NULL DEFAULT 0,
  status              VARCHAR(32) NOT NULL DEFAULT 'open',  -- open | applied | void
  notes               TEXT,
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT vendor_credits_company_number_unique UNIQUE (company_id, credit_number)
);

CREATE TABLE IF NOT EXISTS vendor_credit_applications (
  id                BIGSERIAL PRIMARY KEY,
  vendor_credit_id  BIGINT NOT NULL REFERENCES vendor_credits(id) ON DELETE CASCADE,
  bill_id           BIGINT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amount            DECIMAL(38,2) NOT NULL CHECK (amount > 0),
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- ---------- expenses (paid straight away, no bill) ----------
CREATE TABLE IF NOT EXISTS expenses (
  id                    BIGSERIAL PRIMARY KEY,
  company_id            BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  expense_number        VARCHAR(32) NOT NULL,
  expense_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  payee                 VARCHAR(255) NOT NULL,
  account_id            BIGINT NOT NULL REFERENCES accounts(id),   -- expense account
  paid_from_account_id  BIGINT NOT NULL REFERENCES accounts(id),   -- cash / bank
  supplier_id           BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  amount                DECIMAL(38,2) NOT NULL CHECK (amount > 0),
  method                VARCHAR(32),
  reference             VARCHAR(255),
  notes                 TEXT,
  status                VARCHAR(16) NOT NULL DEFAULT 'posted',  -- posted | void
  created_by            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT expenses_company_number_unique UNIQUE (company_id, expense_number)
);
CREATE INDEX IF NOT EXISTS idx_expenses_company_date ON expenses(company_id, expense_date);

-- ---------- bank reconciliation ----------
CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id                 BIGSERIAL PRIMARY KEY,
  company_id         BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id         BIGINT NOT NULL REFERENCES accounts(id),
  statement_date     DATE NOT NULL,
  statement_balance  DECIMAL(38,2) NOT NULL,
  cleared_balance    DECIMAL(38,2) NOT NULL,
  lines_cleared      INT NOT NULL DEFAULT 0,
  notes              TEXT,
  created_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_account ON bank_reconciliations(account_id);

-- ---------- which cash/bank account money went in / out of ----------
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE credit_notes     ADD COLUMN IF NOT EXISTS refund_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL;
