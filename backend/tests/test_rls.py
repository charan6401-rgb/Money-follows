"""S0 database-security tests R1-R3, R5, R6, R8, R9, R11 against real PostgreSQL as role mf_app.

R4 (pool leakage) and R10 (concurrency soak through the pooler) need the real Supabase pooler and
are NOT run here. R1-R11 against the pooler also remain NOT RUN.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

TABLES = [
    "businesses", "user_profiles", "memberships", "customers", "invoices", "payments",
    "invoice_adjustments", "follow_ups", "payment_promises", "disputes", "audit_logs",
    "idempotency_keys", "import_batches",
]  # fmt: skip


def seed_tenant(conn, user_id: uuid.UUID) -> dict[str, uuid.UUID]:
    """Insert one row in every table for a new business, as superuser (bypasses RLS)."""
    ids = {k: uuid.uuid4() for k in ("b", "cust", "inv", "pay", "adj", "fu", "promise", "dispute", "batch")}
    p = {"u": user_id, **ids}
    for sql in (
        "INSERT INTO mf.businesses (id, name, created_by) VALUES (:b, 'Seed Co', :u)",
        "INSERT INTO mf.user_profiles (user_id) VALUES (:u)",
        "INSERT INTO mf.memberships (business_id, user_id, role) VALUES (:b, :u, 'owner')",
        "INSERT INTO mf.customers (id, business_id, name, created_by) VALUES (:cust, :b, 'Cust', :u)",
        "INSERT INTO mf.import_batches (id, business_id, created_by, filename, file_sha256, total_rows, valid_rows,"
        " error_rows) VALUES (:batch, :b, :u, 'f.csv', '\\x00', 0, 0, 0)",
        "INSERT INTO mf.invoices (id, business_id, customer_id, invoice_number, invoice_date, due_date, total_paise,"
        " created_by) VALUES (:inv, :b, :cust, 'INV-1', '2026-04-01', '2026-05-01', 100000, :u)",
        "INSERT INTO mf.payments (id, business_id, invoice_id, amount_paise, paid_on, method, created_by)"
        " VALUES (:pay, :b, :inv, 1000, '2026-04-02', 'cash', :u)",
        "INSERT INTO mf.invoice_adjustments (id, business_id, invoice_id, kind, amount_paise, adjusted_on, reason,"
        " created_by) VALUES (:adj, :b, :inv, 'tds', 500, '2026-04-02', 'tds seed', :u)",
        "INSERT INTO mf.follow_ups (id, business_id, invoice_id, channel, outcome, created_by)"
        " VALUES (:fu, :b, :inv, 'call', 'contacted', :u)",
        "INSERT INTO mf.payment_promises (id, business_id, invoice_id, promised_date, created_by)"
        " VALUES (:promise, :b, :inv, '2026-05-10', :u)",
        "INSERT INTO mf.disputes (id, business_id, invoice_id, category, description, created_by)"
        " VALUES (:dispute, :b, :inv, 'price', 'seed dispute', :u)",
        "INSERT INTO mf.audit_logs (business_id, actor_user_id, action, entity_type, entity_id)"
        " VALUES (:b, :u, 'seed', 'x', :b)",
        "INSERT INTO mf.idempotency_keys (business_id, user_id, key, method, route, request_hash)"
        " VALUES (:b, :u, 'seed-key-seed-key-1', 'POST', '/x', '\\x00')",
    ):
        conn.execute(text(sql), p)
    return ids


@pytest.fixture
def two_tenants(superuser_engine):
    a_user, b_user = uuid.uuid4(), uuid.uuid4()
    with superuser_engine.begin() as conn:
        a = seed_tenant(conn, a_user)
        b = seed_tenant(conn, b_user)
    return a_user, a, b_user, b


def as_app(engine, sql, params=None, *, user=None, business=None):
    """Run one statement as mf_app in its own transaction with optional context."""
    with engine.begin() as conn:
        if user is not None:
            conn.execute(text("SELECT set_config('app.current_user_id', :v, true)"), {"v": str(user)})
        if business is not None:
            conn.execute(text("SELECT set_config('app.current_business_id', :v, true)"), {"v": str(business)})
        result = conn.execute(text(sql), params or {})
        return result.all() if result.returns_rows else result.rowcount


@pytest.mark.parametrize("table", TABLES)
def test_r1_no_context_returns_no_rows(app_engine, two_tenants, table):
    assert as_app(app_engine, f"SELECT * FROM mf.{table}") == []


@pytest.mark.parametrize("table", TABLES)
def test_r1_no_context_insert_is_rejected(app_engine, two_tenants, table):
    """Every table refuses an INSERT without context (permission denied or an RLS violation)."""
    stmts = {
        "businesses": "INSERT INTO mf.businesses (name, created_by) VALUES ('Zed Co', gen_random_uuid())",
        "user_profiles": "INSERT INTO mf.user_profiles (user_id) VALUES (gen_random_uuid())",
        "memberships": "INSERT INTO mf.memberships (business_id, user_id, role) VALUES (gen_random_uuid(), gen_random_uuid(), 'owner')",
        "customers": "INSERT INTO mf.customers (business_id, name, created_by) VALUES (gen_random_uuid(), 'x', gen_random_uuid())",
        "invoices": "INSERT INTO mf.invoices (business_id, customer_id, invoice_number, invoice_date, due_date, total_paise, created_by) VALUES (gen_random_uuid(), gen_random_uuid(), 'x', '2026-04-01', '2026-04-02', 1, gen_random_uuid())",
        "payments": "INSERT INTO mf.payments (business_id, invoice_id, amount_paise, paid_on, method, created_by) VALUES (gen_random_uuid(), gen_random_uuid(), 1, '2026-04-01', 'cash', gen_random_uuid())",
        "invoice_adjustments": "INSERT INTO mf.invoice_adjustments (business_id, invoice_id, kind, amount_paise, adjusted_on, reason, created_by) VALUES (gen_random_uuid(), gen_random_uuid(), 'tds', 1, '2026-04-01', 'abc', gen_random_uuid())",
        "follow_ups": "INSERT INTO mf.follow_ups (business_id, invoice_id, channel, outcome, created_by) VALUES (gen_random_uuid(), gen_random_uuid(), 'call', 'other', gen_random_uuid())",
        "payment_promises": "INSERT INTO mf.payment_promises (business_id, invoice_id, promised_date, created_by) VALUES (gen_random_uuid(), gen_random_uuid(), '2026-04-01', gen_random_uuid())",
        "disputes": "INSERT INTO mf.disputes (business_id, invoice_id, category, description, created_by) VALUES (gen_random_uuid(), gen_random_uuid(), 'price', 'abc', gen_random_uuid())",
        "audit_logs": "INSERT INTO mf.audit_logs (business_id, actor_user_id, action, entity_type, entity_id) VALUES (gen_random_uuid(), gen_random_uuid(), 'a', 't', gen_random_uuid())",
        "idempotency_keys": "INSERT INTO mf.idempotency_keys (business_id, user_id, key, method, route, request_hash) VALUES (gen_random_uuid(), gen_random_uuid(), 'abcdefghijklmnop', 'POST', '/x', '\\x00')",
        "import_batches": "INSERT INTO mf.import_batches (business_id, created_by, filename, file_sha256, total_rows, valid_rows, error_rows) VALUES (gen_random_uuid(), gen_random_uuid(), 'f', '\\x00', 0, 0, 0)",
    }  # fmt: skip
    with pytest.raises(DBAPIError) as exc:
        as_app(app_engine, stmts[table])
    assert exc.value.orig.sqlstate == "42501"


@pytest.mark.parametrize("table", [t for t in TABLES if t not in ("businesses", "user_profiles", "memberships")])
def test_r2_read_isolation(app_engine, two_tenants, table):
    a_user, a, b_user, b = two_tenants
    rows = as_app(app_engine, f"SELECT business_id FROM mf.{table}", user=a_user, business=a["b"])
    assert rows and {r[0] for r in rows} == {a["b"]}
    assert (
        as_app(
            app_engine, f"SELECT 1 FROM mf.{table} WHERE business_id = :b", {"b": b["b"]}, user=a_user, business=a["b"]
        )
        == []
    )


def test_r2_businesses_and_memberships_show_only_own(app_engine, two_tenants):
    a_user, a, b_user, b = two_tenants
    assert {r[0] for r in as_app(app_engine, "SELECT id FROM mf.businesses", user=a_user)} == {a["b"]}
    assert {r[0] for r in as_app(app_engine, "SELECT business_id FROM mf.memberships", user=a_user)} == {a["b"]}
    assert as_app(app_engine, "SELECT id FROM mf.businesses WHERE id = :b", {"b": b["b"]}, user=a_user) == []
    assert {r[0] for r in as_app(app_engine, "SELECT user_id FROM mf.user_profiles", user=a_user)} == {a_user}


def test_r3_cannot_insert_for_another_business(app_engine, two_tenants):
    a_user, a, b_user, b = two_tenants
    with pytest.raises(DBAPIError) as exc:
        as_app(
            app_engine,
            "INSERT INTO mf.customers (business_id, name, created_by) VALUES (:b, 'Intruder', :u)",
            {"b": b["b"], "u": a_user},
            user=a_user,
            business=a["b"],
        )
    assert exc.value.orig.sqlstate == "42501"


def test_r3_cannot_update_another_business_row(app_engine, superuser_engine, two_tenants):
    a_user, a, b_user, b = two_tenants
    changed = as_app(
        app_engine,
        "UPDATE mf.customers SET name = 'Hacked' WHERE id = :id",
        {"id": b["cust"]},
        user=a_user,
        business=a["b"],
    )
    assert changed == 0
    with superuser_engine.connect() as conn:
        assert (
            conn.execute(text("SELECT name FROM mf.customers WHERE id = :id"), {"id": b["cust"]}).scalar_one() == "Cust"
        )


def test_r3_cannot_move_a_row_to_another_business(app_engine, two_tenants):
    """business_id is not even an updatable column for mf_app (column-limited grants)."""
    a_user, a, b_user, b = two_tenants
    with pytest.raises(DBAPIError) as exc:
        as_app(
            app_engine, "UPDATE mf.customers SET business_id = :b WHERE id = :id", {"b": b["b"], "id": a["cust"]},
            user=a_user, business=a["b"],
        )  # fmt: skip
    assert exc.value.orig.sqlstate == "42501"


def test_r5_rollback_clears_context(app_engine, two_tenants):
    a_user, a, *_ = two_tenants
    with app_engine.connect() as conn:
        tx = conn.begin()
        conn.execute(text("SELECT set_config('app.current_business_id', :v, true)"), {"v": str(a["b"])})
        assert conn.execute(text("SELECT count(*) FROM mf.customers")).scalar_one() == 1
        tx.rollback()
        assert conn.execute(text("SELECT current_setting('app.current_business_id', true)")).scalar_one() in ("", None)
        assert conn.execute(text("SELECT count(*) FROM mf.customers")).scalar_one() == 0


def test_r5_commit_clears_context(app_engine, two_tenants):
    a_user, a, *_ = two_tenants
    with app_engine.connect() as conn:
        with conn.begin():
            conn.execute(text("SELECT set_config('app.current_business_id', :v, true)"), {"v": str(a["b"])})
        with conn.begin():
            assert conn.execute(text("SELECT count(*) FROM mf.customers")).scalar_one() == 0


@pytest.mark.parametrize("bad", ["", "not-a-uuid", "   "])
def test_r6_bad_context_values_fail_closed(app_engine, two_tenants, bad):
    if bad == "":
        assert as_app(app_engine, "SELECT 1 FROM mf.customers", business=bad) == []
    else:
        with pytest.raises(DBAPIError):  # malformed UUID raises: also fail closed, no rows returned
            as_app(app_engine, "SELECT 1 FROM mf.customers", business=bad)


def test_r6_nonexistent_business_returns_nothing(app_engine, two_tenants):
    assert as_app(app_engine, "SELECT 1 FROM mf.customers", business=uuid.uuid4()) == []


def test_r8_composite_fk_blocks_cross_tenant_references(superuser_engine, two_tenants):
    """Even with RLS bypassed (superuser), a row cannot reference another tenant's parent."""
    a_user, a, b_user, b = two_tenants
    with superuser_engine.connect() as conn:
        with pytest.raises(DBAPIError) as exc:
            conn.execute(
                text(
                    "INSERT INTO mf.payments (business_id, invoice_id, amount_paise, paid_on, method, created_by) "
                    "VALUES (:a, :inv_b, 1, '2026-04-02', 'cash', :u)"
                ),
                {"a": a["b"], "inv_b": b["inv"], "u": a_user},
            )
        assert exc.value.orig.sqlstate == "23503"
    with superuser_engine.connect() as conn:
        with pytest.raises(DBAPIError) as exc:
            conn.execute(
                text(
                    "INSERT INTO mf.invoices (business_id, customer_id, invoice_number, invoice_date, due_date, "
                    "total_paise, created_by) VALUES (:a, :cust_b, 'X-1', '2026-04-02', '2026-04-03', 1, :u)"
                ),
                {"a": a["b"], "cust_b": b["cust"], "u": a_user},
            )
        assert exc.value.orig.sqlstate == "23503"


