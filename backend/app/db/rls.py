"""The ONLY place that sets database context (SECURITY.md section 5).

All settings are transaction-local (`set_config(..., true)`), so with a pooler they vanish at
COMMIT or ROLLBACK and can never leak to another request. Session-level SET and
`set_config(..., false)` are forbidden. A test fails the build if `set_config` appears anywhere
else under backend/app.
"""

import uuid

from sqlalchemy import Connection, text


def _set_local(conn: Connection, name: str, value: str) -> None:
    conn.execute(text("SELECT set_config(:name, :value, true)"), {"name": name, "value": value})


def set_timeouts(conn: Connection, *, statement_ms: int, lock_ms: int) -> None:
    _set_local(conn, "statement_timeout", str(int(statement_ms)))
    _set_local(conn, "lock_timeout", str(int(lock_ms)))


def set_user_context(conn: Connection, user_id: uuid.UUID) -> None:
    _set_local(conn, "app.current_user_id", str(user_id))


def set_business_context(conn: Connection, business_id: uuid.UUID) -> None:
    _set_local(conn, "app.current_business_id", str(business_id))
