# Quick Task Summary: Enrich the team evidence trace table with venue/outcome/score/source

**Plan:** 261017-sqz
**Status:** complete
**Commit:** `ebd74c3` — `feat(api,web): display trace enrichment for team evidence page`

## What Changed

The «Трассировка подходящих матчей» table on `/teams/:teamId/evidence` now renders real venue, outcome, score and source values instead of always falling back to the Russian placeholder. Root cause as diagnosed in the plan: the API response had no `trace` key, so the page fell back to immutable receipt inputs, which structurally cannot carry display fields.

### API — `apps/api/src/modules/evidence/evidence.service.ts`
- New exported types `EvidenceTraceRow` (display shape) and `EvidenceResultTraceRow` (Prisma row shape).
- `EvidenceDisplayLookup` gained the optional `findResultTraceRows(fixtureIds, cutoffIso)` method; wired in `displayLookup()` via `database.resultVersion.findMany` selecting `fixtureId/effectiveAt/observedAt/homeGoals/awayGoals` plus the related `fixture.homeTeamId/awayTeamId` and `observation.provider` (model/relation names verified against `packages/database/prisma/schema.prisma`).
- New `loadEvidenceTrace(lookup, projection, teamId)`: exact-tuple-matches each receipt input (keeping duplicate fixtureIds in receipt order) against `ResultVersion` rows, derives `venue` from the team's side, `outcome` from the team perspective (WIN/DRAW/LOSS), `score` from goals, `source` from the provider. Empty receipt or missing lookup method → `[]` without calling the lookup; lookup failure or tuple mismatch → all-null display fields keeping input timestamps. The function never rejects.
- `attachEvidenceDisplay` now takes an optional 5th `trace` argument and the response object/type gains the additive `trace` key; `EvidenceService.get()` loads and passes it.
- **Hard boundary respected:** `packages/domain` untouched — `trace` is display-only and never written into the immutable receipt contract.

### Web — `apps/web/app/teams/[teamId]/evidence/page.tsx`
- `Trace` type updated to the structured shape (`venue`/`outcome`/`score`/`source`; dropped legacy `result`/`components` string fields).
- New exported pure helper `traceComponentLabels(data, fixtureId)` — collects component kinds whose `sourceRefs` contain the fixture, maps through `componentLabel()`, joins with `", "`; none → `null`.
- Trace table extracted into exported presentational `EvidenceTraceTable({ rows, fixtureLabels, components })`; page keeps its empty-state branch. Columns: «Место» (was «Стадион»: дома/в гостях), «Исход» (победа/ничья/поражение), «Счёт» (`home:away`), «Источник», «Компоненты» — all with the existing «Неизвестно» fallback for unavailable cells; `<time>` cells for effectiveAt/observedAt preserved. All UI text Russian per project conventions.
- Consulted Next.js docs under `apps/web/node_modules/next/dist/docs/` per `apps/web/AGENTS.md`; change stays within an existing `"use client"` boundary — no routing/file-convention impact.

### Tests
- `tests/unit/evidence-display.test.ts`: existing `attachEvidenceDisplay` assertions updated for the new `trace` key; new `describe("loadEvidenceTrace")` block with 8 cases (exact-tuple matching incl. duplicate fixtureIds in receipt order, HOME win/draw/loss + AWAY perspective, null goals → null outcome/score with provider kept, team-neither-side venue null with source kept, missing-row degradation, empty receipt without lookup call, missing method → `[]`, rejecting lookup → degraded rows that keep timestamps and resolve).
- `tests/unit/evidence-trace-ui.test.ts` (new, 7 cases, `renderToStaticMarkup` pattern from `scorecard-ui.test.tsx`): direct `traceComponentLabels` unit tests; HOME win / AWAY draw / LOSS / fully-null row markup assertions; explicit guard that no raw enum codes (`HOME`/`AWAY`/`WIN`/`DRAW`/`LOSS`) leak into rendered markup (test fixture ids/provider strings designed so codes cannot appear).

## Gates

| Gate | Before | After |
| --- | --- | --- |
| `pnpm test` root unit | 299 passed (35 files) | **314 passed (36 files)** |
| `pnpm --filter @bet-stats/web test` | 13 passed | **13 passed** |
| `pnpm --filter @bet-stats/web typecheck` | clean | **clean** |
| `pnpm --filter @bet-stats/api typecheck` (extra) | — | **clean** |

Commit `ebd74c3` stages exactly the 4 planned files; no deletions; `.gsd/dispatch-isolation-sentinel.json`, `.env`/`.env2` and docs not staged. Dev servers on :3000/:3001 were never restarted (hot-reload picks the change up; live verification is the orchestrator's job).

## Deviations from Plan

1. **[Rule 1 - Bug] `exactOptionalPropertyTypes` fix in page.tsx** — the web tsconfig enables `exactOptionalPropertyTypes: true`, so the first draft of `traceComponentLabels`/`EvidenceTraceTable` prop types failed typecheck when receiving `data.components`/`data.fixtureLabels` (possibly-undefined optional props from the `Evidence` DTO). Fixed by adding explicit `| undefined` to the optional prop types. No behavioral change.
2. **[Test expectation fix] Fully-null fallback count** — the initial evidence-trace-ui test expected 6 «Неизвестно» cells; a fully-null row actually has 7 (venue, outcome, score, effectiveAt, observedAt, source, components — the «Матч» column shows the raw fixtureId, not a fallback). Corrected the expectation to 7; this matches the plan's cell-rendering spec exactly.

No other deviations. No auth gates. No degraded live-data observations — the exact-tuple matching was exercised only through the lookup interface in tests (no database); live tuple-match verification against real `ResultVersion` rows belongs to the orchestrator's post-execution check.

## Known Stubs

None. Every cell is wired to real enrichment or an explicit, by-design degradation path (null display fields on lookup failure / tuple mismatch — never an error, never a placeholder stub).
