-- Money Follows baseline schema. Source of truth: docs/DATABASE.md and docs/SECURITY.md.
-- Runs as mf_migrator. Roles must already exist (scripts/bootstrap_roles.sql).

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['mf_migrator', 'mf_definer', 'mf_app'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      RAISE EXCEPTION 'required role % is missing; run scripts/bootstrap_roles.sql first', r;
    END IF;
  END LOOP;
  IF current_user <> 'mf_migrator' THEN
    RAISE EXCEPTION 'migrations must run as mf_migrator, not %', current_user;
  END IF;
END
$$;

-- ---------------------------------------------------------------- schema and defaults
CREATE SCHEMA mf;
REVOKE ALL ON SCHEMA mf FROM PUBLIC;
GRANT USAGE ON SCHEMA mf TO mf_app, mf_definer;
ALTER DEFAULT PRIVILEGES IN SCHEMA mf REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA mf REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Supabase's API roles must have no access to schema mf (they may not exist outside Supabase).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA mf FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA mf FROM authenticated;
  END IF;
END
$$;

-- ---------------------------------------------------------------- context helpers
CREATE FUNCTION mf.current_business_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(pg_catalog.current_setting('app.current_business_id', true), '')::uuid $$;

CREATE FUNCTION mf.current_user_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid $$;

GRANT EXECUTE ON FUNCTION mf.current_business_id(), mf.current_user_id() TO mf_app, mf_definer;

CREATE FUNCTION mf.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$ BEGIN NEW.updated_at := pg_catalog.now(); RETURN NEW; END $$;

-- ---------------------------------------------------------------- tables
CREATE TABLE mf.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  default_language text NOT NULL DEFAULT 'en' CHECK (default_language IN ('en', 'te')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mf.user_profiles (
  user_id uuid PRIMARY KEY,
  display_name text CHECK (display_name IS NULL OR length(display_name) <= 80),
  preferred_language text NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'te')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mf.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES mf.businesses (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_business_user_uq UNIQUE (business_id, user_id),
  CONSTRAINT memberships_business_id_uq UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX memberships_one_owner_uq ON mf.memberships (business_id)
  WHERE role = 'owner' AND status = 'active';
CREATE INDEX memberships_user_active_idx ON mf.memberships (user_id) WHERE status = 'active';

CREATE TABLE mf.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES mf.businesses (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  name_normalized text GENERATED ALWAYS AS
    (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) STORED,
  phone text CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  preferred_language text NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'te')),
  is_active boolean NOT NULL DEFAULT true,
  anonymized_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_biz_id_uq UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX customers_phone_uq ON mf.customers (business_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX customers_name_idx ON mf.customers (business_id, name_normalized);
CREATE INDEX customers_active_idx ON mf.customers (business_id, is_active);

CREATE TABLE mf.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES mf.businesses (id) ON DELETE RESTRICT,
  created_by uuid NOT NULL,
  filename text NOT NULL CHECK (length(filename) <= 200),
  file_sha256 bytea NOT NULL,
  status text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'committed', 'expired')),
  total_rows integer NOT NULL CHECK (total_rows >= 0),
  valid_rows integer NOT NULL CHECK (valid_rows >= 0),
  error_rows integer NOT NULL CHECK (error_rows >= 0),
  preview_rows jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  committed_at timestamptz,
  committed_by uuid,
  CONSTRAINT import_batches_biz_id_uq UNIQUE (business_id, id),
  CONSTRAINT import_batches_committed_purged CHECK (status <> 'committed' OR preview_rows IS NULL)
);
CREATE INDEX import_batches_status_idx ON mf.import_batches (business_id, status, expires_at);

