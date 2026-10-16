"""One error envelope for every failure (API.md section 2).

`message` is a fixed, safe English sentence chosen from the error code. It never contains SQL,
stack traces, other tenants' data or raw input.
"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

MESSAGES: dict[str, str] = {
    "invalid_business_header": "The X-Business-Id header is missing or not valid.",
    "idempotency_key_required": "An Idempotency-Key header is required.",
    "unauthenticated": "Authentication is required.",
    "token_expired": "The access token has expired.",
    "workspace_access_denied": "You do not have access to this workspace.",
    "forbidden_role": "Your role does not allow this action.",
    "resource_not_found": "The requested record was not found.",
    "duplicate_invoice_number": "This invoice number is already used in this financial year.",
    "duplicate_customer_phone": "Another customer already has this phone number.",
    "invoice_not_open": "The invoice is not open.",
    "invoice_has_active_financials": "Reverse the invoice's payments and adjustments first.",
    "immutable_record": "This record cannot be changed.",
    "business_limit_reached": "The limit of businesses for one account has been reached.",
    "validation_error": "The request is not valid.",
    "invalid_amount": "The amount is not valid.",
    "busy_retry": "The record is busy. Try again.",
    "service_unavailable": "The service is temporarily unavailable.",
    "internal_error": "Something went wrong on the server.",
}


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        details: list[dict[str, str]] | None = None,
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.details = details


def envelope(request: Request, status: int, code: str, details: list[dict[str, str]] | None = None) -> JSONResponse:
    body: dict[str, Any] = {
        "error": {
            "code": code,
            "message": MESSAGES.get(code, MESSAGES["internal_error"]),
            "request_id": getattr(request.state, "request_id", None),
        }
    }
    if details:
        body["error"]["details"] = details
    return JSONResponse(status_code=status, content=body)


def _validation_details(exc: RequestValidationError) -> tuple[str, list[dict[str, str]]]:
    details: list[dict[str, str]] = []
    code = "validation_error"
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path", "header")]
        field = ".".join(loc)
        details.append({"field": field, "code": str(err.get("type", "invalid"))})
        if loc and loc[-1] == "amount":
            code = "invalid_amount"
    return code, details


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return envelope(request, exc.status, exc.code, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        code, details = _validation_details(exc)
        return envelope(request, 422, code, details)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return envelope(request, 404, "resource_not_found")
        if exc.status_code == 405:
            return envelope(request, 405, "validation_error")
        return envelope(request, exc.status_code, "internal_error")

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Logged by the access middleware with the exception type only (SECURITY.md section 15).
        return envelope(request, 500, "internal_error")
