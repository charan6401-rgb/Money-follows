# docs/PRODUCT_SPEC.md

# Money Follows — Product Specification

> **Status:** proposal for validation. Pilot targets are **validation goals, not guaranteed outcomes**. Nothing here has been built or verified.

## 1. Product definition

Money Follows is a **mobile-first web application** (it runs in a mobile browser and on desktop). It is B2B SaaS for receivables management and payment follow-up for Indian MSMEs with recurring B2B credit sales. The first market is building-material distributors, wholesalers and construction-related suppliers in Telangana and Andhra Pradesh.

Core outcome: a reliable view of outstanding receivables, overdue invoices, recorded payments, promised payment dates, customer disputes and collection activity.

It is **not** an accounting or ERP system. Languages: English and Telugu in V1. Hindi is a designed future extension. No native Android/iOS app is included.

## 2. Target user and problem statement

**Users:** the business owner (primary), and optionally staff who record payments and follow up.

**Problems:**
- Overdue invoices are tracked by hand.
- Owners lose time chasing payments.
- Partial payments create confusing balances.
- Promised payment dates are forgotten.
- Disputes and follow-up history are scattered across chats, spreadsheets and notebooks.
- An ERP is too complex or costly for these businesses.

## 3. User journeys

| # | Journey | Steps (mobile first) |
|---|---|---|
| J1 | First setup | Sign in with an emailed code → create a workspace → add the first customer and invoice |
| J2 | Bring in existing receivables | Import a CSV → review the preview and errors → commit |
| J3 | Create an invoice | Pick or add the customer → number, dates, amount → save |
| J4 | Record a payment | Open the invoice → enter amount and date → confirm the resulting balance → save (retry-safe) |
| J5 | Record a deduction | Admin: add TDS, discount, credit note or write-off with a reason |
| J6 | Chase an overdue invoice | Dashboard → overdue list → open the invoice → get the reminder (EN/TE) → edit → copy or open WhatsApp → send manually → log the follow-up |
| J7 | Capture a promise | After a follow-up, add a promised date → see it on the dashboard when due |
| J8 | Handle a dispute | Open a dispute with a category → later resolve it with a note |
| J9 | Correct a mistake | Admin reverses a payment or adjustment with a reason, or cancels an invoice |
| J10 | Weekly review | Dashboard totals, invoice aging, customer outstanding |

## 4. V1 feature scope

- Identity and workspaces (a single-owner workspace per pilot business), a read-only members list.
- Customers (create, edit, deactivate, search).
- Invoices (create, view, edit the due date and notes, cancel), numbering unique per business and financial year.
- Payments (record, list, reverse) with idempotency, with partial payments supported, and overpayments rejected.
- Adjustments (TDS, discount, credit note, write-off) with reversal. The user enters the amounts. The system never calculates TDS or GST.
- Follow-ups (an append-only log), payment promises, disputes.
- Dashboard summary, invoice aging, customer outstanding.
- CSV import (preview, then commit), of invoices only.
- Reminder drafts in English and Telugu, which the user edits and sends manually.

The API for this scope is the 35-endpoint inventory in `ARCHITECTURE.md` §15 and the detailed contract in `API.md`:

| Area | Endpoints |
|---|---|
| Identity and workspaces | GET/PATCH `/me`, GET/POST `/businesses` |
| Members | GET `/members` |
| Customers | POST/GET `/customers`, GET/PATCH `/customers/{id}` |
| Invoices | POST/GET `/invoices`, GET/PATCH `/invoices/{id}`, POST `/invoices/{id}/cancel`, GET `/invoices/{id}/reminder-message` |
| Payments | POST/GET `/invoices/{id}/payments`, POST `/payments/{id}/reverse` |
| Adjustments | POST/GET `/invoices/{id}/adjustments`, POST `/adjustments/{id}/reverse` |
| Follow-ups | POST `/invoices/{id}/follow-ups`, GET `/follow-ups` |
| Promises | POST `/invoices/{id}/promises`, GET `/promises`, PATCH `/promises/{id}` |
| Disputes | POST `/invoices/{id}/disputes`, GET `/disputes`, POST `/disputes/{id}/resolve` |
| Reports | GET `/dashboard/summary`, `/reports/invoice-aging`, `/reports/customer-outstanding` |
| Import | POST `/imports/preview`, GET `/imports/{id}`, POST `/imports/{id}/commit` |

