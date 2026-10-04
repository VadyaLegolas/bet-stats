---
status: resolved
trigger: "Phase 3 PostgreSQL security matrix passed 9/13; WR-01, CR-04, CR-01, and WR-03 failed."
created: 2026-09-08T13:30:00+02:00
updated: 2026-09-08T13:40:16+02:00
---

## Current Focus

hypothesis: resolved
next_action: Run the remaining production workbench UAT.
bug_class: bohrbug

## Symptoms

expected: All 13 Phase 3 PostgreSQL trust-boundary witnesses pass.
actual: WR-01 failed during advisory-lock acquisition and later source-verification; CR-04, CR-01, and WR-03 then failed because WR-01 did not create their prerequisite snapshots and receipt.
reproduction: Run `tests/integration/phase-03-security.test.ts` against the migrated disposable PostgreSQL database.

## Evidence

- timestamp: 2026-09-08T13:33:49+02:00
  checked: First focused PostgreSQL run after replacing the NUL separator.
  found: PostgreSQL accepted the lock key, but Prisma rejected deserializing the void return from `pg_advisory_xact_lock`.
  implication: Advisory lock acquisition must use the execute API rather than the query API.
- timestamp: 2026-09-08T13:34:18+02:00
  checked: Focused run after switching to `$executeRaw`.
  found: CR-04 passed; WR-01 reached value persistence, where the database guard rejected the otherwise source-derived receipt. CR-01 and WR-03 still lacked the WR-01 receipt.
  implication: CR-04 was a cascade; the remaining primary defect was inside the value receipt guard.
- timestamp: 2026-09-08T13:37:50+02:00
  checked: Persisted ValueReceipt shape and guard JSON paths.
  found: The application stores the full DTO and nests audit fields at `receipt.receipt`, while the guard read them from the outer JSON object.
  implication: The guard must validate the nested audit receipt while retaining compatibility with direct flat audit receipts.
- timestamp: 2026-09-08T13:40:16+02:00
  checked: Complete Phase 3 security matrix after both forward migrations.
  found: 13 of 13 tests passed; API and database TypeScript checks also passed.
  implication: Both primary defects are fixed and all three dependent failures are cleared.

## Resolution

root_cause: "The forecast revision advisory lock used a PostgreSQL-invalid NUL text separator and Prisma's result-returning API for a void function; independently, the value guard read audit fields from the outer persisted DTO instead of its nested receipt, causing valid receipts to be rejected. CR-04, CR-01, and WR-03 were downstream cascades from those failures."
fix: "Use a colon-delimited advisory-lock key with `$executeRaw`, and deploy a forward migration that validates the nested audit receipt with flat-receipt compatibility."
verification:
  phase_03_security: { result: pass, passed: 13, failed: 0 }
  api_typecheck: { result: pass }
  database_typecheck: { result: pass }
files_changed:
  - apps/api/src/modules/forecasts/forecasts.service.ts
  - packages/database/prisma/migrations/20260908_phase03_value_receipt_guard_path/migration.sql
oracle_type: specified
