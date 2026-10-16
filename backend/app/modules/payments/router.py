"""Payment history (API.md 6.2). Payment writes, reversals and idempotency are S4 and are NOT
implemented yet: no endpoint here can change money."""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from app.core.exceptions import ApiError
from app.dependencies.business import Tenant
from app.dependencies.roles import require_staff
from app.modules.common.pagination import DEFAULT_LIMIT, MAX_LIMIT, decode_cursor, encode_cursor

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
