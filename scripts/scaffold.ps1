
# Money Follows - Safe Project Scaffolder
# Creates missing folders and files without overwriting existing files.

$ErrorActionPreference = "Stop"

$directories = @(
    "scripts",
    "frontend/public",
    "frontend/src/app",
    "frontend/src/components/ui",
    "frontend/src/components/layout",
    "frontend/src/features/auth/components",
    "frontend/src/features/auth/pages",
    "frontend/src/features/dashboard/components",
    "frontend/src/features/dashboard/pages",
    "frontend/src/features/customers/components",
    "frontend/src/features/customers/pages",
    "frontend/src/features/invoices/components",
    "frontend/src/features/invoices/pages",
    "frontend/src/features/payments/components",
    "frontend/src/features/payments/pages",
    "frontend/src/features/collections/components",
    "frontend/src/features/collections/pages",
    "frontend/src/features/reports/components",
    "frontend/src/features/reports/pages",
    "frontend/src/lib",
    "frontend/src/hooks",
    "frontend/src/types",
    "frontend/src/styles",
    "frontend/tests/mocks",
    "frontend/e2e",
    "backend/app/core",
    "backend/app/api/v1/endpoints",
    "backend/app/models",
    "backend/app/schemas",
    "backend/app/repositories",
    "backend/app/services/reminders/templates",
    "backend/app/db",
    "backend/app/dependencies",
    "backend/migrations/versions",
    "backend/tests/unit",
    "backend/tests/integration",
    "backend/tests/api",
    "backend/tests/security",
    "docs",
    ".github/workflows"
)

foreach ($directory in $directories) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

$files = @(
    "AGENTS.md",
    "README.md",
    ".gitignore",
    "docker-compose.yml",

    "frontend/package.json",
    "frontend/index.html",
    "frontend/vite.config.ts",
    "frontend/tsconfig.json",
    "frontend/eslint.config.js",
    "frontend/.prettierrc.json",
    "frontend/tailwind.config.ts",
    "frontend/.env.example",
    "frontend/vercel.json",
    "frontend/src/main.tsx",
    "frontend/src/app/router.tsx",
    "frontend/src/app/providers.tsx",
    "frontend/src/app/error-boundary.tsx",
    "frontend/src/lib/api.ts",
    "frontend/src/lib/supabase.ts",
    "frontend/src/lib/money.ts",
    "frontend/src/lib/dates.ts",
    "frontend/src/types/api.ts",
    "frontend/src/styles/index.css",
    "frontend/tests/setup.ts",
    "frontend/tests/mocks/handlers.ts",
    "frontend/e2e/auth.spec.ts",
    "frontend/e2e/invoices.spec.ts",
    "frontend/e2e/payments.spec.ts",

    "backend/requirements.txt",
    "backend/requirements-dev.txt",
    "backend/pyproject.toml",
    "backend/alembic.ini",
    "backend/render.yaml",
    "backend/.env.example",
    "backend/app/main.py",
    "backend/app/core/config.py",
    "backend/app/core/security.py",
    "backend/app/core/exceptions.py",
    "backend/app/core/logging.py",
    "backend/app/core/rate_limit.py",
    "backend/app/api/v1/router.py",
    "backend/app/db/engine.py",
    "backend/app/db/session.py",
    "backend/app/db/rls.py",
    "backend/app/db/base.py",
    "backend/app/dependencies/db.py",
    "backend/app/dependencies/auth.py",
    "backend/app/dependencies/business.py",
    "backend/app/dependencies/roles.py",
    "backend/migrations/env.py",
    "backend/tests/conftest.py",

    ".github/workflows/backend-ci.yml",
    ".github/workflows/frontend-ci.yml",
    ".github/workflows/e2e.yml",
    ".github/workflows/migrate-production.yml"
)

foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file)) {
        New-Item -ItemType File -Path $file | Out-Null
        Write-Host "Created: $file" -ForegroundColor Green
    }
    else {
        Write-Host "Preserved: $file" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Scaffolding complete!" -ForegroundColor Cyan
Write-Host "Existing files were not overwritten."
Write-Host "Empty files still need real implementations."