# ---------------------------------------------------------------- R9 mf_create_business
def test_r9a_mf_app_cannot_insert_businesses_or_memberships(app_engine):
    u = uuid.uuid4()
    for sql in (
        "INSERT INTO mf.businesses (name, created_by) VALUES ('Sneaky', :u)",
        "INSERT INTO mf.memberships (business_id, user_id, role) VALUES (gen_random_uuid(), :u, 'owner')",
    ):
        with pytest.raises(DBAPIError) as exc:
            as_app(app_engine, sql, {"u": u}, user=u)
        assert exc.value.orig.sqlstate == "42501"


def test_r9b_creates_exactly_one_business_owner_and_audit(app_engine, superuser_engine):
    u = uuid.uuid4()
    biz = as_app(app_engine, "SELECT mf.mf_create_business('Nine Traders', 'te')", user=u)[0][0]
    with superuser_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM mf.businesses WHERE id = :b"), {"b": biz}).scalar_one() == 1
        m = conn.execute(
            text("SELECT role, status, user_id FROM mf.memberships WHERE business_id = :b"), {"b": biz}
        ).all()
        assert [tuple(r) for r in m] == [("owner", "active", u)]
        assert (
            conn.execute(
                text("SELECT count(*) FROM mf.audit_logs WHERE business_id = :b AND action = 'business.created'"),
                {"b": biz},
            ).scalar_one()
            == 1
        )


