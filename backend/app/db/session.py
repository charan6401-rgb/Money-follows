"""One request is one transaction on one connection (ARCHITECTURE.md section 4)."""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from sqlalchemy import Connection, Engine

from app.db.rls import set_timeouts, set_user_context


@dataclass
class Tx:
    """An open transaction with the user context already set."""

    conn: Connection
    user_id: uuid.UUID
    request_id: uuid.UUID | None = None


@contextmanager
def request_transaction(
    engine: Engine,
    user_id: uuid.UUID,
    *,
    statement_timeout_ms: int,
    lock_timeout_ms: int,
    request_id: uuid.UUID | None = None,
) -> Iterator[Tx]:
    """Commit when the block ends normally, roll back on any exception."""
    with engine.connect() as conn, conn.begin():
        set_timeouts(conn, statement_ms=statement_timeout_ms, lock_ms=lock_timeout_ms)
        set_user_context(conn, user_id)
        yield Tx(conn=conn, user_id=user_id, request_id=request_id)
