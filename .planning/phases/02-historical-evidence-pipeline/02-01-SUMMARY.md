---
phase: 02-historical-evidence-pipeline
plan: 01
subsystem: testing
tags: [vitest, temporal-data, bullmq-contract, quota, replay, provenance]
requires:
  - phase: 01-trustworthy-fixture-discovery
    provides: [canonical identity, provider capability, durable request reservations]
provides:
  - Executable red contracts for deterministic historical pipeline jobs and atomic provenance
  - Executable red contracts for priority quota, resilience, and bounded replay
  - Executable red contracts for dual-time chronological features and cutoff-aware evidence
affects: [phase-02-production-plans, pipeline-workers, evidence-api, domain-features]
tech-stack:
  added: []
  patterns: [runtime-loaded red contracts, named missing-symbol failures, deterministic temporal witnesses]
key-files:
  created:
    - tests/integration/pipeline-jobs.test.ts
    - tests/integration/temporal-provenance.test.ts
    - tests/integration/provider-budget-order.test.ts
    - tests/integration/evidence-api.test.ts
    - tests/integration/quota-priority.test.ts
    - tests/integration/provider-resilience.test.ts
    - tests/integration/replay.test.ts
    - tests/unit/form.test.ts
    - tests/unit/chronological-features.test.ts
  modified: []
key-decisions:
  - "Wave 0 imports future Phase 2 modules at test runtime so every suite collects and reports a precise missing production symbol."
  - "Redis and queue state are exercised only as disposable coordination contracts; durable facts and provenance remain the correctness boundary."
patterns-established:
  - "Red witness pattern: catch module-resolution failure inside the test and name the exact future symbol and source file."
  - "Temporal witness pattern: assert both effectiveAt and observedAt against the cutoff, with null and limitation states preserved."
requirements-completed: [PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06, PIPE-07, PIPE-08]
coverage:
  - id: D1
    description: Wave 0 historical pipeline and provenance contracts collect with deterministic named failures
    requirement: PIPE-01
    verification:
      - kind: integration
        ref: "pnpm exec vitest run tests/integration/pipeline-jobs.test.ts tests/integration/temporal-provenance.test.ts tests/integration/provider-budget-order.test.ts tests/integration/evidence-api.test.ts"
        status: fail
    human_judgment: false
  - id: D2
    description: Wave 0 quota, resilience, replay, form, and chronology contracts collect with deterministic named failures
    requirement: PIPE-08
    verification:
      - kind: integration
        ref: "pnpm exec vitest run tests/integration/quota-priority.test.ts tests/integration/provider-resilience.test.ts tests/integration/replay.test.ts tests/unit/form.test.ts tests/unit/chronological-features.test.ts"
        status: fail
    human_judgment: false
duration: 10min
completed: 2026-08-29
status: complete
---

# Phase 02 Plan 01: Historical Evidence Pipeline Wave 0 Summary

**Twenty-three executable red witnesses now define deterministic jobs, immutable provenance, fail-closed quota and resilience, bounded replay, and leakage-safe chronological evidence before production expansion.**

## Performance

- **Duration:** 10 min
- **Completed:** 2026-08-29
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Added a reservation-to-evidence tracer covering deterministic job identity, provider construction order, atomic observation/fact persistence, and exact UTC cutoff echo.
- Added priority headroom, concurrency, reset-semantics, retry, circuit, cache, dry-run replay, stale preview, and explicit revision witnesses.
- Added pure-domain witnesses for stable ordering, dual-time eligibility, missing samples, truncated history, null source timestamps, and immutable payload receipts.

## Task Commits

1. **Task 1: Trace one result from reserved call to cutoff evidence witness** - `a43dfed` (test)
2. **Task 2: Finish Wave 0 edge, concurrency, and UI witnesses** - `9e77174` (test)

## Files Created/Modified

- `tests/integration/pipeline-jobs.test.ts` - deterministic logical identities and unique disposable queue namespaces.
- `tests/integration/temporal-provenance.test.ts` - atomic immutable observation/fact and append-only correction contracts.
- `tests/integration/provider-budget-order.test.ts` - fail-closed gates and reservation-before-provider ordering.
- `tests/integration/evidence-api.test.ts` - exact cutoff normalization/echo and no-latest-fallback behavior.
- `tests/integration/quota-priority.test.ts` - critical headroom, concurrency, zero allowance, reset, and runtime-header caps.
- `tests/integration/provider-resilience.test.ts` - bounded retries, safe dead letters, endpoint-scoped circuits, and non-authoritative cache.
- `tests/integration/replay.test.ts` - dry-run, stale preview, explicit revision, and immutable replay contracts.
- `tests/unit/form.test.ts` - actual sample sizes and stable weighted-form ordering.
- `tests/unit/chronological-features.test.ts` - dual-time cutoff, limitations, truncated history, and reproduction receipts.

## Decisions Made

- Used runtime-loaded future modules so the files compile and all 23 tests collect before production symbols exist.
- Made each failure name the exact production symbol and intended file, preventing generic harness/config failures from obscuring implementation work.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The sandbox blocked Vite child-process creation; targeted Vitest commands were rerun with approved execution outside the sandbox.
- The project currently runs Node 25 despite its Node 24 engine declaration; this did not prevent collection or alter the expected named red failures.

## Verification

- Task 1: 4 files, 8 tests collected, all failed only for named missing Phase 2 symbols in 2.57 seconds.
- Task 2: 5 files, 15 tests collected, all failed only for named missing Phase 2 symbols in 2.53 seconds.
- Combined: 9 files, 23 tests collected, all failed only for named missing Phase 2 symbols in 6.62 seconds.
- Red status is intentional for Wave 0; subsequent production plans turn these witnesses green.

## Known Stubs

None. Missing production modules are the explicit red targets of this test-only plan, not shipped stubs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 2 production plans have explicit named contracts for D-01 through D-18 behaviors covered by Plan 01.
- D-17 through D-20 browser/UI witnesses remain assigned to Plan 02 as planned.

## Self-Check: PASSED

- All nine planned test files exist.
- Task commits `a43dfed` and `9e77174` exist.
- Targeted and combined runs collected every witness and produced only expected missing-production-symbol failures.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-29*
