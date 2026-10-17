# Quick Task: Enrich the team evidence trace table with venue/outcome/score/source

## Objective

Make the «Трассировка подходящих матчей» table on `/teams/:teamId/evidence` show real venue, outcome, score and source values instead of always rendering the Russian fallback for every one of those cells.

**Root cause (verified live):** the page (`apps/web/app/teams/[teamId]/evidence/page.tsx`) expects trace rows with display fields, but the API response (`EvidenceResponse` in `apps/api/src/modules/evidence/evidence.service.ts`) has no `trace` key, so the page falls back to `data.receipt?.inputs` — which is the immutable evidence receipt contract (`EvidenceSourceRef`, exactly 6 keys, strict `hasExactKeys` validation in `packages/domain/src/evidence/contract.ts`) and structurally cannot carry venue/result/score/source/components.

**Design principle (locked):** display-only enrichment. The immutable receipt contract in `packages/domain` stays UNTOUCHED. The API computes a parallel, additive `trace` array by exact-tuple-matching each receipt input against `ResultVersion` rows (each input tuple `(fixtureId, effectiveAt, observedAt)` identifies exactly one `ResultVersion`, which carries `homeGoals`/`awayGoals`; `Fixture` carries `homeTeamId`/`awayTeamId`; `SourceObservation` carries `provider` — schema verified). Every lookup failure degrades to null display fields; the endpoint must never fail because of this enrichment.

## Tasks

### Task 1 — API: `trace` enrichment + API-side tests

**Files:**
- `apps/api/src/modules/evidence/evidence.service.ts` (edit)
- `tests/unit/evidence-display.test.ts` (edit)

**Actions:**
1. Add two exported types next to the existing display types:
   - `EvidenceTraceRow`: `{ fixtureId: string; effectiveAt: string; observedAt: string; venue: "HOME" | "AWAY" | null; outcome: "WIN" | "DRAW" | "LOSS" | null; score: { home: number; away: number } | null; source: string | null }`.
   - `EvidenceResultTraceRow`: `{ fixtureId: string; effectiveAt: Date; observedAt: Date; homeGoals: number | null; awayGoals: number | null; fixture: { homeTeamId: string; awayTeamId: string }; observation: { provider: string } }`.
2. Extend `EvidenceDisplayLookup` with an OPTIONAL method `findResultTraceRows(fixtureIds: readonly string[], cutoffIso: string): Promise<readonly EvidenceResultTraceRow[]>` (optional, exactly like the existing `findFixtures?`).
3. Wire it in `EvidenceService.displayLookup()` via Prisma: `findResultTraceRows: (fixtureIds, cutoffIso) => database.resultVersion.findMany({ where: { fixtureId: { in: [...fixtureIds] }, observedAt: { lte: new Date(cutoffIso) }, effectiveAt: { lte: new Date(cutoffIso) } }, select: { fixtureId: true, effectiveAt: true, observedAt: true, homeGoals: true, awayGoals: true, fixture: { select: { homeTeamId: true, awayTeamId: true } }, observation: { select: { provider: true } } })`. Model/relation names verified against `packages/database/prisma/schema.prisma` (`ResultVersion` → `fixture`, `observation`; `Fixture.homeTeamId/awayTeamId`; `SourceObservation.provider`).
4. New exported async function `loadEvidenceTrace(lookup: EvidenceDisplayLookup | null, projection: EvidenceProjection, teamId: string): Promise<readonly EvidenceTraceRow[]>` with these exact semantics:
   - `inputs = projection.receipt?.inputs ?? []`; if inputs are empty OR `lookup?.findResultTraceRows` is missing → return `[]` (and do NOT call the method when inputs are empty).
   - `rows = await lookup.findResultTraceRows(distinctFixtureIds, projection.resolvedAsOfUtc)`; wrap in try/catch — on throw, return the inputs mapped to rows carrying `fixtureId`/`effectiveAt`/`observedAt` from the input with ALL display fields (`venue`/`outcome`/`score`/`source`) null. The function NEVER rejects.
   - For each input, in receipt order (keep duplicate fixtureIds): find the row where `row.fixtureId === input.fixtureId && row.effectiveAt.toISOString() === input.effectiveAt && row.observedAt.toISOString() === input.observedAt`. No match → null display fields for that row (copy the input timestamps).
   - Matched row: `venue = teamId === fixture.homeTeamId ? "HOME" : teamId === fixture.awayTeamId ? "AWAY" : null`; `source = observation.provider` (always set when matched). If `venue === null` → `outcome`/`score` null. If `homeGoals === null || awayGoals === null` → `outcome` null and `score` null. Otherwise `score = { home: homeGoals, away: awayGoals }` and `outcome` from the team perspective: `venue === "HOME" ? (homeGoals > awayGoals ? "WIN" : homeGoals === awayGoals ? "DRAW" : "LOSS") : (awayGoals > homeGoals ? "WIN" : awayGoals === homeGoals ? "DRAW" : "LOSS")`.
