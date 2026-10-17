---
phase: quick-261016-ooi
plan: 01
subsystem: api
tags: [fixtures, sync, provenance, provider-routing, freshness-badge, coverage-badge, nestjs, prisma, tdd, unit-harness]

# Dependency graph
requires:
  - phase: 05-provider-aware-coverage-and-enrichment
    provides: ProviderRouteReceipt/ProviderRouteAttempt schema, createProviderRoutingRepository and the projectProviderState projection the live manual sync must feed
  - phase: quick-261016-exf
    provides: Chunked windowed provider fetch path (one fetch per chunk, per-chunk budget reservation) that the route recording hooks onto
provides:
  - "FixtureProvenance upsert on (provider, payloadHash) moving observedAt/sourceUpdatedAt on every re-confirmation, so /fixtures dataState leaves STALE within the 6h30m threshold right after a manual refresh"
  - "Route receipt recording on every status \"synced\" league run: run-scoped FIXTURES SourceObservation + ADMITTED/PRIMARY ProviderRouteReceipt + SUCCEEDED attempt via the shared provider-routing repository, so providerState projects PRIMARY instead of PENDING"
  - "Structural no-claim guarantees: skipped, denied and failed runs return before recording; sole-source (api-football) leagues are never claimed by a football-data.org sync"
  - "New tests/unit/fixtures-sync.test.ts emulated-DB sync suite (5 cases, RED first)"
affects: [fixtures-sync, fixture-freshness-badge, provider-coverage-badge, verification]

# Actuals (#2632) — chars/4 over the realized diff (git diff acf23a3..b0ae96e = 27,282 chars).
actuals:
  tokens: 6820
  tasks: 3
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Emulated-DB service unit harness: vi.hoisted shared state + partial vi.mock keyed at the package dist entry points the service graph actually resolves (apps/api/node_modules junctions), fake FootballDataOrgClient delegating to a per-test fetchImpl, fake Prisma routing $queryRawUnsafe/$executeRawUnsafe by SQL substring"
    - "Route receipt end-state appended directly through createProviderRoutingRepository (appendRoute + appendAttempt) instead of admitAttempt/completeAttempt, mirroring the worker's durable shapes without re-gating a succeeded call"

key-files:
  created:
    - tests/unit/fixtures-sync.test.ts
  modified:
    - apps/api/src/modules/fixtures/fixtures-sync.service.ts

key-decisions:
  - "Observation payload embeds the run correlation id ({correlationId, competitionCode, dateFrom, dateTo, matches}), so the payloadHash is unique per run and observedAt truthfully equals the latest confirmation; dedupe is model-level findFirst-by-hash (worker pattern), no raw SQL."
  - "Recording lives in a private method invoked only on the status \"synced\" return path — skipped/denied/failed returns exit before it structurally (no try/catch swallowing); a recording error propagates to the sync caller exactly like persistence errors today."
  - "Sole-source guard (route.candidates.includes(PROVIDER)) returns without recording for EL/UEL/UECL/ECL, so a football-data.org sync can never claim an api-football-only league (assertRouteReceipt would reject it anyway)."
  - "Receipt id = `${route.version}:${leagueId}:${seasonId}:FIXTURES:${correlationId}` and attempt id/attemptKey = `${receiptId}:attempt:result` / `${receiptId}:result` — deterministic per run, idempotent under the repository's identity checks."

patterns-established:
  - "First vi.mock-based unit suite in tests/unit: dist-entry mock keys (../../packages/*/dist/index.js) are required because the vitest @bet-stats/* source alias applies only to test-file imports, never to the service's own resolution."

