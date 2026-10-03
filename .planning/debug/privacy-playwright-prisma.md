---
status: investigating
trigger: "Focused Phase 06 Playwright globalSetup stopped at live-provider-stack.ts:54 with an empty Prisma schema-engine error."
created: 2026-09-25
updated: 2026-09-25
---

## Current Focus

hypothesis: "The original reported schema-engine failure was not an invalid migration: live-provider-stack could continue after an unconfirmed PostgreSQL readiness loop and then discarded Prisma's captured stderr, making any startup failure appear as an empty schema-engine error."
test: "Run Node 24.14 Prisma migrate deploy against a new owned PostgreSQL 18 bet_stats database with Prisma debug logging."
expecting: "All 24 migrations apply, disproving a migration/schema defect and isolating diagnostics/readiness behavior in the Playwright global setup harness."
next_action: "Parent may run the focused privacy Playwright suite; if globalSetup fails again, retain PRISMA_MIGRATE_DEPLOY_FAILED stderr and container logs to classify the new concrete error."
bug_class: "Bohrbug"

## Evidence

- timestamp: 2026-09-25
  checked: "privacy-focused stdout, stderr, and exit artifacts"
  found: "stderr is empty; stdout only says `Schema engine error:` because execFileSync used stdio: pipe and the caught error was rethrown without its stderr."
  implication: "The artifact contains no exact schema-engine diagnostic to attribute to a migration."

- timestamp: 2026-09-25
  checked: "Node 24.14.0 direct Prisma migrate deploy against a newly created, owned PostgreSQL 18.6 container with POSTGRES_DB=bet_stats and DEBUG=prisma:*"
  found: "Prisma found and successfully applied all 24 migrations, including both 20260924 privacy migrations."
  implication: "The current migrations and Node 24 Prisma schema engine are green; no migration bypass or SQL change is warranted."

- timestamp: 2026-09-25
  checked: "live-provider-stack startup boundary"
  found: "Its readiness loop had no terminal failure: after 60 unsuccessful pg_isready attempts it could continue to migrate deploy. It also hid Prisma child stderr."
  implication: "The harness must fail closed on PostgreSQL readiness and surface captured Prisma stderr before another browser-focused retry."

## Resolution

root_cause: "Not a reproducible schema/migration defect. The live global setup could mask a PostgreSQL startup race as an empty Prisma schema-engine error because readiness was fail-open and migration stderr was discarded."
fix: "Added fail-closed PostgreSQL readiness and a Prisma migration wrapper that preserves captured stderr in tests/e2e/live-provider-stack.ts."
verification: "Clean Node 24.14 + PostgreSQL 18 direct migrate deploy: 24/24 migrations applied successfully. The subsequent owned live-harness advanced beyond migration to API startup; its parent output stream detached before an integration verdict, and its owned containers were cleaned."
files_changed: [tests/e2e/live-provider-stack.ts]