## 5. Explicit exclusions (V1)

Automated WhatsApp or SMS sending, payment gateways, LLM features, accounting and ledger features, GST or TDS calculation and filing, e-invoicing, inventory, multi-currency, overpayment and advance handling, customer-level (unallocated) payments, payments import, invitation and member-management UI, staff-permission customization, data export, a native mobile app, offline financial writes and background sync, Hindi UI, bank reconciliation, interest and penalty calculation, and a customer-facing portal.

## 6. Acceptance criteria

| ID | Criterion |
|---|---|
| AC-1 | A user can sign in, create a workspace and see an empty dashboard on a 360 px phone |
| AC-2 | Outstanding = invoice total − active payments − active adjustments, shown on every invoice and never negative |
| AC-3 | A partial payment leaves the correct balance and the invoice stays open with `payment_state = partial` |
| AC-4 | An overpayment is rejected with a clear message and nothing is stored |
| AC-5 | A double tap or retry of a payment creates exactly one payment |
| AC-6 | A reversal restores the balance, requires a reason, and the original record stays visible as reversed |
| AC-7 | Adjustments reduce the balance but do not appear in collected cash |
| AC-8 | An invoice that is past its due date with a balance shows as overdue, and appears in the aging buckets |
| AC-9 | A reminder draft appears in English or Telugu with the correct names, amounts and dates, and is editable before sending |
| AC-10 | Nothing is sent automatically. Logging a follow-up is a separate user action |
| AC-11 | A pending promise shows on the dashboard on its date. A passed date shows as overdue |
| AC-12 | A user of workspace A can never see or change workspace B's data |
| AC-13 | A staff user cannot reverse, adjust, cancel, resolve disputes or import |
| AC-14 | The CSV preview shows errors by row, and nothing is created until commit. A commit is all-or-nothing |
| AC-15 | Invoice numbers are unique within a business and financial year, and the same number is allowed in another FY |
| AC-16 | The app stays usable (clear states, no lost data, no double writes) when the API is slow or down |
| AC-17 | All primary workflows meet the mobile checklist in §8 |

## 7. English and Telugu reminder requirements

- The server fills the template placeholders: `{customer_name}`, `{business_name}`, `{invoice_number}`, `{invoice_date}`, `{total}`, `{outstanding}`, `{due_date}`. Rupee amounts use Indian digit grouping (₹1,25,000.00). Dates are `DD-MM-YYYY`.
- The tone is polite and neutral. There are **no** threats, legal claims, interest or penalty statements (the MSME payment-term rules are an open CA question).
- The user always edits and sends the message manually. The app offers Copy and "Open in WhatsApp" (a link that opens on the device). The edited text is not stored except by an optional follow-up record.
- The language defaults to the customer's `preferred_language`, and the user can switch.

**English template (default draft):**
> Dear {customer_name}, this is a friendly reminder from {business_name}. Invoice {invoice_number} dated {invoice_date} for ₹{total} has an outstanding balance of ₹{outstanding}, due on {due_date}. Please let us know when we can expect the payment. Thank you.

**Telugu template (default draft, to be reviewed by a native-speaking business owner before the pilot):**
> నమస్కారం {customer_name} గారు, {business_name} నుండి ఒక చిన్న గుర్తుచేత. {invoice_date} తేదీ గల ఇన్వాయిస్ {invoice_number} (₹{total}) లో ₹{outstanding} బకాయి ఉంది, చెల్లింపు గడువు {due_date}. చెల్లింపు ఎప్పుడు చేయగలరో దయచేసి తెలియజేయండి. ధన్యవాదాలు.

