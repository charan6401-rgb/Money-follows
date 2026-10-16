-- One-time role bootstrap (DATABASE.md section 1). Run by a privileged user (a database
-- superuser locally; the provider's admin role on Supabase), NEVER by the API and never by CI
-- against production. It creates roles only. Passwords are set separately and are never stored here:
--   ALTER ROLE mf_app      PASSWORD '...';   -- runtime role, used by the API
--   ALTER ROLE mf_migrator PASSWORD '...';   -- DDL role, used from a trusted workstation
--
-- Idempotent. Safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_migrator') THEN
    CREATE ROLE mf_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_definer') THEN
    CREATE ROLE mf_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_app') THEN
    CREATE ROLE mf_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- The migrator creates schema mf and hands ownership of one function to mf_definer.
GRANT mf_definer TO mf_migrator;
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO mf_migrator', current_database());
END
$$;

-- Alembic's bookkeeping table lives here so migrations never need rights on schema public.
CREATE SCHEMA IF NOT EXISTS mf_alembic AUTHORIZATION mf_migrator;
REVOKE ALL ON SCHEMA mf_alembic FROM PUBLIC;
