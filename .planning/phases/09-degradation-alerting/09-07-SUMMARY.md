---
phase: 09-degradation-alerting
plan: 07
subsystem: database, ui, testing
tags: [postgres, prisma, fingerprint, dedup, css, zoom, a11y, integration, e2e]

# Dependency graph
requires:
  - phase: 09-degradation-alerting
    provides: evaluator dedup contract (OpsAlert/OpsAlertTransition/OpsAlertDelivery, ALRT-02) and operations page alerts block (ALRT-03)
provides:
  - NUL-free alertFingerprint separator (U+001F) shared by worker, delivery-probe anchor and web dedup key
  - real-PostgreSQL dedupUpsert roundtrip suite (create, occurrence, guarded resolve, re-open)
  - CSS-only zoom-200% @ 320px reflow fix on /internal/operations
affects: [09-degradation-alerting, 10-operator-workflow]

# Actuals (#2632)
actuals:
  tokens: 32000
  tasks: 3
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Single pinned fingerprint separator constant (ALERT_FINGERPRINT_SEPARATOR = U+001F) as the one source of truth for dedup identity
    - Probe anchor fingerprint derived from alertFingerprint (no second separator literal)
    - Web in-memory dedup key mirrors the worker separator constant (documented worker-tree boundary)
    - Guarded Prisma-client paths only for OpsAlert mutations (no $executeRawUnsafe bypass of immutability triggers)
    - CSS-only adaptive overflow fix (min-width: 0 + overflow-wrap) guarded by a permanent e2e zoom case

key-files:
  created:
    - tests/integration/alerts-fingerprint.test.ts
  modified:
    - workers/data-sync/src/jobs/alerts.ts
    - workers/data-sync/src/jobs/delivery-probe.ts
    - apps/web/app/internal/operations/alerts-block.tsx
    - apps/web/app/globals.css
    - tests/unit/alerts-signals.test.ts
    - tests/unit/alerts-composition.test.ts
    - tests/e2e/operator-overview.spec.ts

key-decisions:
  - "U+001f Unit Separator as the fingerprint separator: PostgreSQL TEXT rejects only the NUL byte (0x00, error 22021); U+001F is storable and keeps fingerprints injective because signals are closed uppercase constants"
  - "No schema or migration changes; migration of stored legacy-format dev rows is out of scope (ASCII e2e seeds only, no production data)"
  - "CSS-only fix for G-09-2 constrained to measured offenders; theme-toggle touch target kept at >=44px"

requirements-completed: [ALRT-02, ALRT-03]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Evaluator dedup upsert writes real fingerprints to PostgreSQL without error 22021 (G-09-1 blocker closed)"
    requirement: ALRT-02
    verification:
      - kind: unit
        ref: "tests/unit/alerts-signals.test.ts, tests/unit/alerts-composition.test.ts (53 passed)"
        status: pass
      - kind: integration
        ref: "tests/integration/alerts-fingerprint.test.ts (3 passed on live Docker PostgreSQL 18.6)"
        status: pass
    human_judgment: false
  - id: D2
    description: "/internal/operations reflows without horizontal scroll at html zoom 200% on 320px (G-09-2 minor closed)"
    requirement: ALRT-03
    verification:
      - kind: e2e
        ref: "tests/e2e/operator-overview.spec.ts zoom-200% case (overflow 0px, desktop/mobile/zoom all green)"
        status: pass
    human_judgment: false

# Metrics
duration: 45min
completed: 2026-11-13
status: complete
---

# Phase 09: Degradation Alerting — Plan 07 Summary

**Replaced the NUL-byte fingerprint separator that blocked every evaluator alert write on live PostgreSQL (error 22021), and fixed horizontal overflow at html zoom 200% on the 320px operations view.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-11-13T07:00:00Z
- **Completed:** 2026-11-13T07:45:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- alertFingerprint now uses a single exported ALERT_FINGERPRINT_SEPARATOR (U+001F) instead of a NUL byte; dedupUpsert/create/findUnique/update by dedupFingerprint succeed on real PostgreSQL
- delivery-probe.ts derives DELIVERY_PROBE_FINGERPRINT from alertFingerprint — one separator, one source of truth; no second literal in the worker tree
- Web in-memory dedup key in alerts-block.tsx mirrors DEDUP_KEY_SEPARATOR (documented cross-tree boundary, consistency only)
- New integration suite alerts-fingerprint.test.ts proves the full roundtrip (create, occurrence count bump, guarded RESOLVED→OPEN re-open with transition) on live Docker PostgreSQL 18.6
- Zoom-200% @ 320px on /internal/operations reflows without horizontal scroll (measured overflow 49px → 0px); permanent e2e regression case added to operator-overview.spec.ts
- All guards preserved: immutable OpsAlert/OpsAlertTransition/OpsAlertDelivery tables untouched, no schema or migration changes, no new dependencies

## Task Commits

1. **Task 1: Swap fingerprint separator to U+001F across worker, probe anchor and web dedup key** — `0a03eeb` (fix)
2. **Task 2: Real-PostgreSQL integration roundtrip for dedupUpsert** — `0a03eeb` (test)
3. **Task 3: G-09-2 zoom-200% reflow fix + RED e2e case** — `0a03eeb` (fix/test)

**Plan metadata:** `531f6e9` (docs: complete plan)

## Files Created/Modified

- `workers/data-sync/src/jobs/alerts.ts` - ALERT_FINGERPRINT_SEPARATOR constant; alertFingerprint interpolates it; comments updated
- `workers/data-sync/src/jobs/delivery-probe.ts` - DELIVERY_PROBE_FINGERPRINT derived from alertFingerprint
- `apps/web/app/internal/operations/alerts-block.tsx` - DEDUP_KEY_SEPARATOR mirror for in-memory dedup key
- `apps/web/app/globals.css` - quota-counter min-width: 0 at <=480px; overflow-wrap/min-width:0 for block containers
- `tests/unit/alerts-signals.test.ts` - fingerprint helpers use the separator constant
- `tests/unit/alerts-composition.test.ts` - fingerprint helpers + hardcoded literals use the separator constant
- `tests/integration/alerts-fingerprint.test.ts` - new real-PostgreSQL dedupUpsert roundtrip suite
- `tests/e2e/operator-overview.spec.ts` - new zoom-200% reflow case at 320px

## Decisions Made

- U+001F chosen because PostgreSQL TEXT forbids only the NUL byte; signals are closed constants so injectivity holds
- No migration of stored legacy-format dev rows (ASCII e2e seeds only; no production data)
- CSS fix constrained to measured offenders; theme-toggle >=44px touch target preserved

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None beyond the two diagnosed UAT gaps (G-09-1, G-09-2), both closed by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 09 core truth ("the evaluator writes alerts to PostgreSQL") is now true on the live database; the operator view passes the zoom reflow check. Ready for /gsd-verify-work reconcile_gaps to mark G-09-1/G-09-2 resolved.

---
*Phase: 09-degradation-alerting*
*Completed: 2026-11-13*