A settled or cancelled invoice produces no reminder (`409 invoice_not_open`). The Telugu text must render correctly in Android Chrome, iOS Safari and desktop browsers (test item M-14).

## 8. Mobile-first design and testing checklist

Viewports tested: **360×800**, **390×844** and desktop (1280×800). Workflows covered by Playwright from S6 (`P`) and verified manually on real devices at S9 (`D`).

| ID | Requirement | How verified |
|---|---|---|
| M-1 | Layouts are designed at 360 px first and expand at 768 px and 1024 px | P |
| M-2 | No horizontal scrolling in any core workflow | P |
| M-3 | Wide data becomes cards on mobile (invoices, customers, payments), with tables only at md and above | P |
| M-4 | Touch targets are about 44×44 CSS px (buttons, tabs, list rows, form controls) | P (bounding boxes), D |
| M-5 | Amounts, due dates and balances are readable without zooming (a minimum 16 px body size, and the outstanding amount prominent) | P, D |
| M-6 | The rupee input uses `inputMode="decimal"`, the phone input is `type="tel"`, and dates use the native date input | P, D |
| M-7 | The virtual keyboard never hides the focused field. Sticky bars and bottom nav never cover controls or the primary action (dvh units, safe-area insets, bottom padding) | D (Android and iOS) |
| M-8 | No hover-only actions, no tiny icon-only controls (every icon has a visible label or an accessible name of adequate size) | P, review |
| M-9 | Destructive and financial actions (reversal, cancel, write-off, commit import) have a clear confirmation step, show the effect, and are not adjacent to the primary action | P |
| M-10 | Loading, empty, error, retry and success states exist for every list and form | P |
| M-11 | Slow API (3 s+ delay) shows progress and works. API down shows the retry screen and no data is lost or doubled | P |
| M-12 | Forms are short and single-column, usable one-handed, with the primary action in the thumb zone | review, D |
| M-13 | Accessibility: labelled inputs, keyboard navigation, visible focus, contrast ≥ 4.5:1, status not only by colour, screen-reader names for amounts and statuses | P (axe-style checks), D |
| M-14 | English and Telugu render correctly, with no clipped text at 360 px | P, D |
| M-15 | Token expiry mid-session recovers without losing the entered form values | P |
| M-16 | Real-device matrix: Android Chrome (a low-end device), iOS Safari, Samsung Internet if used by pilot users, plus desktop Chrome and Edge | D |
| M-17 | There are no offline financial writes, and no sync. Going offline shows a clear "can't save" state | P |

PWA installability is optional and is added only if it does not add complexity or risk. It is not part of the acceptance criteria.

## 9. CSV import and preview requirements

- **Columns:** `customer_name, customer_phone, invoice_number, invoice_date, due_date, amount` (exact header, UTF-8, ≤ 2 MB, ≤ 2,000 rows). Dates are `YYYY-MM-DD` or `DD/MM/YYYY`. Amounts have at most 2 decimals and no exponent. Phone numbers are normalized.
- **Preview** shows total, valid, error and duplicate counts, the new customers that would be created, and errors by row, field and reason (at most 50 listed). It stores the validated rows server-side and creates no records.
- **Duplicates:** an invoice number that already exists in the same FY, or twice in the file, is flagged and skipped at commit. Customers are matched by phone, else by exact normalized name.
- **Commit** is a single atomic action by admin or owner, confirmed on a clear screen, safe to retry (idempotency), and then purges the stored rows. A preview expires after 7 days.
- **Mobile:** the file is chosen with the phone's file picker, the error list is a card list, and the summary is readable at 360 px.

## 10. Financial workflow requirements

