"""Invoices (API.md section 5): create, list, detail, edit due date or notes, cancel."""

import uuid
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.core.dates import fy_label
from app.core.exceptions import ApiError
from app.dependencies.business import Tenant
from app.dependencies.roles import require_admin, require_staff
from app.modules.common.audit import write_audit
from app.modules.common.db_errors import constraint, map_db_error
from app.modules.common.pagination import DEFAULT_LIMIT, MAX_LIMIT, decode_cursor, encode_cursor
from app.modules.invoices.balance import INVOICE_SELECT, IS_OVERDUE, PAYMENT_STATE
from app.modules.invoices.schemas import (
    InvoiceCreate,
    InvoiceUpdate,
    PaymentStateFilter,
    ReasonBody,
    StatusFilter,
)

router = APIRouter(tags=["invoices"])

_NOT_FOUND = ApiError(404, "resource_not_found")


def _out(row: Any, *, detail: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": str(row["id"]),
        "invoice_number": row["invoice_number"],
        "fy_label": fy_label(row["fy_start_year"]),
        "customer": {"id": str(row["customer_id"]), "name": row["customer_name"]},
        "invoice_date": row["invoice_date"].isoformat(),
        "due_date": row["due_date"].isoformat(),
        "total_paise": row["total_paise"],
        "paid_paise": row["paid_paise"],
        "adjusted_paise": row["adjusted_paise"],
        "outstanding_paise": row["outstanding_paise"],
        "status": row["status"],
        "payment_state": row["payment_state"],
        "is_overdue": row["is_overdue"],
        "days_overdue": row["days_overdue"],
        "has_open_dispute": row["has_open_dispute"],
        "pending_promise_date": row["pending_promise_date"].isoformat() if row["pending_promise_date"] else None,
        "created_at": row["created_at"].isoformat(),
    }
    if detail:
        out["notes"] = row["notes"]
        out["cancelled_at"] = row["cancelled_at"].isoformat() if row["cancelled_at"] else None
        out["cancel_reason"] = row["cancel_reason"]
    return out


