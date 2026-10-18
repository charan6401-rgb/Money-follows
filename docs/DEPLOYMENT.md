# docs/DEPLOYMENT.md

# Money Follows: deployment guide (Supabase, Render, Vercel)

Status: **written, not executed.** I could not reach Supabase, Render or Vercel from the build environment, so every provider-side step below is **UNVERIFIED** against the live dashboards. The application side (migrations from a clean database, the API on environment variables only, the real HTTP flow) was run locally against PostgreSQL 17. Provider screens and names change: if a label differs, follow the intent and check the provider's current documentation.

Order matters: **Supabase first, then Render, then Vercel, then go back and connect them.**

```
Browser (Vercel, React)  --sign-in code-->  Supabase Auth
        |                                        |
        | Bearer token + X-Business-Id           | JWKS (public keys)
        v                                        v
   API on Render (FastAPI)  <---verifies token---+
        |
        | role mf_app, through the Supabase pooler
        v
   Supabase Postgres (schema mf, RLS forced)
```

Keep a private scratch note for the values you collect. **Never commit them, never paste them into a chat, never put them in a `VITE_*` variable.**

| Value | Where it comes from | Goes into |
|---|---|---|
| `PROJECT_REF` | Supabase project URL, `https://PROJECT_REF.supabase.co` | several places below |
| `mf_app` password | you choose it (long, random) | Render `DATABASE_URL` |
| `mf_migrator` password | you choose it (different) | your laptop only, for migrations |
| Pooler host | Supabase dashboard, Connect | the two database URLs |
| Project URL + publishable (anon) key | Supabase dashboard, API keys | Vercel `VITE_SUPABASE_*` |
| Render URL | Render, after the first deploy | Vercel `VITE_API_BASE_URL` |
| Vercel URL | Vercel, after the first deploy | Render `CORS_ALLOWED_ORIGINS`, Supabase Site URL |

The **service-role key is never used anywhere** in this project. Do not copy it.

---

## 1. Supabase (database and sign-in)

### 1.1 Create the project
1. Create a project. Choose a region near your users (an India region if offered; availability is UNVERIFIED). Save the database password somewhere safe.
2. Note `PROJECT_REF`.

### 1.2 Create the three database roles
1. Open **SQL Editor**, paste the whole of `backend/scripts/bootstrap_roles.sql`, run it. It is safe to run twice.
2. Set the passwords in a **separate** run (replace the placeholders; do not save this query):
   ```sql
   ALTER ROLE mf_app      PASSWORD 'PUT-A-LONG-RANDOM-PASSWORD-HERE';
   ALTER ROLE mf_migrator PASSWORD 'PUT-A-DIFFERENT-LONG-RANDOM-PASSWORD-HERE';
   ```
3. If any statement is rejected (Supabase may restrict some role attributes for the `postgres` user), stop and send me the exact error. This is the first documented risk (DECISIONS D-7) and I will adjust the script. Do not work around it by granting extra privileges.

### 1.3 Build the two connection strings
Open **Connect** in the dashboard and copy the **pooler** details (Render's free tier has no IPv6, and Supabase's direct connection may be IPv6 only, so use the pooler).

The pooler user name is `ROLE.PROJECT_REF`. If a password has special characters, URL-encode them.

```text
# for Render (runtime, transaction pooler, port 6543)
postgresql+psycopg://mf_app.PROJECT_REF:MF_APP_PASSWORD@POOLER_HOST:6543/postgres

# for your laptop (migrations, session pooler, port 5432)
postgresql+psycopg://mf_migrator.PROJECT_REF:MF_MIGRATOR_PASSWORD@POOLER_HOST:5432/postgres
```

The app was written for transaction-pooler safety (no server-side prepared statements, transaction-local settings). Whether the real pooler preserves this is **UNVERIFIED** (tests R4 and R10 in `SECURITY.md`); see section 5.

### 1.4 Run the migration (from your laptop, once)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export MIGRATION_DATABASE_URL='postgresql+psycopg://mf_migrator.PROJECT_REF:...@POOLER_HOST:5432/postgres'
alembic upgrade head
```
Expected last line: `Running upgrade  -> 0001, Baseline: schema mf, 13 tables, RLS, triggers, grants, mf_create_business.` The migrator URL must never be set on Render.

### 1.5 Check the security basics in the SQL Editor
```sql
-- 13 rows, both columns true
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'mf' AND c.relkind = 'r' ORDER BY 1;

