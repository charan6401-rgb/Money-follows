# docs/SECURITY.md

# Money Follows — Security Design

> **Status legend.** Every control below is **DESIGNED — NOT TESTED** until the evidence column or section names an executed test run with stored output. At present no control is tested. Nothing in this document claims RLS, JWT verification, backups or any provider setting has been verified. Provider facts are **UNVERIFIED**.

## 1. Threat model

| # | Threat | Primary controls | Status |
|---|---|---|---|
| T1 | Cross-tenant data read or write by an authenticated user | Membership check per request, explicit tenant-scoped queries, forced RLS, composite FKs | DESIGNED — NOT TESTED |
| T2 | Forged, replayed or algorithm-confused JWT | JWKS verification, algorithm allow-list (ES256, RS256), required claims, no HS256 | DESIGNED — NOT TESTED |
| T3 | Tenant context leaking between pooled connections | Transaction-local settings only, fail-closed policies | DESIGNED — NOT TESTED |
| T4 | Privilege escalation via client-supplied role, user or business IDs | Server-derived identity, strict request schemas | DESIGNED — NOT TESTED |
| T5 | Financial tampering (double payment, overpayment, silent edit or delete) | Row locks, idempotency, immutability triggers, no DELETE privilege, audit log | DESIGNED — NOT TESTED |
| T6 | SQL injection | Parameterized queries only, no dynamic SQL from input | DESIGNED — NOT TESTED |
| T7 | Malicious CSV (oversize, encoding tricks, formula text) | Size and row limits, strict parsing, no formula evaluation, text-only storage | DESIGNED — NOT TESTED |
| T8 | XSS leading to token theft | React output escaping, no `dangerouslySetInnerHTML`, CSP (see §10), short token life | DESIGNED — NOT TESTED |
| T9 | Secrets or PII leaking through logs, errors or backups | Redaction filter, generic errors, encrypted backups | DESIGNED — NOT TESTED |
| T10 | Data loss or ransomware-style loss | Provider backups, independent encrypted backups, restore drill | NOT CONFIGURED |
| T11 | SECURITY DEFINER abuse | Fixed search path, narrow privileges, restricted EXECUTE | DESIGNED — NOT TESTED |
| T12 | Denial of service (JWKS refresh amplification, large uploads, slow queries) | Refresh cooldown, size limits, statement and lock timeouts. Network-level rate limiting is not provided in V1 | DESIGNED — NOT TESTED |
| T13 | Phishing or misdirected reminders (the user sends text to the wrong person) | Reminder shows customer and phone before the user opens WhatsApp. Nothing is sent by the system | DESIGNED — NOT TESTED |

Out of scope for V1: compromised end-user devices, malicious insiders with database superuser access, and provider-level breaches (covered only by the encryption of backups).

## 2. JWT verification

The API accepts only Supabase access tokens, verified with **PyJWT** and **PyJWKClient**:

1. Read the unverified header. `alg` must be `ES256` or `RS256`, and `kid` must be present. Anything else (including `none` and `HS*`) gives `401 unauthenticated`.
2. Resolve the signing key through `PyJWKClient(SUPABASE_JWKS_URL)` using `get_signing_key_from_jwt`.
3. `jwt.decode(token, key, algorithms=["ES256","RS256"], audience="authenticated", issuer=SUPABASE_JWT_ISSUER, options={"require": ["exp","sub","aud","iss"]}, leeway=30)`. The leeway value is a proposed default, not a tested one.
4. Post-decode checks: `sub` parses as a UUID, the claim `role == "authenticated"`, and `is_anonymous` is not true. Anonymous-role tokens are rejected.
5. An expired token gives `401 token_expired`. All other failures give `401 unauthenticated` with no detail about the cause.

- **No HS256 fallback and no shared secret.** `SUPABASE_JWT_SECRET` does not exist in the configuration.
- **Dependency:** the Supabase project must be configured with asymmetric signing keys and a reachable JWKS. This is **UNVERIFIED** (D-6). If it does not hold, S0 is NO-GO.
- **CI:** a locally generated ES256 keypair signs test tokens, and a local JWKS fixture is served to the same code path. No production key or token is ever used in tests.
- **Token content is never logged.** Only `sub` is logged after verification.

## 3. JWKS rotation and caching

