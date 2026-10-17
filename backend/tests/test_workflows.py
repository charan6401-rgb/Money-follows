"""Customer and invoice behaviour, documented relationships (DATABASE.md, DECISIONS D-1/D-2/D-10)."""

import uuid

import pytest
from sqlalchemy import text

from tests.test_api_security import API, cust, inv


def seed_payment(engine, biz, user, invoice_id, paise, status="active"):
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO mf.payments (business_id, invoice_id, amount_paise, paid_on, method, created_by) "
                "VALUES (:b, :i, :a, '2026-04-12', 'upi', :u)"
            ),
            {"b": biz, "i": invoice_id, "a": paise, "u": user.id},
        )
        if status == "reversed":
            conn.execute(
                text("UPDATE mf.payments SET status='reversed', reversed_at=now(), reversed_by=:u, reversal_reason='bounced' "
                     "WHERE invoice_id = :i AND amount_paise = :a"),
                {"u": user.id, "i": invoice_id, "a": paise},
            )  # fmt: skip


def seed_adjustment(engine, biz, user, invoice_id, paise):
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO mf.invoice_adjustments (business_id, invoice_id, kind, amount_paise, adjusted_on, reason, created_by) "
                "VALUES (:b, :i, 'tds', :a, '2026-04-13', 'tds deducted', :u)"
            ),
            {"b": biz, "i": invoice_id, "a": paise, "u": user.id},
        )


# ---------------------------------------------------------------- customers
def test_customer_create_normalizes_phone_and_lists(client, tenant):
    user, biz = tenant
    for raw in ("98765 43210", "+91 98765 43211", "09876543212"):
        r = client.post(f"{API}/customers", json={"name": f"Cust {raw}", "phone": raw}, headers=user.headers(biz))
        assert r.status_code == 201, (raw, r.text)
        assert r.json()["phone"].startswith("+91")
    assert len(client.get(f"{API}/customers", headers=user.headers(biz)).json()["items"]) == 3


@pytest.mark.parametrize("phone", ["12345", "5876543210", "+1 415 555 0100", "abcdefghij", "98765432101234"])
def test_customer_invalid_phone_rejected(client, tenant, phone):
    user, biz = tenant
    assert (
        client.post(f"{API}/customers", json={"name": "X Co", "phone": phone}, headers=user.headers(biz)).status_code
        == 422
    )


def test_customer_duplicate_phone_is_409_and_same_phone_ok_in_other_business(client, new_user, make_business):
    a, b = new_user(), new_user()
    biz_a, biz_b = make_business(a), make_business(b)
    cust(client, a, biz_a, "First Co", "9876543210")
    r = client.post(f"{API}/customers", json={"name": "Second Co", "phone": "9876543210"}, headers=a.headers(biz_a))
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_customer_phone"
    assert (
        client.post(
            f"{API}/customers", json={"name": "Second Co", "phone": "9876543210"}, headers=b.headers(biz_b)
        ).status_code
        == 201
    )


def test_customer_patch_only_allowed_fields_and_deactivate(client, tenant):
    user, biz = tenant
    cid = cust(client, user, biz)
    h = user.headers(biz)
    assert client.patch(f"{API}/customers/{cid}", json={"notes": "pays late"}, headers=h).json()["notes"] == "pays late"
    assert client.patch(f"{API}/customers/{cid}", json={"business_id": str(uuid.uuid4())}, headers=h).status_code == 422
    assert client.patch(f"{API}/customers/{cid}", json={"is_active": False}, headers=h).status_code == 200
    assert client.get(f"{API}/customers", headers=h).json()["items"] == []
    assert len(client.get(f"{API}/customers?is_active=false", headers=h).json()["items"]) == 1


def test_customer_pagination_cursor_and_bad_cursor(client, tenant):
    user, biz = tenant
    for i in range(5):
        cust(client, user, biz, f"Cust {i:02d} Ltd", f"98765432{i:02d}")
    h = user.headers(biz)
    p1 = client.get(f"{API}/customers?limit=2", headers=h).json()
    assert len(p1["items"]) == 2 and p1["next_cursor"]
    p2 = client.get(f"{API}/customers?limit=2&cursor={p1['next_cursor']}", headers=h).json()
    assert {i["id"] for i in p1["items"]}.isdisjoint({i["id"] for i in p2["items"]})
    assert client.get(f"{API}/customers?cursor=garbage", headers=h).status_code == 422
    assert client.get(f"{API}/customers?limit=101", headers=h).status_code == 422