5. `attachEvidenceDisplay(projection, team, fixture, fixtureLabels = {}, trace: readonly EvidenceTraceRow[] = [])` — response object gains the `trace` key; `EvidenceResponse` type gains `trace: readonly EvidenceTraceRow[]`.
6. `EvidenceService.get()`: `const trace = await loadEvidenceTrace(lookup, projection, teamId);` and pass it as the 5th argument to `attachEvidenceDisplay`.
7. HARD BOUNDARY: do not touch `packages/domain` — the receipt contract's strict `isStrictEvidenceSourceRef`/`hasExactKeys` validation would reject extra keys; `trace` is display-only and must never be written into the receipt.
8. Update `tests/unit/evidence-display.test.ts`:
   - Import `loadEvidenceTrace`.
   - Fix the existing `attachEvidenceDisplay` assertions for the new `trace` key: expected object gains `trace: []`, the sorted-key-set expectation gains `"trace"`, and the destructure in the second test includes `trace`.
   - New `describe("loadEvidenceTrace")` block covering: exact-tuple matching including duplicate fixtureIds in inputs (receipt order preserved); HOME win/draw/loss outcome computation and the AWAY perspective; null goals → outcome/score null but `source` still the provider; `venue` null when the team is neither side (outcome/score null, source kept); missing exact row → all-null display fields; empty receipt → `[]` with the lookup method NOT called; lookup without `findResultTraceRows` → `[]`; rejecting lookup → degraded all-null rows that keep input timestamps, and the returned promise resolves. The Prisma adapter wiring is exercised only through the lookup interface — no database.

**Verification:** `pnpm vitest run --project unit tests/unit/evidence-display.test.ts` exits 0 (updated attach tests + all new loadEvidenceTrace cases green).

### Task 2 — Web: trace table rendering + tests

**Files:**
- `apps/web/app/teams/[teamId]/evidence/page.tsx` (edit)
- `tests/unit/evidence-trace-ui.test.ts` (create)

**Actions:**
1. Per `apps/web/AGENTS.md`, consult the Next.js docs under `apps/web/node_modules/next/dist/docs/` before touching the page — this stays a client-component change (no routing/file-convention change is expected).
2. Update the `Trace` type in the page to: `{ fixtureId: string; effectiveAt?: string; observedAt?: string; venue?: "HOME" | "AWAY" | null; outcome?: "WIN" | "DRAW" | "LOSS" | null; score?: { home: number; away: number } | null; source?: string | null }` — drop the old `result`/`components` fields (components are now computed client-side).
3. New exported pure helper `traceComponentLabels(data: { components?: EvidenceProjectionDto["components"] }, fixtureId: string): string | null` — collect the component kinds whose `sourceRefs` contain the fixtureId, map each through the existing `componentLabel()` function, join with `", "`; none → `null`.
4. Extract the trace table (currently inline in the «Трассировка подходящих матчей» section) into an exported presentational component `EvidenceTraceTable({ rows, fixtureLabels, components })` rendering the same markup; the page keeps its empty-state branch and passes `trace`/`data.fixtureLabels`/`data.components` into it. Cell rendering (Russian UI text; keep the existing fallback word for every unavailable cell):
   - «Матч» column unchanged (`fixtureLabels` lookup, then raw fixtureId).
   - «Стадион» column renamed to «Место»: `row.venue === "HOME" ? "дома" : row.venue === "AWAY" ? "в гостях" : <fallback>`.
   - «Исход»: `row.outcome` → `"WIN" → "победа"`, `"DRAW" → "ничья"`, `"LOSS" → "поражение"`, else `<fallback>`.
   - «Счёт»: `row.score ? `${row.score.home}:${row.score.away}` : <fallback>`.
   - «Источник»: `row.source ?? <fallback>`.
   - «Компоненты»: `traceComponentLabels({ components }, row.fixtureId) ?? <fallback>`.
   - Keep the existing `<time>` cells for effectiveAt/observedAt with their fallbacks and row keys.
   (The literal fallback word already exists in the file — reuse it exactly as today.)