- The signing keys are cached in memory (the PyJWKClient key cache, with a lifespan proposed at 10 minutes).
- A token with an **unknown `kid`** triggers at most one JWKS refresh, subject to a cooldown of at least 60 s between forced refreshes and a cap of 5 per hour (the values are proposed). Unknown `kid` values are negatively cached for 60 s. Attacker-chosen `kid` values therefore cannot cause a fetch per request.
- JWKS fetches use a 5 s timeout. If the JWKS endpoint is unreachable and a valid cached key exists, verification continues with the cache. If no key is available, the API returns `503 service_unavailable` (never accepts the token).
- **Key rotation:** the new key is published in the JWKS before it signs tokens. The old key stays valid until its tokens expire. The procedure and the behaviour of Supabase's rotation are **UNVERIFIED** and are tested manually in S9 (a rotation drill using the project's real mechanism).
- **Token expiry:** the Supabase default access-token lifetime is **UNVERIFIED** (commonly one hour). The API never extends it.

## 4. Mobile session and token-expiry handling

- The SPA keeps the session via supabase-js, which refreshes automatically. A storage choice for the session (browser local storage) is accepted for V1, with the XSS mitigations of §10. The SPA never stores tokens anywhere else.
- Expired token → `401 token_expired` → one refresh and one replay (the same Idempotency-Key for mutations). A second failure means sign-out.
- On sign-out, TanStack Query caches are cleared (they hold financial data), and the selected workspace is forgotten.
- A phone that is lost: the user signs out from another device (the capability depends on the Supabase configuration, **UNVERIFIED**). A DB-side revocation of a membership is possible manually and takes effect on the next request, because membership is checked on every request.
- Background tabs resuming after a long sleep treat expiry as normal (the refresh path), never as an error screen first.

## 5. Tenant isolation and authorization (application layer)

Per request, in this order:
1. Verify the JWT (§2).
2. Parse `X-Business-Id` as a UUID (`400 invalid_business_header`).
3. Open the transaction and set `app.current_user_id` (local).
4. Read the active membership for `(user_id, business_id)`. If none, `403 workspace_access_denied`. A missing and a foreign business look identical.
5. Set `app.current_business_id` (local).
6. Read the role from the DB and enforce the D-4 matrix (`403 forbidden_role`).
7. Run repositories whose every query has `business_id = :business_id` (a lint-style test greps for tenant tables queried without a tenant predicate).
8. By-ID lookups outside the tenant return `404`.

Request schemas use `extra="forbid"`. Pydantic models contain no `business_id`, `user_id`, `role`, `status` or balance fields on input. Only the dependency and the session module may call `set_config`. A test fails the build if `set_config` or `SET ` appears elsewhere in `backend/app`.

## 6. RLS design, connection-pool safety and the S0 gate

**Design:** every one of the 13 tables has RLS ENABLED and FORCED, with `USING` and `WITH CHECK` as described in `DATABASE.md` §3–§4. Context settings are read as `NULLIF(current_setting('…', true), '')::uuid` and the policies fail closed.

**Connection-pool safety:**
- Settings are transaction-local (`set_config(name, value, true)`). With a pooler in transaction mode, a transaction stays on one backend connection, so the settings are visible for the transaction and are discarded at commit or rollback.
- Session-level `SET` and `set_config(..., false)` are forbidden.
- The pooler mode, port, prepared-statement behaviour (psycopg `prepare_threshold`) and the SQLAlchemy pool settings are **UNVERIFIED** and decided from the S0 results.

**S0 required tests R1–R11.** Each is executed against (a) local PostgreSQL of the Supabase major version and (b) the real Supabase pooler. Roles are `mf_app` unless stated.

