"""Alembic environment.

Runs as mf_migrator over MIGRATION_DATABASE_URL (a direct or session-mode connection; never the
transaction pooler, DATABASE.md section 10). The URL is read from the environment only, and is
never part of the API's runtime configuration.
"""

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Migrations are raw SQL (roles, RLS, triggers), so there is no ORM metadata to autogenerate from.
target_metadata = None

VERSION_TABLE = "alembic_version"
VERSION_SCHEMA = "mf_alembic"


def _url() -> str:
    url = os.environ.get("MIGRATION_DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("MIGRATION_DATABASE_URL is not set")
    return url


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table=VERSION_TABLE,
            version_table_schema=VERSION_SCHEMA,
            transaction_per_migration=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    raise RuntimeError("offline migrations are not supported; run against a database")
run_migrations_online()