5. New `tests/unit/evidence-trace-ui.test.ts` following the `tests/unit/scorecard-ui.test.tsx` pattern (React + `renderToStaticMarkup` imported from `apps/web/node_modules`, node environment, no jsdom):
   - Direct unit tests of `traceComponentLabels`: matching fixtureId → joined Russian component labels; no matching refs → `null`; missing/empty `components` → `null`.
   - `renderToStaticMarkup(createElement(EvidenceTraceTable, {...}))` assertions: a HOME win row shows «дома»/«победа»/score like «2:1»/the provider string/the fixture label/Russian component labels; an AWAY draw row shows «в гостях»/«ничья»; a LOSS row shows «поражение»; a fully-null row shows all the Russian fallbacks; and the rendered markup contains NO raw enum codes (`HOME`/`AWAY`/`WIN`/`DRAW`/`LOSS`) — design the fixture ids/provider strings in the test data so those codes cannot leak through ids or hashes.

**Verification:** `pnpm vitest run --project unit tests/unit/evidence-trace-ui.test.ts` exits 0 and `pnpm --filter @bet-stats/web typecheck` exits 0.

### Task 3 — Gates + one atomic commit

**Files:** none new; gates + staging only.

**Actions:**
1. Full gates (all must pass, test counts must GROW, not shrink):
   - `pnpm test` at repo root (root unit project + `@bet-stats/web` tests).
   - `pnpm --filter @bet-stats/web typecheck`.
2. Commit — ONE atomic English-conventional commit, staging EXPLICIT paths only (never `git add -A`):
   - `apps/api/src/modules/evidence/evidence.service.ts`
   - `apps/web/app/teams/[teamId]/evidence/page.tsx`
   - `tests/unit/evidence-display.test.ts`
   - `tests/unit/evidence-trace-ui.test.ts`
   - Message: `feat(api,web): display trace enrichment for team evidence page`
   - Do NOT stage `.gsd/dispatch-isolation-sentinel.json`, `.env`/`.env2`, or any docs.
3. Write `.planning/quick/261017-sqz-enrich-the-evidence-trace-table-on-teams/261017-sqz-SUMMARY.md` next to this plan (what changed, test counts before/after, any degraded-match observations from live data). Do NOT commit it — the orchestrator handles docs/STATE.md in a separate commit.

**Verification:** `git show --stat HEAD` shows exactly the four staged files; `git status --porcelain` clean except intentionally-untracked planning files.

## Risks / notes

- Both dev servers (:3000 web, :3001 API) are live — NEVER restart them; live verification is the orchestrator's job after execution.
- Exact-tuple matching relies on ISO-8601 serialization equality between receipt input strings and `ResultVersion.effectiveAt/observedAt.toISOString()`. If a live tuple fails to match, that row degrades to null display fields (by design, never an error) — note any such observation in the SUMMARY.
- Duplicated fixtureIds in `receipt.inputs` are legitimate (different revisions of the same fixture); rows are matched per input, not per fixture.
- `pnpm test` currently has 299 root unit tests + 13 web tests — all stay green and the total grows.
- Never write `trace` data into the receipt or add keys to `EvidenceSourceRef`; strict receipt validation would reject it.
