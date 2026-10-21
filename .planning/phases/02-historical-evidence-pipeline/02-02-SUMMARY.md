---
phase: 02-historical-evidence-pipeline
plan: 02
subsystem: testing
tags: [playwright, browser-contracts, temporal-cutoff, replay, quota, provenance]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: [Wave 0 temporal, quota, resilience, replay, and evidence API contracts]
provides:
  - Browser-level fixture-to-cutoff evidence contracts for D-17 through D-20
  - Browser-level replay, provider uncertainty, idempotency, and secret-safe projection contracts
affects: [phase-02-evidence-ui, phase-02-replay-ui, provider-operations]
tech-stack:
  added: []
  patterns: [deterministic route stubs, named red browser contracts, fail-closed operational projections]
key-files:
  created:
    - tests/e2e/team-evidence.spec.ts
    - tests/e2e/pipeline-replay.spec.ts
  modified: []
key-decisions:
  - "Every missing UI behavior is wrapped in a named Phase 2 contract failure so Wave 0 stays red without masking requirements behind selector or timeout noise."
  - "Provider route fixtures deliberately include a secret and raw exception so the later UI must prove its projection is classified and disclosure-safe."
patterns-established:
  - "Named Playwright red contract: catch the missing locator/action and throw the exact future behavior name."
  - "Operational safety fixture: send unsafe internal fields across the stub boundary and assert they never reach rendered text."
requirements-completed: [PIPE-05, PIPE-06, PIPE-07, PIPE-08]
coverage:
  - id: D1
    description: Fixture kickoff, cutoff echo, trace, limitations, provenance, and responsible-copy browser witnesses collect deterministically
    requirement: PIPE-07
    verification:
      - kind: e2e
        ref: "tests/e2e/team-evidence.spec.ts"
        status: fail
    human_judgment: false
  - id: D2
    description: Replay preview, stale/duplicate/revision, quota uncertainty, and safe provider projection browser witnesses collect deterministically
    requirement: PIPE-06
    verification:
      - kind: e2e
        ref: "tests/e2e/pipeline-replay.spec.ts"
        status: fail
    human_judgment: false
duration: 18min
completed: 2026-08-29
status: complete
---

# Phase 02 Plan 02: Browser Evidence and Replay Witnesses Summary

**Eight deterministic Playwright red contracts now pin fixture-cutoff evidence, provenance, replay idempotency, provider uncertainty, and disclosure-safe operational states before their production UI exists.**

## Performance

- **Duration:** 18 min
- **Completed:** 2026-08-29
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added fixture-team navigation, kickoff-as-cutoff, resolved UTC echo, Back navigation, truncated history, null-with-reason, missing freshness/provenance, stable trace, and responsible-language witnesses.
- Added mandatory replay preview, stale and duplicate submission, forced revision, safe success identifiers, and existing-logical-identity witnesses.
- Added fail-closed provider reset/allowance, configured quota ceiling, already-authorized critical work, and raw exception/secret non-disclosure assertions.

## Task Commits

1. **Task 1: Scaffold the fixture-to-cutoff evidence browser witness** - `6a8ef0c` (test)
2. **Task 2: Scaffold the replay and provider-state browser witness** - `2f9e1b3` (test)

## Files Created/Modified

- `tests/e2e/team-evidence.spec.ts` - D-17 through D-20 fixture-origin, cutoff, evidence-state, provenance, and copy contracts.
- `tests/e2e/pipeline-replay.spec.ts` - protected replay lifecycle, quota uncertainty, idempotency, and safe projection contracts.

## Decisions Made

- Kept route fixtures deterministic and production-independent so the contracts collect before Plans 09/10 add the UI.
- Used explicit named contract errors for the first missing behavior in each journey, matching Plan 01's precise red-witness convention.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The generated Windows `pnpm` launcher forwarded the Playwright subcommand incorrectly (`unknown command '^test^'`), so verification invoked Playwright's checked-in CLI with Node directly.
- Sandbox process restrictions initially blocked Playwright child processes; the same repository-local verification was rerun with approved process execution.
- A two-second action timeout initially also constrained one slow page navigation. Navigation received an explicit ten-second allowance while missing UI actions retain the short timeout, preserving precise named failures.

## Verification

- Team evidence: 4 tests collected and all 4 failed only with named `Missing Phase 2 team-evidence behavior` messages.
- Pipeline replay: 4 tests collected and all 4 failed only with named `Missing Phase 2 pipeline-replay behavior` messages.
- Combined run: 8 tests collected; all 8 intentional red failures identify missing production behavior, with no raw exception, secret, compilation, server-start, or generic timeout failure.

## Known Stubs

None. Deterministic API route fixtures are test inputs; the missing production routes are the intentional targets of this Wave 0 plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Production evidence and replay plans now have browser-level acceptance witnesses for D-17 through D-20 and PIPE-05 through PIPE-08.
- Later plans should turn these named failures green without weakening the cutoff, provenance, idempotency, quota, or disclosure assertions.

## Self-Check: PASSED

- Both planned Playwright files and this summary exist.
- Task commits `6a8ef0c` and `2f9e1b3` exist in repository history.
- STATE.md and ROADMAP.md remain unchanged as required by the sequential execution assignment.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-29*
