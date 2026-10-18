import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy import Connection, text

from app.core.exceptions import ApiError
from app.db.rls import set_business_context
from app.db.session import Tx
from app.dependencies.db import get_tx


@dataclass
class Tenant:
    """A transaction bound to one verified user inside one verified business."""

    conn: Connection
    user_id: uuid.UUID
    business_id: uuid.UUID
    role: str
    request_id: uuid.UUID | None


def get_tenant(
    request: Request,
    tx: Annotated[Tx, Depends(get_tx, scope="function")],
    x_business_id: str | None = Header(default=None),
) -> Tenant:
    """Resolve the workspace. X-Business-Id is only a selector, never proof of access.

    Order (SECURITY.md section 5): parse the header, read the ACTIVE membership for
    (verified user, requested business), set the business context, then return the role read
    from the database. A missing and a foreign business produce the same response.
    """
    if not x_business_id:
        raise ApiError(400, "invalid_business_header")
    try:
        business_id = uuid.UUID(x_business_id)
    except ValueError:
        raise ApiError(400, "invalid_business_header") from None

    role = tx.conn.execute(
        text(
            "SELECT role FROM mf.memberships "
            "WHERE user_id = :user_id AND business_id = :business_id AND status = 'active'"
        ),
        {"user_id": tx.user_id, "business_id": business_id},
    ).scalar_one_or_none()
    if role is None:
        raise ApiError(403, "workspace_access_denied")

    set_business_context(tx.conn, business_id)
    request.state.business_id = str(business_id)
    return Tenant(conn=tx.conn, user_id=tx.user_id, business_id=business_id, role=role, request_id=tx.request_id)
