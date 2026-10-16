"""Application factory. Run with: uvicorn app.main:create_app --factory"""

import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Engine, text

from app.api.v1.router import api_router
from app.core.config import Settings, get_settings
from app.core.exceptions import ApiError, register_exception_handlers
from app.core.logging import setup_logging
from app.core.security import JwksKeyStore, TokenVerifier, http_jwks_fetcher
from app.db.engine import create_runtime_engine

access_log = logging.getLogger("mf.access")


def create_app(
    settings: Settings | None = None,
    *,
    engine: Engine | None = None,
    verifier: TokenVerifier | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    setup_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.engine = engine or create_runtime_engine(settings)
        app.state.verifier = verifier or TokenVerifier(
            JwksKeyStore(http_jwks_fetcher(settings.supabase_jwks_url)),
            issuer=settings.supabase_jwt_issuer,
            audience=settings.supabase_jwt_audience,
        )
        yield
        if engine is None:
            app.state.engine.dispose()

    # No interactive docs in production: they add surface and are not needed by the SPA.
    docs = None if settings.environment == "production" else "/docs"
    app = FastAPI(title="Money Follows API", lifespan=lifespan, docs_url=docs, redoc_url=None, openapi_url=None)
    register_exception_handlers(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Business-Id", "Idempotency-Key", "X-Request-Id"],
        expose_headers=["X-Request-Id", "Idempotent-Replay"],
        max_age=600,
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
        supplied = request.headers.get("x-request-id", "")
        try:
            request_id = str(uuid.UUID(supplied))
        except ValueError:
            request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
        except Exception:
            access_log.error("unhandled error", extra={"request_id": request_id})
            raise
        finally:
            route = request.scope.get("route")
            access_log.info(
                "request",
                extra={
                    "request_id": request_id,
                    "user_id": getattr(request.state, "user_id", None),
                    "business_id": getattr(request.state, "business_id", None),
                    "route": getattr(route, "path", "unmatched"),
                    "method": request.method,
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                },
            )
        response.headers["X-Request-Id"] = request_id
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/health/live", include_in_schema=False)
    def live() -> dict:
        return {"status": "ok"}

    @app.get("/health/ready", include_in_schema=False)
    def ready(request: Request) -> dict:
        try:
            with request.app.state.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception:
            raise ApiError(503, "service_unavailable") from None
        return {"status": "ok"}

    app.include_router(api_router, prefix="/api/v1")
    return app
