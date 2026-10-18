"""Payments (API.md section 6): record (idempotent), history, reverse.

Recording follows DATABASE.md section 6: claim the key, lock the invoice row, recompute the
outstanding balance under the lock, reject overpayment, soft duplicate check, insert, audit,
store the response. Adjustments (section 7) are not implemented.
"""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.exceptions import ApiError
from app.dependencies.business import Tenant
from app.dependencies.roles import require_admin, require_staff
from app.modules.common import idempotency
from app.modules.common.audit import write_audit
from app.modules.common.db_errors import map_db_error
from app.modules.common.pagination import DEFAULT_LIMIT, MAX_LIMIT, decode_cursor, encode_cursor
from app.modules.invoices.router import lock_invoice
from app.modules.payments.schemas import PaymentCreate, ReverseBody

router = APIRouter(tags=["payments"])


@router.get("/invoices/{invoice_id}/payments")
def list_payments(
    invoice_id: uuid.UUID,
    tenant: Annotated[Tenant, Depends(require_staff, scope="function")],
    status: Literal["active", "reversed", "all"] = "all",
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: str | None = None,
) -> dict:
    exists = tenant.conn.execute(
        text("SELECT 1 FROM mf.invoices WHERE business_id = :b AND id = :id"),
        {"b": tenant.business_id, "id": invoice_id},
    ).first()
    if exists is None:
        raise ApiError(404, "resource_not_found")
    where = ["business_id = :b", "invoice_id = :inv"]
    params: dict[str, Any] = {"b": tenant.business_id, "inv": invoice_id, "lim": limit + 1}
    if status != "all":
        where.append("status = :status")
        params["status"] = status
    after = decode_cursor(cursor, 3)
    if after:
        try:
            params["c_paid"] = date.fromisoformat(str(after[0]))
            params["c_created"] = datetime.fromisoformat(str(after[1]))
            params["c_id"] = uuid.UUID(str(after[2]))
        except ValueError:
            raise ApiError(422, "validation_error", [{"field": "cursor", "code": "invalid"}]) from None
        # Sort is paid_on DESC, created_at DESC, id ASC.
        where.append(
            "(paid_on < :c_paid OR (paid_on = :c_paid AND (created_at < :c_created "
            "OR (created_at = :c_created AND id > :c_id))))"
        )
    rows = (
        tenant.conn.execute(
            text(
                "SELECT id, amount_paise, paid_on, method, reference, status, reversed_at, reversal_reason, created_at "
                f"FROM mf.payments WHERE {' AND '.join(where)} ORDER BY paid_on DESC, created_at DESC, id LIMIT :lim"
            ),
            params,
        )
        .mappings()
        .all()
    )
    page = rows[:limit]
    last = page[-1] if page else None
    next_cursor = (
        encode_cursor([last["paid_on"].isoformat(), last["created_at"].isoformat(), str(last["id"])])
        if last and len(rows) > limit
        else None
    )
    return {
        "items": [
            {
                "id": str(r["id"]),
                "amount_paise": r["amount_paise"],
                "paid_on": r["paid_on"].isoformat(),
                "method": r["method"],
                "reference": r["reference"],
                "status": r["status"],
                "reversed_at": r["reversed_at"].isoformat() if r["reversed_at"] else None,
                "reversal_reason": r["reversal_reason"],
            }
            for r in page
        ],
        "next_cursor": next_cursor,
    }


def _outstanding(tenant: Tenant, invoice_id: uuid.UUID) -> tuple[int, int]:
    """(total, outstanding) for one invoice. Call only after lock_invoice, so it cannot change."""
    row = tenant.conn.execute(
        text(
            "SELECT i.total_paise, "
            "(i.total_paise - COALESCE((SELECT SUM(amount_paise) FROM mf.payments "
            "  WHERE business_id = i.business_id AND invoice_id = i.id AND status = 'active'), 0) "
            "- COALESCE((SELECT SUM(amount_paise) FROM mf.invoice_adjustments "
            "  WHERE business_id = i.business_id AND invoice_id = i.id AND status = 'active'), 0))::bigint "
            "FROM mf.invoices i WHERE i.business_id = :b AND i.id = :id"
        ),
        {"b": tenant.business_id, "id": invoice_id},
    ).one()
    return int(row[0]), int(row[1])


