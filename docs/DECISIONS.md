# docs/DECISIONS.md

# Money Follows — Decision Register

Status labels: **ACCEPTED DEFAULT** · **PENDING PILOT VALIDATION** · **PENDING CA/LAWYER VALIDATION** · **PENDING TECHNICAL VERIFICATION**.
Nothing in this file states that anything has been executed, verified, or configured. Provider facts are **UNVERIFIED** until checked against current official provider documentation.

| ID | Decision | Status |
|---|---|---|
| D-1 | Invoice numbering unique per business and financial year | ACCEPTED DEFAULT; generated-column compatibility PENDING TECHNICAL VERIFICATION |
| D-2 | `invoice_adjustments` included by default | ACCEPTED DEFAULT; PENDING PILOT VALIDATION; PENDING CA/LAWYER VALIDATION |
| D-3 | Single-owner pilot, no invitation UI | ACCEPTED DEFAULT |
| D-4 | Staff/admin permission matrix | ACCEPTED DEFAULT; PENDING PILOT VALIDATION |
| D-5 | Financial-record retention and anonymization policy | PENDING CA/LAWYER VALIDATION |
| D-6 | Supabase signing-key configuration dependency | PENDING TECHNICAL VERIFICATION |
| D-7 | Database roles and RLS | PENDING TECHNICAL VERIFICATION (gate S0) |
| D-8 | Mobile-first frontend | ACCEPTED DEFAULT |
| D-9 | Deployment and backup release gates | ACCEPTED DEFAULT; every gate NOT CONFIGURED |
| D-10 | Money as integer paise; overpayments rejected | ACCEPTED DEFAULT; overpayment/advance handling PENDING PILOT VALIDATION |
| D-11 | Manual WhatsApp only; code-defined templates | ACCEPTED DEFAULT |
| D-12 | Sign-in by email one-time code | PENDING TECHNICAL VERIFICATION; PENDING PILOT VALIDATION |

---

## D-1 Invoice numbering per business and financial year
**Status:** ACCEPTED DEFAULT. Generated-column behaviour: PENDING TECHNICAL VERIFICATION.

- **Decision:** Uniqueness is `(business_id, fy_start_year, invoice_number_normalized)`. The Indian financial year runs 1 April to 31 March. `fy_start_year` is the calendar year in which the FY starts: an invoice dated 2026-03-31 belongs to 2025, and one dated 2026-04-01 belongs to 2026. The display label is `2025-26`.
- **Normalization:** `invoice_number_normalized = upper(whitespace removed)` of the entered number. The original text is stored unchanged for display.
- **Cancelled invoices** keep their number occupied. Numbers are never reused.
- **Rejected:**
  - Globally unique numbers per business. This breaks businesses that restart numbering each FY.
  - Unique per customer. This allows ambiguous duplicates.
  - No uniqueness. This allows silent duplicate imports.
- **Rationale:** Matches how Indian businesses number invoices and gives deterministic duplicate detection for manual entry and CSV import.
- **Consequences:**
  - Invoice date drives FY, so invoice date is immutable after creation.
  - A date error means cancel and re-create.
- **Pending validation:**
  - Whether the generated-column expressions are accepted as immutable on the Supabase PostgreSQL version. Fallback: application-computed columns plus a CHECK/trigger that recomputes them.
  - The pilot confirms real numbering habits, such as prefixes, slashes and per-series numbering.

## D-2 `invoice_adjustments` included by default
**Status:** ACCEPTED DEFAULT; PENDING PILOT VALIDATION; PENDING CA/LAWYER VALIDATION.

- **Decision:** Table `invoice_adjustments` covers `tds`, `discount`, `credit_note` and `write_off`. Outstanding = invoice total − active payments − active adjustments. The system never calculates TDS or GST. The user enters amounts.
- **Cash reporting:** Collected-cash reports count only `payments`, never adjustments.
- **Rejected:**
  - Treating TDS and discounts as payments. This inflates cash reports.
  - Editing invoice totals. This destroys history.
  - Excluding adjustments. Pilot businesses very likely deduct TDS or give discounts.