def test_customer_search_escapes_wildcards(client, tenant):
    user, biz = tenant
    cust(client, user, biz, "Acme Steel", "9876543210")
    h = user.headers(biz)
    assert len(client.get(f"{API}/customers?q=acm", headers=h).json()["items"]) == 1
    assert client.get(f"{API}/customers?q=%25%25", headers=h).json()["items"] == []
    assert client.get(f"{API}/customers?q=%25", headers=h).status_code == 422  # below min length


# ---------------------------------------------------------------- invoices: creation and validation
def test_invoice_create_returns_paise_and_zero_balances(client, tenant):
    user, biz = tenant
    r = inv(client, user, biz, cust(client, user, biz), amount="1234.5")
    assert r.status_code == 201
    b = r.json()
    assert (b["total_paise"], b["paid_paise"], b["adjusted_paise"], b["outstanding_paise"]) == (123450, 0, 0, 123450)
    assert b["fy_label"] == "2026-27"[:7] or b["fy_label"] == "2026-27"


@pytest.mark.parametrize(
    "amount", ["0", "0.00", "-5", "1e3", "1,000", "10.123", " 10", "", "abc", "1000000000000.00", ".5", "5."]
)
def test_invoice_invalid_amount_strings(client, tenant, amount):
    user, biz = tenant
    r = inv(client, user, biz, cust(client, user, biz), amount=amount)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_amount"


@pytest.mark.parametrize("amount", [100, 10.5, None, True])
def test_invoice_non_string_amount_rejected(client, tenant, amount):
    user, biz = tenant
    cid = cust(client, user, biz)
    r = client.post(
        f"{API}/invoices",
        json={
            "customer_id": cid,
            "invoice_number": "N-1",
            "invoice_date": "2026-04-10",
            "due_date": "2026-05-10",
            "amount": amount,
        },
        headers=user.headers(biz),
    )
    assert r.status_code == 422


def test_invoice_maximum_amount_accepted(client, tenant):
    user, biz = tenant
    r = inv(client, user, biz, cust(client, user, biz), amount="999999999999.99")
    assert r.status_code == 201 and r.json()["total_paise"] == 99_999_999_999_999


def test_invoice_date_rules(client, tenant):
    user, biz = tenant
    cid = cust(client, user, biz)
    assert inv(client, user, biz, cid, number="D1", date="2026-04-10", due="2026-04-09").status_code == 422
    assert inv(client, user, biz, cid, number="D2", date="2099-01-01", due="2099-02-01").status_code == 422
    assert inv(client, user, biz, cid, number="D3", date="1999-12-31", due="2000-01-31").status_code == 422
    assert inv(client, user, biz, cid, number="D4", date="2026-04-10", due="2026-04-10").status_code == 201


def test_invoice_extra_fields_rejected(client, tenant):
    user, biz = tenant
    cid = cust(client, user, biz)
    r = client.post(
        f"{API}/invoices",
        json={"customer_id": cid, "invoice_number": "X1", "invoice_date": "2026-04-10", "due_date": "2026-05-10",
              "amount": "10", "status": "settled", "paid_paise": 10},
        headers=user.headers(biz),
    )  # fmt: skip
    assert r.status_code == 422


# ---------------------------------------------------------------- D-1 numbering per business and FY
def test_fy_boundary_assignment(client, tenant):
    user, biz = tenant
    cid = cust(client, user, biz)
    a = inv(client, user, biz, cid, number="B-1", date="2026-03-31", due="2026-04-30").json()
    b = inv(client, user, biz, cid, number="B-2", date="2026-04-01", due="2026-04-30").json()
    assert a["fy_label"] == "2025-26" and b["fy_label"] == "2026-27"


def test_duplicate_number_same_fy_rejected_normalized(client, tenant):
    user, biz = tenant
    cid = cust(client, user, biz)
    assert inv(client, user, biz, cid, number="inv 001").status_code == 201
    r = inv(client, user, biz, cid, number="INV001", date="2026-06-01", due="2026-07-01")
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_invoice_number"


def test_same_number_other_fy_and_other_business_accepted(client, new_user, make_business):
    a, b = new_user(), new_user()
    biz_a, biz_b = make_business(a), make_business(b)
    ca, cb = cust(client, a, biz_a), cust(client, b, biz_b)
    assert inv(client, a, biz_a, ca, number="7", date="2026-03-31", due="2026-04-30").status_code == 201
    assert inv(client, a, biz_a, ca, number="7", date="2026-04-01", due="2026-04-30").status_code == 201
    assert inv(client, b, biz_b, cb, number="7", date="2026-04-01", due="2026-04-30").status_code == 201