def test_r9c_without_user_context_fails(app_engine):
    with pytest.raises(DBAPIError) as exc:
        as_app(app_engine, "SELECT mf.mf_create_business('No Context', 'en')")
    assert exc.value.orig.sqlstate == "28000"


def test_r9d_hostile_objects_in_public_and_pg_temp_do_not_change_behavior(app_engine, superuser_engine):
    u = uuid.uuid4()
    with superuser_engine.begin() as conn:
        conn.execute(
            text(
                "CREATE OR REPLACE FUNCTION public.btrim(text) RETURNS text LANGUAGE sql AS $$ SELECT 'HIJACK'::text $$"
            )
        )
        conn.execute(text("GRANT EXECUTE ON FUNCTION public.btrim(text) TO PUBLIC"))
    try:
        with app_engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.current_user_id', :v, true)"), {"v": str(u)})
            conn.execute(
                text("CREATE FUNCTION pg_temp.btrim(text) RETURNS text LANGUAGE sql AS $$ SELECT 'HIJACK'::text $$")
            )
            biz = conn.execute(text("SELECT mf.mf_create_business('  Padded Name  ', 'en')")).scalar_one()
        with superuser_engine.connect() as conn:
            assert (
                conn.execute(text("SELECT name FROM mf.businesses WHERE id = :b"), {"b": biz}).scalar_one()
                == "Padded Name"
            )
    finally:
        with superuser_engine.begin() as conn:
            conn.execute(text("DROP FUNCTION public.btrim(text)"))


