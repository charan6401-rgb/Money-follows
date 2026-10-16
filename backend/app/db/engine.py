"""Engine creation for the runtime role (mf_app).

Pooler safety (SECURITY.md section 6): psycopg prepared statements are disabled
(`prepare_threshold=None`) because a transaction-mode pooler can hand a different backend to
each transaction. Pool sizes are provisional until S0 produces pooler evidence.
Per-request timeouts are set with transaction-local settings in `app.db.rls`, not as connection
startup options, which transaction poolers can reject.
"""

from sqlalchemy import Engine, create_engine

from app.core.config import Settings


def create_runtime_engine(settings: Settings) -> Engine:
    return create_engine(
        settings.database_url.get_secret_value(),
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_s,
        pool_pre_ping=True,
        connect_args={"prepare_threshold": None},
    )