def test_cancelled_invoice_keeps_its_number_occupied(client, tenant):
    user, biz = tenant
    cid = cust(client, user, biz)
    iid = inv(client, user, biz, cid, number="K-1").json()["id"]
    assert (
        client.post(
            f"{API}/invoices/{iid}/cancel", json={"reason": "entered twice"}, headers=user.headers(biz)
        ).status_code
        == 200
    )
    assert inv(client, user, biz, cid, number="K-1").status_code == 409


# ---------------------------------------------------------------- update and cancel rules
def test_invoice_immutable_fields_rejected_on_patch(client, tenant):
    user, biz = tenant
    iid = inv(client, user, biz, cust(client, user, biz)).json()["id"]
    h = user.headers(biz)
    for body in ({"total_paise": 1}, {"amount": "1"}, {"invoice_date": "2026-04-01"}, {"invoice_number": "Z"},
                 {"customer_id": str(uuid.uuid4())}, {"status": "settled"}, {}):  # fmt: skip
        assert client.patch(f"{API}/invoices/{iid}", json=body, headers=h).status_code == 422, body


def test_invoice_patch_due_date_before_invoice_date_rejected(client, tenant):
    user, biz = tenant
    iid = inv(client, user, biz, cust(client, user, biz)).json()["id"]
    h = user.headers(biz)
    assert client.patch(f"{API}/invoices/{iid}", json={"due_date": "2026-04-01"}, headers=h).status_code == 422
    r = client.patch(f"{API}/invoices/{iid}", json={"due_date": "2026-06-30"}, headers=h)
    assert r.status_code == 200 and r.json()["due_date"] == "2026-06-30"


