---
phase: quick-261016-nbo
plan: 01
subsystem: api
tags: [evidence, nestjs, prisma, display-enrichment, nextjs, tdd, heading-contract, fixtureId]

# Dependency graph
requires:
  - phase: quick-261016-d9t
    provides: Windowed fixture data and results-sync so real fixtures with names/kickoffs exist in the dev DB for the live enrichment gate
provides:
  - "GET /teams/{teamId}/evidence enriched with nullable display entities: team {id,name} and fixture {id,name,kickoff} (typed Prisma selects only, best-effort degradation to null, unknown team still 200 with team null, projection fields deep-equal to before)"
  - "Optional fixtureId query param on the evidence controller (trimmed, empty→absent, no fixture lookup issued when absent)"
  - "Web evidence page: id-free h1 rendered exclusively from evidenceHeading(team name) — two possible Russian strings — plus fixtureId forwarding to the internal-api fetch and effect deps"
  - "Two new unit test files (RED first): tests/unit/evidence-display.test.ts (9 cases) and tests/unit/evidence-page-heading.test.ts (3 cases)"
affects: [evidence-endpoint, team-evidence-page, internal-api-proxy, verification]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 4465
  tasks: 3
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Display enrichment as pure helpers (attachEvidenceDisplay / loadEvidenceDisplay / composeFixtureDisplay) above the service class, individually try/wrapped per lookup so a DB failure can never fail an evidence read"
    - "EvidenceService.get ordering: resolveTeamEvidence (contract validation) first, display lookup second — invalid input fails before any display query runs"
    - "Headings composed only through an exported pure evidenceHeading(teamName) helper — the sole input to the h1, unit-tested, no id fallback chain"

key-files:
  created:
    - tests/unit/evidence-display.test.ts
    - tests/unit/evidence-page-heading.test.ts
  modified:
    - apps/api/src/modules/evidence/evidence.service.ts
    - apps/api/src/modules/evidence/evidence.controller.ts
    - apps/web/app/teams/[teamId]/evidence/page.tsx

key-decisions:
  - "Fixture display name uses the product convention `${home} против ${away}` (fixtures page line 111, fixture h1 line 23) — the brief's em-dash join was an assumption and deliberately NOT used; the fixtures module returns the two names separately and has no joined-name helper."
  - "Enrichment queries are explicit Prisma findUnique selects restricted to id/name/kickoff (never full-row selects); ids appear only in parameterized where clauses; unknown ids degrade to null with 200 instead of an error oracle."
  - "displayLookup() returns null exactly when this.database is null — the unit-covered degradation path for environments without DATABASE_URL."

patterns-established:
  - "Nullable display entities appended to a projection DTO via pure spread (attachEvidenceDisplay) so domain parseEvidenceProjection tolerates them without modification."

requirements-completed: []

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Evidence endpoint returns best-effort team/fixture display enrichment (real team name, composed 'против' fixture name, ISO kickoff) while every projection field stays deep-equal and unknown ids answer 200 with nulls"
    verification:
      - kind: unit
        ref: "tests/unit/evidence-display.test.ts#attachEvidenceDisplay / loadEvidenceDisplay / composeFixtureDisplay contract (9 cases incl. null-lookup, rejecting-lookup, findFixture-never-called, parseEvidenceProjection tolerance)"
        status: pass
      - kind: other
        ref: "Live gate: throwaway API_PORT=3099 instance from fresh dist — probe 200 team:null/fixture:null, ENRICH_OK team='Borussia Dortmund' fixture='Borussia Dortmund против SV Werder Bremen' kickoff=2026-10-09T18:30:00.000Z, NULL_OK without fixtureId; process killed afterwards"
        status: pass
    human_judgment: false
  - id: D2
    description: "Evidence controller accepts optional fixtureId query param (trimmed, empty treated as absent) and threads it into the service"
    verification:
      - kind: unit
        ref: "tests/unit/evidence-display.test.ts#never touches findFixture when fixtureId is absent, empty or whitespace-only"
        status: pass
      - kind: other
        ref: "Live gate: ?fixtureId=<real id> returns fixture object; omitting it returns fixture null on the same :3099 instance"
        status: pass
    human_judgment: false
  - id: D3
    description: "Web evidence page h1 renders exactly '<team name>: исторические доказательства' or plain 'Исторические доказательства' — no id can reach any heading; page forwards fixtureId to the internal-api fetch"
    verification:
      - kind: unit
        ref: "tests/unit/evidence-page-heading.test.ts#evidenceHeading name/plain/trim contract (3 cases, RED first)"
        status: pass
    human_judgment: true
    rationale: "The plan's Task 3 human-check requires opening http://localhost:3000/teams/<id>/evidence?asOf=...&fixtureId=... in a browser to confirm no cuid appears in any heading in both stack states (old-dist plain heading now; named heading after the orchestrator restarts the stack); automation covers the helper contract, not the rendered DOM."
  - id: D4
    description: "Exactly one atomic commit containing only the five planned files; stack never restarted; no integration/e2e suite run"
    verification:
      - kind: other
        ref: "git show --name-only HEAD Compare-Object gate = exactly the 5 planned paths; NO_DELETIONS check; unit project 281/281, web+api typecheck exit 0"
        status: pass
    human_judgment: false