requirements-completed: []

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Re-syncing an unchanged payload upserts FixtureProvenance observedAt/sourceUpdatedAt (id/fixtureId/rawPayload untouched) with fixture.capturedAt bound as the confirmation time"
    verification:
      - kind: unit
        ref: "tests/unit/fixtures-sync.test.ts#re-confirms an unchanged payload by upserting provenance observedAt (SQL contains DO UPDATE SET for both columns, excludes id/rawPayload/payloadHash from EXCLUDED, params[3] === capturedAt, synced/skip-query/budget jobKey asserts)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A synced league records exactly one FIXTURES SourceObservation + one ADMITTED/PRIMARY receipt + one SUCCEEDED admitted attempt linked to that observation"
    verification:
      - kind: unit
        ref: "tests/unit/fixtures-sync.test.ts#records a route receipt, a SUCCEEDED attempt and a linked observation on a synced league (all receipt/attempt/observation field contracts incl. contentHash, correlationId, payloadBytes)"
        status: pass
    human_judgment: false
  - id: D3
    description: "projectProviderState over the recorded rows renders the exact badge projection: state PRIMARY, receipt.outcome SUCCEEDED, capturedAt = observation.observedAt"
    verification:
      - kind: unit
        ref: "tests/unit/fixtures-sync.test.ts#projects the recorded receipt as PRIMARY with the observation capture time (no provider fetch issued in the test)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Skipped (recent MAX observedAt, non-force) and 403-failed league syncs record no receipt, no attempt and no observation"
    verification:
      - kind: unit
        ref: "tests/unit/fixtures-sync.test.ts#records nothing when a recent observation skips the league and #records nothing when the provider call fails with 403 (fetchCalls/receipts/attempts/observations all asserted empty)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Gates green: api build + typecheck exit 0, full unit project green; budget reservations, league gates and the 6.5s spacing gate unchanged; integration/e2e not run"
    verification:
      - kind: other
        ref: "corepack pnpm --filter @bet-stats/api build = 0; typecheck = 0; corepack pnpm vitest run --project unit = 286/286 (34 files) exit 0; diff review shows skip gate/budget jobKey/spacing gate untouched and no workers/data-sync, apps/web, packages/domain, ROADMAP.md in the diff"
        status: pass
    human_judgment: false

# Metrics
duration: "14m resumed segment (00:25-00:39Z) + initial segment from 2026-10-16T18:42:24Z interrupted by a rate limit after Task 1 GREEN"
completed: 2026-10-17
status: complete
---

# Phase quick-261016-ooi: Fixture Freshness and Provider Coverage Summary

**Manual sync now upserts FixtureProvenance observedAt for unchanged payloads (STALE badge clears on refresh) and records a durable FIXTURES route receipt + SUCCEEDED attempt + linked SourceObservation after every successful league sync (coverage badge leaves PENDING), proven by a 5-case emulated-DB unit suite**

## Performance

- **Started:** 2026-10-16T18:42:24Z (initial segment; interrupted by a rate limit after Task 1 GREEN)
- **Resumed:** 2026-10-17T00:25Z (Tasks 2-3 completed in ~14 min)
- **Completed:** 2026-10-17T00:39:24Z
- **Tasks:** 3
- **Files modified:** 2 (1 production, 1 new test)

## Accomplishments