def test_cancel_rules(client, tenant, superuser_engine):
    user, biz = tenant
    cid = cust(client, user, biz)
    h = user.headers(biz)
    plain = inv(client, user, biz, cid, number="C-1").json()["id"]
    paid = inv(client, user, biz, cid, number="C-2").json()["id"]
    seed_payment(superuser_engine, biz, user, paid, 100)
    assert client.post(f"{API}/invoices/{plain}/cancel", json={}, headers=h).status_code == 422  # reason required
    assert (
        client.post(f"{API}/invoices/{plain}/cancel", json={"reason": "ab"}, headers=h).status_code == 422
    )  # too short
    r = client.post(f"{API}/invoices/{paid}/cancel", json={"reason": "wrong invoice"}, headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "invoice_has_active_financials"
    ok = client.post(f"{API}/invoices/{plain}/cancel", json={"reason": "wrong customer"}, headers=h)
    assert (
        ok.status_code == 200 and ok.json()["status"] == "cancelled" and ok.json()["cancel_reason"] == "wrong customer"
    )
    again = client.post(f"{API}/invoices/{plain}/cancel", json={"reason": "wrong customer"}, headers=h)
    assert again.status_code == 409 and again.json()["error"]["code"] == "invoice_not_open"
    assert client.patch(f"{API}/invoices/{plain}", json={"notes": "x"}, headers=h).status_code == 409


# ---------------------------------------------------------------- derived balances (D-2, D-10)
def test_outstanding_is_derived_from_active_payments_and_adjustments(client, tenant, superuser_engine):
    user, biz = tenant
    cid = cust(client, user, biz)
    iid = inv(client, user, biz, cid, amount="1000.00").json()["id"]
    seed_payment(superuser_engine, biz, user, iid, 30000)
    seed_payment(superuser_engine, biz, user, iid, 5000, status="reversed")  # must not count
    seed_adjustment(superuser_engine, biz, user, iid, 10000)
    d = client.get(f"{API}/invoices/{iid}", headers=user.headers(biz)).json()
    assert (d["total_paise"], d["paid_paise"], d["adjusted_paise"], d["outstanding_paise"]) == (
        100000,
        30000,
        10000,
        60000,
    )
    assert d["payment_state"] == "partial"


def test_payment_state_filter_and_settled(client, tenant, superuser_engine):
    user, biz = tenant
    cid = cust(client, user, biz)
    a = inv(client, user, biz, cid, number="P-1", amount="100").json()["id"]
    b = inv(client, user, biz, cid, number="P-2", amount="100").json()["id"]
    inv(client, user, biz, cid, number="P-3", amount="100")
    seed_payment(superuser_engine, biz, user, a, 10000)  # fully paid
    seed_payment(superuser_engine, biz, user, b, 4000)
    h = user.headers(biz)
    states = {i["invoice_number"]: i["payment_state"] for i in client.get(f"{API}/invoices", headers=h).json()["items"]}
    assert states == {"P-1": "settled", "P-2": "partial", "P-3": "unpaid"}
    only = client.get(f"{API}/invoices?payment_state=partial", headers=h).json()["items"]
    assert [i["invoice_number"] for i in only] == ["P-2"]


def test_customer_outstanding_matches_invoices(client, tenant, superuser_engine):
    user, biz = tenant
    cid = cust(client, user, biz)
    a = inv(client, user, biz, cid, number="O-1", amount="500").json()["id"]
    inv(client, user, biz, cid, number="O-2", amount="250")
    seed_payment(superuser_engine, biz, user, a, 20000)
    c = client.get(f"{API}/customers/{cid}", headers=user.headers(biz)).json()
    assert c["outstanding_paise"] == 30000 + 25000


def test_overdue_filter(client, tenant):
    user, biz = tenant
    cid = cust(client, user, biz)
    inv(client, user, biz, cid, number="OD-1", date="2026-01-01", due="2026-01-10")
    inv(client, user, biz, cid, number="OD-2", date="2026-10-01", due="2099-12-31")
    items = client.get(f"{API}/invoices?overdue=true", headers=user.headers(biz)).json()["items"]
    assert [i["invoice_number"] for i in items] == ["OD-1"] and items[0]["days_overdue"] > 0


def test_filters_customer_fy_search_and_status(client, tenant):
    user, biz = tenant
    c1, c2 = cust(client, user, biz, "One Co", "9876543210"), cust(client, user, biz, "Two Co", "9876543211")
    inv(client, user, biz, c1, number="AB-1", date="2026-03-31", due="2026-04-30")
    inv(client, user, biz, c2, number="AB-2", date="2026-04-01", due="2026-04-30")
    gone = inv(client, user, biz, c2, number="ZZ-9").json()["id"]
    client.post(f"{API}/invoices/{gone}/cancel", json={"reason": "no longer valid"}, headers=user.headers(biz))
    h = user.headers(biz)

    def nums(qs):
        return sorted(i["invoice_number"] for i in client.get(f"{API}/invoices?{qs}", headers=h).json()["items"])

    assert nums(f"customer_id={c1}") == ["AB-1"]
    assert nums("fy=2025") == ["AB-1"]
    assert nums("fy=2026") == ["AB-2"]
    assert nums("q=ab") == ["AB-1", "AB-2"]
    assert nums("q=%25") == []
    assert nums("status=cancelled") == ["ZZ-9"]
    assert client.get(f"{API}/invoices?status=bogus", headers=h).status_code == 422


def test_invoice_pagination(client, tenant):
    user, biz = tenant
    cid = cust(client, user, biz)
    for i in range(5):
        inv(client, user, biz, cid, number=f"PG-{i}", due=f"2026-06-{10 + i}")
    h = user.headers(biz)
    seen, cursor = [], None
    for _ in range(5):
        url = f"{API}/invoices?limit=2" + (f"&cursor={cursor}" if cursor else "")
        page = client.get(url, headers=h).json()
        seen += [i["invoice_number"] for i in page["items"]]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert seen == [f"PG-{i}" for i in range(5)]


# ---------------------------------------------------------------- payment history
def test_payment_history_lists_active_and_reversed(client, tenant, superuser_engine):
    user, biz = tenant
    iid = inv(client, user, biz, cust(client, user, biz)).json()["id"]
    seed_payment(superuser_engine, biz, user, iid, 111)
    seed_payment(superuser_engine, biz, user, iid, 222, status="reversed")
    h = user.headers(biz)
    all_ = client.get(f"{API}/invoices/{iid}/payments", headers=h).json()["items"]
    assert sorted(p["amount_paise"] for p in all_) == [111, 222]
    active = client.get(f"{API}/invoices/{iid}/payments?status=active", headers=h).json()["items"]
    assert [p["amount_paise"] for p in active] == [111]
    reversed_ = client.get(f"{API}/invoices/{iid}/payments?status=reversed", headers=h).json()["items"]
    assert reversed_[0]["reversal_reason"] == "bounced"


# ---------------------------------------------------------------- audit
def test_mutations_write_audit_rows(client, tenant, superuser_engine):
    user, biz = tenant
    iid = inv(client, user, biz, cust(client, user, biz)).json()["id"]
    client.post(f"{API}/invoices/{iid}/cancel", json={"reason": "audit check"}, headers=user.headers(biz))
    with superuser_engine.connect() as conn:
        actions = {
            r[0] for r in conn.execute(text("SELECT action FROM mf.audit_logs WHERE business_id = :b"), {"b": biz})
        }
    assert {"business.created", "customer.created", "invoice.created", "invoice.cancelled"} <= actions
