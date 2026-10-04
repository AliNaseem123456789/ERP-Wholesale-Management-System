-- =============================================================================
-- 006: HR & payroll. Departments, employees, pay components (allowances,
--      deductions, employer contributions), holidays, attendance, leave types &
--      requests, payroll runs and payslips. ADDITIVE ONLY. Safe to run more than once.
-- Payroll settings live in companies.settings.payroll (work days, hours per day,
-- overtime multiplier, income-tax brackets).
-- =============================================================================

CREATE TABLE IF NOT EXISTS departments (
  id                   BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                 VARCHAR(255) NOT NULL,
  code                 VARCHAR(32),
  description          TEXT,
  manager_employee_id  BIGINT,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT departments_company_name_unique UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS employees (
  id                       BIGSERIAL PRIMARY KEY,
  company_id               BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id                  BIGINT REFERENCES users(id) ON DELETE SET NULL,   -- linked login (self-service)
  employee_number          VARCHAR(32) NOT NULL,
  first_name               VARCHAR(255) NOT NULL,
  last_name                VARCHAR(255),
  email                    VARCHAR(255),
  phone                    VARCHAR(64),
  department_id            BIGINT REFERENCES departments(id) ON DELETE SET NULL,
  job_title                VARCHAR(255),
  employment_type          VARCHAR(16) NOT NULL DEFAULT 'full_time',   -- full_time | part_time | contract | intern
  status                   VARCHAR(16) NOT NULL DEFAULT 'active',      -- active | terminated
  hire_date                DATE NOT NULL DEFAULT CURRENT_DATE,
  termination_date         DATE,
  date_of_birth            DATE,
  national_id              VARCHAR(64),
  tax_number               VARCHAR(64),
  address                  TEXT,
  emergency_contact_name   VARCHAR(255),
  emergency_contact_phone  VARCHAR(64),
  pay_type                 VARCHAR(16) NOT NULL DEFAULT 'salary',      -- salary (monthly) | hourly
  base_salary              DECIMAL(38,2) NOT NULL DEFAULT 0,            -- per month
  hourly_rate              DECIMAL(38,4) NOT NULL DEFAULT 0,
  payment_method           VARCHAR(16) NOT NULL DEFAULT 'bank_transfer', -- bank_transfer | cash | check
  bank_name                VARCHAR(255),
  bank_account_number      VARCHAR(64),
  bank_routing             VARCHAR(64),
  notes                    TEXT,
  created_at               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT employees_company_number_unique UNIQUE (company_id, employee_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS employees_company_user_unique ON employees(company_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_company_status ON employees(company_id, status);

DO $$ BEGIN
  ALTER TABLE departments ADD CONSTRAINT departments_manager_fk FOREIGN KEY (manager_employee_id) REFERENCES employees(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allowances, deductions and employer contributions, defined once per company.
CREATE TABLE IF NOT EXISTS pay_components (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        VARCHAR(32) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  kind        VARCHAR(16) NOT NULL,                 -- earning | deduction | employer
  calc        VARCHAR(16) NOT NULL DEFAULT 'fixed', -- fixed | percent_base | percent_gross | tax_table
  amount      DECIMAL(38,2) NOT NULL DEFAULT 0,     -- default monthly amount (fixed)
  percent     DECIMAL(9,4) NOT NULL DEFAULT 0,      -- default % (percent_*)
  taxable     BOOLEAN NOT NULL DEFAULT true,        -- earnings: counts toward taxable pay
  applies_to_all BOOLEAN NOT NULL DEFAULT false,    -- every employee gets it unless overridden
  account_id  BIGINT REFERENCES accounts(id) ON DELETE SET NULL, -- optional GL account override
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT pay_components_company_code_unique UNIQUE (company_id, code)
);

-- Which components an employee gets, with optional amount / % overrides (or excluded).
CREATE TABLE IF NOT EXISTS employee_pay_components (
  id            BIGSERIAL PRIMARY KEY,
  employee_id   BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  component_id  BIGINT NOT NULL REFERENCES pay_components(id) ON DELETE CASCADE,
  amount        DECIMAL(38,2),
  percent       DECIMAL(9,4),
  excluded      BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT employee_pay_components_unique UNIQUE (employee_id, component_id)
);

CREATE TABLE IF NOT EXISTS holidays (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  name        VARCHAR(255) NOT NULL,
  CONSTRAINT holidays_company_date_unique UNIQUE (company_id, holiday_date)
);

CREATE TABLE IF NOT EXISTS leave_types (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  paid        BOOLEAN NOT NULL DEFAULT true,
  annual_days DECIMAL(6,2) NOT NULL DEFAULT 0,   -- 0 = no fixed allowance
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT leave_types_company_name_unique UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id   BIGINT NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  half_day        BOOLEAN NOT NULL DEFAULT false,
  days            DECIMAL(6,2) NOT NULL DEFAULT 0,      -- working days covered
  reason          TEXT,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled
  requested_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ(6),
  decision_notes  TEXT,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_company_status ON leave_requests(company_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id, start_date);

CREATE TABLE IF NOT EXISTS attendance (
  id                BIGSERIAL PRIMARY KEY,
  company_id        BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id       BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date         DATE NOT NULL,
  status            VARCHAR(16) NOT NULL,                 -- present | absent | half_day | paid_leave | unpaid_leave | holiday
  day_units         DECIMAL(3,2) NOT NULL DEFAULT 1,      -- share of the day the status covers (0.5 for a half-day leave)
  check_in          VARCHAR(5),                           -- HH:MM
  check_out         VARCHAR(5),
  hours             DECIMAL(6,2),
  overtime_hours    DECIMAL(6,2) NOT NULL DEFAULT 0,
  leave_request_id  BIGINT REFERENCES leave_requests(id) ON DELETE SET NULL,
  notes             VARCHAR(500),
  recorded_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT attendance_employee_date_unique UNIQUE (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_company_date ON attendance(company_id, work_date);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id               BIGSERIAL PRIMARY KEY,
  company_id       BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_number       VARCHAR(32) NOT NULL,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  pay_date         DATE NOT NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'draft',  -- draft | approved | paid | void
  employee_count   INT NOT NULL DEFAULT 0,
  total_gross      DECIMAL(38,2) NOT NULL DEFAULT 0,
  total_deductions DECIMAL(38,2) NOT NULL DEFAULT 0,
  total_employer   DECIMAL(38,2) NOT NULL DEFAULT 0,
  total_net        DECIMAL(38,2) NOT NULL DEFAULT 0,
  notes            TEXT,
  paid_account_id  BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  paid_reference   VARCHAR(255),
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ(6),
  paid_at          DATE,
  created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT payroll_runs_company_number_unique UNIQUE (company_id, run_number)
);
-- one live run per period
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_company_period_unique ON payroll_runs(company_id, period_start, period_end) WHERE status <> 'void';

CREATE TABLE IF NOT EXISTS payslips (
  id                BIGSERIAL PRIMARY KEY,
  company_id        BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payroll_run_id    BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id       BIGINT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  payslip_number    VARCHAR(48) NOT NULL,
  working_days      DECIMAL(6,2) NOT NULL DEFAULT 0,   -- in the period
  paid_days         DECIMAL(6,2) NOT NULL DEFAULT 0,   -- employed working days less unpaid days
  unpaid_days       DECIMAL(6,2) NOT NULL DEFAULT 0,
  hours_worked      DECIMAL(8,2) NOT NULL DEFAULT 0,
  overtime_hours    DECIMAL(8,2) NOT NULL DEFAULT 0,
  gross             DECIMAL(38,2) NOT NULL DEFAULT 0,
  taxable           DECIMAL(38,2) NOT NULL DEFAULT 0,
  total_deductions  DECIMAL(38,2) NOT NULL DEFAULT 0,
  employer_total    DECIMAL(38,2) NOT NULL DEFAULT 0,
  net               DECIMAL(38,2) NOT NULL DEFAULT 0,
  snapshot          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- employee name, title, department, bank, pay basis at the time
  warnings          JSONB NOT NULL DEFAULT '[]'::jsonb,
  emailed_at        TIMESTAMPTZ(6),
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT payslips_run_employee_unique UNIQUE (payroll_run_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips(employee_id);

CREATE TABLE IF NOT EXISTS payslip_lines (
  id            BIGSERIAL PRIMARY KEY,
  payslip_id    BIGINT NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  component_id  BIGINT REFERENCES pay_components(id) ON DELETE SET NULL,
  kind          VARCHAR(16) NOT NULL,       -- earning | deduction | employer
  code          VARCHAR(32),
  name          VARCHAR(255) NOT NULL,
  amount        DECIMAL(38,2) NOT NULL,
  taxable       BOOLEAN NOT NULL DEFAULT false,
  account_id    BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  is_manual     BOOLEAN NOT NULL DEFAULT false,  -- one-off line added to this payslip
  sort_order    INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_payslip_lines_payslip ON payslip_lines(payslip_id);