| ID | Test | Pass condition |
|---|---|---|
| R1 | No context: with neither setting, SELECT on every tenant table, and INSERT into each table | SELECT returns 0 rows. INSERT fails with an RLS violation |
| R2 | Read isolation: seed businesses A and B in every table. With context A, SELECT from every table | Only A rows are returned. By-ID reads of B rows return 0 rows |
| R3 | Write isolation: with context A, INSERT a row with `business_id = B`. UPDATE a B row. UPDATE an A row setting `business_id = B` | Each fails or affects 0 rows. A's data is unchanged |
| R4 | Pool leakage: through the pooler, run a transaction with context A and COMMIT. Immediately run many transactions with no context and with context B (record `pg_backend_pid()` to prove connection reuse) | The no-context transactions see 0 rows. B sees only B. `current_setting` is empty after commit |
| R5 | Rollback: set context A, ROLLBACK, then query on the same connection | Context is cleared, 0 rows |
| R6 | Bad context values: empty string, whitespace, malformed UUID, a UUID of a nonexistent business | Empty gives 0 rows. Malformed raises an error with no rows returned. Nonexistent gives 0 rows |
| R7 | Role and flag checks: query `pg_roles` and `pg_class` | `mf_app` is not superuser, has no BYPASSRLS and owns no objects. `relrowsecurity` and `relforcerowsecurity` are true for all 13 tables |
| R8 | Composite FK defense: as a role with RLS bypass (test-only), INSERT a payment in A referencing an invoice in B, and an invoice referencing another tenant's customer | Both fail on the FK |
| R9 | `mf_create_business`: (a) `mf_app` cannot INSERT into `businesses` or `memberships`. (b) The call with context creates exactly one business, one active owner membership and one audit row. (c) The call without context fails. (d) With a hostile object in `pg_temp` or `public` named like one the function uses, behavior is unchanged. (e) EXECUTE is denied to PUBLIC, `anon` and `authenticated`. (f) A user cannot create more than the cap | All hold |
| R10 | Concurrency soak: ≥ 50 concurrent clients alternating tenants A and B through the pooler for ≥ 10 minutes, reading and writing. Each response is checked for foreign IDs | Zero cross-tenant rows or successful cross-tenant writes |
| R11 | Privileges: `mf_app` cannot DELETE or TRUNCATE any table (except expired idempotency rows), cannot UPDATE immutable columns, immutability triggers fire for direct SQL, cannot DDL. `anon` and `authenticated` have no USAGE on schema `mf` | All hold |

**Go/no-go gate (explicit):** S0 is **GO** only if R1–R11 all pass on both targets with stored output, a real Supabase token verifies via JWKS (§2), and the generated-column test passes (or its documented fallback is chosen and tested). Any failure is **NO-GO**. Implementation stops and D-6 or D-7 is reopened. The permitted fallbacks (each requires a new written decision): another connection mode, or reducing reliance on RLS to defense in depth only (the explicit tenant filters and composite FKs remain). No weakening of the tests is permitted.

**Current status: NOT RUN.** The design must not be described as passing.

## 7. Composite foreign keys

Each child table references its parent as `(business_id, parent_id)`. A row can therefore never point at another tenant's parent, even if the application and RLS both failed. Verified by R8 (**not yet run**). The nullable-FK MATCH SIMPLE behavior is documented in `DATABASE.md` §1.

## 8. SECURITY DEFINER safeguards (`mf_create_business`)

- A fixed `search_path` (`pg_catalog, mf, pg_temp`), schema-qualified references, and no dynamic SQL.
- Identity from the transaction-local user context only. Never from arguments.
- Owned by the no-login role `mf_definer`, with narrow privileges and `TO mf_definer` policies. Not a superuser. No BYPASSRLS.
- EXECUTE revoked from PUBLIC, `anon` and `authenticated`, granted to `mf_app` only.
- Inputs validated inside the function. A cap on businesses per user.
- `mf_app` has no INSERT on `businesses`. Tested by R9 (**not yet run**).

## 9. Database privilege model

See the table in `DATABASE.md` §9. In summary:
- Runtime uses `mf_app` only. No superuser, no owner, no DDL.
- Migrations use `mf_migrator`, from a trusted workstation or job. The credential is never on the API host.
- `anon`, `authenticated` and `service_role` have no access to schema `mf`. The service-role key is not provisioned or used in V1.
- Default privileges on schema `mf` are revoked from PUBLIC.

## 10. SQL, input, CORS, CSP and secrets

- **Parameterization:** all SQL uses SQLAlchemy Core/ORM bound parameters or `text()` with bound parameters. No string formatting of input into SQL. Identifiers (sort fields) come from a fixed allow-list. A test scans for f-strings in SQL contexts.
- **Input validation:** Pydantic v2 with `extra="forbid"`, length limits, UUID types, enums as Literals, and a strict money parser (a regex on strings, then `Decimal`, with the exponent, count of digits and scale checked).
- **CORS:** the explicit origins in `CORS_ALLOWED_ORIGINS`, no wildcard, `allow_credentials=False`, methods `GET, POST, PATCH, OPTIONS`, headers `Authorization, Content-Type, X-Business-Id, Idempotency-Key, X-Request-Id`, `max_age=600`. Vercel preview origins are not allowed against the production API.
- **Browser hardening (frontend hosting headers):** `Content-Security-Policy` restricting scripts to the same origin, with `connect-src` limited to the API and Supabase origins, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Exact values are tuned in S9 and tested.
- **Secrets:** only in provider dashboards and GitHub Actions secrets. They are never in the repo, logs or the frontend bundle (a CI scan checks the built bundle for the DB URL pattern and key patterns). Rotation procedure documented in S9.