def test_r9e_execute_denied_to_public_anon_authenticated(superuser_engine):
    with superuser_engine.connect() as conn:
        for role in ("anon", "authenticated"):
            assert not conn.execute(
                text("SELECT has_function_privilege(:r, 'mf.mf_create_business(text,text)', 'EXECUTE')"), {"r": role}
            ).scalar_one()
        acl = conn.execute(text("SELECT proacl::text FROM pg_proc WHERE proname = 'mf_create_business'")).scalar_one()
    entries = acl.strip("{}").split(",")
    grantees = {e.split("=")[0] for e in entries}
    assert "" not in grantees  # an empty grantee would be PUBLIC
    assert grantees == {"mf_definer", "mf_app"}


def test_r9f_business_cap_per_user(app_engine):
    u = uuid.uuid4()
    for i in range(3):
        as_app(app_engine, "SELECT mf.mf_create_business(:n, 'en')", {"n": f"Biz {i} Co"}, user=u)
    with pytest.raises(DBAPIError) as exc:
        as_app(app_engine, "SELECT mf.mf_create_business('Fourth Co', 'en')", user=u)
    assert exc.value.orig.sqlstate == "MF002"


def test_r9_bad_arguments_rejected(app_engine):
    u = uuid.uuid4()
    for name, lang in (("x", "en"), ("Valid Name", "hi"), ("   ", "en")):
        with pytest.raises(DBAPIError) as exc:
            as_app(app_engine, "SELECT mf.mf_create_business(:n, :l)", {"n": name, "l": lang}, user=u)
        assert exc.value.orig.sqlstate == "22023"