@router.post("/invoices/{invoice_id}/payments", status_code=201)
def record_payment(
    invoice_id: uuid.UUID,
    body: PaymentCreate,
    response: Response,
    tenant: Annotated[Tenant, Depends(require_staff, scope="function")],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict[str, Any]:
    key = idempotency.require_key(idempotency_key)
    route = "/invoices/{id}/payments"
    digest = idempotency.request_hash(route, {"id": str(invoice_id)}, body.model_dump(mode="json"))
    claimed = idempotency.claim(tenant, key, route, digest)
    if claimed.is_replay:
        response.status_code = claimed.replay_status or 201
        response.headers["Idempotent-Replay"] = "true"
        return claimed.replay_body or {}

    invoice = lock_invoice(tenant, invoice_id)
    if invoice["status"] != "open":
        raise ApiError(409, "invoice_not_open")
    if body.paid_on < invoice["invoice_date"]:
        raise ApiError(422, "validation_error", [{"field": "paid_on", "code": "before_invoice_date"}])
    _, outstanding = _outstanding(tenant, invoice_id)
    amount = body.amount_paise
    if amount > outstanding:
        raise ApiError(422, "overpayment_rejected")

    if not body.allow_duplicate:
        duplicate = tenant.conn.execute(
            text(
                "SELECT 1 FROM mf.payments WHERE business_id = :b AND invoice_id = :i AND status = 'active' "
                "AND amount_paise = :a AND paid_on = :d AND method = :m "
                "AND created_at > now() - interval '24 hours' "
                "AND (CAST(:ref AS text) IS NULL OR lower(reference) = lower(CAST(:ref AS text))) LIMIT 1"
            ),
            {
                "b": tenant.business_id,
                "i": invoice_id,
                "a": amount,
                "d": body.paid_on,
                "m": body.method,
                "ref": body.reference,
            },
        ).first()
        if duplicate:
            raise ApiError(409, "possible_duplicate_payment")

    try:
        row = (
            tenant.conn.execute(
                text(
                    "INSERT INTO mf.payments (business_id, invoice_id, amount_paise, paid_on, method, reference, note, "
                    "created_by) VALUES (:b, :i, :a, :d, :m, :ref, :note, :u) RETURNING id, created_at"
                ),
                {
                    "b": tenant.business_id,
                    "i": invoice_id,
                    "a": amount,
                    "d": body.paid_on,
                    "m": body.method,
                    "ref": body.reference,
                    "note": body.note,
                    "u": tenant.user_id,
                },
            )  # fmt: skip
            .mappings()
            .one()
        )
    except DBAPIError as exc:
        raise map_db_error(exc) from None
    write_audit(
        tenant, "payment.recorded", "payment", row["id"],
        {"invoice_id": str(invoice_id), "amount_paise": amount, "method": body.method},
    )  # fmt: skip
    result = {
        "id": str(row["id"]),
        "invoice_id": str(invoice_id),
        "amount_paise": amount,
        "paid_on": body.paid_on.isoformat(),
        "method": body.method,
        "reference": body.reference,
        "status": "active",
        "invoice_outstanding_paise": outstanding - amount,
        "created_at": row["created_at"].isoformat(),
    }
    if claimed.key_id is None:
        raise ApiError(500, "internal_error")
    idempotency.complete(tenant, claimed.key_id, 201, result)
    return result


@router.post("/payments/{payment_id}/reverse")
def reverse_payment(
    payment_id: uuid.UUID,
    body: ReverseBody,
    tenant: Annotated[Tenant, Depends(require_admin, scope="function")],
) -> dict[str, Any]:
    found = tenant.conn.execute(
        text("SELECT invoice_id FROM mf.payments WHERE business_id = :b AND id = :id"),
        {"b": tenant.business_id, "id": payment_id},
    ).scalar_one_or_none()
    if found is None:
        raise ApiError(404, "resource_not_found")
    lock_invoice(tenant, found)  # lock order is always the invoice row
    payment = (
        tenant.conn.execute(
            text("SELECT status FROM mf.payments WHERE business_id = :b AND id = :id"),
            {"b": tenant.business_id, "id": payment_id},
        )
        .mappings()
        .one()
    )
    if payment["status"] != "active":
        raise ApiError(409, "already_reversed")
    try:
        tenant.conn.execute(
            text(
                "UPDATE mf.payments SET status = 'reversed', reversed_at = now(), reversed_by = :u, "
                "reversal_reason = :r WHERE business_id = :b AND id = :id"
            ),
            {"u": tenant.user_id, "r": body.reason, "b": tenant.business_id, "id": payment_id},
        )
    except DBAPIError as exc:
        raise map_db_error(exc) from None
    write_audit(tenant, "payment.reversed", "payment", payment_id, {"invoice_id": str(found)})
    out = (
        tenant.conn.execute(
            text(
                "SELECT id, amount_paise, paid_on, method, reference, status, reversed_at, reversal_reason "
                "FROM mf.payments WHERE business_id = :b AND id = :id"
            ),
            {"b": tenant.business_id, "id": payment_id},
        )
        .mappings()
        .one()
    )
    _, outstanding = _outstanding(tenant, found)
    return {
        "id": str(out["id"]),
        "amount_paise": out["amount_paise"],
        "paid_on": out["paid_on"].isoformat(),
        "method": out["method"],
        "reference": out["reference"],
        "status": out["status"],
        "reversed_at": out["reversed_at"].isoformat(),
        "reversal_reason": out["reversal_reason"],
        "invoice_outstanding_paise": outstanding,
    }
