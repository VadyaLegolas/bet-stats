---
phase: 06-release-experience-and-operations
plan: 06
subsystem: privacy-policy
tags: [privacy, consent, retention, erasure, fail-closed, audit]
requires:
  - phase: 06-release-experience-and-operations
    provides: locked D-13 default-no-retention and D-14 one-way withdrawal contract
provides:
  - Human-approved fail-closed subject and retention configuration boundary
  - Exact one-way withdrawal deletion inventory for Plans 06-07 and 06-08
  - Explicit prohibition on invented subject mechanisms or retention policy values
affects: [06-07, 06-08, privacy-retention, consent-withdrawal]
actuals:
  tokens: 3314
  tasks: 1
  commits: 2
tech-stack:
  added: []
  patterns: [approved signed subject-provider only, fail-closed durable opt-in, unlinkable immutable analytical facts]
key-files:
  created:
    - .planning/phases/06-release-experience-and-operations/06-06-SUMMARY.md
  modified:
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
key-decisions:
  - "Approved approve-fail-closed: durable personal-history opt-in remains disabled unless an approved signed subject-provider adapter and every required retention policy value are configured."
  - "Withdrawal locks the subject boundary, revokes consent, deletes all linkable retained odds/view history, invalidates related cache, and denies future writes while leaving only unlinkable immutable analytical facts."
  - "No subject mechanism, retention duration, policy version, or effective date was supplied or may be invented."
patterns-established:
  - "Privacy configuration is fail-closed: absence of any required approved identity or policy input disables durable opt-in."
  - "Deletion targets mutable subject associations and retained personal history, never immutable analytical facts that carry no reverse link."
requirements-completed: [PRIV-01]
coverage:
  - id: D1
    description: "The exact D-14 one-way deletion inventory and fail-closed configuration seam were explicitly approved before migration or production implementation."
    requirement: PRIV-01
    verification:
      - kind: manual_procedural
        ref: "Human checkpoint response: approve-fail-closed"
        status: pass
    human_judgment: true
    rationale: "The plan intentionally required an irreversible privacy-policy decision from a human; automation cannot authorize it."
duration: 5min
completed: 2026-09-20
status: complete
---

# Phase 06 Plan 06: D-14 Fail-Closed Privacy Boundary Summary

**Human approval now binds durable opt-in and one-way consent withdrawal to an explicit fail-closed identity, retention, deletion, cache, and unlinkability contract.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-09-20T15:47:00Z
- **Completed:** 2026-09-20T15:52:00Z
- **Tasks:** 1
- **Files modified:** 4 planning files; 0 application-source files

## Accomplishments

- Recorded the human selection `approve-fail-closed` before any irreversible schema, migration, or deletion implementation.
- Established the exact deletion inventory and immutable-fact separation consumed by Plans 06-07 and 06-08.
- Preserved every unresolved policy input as explicitly absent rather than inventing a subject mechanism, duration, version, or effective date.

## Approved Boundary

The following boundary is approved exactly:

> Subject identity may come only from an approved signed subject-provider adapter; retention duration, policy version, and effective date are required configuration; missing any value disables durable opt-in; deletable subject associations and retained odds/view history remain separate from immutable analytical facts; withdrawal locks the subject boundary, revokes consent, deletes all linkable retained odds/view history, invalidates related cache, and denies future writes; logs and immutable receipts retain no reverse link. No subject mechanism, duration, version, or effective date may be invented.

### Configuration State at Approval

| Required input | Approved exact value | Consequence |
|---|---|---|
| Signed subject-provider adapter | Not supplied | Durable opt-in disabled |
| Retention duration | Not supplied | Durable opt-in disabled |
| Policy version | Not supplied | Durable opt-in disabled |
| Effective date | Not supplied | Durable opt-in disabled |

Ordinary anonymous analysis remains available. This approval does not authorize deriving identity from an IP address, cookie, user agent, session ID, correlation ID, source label, log entry, or any other implicit mechanism.

## Acceptance Evidence

| Criterion | Evidence | Result |
|---|---|---|
| One selected option is recorded | Human response: `approve-fail-closed` | PASS |
| Exact D-14 deletion inventory is approved | The approved boundary above names subject associations, retained odds/view history, cache invalidation, future-write denial, and the no-reverse-link rule | PASS |
| Exact policy values are recorded when supplied | No values were supplied; all four required inputs are explicitly recorded as absent | PASS |
| Approval precedes irreversible implementation | Plan 06-06 changes planning documents only and authorizes downstream Plans 06-07/06-08 | PASS |

## Task Commits

1. **Task 1: Record the approved one-way D-14 deletion boundary** - `aa83b1b` (docs)

## Files Created/Modified

- `.planning/phases/06-release-experience-and-operations/06-06-SUMMARY.md` - canonical approval record and acceptance evidence.
- `.planning/STATE.md` - plan position, decision history, metrics, and session state.
- `.planning/ROADMAP.md` - Phase 06 plan progress.
- `.planning/REQUIREMENTS.md` - PRIV-01 completion traceability.

No application source was modified.

## Decisions Made

- Selected `approve-fail-closed` exactly as supplied by the human checkpoint response.
- Required all four authorization inputs—approved signed subject-provider adapter, retention duration, policy version, and effective date—before durable opt-in can operate.
- Required withdrawal to serialize on the subject boundary, revoke consent, delete every linkable retained odds/view-history row, invalidate related cache, and reject future retained-history writes.
- Permitted immutable analytical facts and immutable receipts to remain only when they contain no reverse link to the subject; logs follow the same no-reverse-link rule.

## Deviations from Plan

None - plan executed exactly as written after the blocking-human decision was supplied.

## Known Stubs

None. The absent policy inputs are intentional fail-closed configuration requirements, not implementation placeholders.

## Issues Encountered

None.

## Threat Flags

No application threat surface was introduced. The documented boundary directly mitigates T-06-14 by making the human authorization and its absent inputs explicit and auditable.

## User Setup Required

Before durable personal-history opt-in may be enabled, an authorized product/legal process must supply all of the following exact values:

- an approved signed subject-provider adapter;
- a retention duration;
- a policy version;
- an effective date.

Until then, durable opt-in must remain disabled. This summary does not invent or recommend any value.

## Next Phase Readiness

- Plan 06-07 has explicit authority to implement the persistence boundary fail closed without inventing identity or retention policy inputs.
- Plan 06-08 has the exact withdrawal inventory, cache invalidation, future-write denial, and unlinkability contract to verify.

## Self-Check: PASSED

- The canonical summary, STATE, ROADMAP, and REQUIREMENTS files exist.
- Task commit `aa83b1b` exists in git history.
- The summary contains the selected `approve-fail-closed` option, every required deletion action, all four explicitly absent policy inputs, and the no-reverse-link requirement.
- The plan introduced no application-source changes; the pre-existing `apps/web/next-env.d.ts` working-tree modification was left untouched.

---
*Phase: 06-release-experience-and-operations*
*Completed: 2026-09-20*
