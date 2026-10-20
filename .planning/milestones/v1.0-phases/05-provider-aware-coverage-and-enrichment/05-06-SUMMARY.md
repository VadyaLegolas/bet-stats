---
phase: 05-provider-aware-coverage-and-enrichment
plan: 06
subsystem: api
tags: [forecast, comparison, nestjs, immutable-receipts, availability]
requires:
  - phase: 05-02
    provides: durable provider route/admission reasons
provides:
  - Exact immutable forecast pair comparison with server-calculated semantic deltas
  - Strict private no-store comparison API
  - Fixed-order snapshot-kind availability with explicit absence reasons
affects: [05-07, 05-08, forecast-workbench]
actuals:
  tokens: 6000
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [exact-pair server authority, fixed-order honest availability, progressive receipt projection]
key-files:
  created: [packages/domain/src/forecast/comparison.ts, apps/api/src/modules/forecasts/forecast-comparison.service.ts, tests/unit/forecast-comparison.test.ts, tests/integration/forecast-comparison-api.test.ts]
  modified: [packages/domain/src/forecast/contract.ts, apps/api/src/modules/forecasts/forecasts.controller.ts, apps/api/src/modules/forecasts/forecasts.module.ts]
key-decisions:
  - "Phase 05: Forecast comparison validates both requested IDs, ISSUED state and fixture ownership before calculating any delta."
  - "Phase 05: Availability always projects INITIAL, PRE_MATCH and LINEUP_CONFIRMED in fixed order, with exact receipts or closed reason codes."
patterns-established:
  - "Comparison never selects latest; exact IDs are returned intact with server-calculated deltas."
  - "Availability receipts expose only ID, revision, cutoff, source count and official lineup identity."
requirements-completed: [PROV-06]
coverage:
  - id: D1
    description: Exact issued same-fixture pairs return deterministic semantic deltas without substitution.
    requirement: PROV-06
    verification:
      - kind: unit
        ref: tests/unit/forecast-comparison.test.ts
        status: pass
      - kind: integration
        ref: tests/integration/forecast-comparison-api.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: All snapshot kinds are fixed-order exact receipts or explicit reason-coded absences.
    requirement: PROV-06
    verification:
      - kind: integration
        ref: tests/integration/forecast-comparison-api.test.ts#projects every fixed snapshot kind
        status: pass
    human_judgment: false
duration: 8min
completed: 2026-09-12
status: complete
---

# Phase 05 Plan 06: Forecast Comparison Summary

**Server-authoritative exact forecast-pair deltas and fixed-order honest snapshot availability through guarded private no-store endpoints**

## Performance

- **Duration:** 8 min
- **Started:** 2026-09-12T16:34:00Z
- **Completed:** 2026-09-12T16:42:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added strict exact-pair validation for missing, non-issued and cross-fixture snapshot IDs.
- Calculated cutoff, source, expected-goals, bounded-adjustment, confidence, limitation and stable market/selection probability deltas on the server.
- Added fixed INITIAL/PRE_MATCH/LINEUP_CONFIRMED availability projection with exact compact receipts or explicit capability, budget, provider, lineup or evidence reasons.
- Registered guarded comparison and availability routes with private no-store response policy.

## Task Commits

1. **Task 1 RED: exact comparison/API witnesses** — `e77b7fd`
2. **Task 1 GREEN: exact issued pair comparison** — `989e374`
3. **Task 2 RED: strict availability DTO witness** — `9736f19`
4. **Task 2 GREEN: honest snapshot-kind availability** — `e3b23bd`

## Files Created/Modified

- `packages/domain/src/forecast/comparison.ts` — Strict requests, deterministic deltas and availability projection/parser.
- `packages/domain/src/forecast/contract.ts` — Availability receipt and entry DTOs.
- `apps/api/src/modules/forecasts/forecast-comparison.service.ts` — Exact snapshot loading, safe validation and durable absence reasoning.
- `apps/api/src/modules/forecasts/forecasts.controller.ts` — Guarded no-store compare and availability routes.
- `apps/api/src/modules/forecasts/forecasts.module.ts` — Comparison service registration.
- `tests/unit/forecast-comparison.test.ts` — Stable delta order, strict request and availability tests.
- `tests/integration/forecast-comparison-api.test.ts` — Safe code, exact query and zero-to-three availability matrix witnesses.

## Decisions Made

- Comparison IDs are mandatory, distinct and never substituted with a newer revision.
- Source deltas use stable source receipt identities; all numeric changes use right-minus-left semantics and explicit direction.
- Availability omits full forecast contents and returns a compact allowlisted receipt for progressive loading.

## Deviations from Plan

None - plan executed as specified.

## Issues Encountered

- The root `pnpm exec` shim intermittently did not resolve Vitest while another workspace operation was active. The exact installed Vitest 4.1.11 entry point was executed directly under Node 24; test selection and projects matched the planned commands.

## User Setup Required

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: authenticated-read-endpoints | `apps/api/src/modules/forecasts/forecasts.controller.ts` | Adds guarded comparison and availability GET routes; both return allowlisted DTOs with private no-store caching. |

## Next Phase Readiness

- Plan 05-07 can build stable URL-driven selectors and accessible delta presentation directly on these exact-pair DTOs.
- No live credentials or mutable latest-snapshot behavior are required.

## Self-Check: PASSED

- All eight planned files exist.
- Commits `e77b7fd`, `989e374`, `9736f19`, and `e3b23bd` exist.
- Unit tests passed 3/3, integration tests passed 8/8, and domain/API typechecks passed under Node 24.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-12*
