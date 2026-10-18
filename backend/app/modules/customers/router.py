"""Customers (API.md section 4): create, list, detail, update. There is no delete (DECISIONS D-5)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.core.exceptions import ApiError
from app.dependencies.business import Tenant
from app.dependencies.roles import require_staff
from app.modules.common.audit import write_audit
from app.modules.common.db_errors import constraint, map_db_error
from app.modules.common.pagination import DEFAULT_LIMIT, MAX_LIMIT, decode_cursor, encode_cursor
from app.modules.customers.schemas import CustomerCreate, CustomerUpdate
from app.modules.invoices.balance import BALANCE_FROM, TODAY_IST

router = APIRouter(tags=["customers"])

# Per-customer money, built from the single balance definition (open invoices only).
_CUSTOMER_MONEY = f"""
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(x.outstanding), 0)::bigint AS outstanding,
         COALESCE(SUM(x.outstanding) FILTER (WHERE x.due_date < {TODAY_IST}), 0)::bigint AS overdue,
         COUNT(*) FILTER (WHERE x.outstanding > 0)::int AS open_count
  FROM (SELECT i.due_date, (i.total_paise - COALESCE(p.paid, 0) - COALESCE(a.adj, 0)) AS outstanding
        FROM {BALANCE_FROM}
        WHERE i.business_id = c.business_id AND i.customer_id = c.id AND i.status = 'open') x
) m ON true
"""

_NOT_FOUND = ApiError(404, "resource_not_found")


def _item(row: Any) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "phone": row["phone"],
        "is_active": row["is_active"],
        "outstanding_paise": row["outstanding"],
        "overdue_paise": row["overdue"],
    }


def _fetch(tenant: Tenant, customer_id: uuid.UUID) -> Any:
    row = (
        tenant.conn.execute(
            text(
                "SELECT c.id, c.name, c.phone, c.is_active, c.notes, c.preferred_language, "
                "m.outstanding, m.overdue, m.open_count FROM mf.customers c "
                f"{_CUSTOMER_MONEY} WHERE c.business_id = :b AND c.id = :id"
            ),
            {"b": tenant.business_id, "id": customer_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise _NOT_FOUND
    return row


@router.post("/customers", status_code=201)
def create_customer(body: CustomerCreate, tenant: Annotated[Tenant, Depends(require_staff, scope="function")]) -> dict:
    try:
        with tenant.conn.begin_nested():
            row = (
                tenant.conn.execute(
                    text(
                        "INSERT INTO mf.customers (business_id, name, phone, notes, preferred_language, created_by) "
                        "VALUES (:b, :n, :p, :notes, :l, :u) "
                        "RETURNING id, name, name_normalized, phone, preferred_language, is_active, created_at"
                    ),
                    {
                        "b": tenant.business_id,
                        "n": body.name,
                        "p": body.phone,
                        "notes": body.notes,
                        "l": body.preferred_language,
                        "u": tenant.user_id,
                    },
                )
                .mappings()
                .one()
            )
    except IntegrityError as exc:
        if constraint(exc) == "customers_phone_uq":
            raise ApiError(409, "duplicate_customer_phone") from None
        raise map_db_error(exc) from None
    similar = tenant.conn.execute(
        text(
            "SELECT EXISTS (SELECT 1 FROM mf.customers WHERE business_id = :b AND name_normalized = :nn AND id <> :id)"
        ),
        {"b": tenant.business_id, "nn": row["name_normalized"], "id": row["id"]},
    ).scalar_one()
    write_audit(tenant, "customer.created", "customer", row["id"], {})
    out: dict[str, Any] = {
        "id": str(row["id"]),
        "name": row["name"],
        "phone": row["phone"],
        "preferred_language": row["preferred_language"],
        "is_active": row["is_active"],
        "outstanding_paise": 0,
        "created_at": row["created_at"].isoformat(),
    }
    if similar:
        out["similar_name_exists"] = True
    return out


@router.get("/customers")
def list_customers(
    tenant: Annotated[Tenant, Depends(require_staff, scope="function")],
    q: Annotated[str | None, Query(min_length=2, max_length=60)] = None,
    is_active: bool = True,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: str | None = None,
) -> dict:
    where = ["c.business_id = :b", "c.is_active = :active"]
    params: dict[str, Any] = {"b": tenant.business_id, "active": is_active, "lim": limit + 1}
    if q:
        normalized = " ".join(q.split()).lower()
        esc = lambda s: s.replace("\\", "\\\\").replace("_", "\\_").replace("%", "\\%")  # noqa: E731
        where.append("(c.name_normalized LIKE :prefix ESCAPE '\\' OR c.phone LIKE :phone ESCAPE '\\')")
        params["prefix"] = esc(normalized) + "%"
        params["phone"] = "%" + esc("".join(q.split())) + "%"
    after = decode_cursor(cursor, 2)
    if after:
        try:
            params["c_name"], params["c_id"] = str(after[0]), uuid.UUID(str(after[1]))
        except ValueError:
            raise ApiError(422, "validation_error", [{"field": "cursor", "code": "invalid"}]) from None
        where.append("(c.name_normalized, c.id) > (:c_name, :c_id)")
    rows = (
        tenant.conn.execute(
            text(
                "SELECT c.id, c.name, c.name_normalized, c.phone, c.is_active, m.outstanding, m.overdue "
                f"FROM mf.customers c {_CUSTOMER_MONEY} WHERE {' AND '.join(where)} "
                "ORDER BY c.name_normalized, c.id LIMIT :lim"
            ),
            params,
        )
        .mappings()
        .all()
    )
    page = rows[:limit]
    next_cursor = encode_cursor([page[-1]["name_normalized"], str(page[-1]["id"])]) if len(rows) > limit else None
    return {"items": [_item(r) for r in page], "next_cursor": next_cursor}


@router.get("/customers/{customer_id}")
def get_customer(customer_id: uuid.UUID, tenant: Annotated[Tenant, Depends(require_staff, scope="function")]) -> dict:
    row = _fetch(tenant, customer_id)
    return {
        **_item(row),
        "notes": row["notes"],
        "preferred_language": row["preferred_language"],
        "open_invoice_count": row["open_count"],
    }


@router.patch("/customers/{customer_id}")
def update_customer(
    customer_id: uuid.UUID, body: CustomerUpdate, tenant: Annotated[Tenant, Depends(require_staff, scope="function")]
) -> dict:
    _fetch(tenant, customer_id)  # 404 if missing or in another tenant
    fields = body.model_fields_set
    sets = []
    params: dict[str, Any] = {"b": tenant.business_id, "id": customer_id}
    for field in ("name", "phone", "notes", "preferred_language", "is_active"):  # fixed allow-list
        if field in fields:
            sets.append(f"{field} = :{field}")
            params[field] = getattr(body, field)
    try:
        with tenant.conn.begin_nested():
            tenant.conn.execute(
                text(f"UPDATE mf.customers SET {', '.join(sets)} WHERE business_id = :b AND id = :id"), params
            )
    except IntegrityError as exc:
        if constraint(exc) == "customers_phone_uq":
            raise ApiError(409, "duplicate_customer_phone") from None
        raise map_db_error(exc) from None
    except DBAPIError as exc:
        raise map_db_error(exc) from None
    write_audit(tenant, "customer.updated", "customer", customer_id, {"fields": sorted(fields)})
    row = _fetch(tenant, customer_id)
    return {
        **_item(row),
        "notes": row["notes"],
        "preferred_language": row["preferred_language"],
        "open_invoice_count": row["open_count"],
    }
