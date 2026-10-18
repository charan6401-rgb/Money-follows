"""S4 payments (idempotent record, overpayment, concurrency, reversal) and S5 reports."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from sqlalchemy import text

from app.core.dates import today_ist
from tests.test_api_security import API, cust, inv

TODAY = today_ist()


def d(days_ago: int) -> str:
    return (TODAY - timedelta(days=days_ago)).isoformat()


def key() -> str:
    return "k" + uuid.uuid4().hex


def pay(client, user, biz, invoice_id, amount="400.00", *, k=None, **over):
    body = {
        "amount": amount,
        "paid_on": d(0),
        "method": "upi",
        "reference": None,
        "note": None,
        "allow_duplicate": False,
    }
    body.update(over)
    return client.post(
        f"{API}/invoices/{invoice_id}/payments", json=body, headers={**user.headers(biz), "Idempotency-Key": k or key()}
    )


@pytest.fixture
def invoice(client, tenant):
    user, biz = tenant
    iid = inv(client, user, biz, cust(client, user, biz), date=d(30), due=d(-30), amount="1000").json()["id"]
    return user, biz, iid


def detail(client, user, biz, iid):
    return client.get(f"{API}/invoices/{iid}", headers=user.headers(biz)).json()


# ---------------------------------------------------------------- record
def test_record_payment_updates_balance(client, invoice):
    user, biz, iid = invoice
    r = pay(client, user, biz, iid, "400.50", reference="UTR1")
    assert r.status_code == 201, r.text
    b = r.json()
    assert (b["amount_paise"], b["invoice_outstanding_paise"], b["status"]) == (40050, 59950, "active")
    dd = detail(client, user, biz, iid)
    assert (dd["paid_paise"], dd["outstanding_paise"], dd["payment_state"]) == (40050, 59950, "partial")


def test_exact_payment_settles_invoice(client, invoice):
    user, biz, iid = invoice
    assert pay(client, user, biz, iid, "1000").status_code == 201
    assert detail(client, user, biz, iid)["payment_state"] == "settled"
    assert pay(client, user, biz, iid, "0.01").status_code == 422  # nothing left


def test_idempotency_key_required_and_validated(client, invoice):
    user, biz, iid = invoice
    body = {"amount": "10", "paid_on": d(0), "method": "cash"}
    r = client.post(f"{API}/invoices/{iid}/payments", json=body, headers=user.headers(biz))
    assert r.status_code == 400 and r.json()["error"]["code"] == "idempotency_key_required"
    r = client.post(
        f"{API}/invoices/{iid}/payments", json=body, headers={**user.headers(biz), "Idempotency-Key": "short"}
    )
    assert r.status_code == 422
    r = client.post(
        f"{API}/invoices/{iid}/payments",
        json=body,
        headers={**user.headers(biz), "Idempotency-Key": "bad key with spaces!!"},
    )
    assert r.status_code == 422


def test_same_key_same_body_replays_without_second_payment(client, invoice):
    user, biz, iid = invoice
    k = key()
    first = pay(client, user, biz, iid, "100", k=k)
    again = pay(client, user, biz, iid, "100", k=k)
    assert first.status_code == again.status_code == 201
    assert again.json() == first.json() and again.headers["idempotent-replay"] == "true"
    assert "idempotent-replay" not in first.headers
    assert detail(client, user, biz, iid)["paid_paise"] == 10000


def test_same_key_different_body_or_invoice_is_rejected(client, invoice):
    user, biz, iid = invoice
    other = inv(
        client, user, biz, cust(client, user, biz, "Other Co", "9876543299"), number="OTHER", amount="500"
    ).json()["id"]
    k = key()
    assert pay(client, user, biz, iid, "100", k=k).status_code == 201
    r = pay(client, user, biz, iid, "200", k=k)
    assert r.status_code == 422 and r.json()["error"]["code"] == "idempotency_key_reuse"
    assert pay(client, user, biz, other, "100", k=k).status_code == 422
    assert detail(client, user, biz, iid)["paid_paise"] == 10000


def test_same_key_in_another_business_is_independent(client, invoice, new_user, make_business):
    user, biz, iid = invoice
    k = key()
    assert pay(client, user, biz, iid, "100", k=k).status_code == 201
    other_user = new_user()
    other_biz = make_business(other_user)
    other_inv = inv(client, other_user, other_biz, cust(client, other_user, other_biz), amount="500").json()["id"]
    r = pay(client, other_user, other_biz, other_inv, "100", k=k)
    assert r.status_code == 201 and "idempotent-replay" not in r.headers


def test_overpayment_rejected_and_leaves_no_trace(client, invoice, superuser_engine):
    user, biz, iid = invoice
    k = key()
    r = pay(client, user, biz, iid, "1000.01", k=k)
    assert r.status_code == 422 and r.json()["error"]["code"] == "overpayment_rejected"
    with superuser_engine.connect() as conn:
        assert (
            conn.execute(text("SELECT count(*) FROM mf.payments WHERE invoice_id = :i"), {"i": iid}).scalar_one() == 0
        )
        assert conn.execute(text("SELECT count(*) FROM mf.idempotency_keys WHERE key = :k"), {"k": k}).scalar_one() == 0
    assert pay(client, user, biz, iid, "10", k=k).status_code == 201  # the failed attempt did not burn the key


def test_soft_duplicate_detection(client, invoice):
    user, biz, iid = invoice
    assert pay(client, user, biz, iid, "100", reference="UTR-9").status_code == 201
    dup = pay(client, user, biz, iid, "100", reference="utr-9")
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "possible_duplicate_payment"
    assert pay(client, user, biz, iid, "100", reference="utr-9", allow_duplicate=True).status_code == 201
    assert (
        pay(client, user, biz, iid, "100", reference="DIFFERENT").status_code == 201
    )  # different reference is not a duplicate
    assert detail(client, user, biz, iid)["paid_paise"] == 30000


@pytest.mark.parametrize("amount", ["0", "-1", "1e2", "10.001", "abc", "", "1,000"])
def test_payment_invalid_amount(client, invoice, amount):
    user, biz, iid = invoice
    r = pay(client, user, biz, iid, amount)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_amount"


def test_payment_date_and_field_rules(client, invoice):
    user, biz, iid = invoice
    assert pay(client, user, biz, iid, paid_on=(TODAY + timedelta(days=1)).isoformat()).status_code == 422
    assert pay(client, user, biz, iid, paid_on=d(31)).status_code == 422  # before the invoice date (30 days ago)
    assert pay(client, user, biz, iid, method="bitcoin").status_code == 422
    assert pay(client, user, biz, iid, status="reversed").status_code == 422
    assert pay(client, user, biz, iid, business_id=str(uuid.uuid4())).status_code == 422
    assert pay(client, user, biz, iid, amount=100).status_code == 422  # number, not string
    assert pay(client, user, biz, iid, reference="x" * 61).status_code == 422
    assert pay(client, user, biz, iid, paid_on=d(30)).status_code == 201  # the invoice date itself is allowed


def test_payment_on_cancelled_invoice_rejected(client, tenant):
    user, biz = tenant
    iid = inv(client, user, biz, cust(client, user, biz), amount="100").json()["id"]
    client.post(f"{API}/invoices/{iid}/cancel", json={"reason": "wrong entry"}, headers=user.headers(biz))
    r = pay(client, user, biz, iid, "10")
    assert r.status_code == 409 and r.json()["error"]["code"] == "invoice_not_open"


def test_payment_cross_tenant_is_404_and_leaves_nothing(client, invoice, new_user, make_business, superuser_engine):
    user, biz, iid = invoice
    bob = new_user()
    bob_biz = make_business(bob)
    assert pay(client, bob, bob_biz, iid, "10").status_code == 404
    assert pay(client, bob, biz, iid, "10").status_code == 403  # not a member of that business
    with superuser_engine.connect() as conn:
        assert (
            conn.execute(text("SELECT count(*) FROM mf.payments WHERE invoice_id = :i"), {"i": iid}).scalar_one() == 0
        )


def test_staff_can_record_payments(client, new_user, make_business, add_member):
    owner, staff = new_user(), new_user()
    biz = make_business(owner)
    add_member(biz, staff, "staff")
    iid = inv(client, owner, biz, cust(client, owner, biz), amount="100").json()["id"]
    assert pay(client, staff, biz, iid, "10").status_code == 201


# ---------------------------------------------------------------- concurrency (real parallel requests)
def test_concurrent_payments_cannot_overpay(client, invoice):
    user, biz, iid = invoice
    with ThreadPoolExecutor(max_workers=2) as ex:
        futures = [ex.submit(pay, client, user, biz, iid, "600", allow_duplicate=True) for _ in range(2)]
        codes = sorted(f.result().status_code for f in futures)
    assert codes == [201, 422]
    dd = detail(client, user, biz, iid)
    assert dd["paid_paise"] == 60000 and dd["outstanding_paise"] == 40000


def test_concurrent_requests_with_same_key_create_one_payment(client, invoice):
    user, biz, iid = invoice
    k = key()
    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(lambda _: pay(client, user, biz, iid, "100", k=k), range(4)))
    assert {r.status_code for r in results} == {201}
    assert len({r.json()["id"] for r in results}) == 1
    assert detail(client, user, biz, iid)["paid_paise"] == 10000


def test_many_concurrent_payments_never_exceed_total(client, invoice):
    user, biz, iid = invoice
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(lambda _: pay(client, user, biz, iid, "300", allow_duplicate=True), range(8)))
    ok = sum(1 for r in results if r.status_code == 201)
    assert ok == 3 and all(r.status_code in (201, 422) for r in results)
    assert detail(client, user, biz, iid)["paid_paise"] == 90000


# ---------------------------------------------------------------- reverse
def test_reverse_payment_restores_balance(client, invoice, new_user, add_member):
    user, biz, iid = invoice
    pid = pay(client, user, biz, iid, "250").json()["id"]
    r = client.post(f"{API}/payments/{pid}/reverse", json={"reason": "Cheque bounced"}, headers=user.headers(biz))
    assert r.status_code == 200
    b = r.json()
    assert (b["status"], b["invoice_outstanding_paise"], b["reversal_reason"]) == ("reversed", 100000, "Cheque bounced")
    dd = detail(client, user, biz, iid)
    assert (dd["paid_paise"], dd["outstanding_paise"], dd["payment_state"]) == (0, 100000, "unpaid")
    again = client.post(f"{API}/payments/{pid}/reverse", json={"reason": "Cheque bounced"}, headers=user.headers(biz))
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_reversed"
    history = client.get(f"{API}/invoices/{iid}/payments", headers=user.headers(biz)).json()["items"]
    assert [(p["status"], p["amount_paise"]) for p in history] == [("reversed", 25000)]  # retained, never deleted


def test_reverse_requires_admin_and_valid_reason(client, new_user, make_business, add_member):
    owner, admin, staff = new_user(), new_user(), new_user()
    biz = make_business(owner)
    add_member(biz, admin, "admin")
    add_member(biz, staff, "staff")
    iid = inv(client, owner, biz, cust(client, owner, biz), amount="100").json()["id"]
    ids = [pay(client, owner, biz, iid, str(i + 1)).json()["id"] for i in range(2)]
    r = client.post(f"{API}/payments/{ids[0]}/reverse", json={"reason": "no way"}, headers=staff.headers(biz))
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden_role"
    assert (
        client.post(f"{API}/payments/{ids[0]}/reverse", json={"reason": "x"}, headers=admin.headers(biz)).status_code
        == 422
    )
    assert client.post(f"{API}/payments/{ids[0]}/reverse", json={}, headers=admin.headers(biz)).status_code == 422
    assert (
        client.post(
            f"{API}/payments/{ids[0]}/reverse", json={"reason": "entered wrongly"}, headers=admin.headers(biz)
        ).status_code
        == 200
    )


def test_reverse_cross_tenant_is_404(client, invoice, new_user, make_business):
    user, biz, iid = invoice
    pid = pay(client, user, biz, iid, "10").json()["id"]
    bob = new_user()
    bob_biz = make_business(bob)
    assert (
        client.post(
            f"{API}/payments/{pid}/reverse", json={"reason": "attack"}, headers=bob.headers(bob_biz)
        ).status_code
        == 404
    )
    assert detail(client, user, biz, iid)["paid_paise"] == 1000


def test_invoice_can_be_cancelled_once_payments_are_reversed(client, invoice):
    user, biz, iid = invoice
    pid = pay(client, user, biz, iid, "10").json()["id"]
    h = user.headers(biz)
    assert client.post(f"{API}/invoices/{iid}/cancel", json={"reason": "wrong invoice"}, headers=h).status_code == 409
    client.post(f"{API}/payments/{pid}/reverse", json={"reason": "wrong entry"}, headers=h)
    assert client.post(f"{API}/invoices/{iid}/cancel", json={"reason": "wrong invoice"}, headers=h).status_code == 200


def test_payments_are_audited(client, invoice, superuser_engine):
    user, biz, iid = invoice
    pid = pay(client, user, biz, iid, "10").json()["id"]
    client.post(f"{API}/payments/{pid}/reverse", json={"reason": "wrong entry"}, headers=user.headers(biz))
    with superuser_engine.connect() as conn:
        actions = {
            r[0] for r in conn.execute(text("SELECT action FROM mf.audit_logs WHERE business_id = :b"), {"b": biz})
        }
        detail_ = conn.execute(
            text("SELECT detail::text FROM mf.audit_logs WHERE action = 'payment.recorded' AND business_id = :b"),
            {"b": biz},
        ).scalar_one()
    assert {"payment.recorded", "payment.reversed"} <= actions
    assert "UTR" not in detail_ and "wrong" not in detail_


# ---------------------------------------------------------------- reports
def test_dashboard_summary_figures(client, tenant, superuser_engine):
    user, biz = tenant
    cid = cust(client, user, biz)
    overdue = inv(client, user, biz, cid, number="R-1", date=d(100), due=d(40), amount="1000").json()["id"]
    inv(client, user, biz, cid, number="R-2", date=d(5), due=d(-20), amount="500")  # current, not overdue
    gone = inv(client, user, biz, cid, number="R-3", date=d(5), due=d(2), amount="9999").json()["id"]
    client.post(f"{API}/invoices/{gone}/cancel", json={"reason": "cancelled one"}, headers=user.headers(biz))
    assert pay(client, user, biz, overdue, "200").status_code == 201
    with superuser_engine.begin() as conn:  # TDS adjustment must NOT count as collected cash
        conn.execute(
            text(
                "INSERT INTO mf.invoice_adjustments (business_id, invoice_id, kind, amount_paise, adjusted_on, reason, created_by) "
                "VALUES (:b, :i, 'tds', 5000, :d, 'tds deducted', :u)"
            ),
            {"b": biz, "i": overdue, "d": TODAY, "u": user.id},
        )
    s = client.get(f"{API}/dashboard/summary", headers=user.headers(biz)).json()
    assert s["as_of"] == TODAY.isoformat()
    assert s["total_outstanding_paise"] == (100000 - 20000 - 5000) + 50000
    assert s["overdue_outstanding_paise"] == 75000
    assert (s["open_invoice_count"], s["overdue_invoice_count"]) == (2, 1)
    assert s["collected_last_30_days_paise"] == 20000
    assert (s["promises_due_today"], s["promises_overdue"], s["open_disputes"]) == (0, 0, 0)


def test_dashboard_collected_excludes_reversed_and_old_payments(client, tenant, superuser_engine):
    user, biz = tenant
    iid = inv(client, user, biz, cust(client, user, biz), date=d(90), due=d(60), amount="1000").json()["id"]
    pay(client, user, biz, iid, "100", paid_on=d(45))  # outside the 30-day window
    pay(client, user, biz, iid, "100", paid_on=d(29), reference="in-window")
    rev = pay(client, user, biz, iid, "100", paid_on=d(1), reference="reversed-one").json()["id"]
    client.post(f"{API}/payments/{rev}/reverse", json={"reason": "bounced"}, headers=user.headers(biz))
    s = client.get(f"{API}/dashboard/summary", headers=user.headers(biz)).json()
    assert s["collected_last_30_days_paise"] == 10000


def test_dashboard_is_tenant_scoped(client, new_user, make_business):
    alice, bob = new_user(), new_user()
    biz_a, biz_b = make_business(alice), make_business(bob)
    inv(client, alice, biz_a, cust(client, alice, biz_a), amount="777")
    assert (
        client.get(f"{API}/dashboard/summary", headers=alice.headers(biz_a)).json()["total_outstanding_paise"] == 77700
    )
    s = client.get(f"{API}/dashboard/summary", headers=bob.headers(biz_b)).json()
    assert s["total_outstanding_paise"] == 0 and s["open_invoice_count"] == 0
    assert client.get(f"{API}/dashboard/summary", headers=bob.headers(biz_a)).status_code == 403


def test_aging_buckets_and_items(client, tenant):
    user, biz = tenant
    cid = cust(client, user, biz)
    plan = [("A", -5, "100"), ("B", 10, "200"), ("C", 45, "300"), ("D", 75, "400"), ("E", 120, "500")]
    for name, days_overdue, amount in plan:
        inv(client, user, biz, cid, number=name, date=d(days_overdue + 60), due=d(days_overdue), amount=amount)
    r = client.get(f"{API}/reports/invoice-aging", headers=user.headers(biz)).json()
    assert [(b["bucket"], b["invoice_count"], b["outstanding_paise"]) for b in r["buckets"]] == [
        ("current", 1, 10000), ("1-30", 1, 20000), ("31-60", 1, 30000), ("61-90", 1, 40000), ("90+", 1, 50000),
    ]  # fmt: skip
    assert [i["invoice_number"] for i in r["items"]] == ["E", "D", "C", "B"]  # overdue only, oldest first
    assert r["items"][0]["bucket"] == "90+" and r["items"][0]["days_overdue"] == 120
    page = client.get(f"{API}/reports/invoice-aging?limit=2&offset=2", headers=user.headers(biz)).json()
    assert [i["invoice_number"] for i in page["items"]] == ["C", "B"]
    assert client.get(f"{API}/reports/invoice-aging?limit=101", headers=user.headers(biz)).status_code == 422
    assert (
        client.get(f"{API}/reports/invoice-aging?customer_id={uuid.uuid4()}", headers=user.headers(biz)).json()["items"]
        == []
    )


def test_aging_boundaries(client, tenant):
    user, biz = tenant
    cid = cust(client, user, biz)
    for name, days in (
        ("T0", 0),
        ("T1", 1),
        ("T30", 30),
        ("T31", 31),
        ("T60", 60),
        ("T61", 61),
        ("T90", 90),
        ("T91", 91),
    ):
        inv(client, user, biz, cid, number=name, date=d(days + 10), due=d(days), amount="10")
    b = {
        x["bucket"]: x["invoice_count"]
        for x in client.get(f"{API}/reports/invoice-aging", headers=user.headers(biz)).json()["buckets"]
    }
    assert b == {"current": 1, "1-30": 2, "31-60": 2, "61-90": 2, "90+": 1}  # due today is still current


def test_customer_outstanding_report(client, tenant):
    user, biz = tenant
    c1, c2 = cust(client, user, biz, "Big Co", "9876543210"), cust(client, user, biz, "Small Co", "9876543211")
    inv(client, user, biz, c1, number="X1", date=d(50), due=d(20), amount="900")
    inv(client, user, biz, c1, number="X2", date=d(5), due=d(-5), amount="100")
    inv(client, user, biz, c2, number="X3", date=d(5), due=d(-5), amount="50")
    items = client.get(f"{API}/reports/customer-outstanding", headers=user.headers(biz)).json()["items"]
    assert [(i["customer_name"], i["open_invoices"], i["outstanding_paise"], i["overdue_paise"]) for i in items] == [
        ("Big Co", 2, 100000, 90000), ("Small Co", 1, 5000, 0),
    ]  # fmt: skip
