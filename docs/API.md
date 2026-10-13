# docs/API.md

# Money Follows — REST API (v1)

> **Status:** design only. Nothing here has been implemented or tested. Examples use fictitious values only and contain no real credentials or personal data (`[token]` is a placeholder, and phone numbers such as `+919000000000` are fake).

## 1. Conventions

- **Base path:** `/api/v1`. JSON UTF-8, except `POST /imports/preview` which is `multipart/form-data`.
- **Authentication (all endpoints except `/health/*`):** `Authorization: Bearer [token]`, a Supabase access token verified by JWKS (see `SECURITY.md` §2).
- **Business context:** `X-Business-Id: <uuid>` is required on every endpoint except `/me`, `/businesses` and `/health/*`. It is a workspace **selector**, not proof of access. On every request the API verifies the JWT identity, an active membership, the database role and resource ownership.
- **Roles:** `owner`, `admin`, `staff`. "admin" in the tables below means admin or owner. See `DECISIONS.md` D-4.
- **Request bodies:** unknown fields are rejected (`422 validation_error`). Clients never send `business_id`, `user_id`, role, balance or status (except the explicit state-transition fields of the endpoints that define them).
- **Money:**
  - Requests use strings in rupees, matching `^[0-9]{1,12}(\.[0-9]{1,2})?$`, for example `"12500.50"`.
  - JSON numbers, scientific notation, negatives, zero and more than 2 decimals are rejected (`invalid_amount`).
  - Responses use integer paise (`*_paise`). The UI formats the rupee display.
- **Dates:** `YYYY-MM-DD` (IST business dates). Timestamps are ISO-8601 UTC.
- **IDs** are UUIDs. A malformed path ID gives `422 validation_error`.
- **Headers returned:** `X-Request-Id` on every response and `Cache-Control: no-store`.
- **Idempotency:** `Idempotency-Key: <16–128 chars [A-Za-z0-9_-]>` is **required** on `POST /invoices/{id}/payments`, `POST /invoices/{id}/adjustments` and `POST /imports/{id}/commit`. A missing key gives `400 idempotency_key_required`. The same key with the same body replays the original response (the header `Idempotent-Replay: true` is added). The same key with a different body or path gives `422 idempotency_key_reuse`. Keys are scoped per business and kept for 30 days.
- **Pagination (lists):** keyset. `limit` (default 25, max 100) and `cursor` (opaque, from `next_cursor`). The response is `{"items":[…],"next_cursor":"…"|null}`. Reports use `limit` (max 100) and `offset`. Each list has a fixed, stable sort order stated below.
- **Cross-tenant behavior (all endpoints):**
  - A business ID the user is not an active member of gives `403 workspace_access_denied`. The response is identical for a nonexistent and a foreign workspace.
  - An ID of a resource that exists in another tenant gives `404 resource_not_found`, identical to a nonexistent ID.
  - A foreign `customer_id` or similar in a body gives `404 resource_not_found`.

## 2. Error format

```json
{
  "error": {
    "code": "overpayment_rejected",
    "message": "The payment is more than the outstanding balance.",
    "request_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "details": [{"field": "amount", "code": "exceeds_outstanding"}]
  }
}
```

`code` is machine-readable and stable. `message` is safe, English and never contains SQL, stack traces, other tenants' data or raw input. `details` is optional (validation only).

