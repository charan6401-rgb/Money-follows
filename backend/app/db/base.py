# Intentionally empty of ORM models. Persistence uses SQLAlchemy Core with bound parameters
# (text()) against the schema created by the raw-SQL Alembic migrations, so the database remains
# the single source of truth for constraints, RLS and triggers (DATABASE.md section 10).