-- three rows, every flag false
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname LIKE 'mf\_%';
```
Also open **Project Settings, API** and confirm the schema `mf` is **not** in the exposed schemas list.

### 1.6 Sign-in by email code (DECISIONS D-12, UNVERIFIED)
1. **Authentication, Providers:** Email enabled.
2. **Authentication, Email Templates:** the default "Magic Link" and "Confirm sign up" emails contain a link, not a code. The app asks for a code, so edit **both** templates to include `{{ .Token }}`, for example: `Your Money Follows sign-in code is {{ .Token }}`.
3. Check the code length and expiry in the Auth settings. The app accepts up to 10 characters.
4. **SMTP:** the built-in email sender is heavily rate limited and meant for testing. Add a custom SMTP provider before inviting real users (DECISIONS D-9 gate 5).
5. **URL Configuration:** set Site URL and Redirect URLs to your Vercel URL after section 3.
6. The app calls sign-in with account creation enabled (`shouldCreateUser: true`), so any email address can create an account and up to three businesses. If you want an invite-only pilot, tell me and I will change that, because it is a product decision.

### 1.7 Token signing keys (DECISIONS D-6, UNVERIFIED, go/no-go)
The API accepts only asymmetric tokens (ES256 or RS256) verified through the public JWKS. Open this in a browser:

```text
https://PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json
```
It must show at least one key with `"alg":"ES256"` (or RS256). If the keys list is empty or the project only uses the legacy shared secret, **stop**: enable asymmetric JWT signing keys in the project's JWT settings first. There is deliberately no shared-secret fallback.

### 1.8 Values the API needs
```text
SUPABASE_JWKS_URL    = https://PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_JWT_ISSUER  = https://PROJECT_REF.supabase.co/auth/v1
SUPABASE_JWT_AUDIENCE= authenticated
```

---

## 2. Render (API)

1. **New, Blueprint**, connect the GitHub repository, choose the branch, and set the Blueprint path to `backend/render.yaml`. (Or create a Web Service by hand: root directory `backend`, build `pip install -r requirements.txt`, start `uvicorn app.main:create_app --factory --host 0.0.0.0 --port $PORT`, health check `/health/live`.)
2. Enter the values marked `sync: false`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the **mf_app** transaction-pooler URL from 1.3 |
| `SUPABASE_JWKS_URL` | from 1.8 |
| `SUPABASE_JWT_ISSUER` | from 1.8 |
| `CORS_ALLOWED_ORIGINS` | your Vercel production URL (section 3), for example `https://money-follows.vercel.app`. No trailing slash, no wildcard, https only |

   Already set by the blueprint: `ENVIRONMENT=production`, `SUPABASE_JWT_AUDIENCE=authenticated`, pool and timeout values, `LOG_LEVEL`, `PYTHON_VERSION`. In production the API refuses to start if any URL is not https.
3. Deploy, then open `https://YOUR-SERVICE.onrender.com/health/live` (expect `{"status":"ok"}`) and `/health/ready` (expect `{"status":"ok"}`, which proves the database login works). `503` on ready means the database URL is wrong: check the `mf_app.PROJECT_REF` user format, the password encoding and the port.
4. API docs are switched off in production on purpose.
5. The free plan sleeps when idle, so the first request after a pause can take about a minute. Use an always-on plan before real customer data (D-9 gate 6).

---

## 3. Vercel (frontend)

1. **Add New, Project**, import the repository. Set **Root Directory** to `frontend`. Framework preset Vite, build command `npm run build`, output directory `dist`.
2. Environment variables (all public, all build-time):

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://YOUR-SERVICE.onrender.com` (no trailing slash, no `/api/v1`) |
| `VITE_SUPABASE_URL` | `https://PROJECT_REF.supabase.co` |
| `VITE_SUPABASE_PUBLIC_KEY` | the publishable (anon) key. **Never the service-role key** |

3. Deploy. If the page is blank or shows a configuration message, a variable is missing; fix it and **redeploy** (they are baked in at build time).
4. `frontend/vercel.json` already adds the single-page-app rewrite and security headers. Its `connect-src` allows `https://*.onrender.com` and `https://*.supabase.co`. Once you know the exact API host, tighten `https://*.onrender.com` to it and redeploy.
5. Vercel preview deployments get a different hostname each time and will be blocked by CORS (by design). Test on the production URL or a fixed custom domain.

---

## 4. Connect them, then test with real accounts

1. Render: set `CORS_ALLOWED_ORIGINS` to the Vercel production URL, redeploy.
2. Supabase: set Site URL and Redirect URLs to the Vercel URL (1.6).
3. Test in this order. Each step needs the previous one:
   1. Open the Vercel URL, enter your email, receive the code, sign in.
   2. Create a business, then a customer (try a phone starting 9).
   3. Create an invoice with a past date. The dashboard should show it as outstanding and overdue.
   4. Record a payment. The balance drops and the payment appears on the invoice.
   5. **Isolation test:** sign in with a second email address, create a business, and confirm you cannot see the first account's customers or invoices. This is the most important check.
   6. Reverse the payment (owner or admin) and check the balance goes back up.

---

## 5. What is and is not verified

Verified (executed, PostgreSQL 17.10, local): 213 backend tests, 159 frontend tests, type-check, lint, production build, migrations from an empty database, forced row-level security and cross-tenant tests, concurrent-payment tests, and a real-HTTP smoke flow including the CORS preflight.

**Not verified, needs your accounts:**
- Supabase pooler behaviour (tests R4 pool-leakage and R10 concurrency soak, `SECURITY.md`) and the Supabase PostgreSQL major version (generated-column check, D-1).
- Real tokens and JWKS from your project (D-6) and the email-code flow and account creation (D-12).
- Role creation permissions on Supabase (D-7, step 1.2).
- Render and Vercel settings above, the GitHub Actions workflows (written, never run), and Telugu text (a draft, not reviewed by a native reader).

**Release gates (D-9), all NOT CONFIGURED.** Do not store real customer financial data until backups (including an independent encrypted copy and a restore drill), custom SMTP, always-on hosting, secrets rotation and the privacy notice are done.

**Not built yet (documented in `API.md`):** adjustments (TDS, discounts, credit notes, write-offs), follow-ups, payment promises, disputes, the WhatsApp reminder message, CSV import, and team invitations. The app shows no screens for these.