- **Task 1 (RED→GREEN, initial segment):** the new suite's provenance test failed first against the `DO NOTHING` statement exactly on the missing `ON CONFLICT ("provider", "payloadHash") DO UPDATE SET` assertion, then went green after the conflict clause was changed to update only `"observedAt" = EXCLUDED."observedAt", "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt"` with a 4-line design-intent comment (freshness = how recently WE confirmed the fixture). Column list untouched: id/fixtureId/rawPayload stay insert-only.
- **Task 2 (RED→GREEN, resumed segment):** four tests appended — RED run failed `2 | 3` exactly on the two presence assertions (`harness.observations` 0 vs 1, `harness.receipts` 0 vs 1; the skip/fail absence tests pass vacuously pre-implementation by design). GREEN after implementing `recordRouteReceipt`: per-run `rawMatches` collection across the chunk loop, invocation only on the status "synced" path after the loop, `createProviderRoute` + PROVIDER-in-candidates guard, worker-mirrored receipt content (policyVersion `provider-route-policy/v1`, policyHash sha256 of the matrix version, ADMITTED/PRIMARY/capability/budget/circuit snapshots), run-scoped SourceObservation (findFirst-by-hash else create, payloadBytes = byte length), then `appendRoute` + direct `appendAttempt` (SUCCEEDED/admitted/linked observation) through `createProviderRoutingRepository`. Final targeted run: **5/5 passed (16.96s, 13.03s in tests — the intentional 6.5s spacing waits across 3 provider fetches)**.
- **Task 3 gates (all exit 0):** `@bet-stats/api` build 0, typecheck 0; full `vitest run --project unit` **286/286 across 34 files**. Diff review confirms: provenance clause updates only observedAt/sourceUpdatedAt; recording only on the synced path behind the candidates guard; skip gate, budget reservation jobKey and `waitForProviderSpacing` untouched; `workers/data-sync`, `apps/web`, `packages/domain` and ROADMAP.md absent from the diff. No integration/e2e suite run (replay.test.ts's 6 failures pre-existing at bare HEAD).
- Suite runs exactly **3 provider fetches** (success, success-recording, 403-fail) — within the plan's ≤3 cap; the 6_500 ms spacing gate was never stubbed.

## Task Commits

Single atomic commit (per plan):

1. **Task 1: RED→GREEN — re-sync refreshes FixtureProvenance.observedAt for unchanged payloads** — `b0ae96e` (staged together with Tasks 2-3)
2. **Task 2: RED→GREEN — record a provider route receipt after each successful league sync** — `b0ae96e`
3. **Task 3: Verification gates, staging discipline and one atomic commit** — `b0ae96e`

**Commit:** `b0ae96e` `fix(api): refresh fixture provenance and record route receipts on manual sync` — exactly 2 files: `apps/api/src/modules/fixtures/fixtures-sync.service.ts` (+79/−4), `tests/unit/fixtures-sync.test.ts` (new, 5 cases); total +468/−4, zero deletions of tracked files; body references 261016-ooi.

## Files Created/Modified

- `apps/api/src/modules/fixtures/fixtures-sync.service.ts` - Provenance insert now upserts `observedAt`/`sourceUpdatedAt` on `(provider, payloadHash)` conflict (plus design-intent comment); imports `createProviderRoutingRepository`, `PROVIDER_ROUTE_POLICY_VERSION`/`routeReceiptContentHash`/`ProviderRouteReceiptContent`, `createProviderRoute`; per-run `rawMatches` collected at the top of the fixture loop; new private `recordRouteReceipt(...)` called only before the status "synced" return — correlationId `manual-fixtures-sync:${code}:${runStamp}`, sole-source guard, worker-mirrored receipt content, run-scoped FIXTURES observation, `appendRoute` + `appendAttempt` with the rationale comment for bypassing admitAttempt/completeAttempt. Skip gate (MIN_SYNC_INTERVAL_MS), budget reservation (jobKey) and spacing gate byte-unchanged.
- `tests/unit/fixtures-sync.test.ts` - New 356-line emulated-DB suite: `vi.hoisted` harness state, partial `vi.mock` at the package **dist** entry points (createPrismaClient → fake db, FootballDataOrgClient → state-driven fake), env pins (`DATA_PROVIDER_MODE=live`, `DATABASE_URL`, `FOOTBALL_DATA_API_TOKEN`) with `afterAll` restore, fake Prisma with SQL-substring routing and statement/param capture, array+callback `$transaction`, and 5 tests covering the provenance upsert, receipt/attempt/observation recording, badge projection, skip-nothing and fail-nothing.

## Decisions Made

- Mock keys target `../../packages/database/dist/index.js` and `../../packages/football-data/dist/index.js` instead of `@bet-stats/*` specifiers: the service graph resolves workspace packages through `apps/api/node_modules` junctions to built dist, bypassing the vitest source alias (which applies only to test-file imports) — raw-specifier mocks never fired.
- Badge test reuses the recording test's rows (sequential execution within the file) so the suite stays at 3 fetches instead of 4.
- `observedAt` bound to the sync run instant (`now`), matching the plan's "observedAt = run instant" and the freshness semantics (time of our latest confirmation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan fact 11's `vi.mock("@bet-stats/database")` / `vi.mock("@bet-stats/football-data")` keys did not intercept the service's imports**
- **Found during:** Initial segment (harness build, via probe files)
- **Issue:** With raw `@bet-stats/*` keys the fake client/DB never received the service's calls — module resolution goes through the node_modules junctions to `packages/*/dist`, outside the vitest source alias.
- **Fix:** Mock keys retargeted to the dist entry points the service actually imports (`../../packages/database/dist/index.js`, `../../packages/football-data/dist/index.js`) with `importOriginal` partial spreads; behavioral contract of every planned assertion unchanged. All probe files deleted afterwards.
- **Files modified:** tests/unit/fixtures-sync.test.ts
- **Verification:** 5/5 green; fetch/executed-statement capture proves the fakes intercept the service path.

---

**Total deviations:** 1 auto-fixed (harness-only; zero production-code deviation)
**Impact on plan:** All five must-have truths verified by the gates; production diff is exactly the two planned behaviors.

**Note (not a deviation):** the plan's `must_haves.artifacts` said "4 cases" while `<verification>` required 5 — the delivered suite has 5 (Task 1's Test 1 + the four Task 2 tests), matching the `<behavior>` blocks and `<verification>`.