## 11. Payment and adjustment immutability, idempotency, concurrency

- **Immutability:** no UPDATE except reversal fields (status, reversed_*), no DELETE or TRUNCATE for any role through the application, triggers enforce this even for direct SQL as `mf_app`, and corrections are new records or reversals.
- **Reversal:** a one-way transition with a mandatory reason, a role of admin or above, and the invoice locked while it is processed.
- **Locking:** `SELECT … FOR UPDATE` on the invoice, with the balance recomputed inside the transaction. The `lock_timeout` is 5 s (`503 busy_retry`).
- **Idempotency:** the key is claimed in the same transaction as the write, the request hash is compared, a replay returns the stored response, and a mismatch gives `422`. Retention is 30 days with opportunistic cleanup.
- **Duplicates:** the soft duplicate rule is advisory and not a security boundary.
- **Audit:** every financial write has an `audit_logs` row in the same transaction. Audit rows are append-only.

## 12. CSV import security

- Limits: 2 MB, 2,000 rows, 6 columns, an exact header, UTF-8 only. A file with NUL bytes is rejected.
- Parsed with Python's `csv` module (never `eval` or a spreadsheet engine). Cell values are text and are length-limited. Values beginning with `=`, `+`, `-` or `@` are stored as literal text. If a future export is added, such cells will be prefixed to neutralize formulas (an export is not part of V1).
- Previews are server-held. The commit endpoint accepts no client rows, so a client cannot alter validated data between preview and commit.
- Content type is checked, but the content is parsed regardless of the declared type. The filename is stored for display only (sanitized, never used as a path).
- PII in `preview_rows` is purged at commit and 7 days after an uncommitted preview.
- Error reports never echo cell contents.
- Tests: CSV-1 oversize, CSV-2 row cap, CSV-3 formula cell stored literally, CSV-4 bad header, CSV-5 bad encoding/NUL, CSV-6 commit twice, CSV-7 preview rows are null after commit, CSV-8 a client attempts to submit rows to commit (ignored/rejected), CSV-9 a cross-tenant import ID returns 404, CSV-10 expired preview returns 410.

## 13. Financial-integrity tests

| ID | Test |
|---|---|
| F1 | Two concurrent payments that together exceed the outstanding balance: exactly one succeeds |
| F2 | The same Idempotency-Key and body sent 10 times concurrently: one payment, all responses equal |
| F3 | The same key with a different body gives 422 `idempotency_key_reuse` |
| F4 | An overpayment, a zero or negative amount, `1e3`, `1.234`, `"12,5"` and a JSON number are all rejected |
| F5 | Payment on a cancelled invoice is rejected. Cancelling an invoice with active payments is rejected |
| F6 | Reversal increases the balance by exactly the payment amount. Reversing twice gives 409. A reversed payment is not counted in cash reports |
| F7 | An adjustment is never counted in collected cash. An adjustment above the outstanding balance is rejected |
| F8 | Outstanding balance never goes below zero under any interleaving of payments, adjustments and reversals (property or stress test) |
| F9 | Direct SQL as `mf_app`: UPDATE `amount_paise`, DELETE, TRUNCATE and reactivating a reversed row all fail |
| F10 | Invoice total, date, number and customer cannot change. A FY boundary test (31 March and 1 April) |
| F11 | A duplicate normalized invoice number in the same FY is rejected. The same number in another FY is accepted |
| F12 | Every financial write has exactly one audit row, and a forced audit failure rolls back the write |
| F13 | Report totals equal an independent SQL computation on seeded data |
| F14 | Reversal and adjustments on another tenant's record return 404 and change nothing |

## 14. Authentication and API security tests