# Metrics
duration: 19min
completed: 2026-10-16
status: complete
---

# Phase quick-261016-nbo: Evidence Page Team Name Summary

**Evidence endpoint now carries nullable team/fixture display entities (typed Prisma selects, never-failing best-effort enrichment, optional fixtureId param) and the web page renders an id-free Russian heading exclusively from evidenceHeading(team name), with fixtureId forwarded to the fetch**

## Performance

- **Duration:** 19 min
- **Started:** 2026-10-16T15:14Z
- **Completed:** 2026-10-16T15:34Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- RED→GREEN TDD on both new test files: `tests/unit/evidence-display.test.ts` failed first run with 9/9 `... is not a function` (missing display exports), then went green after the helpers were added (9/9); `tests/unit/evidence-page-heading.test.ts` failed 3/3 first, green after the page export (3/3). `resolveTeamEvidence` untouched; at the RED→GREEN boundary `EvidenceService.get` and the controller were still byte-unchanged.
- `EvidenceService.get(teamId, asOf, fixtureId)` composes projection first, display second (`loadEvidenceDisplay(this.displayLookup(), …)` → `attachEvidenceDisplay`); `displayLookup()` returns null without `DATABASE_URL`, each Prisma lookup is individually try/wrapped so enrichment failure degrades to `{team:null, fixture:null}` and can never fail an evidence read.
- Controller gained `@Query("fixtureId")` (trimmed, `''` → undefined) and now returns `Promise<EvidenceResponse>`; `@Controller`/`@Get`/`Cache-Control no-store`/`asOf` param unchanged.
- Web page: `Evidence` type widened (`team`/`fixture` nullable), new exported `evidenceHeading(teamName)`, fixtureId appended to the internal-api fetch and added to the effect deps, h1 is now exactly `{evidenceHeading(data.team?.name)}` — the id fallback chain (`data.team?.name ?? data.teamId ?? params.teamId`) deleted; fixture sentence and every other Russian string byte-unchanged.
- **Live gate passed** on a throwaway `API_PORT=3099` instance built from the fresh dist (main stack untouched, instance killed in `finally`): unknown team → 200 with `team:null`/`fixture:null` and full projection; real fixture → `team.name='Borussia Dortmund'`, `fixture.name='Borussia Dortmund против SV Werder Bremen'`, `fixture.kickoff='2026-10-09T18:30:00.000Z'` matching the fixture row; without `fixtureId` → explicit `fixture:null` with team still enriched.
- Full gates green: unit project **281/281 (33 files)**, `@bet-stats/web` typecheck exit 0, `@bet-stats/api` typecheck exit 0.

## Task Commits

Single atomic commit (per plan):

1. **Task 1: RED the evidence display-enrichment unit tests, GREEN with pure helpers** — `31ad67f` (test + feat, staged together with Tasks 2–3)
2. **Task 2: Wire EvidenceService.get() enrichment + fixtureId controller param, live-verify on a temporary API instance** — `31ad67f`
3. **Task 3: RED the heading contract, GREEN the web page, full gates, one atomic commit** — `31ad67f`

**Commit:** `31ad67f` `fix(evidence): show team name instead of raw id on the evidence page` — exactly 5 files: `apps/api/src/modules/evidence/evidence.controller.ts`, `apps/api/src/modules/evidence/evidence.service.ts`, `apps/web/app/teams/[teamId]/evidence/page.tsx`, `tests/unit/evidence-display.test.ts`, `tests/unit/evidence-page-heading.test.ts` (228 insertions, 10 deletions, zero deletions of tracked files).

## Files Created/Modified

- `apps/api/src/modules/evidence/evidence.service.ts` - New display surface between `resolveTeamEvidence` and the service class: `EvidenceDisplayTeam/Fixture/FixtureRow/Display`, `EvidenceResponse`, `EvidenceDisplayLookup`, `attachEvidenceDisplay` (pure spread), `composeFixtureDisplay` (`` `${home} против ${away}` `` + `kickoffUtc.toISOString()`), `loadEvidenceDisplay` (null-lookup short-circuit, per-lookup try/catch, fixtureId trim); `EvidenceService.get` reworked to projection→display order with `displayLookup()` Prisma adapter (typed selects only).
- `apps/api/src/modules/evidence/evidence.controller.ts` - Third param `@Query("fixtureId") fixtureId?: string`, passed as `fixtureId?.trim() || undefined`; return type `Promise<EvidenceResponse>` (type import switched from `EvidenceProjection`).
- `apps/web/app/teams/[teamId]/evidence/page.tsx` - `Evidence.team`/`Evidence.fixture` widened to `| null`; exported `evidenceHeading(teamName)`; fixtureId appended to the evidence fetch URL and effect deps; h1 renders `evidenceHeading(data.team?.name)` — id fallback chain removed; fixture sentence byte-identical.
- `tests/unit/evidence-display.test.ts` - New: 9 cases covering attach (key set, no mutation, verbatim entities, projection deep-equality), load (null lookup, hit/miss team, fixtureId absent/empty/whitespace never calls findFixture, Prisma-shaped row mapping, rejecting lookup degradation, domain parse tolerance) and composeFixtureDisplay.
- `tests/unit/evidence-page-heading.test.ts` - New: 3 cases pinning the exact named/plain/trimmed heading contract.

