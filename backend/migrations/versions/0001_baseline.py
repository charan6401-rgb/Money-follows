"""Baseline: schema mf, 13 tables, RLS, triggers, grants, mf_create_business.

Revision ID: 0001
Revises:
"""

from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

_SQL_DIR = Path(__file__).resolve().parent.parent / "sql"


def _run(name: str) -> None:
    # Sent through the raw driver connection with no parameters, so psycopg uses the simple query
    # protocol: the file may hold many statements and contains '%' (format() calls) and ':'.
    raw = op.get_bind().connection.driver_connection
    with raw.cursor() as cursor:
        cursor.execute((_SQL_DIR / name).read_text(encoding="utf-8"))


def upgrade() -> None:
    _run("0001_baseline_up.sql")


def downgrade() -> None:
    _run("0001_baseline_down.sql")
