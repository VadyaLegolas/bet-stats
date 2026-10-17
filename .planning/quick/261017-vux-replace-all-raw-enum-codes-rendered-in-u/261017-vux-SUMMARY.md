---
phase: 261017-vux-replace-all-raw-enum-codes-rendered-in-u
plan: 01
subsystem: apps/web (fixture workbench, state notices, evidence page, FAQ, internal pages)
tags: [ui-copy, russian-labels, enum-mapping, pure-module]
status: complete
requires: []
provides: [central-enum-labels-module, russian-ui-labels-everywhere, fallback-contract]
affects: [apps/web]
tech-stack:
  added: []
  patterns: [pure-label-module-with-fallback, colocated-vitest-test, quota-format-precedent]
key-files:
  created:
    - apps/web/components/enum-labels.ts
    - apps/web/components/enum-labels.test.ts
  modified:
    - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
    - apps/web/components/provider-state-notice.tsx
    - apps/web/components/data-state-notice.tsx
    - apps/web/components/evidence-state-notice.tsx
    - apps/web/app/teams/[teamId]/evidence/page.tsx
    - apps/web/app/faq/page.tsx
    - apps/web/app/internal/reconciliation/page.tsx
    - apps/web/app/internal/operations/page.tsx
    - tests/unit/odds-draft-ui.test.tsx
    - tests/unit/forecast-comparison-ui.test.tsx
decisions:
  - Label module accepts strictly typed domain enums (ForecastKind/OddsMarket/OddsSelection) with raw-code fallback; string-sourced dictionaries are Record<string, string> so noUncheckedIndexedAccess yields the fallback naturally.
  - FORECAST_KINDS constant was not imported into enum-labels.ts — exhaustive Record typing provides the exhaustiveness guarantee without an unused runtime import (typecheck-clean).
  - ForecastComparisonDto probabilities rows type market/selection as plain string; localized `as OddsMarket`/`as OddsSelection` casts at the four render sites keep the label functions strictly typed (values are snapshot-derived at runtime).
actuals:
  tokens: 21000
  tasks: 3
  commits: 1
metrics:
  duration: ~40min
  completed: 2026-10-17
---

# Phase 261017-vux Plan 01: Replace raw enum codes in UI copy Summary

Central pure module `enum-labels.ts` now renders Russian labels for every forecast kind, odds market/selection, provider receipt outcome/trigger, data-state reason, evidence limitation, reconciliation method, and internal operations service/impact/incident code, with fallbacks so unknown values never render blank.

## What Was Done

- **Task 1 (tracer):** Created `apps/web/components/enum-labels.ts` (11 label functions + `MARKET_LABELS`/`SELECTION_LABELS` moved out of the workbench) and its 15-case colocated test; rewired `forecast-workbench.tsx` — snapshot selects show «по подтверждённому составу · ревизия 2 — …», absence paragraphs, availability/revision kind headings, «Вид снимка» dd, revision-delta market/selection columns and the delta conclusion («1X2 — Хозяева») all render Russian labels.
- **Task 2:** `provider-state-notice.tsx` (reason via `reasonLabel`, receipt outcome/trigger via `routeOutcomeLabel`/`routeTriggerLabel`), `data-state-notice.tsx` (`reasonLabel`), `evidence-state-notice.tsx` and the team evidence page (both render sites via `evidenceLimitationLabel` with English-sentence passthrough).
- **Task 3:** FAQ prose («первичный», «предматчевый», «по подтверждённому составу» — no raw codes in sentences), internal reconciliation method label, internal operations service state / incident impact + status; UI-copy test assertions updated; added a renderToStaticMarkup guard that a one-INITIAL-snapshot workbench renders no `PRE_MATCH`/`LINEUP_CONFIRMED` token.

## Verification

- `pnpm --filter @bet-stats/web exec vitest run components/enum-labels.test.ts` — 15/15 passed.
- `pnpm test` — unit 335/335 (38 files), web 28/28 (3 files; 13 baseline + 15 new enum-labels tests + forecast-comparison additions). No failures.
- `pnpm --filter @bet-stats/web typecheck` — exit 0.
- `pnpm --filter @bet-stats/api typecheck` — exit 0 (API untouched).
- No Docker restart, no Playwright (orchestrator verifies live).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Forecast-option label test expectation conflicted with the locked dictionary**
- **Found during:** Task 3 gate run (`pnpm test`).
- **Issue:** The plan's test line expected «По подтверждённому составу · ревизия 2 …» (capital «По»), but the verbatim dictionary value specified by the user is lowercase «по подтверждённому составу» — the same string is reused mid-sentence in prose («Нет снимка по подтверждённому составу»), so the pure function must return lowercase.
- **Fix:** Test assertion uses the lowercase dictionary value; live capitalization (if any) is CSS-level, not function-level.
- **Files modified:** tests/unit/odds-draft-ui.test.tsx.
- **Commit:** 281bf17.

**2. [Rule 3 - Build config] Wrong import depth and DTO typing for two render sites**
- **Found during:** Task 3 typecheck.
- **Issue:** (a) The plan specified `../../components/enum-labels` for the operations page ("two levels up"), but the page sits three levels deep — TS2307. (b) `ForecastComparisonDto` probabilities rows type `market`/`selection` as plain `string`, not the domain enums — TS2345 at the four delta render sites.
- **Fix:** (a) Import corrected to `../../../components/enum-labels` (matching the sibling reconciliation page). (b) Localized `as OddsMarket`/`as OddsSelection` casts at the four render sites (values are snapshot-derived, genuinely enum-typed at runtime), keeping label signatures strictly typed per plan.
- **Files modified:** apps/web/app/internal/operations/page.tsx, apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx.
- **Commit:** 281bf17.

**3. [Plan simplification] `FORECAST_KINDS` constant not imported into the label module**
- The plan asked to import `FORECAST_KINDS` from `@bet-stats/domain`, but the module only needs the *types* for exhaustive `Record` typing; importing the constant would create an unused runtime import and fail strict checks. Type-only import keeps the module runtime-dependency-free.

## Known Stubs

None — every render site in the verified inventory routes through the label module or uses prose without raw codes; no placeholder values introduced.

## Threat Flags

None — no new endpoints, auth paths, file access, or schema changes; pure presentation-layer dictionaries.
