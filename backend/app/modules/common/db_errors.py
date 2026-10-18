"""Translate database errors into the API's stable error codes."""

from sqlalchemy.exc import DBAPIError, OperationalError

from app.core.exceptions import ApiError


def sqlstate(exc: BaseException) -> str | None:
    orig = getattr(exc, "orig", None)
    return getattr(orig, "sqlstate", None)


def constraint(exc: BaseException) -> str | None:
    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    return getattr(diag, "constraint_name", None)


def map_db_error(exc: DBAPIError) -> ApiError:
    state = sqlstate(exc)
    if state == "MF001":
        return ApiError(409, "immutable_record")
    if state == "MF002":
        return ApiError(409, "business_limit_reached")
    if state == "55P03":  # lock_not_available (lock_timeout)
        return ApiError(503, "busy_retry")
    if state == "57014":  # query_canceled (statement_timeout)
        return ApiError(503, "service_unavailable")
    if isinstance(exc, OperationalError) or (state or "").startswith("08"):
        return ApiError(503, "service_unavailable")
    return ApiError(500, "internal_error")
