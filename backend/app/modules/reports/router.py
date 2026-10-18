"""Dashboard and reports (API.md section 9). Read-only; every figure is derived at read time from
the single balance definition in invoices/balance.py. Collected cash counts payments only."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from app.dependencies.business import Tenant
from app.dependencies.roles import require_staff
from app.modules.common.pagination import MAX_LIMIT
from app.modules.invoices.balance import BALANCE_FROM, IS_OVERDUE, TODAY_IST

router = APIRouter(tags=["reports"])

_OUTSTANDING = "(i.total_paise - COALESCE(p.paid, 0) - COALESCE(a.adj, 0))"
_DAYS_OVERDUE = f"({TODAY_IST} - i.due_date)"
_BUCKET = f"""
CASE
  WHEN i.due_date >= {TODAY_IST} THEN 'current'
  WHEN {_DAYS_OVERDUE} <= 30 THEN '1-30'
  WHEN {_DAYS_OVERDUE} <= 60 THEN '31-60'
  WHEN {_DAYS_OVERDUE} <= 90 THEN '61-90'
  ELSE '90+'
END
"""
_BUCKETS = ("current", "1-30", "31-60", "61-90", "90+")


@router.get("/dashboard/summary")
def dashboard_summary(tenant: Annotated[Tenant, Depends(require_staff, scope="function")]) -> dict[str, Any]:
    params = {"b": tenant.business_id}
    row = (
        tenant.conn.execute(
            text(
                f"""
SELECT {TODAY_IST} AS as_of,
  COALESCE(SUM({_OUTSTANDING}), 0)::bigint AS total_outstanding,
  COALESCE(SUM({_OUTSTANDING}) FILTER (WHERE {IS_OVERDUE}), 0)::bigint AS overdue_outstanding,
  COUNT(*) AS open_count,
  COUNT(*) FILTER (WHERE {IS_OVERDUE}) AS overdue_count
FROM {BALANCE_FROM}
WHERE i.business_id = :b AND i.status = 'open' AND {_OUTSTANDING} > 0
"""
            ),
            params,
        )
        .mappings()
        .one()
    )
    collected = tenant.conn.execute(
        text(
            f"SELECT COALESCE(SUM(amount_paise), 0)::bigint FROM mf.payments WHERE business_id = :b "
            f"AND status = 'active' AND paid_on > {TODAY_IST} - 30 AND paid_on <= {TODAY_IST}"
        ),
        params,
    ).scalar_one()
    promises = (
        tenant.conn.execute(
            text(
                f"""
SELECT COUNT(*) FILTER (WHERE pp.promised_date = {TODAY_IST}) AS due_today,
       COUNT(*) FILTER (WHERE pp.promised_date < {TODAY_IST}) AS overdue
FROM mf.payment_promises pp
JOIN mf.invoices i ON i.business_id = pp.business_id AND i.id = pp.invoice_id AND i.status = 'open'
WHERE pp.business_id = :b AND pp.status = 'pending'
"""
            ),
            params,
        )
        .mappings()
        .one()
    )
    disputes = tenant.conn.execute(
        text("SELECT COUNT(*) FROM mf.disputes WHERE business_id = :b AND status = 'open'"), params
    ).scalar_one()
    return {
        "as_of": row["as_of"].isoformat(),
        "total_outstanding_paise": row["total_outstanding"],
        "overdue_outstanding_paise": row["overdue_outstanding"],
        "open_invoice_count": row["open_count"],
        "overdue_invoice_count": row["overdue_count"],
        "collected_last_30_days_paise": collected,
        "promises_due_today": promises["due_today"],
        "promises_overdue": promises["overdue"],
        "open_disputes": disputes,
    }


@router.get("/reports/invoice-aging")
def invoice_aging(
    tenant: Annotated[Tenant, Depends(require_staff, scope="function")],
    customer_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 25,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> dict[str, Any]:
    params: dict[str, Any] = {"b": tenant.business_id, "lim": limit, "off": offset}
    extra = ""
    if customer_id:
        extra = " AND i.customer_id = :cust"
        params["cust"] = customer_id
    base = f"FROM {BALANCE_FROM} JOIN mf.customers c ON c.business_id = i.business_id AND c.id = i.customer_id"
    where = f"WHERE i.business_id = :b AND i.status = 'open' AND {_OUTSTANDING} > 0{extra}"
    buckets = {
        r["bucket"]: r
        for r in tenant.conn.execute(
            text(
                f"SELECT {_BUCKET} AS bucket, COUNT(*) AS n, COALESCE(SUM({_OUTSTANDING}), 0)::bigint AS total "
                f"{base} {where} GROUP BY 1"
            ),
            params,
        ).mappings()
    }
    items = tenant.conn.execute(
        text(
            f"SELECT i.id, i.invoice_number, c.name AS customer_name, i.due_date, {_DAYS_OVERDUE} AS days_overdue, "
            f"{_OUTSTANDING}::bigint AS outstanding, {_BUCKET} AS bucket {base} {where} AND {IS_OVERDUE} "
            f"ORDER BY days_overdue DESC, i.id LIMIT :lim OFFSET :off"
        ),
        params,
    ).mappings()
    as_of = tenant.conn.execute(text(f"SELECT {TODAY_IST}")).scalar_one()
    return {
        "as_of": as_of.isoformat(),
        "buckets": [
            {
                "bucket": name,
                "invoice_count": buckets[name]["n"] if name in buckets else 0,
                "outstanding_paise": buckets[name]["total"] if name in buckets else 0,
            }
            for name in _BUCKETS
        ],
        "items": [
            {
                "invoice_id": str(r["id"]),
                "invoice_number": r["invoice_number"],
                "customer_name": r["customer_name"],
                "due_date": r["due_date"].isoformat(),
                "days_overdue": r["days_overdue"],
                "outstanding_paise": r["outstanding"],
                "bucket": r["bucket"],
            }
            for r in items
        ],
    }


@router.get("/reports/customer-outstanding")
def customer_outstanding(
    tenant: Annotated[Tenant, Depends(require_staff, scope="function")],
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 25,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> dict[str, Any]:
    rows = tenant.conn.execute(
        text(
            f"""
SELECT c.id AS customer_id, c.name AS customer_name, COUNT(*) AS open_invoices,
  COALESCE(SUM({_OUTSTANDING}), 0)::bigint AS outstanding,
  COALESCE(SUM({_OUTSTANDING}) FILTER (WHERE {IS_OVERDUE}), 0)::bigint AS overdue,
  MIN(i.due_date) AS oldest_due_date
FROM {BALANCE_FROM} JOIN mf.customers c ON c.business_id = i.business_id AND c.id = i.customer_id
WHERE i.business_id = :b AND i.status = 'open' AND {_OUTSTANDING} > 0
GROUP BY c.id, c.name
ORDER BY outstanding DESC, c.id
LIMIT :lim OFFSET :off
"""
        ),
        {"b": tenant.business_id, "lim": limit, "off": offset},
    ).mappings()
    return {
        "items": [
            {
                "customer_id": str(r["customer_id"]),
                "customer_name": r["customer_name"],
                "open_invoices": r["open_invoices"],
                "outstanding_paise": r["outstanding"],
                "overdue_paise": r["overdue"],
                "oldest_due_date": r["oldest_due_date"].isoformat(),
            }
            for r in rows
        ]
    }
