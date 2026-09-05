# Phase 3 Validation Strategy

**Created:** 2026-09-05
**Status:** Wave 0 contract established before execution

## Test Infrastructure

- Vitest unit and integration projects cover domain, API, worker, and PostgreSQL boundaries.
- Playwright runs once after the web plan as its plan/wave gate, then once at the final live-stack phase gate.
- Database guarantees use a project-owned disposable PostgreSQL instance; SQLite and shared/populated database resets are excluded.

## Wave 0 Test Map

| Requirement / decision | Owning tests | Fast automated command | Created by |
|---|---|---|---|
| PRED-01..03; D-01..04, D-07 | `tests/unit/forecast-value-tracer.test.ts`, `tests/unit/forecast.test.ts` | `node node_modules/vitest/vitest.mjs run tests/unit/forecast-value-tracer.test.ts tests/unit/forecast.test.ts --project unit` | 03-01, 03-02 |
| ODDS-01, ODDS-03; D-09, D-11 | `tests/unit/value.test.ts`, `tests/unit/odds-draft.test.ts` | `node node_modules/vitest/vitest.mjs run tests/unit/value.test.ts tests/unit/odds-draft.test.ts --project unit` | 03-02 |
| PRED-04, PRED-06, ODDS-02, VALUE-01, VALUE-04; D-05, D-06, D-10, D-12, D-17 | `tests/integration/forecast-snapshots.test.ts`, `tests/integration/manual-odds.test.ts`, `tests/integration/value-receipt.test.ts`, `tests/integration/migration-empty.test.ts` | `node node_modules/vitest/vitest.mjs run tests/integration/forecast-snapshots.test.ts tests/integration/manual-odds.test.ts tests/integration/value-receipt.test.ts tests/integration/migration-empty.test.ts --project integration` | 03-03 |
| PRED-04..06; D-04..08 | `tests/integration/forecast-api.test.ts`, `tests/integration/forecast-publication.test.ts` | `node node_modules/vitest/vitest.mjs run tests/integration/forecast-api.test.ts tests/integration/forecast-publication.test.ts --project integration` | 03-04 |
| ODDS-01..03, VALUE-01..04; D-09..17 | `tests/integration/manual-odds-api.test.ts`, `tests/integration/value-api.test.ts` | `node node_modules/vitest/vitest.mjs run tests/integration/manual-odds-api.test.ts tests/integration/value-api.test.ts --project integration` | 03-05 |
| D-11 local-only draft; D-07, D-12, D-15..17 UI | `tests/unit/odds-draft-ui.test.tsx`, `tests/unit/responsible-copy.test.ts`, `tests/e2e/forecast-workbench.spec.ts` | `node node_modules/vitest/vitest.mjs run tests/unit/odds-draft-ui.test.tsx tests/unit/responsible-copy.test.ts --project unit` | 03-06 |
| All 13 requirements and D-01..D-17 adversarial/live chain | `tests/integration/phase-03-security.test.ts`, `tests/e2e/forecast-workbench.spec.ts` | `node node_modules/vitest/vitest.mjs run tests/integration/phase-03-security.test.ts --project integration` | 03-07 |

## Schema Gate

On disposable PostgreSQL: run Prisma `validate`, `generate`, `migrate deploy`, and `migrate status`; run migration-empty and persistence integration tests; then typecheck `@bet-stats/database`, `@bet-stats/api`, and `@bet-stats/data-sync` against `packages/database/src/generated/prisma`.

## Plan/Wave and Phase Gates

- After 03-06: `corepack pnpm exec playwright test tests/e2e/forecast-workbench.spec.ts` once for the complete browser behavior, including draft restore/no-analysis and receipt accessibility.
- After 03-07: unit + integration projects, live Playwright, workspace typecheck, lint, and build under Node 24.

## Nyquist Rule

Every production task names its test file and has a runnable automated check. Files listed above that do not yet exist are Wave 0 test contracts: the owning task creates the failing test before implementation and completes it in the same TDD cycle.
