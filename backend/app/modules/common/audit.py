"""Append-only audit rows, written in the same transaction as the change (DATABASE.md 4.11).

`detail` carries ids, amounts, statuses and changed FIELD NAMES only. Never names, phones or
free text, so a leaked audit table is not a leaked customer list.
"""

import json
import uuid
from typing import Any

from sqlalchemy import text

from app.dependencies.business import Tenant


def write_audit(
    tenant: Tenant, action: str, entity_type: str, entity_id: uuid.UUID, detail: dict[str, Any] | None = None
) -> None:
    tenant.conn.execute(
        text(
            "INSERT INTO mf.audit_logs "
            "(business_id, actor_user_id, action, entity_type, entity_id, request_id, detail) "
            "VALUES (:b, :u, :a, :t, :e, :r, CAST(:d AS jsonb))"
        ),
        {
            "b": tenant.business_id,
            "u": tenant.user_id,
            "a": action,
            "t": entity_type,
            "e": entity_id,
            "r": tenant.request_id,
            "d": json.dumps(detail or {}),
        },
    )