- **Consequences:** Two reversible financial ledgers, with an identical lock-and-recheck discipline.
- **Pending validation:** Owner and CA questions in `PRODUCT_SPEC.md` (TDS handling before credit confirmation, credit notes, write-off documentation).

## D-3 Single-owner pilot, no invitation UI
**Status:** ACCEPTED DEFAULT.

- **Decision:**
  - Each business has exactly one active `owner`, enforced by a partial unique index.
  - The owner membership is created inside `mf_create_business`.
  - V1 has no invitation, role-change or member-removal endpoints, and `mf_app` has no INSERT on `memberships`.
  - `GET /api/v1/members` is read-only.
- **Rejected:**
  - An invitation flow, which needs SMTP-dependent flows, token handling and extra attack surface.
  - Direct client membership inserts.
- **Consequences:** Staff/admin rows can exist only through reviewed manual database operations during the pilot. Permission code is still implemented and tested for all three roles.
- **Pending validation:** The pilot confirms whether staff or accountants need access (see `PRODUCT_SPEC.md`).

## D-4 Staff/admin permission matrix
**Status:** ACCEPTED DEFAULT; PENDING PILOT VALIDATION.

| Capability | owner | admin | staff |
|---|---|---|---|
| Read customers, invoices, payments, reports, members | ✔ | ✔ | ✔ |
| Create/edit customers, create invoices, edit invoice due date/notes | ✔ | ✔ | ✔ |
| Record payments | ✔ | ✔ | ✔ |
| Follow-ups, promises, dispute creation | ✔ | ✔ | ✔ |
| Reverse a payment | ✔ | ✔ | ✘ |
| Create adjustments, reverse adjustments | ✔ | ✔ | ✘ |
| Cancel an invoice | ✔ | ✔ | ✘ |
| Resolve a dispute | ✔ | ✔ | ✘ |
| Commit CSV import | ✔ | ✔ | ✘ |
| Preview CSV import | ✔ | ✔ | ✘ |

- **Rationale:** Staff may need to record cash receipts. Anything that removes or rewrites financial effect needs a more trusted role.
- **Pending:** Whether staff should record payments at all, and whether an accountant needs read-only access (a future `viewer` role is not in V1).

## D-5 Financial-record retention and anonymization
**Status:** PENDING CA/LAWYER VALIDATION.

- **Decision:**
  - The application role can never hard-delete financial records (`payments`, `invoice_adjustments`, `invoices`, `customers` referenced by invoices, `audit_logs`).
  - Corrections happen by reversal or cancellation.
  - On a verified erasure request, customer PII (`name`, `phone`, `notes`) is replaced by an anonymization marker and `anonymized_at` is set.
  - Financial amounts and dates stay.
  - Free-text fields on child tables that may contain PII are cleared by a reviewed, manual, audited procedure.
- **Import payloads:** Committed `import_batches.preview_rows` are purged in the commit transaction. Uncommitted preview rows are purged after seven days. Idempotency records are retained 30 days with opportunistic cleanup.
- **No retention period is promised.** The statutory retention duration and erasure obligations are NOT VERIFIED.
- **Pending:** Review by a CA and a lawyer. The privacy notice and pilot terms depend on it (release gate 9).

## D-6 Supabase signing-key configuration dependency
**Status:** PENDING TECHNICAL VERIFICATION.

- **Decision:** Verify tokens by JWKS with PyJWT `PyJWKClient`. Allow only ES256 and RS256. There is no HS256 fallback and no `SUPABASE_JWT_SECRET` in configuration.
- **Dependency:** The Supabase project must issue asymmetrically signed tokens and publish a JWKS endpoint. This is UNVERIFIED. If it does not, S0 is blocked and implementation stops until the configuration is fixed.
- **CI:** A locally generated ES256 keypair and a local JWKS fixture run the same verification code.
- **No Supabase service-role key** is provisioned or used in V1.

## D-7 Database roles and RLS
**Status:** PENDING TECHNICAL VERIFICATION (S0 go/no-go gate).

