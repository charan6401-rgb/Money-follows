import uuid
from collections.abc import Iterator

from fastapi import Depends, Request

from app.core.config import Settings
from app.core.security import AuthenticatedUser
from app.db.session import Tx, request_transaction
from app.dependencies.auth import get_current_user


def get_tx(request: Request, user: AuthenticatedUser = Depends(get_current_user)) -> Iterator[Tx]:
    """Open the request's transaction with the verified user context set.

    The `function` scope (used where this is declared) makes the commit happen after the
    endpoint returns but BEFORE the response is sent, so a failed commit is never reported to
    the client as success.
    """
    settings: Settings = request.app.state.settings
    request_id = getattr(request.state, "request_id", None)
    with request_transaction(
        request.app.state.engine,
        user.user_id,
        statement_timeout_ms=settings.db_statement_timeout_ms,
        lock_timeout_ms=settings.db_lock_timeout_ms,
        request_id=uuid.UUID(request_id) if request_id else None,
    ) as tx:
        yield tx
