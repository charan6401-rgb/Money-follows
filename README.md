# Money Follows

WhatsApp-first receivables tracking for Indian B2B suppliers: who owes you, how late it is, and what to say next.

Read the six documents in `docs/` first (`AGENTS.md` sets the rules). To deploy, follow `docs/DEPLOYMENT.md`.

## Layout
- `frontend/` React + Vite single-page app (mobile first). Talks to Supabase for sign-in only.
- `backend/` FastAPI API. All business data goes through it, with tenant isolation enforced in the API and in PostgreSQL (row-level security).

## Local checks
```bash
# backend (needs a real PostgreSQL; the tests build a throwaway database)
cd backend && pip install -r requirements-dev.txt
export TEST_DATABASE_ADMIN_URL='postgresql+psycopg://postgres:postgres@localhost:5432/postgres'
ruff check . && ruff format --check . && pytest

# frontend
cd frontend && npm ci && npm run typecheck && npm run lint && npm test && npm run build
```

## Status
Built: sign-in, businesses, customers, invoices, payments (idempotent), reversal, cancel, dashboard and aging.
Not built yet: adjustments, follow-ups, promises, disputes, WhatsApp reminder text, CSV import. Nothing is deployed or verified against a live Supabase project; see `docs/DEPLOYMENT.md` section 5.