## Issues Encountered

- **Rate-limit interruption:** the initial segment was cut off after Task 1 GREEN (task files left in the tree, nothing committed); the resumed run re-read the plan/STATE/AGENTS.md, re-verified Task 1 green, and completed Tasks 2-3. No work was lost or redone beyond re-running the targeted suite once for the audit.
- **Node engine warning** (`wanted >=24 <25, current v25.2.1`) appears on every pnpm invocation — pre-existing repository-wide, non-blocking, out of scope.

## TDD Gate Compliance

- RED commit gate: N/A for this quick task's single-commit constraint — the plan explicitly required **one atomic commit**. RED was genuinely observed pre-change for both tasks (Task 1: missing `DO UPDATE SET` clause; Task 2: 2 failed / 3 passed on the two recording-presence assertions), failure output captured, then folded into the single `fix(api)` commit. No bypass occurred.

## Threat Flags

None — no surface beyond the plan's `<threat_model>`: recording writes only on the synced path behind the candidates guard (T-261016ooi-01), the upsert moves only confirmation time (T-02), ids are run-stamped and idempotent (T-03), the observation payload holds only already-persisted provider match objects plus run scope (T-04), no installs (T-SC).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Stack restart pending (orchestrator's action):** `apps/api/dist` was rebuilt with both fixes, but the running API (:3001) still serves the **old dist** — the no-restart rule forbade touching it. After the restart, one manual "Обновить матчи" refresh should (a) move FixtureProvenance.observedAt for unchanged fixtures so the dataState badge leaves STALE, and (b) write the first live FIXTURES receipt so the coverage badge shows PRIMARY instead of "Покрытие ожидается".
- Out of scope and untouched: `apps/web`, `packages/domain`, `packages/database/src` (read-only), `workers/data-sync` (its own DO NOTHING provenance insert stays), `.env`, ROADMAP.md. No integration/e2e suites run; the dev stack was never restarted and no live sync endpoint was called (all verification used the emulated DB).
- Blacklisted/pre-existing working-tree modifications (package.json, pnpm-lock.yaml, generated prisma, .planning/**, .agents/, .claude/, untracked scripts, tsconfig.json, apps/web/next-env.d.ts, infra/docker-compose.yml, .env2) stayed unstaged and uncommitted.

---
*Phase: quick-261016-ooi*
*Completed: 2026-10-17*

## Self-Check: PASSED

- Commit `b0ae96e` found in git log; `git show --name-only` = exactly the 2 planned files (Compare-Object gate empty, zero tracked-file deletions).
- Both committed code files and this SUMMARY file exist on disk; targeted suite 5/5, unit project 286/286 (34 files), api build+typecheck exit 0 — all re-verified this session.
- Frontmatter carries `status: complete`; deviation ledger entry 25 appended to `.planning/WINDOWS.md` (`kind: deviation`, harness mock-key retarget).