CREATE TABLE mf.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES mf.businesses (id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  invoice_number text NOT NULL CHECK (length(invoice_number) BETWEEN 1 AND 40),
  invoice_number_normalized text GENERATED ALWAYS AS
    (upper(regexp_replace(invoice_number, '\s+', '', 'g'))) STORED,
  invoice_date date NOT NULL,
  due_date date NOT NULL,
  fy_start_year smallint GENERATED ALWAYS AS
    ((EXTRACT(YEAR FROM invoice_date)::int
      - CASE WHEN EXTRACT(MONTH FROM invoice_date) < 4 THEN 1 ELSE 0 END)::smallint) STORED,
  total_paise bigint NOT NULL CHECK (total_paise BETWEEN 1 AND 99999999999999),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text CHECK (cancel_reason IS NULL OR length(btrim(cancel_reason)) BETWEEN 3 AND 300),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  import_batch_id uuid,
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_due_after_invoice CHECK (due_date >= invoice_date),
  CONSTRAINT invoices_cancel_all_or_none CHECK (
    (status = 'open' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL) OR
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
                          AND cancel_reason IS NOT NULL)),
  CONSTRAINT invoices_biz_id_uq UNIQUE (business_id, id),
  CONSTRAINT invoices_number_fy_uq UNIQUE (business_id, fy_start_year, invoice_number_normalized),
  CONSTRAINT invoices_customer_fk FOREIGN KEY (business_id, customer_id)
    REFERENCES mf.customers (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT invoices_import_batch_fk FOREIGN KEY (business_id, import_batch_id)
    REFERENCES mf.import_batches (business_id, id) ON DELETE RESTRICT
);
CREATE INDEX invoices_open_due_idx ON mf.invoices (business_id, due_date, id) WHERE status = 'open';
CREATE INDEX invoices_customer_idx ON mf.invoices (business_id, customer_id);
CREATE INDEX invoices_fy_idx ON mf.invoices (business_id, fy_start_year);

CREATE TABLE mf.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 1 AND 99999999999999),
  paid_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('cash', 'upi', 'bank_transfer', 'cheque', 'other')),
  reference text CHECK (reference IS NULL OR length(reference) <= 60),
  note text CHECK (note IS NULL OR length(note) <= 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_reversal_consistent CHECK (
    (status = 'active' AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL) OR
    (status = 'reversed' AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
                         AND length(btrim(reversal_reason)) BETWEEN 3 AND 300)),
  CONSTRAINT payments_biz_id_uq UNIQUE (business_id, id),
  CONSTRAINT payments_invoice_fk FOREIGN KEY (business_id, invoice_id)
    REFERENCES mf.invoices (business_id, id) ON DELETE RESTRICT
);
CREATE INDEX payments_active_invoice_idx ON mf.payments (business_id, invoice_id) WHERE status = 'active';
CREATE INDEX payments_active_paid_on_idx ON mf.payments (business_id, paid_on) WHERE status = 'active';
CREATE INDEX payments_dup_idx ON mf.payments (business_id, invoice_id, amount_paise, paid_on);

CREATE TABLE mf.invoice_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tds', 'discount', 'credit_note', 'write_off')),
  amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 1 AND 99999999999999),
  adjusted_on date NOT NULL,
  reference text CHECK (reference IS NULL OR length(reference) <= 60),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adjustments_reversal_consistent CHECK (
    (status = 'active' AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL) OR
    (status = 'reversed' AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
                         AND length(btrim(reversal_reason)) BETWEEN 3 AND 300)),
  CONSTRAINT adjustments_biz_id_uq UNIQUE (business_id, id),
  CONSTRAINT adjustments_invoice_fk FOREIGN KEY (business_id, invoice_id)
    REFERENCES mf.invoices (business_id, id) ON DELETE RESTRICT
);
CREATE INDEX adjustments_active_invoice_idx ON mf.invoice_adjustments (business_id, invoice_id)
  WHERE status = 'active';

CREATE TABLE mf.follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'call', 'visit', 'other')),
  outcome text NOT NULL
    CHECK (outcome IN ('no_response', 'contacted', 'promised', 'disputed', 'refused', 'other')),
  language text CHECK (language IN ('en', 'te')),
  message_text text CHECK (message_text IS NULL OR length(message_text) <= 2000),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  followed_up_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT follow_ups_biz_id_uq UNIQUE (business_id, id),
  CONSTRAINT follow_ups_invoice_fk FOREIGN KEY (business_id, invoice_id)
    REFERENCES mf.invoices (business_id, id) ON DELETE RESTRICT
);
CREATE INDEX follow_ups_invoice_idx ON mf.follow_ups (business_id, invoice_id, followed_up_at DESC);

