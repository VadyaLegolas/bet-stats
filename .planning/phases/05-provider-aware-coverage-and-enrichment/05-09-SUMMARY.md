---
phase: 05-provider-aware-coverage-and-enrichment
plan: 09
subsystem: api
tags: [nestjs, operator-auth, provider-policy, probe, audit]
requires:
  - phase: 05-02
    provides: transactional exact-scope capability and append-only route receipt seams
provides:
  - OperatorGuard-protected provider-policy approval route registered in AppModule
  - Explicit non-production redacted provider-policy probe command
  - Append-only approval and rejection receipts with idempotency convergence
affects: [05-03, 05-04, 05-05, provider-operations]
actuals:
  tokens: 7753
  tasks: 3
  commits: 6
tech-stack:
  added: []
  patterns: [authenticated policy promotion, request-bound redacted probes, exact-scope rejection audit]
key-files:
  created: [scripts/provider-policy-probe.ts, apps/api/src/modules/providers/provider-policy.service.ts, apps/api/src/modules/providers/provider-policy.controller.ts, apps/api/src/modules/providers/providers.module.ts, tests/unit/provider-policy-probe.test.ts, tests/integration/provider-policy-approval.test.ts]
  modified: [.gitignore, apps/api/src/app.module.ts]
key-decisions:
  - "Phase 05: Probe artifacts remain pending and non-authoritative until promoted through the OperatorGuard-protected Nest route."
  - "Phase 05: Invalid approval evidence appends a denied route attempt for its exact scope without changing unrelated capability records."
  - "Phase 05: Approval idempotency keys converge concurrent requests to one durable decision."
patterns-established:
  - "Probe refuses production, missing opt-in and missing credentials before constructing any provider call."
  - "Approval responses expose only decision, actor, exact scope, policy version and artifact identity under private no-store caching."
requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04, PROV-05]
coverage:
  - id: D1
    description: Real AppModule exposes an authenticated exact-scope approval boundary and rejects missing credentials before mutation.
    requirement: PROV-05
    verification:
      - kind: integration
        ref: tests/integration/provider-policy-approval.test.ts#production Nest graph
        status: pass
    human_judgment: false
  - id: D2
    description: Provider probe is explicit, non-production, redacted, request-bound and non-authoritative.
    requirement: PROV-01
    verification:
      - kind: unit
        ref: tests/unit/provider-policy-probe.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Unknown, stale, mismatched, contradictory and version-conflicting approvals fail closed with exact-scope audit receipts.
    requirement: PROV-05
    verification:
      - kind: integration
        ref: tests/integration/provider-policy-approval.test.ts
        status: pass
    human_judgment: false
duration: 12min
completed: 2026-09-12
status: complete
---

# Phase 05 Plan 09: Provider Policy Approval Summary

**Authenticated provider-policy promotion through the production Nest graph, backed by redacted opt-in probes and append-only fail-closed audit receipts**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-12T16:43:00Z
- **Completed:** 2026-09-12T16:55:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Registered a real OperatorGuard-protected provider-policy approval route in AppModule with private no-store responses.
- Added a separate non-production probe that refuses unsafe invocation before network I/O and persists only allowlisted request-bound facts.
- Revalidated scope, freshness, schema, redaction, quota, coverage, disagreements and optimistic policy version server-side.
- Appended exact-scope rejection receipts and converged concurrent duplicate idempotency keys without affecting unrelated scopes.

## Task Commits

1. **Task 1 RED: production approval witness** — `9cd9c7d`
2. **Task 1 GREEN: authenticated approval graph** — `2b54032`
3. **Task 2 RED: redacted probe witnesses** — `b64dc9b`
4. **Task 2 GREEN: pending provider-policy probe** — `1be74fa`
5. **Task 3 RED: fail-closed audit witness** — `037313d`
6. **Task 3 GREEN: rejection audit and concurrency** — `3deb723`

## Files Created/Modified

- `scripts/provider-policy-probe.ts` — Explicit opt-in, bounded, request-fingerprinted provider probe.
- `apps/api/src/modules/providers/provider-policy.service.ts` — Strict promotion validation and durable approval/rejection handling.
- `apps/api/src/modules/providers/provider-policy.controller.ts` — Operator-guarded private approval route.
- `apps/api/src/modules/providers/providers.module.ts` — Production Nest registration.
- `apps/api/src/app.module.ts` — Imports ProvidersModule.
- `tests/unit/provider-policy-probe.test.ts` — Refusal, redaction, unknown and disagreement witnesses.
- `tests/integration/provider-policy-approval.test.ts` — Real HTTP/AppModule/PostgreSQL auth, approval, rejection and concurrency witnesses.

## Decisions Made

- Live observations never directly become runtime authority; the redacted artifact stays pending until authenticated approval.
- Rejections reuse provider route receipts as append-only exact-scope audit evidence and never fabricate source observations.
- Duplicate approval requests converge by idempotency key and return the prior durable decision.

## Deviations from Plan

None - plan executed as specified.

## Issues Encountered

- Workspace dependency resolution required invoking the exact installed Vitest entry point under Node 24; the planned test files and projects were executed unchanged.

## User Setup Required

- Live probe execution requires explicit `--allow-live-probe` plus `PROVIDER_CREDENTIAL`, `PROVIDER_CODE`, `COMPETITION_ID`, `SEASON_ID`, and `ENDPOINT_FAMILY` in a non-production environment.
- These values are not required for deterministic tests and were not persisted.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: authenticated-policy-write | `apps/api/src/modules/providers/provider-policy.controller.ts` | New policy mutation route protected by existing OperatorGuard and strict allowlisted response DTO. |
| threat_flag: opt-in-provider-network | `scripts/provider-policy-probe.ts` | Explicit non-production provider request with credential kept only in the outbound header and never persisted. |

## Next Phase Readiness

- Provider routing/enrichment plans can require approved exact seasonal capability rather than embedded deployment assumptions.
- Invalid or unavailable provider scope remains locally disabled without reducing authority checks for unrelated scopes.

## Self-Check: PASSED

- All eight planned source and test files exist.
- Commits `9cd9c7d`, `2b54032`, `b64dc9b`, `1be74fa`, `037313d`, and `3deb723` exist.
- HTTP integration passed 7/7, probe unit tests passed 5/5, and API/database typechecks passed under Node 24.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-12*