| HTTP | code | Meaning |
|---|---|---|
| 400 | `invalid_business_header` | missing or malformed `X-Business-Id` |
| 400 | `idempotency_key_required` | |
| 401 | `unauthenticated` | missing, invalid or unverifiable token |
| 401 | `token_expired` | valid signature, expired. The client refreshes once |
| 403 | `workspace_access_denied` | no active membership |
| 403 | `forbidden_role` | role too low for the action |
| 404 | `resource_not_found` | missing or outside the tenant |
| 409 | `duplicate_invoice_number` | same business, FY and normalized number |
| 409 | `duplicate_customer_phone` | |
| 409 | `possible_duplicate_payment` | soft duplicate. Resend with `allow_duplicate: true` to confirm |
| 409 | `invoice_not_open` | cancelled invoice |
| 409 | `invoice_has_active_financials` | cannot cancel |
| 409 | `already_reversed` | |
| 409 | `pending_promise_exists` / `open_dispute_exists` | |
| 409 | `already_resolved` | promise or dispute already resolved |
| 409 | `immutable_record` | a blocked change (trigger) |
| 409 | `import_already_committed` | |
| 410 | `import_expired` | the preview is older than 7 days |
| 413 | `payload_too_large` | |
| 415 | `unsupported_media_type` | |
| 422 | `validation_error` | schema or field errors (`details`) |
| 422 | `invalid_amount` | |
| 422 | `overpayment_rejected` | amount greater than outstanding |
| 422 | `adjustment_exceeds_outstanding` | |
| 422 | `idempotency_key_reuse` | |
| 429 | `rate_limited` | reserved. Not implemented in V1 |
| 500 | `internal_error` | |
| 503 | `service_unavailable` / `busy_retry` | database or lock timeout. Safe to retry |

## 3. Identity and workspaces

### 3.1 `GET /me`
- **Purpose:** the current user's identity and profile. **Business context:** not required. **Roles:** any authenticated user.
- **Response 200:** `{"user_id":"3b241101-e2bb-4255-8caf-4136c566a962","display_name":null,"preferred_language":"en","profile_exists":false}`
- **Errors:** 401.

### 3.2 `PATCH /me`
- **Purpose:** create or update the user's own profile (an upsert of the caller's row only). **Roles:** any authenticated user.
- **Request:** `{"display_name":"Sample Owner","preferred_language":"te"}` (both optional, at least one).
- **Response 200:** the profile as in 3.1. **Errors:** 401, 422.

### 3.3 `GET /businesses`
- **Purpose:** the workspaces the user belongs to. **Business context:** not required. **Pagination:** none (small, at most 3 owned; capped at 50).
- **Response 200:**
```json
{"items":[{"id":"5f2b8a40-0c3e-4a79-9d51-0a6b0f3c1e11","name":"Sample Traders","role":"owner","default_language":"en"}]}
```

### 3.4 `POST /businesses`
- **Purpose:** create a workspace through `mf_create_business`. **Business context:** not required. **Roles:** any authenticated user.
- **Request:** `{"name":"Sample Traders","default_language":"en"}`
- **Response 201:** the object from 3.3 with `"role":"owner"`.
- **Errors:** 401, 422, 409 `business_limit_reached` (proposed cap 3 owned businesses).
- **Notes:** the business ID is generated server-side. The caller can never choose it, its owner or its role. No Idempotency-Key is required, and a double submit creates two workspaces (the UI disables the button after the first tap). Clients may re-list.

### 3.5 `GET /members`
- **Purpose:** the members of the active workspace (read-only in V1). **Roles:** staff.
- **Response 200:** `{"items":[{"membership_id":"…","user_id":"…","display_name":"Sample Owner","role":"owner","status":"active"}],"next_cursor":null}`
- **Errors:** 400, 401, 403.

## 4. Customers

### 4.1 `POST /customers`
- **Roles:** staff. **Request:**
```json
{"name":"Sample Customer A","phone":"+919000000000","notes":"Site: Plot 12","preferred_language":"te"}
```
`phone` is optional. It is normalized (spaces and a leading 0 or 91 stripped) to `+91XXXXXXXXXX`.
- **Response 201:** `{"id":"…","name":"Sample Customer A","phone":"+919000000000","preferred_language":"te","is_active":true,"outstanding_paise":0,"created_at":"2026-10-13T06:00:00Z"}`
- **Errors:** 422, 409 `duplicate_customer_phone`. **Duplicate detection:** the phone is a hard rule. A name match with a different phone is allowed and the response has `"similar_name_exists": true`.

### 4.2 `GET /customers`
- **Roles:** staff. **Filters:** `q` (prefix of the name or a phone fragment, at least 2 chars), `is_active` (default true). **Sort:** `name_normalized, id`.
- **Response 200:** `{"items":[{"id":"…","name":"…","phone":"+919000000000","is_active":true,"outstanding_paise":1250050,"overdue_paise":500000}],"next_cursor":null}`

### 4.3 `GET /customers/{customer_id}`
- **Roles:** staff. **Response 200:** the item above plus `notes`, `preferred_language` and `open_invoice_count`. **Errors:** 404.

