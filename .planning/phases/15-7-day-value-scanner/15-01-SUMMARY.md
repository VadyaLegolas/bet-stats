---
phase: 15-7-day-value-scanner
plan: 01
subsystem: value-scanner
tags: [scanner, value, postgres, nestjs, nextjs, read-model]
requires:
  - phase: 14-asian-handicap-and-exact-score-markets
    provides: ValueReceipt extended block, Phase 14 seed builders
provides:
  - "GET /value/scanner: single-statement 7-day window read model with a fixed DTO contract"
  - "Domain scanner module: constants (scanner-freshness-v1, window, limit, market and selection order), classifyOddsFreshness, DTO types"
  - "Tracer /scanner server page (force-dynamic, verbatim edge and EV)"
  - "tests/helpers/scanner-seed.ts and a real-PostgreSQL integration suite"
affects: [15-02, 15-03, 15-04, 15-05, phase-16]
tech-stack:
  added: []
  patterns:
    - "One tagged-template $queryRaw statement with CTEs (latest per triple, summary, candidates, kept, page)"
    - "Injectable clock and repository for the scanner service (loadScanner)"
    - "Stored value strings pass database to JSON to HTML untouched"
key-files:
  created:
    - packages/domain/src/value/scanner.ts
    - apps/api/src/modules/value/scanner.service.ts
    - apps/api/src/modules/value/scanner.controller.ts
    - apps/web/app/scanner/page.tsx
    - tests/helpers/scanner-seed.ts
    - tests/integration/scanner-api.test.ts
  modified:
    - packages/domain/src/index.ts
    - apps/api/src/modules/value/value.module.ts
key-decisions:
  - "Freshness thresholds confirmed for scanner-freshness-v1: FRESH below 6 h, AGING 6 h through 24 h inclusive, STALE above 24 h, measured from ManualOddsSnapshot.submittedAt."
  - "Truncation at a fixture boundary; the first fixture is always kept; truncated = totalCandidates > items.length."
  - "No internal-api/scanner proxy; the page calls the API directly like scorecards."
  - "DTO names follow the code: valuePolicyVersion, competition = League.name, evPolicyVersion only for Asian handicap, oddsCapturedAt is informational."
patterns-established:
  - "Read model correctness is proven on a disposable postgres:18-alpine container with its own far-future 30-day band per test."
requirements-completed: [SCAN-01, SCAN-02, SCAN-03]
status: complete
duration: ~50 min
completed: 2026-11-25
commits: 3
plan_head_before: b99004a7ace73e7f1229d124c905493e603ba598
plan_head_after: 49b3d4ca7d1df853b3eaaa4730ab55250d7d08fb
actuals:
  tokens: 17000
  tasks: 3
  commits: 3
---

# Phase 15 Plan 01: Scanner read model and tracer Summary

**One VALUE_CANDIDATE receipt now travels from PostgreSQL through a single-statement window query and `GET /value/scanner` into a server-rendered `/scanner` page with its stored edge and EV strings unchanged; selection, window, ordering, truncation, summary, timezone, no-N+1 and access semantics are pinned by 18 integration tests on a real database.**

## What was built

- **Domain** (`packages/domain/src/value/scanner.ts`, exported from the barrel): `SCANNER_FRESHNESS_V1` (6 h / 24 h), `SCANNER_WINDOW_DAYS` (7), `SCANNER_LIMIT` (200), `SCANNER_MARKET_ORDER`, `SCANNER_SELECTION_ORDER`, `classifyOddsFreshness`, and the `ScannerItem` / `ScannerResponse` types.
- **API** (`scanner.service.ts`, `scanner.controller.ts`, `value.module.ts`): `createPrismaScannerRepository` runs one `$queryRaw` statement (DISTINCT ON latest-per-triple with NOT EXISTS supersession guard, VALUE_CANDIDATE filter only after the latest choice, fixture-boundary truncation, bound Date window, `AT TIME ZONE 'UTC'`, int casts, three receipt JSON paths plus the odds `capturedAt` only). `loadScanner` maps rows to the DTO with an injectable clock; `getScanner` maps failures to typed `DATABASE_UNAVAILABLE` / `SCANNER_READ_FAILED`; `ScannerController` is guarded by `EligibilityGuard`, sends `Cache-Control: private, no-store, max-age=0` and refuses any query key with `INVALID_SCANNER_QUERY`.
- **Web** (`apps/web/app/scanner/page.tsx`): force-dynamic server component with a no-store, redirect-manual, 10 s timeout fetch; thin tracer body (Plan 15-03 replaces it).
- **Tests**: `tests/helpers/scanner-seed.ts` (fixture, forecast, odds, receipt inserts with control of kickoff/status/kind/state/origin/issuedAt/submittedAt/source/createdAt/supersession/outcome/reasons/verbatim strings) and `tests/integration/scanner-api.test.ts`.

## Task commits

1. Task 1 (tracer): `e4347fd` feat(15-01): tracer slice of the 7-day value scanner
2. Task 2: `f1eddbf` test(15-01): selection, window, ordering and freshness-flag semantics
3. Task 3: `49b3d4c` test(15-01): summary, truncation, parity, timezone, single statement, access

## Verification

- `pnpm exec vitest run --project integration tests/integration/scanner-api.test.ts`: 18 passed (tracer, 10 `selection:` cases, 2 `truncation`, `summary`, `parity`, `no N+1`, `timezone`, `access`), none skipped, on a disposable `postgres:18-alpine` container removed afterwards.
- `pnpm --filter @bet-stats/domain build` and `pnpm --filter @bet-stats/api typecheck`: clean. `tsc --noEmit` in `apps/web`: clean. `eslint` in `apps/api`, `packages/domain` and on the web page: clean.
- `tests/unit/clv-evaluation-only.test.ts` (13) and `tests/unit/responsible-copy.test.ts` (12): green.
- No file under `packages/database/prisma`, no `package.json` and no `pnpm-lock.yaml` changed.

## Deviations from Plan

None in behaviour. Notes:

- The plan asked for "at least 17" tests; there are 18 because the truncation case is split into a limit-parameter test (repository level) and an endpoint cap test (210 candidates, 198 listed, `truncated` true).
- The `ForecastSnapshot_publication_check` constraint allows `issuedAt` only on ISSUED snapshots, so the "newer non-ISSUED snapshot" case in `forecastNewerAvailable` carries `issuedAt = NULL`; the `state = 'ISSUED'` predicate is therefore backed by the constraint rather than exercised independently. The helper enforces the constraint.
- The ordering test proves "never by edge" by repricing one odds book per receipt (bisection on the in-memory Phase 14 builders) so the stored edge strictly descends in one run and strictly ascends in the other, then asserting the same item order both times.

## Known Stubs

- `apps/web/app/scanner/page.tsx`: intentionally thin tracer body (plain list, no freshness grouping, no states beyond neutral unavailable). Plan 15-03 rewrites it while keeping the default export, `force-dynamic` and the no-store fetch.

## Threat Flags

None beyond the plan's threat model (T-15-01..T-15-07 mitigated: bound parameters only, no receipt JSON in the DTO, `EligibilityGuard`, typed error codes, UTC-safe reads, `generatedAt` plus no-store).

## Self-Check: PASSED

- Files exist: scanner.ts, scanner.service.ts, scanner.controller.ts, page.tsx, scanner-seed.ts, scanner-api.test.ts, this SUMMARY.
- Commits `e4347fd`, `f1eddbf`, `49b3d4c` are ancestors of HEAD.