- **Decision:**
  - Tenant tables live in schema `mf`, which is not intended to be exposed through Supabase's Data API.
  - Roles: `mf_migrator` (owns objects, DDL only, never used at runtime), `mf_definer` (owns `mf_create_business`) and `mf_app` (runtime).
  - `mf_app` is not a superuser, does not own tables and does not have BYPASSRLS.
  - RLS is ENABLED and FORCED on every tenant table.
  - Context uses transaction-local settings `app.current_user_id` and `app.current_business_id` through `set_config(..., true)`.
  - The application also filters by tenant explicitly in every query. Composite FKs are the third layer.
- **Rejected:**
  - RLS-only authorization, because a policy bug becomes a total breach.
  - Application-only authorization, because a missed filter becomes a breach.
  - Session-level `SET`, which is unsafe with pooled connections.
- **Pending:** R1–R11 on real PostgreSQL through the actual Supabase pooler. Nothing here claims they pass.

## D-8 Mobile-first frontend
**Status:** ACCEPTED DEFAULT.

- **Decision:**
  - Money Follows is a mobile-first responsive web app designed for 360 px width first, with tablet and desktop as expansions.
  - Mobile uses cards instead of wide tables.
  - Playwright viewport tests (360×800, 390×844 and desktop) are required from S6 onward.
  - There are no offline financial writes and no background sync in V1.
  - PWA installability is optional and must not add complexity. No native app is claimed.
- **Rejected:** Desktop-first dashboards squeezed onto phones, a native app, and an offline-first design.
- **Consequences:** Every frontend phase carries mobile acceptance criteria.

## D-9 Deployment and backup release gates
**Status:** ACCEPTED DEFAULT. Every gate is **NOT CONFIGURED**.

Required before any real customer financial data is stored:
1. Supabase production backups on a suitable verified plan.
2. Independent encrypted logical backups outside the primary database service.
3. A recorded restore drill.
4. Post-restore migrations, isolation tests and financial smoke tests pass.
5. Custom SMTP verified for authentication emails.
6. Always-on API hosting, or a designed cold-start experience with monitoring.
7. Production CORS and health checks verified.
8. Secrets configured and rotated appropriately.
9. Privacy notice and pilot terms reviewed.
10. Mobile workflows tested on real browsers and required viewport sizes.

All provider pricing, free-tier limits, regional availability, backup capability, pooler configuration and commercial-use restrictions (including Vercel plan suitability) are **UNVERIFIED**.

## D-10 Money as integer paise; overpayments rejected
**Status:** ACCEPTED DEFAULT; overpayment/advance handling PENDING PILOT VALIDATION.

- **Decision:**
  - All money is stored as `bigint` paise.
  - `Decimal` is used only at the API input boundary.
  - Input is a JSON string with at most two decimal places and no scientific notation.
  - Overpayments are rejected in V1. Advances are out of scope.
  - A payment spanning multiple invoices is recorded as separate payments, one per invoice.
- **Rejected:** `numeric` or float money columns, and unallocated customer-level payments (they need an allocation ledger).
- **Pending:** How often owners see advances or multi-invoice payments (pilot question).

## D-11 Manual WhatsApp only; code-defined templates
**Status:** ACCEPTED DEFAULT.

- **Decision:** The server generates editable English and Telugu reminder text. The user edits it on-device, copies it or opens WhatsApp, and sends it manually. Templates are code-defined defaults (there is no template table among the 13 tables). Edits are not persisted, though the final sent text can be stored in a follow-up.
- **Rejected:** WhatsApp Business API automation and LLM-written messages.

## D-12 Sign-in by email one-time code
**Status:** PENDING TECHNICAL VERIFICATION; PENDING PILOT VALIDATION.

- **Decision (proposed default):** Supabase Auth email OTP, a code the user types in the same browser. This avoids magic-link problems when the email opens in a different mobile browser.
- **Dependency:** Custom SMTP (gate 5). Default provider email limits are UNVERIFIED.
- **Pending:** Whether pilot owners prefer another method.
