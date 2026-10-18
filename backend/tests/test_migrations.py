"""Schema checks: R7 (roles and flags), the migration cycle, and R11 (privileges)."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import build_database

TABLES = [
    "businesses", "user_profiles", "memberships", "customers", "invoices", "payments",
    "invoice_adjustments", "follow_ups", "payment_promises", "disputes", "audit_logs",
    "idempotency_keys", "import_batches",
]  # fmt: skip


def test_thirteen_tables_all_force_rls(superuser_engine):
    with superuser_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'mf' AND c.relkind = 'r'"
            )
        ).all()
    assert sorted(r[0] for r in rows) == sorted(TABLES)
    assert all(r[1] and r[2] for r in rows)


def test_r7_mf_app_is_not_privileged_and_owns_nothing(superuser_engine):
    with superuser_engine.connect() as conn:
        role = conn.execute(
            text("SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'mf_app'")
        ).one()
        owned = conn.execute(
            text("SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'mf_app'")
        ).scalar_one()
        definer = conn.execute(
            text("SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'mf_definer'")
        ).one()
    assert tuple(role) == (False, False, False, False)
    assert owned == 0
    assert tuple(definer) == (False, False, False)


def test_api_roles_have_no_access_to_schema_mf(superuser_engine):
    with superuser_engine.connect() as conn:
        for role in ("anon", "authenticated"):
            assert not conn.execute(text("SELECT has_schema_privilege(:r, 'mf', 'USAGE')"), {"r": role}).scalar_one()
        for role in ("anon", "authenticated"):
            assert not conn.execute(
                text("SELECT has_function_privilege(:r, 'mf.mf_create_business(text, text)', 'EXECUTE')"), {"r": role}
            ).scalar_one()


def test_generated_columns_work_on_this_postgres(superuser_engine):
    """D-1 compatibility check: FY boundary and normalization come from the database itself."""
    with superuser_engine.connect() as conn:
        version = conn.execute(text("SHOW server_version")).scalar_one()
        assert version.startswith("17"), version
        fy = conn.execute(
            text(
                "SELECT d, (EXTRACT(YEAR FROM d)::int - CASE WHEN EXTRACT(MONTH FROM d) < 4 THEN 1 ELSE 0 END) "
                "FROM (VALUES (DATE '2026-03-31'), (DATE '2026-04-01')) v(d)"
            )
        ).all()
    assert [r[1] for r in fy] == [2025, 2026]


def test_migration_downgrade_then_upgrade_on_empty_database(admin_url):
    """Upgrade, downgrade and upgrade again on a clean database."""
    from alembic import command
    from alembic.config import Config

    from tests.conftest import BACKEND

    name = "mf_cycle_test"
    build_database(admin_url, name)  # includes upgrade head
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    from sqlalchemy import create_engine

    from tests.conftest import _url_for

    engine = create_engine(_url_for(admin_url, "mf_migrator", "test-only-migrator", name))
    with engine.connect() as conn:
        assert (
            conn.execute(text("SELECT count(*) FROM information_schema.tables WHERE table_schema='mf'")).scalar_one()
            == 13
        )
    engine.dispose()
    # leave the main test database selected for later tests
    import os

    os.environ["MIGRATION_DATABASE_URL"] = _url_for(
        admin_url, "mf_migrator", "test-only-migrator", f"mf_test_{os.getpid()}"
    )
    server = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with server.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    server.dispose()


@pytest.mark.parametrize("table", TABLES)
def test_r11_mf_app_cannot_truncate_or_ddl(app_engine, table):
    for sql in (f"TRUNCATE mf.{table}", f"ALTER TABLE mf.{table} DISABLE ROW LEVEL SECURITY"):
        with pytest.raises(DBAPIError) as exc, app_engine.begin() as conn:
            conn.execute(text(sql))
        assert exc.value.orig.sqlstate in ("42501", "MF001")


@pytest.mark.parametrize("table", [t for t in TABLES if t != "idempotency_keys"])
def test_r11_mf_app_cannot_delete(app_engine, table):
    with pytest.raises(DBAPIError) as exc, app_engine.begin() as conn:
        conn.execute(text(f"DELETE FROM mf.{table}"))
    assert exc.value.orig.sqlstate == "42501"


def test_r11_mf_app_cannot_create_objects(app_engine):
    with pytest.raises(DBAPIError) as exc, app_engine.begin() as conn:
        conn.execute(text("CREATE TABLE mf.evil (id int)"))
    assert exc.value.orig.sqlstate == "42501"