# ---------------------------------------------------------------- R11 immutability triggers fire for direct SQL
def test_r11_payment_amount_cannot_change_and_row_cannot_be_deleted(app_engine, two_tenants):
    a_user, a, *_ = two_tenants
    with pytest.raises(DBAPIError) as exc:
        as_app(
            app_engine,
            "UPDATE mf.payments SET amount_paise = 1 WHERE id = :id",
            {"id": a["pay"]},
            user=a_user,
            business=a["b"],
        )
    assert exc.value.orig.sqlstate == "42501"  # column privilege: only reversal fields are updatable


def test_r11_reversal_is_one_way_and_reactivation_fails(app_engine, two_tenants):
    a_user, a, *_ = two_tenants
    as_app(
        app_engine,
        "UPDATE mf.payments SET status = 'reversed', reversed_at = now(), reversed_by = :u, reversal_reason = 'bounced' WHERE id = :id",
        {"id": a["pay"], "u": a_user}, user=a_user, business=a["b"],
    )  # fmt: skip
    with pytest.raises(DBAPIError) as exc:
        as_app(
            app_engine,
            "UPDATE mf.payments SET status = 'active', reversed_at = NULL, reversed_by = NULL, reversal_reason = NULL WHERE id = :id",
            {"id": a["pay"]}, user=a_user, business=a["b"],
        )  # fmt: skip
    assert exc.value.orig.sqlstate == "MF001"


def test_r11_triggers_reject_delete_even_for_superuser(superuser_engine, two_tenants):
    a_user, a, *_ = two_tenants
    for table, key in (("payments", "pay"), ("invoice_adjustments", "adj"), ("follow_ups", "fu"), ("audit_logs", None)):
        with superuser_engine.connect() as conn, pytest.raises(DBAPIError) as exc:
            if key:
                conn.execute(text(f"DELETE FROM mf.{table} WHERE id = :id"), {"id": a[key]})
            else:
                conn.execute(text("DELETE FROM mf.audit_logs WHERE business_id = :b"), {"b": a["b"]})
        assert exc.value.orig.sqlstate == "MF001"


def test_r11_invoice_immutable_columns_and_cancel_is_one_way(superuser_engine, two_tenants):
    a_user, a, *_ = two_tenants
    for sql in (
        "UPDATE mf.invoices SET total_paise = 5 WHERE id = :id",
        "UPDATE mf.invoices SET invoice_date = '2026-04-02' WHERE id = :id",
        "UPDATE mf.invoices SET invoice_number = 'CHANGED' WHERE id = :id",
    ):
        with superuser_engine.connect() as conn, pytest.raises(DBAPIError) as exc:
            conn.execute(text(sql), {"id": a["inv"]})
        assert exc.value.orig.sqlstate == "MF001"


def test_r11_audit_logs_are_append_only(app_engine, two_tenants):
    a_user, a, *_ = two_tenants
    with pytest.raises(DBAPIError) as exc:
        as_app(
            app_engine,
            "UPDATE mf.audit_logs SET action = 'x' WHERE business_id = :b",
            {"b": a["b"]},
            user=a_user,
            business=a["b"],
        )
    assert exc.value.orig.sqlstate == "42501"
