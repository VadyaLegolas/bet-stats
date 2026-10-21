---
phase: 05-provider-aware-coverage-and-enrichment
plan: 01
subsystem: api
tags: [typescript, zod, api-football, provider-contract, provenance]
requires:
  - phase: 01-platform-foundation-and-trust-boundaries
    provides: Canonical external-reference identity boundaries
provides:
  - Closed provider-neutral observation registry for football-data.org and API-Football
  - Strict request-bound API-Football core adapter with sanitized classified failures
  - Deterministic provider-independent fixture candidate keys
affects: [provider-routing, reconciliation, enrichment, fixture-ingestion]
actuals:
  tokens: 9737
  tasks: 2
  commits: 5
tech-stack:
  added: []
  patterns: [strict Zod provider envelopes, injected fetch, allowlisted response headers, TDD red-green]
key-files:
  created:
    - packages/football-data/src/providers/api-football/schema.ts
    - packages/football-data/src/providers/api-football/normalize.ts
    - packages/football-data/src/providers/api-football/client.ts
    - tests/integration/api-football-provider.test.ts
  modified:
    - packages/football-data/src/provider.interface.ts
    - packages/football-data/src/index.ts
    - tests/unit/provider-contract.test.ts
key-decisions:
  - "Provider names use a closed production registry while provider IDs remain provenance-only fields."
  - "API-Football response parameters and entity league/season fields must both match the request before normalization."
  - "Only explicit rate-limit headers are retained; credentials, bodies, and arbitrary response headers never enter public errors."
patterns-established:
  - "Request-bound adapter: strict envelope parsing precedes parameter and entity identity checks."
  - "Failure taxonomy: transport/rate/5xx are fallback-eligible; request and payload violations quarantine."
requirements-completed: [PROV-01, PROV-02, PROV-03]
coverage:
  - id: D1
    description: Both production provider variants round-trip through one provider-neutral fixture contract without provider IDs defining canonical identity.
    requirement: PROV-02
    verification:
      - kind: unit
        ref: tests/unit/provider-contract.test.ts#round-trips both production providers through one strict canonical observation
        status: pass
    human_judgment: false
  - id: D2
    description: API-Football core endpoints validate exact requested league, season, and bounded window before producing observations.
    requirement: PROV-03
    verification:
      - kind: integration
        ref: tests/integration/api-football-provider.test.ts#supports request-bound leagues standings and teams envelopes
        status: pass
    human_judgment: false
  - id: D3
    description: API-Football failures are classified and sanitized without credential or arbitrary-header disclosure.
    requirement: PROV-01
    verification:
      - kind: integration
        ref: tests/integration/api-football-provider.test.ts#classifies HTTP failures without disclosing credentials
        status: pass
    human_judgment: false
duration: 25min
completed: 2026-09-12
status: complete
---

# Phase 05 Plan 01: Provider-Neutral Contract and API-Football Core Adapter Summary

**One canonical observation boundary now accepts both production providers, backed by a strict API-Football adapter with request matching, bounded payloads, and redacted failure classification.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-09-12T11:13:00Z
- **Completed:** 2026-09-12T11:38:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Promoted normalized fixtures, results, standings, and teams to a closed provider-neutral production contract.
- Added deterministic canonical fixture candidate keys that exclude provider and external IDs.
- Implemented strict `/leagues`, `/fixtures`, `/standings`, and `/teams` API-Football handling with exact request binding.
- Added fallback-versus-quarantine error classification and an explicit response-header allowlist.

## Task Commits

1. **Task 1 RED: provider-neutral invariants** - `2033374`
2. **Task 1 GREEN: provider-neutral observation contract** - `d94025b`
3. **Task 2 RED: API-Football adapter contract** - `d823787`
4. **Task 2 GREEN: strict API-Football core adapter** - `d567a07`
5. **Task 2 fix: typed error hierarchy** - `0be3d9e`

## Files Created/Modified

- `packages/football-data/src/provider.interface.ts` - Closed provider registry, strict canonical fixture parser, team observation, and provider-independent candidate key.
- `packages/football-data/src/index.ts` - Public exports for the API-Football adapter.
- `packages/football-data/src/providers/api-football/schema.ts` - Strict bounded endpoint envelopes and exact parameter comparison.
- `packages/football-data/src/providers/api-football/normalize.ts` - Provider-neutral fixture, standings, and team normalization.
- `packages/football-data/src/providers/api-football/client.ts` - Injected-fetch HTTP client, timeout, request binding, classification, and redaction.
- `tests/unit/provider-contract.test.ts` - Cross-provider deterministic contract invariants.
- `tests/integration/api-football-provider.test.ts` - Core endpoint, hostile payload, status classification, and redaction coverage.

## Decisions Made

- Kept provider identity in provenance while deriving fixture candidate identity from normalized participants and kickoff only.
- Treated malformed, unexpected, or request-mismatched payloads as quarantine failures; they are never fallback-authoritative.
- Retained only `retry-after` and documented rate-limit headers from responses.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed specialized error name typing**
- **Found during:** Task 2 final typecheck
- **Issue:** The base error's inferred literal `name` prevented a sanitized adapter-specific subclass name.
- **Fix:** Widened the base error name to `string` and used a readonly subclass override.
- **Files modified:** `packages/football-data/src/provider.interface.ts`, `packages/football-data/src/providers/api-football/client.ts`
- **Verification:** Package typecheck and integration suite pass.
- **Committed in:** `0be3d9e`

---

**Total deviations:** 1 auto-fixed bug.
**Impact on plan:** Required for TypeScript correctness; no scope expansion.

## Issues Encountered

- Existing pnpm links were incomplete. Reinstalled the exact frozen lockfile dependencies before verification; no dependency versions changed.
- The host runs Node 25.2.1 while the project declares Node 24.x. Tests and typecheck passed, but verification emitted the existing engine warning.

## User Setup Required

None - the adapter uses injected credentials and no live provider call was required by this plan.

## Next Phase Readiness

- Route policy and reconciliation plans can consume uniform provider-neutral observations and stable failure classifications.
- Credentialed live coverage and quota/reset probes remain intentionally assigned to later Phase 05 plans.

## Known Stubs

None.

## Threat Flags

None beyond the plan threat model; the new network boundary implements strict schemas, timeout, payload bounds, and sanitized errors as specified.

## Self-Check: PASSED

- All seven planned source/test files exist.
- Commits `2033374`, `d94025b`, `d823787`, `d567a07`, and `0be3d9e` exist.
- 36 targeted tests pass and `@bet-stats/football-data` typecheck passes.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-12*