### 4.4 `PATCH /customers/{customer_id}`
- **Roles:** staff. **Request (any subset):** `{"name":"…","phone":"…"|null,"notes":"…","preferred_language":"en","is_active":false}`.
- **Response 200:** the customer. **Errors:** 404, 409 `duplicate_customer_phone`, 422.
- **Note:** there is no delete and no anonymize endpoint (D-5).

## 5. Invoices

### 5.1 `POST /invoices`
- **Roles:** staff.
- **Request:**
```json
{"customer_id":"0b0f9d5e-6a8d-4d0c-b3a3-2c6f1d1c7a01","invoice_number":"INV/0042","invoice_date":"2026-10-01","due_date":"2026-10-31","amount":"125000.00","notes":null}
```
- **Rules:** `due_date >= invoice_date`. `invoice_date` is not in the future (IST) and not before 2000-01-01.
- **Response 201:**
```json
{"id":"9d2f4a77-7b1e-4b8a-8c52-0f0e5a3b9c10","invoice_number":"INV/0042","fy_label":"2026-27","customer":{"id":"0b0f9d5e-6a8d-4d0c-b3a3-2c6f1d1c7a01","name":"Sample Customer A"},"invoice_date":"2026-10-01","due_date":"2026-10-31","total_paise":12500000,"paid_paise":0,"adjusted_paise":0,"outstanding_paise":12500000,"status":"open","payment_state":"unpaid","is_overdue":false,"days_overdue":0,"has_open_dispute":false,"pending_promise_date":null,"created_at":"2026-10-13T06:05:00Z"}
```
- **Errors:** 404 (customer outside the tenant), 409 `duplicate_invoice_number`, 422. **Duplicate detection:** the unique rule on (business, FY, normalized number). **Idempotency:** none (the unique rule makes a repeat safe).

### 5.2 `GET /invoices`
- **Roles:** staff. **Filters:** `customer_id`, `status` (`open`|`cancelled`, default `open`), `payment_state` (`unpaid`|`partial`|`settled`), `overdue` (`true`), `fy` (FY start year, e.g. `2026`), `q` (invoice-number prefix, normalized). **Sort:** `due_date asc, id`.
- **Response 200:** `{"items":[ <invoice object as in 5.1> ],"next_cursor":"eyJ…"}`

### 5.3 `GET /invoices/{invoice_id}`
- **Roles:** staff. **Response 200:** the invoice object plus `notes`, `cancelled_at` and `cancel_reason`. **Errors:** 404.

### 5.4 `PATCH /invoices/{invoice_id}`
- **Roles:** staff. **Request:** `{"due_date":"2026-11-15","notes":"…"}`. The number, date, amount and customer are immutable. Sending them is `422 validation_error`.
- **Response 200:** the invoice. **Errors:** 404, 409 `invoice_not_open`, 422.

### 5.5 `POST /invoices/{invoice_id}/cancel`
- **Roles:** admin. **Request:** `{"reason":"Entered against the wrong customer"}` (3–300 chars).
- **Response 200:** the invoice with `"status":"cancelled"`. **Errors:** 404, 409 `invoice_has_active_financials` (reverse the payments and adjustments first), 409 `invoice_not_open`. The invoice is locked during the check.