## Decisions Made

- Fixture name join is `"против"` (product convention from fixtures page/h1/e2e) rather than the brief's em-dash assumption.
- Display enrichment runs strictly after `resolveTeamEvidence`, so `INVALID_AS_OF`/`INVALID_TEAM_ID`/`UNPUBLISHED_BUILD`/`POST_CUTOFF_BUILD` contract errors still fail before any display query is issued.
- Test imports `parseEvidenceProjection` via the repo-relative path `../../packages/domain/src/index.js` — the vitest `unit` project declares no `@bet-stats/*` aliases (only the `integration` project does), and this matches every existing unit test's style; assertion content is unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Non-sorted expectation in the new display test**
- **Found during:** Task 1 (RED→GREEN)
- **Issue:** `expect(Object.keys(result).sort()).toEqual([...baseKeys, "fixture", "team"])` compared a sorted array against an unsorted literal — the assertion itself was wrong, not the implementation.
- **Fix:** Sort the expected literal as well (`.sort()`), keeping the exact full key-set pin the plan requires.
- **Files modified:** tests/unit/evidence-display.test.ts
- **Verification:** 9/9 green afterwards; key-set equality still asserted exactly (projection keys + fixture + team).
- **Committed in:** `31ad67f`

---

**Total deviations:** 1 auto-fixed (1 bug — test-side assertion only)
**Impact on plan:** No product-code deviation; all six must-have truths verified by gates.

## Issues Encountered

- **Live-gate script harness issues (no code impact):** PowerShell's automatic read-only `$HOME` variable collided with a local `$home`; `curl.exe` UTF-8 output was decoded with the OEM console codepage (mojibake in Cyrillic comparisons — fixed with `[Console]::OutputEncoding = UTF8` and a char-code-built "против" literal); pwsh `ConvertFrom-Json` coerces ISO strings to `DateTime` and culture round-tripping corrupted comparisons (fixed by comparing raw JSON strings). All resolved before the gate passed; the gate itself then passed cleanly on one run.
- No test iteration beyond the single assertion fix: both RED runs failed exactly on the missing exports, both GREEN runs passed on the first implementation.

## TDD Gate Compliance

- RED commit gate: N/A for this quick task's single-commit constraint — the plan explicitly required **one atomic commit**. RED was genuinely observed pre-change for both test files (evidence-display: 9/9 `is not a function`; evidence-page-heading: 3/3 `evidenceHeading is not a function`), failure output captured, then folded into the single `fix(evidence)` commit. No bypass occurred.

## Threat Flags

None — no new surface beyond the plan's `<threat_model>` (fixtureId reaches two parameterized `findUnique` reads with explicit selects; enrichment failure cannot fail the read; heading has a single id-free input path).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Stack restart pending (orchestrator's action):** `http://127.0.0.1:3001` still serves the **old dist** (probe shows no `team`/`fixture` keys) — the observed process is plain `node dist/main.js` from before the build and the no-restart rule forbade touching it. `apps/api/dist` was rebuilt with the new code and takes effect at the next orchestrator restart.
- **Human check outstanding (plan Task 3 human-check):** with hot-reload the h1 at `http://localhost:3000/teams/<teamId>/evidence?asOf=<kickoff>&fixtureId=<fixtureId>` immediately shows plain `Исторические доказательства` (no cuid — the old API returns no team); after the stack restart it becomes `<Team Name>: исторические доказательства` with the fixture sentence activating. In neither state may any heading contain a raw id.
- Out of scope and untouched: `packages/domain`, `packages/database` schema/generated, `workers/data-sync`, `apps/web/app/internal-api/**` proxy, `tests/e2e/team-evidence.spec.ts`, `.env`, ROADMAP.md. No integration/e2e suites run (replay.test.ts has 6 pre-existing failures, not a gate). Blacklisted working-tree files present before the run stayed uncommitted.

---
*Phase: quick-261016-nbo*
*Completed: 2026-10-16*

## Self-Check: PASSED

- Commit `31ad67f` found in git log; `git show --name-only` = exactly the 5 planned files (Compare-Object gate, zero deletions).
- All 5 committed source/test files and the SUMMARY file exist on disk (the `[teamId]` path verified via `Test-Path -LiteralPath` — bracket glob artifact only).
- Frontmatter carries `status: complete`.
