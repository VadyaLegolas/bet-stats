---
phase: 03-forecast-and-manual-value-workbench
plan: 09
subsystem: odds
tags: [manual-odds, validation, provenance, fixture-scope, security]
requires:
  - phase: 03-07
    provides: immutable forecast and manual-value workbench
provides:
  - bounded canonical manual-odds scalar contract
  - fixture-relative capture chronology enforcement
  - provenance-complete immutable odds identity
  - fixture-scoped non-disclosing odds retrieval
affects: [03-verification, manual-odds, value-workbench]
tech-stack:
  added: []
  patterns: [lexical-validation-before-parsing, canonical-identity-hash, compound-resource-lookup]
key-files:
  created: []
  modified:
    - packages/domain/src/odds/contract.ts
    - packages/domain/src/odds/normalize.ts
    - apps/api/src/modules/odds/odds.service.ts
    - apps/api/src/modules/odds/odds.controller.ts
    - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
    - tests/unit/forecast-value-tracer.test.ts
    - tests/integration/manual-odds-api.test.ts
    - tests/integration/manual-odds.test.ts
decisions:
  - "Manual odds accept only bounded unsigned plain decimals and canonical millisecond UTC instants."
  - "Capture time belongs to [kickoff - 30 days, kickoff) and may lead server time by at most five minutes."
  - "Odds identity hashes normalized source label, replacement lineage, versions, and ordered canonical selections."
metrics:
  duration: 14min
  completed: 2026-09-08
status: complete
actuals:
  tokens: 12804
  tasks: 3
  commits: 7
---

# Phase 03 Plan 09: Hardened Manual Odds Boundary Summary

Bounded canonical odds capture with provenance-complete identities, authoritative fixture chronology, and non-disclosing fixture-scoped retrieval.

## Performance

- **Duration:** 14 min
- **Started:** 2026-09-08T06:54:00Z
- **Completed:** 2026-09-08T07:08:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Rejects oversized, exponent, signed, whitespace, excess-scale, and non-canonical timestamp input before expensive decimal parsing or persistence.
- Canonicalizes accepted decimal strings and mirrors actionable constraints in the client workbench.
- Resolves the fixture before append and enforces every inclusive/exclusive D-09 chronology boundary with deterministic server time.
- Includes normalized source provenance and replacement lineage in immutable identity and collision comparison.
- Requires both fixture ID and snapshot ID for odds retrieval and returns the same not-found response for cross-fixture and missing IDs.

## Task Commits

1. **Task 1 RED: hostile scalar contract tests** — `9993460`
2. **Task 1 GREEN: bounded canonical parsing** — `fc80eb1`
3. **Task 2 RED: provenance and chronology tests** — `faf289d`
4. **Task 2 GREEN: complete identity and fixture chronology** — `4a71302`
5. **Task 3 RED: fixture-scoped retrieval tests** — `e2447fc`
6. **Task 3 GREEN: compound resource lookup** — `22bd9d8`
7. **Rule 1 regression fix: runtime-compatible client validation** — `a6b5dda`

## Files Created/Modified

- `packages/domain/src/odds/contract.ts` — bounded decimal grammar, canonical UTC contract, and named capture-window policy.
- `packages/domain/src/odds/normalize.ts` — returns the canonical parsed book.
- `apps/api/src/modules/odds/odds.service.ts` — fixture resolution, chronology, complete identity, collision recovery, and scoped retrieval.
- `apps/api/src/modules/odds/odds.controller.ts` — passes both route identifiers.
- `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` — mirrors server field limits and canonicalizes submitted decimals.
- `tests/unit/forecast-value-tracer.test.ts` — adversarial scalar and timestamp coverage.
- `tests/integration/manual-odds-api.test.ts` — boundary, provenance, and cross-fixture denial coverage.
- `tests/integration/manual-odds.test.ts` — PostgreSQL provenance regression (written but not run in this environment).

## Decisions Made

- Persistence-aligned decimals permit at most 128 characters, 107 integer digits, and 20 fractional digits; exponents and signs are excluded.
- Exact canonical timestamps use `YYYY-MM-DDTHH:mm:ss.sssZ`, matching the forecast receipt boundary.
- Cross-fixture odds lookup deliberately uses the same `ODDS_SNAPSHOT_NOT_FOUND` response as an absent snapshot.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved direct web-test package runtime compatibility**
- **Found during:** Overall regression verification
- **Issue:** Direct workbench tests loaded stale built package exports, making new client validation helpers undefined.
- **Fix:** Kept the mirrored client lexical validation self-contained while retaining identical limits and canonical output.
- **Files modified:** `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx`
- **Commit:** `a6b5dda`

**2. [Rule 1 - Bug] Preserved asynchronous database-unavailable behavior**
- **Found during:** Overall regression verification
- **Issue:** The new two-argument service getter threw synchronously before callers could observe a rejected promise.
- **Fix:** Kept the service getter async while delegating to fixture-scoped retrieval.
- **Files modified:** `apps/api/src/modules/odds/odds.service.ts`
- **Commit:** `a6b5dda`

## Verification

- `vitest` focused odds/domain/API regression: **51/51 passed** across 5 files.
- Domain, API, and Web TypeScript checks: **passed**.
- `tests/integration/manual-odds.test.ts`: **not run** because `DATABASE_URL` is unset and Docker Engine is unavailable; recorded in `.planning/WINDOWS.md`.

## Known Stubs

None.

## Threat Model Closure

- **T-03-09-01:** bounded lexical validation runs before `Decimal` construction.
- **T-03-09-02:** immutable identity and collision recovery use complete canonical provenance.
- **T-03-09-03:** repository lookup requires the fixture/snapshot compound relationship.

## Self-Check: PASSED

- All modified production and test files exist.
- All seven task/deviation commits exist in Git history.
- All verification available without PostgreSQL passed; the unavailable DB gate is explicitly tracked.