| ID | Test |
|---|---|
| A1 | No token, a malformed token and a bad signature give 401 |
| A2 | An expired token gives 401 `token_expired` |
| A3 | `alg: none`, HS256 signed with the public key bytes, and an alg not in the allow-list are rejected |
| A4 | Wrong `aud`, wrong `iss`, missing `exp`, missing `sub` and a non-UUID `sub` are rejected |
| A5 | An anonymous token and `role != authenticated` are rejected |
| A6 | An unknown `kid` causes at most one refresh within the cooldown. A flood of unknown kids causes no fetch storm |
| A7 | JWKS endpoint down with a cached key: still verifies. With no cache: 503 |
| T1 | Valid user B calls with A's `X-Business-Id` gives 403 `workspace_access_denied`, the same as for a random UUID |
| T2 | A removed or inactive membership is rejected on the very next request |
| T3 | The role matrix: every endpoint is called as each role and the status is compared to D-4 |
| T4 | A by-ID access to another tenant's customer, invoice, payment, adjustment, promise, dispute or import returns 404 |
| T5 | Bodies with `business_id`, `user_id`, `role`, `status` or balance fields are rejected |
| T6 | A foreign `customer_id` in `POST /invoices` returns 404 |
| T7 | `X-Business-Id` missing or malformed gives 400 |
| T8 | `PATCH /invoices` with immutable fields gives 422 |
| T9 | SQL injection strings in every string and filter parameter are inert (a constant result and no error) |
| T10 | A static test: no `set_config` or `SET` outside the allowed modules. No f-string SQL |
| T11 | Error bodies contain no stack traces, SQL or foreign IDs. The envelope is identical across failure types |
| T12 | The logs of a full test run contain no token, phone number, customer name, CSV content or DB URL (the redaction test) |
| T13 | CORS: an allowed origin gets the headers. A disallowed origin and `*` do not |

## 15. Logging and PII redaction

- Allowed fields: request ID, user ID (UUID), business ID (UUID), route template, method, status, duration, error code.
- Forbidden: Authorization and cookies, request and response bodies, query strings with `q`, names, phone numbers, notes, reminder text, CSV rows, DB URLs and tokens.
- A logging filter drops or masks forbidden keys. Exceptions are logged with the type and a sanitized message. SQLAlchemy and psycopg parameter logging is disabled.
- `audit_logs.detail` contains no free text or PII.
- Status: DESIGNED — NOT TESTED (T12).

## 16. Backup security, data retention and privacy review

- **Backups:** the provider backups plus independent logical dumps are encrypted before leaving the environment, the key is stored separately from the backup storage, access is limited to the owner, and the restore test includes decryption. Backups contain PII and financial data and are subject to the same retention decision. The tool and the storage location are **NOT CHOSEN / NOT CONFIGURED**.
- **Retention:** financial records are not hard-deleted by the application. Import payloads are purged (the 7-day rule for previews, and at commit). Idempotency keys are kept for 30 days. **The legally required retention period and the erasure obligations are NOT VERIFIED** and need CA and lawyer review (D-5). No period is promised to users.
- **Anonymization:** a manual, audited procedure run as `mf_migrator` (replace customer name, phone and notes with markers, set `anonymized_at`, clear `message_text` and `note` in `follow_ups`). Financial amounts and dates remain. The procedure is written and tested in S9 and is not exposed through the API.
- **Privacy notice and pilot terms** must be reviewed (release gate 9).
- **Data location and subprocessors** (Supabase, Render, Vercel, the SMTP provider, the backup storage): regions are **UNVERIFIED** and are recorded in the privacy notice after verification.

## 17. Production release criteria

All must be true, with stored evidence, before real customer financial data is stored (see `ARCHITECTURE.md` §17):

1. The S0 gate was GO and R1–R11 are re-run green on production-like infrastructure.
2. All tests in §13 and §14 and CSV-1..10 pass in CI.
3. Backups, the independent encrypted backup and a recorded restore drill with post-restore isolation and financial smoke tests.
4. Custom SMTP verified.
5. The API hosting meets the availability decision, or the cold-start experience and monitoring exist.
6. Production CORS, CSP and health checks are verified. The secrets are set and a rotation record exists.
7. A JWKS rotation drill was done.
8. The privacy notice and pilot terms were reviewed, and the retention questions are recorded as answered or explicitly accepted as open.
9. Mobile workflows were tested on real browsers and the required viewports.
10. The dependency audit was run (`pip-audit` / `npm audit`, to be added to CI in S1 as a dev tool) and the findings reviewed.

## 18. Control register (designed versus tested)

| Control | Designed | Tested | Evidence |
|---|---|---|---|
| JWKS-based JWT verification | yes | no | none |
| Algorithm allow-list, claims | yes | no | none |
| Forced RLS on 13 tables | yes | no | none |
| Transaction-local context | yes | no | none |
| Composite FKs | yes | no | none |
| `mf_create_business` safeguards | yes | no | none |
| Immutability triggers | yes | no | none |
| Row locking and idempotency | yes | no | none |
| Log redaction | yes | no | none |
| CSV limits | yes | no | none |
| Independent backups and restore | no (NOT CONFIGURED) | no | none |
| Custom SMTP | no (NOT CONFIGURED) | no | none |