CREATE TABLE mf.payment_promises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  follow_up_id uuid,
  promised_date date NOT NULL,
  promised_amount_paise bigint CHECK (promised_amount_paise BETWEEN 1 AND 99999999999999),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'kept', 'broken', 'cancelled')),
  note text CHECK (note IS NULL OR length(note) <= 500),
  resolved_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promises_resolved_consistent CHECK ((status = 'pending') = (resolved_at IS NULL)),
  CONSTRAINT promises_biz_id_uq UNIQUE (business_id, id),
  CONSTRAINT promises_invoice_fk FOREIGN KEY (business_id, invoice_id)
    REFERENCES mf.invoices (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT promises_follow_up_fk FOREIGN KEY (business_id, follow_up_id)
    REFERENCES mf.follow_ups (business_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX promises_one_pending_uq ON mf.payment_promises (invoice_id) WHERE status = 'pending';
CREATE INDEX promises_pending_date_idx ON mf.payment_promises (business_id, promised_date)
  WHERE status = 'pending';

CREATE TABLE mf.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  category text NOT NULL
    CHECK (category IN ('quality', 'quantity', 'price', 'delivery', 'payment_claimed', 'other')),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 3 AND 1000),
  disputed_amount_paise bigint CHECK (disputed_amount_paise BETWEEN 1 AND 99999999999999),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disputes_resolved_consistent CHECK (
    (status = 'open' AND resolution_note IS NULL AND resolved_at IS NULL AND resolved_by IS NULL) OR
    (status = 'resolved' AND resolution_note IS NOT NULL AND resolved_at IS NOT NULL
                         AND resolved_by IS NOT NULL)),
  CONSTRAINT disputes_biz_id_uq UNIQUE (business_id, id),
  CONSTRAINT disputes_invoice_fk FOREIGN KEY (business_id, invoice_id)
    REFERENCES mf.invoices (business_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX disputes_one_open_uq ON mf.disputes (invoice_id) WHERE status = 'open';
CREATE INDEX disputes_status_idx ON mf.disputes (business_id, status);

CREATE TABLE mf.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES mf.businesses (id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  request_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON mf.audit_logs (business_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON mf.audit_logs (business_id, entity_type, entity_id);

CREATE TABLE mf.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES mf.businesses (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  key text NOT NULL CHECK (key ~ '^[A-Za-z0-9_-]{16,128}$'),
  method text NOT NULL,
  route text NOT NULL,
  request_hash bytea NOT NULL,
  response_status smallint,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CONSTRAINT idempotency_business_key_uq UNIQUE (business_id, key)
);
CREATE INDEX idempotency_expires_idx ON mf.idempotency_keys (expires_at);

-- ---------------------------------------------------------------- triggers
CREATE FUNCTION mf.reject_modification() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% on mf.% is not allowed (append-only record)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'MF001';
END
$$;

CREATE FUNCTION mf.reject_truncate() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE on mf.% is not allowed', TG_TABLE_NAME USING ERRCODE = 'MF001';
END
$$;

CREATE FUNCTION mf.guard_invoice_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
     OR NEW.total_paise IS DISTINCT FROM OLD.total_paise
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'immutable invoice column changed' USING ERRCODE = 'MF001';
  END IF;
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'a cancelled invoice cannot be changed' USING ERRCODE = 'MF001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'open' AND NEW.status = 'cancelled') THEN
    RAISE EXCEPTION 'invalid invoice status transition' USING ERRCODE = 'MF001';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION mf.guard_payment_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_date date;
  v_today date := (pg_catalog.now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NEW.status <> 'active' THEN
    RAISE EXCEPTION 'a payment must be inserted as active' USING ERRCODE = 'MF001';
  END IF;
  SELECT invoice_date INTO v_invoice_date FROM mf.invoices
   WHERE business_id = NEW.business_id AND id = NEW.invoice_id;
  IF v_invoice_date IS NOT NULL AND (NEW.paid_on < v_invoice_date OR NEW.paid_on > v_today) THEN
    RAISE EXCEPTION 'paid_on must be between the invoice date and today (IST)' USING ERRCODE = 'MF001';
  END IF;
  RETURN NEW;
END
$$;

-- Payments and adjustments share one rule: only active -> reversed, once, with the reversal fields.
CREATE FUNCTION mf.guard_reversible_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'immutable column changed on %', TG_TABLE_NAME USING ERRCODE = 'MF001';
  END IF;
  IF TG_TABLE_NAME = 'payments' THEN
    IF NEW.paid_on IS DISTINCT FROM OLD.paid_on OR NEW.method IS DISTINCT FROM OLD.method
       OR NEW.note IS DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'immutable column changed on payments' USING ERRCODE = 'MF001';
    END IF;
  ELSE
    IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.adjusted_on IS DISTINCT FROM OLD.adjusted_on
       OR NEW.reason IS DISTINCT FROM OLD.reason THEN
      RAISE EXCEPTION 'immutable column changed on invoice_adjustments' USING ERRCODE = 'MF001';
    END IF;
  END IF;
  IF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'a reversed record cannot be changed or reactivated' USING ERRCODE = 'MF001';
  END IF;
  IF NEW.status IS DISTINCT FROM 'reversed' THEN
    RAISE EXCEPTION 'only the active -> reversed transition is allowed' USING ERRCODE = 'MF001';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION mf.guard_adjustment_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'active' THEN
    RAISE EXCEPTION 'an adjustment must be inserted as active' USING ERRCODE = 'MF001';
  END IF;
  RETURN NEW;
END
$$;

-- follow_ups: rows are immutable, except that the migrator may clear message_text/note
-- (the manual anonymization procedure, DECISIONS D-5).
CREATE FUNCTION mf.guard_follow_up_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user <> 'mf_migrator' THEN
    RAISE EXCEPTION 'follow_ups are append-only' USING ERRCODE = 'MF001';
  END IF;
  IF (to_jsonb(NEW) - 'message_text' - 'note') IS DISTINCT FROM (to_jsonb(OLD) - 'message_text' - 'note') THEN
    RAISE EXCEPTION 'only message_text and note may change' USING ERRCODE = 'MF001';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION mf.guard_promise_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.follow_up_id IS DISTINCT FROM OLD.follow_up_id
     OR NEW.promised_date IS DISTINCT FROM OLD.promised_date
     OR NEW.promised_amount_paise IS DISTINCT FROM OLD.promised_amount_paise
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'immutable promise column changed' USING ERRCODE = 'MF001';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a resolved promise cannot be changed' USING ERRCODE = 'MF001';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION mf.guard_dispute_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.disputed_amount_paise IS DISTINCT FROM OLD.disputed_amount_paise
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'immutable dispute column changed' USING ERRCODE = 'MF001';
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'a resolved dispute cannot be changed' USING ERRCODE = 'MF001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER invoices_guard BEFORE UPDATE ON mf.invoices
  FOR EACH ROW EXECUTE FUNCTION mf.guard_invoice_update();
CREATE TRIGGER payments_guard_insert BEFORE INSERT ON mf.payments
  FOR EACH ROW EXECUTE FUNCTION mf.guard_payment_insert();
CREATE TRIGGER payments_guard_update BEFORE UPDATE ON mf.payments
  FOR EACH ROW EXECUTE FUNCTION mf.guard_reversible_update();
CREATE TRIGGER payments_no_delete BEFORE DELETE ON mf.payments
  FOR EACH ROW EXECUTE FUNCTION mf.reject_modification();
CREATE TRIGGER adjustments_guard_insert BEFORE INSERT ON mf.invoice_adjustments
  FOR EACH ROW EXECUTE FUNCTION mf.guard_adjustment_insert();
CREATE TRIGGER adjustments_guard_update BEFORE UPDATE ON mf.invoice_adjustments
  FOR EACH ROW EXECUTE FUNCTION mf.guard_reversible_update();
CREATE TRIGGER adjustments_no_delete BEFORE DELETE ON mf.invoice_adjustments
  FOR EACH ROW EXECUTE FUNCTION mf.reject_modification();
CREATE TRIGGER follow_ups_guard_update BEFORE UPDATE ON mf.follow_ups
  FOR EACH ROW EXECUTE FUNCTION mf.guard_follow_up_update();
CREATE TRIGGER follow_ups_no_delete BEFORE DELETE ON mf.follow_ups
  FOR EACH ROW EXECUTE FUNCTION mf.reject_modification();
CREATE TRIGGER promises_guard_update BEFORE UPDATE ON mf.payment_promises
  FOR EACH ROW EXECUTE FUNCTION mf.guard_promise_update();
CREATE TRIGGER disputes_guard_update BEFORE UPDATE ON mf.disputes
  FOR EACH ROW EXECUTE FUNCTION mf.guard_dispute_update();
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON mf.audit_logs
  FOR EACH ROW EXECUTE FUNCTION mf.reject_modification();
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON mf.audit_logs
  FOR EACH ROW EXECUTE FUNCTION mf.reject_modification();

CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON mf.payments
  FOR EACH STATEMENT EXECUTE FUNCTION mf.reject_truncate();
CREATE TRIGGER adjustments_no_truncate BEFORE TRUNCATE ON mf.invoice_adjustments
  FOR EACH STATEMENT EXECUTE FUNCTION mf.reject_truncate();
CREATE TRIGGER follow_ups_no_truncate BEFORE TRUNCATE ON mf.follow_ups
  FOR EACH STATEMENT EXECUTE FUNCTION mf.reject_truncate();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON mf.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION mf.reject_truncate();
CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON mf.invoices
  FOR EACH STATEMENT EXECUTE FUNCTION mf.reject_truncate();
CREATE TRIGGER customers_no_truncate BEFORE TRUNCATE ON mf.customers
  FOR EACH STATEMENT EXECUTE FUNCTION mf.reject_truncate();

CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON mf.businesses
  FOR EACH ROW EXECUTE FUNCTION mf.set_updated_at();
CREATE TRIGGER user_profiles_updated_at BEFORE UPDATE ON mf.user_profiles
  FOR EACH ROW EXECUTE FUNCTION mf.set_updated_at();
CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON mf.memberships
  FOR EACH ROW EXECUTE FUNCTION mf.set_updated_at();
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON mf.customers
  FOR EACH ROW EXECUTE FUNCTION mf.set_updated_at();
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON mf.invoices
  FOR EACH ROW EXECUTE FUNCTION mf.set_updated_at();
CREATE TRIGGER promises_updated_at BEFORE UPDATE ON mf.payment_promises
  FOR EACH ROW EXECUTE FUNCTION mf.set_updated_at();
CREATE TRIGGER disputes_updated_at BEFORE UPDATE ON mf.disputes
  FOR EACH ROW EXECUTE FUNCTION mf.set_updated_at();

-- ---------------------------------------------------------------- row level security
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'businesses', 'user_profiles', 'memberships', 'customers', 'invoices', 'payments',
    'invoice_adjustments', 'follow_ups', 'payment_promises', 'disputes', 'audit_logs',
    'idempotency_keys', 'import_batches'] LOOP
    EXECUTE format('ALTER TABLE mf.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE mf.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- Standard tenant policies (STP) for the tables that have business_id.
DO $$
DECLARE
  t text;
  sel_ins_upd text[] := ARRAY['customers', 'invoices', 'payments', 'invoice_adjustments',
    'payment_promises', 'disputes', 'idempotency_keys', 'import_batches'];
  sel_ins text[] := ARRAY['follow_ups', 'audit_logs'];
BEGIN
  FOREACH t IN ARRAY sel_ins_upd || sel_ins LOOP
    EXECUTE format('CREATE POLICY stp_select ON mf.%I FOR SELECT TO mf_app
      USING (business_id = (SELECT mf.current_business_id()))', t);
    EXECUTE format('CREATE POLICY stp_insert ON mf.%I FOR INSERT TO mf_app
      WITH CHECK (business_id = (SELECT mf.current_business_id()))', t);
  END LOOP;
  FOREACH t IN ARRAY sel_ins_upd LOOP
    EXECUTE format('CREATE POLICY stp_update ON mf.%I FOR UPDATE TO mf_app
      USING (business_id = (SELECT mf.current_business_id()))
      WITH CHECK (business_id = (SELECT mf.current_business_id()))', t);
  END LOOP;
END
$$;

CREATE POLICY idem_delete ON mf.idempotency_keys FOR DELETE TO mf_app
  USING (business_id = (SELECT mf.current_business_id()) AND expires_at < now());

CREATE POLICY biz_select ON mf.businesses FOR SELECT TO mf_app
  USING (EXISTS (SELECT 1 FROM mf.memberships m
                 WHERE m.business_id = businesses.id
                   AND m.user_id = (SELECT mf.current_user_id())
                   AND m.status = 'active'));
CREATE POLICY biz_definer_insert ON mf.businesses FOR INSERT TO mf_definer
  WITH CHECK (created_by = (SELECT mf.current_user_id()));

CREATE POLICY up_select ON mf.user_profiles FOR SELECT TO mf_app
  USING (user_id = (SELECT mf.current_user_id()));
CREATE POLICY up_insert ON mf.user_profiles FOR INSERT TO mf_app
  WITH CHECK (user_id = (SELECT mf.current_user_id()));
CREATE POLICY up_update ON mf.user_profiles FOR UPDATE TO mf_app
  USING (user_id = (SELECT mf.current_user_id()))
  WITH CHECK (user_id = (SELECT mf.current_user_id()));

CREATE POLICY mem_self_select ON mf.memberships FOR SELECT TO mf_app
  USING (user_id = (SELECT mf.current_user_id()));
CREATE POLICY mem_tenant_select ON mf.memberships FOR SELECT TO mf_app
  USING (business_id = (SELECT mf.current_business_id()));
CREATE POLICY mem_definer_insert ON mf.memberships FOR INSERT TO mf_definer
  WITH CHECK (role = 'owner' AND user_id = (SELECT mf.current_user_id()));
CREATE POLICY mem_definer_select ON mf.memberships FOR SELECT TO mf_definer
  USING (user_id = (SELECT mf.current_user_id()));

CREATE POLICY audit_definer_insert ON mf.audit_logs FOR INSERT TO mf_definer
  WITH CHECK (actor_user_id = (SELECT mf.current_user_id()));

-- ---------------------------------------------------------------- grants (DATABASE.md section 9)
GRANT SELECT ON mf.businesses, mf.memberships TO mf_app;
GRANT SELECT, INSERT ON mf.user_profiles TO mf_app;
GRANT UPDATE (display_name, preferred_language, updated_at) ON mf.user_profiles TO mf_app;

GRANT SELECT, INSERT ON mf.customers TO mf_app;
GRANT UPDATE (name, phone, notes, preferred_language, is_active, updated_at) ON mf.customers TO mf_app;

GRANT SELECT, INSERT ON mf.invoices TO mf_app;
GRANT UPDATE (due_date, notes, status, cancelled_at, cancelled_by, cancel_reason, updated_at)
  ON mf.invoices TO mf_app;

GRANT SELECT, INSERT ON mf.payments, mf.invoice_adjustments TO mf_app;
GRANT UPDATE (status, reversed_at, reversed_by, reversal_reason) ON mf.payments TO mf_app;
GRANT UPDATE (status, reversed_at, reversed_by, reversal_reason) ON mf.invoice_adjustments TO mf_app;

GRANT SELECT, INSERT ON mf.follow_ups TO mf_app;

GRANT SELECT, INSERT ON mf.payment_promises TO mf_app;
GRANT UPDATE (status, note, resolved_at, updated_at) ON mf.payment_promises TO mf_app;

GRANT SELECT, INSERT ON mf.disputes TO mf_app;
GRANT UPDATE (status, resolution_note, resolved_at, resolved_by, updated_at) ON mf.disputes TO mf_app;

GRANT SELECT, INSERT ON mf.audit_logs TO mf_app;

GRANT SELECT, INSERT, DELETE ON mf.idempotency_keys TO mf_app;
GRANT UPDATE (response_status, response_body) ON mf.idempotency_keys TO mf_app;

GRANT SELECT, INSERT ON mf.import_batches TO mf_app;
GRANT UPDATE (status, preview_rows, summary, committed_at, committed_by) ON mf.import_batches TO mf_app;

GRANT INSERT ON mf.businesses, mf.memberships, mf.audit_logs TO mf_definer;
GRANT SELECT ON mf.memberships TO mf_definer;

-- ---------------------------------------------------------------- mf_create_business (DATABASE.md section 8)
GRANT CREATE ON SCHEMA mf TO mf_definer;  -- temporary, only so ownership can be handed over

CREATE FUNCTION mf.mf_create_business(p_name text, p_default_language text DEFAULT 'en')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, mf, pg_temp
AS $$
DECLARE
  v_user uuid := NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::uuid;
  v_biz  uuid := gen_random_uuid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'missing user context' USING ERRCODE = '28000';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 120
     OR p_default_language IS NULL OR p_default_language NOT IN ('en', 'te') THEN
    RAISE EXCEPTION 'invalid arguments' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM mf.memberships WHERE user_id = v_user AND role = 'owner') >= 3 THEN
    RAISE EXCEPTION 'business limit reached' USING ERRCODE = 'MF002';
  END IF;
  INSERT INTO mf.businesses (id, name, default_language, created_by)
    VALUES (v_biz, btrim(p_name), p_default_language, v_user);
  INSERT INTO mf.memberships (business_id, user_id, role, status)
    VALUES (v_biz, v_user, 'owner', 'active');
  INSERT INTO mf.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, detail)
    VALUES (v_biz, v_user, 'business.created', 'business', v_biz, '{}'::jsonb);
  RETURN v_biz;
END
$$;

ALTER FUNCTION mf.mf_create_business(text, text) OWNER TO mf_definer;
REVOKE ALL ON FUNCTION mf.mf_create_business(text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION mf.mf_create_business(text, text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION mf.mf_create_business(text, text) FROM authenticated;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION mf.mf_create_business(text, text) TO mf_app;

REVOKE CREATE ON SCHEMA mf FROM mf_definer;
