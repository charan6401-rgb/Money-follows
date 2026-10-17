"""Authentication, tenant isolation, role matrix and error-shape tests through the real HTTP stack."""

import ast
import logging
import time
import uuid
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app.core.logging import RedactionFilter

API = "/api/v1"


def cust(client, user, biz, name="Acme Steel", phone="9876543210"):
    r = client.post(f"{API}/customers", json={"name": name, "phone": phone}, headers=user.headers(biz))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def inv(client, user, biz, customer_id, number="INV-1", date="2026-04-10", due="2026-05-10", amount="1000.50"):
    r = client.post(
        f"{API}/invoices",
        json={
            "customer_id": customer_id,
            "invoice_number": number,
            "invoice_date": date,
            "due_date": due,
            "amount": amount,
        },
        headers=user.headers(biz),
    )
    return r


# ---------------------------------------------------------------- A: authentication
def test_a_no_token_is_401(client):
    r = client.get(f"{API}/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"


@pytest.mark.parametrize("header", ["", "Bearer", "Bearer not.a.jwt", "Basic abc", "bearer  "])
def test_a_malformed_authorization_is_401(client, header):
    assert client.get(f"{API}/me", headers={"Authorization": header}).status_code == 401


def test_a_valid_token_works(client, keys):
    r = client.get(f"{API}/me", headers={"Authorization": f"Bearer {keys.token(uuid.uuid4())}"})
    assert r.status_code == 200


@pytest.mark.parametrize(
    "claims",
    [
        {"exp": int(time.time()) - 3600},
        {"aud": "someone-else"},
        {"iss": "https://evil.example/auth/v1"},
        {"role": "anon"},
        {"role": "service_role"},
        {"is_anonymous": True},
        {"sub": "not-a-uuid"},
        {"exp": None},
        {"sub": None},
        {"aud": None},
        {"iss": None},
    ],
)
def test_a_bad_claims_are_401(client, keys, claims):
    claims = dict(claims)
    sub = claims.pop("sub", uuid.uuid4()) if "sub" in claims else uuid.uuid4()
    tok = keys.token(sub, **claims)
    assert client.get(f"{API}/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_a_unknown_kid_is_401(client, keys):
    tok = keys.token(uuid.uuid4(), kid="unknown-kid")
    assert client.get(f"{API}/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_a_token_signed_by_another_key_is_401(client, keys):
    other = ec.generate_private_key(ec.SECP256R1())
    tok = keys.token(uuid.uuid4(), key=other)
    assert client.get(f"{API}/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_a_hs256_token_is_rejected(client):
    import jwt

    tok = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "aud": "authenticated",
            "iss": "x",
            "role": "authenticated",
            "exp": int(time.time()) + 600,
        },
        "k" * 40,
        algorithm="HS256",
        headers={"kid": "test-key-1"},
    )
    assert client.get(f"{API}/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_a_alg_none_is_rejected(client, keys):
    import base64
    import json

    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    tok = f"{b64({'alg': 'none', 'kid': 'test-key-1'})}.{b64({'sub': str(uuid.uuid4()), 'aud': 'authenticated'})}."
    assert client.get(f"{API}/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401


# ---------------------------------------------------------------- T: tenant isolation
def test_t_missing_business_header_is_400(client, tenant):
    user, _ = tenant
    r = client.get(f"{API}/customers", headers=user.headers())
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_business_header"


def test_t_malformed_business_header_is_400(client, tenant):
    user, _ = tenant
    r = client.get(f"{API}/customers", headers={**user.headers(), "X-Business-Id": "nope"})
    assert r.status_code == 400


def test_t_foreign_and_nonexistent_business_look_identical(client, new_user, make_business):
    alice, bob = new_user(), new_user()
    biz_a = make_business(alice)
    foreign = client.get(f"{API}/customers", headers=bob.headers(biz_a))
    missing = client.get(f"{API}/customers", headers=bob.headers(uuid.uuid4()))
    assert foreign.status_code == missing.status_code == 403
    assert foreign.json()["error"]["code"] == missing.json()["error"]["code"] == "workspace_access_denied"
    assert foreign.json()["error"]["message"] == missing.json()["error"]["message"]


def test_t_inactive_membership_is_denied(client, new_user, make_business, add_member, superuser_engine):
    from sqlalchemy import text

    owner, staff = new_user(), new_user()
    biz = make_business(owner)
    add_member(biz, staff, "staff")
    assert client.get(f"{API}/customers", headers=staff.headers(biz)).status_code == 200
    with superuser_engine.begin() as conn:
        conn.execute(text("UPDATE mf.memberships SET status = 'inactive' WHERE user_id = :u"), {"u": staff.id})
    assert client.get(f"{API}/customers", headers=staff.headers(biz)).status_code == 403


def test_t_cross_tenant_customer_is_404_not_403(client, new_user, make_business):
    alice, bob = new_user(), new_user()
    biz_a, biz_b = make_business(alice), make_business(bob)
    cid = cust(client, alice, biz_a)
    assert client.get(f"{API}/customers/{cid}", headers=bob.headers(biz_b)).status_code == 404
    assert (
        client.patch(f"{API}/customers/{cid}", json={"name": "Hacked"}, headers=bob.headers(biz_b)).status_code == 404
    )
    assert client.get(f"{API}/customers", headers=bob.headers(biz_b)).json()["items"] == []


def test_t_cross_tenant_invoice_is_404_everywhere(client, new_user, make_business):
    alice, bob = new_user(), new_user()
    biz_a, biz_b = make_business(alice), make_business(bob)
    iid = inv(client, alice, biz_a, cust(client, alice, biz_a)).json()["id"]
    h = bob.headers(biz_b)
    assert client.get(f"{API}/invoices/{iid}", headers=h).status_code == 404
    assert client.patch(f"{API}/invoices/{iid}", json={"notes": "x"}, headers=h).status_code == 404
    assert client.post(f"{API}/invoices/{iid}/cancel", json={"reason": "mistake"}, headers=h).status_code == 404
    assert client.get(f"{API}/invoices/{iid}/payments", headers=h).status_code == 404
    assert client.get(f"{API}/invoices", headers=h).json()["items"] == []


def test_t_invoice_cannot_use_another_tenants_customer(client, new_user, make_business):
    alice, bob = new_user(), new_user()
    biz_a, biz_b = make_business(alice), make_business(bob)
    foreign_customer = cust(client, alice, biz_a)
    r = inv(client, bob, biz_b, foreign_customer)
    assert r.status_code == 404
    assert client.get(f"{API}/invoices", headers=alice.headers(biz_a)).json()["items"] == []


def test_t_body_cannot_smuggle_business_id(client, tenant):
    user, biz = tenant
    r = client.post(
        f"{API}/customers",
        json={"name": "Smuggle", "phone": "9876543210", "business_id": str(uuid.uuid4())},
        headers=user.headers(biz),
    )
    assert r.status_code == 422


def test_t_list_businesses_only_mine(client, new_user, make_business):
    alice, bob = new_user(), new_user()
    biz_a = make_business(alice, "Alice Co")
    make_business(bob, "Bob Co")
    items = client.get(f"{API}/businesses", headers=alice.headers()).json()["items"]
    assert [i["id"] for i in items] == [biz_a]


def test_t_members_list_scoped_to_business(client, new_user, make_business):
    alice, bob = new_user(), new_user()
    biz_a = make_business(alice)
    make_business(bob)
    members = client.get(f"{API}/members", headers=alice.headers(biz_a)).json()["items"]
    assert [m["user_id"] for m in members] == [str(alice.id)]


# ---------------------------------------------------------------- roles (D-4)
def test_role_staff_cannot_cancel_invoice_but_admin_and_owner_can(client, new_user, make_business, add_member):
    owner, admin, staff = new_user(), new_user(), new_user()
    biz = make_business(owner)
    add_member(biz, admin, "admin")
    add_member(biz, staff, "staff")
    cid = cust(client, owner, biz)
    ids = [inv(client, owner, biz, cid, number=f"R-{i}").json()["id"] for i in range(3)]
    r = client.post(f"{API}/invoices/{ids[0]}/cancel", json={"reason": "duplicate entry"}, headers=staff.headers(biz))
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden_role"
    assert (
        client.post(
            f"{API}/invoices/{ids[1]}/cancel", json={"reason": "duplicate entry"}, headers=admin.headers(biz)
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"{API}/invoices/{ids[2]}/cancel", json={"reason": "duplicate entry"}, headers=owner.headers(biz)
        ).status_code
        == 200
    )


def test_role_staff_can_create_and_edit(client, new_user, make_business, add_member):
    owner, staff = new_user(), new_user()
    biz = make_business(owner)
    add_member(biz, staff, "staff")
    cid = cust(client, staff, biz)
    r = inv(client, staff, biz, cid)
    assert r.status_code == 201
    assert (
        client.patch(
            f"{API}/invoices/{r.json()['id']}", json={"notes": "called"}, headers=staff.headers(biz)
        ).status_code
        == 200
    )


def test_role_comes_from_database_not_token(client, new_user, make_business, add_member, keys):
    owner, staff = new_user(), new_user()
    biz = make_business(owner)
    add_member(biz, staff, "staff")
    iid = inv(client, owner, biz, cust(client, owner, biz)).json()["id"]
    tok = keys.token(staff.id, app_metadata={"role": "owner"}, user_metadata={"role": "owner"})
    r = client.post(
        f"{API}/invoices/{iid}/cancel",
        json={"reason": "forged"},
        headers={"Authorization": f"Bearer {tok}", "X-Business-Id": biz},
    )
    assert r.status_code == 403


# ---------------------------------------------------------------- error bodies
def test_error_envelope_and_no_echo_of_input(client, tenant):
    user, biz = tenant
    secret = "SuperSecretValue-12345"
    r = client.post(f"{API}/customers", json={"name": secret, "phone": "bad"}, headers=user.headers(biz))
    assert r.status_code == 422
    body = r.json()
    assert set(body["error"]) >= {"code", "message", "request_id"}
    assert secret not in r.text and "bad" not in body["error"]["message"]
    assert r.headers["x-request-id"] == body["error"]["request_id"]
    assert r.headers["cache-control"] == "no-store"


def test_unknown_route_and_method_use_envelope(client):
    assert client.get(f"{API}/nope").json()["error"]["code"] == "resource_not_found"
    assert client.delete(f"{API}/me").status_code == 405


def test_no_stack_trace_in_unhandled_error(client, tenant):
    user, biz = tenant
    r = client.get(f"{API}/invoices/not-a-uuid", headers=user.headers(biz))
    assert r.status_code in (404, 422)
    assert "Traceback" not in r.text


def test_health_endpoints_need_no_auth(client):
    assert client.get("/health/live").status_code == 200
    assert client.get("/health/ready").status_code == 200


def test_cors_allows_only_configured_origin(client):
    ok = client.options(
        f"{API}/me",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,x-business-id",
        },
    )
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options(
        f"{API}/me", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"}
    )
    assert "access-control-allow-origin" not in bad.headers


# ---------------------------------------------------------------- static guards
APP = Path(__file__).resolve().parent.parent / "app"


def test_only_rls_module_calls_set_config():
    offenders = [
        str(p.relative_to(APP))
        for p in APP.rglob("*.py")
        if "set_config" in p.read_text() and p.name != "rls.py" and "config.py" not in p.name
    ]
    assert offenders == []


# Reviewed f-string SQL, counted per file. Every one interpolates only module-level constants
# (the balance fragments in invoices/balance.py) or a fixed column allow-list; every request-derived
# value is a bound parameter. A NEW f-string SQL in any file changes a count and fails this test
# until it has been reviewed and the count here is updated deliberately.
REVIEWED_FSTRING_SQL = {
    "modules/customers/router.py": 3,
    "modules/identity/router.py": 1,
    "modules/invoices/router.py": 1,
    "modules/payments/router.py": 1,
    "modules/reports/router.py": 7,
}


def _interpolated_sql_strings(path: Path) -> int:
    """Count f-strings with interpolation anywhere inside a text(...) call (AST, not regex)."""
    tree = ast.parse(path.read_text())
    total = 0
    for call in ast.walk(tree):
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "text":
            total += sum(
                1
                for node in ast.walk(call)
                if isinstance(node, ast.JoinedStr) and any(isinstance(v, ast.FormattedValue) for v in node.values)
            )
    return total


def test_no_unreviewed_fstring_sql():
    found = {}
    for p in APP.rglob("*.py"):
        n = _interpolated_sql_strings(p)
        if n:
            found[str(p.relative_to(APP))] = n
    assert found == REVIEWED_FSTRING_SQL


def test_settings_have_no_service_role_or_jwt_secret_field():
    from app.core.config import Settings

    names = " ".join(Settings.model_fields).lower()
    assert "service_role" not in names
    assert "jwt_secret" not in names
    assert "anon_key" not in names


# ---------------------------------------------------------------- log redaction
def test_log_redaction_masks_secrets():
    f = RedactionFilter()
    rec = logging.LogRecord(
        "t", logging.INFO, "p", 1,
        "Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln db=postgresql+psycopg://u:hunter2@h/db phone=+919876543210 mail=a@b.com",
        None, None,
    )  # fmt: skip
    f.filter(rec)
    out = rec.getMessage()
    for leaked in ("eyJhbGci", "hunter2", "9876543210", "a@b.com"):
        assert leaked not in out
