---
phase: 01-trustworthy-fixture-discovery
plan: 08
subsystem: domain
tags: [typescript, zod, freshness, data-quality, esm]
requires:
  - phase: 01-04
    provides: Fixture tracer and redacted provider-facing read path
  - phase: 01-06
    provides: Provider-independent capability, request-budget, and forecast-eligibility policies
provides:
  - Closed five-state data-quality projection with safe unknown-state fallback
  - Validated per-data-type freshness thresholds and deterministic classification
  - Strict ESM @bet-stats/domain boundary preserving all existing domain contracts
affects: [fixture-discovery, fixture-detail, provider-ingestion, web-data-state]
actuals:
  tokens: 3065
  tasks: 3
  commits: 6
tech-stack:
  added: []
  patterns: [closed-discriminated-union, fail-closed-projection, configuration-owned-freshness]
key-files:
  created: [packages/domain/package.json, packages/domain/tsconfig.json, packages/domain/src/index.ts, packages/domain/src/data-state.ts, packages/config/src/freshness.ts, tests/unit/data-state.test.ts]
  modified: [packages/config/src/index.ts, pnpm-lock.yaml]
key-decisions:
  - "Map unknown runtime states to LIMITED with a stable UNKNOWN_DATA_STATE reason and telemetry that records only the input type."
  - "Keep freshness thresholds in validated config while the provider-independent domain classifier receives only the applied threshold."
  - "Export every existing Plan 01-05/01-06 provider-independent policy from the new domain package boundary."
patterns-established:
  - "Data projections carry state, reason, provider, capture/source timestamps, applied threshold, and nullable value together."
  - "Freshness can downgrade AVAILABLE/LIMITED to STALE but never overrides UNSUPPORTED or UNRESOLVED."
requirements-completed: [DATA-07]
coverage:
  - id: D1
    description: "Exactly five explicit data states preserve provenance, null values, and fail closed for unknown runtime input."
    requirement: DATA-07
    verification:
      - kind: unit
        ref: "tests/unit/data-state.test.ts#data-state projection"
        status: pass
    human_judgment: false
  - id: D2
    description: "Validated per-data-type freshness configuration deterministically controls stale classification."
    requirement: DATA-07
    verification:
      - kind: unit
        ref: "tests/unit/data-state.test.ts#freshness configuration"
        status: pass
    human_judgment: false
  - id: D3
    description: "The strict ESM domain package exports data-state plus all existing provider-independent policies."
    requirement: DATA-07
    verification:
      - kind: other
        ref: "pnpm --filter @bet-stats/domain typecheck"
        status: pass
    human_judgment: false
duration: 6min
completed: 2026-08-28
status: complete
---

# Phase 01 Plan 08: Honest Data-State and Freshness Summary

**Closed five-state data-quality projections with validated freshness policy and a reusable ESM domain boundary**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-28T12:42:00Z
- **Completed:** 2026-08-28T12:47:23Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Encoded `AVAILABLE`, `LIMITED`, `STALE`, `UNSUPPORTED`, and `UNRESOLVED` as the only public data states, retaining provenance and null values without synthetic zeroes.
- Added safe fail-closed handling for unknown runtime states and validated freshness defaults for fixture, fixture-status, result, and lineup data.
- Published `@bet-stats/domain` without losing reconciliation, capability, request-budget, or forecast-eligibility exports introduced by earlier plans.

## Task Commits

1. **Task 1 RED: Define honest data-state projection contract** — `92ece6d` (test)
2. **Task 1 GREEN: Implement honest data-state projection** — `f07d914` (feat)
3. **Task 2 RED: Define configurable freshness behavior** — `bfa0307` (test)
4. **Task 2 GREEN: Classify freshness from validated policy** — `daea48a` (feat)
5. **Task 3: Publish shared domain package boundary** — `1d4fcb6` (chore)
6. **Task 3 correction: Register domain workspace in lockfile** — `1b5ad4f` (chore)

## Verification

- `.\\node_modules\\.bin\\vitest.cmd run data-state freshness --project unit` — 1 file, 15 tests passed.
- `pnpm --filter @bet-stats/domain typecheck` — passed.
- `pnpm typecheck` — all 7 workspace packages passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Published freshness through the config package entrypoint**
- **Found during:** Task 2
- **Issue:** Creating `freshness.ts` alone left validated policy inaccessible through the supported `@bet-stats/config` boundary.
- **Fix:** Added typed value and type re-exports from `packages/config/src/index.ts`.
- **Verification:** Config and full-workspace typechecks passed.
- **Committed in:** `daea48a`

**2. [Rule 3 - Blocking] Registered the new workspace importer in the lockfile**
- **Found during:** Task 3 overall verification
- **Issue:** Turbo reported that `packages/domain` was absent from the lockfile, weakening frozen-install reproducibility.
- **Fix:** Regenerated only the workspace lockfile offline and recorded the domain TypeScript importer.
- **Verification:** Full workspace typecheck passed without the workspace-graph warning.
- **Committed in:** `1b5ad4f`

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking)
**Impact on plan:** Both changes make the planned public package boundaries usable and reproducible; no product scope was added.

## Issues Encountered

- The plan's literal `pnpm test -- data-state --run` command is incompatible with the root Turbo script because Turbo parses `--run` as its own argument. The equivalent focused Vitest command was used and passed.
- The host is running Node 25.2.1 while the repository requests Node 24.x; pnpm emitted engine warnings, but all verification passed.

## Known Stubs

None.

## User Setup Required

None.

## Next Phase Readiness

- Fixture APIs and UI can consume one provider-independent projection carrying honest state, provenance, null semantics, and applied freshness policy.
- No blockers remain for Plan 01-10 fixture list/detail integration.

## Self-Check: PASSED

- All eight created or modified implementation/test/lock files exist.
- Commits `92ece6d`, `f07d914`, `bfa0307`, `daea48a`, `1d4fcb6`, and `1b5ad4f` exist.
- Focused unit tests and all workspace typechecks pass.

---
*Phase: 01-trustworthy-fixture-discovery*
*Completed: 2026-08-28*