### 5.6 `GET /invoices/{invoice_id}/reminder-message`
- **Purpose:** an editable reminder draft. The system sends nothing. **Roles:** staff. **Query:** `lang=en|te` (default: the customer's preferred language).
- **Response 200:**
```json
{"language":"en","text":"Dear Sample Customer A, this is a friendly reminder from Sample Traders. Invoice INV/0042 dated 01-10-2026 for ₹1,25,000.00 has an outstanding balance of ₹1,25,000.00, due on 31-10-2026. Please let us know when we can expect the payment. Thank you.","whatsapp_url":"https://wa.me/919000000000?text=…","settled":false}
```
`whatsapp_url` is present only if the customer has a phone. It is a link for the user's own device to open, with no server call. A settled or cancelled invoice returns `409 invoice_not_open`. Templates: `PRODUCT_SPEC.md` §7.

## 6. Payments

### 6.1 `POST /invoices/{invoice_id}/payments`
- **Roles:** staff. **Headers:** `Idempotency-Key` (required).
- **Request:**
```json
{"amount":"50000.00","paid_on":"2026-10-12","method":"upi","reference":"SAMPLEREF0001","note":null,"allow_duplicate":false}
```
- **Rules:** `amount > 0`. `paid_on` is not in the future (IST) and not before `invoice_date`. `method` is one of `cash|upi|bank_transfer|cheque|other`.
- **Behavior:** see `DATABASE.md` §6 (key claim → lock the invoice → recheck → reject overpayment → soft duplicate check → insert → audit → store the response).
- **Response 201:**
```json
{"id":"c1a2b3d4-1111-4222-8333-444455556666","invoice_id":"9d2f4a77-7b1e-4b8a-8c52-0f0e5a3b9c10","amount_paise":5000000,"paid_on":"2026-10-12","method":"upi","reference":"SAMPLEREF0001","status":"active","invoice_outstanding_paise":7500000,"created_at":"2026-10-13T06:10:00Z"}
```
- **Errors:** 400 `idempotency_key_required`, 404, 409 `invoice_not_open`, 409 `possible_duplicate_payment`, 422 `overpayment_rejected`, 422 `invalid_amount`, 422 `idempotency_key_reuse`, 503 `busy_retry`.
- **Duplicate detection / idempotency:** the replay of an identical key and body returns the original 201 (and the replay header). A different key with the same details is a soft duplicate (409 unless `allow_duplicate:true`).
- **Concurrency:** two simultaneous payments that together exceed the balance cannot both succeed. One gets `overpayment_rejected`.

### 6.2 `GET /invoices/{invoice_id}/payments`
- **Roles:** staff. **Sort:** `paid_on desc, created_at desc, id`. **Filter:** `status` (`active`|`reversed`|`all`, default `all`).
- **Response 200:** `{"items":[{"id":"…","amount_paise":5000000,"paid_on":"2026-10-12","method":"upi","reference":"SAMPLEREF0001","status":"active","reversed_at":null,"reversal_reason":null}],"next_cursor":null}`

### 6.3 `POST /payments/{payment_id}/reverse`
- **Roles:** admin. **Request:** `{"reason":"Cheque bounced"}` (3–300 chars).
- **Behavior:** locks the parent invoice, requires the payment to be active, and marks it reversed. The outstanding balance increases.
- **Response 200:** the payment with `"status":"reversed"` and `invoice_outstanding_paise`.
- **Errors:** 404, 409 `already_reversed`, 422. **Idempotency:** a repeat returns 409 `already_reversed` (the state is the guard). The original record is retained.

## 7. Invoice adjustments

### 7.1 `POST /invoices/{invoice_id}/adjustments`
- **Roles:** admin. **Headers:** `Idempotency-Key` (required).
- **Request:** `{"kind":"tds","amount":"1250.00","adjusted_on":"2026-10-12","reference":null,"reason":"TDS deducted by customer"}`. `kind` is `tds|discount|credit_note|write_off`. The server never calculates TDS or GST, the user enters the amount.
- **Behavior:** locks the invoice, rejects if the amount is more than the outstanding balance, then inserts and audits.
- **Response 201:** `{"id":"…","invoice_id":"…","kind":"tds","amount_paise":125000,"status":"active","invoice_outstanding_paise":…}`
- **Errors:** 404, 409 `invoice_not_open`, 422 `adjustment_exceeds_outstanding`, 422 `validation_error`, 422 `idempotency_key_reuse`.
- **Reporting:** adjustments are never counted as collected cash.

### 7.2 `GET /invoices/{invoice_id}/adjustments`
- **Roles:** staff. **Filter:** `status`. **Sort:** `adjusted_on desc, id`. **Response 200:** a list like 6.2 with `kind`, `reason` and `reference`.

### 7.3 `POST /adjustments/{adjustment_id}/reverse`
- **Roles:** admin. **Request:** `{"reason":"Credit note cancelled"}`. **Response 200:** the adjustment with `"status":"reversed"`. **Errors:** 404, 409 `already_reversed`.

## 8. Follow-ups, promises and disputes

### 8.1 `POST /invoices/{invoice_id}/follow-ups`
- **Roles:** staff. **Request:** `{"channel":"whatsapp","outcome":"promised","language":"te","message_text":"…","note":null,"followed_up_at":"2026-10-13T06:20:00Z"}` (`message_text`, `note` and `followed_up_at` are optional. `followed_up_at` defaults to now and cannot be in the future).
- **Response 201:** `{"id":"…","invoice_id":"…","channel":"whatsapp","outcome":"promised","followed_up_at":"…"}`. **Errors:** 404, 422. Follow-ups cannot be edited or deleted. A correction is a new entry.

### 8.2 `GET /follow-ups`
- **Roles:** staff. **Filters:** `invoice_id`, `customer_id`, `from`, `to`. **Sort:** `followed_up_at desc, id`. **Response 200:** a list of the above plus `invoice_number` and `customer_name`.

### 8.3 `POST /invoices/{invoice_id}/promises`
- **Roles:** staff. **Request:** `{"promised_date":"2026-10-20","amount":"50000.00","note":null,"follow_up_id":null}` (`amount` and `follow_up_id` are optional).
- **Rules:** `promised_date >= today (IST)`. The promised amount, if given, is no more than the current outstanding balance. The invoice must be open and have an outstanding balance.
- **Response 201:** `{"id":"…","invoice_id":"…","promised_date":"2026-10-20","promised_amount_paise":5000000,"status":"pending"}`
- **Errors:** 404, 409 `pending_promise_exists`, 409 `invoice_not_open`, 422.

### 8.4 `GET /promises`
- **Roles:** staff. **Filters:** `status` (default `pending`), `due` (`overdue`|`today`|`upcoming`), `invoice_id`, `customer_id`. **Sort:** `promised_date asc, id`.

### 8.5 `PATCH /promises/{promise_id}`
- **Roles:** staff. **Request:** `{"status":"kept"|"broken"|"cancelled","note":"…"}` (`note` is optional).
- **Response 200:** the promise. **Errors:** 404, 409 `already_resolved`, 422. Recording a payment does not auto-resolve a promise in V1. The user marks it.

### 8.6 `POST /invoices/{invoice_id}/disputes`
- **Roles:** staff. **Request:** `{"category":"quantity","description":"Customer says 40 bags received, not 50","amount":"5000.00"}` (`amount` is optional and must not exceed the total).
- **Response 201:** `{"id":"…","status":"open","category":"quantity","disputed_amount_paise":500000}`. **Errors:** 404, 409 `open_dispute_exists`, 422. A dispute does not change the balance.

### 8.7 `GET /disputes`
- **Roles:** staff. **Filters:** `status` (default `open`), `invoice_id`, `customer_id`. **Sort:** `created_at desc, id`.

### 8.8 `POST /disputes/{dispute_id}/resolve`
- **Roles:** admin. **Request:** `{"resolution_note":"Credit note issued for 10 bags"}` (3–1000 chars). **Response 200:** the dispute with `"status":"resolved"`. **Errors:** 404, 409 `already_resolved`.

## 9. Dashboard and reports

All figures are derived at read time from active payments, adjustments and open invoices. Reports are GET-only and read-only. **Roles:** staff.

### 9.1 `GET /dashboard/summary`
```json
{"as_of":"2026-10-13","total_outstanding_paise":98765400,"overdue_outstanding_paise":45000000,"open_invoice_count":42,"overdue_invoice_count":17,"collected_last_30_days_paise":23000000,"promises_due_today":3,"promises_overdue":2,"open_disputes":4}
```
`collected_last_30_days_paise` sums active payments only, with `paid_on` in the last 30 IST days. Adjustments are excluded.

### 9.2 `GET /reports/invoice-aging`
- **Query:** `limit`, `offset`, `customer_id` (optional). **Response 200:**
```json
{"as_of":"2026-10-13","buckets":[{"bucket":"current","invoice_count":20,"outstanding_paise":30000000},{"bucket":"1-30","invoice_count":9,"outstanding_paise":21000000},{"bucket":"31-60","invoice_count":5,"outstanding_paise":12000000},{"bucket":"61-90","invoice_count":2,"outstanding_paise":5000000},{"bucket":"90+","invoice_count":1,"outstanding_paise":3000000}],"items":[{"invoice_id":"…","invoice_number":"INV/0031","customer_name":"…","due_date":"2026-08-20","days_overdue":54,"outstanding_paise":1200000,"bucket":"31-60"}]}
```
`items` are the overdue invoices, sorted by `days_overdue desc, id`.

### 9.3 `GET /reports/customer-outstanding`
- **Query:** `limit`, `offset`. **Sort:** `outstanding_paise desc, customer_id`.
- **Response 200:** `{"items":[{"customer_id":"…","customer_name":"…","open_invoices":4,"outstanding_paise":9000000,"overdue_paise":4000000,"oldest_due_date":"2026-07-01"}]}`

## 10. CSV import

Roles: admin. The file is UTF-8 (a BOM is accepted), at most 2 MB and 2,000 rows. The header is exactly: `customer_name, customer_phone, invoice_number, invoice_date, due_date, amount`. Dates are `YYYY-MM-DD` or `DD/MM/YYYY`. Amounts follow the money rule of §1. Only invoices are imported (no payments).

### 10.1 `POST /imports/preview`
- **Request:** `multipart/form-data`, field `file` (`text/csv`).
- **Behavior:** parses and validates every row, checks FY duplicate rules (within the file and against existing invoices), and stores the validated rows in `import_batches.preview_rows`. It writes **no** customers or invoices.
- **Response 201:**
```json
{"import_id":"a7e1d0c2-5b6f-4f0e-9a3d-123456789abc","status":"previewed","filename":"sample.csv","total_rows":120,"valid_rows":112,"error_rows":8,"duplicate_rows":3,"new_customers":14,"expires_at":"2026-10-20T06:30:00Z","errors":[{"row":7,"field":"amount","code":"too_many_decimals"}]}
```
`errors` holds at most 50 entries (the count is complete). Error entries contain a row number, a field and a code, and never the cell values.
- **Errors:** 413 `payload_too_large`, 415 `unsupported_media_type`, 422 `validation_error` (`bad_header`, `too_many_rows`, `bad_encoding`).

### 10.2 `GET /imports/{import_id}`
- **Response 200:** the summary above (without raw rows), or after commit `{"status":"committed","summary":{"created_customers":14,"created_invoices":109,"skipped_duplicates":3},"committed_at":"…"}`. **Errors:** 404.

### 10.3 `POST /imports/{import_id}/commit`
- **Headers:** `Idempotency-Key` (required). **Request:** `{}` (the client sends no row data, the server uses the stored preview).
- **Behavior:** in one transaction it re-validates all rows, matches customers by phone (else by exact normalized name), creates the missing customers, creates the invoices, skips rows that now duplicate an existing invoice, writes audit rows, and sets `preview_rows = NULL`. Any error rolls back everything.
- **Response 200:** the committed summary. **Errors:** 404, 409 `import_already_committed`, 410 `import_expired`, 422 `idempotency_key_reuse`.

## 11. Health (unversioned, no authentication)

- `GET /health/live` → `200 {"status":"ok"}`
- `GET /health/ready` → `200 {"status":"ok"}` or `503 {"status":"unavailable"}`

Neither endpoint exposes versions, configuration or error details.

## 12. Frontend behavior contract (informative)

- The mobile client treats the API as slow or unavailable at any time: the skeleton appears immediately, "still working…" after 3 s, GET timeout 15 s, mutation timeout 30 s.
- GET requests retry up to 2 times with backoff on network errors, 502, 503 and 504. Mutations are never auto-retried, except by an explicit user tap that reuses the same `Idempotency-Key`.
- An "outcome unknown" payment result tells the user to check the invoice's payments or retry safely.
- `401 token_expired` → refresh once and replay. A second 401 signs the user out and returns them to sign-in, with unsaved form values kept in memory only for the session.
- Client validation (Zod) only mirrors the server and never replaces it. The server's `error.code` selects a translated message (English or Telugu). The raw `message` is not shown.
- The frontend never sends a business ID in the body. It sends the selected workspace only in `X-Business-Id`, and it handles `403 workspace_access_denied` by returning to the workspace picker.
