-- CPDA & Budget Fund Portal schema (PostgreSQL)
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  emp_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('FACULTY','HOD','ACCOUNTS_AR','ACCOUNTS_JUNIOR','REGISTRAR','DEAN_FAA','DIRECTOR','ADMIN')),
  department_id INT REFERENCES departments(id),
  designation TEXT,
  doj DATE,
  dor DATE,
  exit_type TEXT CHECK (exit_type IN ('RETIRE','RELEASE')),
  opted_out_joining_year BOOLEAN NOT NULL DEFAULT false,
  probation_cleared BOOLEAN NOT NULL DEFAULT true,
  on_leave_over_30 BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rules stored as data: a new office order only needs an edit here
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value NUMERIC NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS cpda_blocks (
  id SERIAL PRIMARY KEY,
  start_fy INT UNIQUE NOT NULL,       -- FY start year, e.g. 2024 = Apr 2024 - Mar 2025
  end_fy INT NOT NULL,
  label TEXT NOT NULL,                -- e.g. 2024-27
  active BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS cpda_accounts (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  block_id INT NOT NULL REFERENCES cpda_blocks(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, block_id)
);

CREATE SEQUENCE IF NOT EXISTS claim_seq START 1;

CREATE TABLE IF NOT EXISTS claims (
  id SERIAL PRIMARY KEY,
  claim_no TEXT UNIQUE,
  user_id INT NOT NULL REFERENCES users(id),
  account_id INT NOT NULL REFERENCES cpda_accounts(id),
  fy INT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CONFERENCE','CONTINGENT')),
  title TEXT NOT NULL,
  event_name TEXT, event_location TEXT,
  event_type TEXT CHECK (event_type IN ('National','International')),
  event_start DATE, event_end DATE,
  prior_approval_ref TEXT,
  attended BOOLEAN NOT NULL DEFAULT false,
  pay_to TEXT NOT NULL DEFAULT 'FACULTY' CHECK (pay_to IN ('FACULTY','VENDOR')),
  is_advance BOOLEAN NOT NULL DEFAULT false,
  special_request BOOLEAN NOT NULL DEFAULT false,
  special_reason TEXT,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_REVIEW','RETURNED','REJECTED','APPROVED','PAID')),
  current_step INT,
  violations JSONB NOT NULL DEFAULT '[]',
  assignee_id INT REFERENCES users(id),
  register_page TEXT, register_sr TEXT, stock_register_no TEXT, budget_head TEXT,
  amount_passed NUMERIC(12,2),
  paid_at TIMESTAMPTZ, payment_ref TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS claim_items (
  id SERIAL PRIMARY KEY,
  claim_id INT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  party TEXT NOT NULL,
  invoice_no TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  remarks TEXT
);

-- Bills stored inside PostgreSQL (bytea) with a SHA-256 hash for audit
CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  claim_id INT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL,
  sha256 TEXT NOT NULL,
  content BYTEA NOT NULL,
  uploaded_by INT REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals (
  id SERIAL PRIMARY KEY,
  claim_id INT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  step_label TEXT NOT NULL,
  actor_id INT REFERENCES users(id),
  actor_name TEXT,
  actor_role TEXT,
  decision TEXT NOT NULL,             -- SUBMITTED / APPROVED / REJECTED / RETURNED / ASSIGNED / PAID
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only ledger: balances are always computed from these rows
CREATE TABLE IF NOT EXISTS ledger_entries (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES cpda_accounts(id),
  fy INT NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('ALLOCATION','PRORATA','CARRY_IN','COMMITMENT','COMMITMENT_RELEASE','EXPENDITURE','ADJUSTMENT_CR','ADJUSTMENT_DR')),
  bucket TEXT CHECK (bucket IN ('CONFERENCE','CONTINGENCY')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  claim_id INT REFERENCES claims(id),
  particulars TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: post a correcting entry instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_no_change ON ledger_entries;
CREATE TRIGGER ledger_no_change BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  claim_id INT REFERENCES claims(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claims_user ON claims(user_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status, current_step);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
