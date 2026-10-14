# Money Follows — Coding Agent Instructions

## 1. Mandatory reading

Before writing or modifying code, read all six existing documents:

- `docs/PRODUCT_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/API.md`
- `docs/DATABASE.md`
- `docs/SECURITY.md`
- `docs/DECISIONS.md`

Treat these documents as the primary project specification. Identify contradictions before implementing anything. Do not silently invent architectural decisions.

## 2. Project structure

- `frontend/`: React, Vite, TypeScript, Tailwind CSS.
- `backend/`: Python, FastAPI, SQLAlchemy 2.x, Pydantic v2, Alembic.
- PostgreSQL: relational database with tenant isolation and row-level security.
- Supabase: authentication and any explicitly approved Supabase services.
- Render: backend hosting.
- Vercel: frontend hosting.

Verify exact dependency versions, deployment settings, and provider capabilities before relying on them.

## 3. Safety rules

- Inspect existing files before editing them.
- Never overwrite existing documentation without explicit approval.
- Never replace real implementations with placeholders.
- Never commit secrets, API keys, service-role keys, passwords, or production credentials.
- Provide `.env.example` files with variable names and safe example values only.
- Never disable authentication, authorization, tenant isolation, or database security to make tests pass.
- Never claim tests passed unless they were actually executed.
- Do not deploy or run production migrations without explicit approval.

## 4. Multi-tenant security

- Every business-owned record must be scoped to the authenticated user's authorized business.
- Treat frontend route guards as UX controls, never as security boundaries.
- Verify JWTs on the backend.
- Derive user identity from verified authentication claims, not request-supplied user IDs.
- Validate business membership and role permissions on the server.
- Enforce database constraints, appropriate RLS policies, and tenant isolation.
- Never trust `X-Business-Id` without checking membership and authorization.
- Test that one business cannot read or modify another business's records.
- Follow `docs/SECURITY.md` and `docs/DATABASE.md` for the exact approved security model.

## 5. Financial correctness

- Represent money using integer paise in storage and calculations.
- Never use floating-point arithmetic for financial balances.
- Define invoice balance calculations in one authoritative backend implementation.
- Preserve payment history and audit records.
- Handle payment reversals explicitly; do not silently delete financial history.
- Use database transactions and idempotency protection where required.
- Test rounding, concurrency, duplicate requests, and balance calculations.

## 6. Implementation workflow

Implement in small, reviewable phases:

1. Inspect the repository and report missing, empty, conflicting, or unexpected files.
2. Establish valid frontend and backend configuration.
3. Implement database models and reviewed Alembic migrations.
4. Implement authentication, authorization, and tenant isolation.
5. Implement customers and business management.
6. Implement invoices and CSV import.
7. Implement payments and reversals.
8. Implement reminders, payment promises, and disputes.
9. Implement dashboard and reports.
10. Implement the frontend against the documented API contract.
11. Add integration, security, and end-to-end tests.
12. Verify local setup and deployment configuration.

Do not attempt the entire application in one unreviewed generation.

## 7. Required checks

- Frontend: lint, strict TypeScript checks, unit tests, production build.
- Backend: lint, unit tests, API tests, integration tests against real PostgreSQL.
- Security: tenant-isolation tests, authorization tests, and RLS verification.
- Migrations: test from a clean database and verify schema consistency.

Clearly report commands run, results, failures, and anything not verified.

## 8. Change management

Before each phase, list intended files and acceptance criteria. After implementation, summarize changed files and test results. Ask before changing a documented architectural decision.

Prioritize correctness, security, maintainability, and working end-to-end behavior over generating large numbers of files.