def fetch_invoice(tenant: Tenant, invoice_id: uuid.UUID) -> Any:
    """By-id read, always filtered by the verified business. Outside the tenant is just a 404."""
    row = (
        tenant.conn.execute(
            text(f"{INVOICE_SELECT} WHERE i.business_id = :b AND i.id = :id"),
            {"b": tenant.business_id, "id": invoice_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise _NOT_FOUND
    return row


def lock_invoice(tenant: Tenant, invoice_id: uuid.UUID) -> Any:
    """Lock the invoice row for the rest of the transaction (DATABASE.md section 6)."""
    row = (
        tenant.conn.execute(
            text("SELECT id, status, invoice_date FROM mf.invoices WHERE business_id = :b AND id = :id FOR UPDATE"),
            {"b": tenant.business_id, "id": invoice_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise _NOT_FOUND
    return row


@router.post("/invoices", status_code=201)
def create_invoice(body: InvoiceCreate, tenant: Annotated[Tenant, Depends(require_staff, scope="function")]) -> dict:
    # A customer id from another tenant is indistinguishable from a missing one: 404.
    customer = tenant.conn.execute(
        text("SELECT id FROM mf.customers WHERE business_id = :b AND id = :c"),
        {"b": tenant.business_id, "c": body.customer_id},
    ).first()
    if customer is None:
        raise _NOT_FOUND
    try:
        with tenant.conn.begin_nested():
            invoice_id = tenant.conn.execute(
                text(
                    "INSERT INTO mf.invoices (business_id, customer_id, invoice_number, invoice_date, "
                    "due_date, total_paise, notes, created_by) "
                    "VALUES (:b, :c, :n, :d, :due, :t, :notes, :u) RETURNING id"
                ),
                {
                    "b": tenant.business_id,
                    "c": body.customer_id,
                    "n": body.invoice_number,
                    "d": body.invoice_date,
                    "due": body.due_date,
                    "t": body.total_paise,
                    "notes": body.notes,
                    "u": tenant.user_id,
                },
            ).scalar_one()
    except IntegrityError as exc:
        if constraint(exc) == "invoices_number_fy_uq":
            raise ApiError(409, "duplicate_invoice_number") from None
        raise map_db_error(exc) from None
    except DBAPIError as exc:
        raise map_db_error(exc) from None
    write_audit(tenant, "invoice.created", "invoice", invoice_id, {"total_paise": body.total_paise})
    return _out(fetch_invoice(tenant, invoice_id))


@router.get("/invoices")
def list_invoices(
    tenant: Annotated[Tenant, Depends(require_staff, scope="function")],
    customer_id: uuid.UUID | None = None,
    status: StatusFilter = "open",
    payment_state: PaymentStateFilter | None = None,
    overdue: bool | None = None,
    fy: Annotated[int | None, Query(ge=2000, le=2100)] = None,
    q: Annotated[str | None, Query(max_length=40)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: str | None = None,
) -> dict:
    where = ["i.business_id = :b", "i.status = :status"]
    params: dict[str, Any] = {"b": tenant.business_id, "status": status, "lim": limit + 1}
    if customer_id:
        where.append("i.customer_id = :customer_id")
        params["customer_id"] = customer_id
    if fy is not None:
        where.append("i.fy_start_year = :fy")
        params["fy"] = fy
    if q:
        # Prefix match on the normalized number (upper-case, no spaces). The LIKE pattern is
        # escaped so user input cannot add wildcards.
        normalized = "".join(q.split()).upper()
        escaped = normalized.replace("\\", "\\\\").replace("_", "\\_").replace("%", "\\%")
        where.append("i.invoice_number_normalized LIKE :q ESCAPE '\\'")
        params["q"] = escaped + "%"
    if payment_state:
        where.append("(" + PAYMENT_STATE + ") = :payment_state")
        params["payment_state"] = payment_state
    if overdue is True:
        where.append(IS_OVERDUE)
    after = decode_cursor(cursor, 2)
    if after:
        try:
            params["c_due"], params["c_id"] = date.fromisoformat(str(after[0])), uuid.UUID(str(after[1]))
        except ValueError:
            raise ApiError(422, "validation_error", [{"field": "cursor", "code": "invalid"}]) from None
        where.append("(i.due_date, i.id) > (:c_due, :c_id)")
    sql = f"{INVOICE_SELECT} WHERE {' AND '.join(where)} ORDER BY i.due_date, i.id LIMIT :lim"
    rows = tenant.conn.execute(text(sql), params).mappings().all()
    page = rows[:limit]
    next_cursor = encode_cursor([page[-1]["due_date"].isoformat(), str(page[-1]["id"])]) if len(rows) > limit else None
    return {"items": [_out(r) for r in page], "next_cursor": next_cursor}


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: uuid.UUID, tenant: Annotated[Tenant, Depends(require_staff, scope="function")]) -> dict:
    return _out(fetch_invoice(tenant, invoice_id), detail=True)


@router.patch("/invoices/{invoice_id}")
def update_invoice(
    invoice_id: uuid.UUID, body: InvoiceUpdate, tenant: Annotated[Tenant, Depends(require_staff, scope="function")]
) -> dict:
    current = lock_invoice(tenant, invoice_id)
    if current["status"] != "open":
        raise ApiError(409, "invoice_not_open")
    fields = body.model_fields_set
    if "due_date" in fields:
        if body.due_date is None:
            raise ApiError(422, "validation_error", [{"field": "due_date", "code": "none_not_allowed"}])
        if body.due_date < current["invoice_date"]:
            raise ApiError(422, "validation_error", [{"field": "due_date", "code": "before_invoice_date"}])
    try:
        tenant.conn.execute(
            text(
                "UPDATE mf.invoices SET "
                "due_date = CASE WHEN :set_due THEN :due ELSE due_date END, "
                "notes = CASE WHEN :set_notes THEN :notes ELSE notes END "
                "WHERE business_id = :b AND id = :id"
            ),
            {
                "set_due": "due_date" in fields,
                "due": body.due_date,
                "set_notes": "notes" in fields,
                "notes": body.notes,
                "b": tenant.business_id,
                "id": invoice_id,
            },
        )
    except DBAPIError as exc:
        raise map_db_error(exc) from None
    write_audit(tenant, "invoice.updated", "invoice", invoice_id, {"fields": sorted(fields)})
    return _out(fetch_invoice(tenant, invoice_id), detail=True)


@router.post("/invoices/{invoice_id}/cancel")
def cancel_invoice(
    invoice_id: uuid.UUID, body: ReasonBody, tenant: Annotated[Tenant, Depends(require_admin, scope="function")]
) -> dict:
    current = lock_invoice(tenant, invoice_id)
    if current["status"] != "open":
        raise ApiError(409, "invoice_not_open")
    active = tenant.conn.execute(
        text(
            "SELECT (SELECT count(*) FROM mf.payments WHERE business_id = :b AND invoice_id = :id AND status = 'active') "
            "+ (SELECT count(*) FROM mf.invoice_adjustments WHERE business_id = :b AND invoice_id = :id "
            "AND status = 'active')"
        ),
        {"b": tenant.business_id, "id": invoice_id},
    ).scalar_one()
    if active:
        raise ApiError(409, "invoice_has_active_financials")
    try:
        tenant.conn.execute(
            text(
                "UPDATE mf.invoices SET status = 'cancelled', cancelled_at = now(), cancelled_by = :u, "
                "cancel_reason = :r WHERE business_id = :b AND id = :id"
            ),
            {"u": tenant.user_id, "r": body.reason, "b": tenant.business_id, "id": invoice_id},
        )
    except DBAPIError as exc:
        raise map_db_error(exc) from None
    write_audit(tenant, "invoice.cancelled", "invoice", invoice_id, {})
    return _out(fetch_invoice(tenant, invoice_id), detail=True)
