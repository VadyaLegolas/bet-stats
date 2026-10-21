---
phase: 04
slug: settlement-and-evidence-scorecard
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-09-08
---

# Phase 4 — Validation Strategy

## Test Infrastructure

| Property | Value |
|---|---|
| Framework | Vitest 4.1.11 unit/integration; Playwright Chromium production E2E |
| Config | `vitest.config.ts`, `playwright.config.ts` |
| Fast feedback | `corepack pnpm exec vitest run tests/unit --project unit` |
| PostgreSQL gate | `corepack pnpm exec vitest run tests/integration/phase-04-security.test.ts --project integration` |
| Browser gate | `corepack pnpm exec playwright test tests/e2e/evidence-scorecard.spec.ts --project=chromium` |

## Sampling Rate

- After every behavior task: run its focused automated command.
- After every wave: run all Phase 4 unit/integration files introduced up to that wave.
- Before phase verification: migrate an empty PostgreSQL database, run the full Phase 4 security matrix, typecheck/build, and run production Chromium.
- No three consecutive implementation tasks may pass without an automated behavioral witness.

## Requirement Verification Map

| Requirement | Plans | Required automated evidence | Wave 0 |
|---|---|---|---|
| EVAL-01 | 01,08,07 | five-state policy, append-only correction and retry pipeline in `settlement-policy.test.ts`, `settlement-pipeline.test.ts`, `phase-04-security.test.ts` | MISSING — Plans 01/08 create |
| EVAL-02 | 01,08,07 | exact explicit snapshot binding and no-latest counterexample | MISSING — Plans 01/08 create |
| EVAL-03 | 02,08,06,07 | golden score vectors, persisted facts and grouped API counts | MISSING — Plans 02/08/06 create |
| EVAL-04 | 03,06,07 | deterministic reliability boundaries, directions and accessible table | MISSING — Plans 03/06 create |
| EVAL-05 | 04,08,06,07 | per-candidate unit P/L list plus aggregate parity, cursor pagination | MISSING — Plans 04/08/06 create |
| EVAL-06 | 05,07,09 | distinct forecastCutoff/evaluationAsOf chronology, durable admit-persist-enqueue-reconcile-consume execution, exact scored snapshots, correction-safe current leaves and matched model comparison | MISSING — Plan 09 closes production witness |
| EVAL-07 | 03,06,07 | unavailable/limited/available gates, deterministic default cohort, no broadening | MISSING — Plans 03/06 create |
| EVAL-08 | 04,06,07 | exact closing tuple and reason-coded unavailable CLV | MISSING — Plans 04/06 create |

## PostgreSQL and Retry Matrix

- Run migrations from empty PostgreSQL before persistence claims.
- Deliver the same settlement job twice and after a forced mid-pipeline failure; assert one leaf receipt/fact per deterministic identity.
- Append a corrected `ResultVersion`; assert linked new settlement/score/value facts, immutable prior revisions, and current-leaf aggregates only.
- Attempt direct update/delete and cross-fixture/source forgery; PostgreSQL must reject them.
- Admit and persist two compatible rolling-origin plans before deterministic BullMQ enqueue; assert failed delivery reconciliation and consumer restart load the durable hash-matched plan rather than inline windows.
- Assert forecast evidence is bounded by forecastCutoff. For result truth, first filter ResultVersion rows by `observedAt <= evaluationAsOf AND effectiveAt <= evaluationAsOf`, then require one acyclic leaf inside only that historical subgraph; poison, missing, in-slice forked and malformed lineages fail closed.
- Persist v1 before the first evaluationAsOf and correcting v2 after it; assert the historical evaluation remains v1 even when v2 exists. Advance evaluationAsOf past v2; assert an immutable linked v2 evaluation revision preserves v1 scoreIds, becomes current, and keeps the matched Brier/Log Loss cohort non-empty.

## Manual-Only Verifications

None. Visual hierarchy, responsive behavior, keyboard access, canonical URL behavior and evidence parity are all covered by component or production Chromium tests.

## Sign-Off Gate

- [ ] Every requirement has a failing-then-passing behavioral witness.
- [ ] Production and rolling-origin paths share one orchestrator and pass a parity test.
- [ ] Per-candidate rows reconcile exactly to aggregate profit/stake/count.
- [ ] Default and explicit cohort URLs are deterministic and never silently broadened.
- [ ] Fresh PostgreSQL security and production Chromium gates pass.