- Money is exact (integer paise). Inputs allow at most two decimals.
- An invoice's original amount is independent of payment history.
- Payments are recorded per invoice. A payment that covers several invoices is recorded as separate payments (to be validated in the pilot).
- Overpayments are rejected. Advances are out of scope.
- Adjustments (TDS, discount, credit note, write-off) are separate from cash. The user enters them. The system never calculates tax.
- Nothing financial is deleted. Corrections are reversals or cancellations with a reason, and the history stays visible.
- Every financial change has an audit record.
- Payments and adjustments are locked and rechecked under the invoice lock, so concurrent submissions cannot exceed the balance.
- Reports separate cash collected (payments only) from adjustments.
- Dates and "overdue" use IST.

## 11. Roles (summary of D-4)

The owner and admin can do everything. Staff can record payments, create customers and invoices, log follow-ups and promises, and open disputes. Only admin or above can reverse, adjust, cancel, resolve disputes and import. Whether staff should record payments at all is a pilot question.

## 12. Pilot metrics (proposed validation goals, not promises)

| Metric | Proposed goal |
|---|---|
| Pilot size | 3–5 businesses for 6–8 weeks |
| Share of active receivables loaded into the app | ≥ 80% of open invoices within week 2 |
| Median time to record a payment on mobile | ≤ 45 seconds |
| Weekly active use by the owner or staff | in ≥ 3 of the first 4 weeks |
| Reminders drafted per week per business | tracked, with a target set after week 2 |
| Share of overdue invoices with a logged follow-up in the last 14 days | ≥ 60% |
| Balance mismatches reported by users | 0 unexplained |
| Payment-recording errors needing reversal | tracked as a usability signal |
| Pilot owners who say they would pay | ≥ 3 of 5, with a stated price range |
| Share of sessions on mobile browsers | tracked |

## 13. Questions for business-owner interviews

- How are overdue invoices currently tracked?
- How are partial payments recorded?
- How frequently do customers deduct TDS?
- How are credit notes and discounts handled?
- How often do customers overpay or pay advances?
- How are payments spanning multiple invoices recorded?
- Do staff or only owners record payments?
- Does an accountant need access?
- Which devices and browsers are used?
- Is Telugu reminder wording preferred?
- Would owners pay for the product after a pilot?

Additional questions the pilot should answer: how are invoice numbers formed and do they restart each April, what does the owner do when a customer says "I'll pay next week", and what reminder tone is acceptable to their customers?

## 14. Questions for a qualified CA

- How should TDS affect receivable balances before credit confirmation?
- What is the correct handling of credit notes and post-invoice discounts?
- How should write-offs be documented?
- Should invoice amounts be stored as gross totals or split into taxable value and GST?
- What financial-record retention and erasure obligations apply?
- Are any MSME payment-term rules relevant to the proposed reminder wording?

## 15. Technical and commercial risks

| Risk | Type | Mitigation or check |
|---|---|---|
| The RLS and pooler design fails S0 | Technical | The S0 gate. Documented fallbacks need a new decision |
| Supabase signing keys or JWKS not available as assumed | Technical | Verified first in S0 |
| Generated-column or trigger behavior differs on Supabase | Technical | S0 compatibility test, with a fallback |
| API cold starts hurt the mobile experience | Technical | An always-on plan or the designed cold-start UX with monitoring (UNVERIFIED costs) |
| Auth emails (OTP) are not delivered reliably | Technical | Custom SMTP gate, a test on several providers |
| Provider free-tier or commercial-use limits (Vercel, Render, Supabase) | Commercial | All marked UNVERIFIED, checked in S9 |
| Accounting semantics (TDS, credit notes) are wrong for real users | Product | The pilot and CA validation before relying on the adjustment model |
| Data loss | Operational | The backup and restore gates (NOT CONFIGURED) |
| Retention and privacy obligations are unclear | Legal | The CA and lawyer review before real data |
| Owners will not trust a new tool or dislike manual WhatsApp sending | Commercial | The pilot, with the simplest possible flows |
| A solo developer's capacity | Delivery | Small phases, S0 to S10 gating, and no scope beyond the inventory |
| Telugu wording is awkward or offends | Product | Native review before the pilot |
| Customers receive reminders that mention wrong amounts due to data entry errors | Product | The balance is shown before sending. Reversals and corrections are easy |
