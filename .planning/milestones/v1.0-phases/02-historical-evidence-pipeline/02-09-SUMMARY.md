---
phase: 02-historical-evidence-pipeline
plan: 09
subsystem: api
tags: [nestjs, evidence, replay, operator-guard, bitemporal]
requires:
  - phase: 02-08
    provides: published cutoff-safe evidence builds and reproducible receipts
provides:
  - public cutoff-aware team evidence projection with no-store semantics
  - operator-protected bounded replay preview, confirmation, and status endpoints
affects: [02-10, evidence-ui, replay-operations]
actuals:
  tokens: 6572
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [published-build-only reads, strict cutoff echo, server-derived replay controls]
key-files:
  created:
    - apps/api/src/modules/evidence/evidence.controller.ts
    - apps/api/src/modules/evidence/evidence.service.ts
    - apps/api/src/modules/replay/replay.controller.ts
    - apps/api/src/modules/replay/replay.service.ts
  modified:
    - apps/api/src/app.module.ts
    - tests/integration/phase-01-security.test.ts
key-decisions:
  - "Evidence queries require an explicit parseable instant, echo the original request, and select only published builds at or before its normalized UTC value."
  - "Replay callers choose only allowlisted domain inputs; lane, logical identities, headroom, and safe status projections remain server-derived."
patterns-established:
  - "Public historical evidence preserves nullable provenance and explicit COMPLETE, LIMITED, PENDING, FRESH, STALE, and UNAVAILABLE states."
  - "Internal replay routes reuse OperatorGuard and never expose raw worker errors, secrets, queue names, or arbitrary URLs."
requirements-completed: [PIPE-05, PIPE-06, PIPE-07, PIPE-08]
coverage:
  - id: D1
    description: "Team evidence is resolved from a published build at an exact requested cutoff with honest coverage, provenance, limitations, and freshness."
    requirement: PIPE-07
    verification:
      - kind: integration
        ref: "tests/integration/evidence-api.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Replay preview, confirmation, duplicate freezing, forced revisions, and classified status are bounded and operator-protected."
    requirement: PIPE-05
    verification:
      - kind: integration
        ref: "tests/integration/replay.test.ts"
        status: pass
      - kind: integration
        ref: "tests/integration/phase-01-security.test.ts"
        status: pass
    human_judgment: false
duration: 7min
completed: 2026-08-30
status: complete
---

# Phase 02 Plan 09: Cutoff-Aware Evidence and Protected Replay API Summary

**Nest endpoints now serve published time-correct team evidence and bounded operator-only replay operations without exposing forecast fields, secrets, or worker controls.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-30T06:13:00Z
- **Completed:** 2026-08-30T06:20:15Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added `GET /teams/:teamId/evidence?asOf=` with strict instant validation, original/UTC cutoff echo, published-build-only selection, no-store response semantics, and complete coverage/provenance projection.
- Kept zero, limited, stale, pending, and missing-provenance states distinct while preserving `null` source timestamps and excluding forecast, odds, and betting fields.
- Added operator-guarded replay preview, queue, and status routes with server allowlists, bounded UTC windows, optimistic preview versions, duplicate freezing, forced-revision reasons, and classified provider health.

## Task Commits

1. **Task 1 RED: Define cutoff-aware evidence API contract** - `6933e60` (test)
2. **Task 1 GREEN: Serve published evidence at the requested cutoff** - `6842d3b` (feat)
3. **Task 2 RED: Define protected replay API contract** - `85ff635` (test)
4. **Task 2 GREEN: Expose bounded replay operations** - `b607b1d` (feat)

## Files Created/Modified

- `apps/api/src/modules/evidence/evidence.controller.ts` - Public no-store team evidence route.
- `apps/api/src/modules/evidence/evidence.service.ts` - Strict cutoff parsing, published build selection, receipt/component projection, and state classification.
- `apps/api/src/modules/replay/replay.controller.ts` - Operator-guarded preview, queue, and status routes.
- `apps/api/src/modules/replay/replay.service.ts` - Server-bounded replay validation, preview versioning, confirmation freezing, and safe status projection.
- `apps/api/src/app.module.ts` - Registers evidence and replay controllers/services.
- `tests/integration/evidence-api.test.ts` - Full/limited/zero/stale/pending/provenance/post-cutoff cases.
- `tests/integration/replay.test.ts` - Protected preview, stale, duplicate, zero-headroom, forced-revision, and status cases.
- `tests/integration/phase-01-security.test.ts` - Retains still-applicable provider and betting deny-list checks after Phase 2 ingestion expansion.

## Decisions Made

- A missing published build is projected as `PENDING` instead of falling back to current evidence.
- Evidence freshness is evaluated relative to the requested cutoff; missing publication time remains `UNAVAILABLE`.
- Replay preview identity includes normalized allowlisted inputs and server-derived logical jobs; browser input cannot choose a URL, queue, or lane.
- Replay status uses a safe DTO allowlist with classified circuit/quota values and no raw exception surface.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Narrowed an obsolete Phase 1 security deny-list**
- **Found during:** Task 2 verification
- **Issue:** The inherited test still prohibited `results` and `standings`, which Phase 2 plans 02-05 and 02-06 intentionally introduced.
- **Fix:** Removed only those now-authorized terms while retaining prohibitions on alternate providers, lineups, injuries, bookmaker execution, and wagering.
- **Files modified:** `tests/integration/phase-01-security.test.ts`
- **Verification:** Replay and inherited security suites pass together (13/13).
- **Committed in:** `b607b1d`

---

**Total deviations:** 1 auto-fixed (1 Rule 3)
**Impact on plan:** The change restores the intended inherited security boundary without weakening still-applicable prohibitions.

## Issues Encountered

- The repository's root executable shim for Vitest is absent. Verification used the pinned installed `vitest.mjs`, matching the established Phase 02-08 workaround.
- The active shell runs Node 25 while the repository targets Node 24; scoped TypeScript and integration checks pass, with pnpm emitting only the existing engine warning.

## Known Stubs

None.

## Verification

- Evidence, replay, and inherited security suites: 3 files, 17 tests passed.
- `@bet-stats/api` typecheck passed.
- `git diff --check dd9aa70..HEAD` passed.

## User Setup Required

None.

## Next Phase Readiness

- Plan 02-10 can consume stable evidence and replay API contracts from the Next.js evidence and operations views.
- No implementation blocker remains for the API/UI handoff.

## Self-Check: PASSED

- All eight listed implementation and test files exist.
- Commits `6933e60`, `6842d3b`, `85ff635`, and `b607b1d` exist in repository history.
- Fresh targeted integration and scoped TypeScript verification passed.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-30*
