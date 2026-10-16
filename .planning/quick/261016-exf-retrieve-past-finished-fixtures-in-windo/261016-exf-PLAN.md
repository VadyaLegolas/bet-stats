---
phase: quick-261016-exf
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/football-data/src/providers/football-data-org/client.ts
  - apps/api/src/modules/fixtures/fixtures-sync.service.ts
  - apps/api/src/modules/fixtures/results-sync.service.ts
  - tests/unit/provider-contract.test.ts
autonomous: true
must_haves:
  truths:
    - "A past-window backfill (e.g. 2026-08-01..2026-10-16) via internal/fixtures/sync persists FINISHED provider fixtures as canonical Fixture rows with FixtureExternalRef, so ResultsSyncService can later resolve their identities; before this task such windows persisted only still-scheduled matches while reporting synced."
    - "The client default fetchCompetitionFixtures(window) with no options still produces the byte-identical URL pinned by the existing provider-contract assertions (status key first), so no existing caller or test changes behavior."
    - "Every provider fetch inside a chunk loop reserves its own request-budget row (jobKey carries chunk bounds + per-run stamp), so a 3-chunk x 7-league backfill reserves ~19-21 rows instead of 7; a mid-run denial returns status denied with the fixture/result counts persisted so far."
    - "League-level gates (provider mapping, season, capability, freshness skip) and the shared 6_500 ms spacing gate behave exactly as before; chunkSyncDateRange, resolveSyncDateRange and response shapes are unchanged."
    - "All pre-existing provider-contract, forecast-sweep, forecast-publication and replay-boundary tests stay green unmodified; only ADDED test cases appear in the diff."
  artifacts:
    - packages/football-data/src/providers/football-data-org/client.ts (fetchCompetitionFixtures gains optional { allStatuses?: boolean })
    - apps/api/src/modules/fixtures/fixtures-sync.service.ts (all-status chunk fetch + per-chunk reservation)
    - apps/api/src/modules/fixtures/results-sync.service.ts (per-chunk reservation)
    - tests/unit/provider-contract.test.ts (2 ADDED cases)
  key_links:
    - FixturesSyncService chunk loop -> fetchCompetitionFixtures(window, { allStatuses: true }) -> schema+normalize accept FINISHED -> canonical Fixture + FixtureExternalRef -> persistResultsInTransaction identity resolution
    - per-chunk jobKey (chunk bounds + runStamp) -> reservePriorityRequest idempotent insert per fetch -> daily API-budget accounting stays accurate (project constraint)
    - pre-loop league gates -> unchanged denial/skip semantics; reservation now guards each individual provider call
---

<objective>
Make windowed fixture sync fetch past FINISHED matches and reserve API budget once per chunk instead of once per league.
Purpose: quick 261016-d9t added windowed sync, but a live operator run showed two defects: (1) the football-data.org client hardcodes status=SCHEDULED in the fixtures query, so a past backfill persisted ZERO historical matches while reporting "synced" (ResultsSyncService then throws "Result fixture identity is unresolved" for those windows); (2) both sync services reserve budget once per league while actually making one provider fetch per 31-day chunk (observed 7 reservations for 21 fetches), breaking the API-budget accounting constraint.
Output: an optional all-status fetch on FootballDataOrgClient, both sync services reserving per chunk, two added client contract tests, green builds and regression suites, one atomic fix commit.
</objective>

<execution_context>
@C:/Users/Vlad/.config/opencode/gsd-core/workflows/execute-plan.md
@C:/Users/Vlad/.config/opencode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md

Key verified facts (orchestrator-verified — use as given, do not re-investigate):

1. client.ts line 28-54: `fetchCompetitionFixtures(window)` builds `new URLSearchParams({ status: "SCHEDULED", dateFrom, dateTo })`. `fetchCompetitionResults` (line 59) already uses status FINISHED and works for past windows. The `FixtureProvider` interface (packages/football-data/src/provider.interface.ts line 67) declares the 1-arg signature — an OPTIONAL second parameter on the implementation is TS-compatible; do not change the interface.
2. tests/unit/provider-contract.test.ts lines 131 and 199 assert the exact default URL `https://api.football-data.org/v4/competitions/{code}/matches?status=SCHEDULED&dateFrom=...&dateTo=...` — the default MUST remain byte-identical (key order: status first). Existing suites stay green unmodified except for ADDED cases.
3. Payload schema accepts any status: schema.ts line 6 `footballDataMatchSchema.status: z.string().min(1)`; normalize.ts normalizeStatus (lines 4-16) maps SCHEDULED/TIMED->SCHEDULED, IN_PLAY, PAUSED, FINISHED, POSTPONED, CANCELLED/SUSPENDED and throws only for unknown statuses. `score` is not in the fixtures schema and the matches payload is passthrough — fixtures normalization never reads score, so a mixed-status payload through the fixtures path is safe. Do not touch normalize.ts or schema.ts.
4. `reservePriorityRequest` (packages/domain/src/request-budget.ts lines 65-114+): DB path is idempotent per (provider, requestDate, endpointFamily, jobKey) — the SAME jobKey returns {reserved:true, reused:true} WITHOUT inserting, so a loop reusing one jobKey under-counts. Returns {reserved:false, reason:"ALLOWANCE_EXHAUSTED"|"CRITICAL_HEADROOM"|"UNKNOWN_RESET_SEMANTICS"} when over allowance. Per-chunk jobKeys must therefore include chunk identity + per-run stamp.
5. FixturesSyncService: reserve block lines 144-155 (jobKey `manual-fixtures-sync:${code}:${now.toISOString()}`), chunk loop lines 158-208 (`persisted` counter, per-chunk `waitForProviderSpacing()` + fetch at 161-167). ResultsSyncService: reserve lines 128-139 (jobKey `manual-results-sync:${code}:${range.dateFrom}:${range.dateTo}`), chunk loop lines 144-152 inside one try, failure mapping lines 153-163, counters `fixtures`/`results`.
6. `waitForProviderSpacing` (fixtures-sync.service.ts lines 27-32): shared module-level 6_500 ms gate used by BOTH services — unchanged, as are the `chunkSyncDateRange` / `resolveSyncDateRange` exports.
7. No service-level tests exist for either sync service (grep verified) — test coverage for this task is client-level (provider-contract.test.ts) only.
8. Post-task operator budget context: today's quota 22/100 used; the re-run backfill (Aug1-Oct16 = 3 chunks x 7 leagues, EL 403-fails its first chunk) must reserve ~19-21 rows — fits under 100. Minute pacing 1 fetch per >=6_500 ms already holds.
9. Build scripts confirmed: packages/football-data and apps/api both use `tsc -p tsconfig.json` for build/typecheck; root vitest 4.1.11 runs tests/ paths directly.

Constraints:
- Stage ONLY: packages/football-data/src/providers/football-data-org/client.ts, apps/api/src/modules/fixtures/fixtures-sync.service.ts, apps/api/src/modules/fixtures/results-sync.service.ts, tests/unit/provider-contract.test.ts (+ `.planning/quick/261016-exf-*/` docs). Nothing else — blacklist: apps/web/next-env.d.ts, infra/docker-compose.yml, package.json, pnpm-lock.yaml, packages/database/src/generated/prisma/**, tsconfig.json, .env, .env2, .agents/, .claude/, skills-lock.json, untracked scratch scripts, .planning/phases/07-modern-ui-enhancements/, .planning/WINDOWS.md (ledger rides with the orchestrator's next .planning docs commit).
- No package installs, no new dependencies, no schema migrations, no web changes, no replay/policy changes. Do not modify the FixtureProvider interface, normalize.ts, schema.ts, fetchCompetitionResults, fetchCompletedResults, budget constants, or controller/DTO files.
- Tests that must stay green AND unmodified except for ADDED cases: tests/unit/provider-contract.test.ts, tests/unit/forecast-sweep.test.ts, tests/integration/forecast-publication.test.ts, tests/integration/replay-boundary.test.ts. Known pre-existing baseline (do NOT fix): tests/integration/replay.test.ts has 6 failures from fixed test clock vs DB time — reproduces at bare HEAD.
- English identifiers, log strings and commit messages; single-line console JSON logging.
- Commit subject exactly: `fix(api): fetch past fixtures across statuses and reserve per chunk` with body referencing `261016-exf`. Single atomic commit.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Optional all-status fixtures fetch on FootballDataOrgClient</name>
  <files>packages/football-data/src/providers/football-data-org/client.ts, tests/unit/provider-contract.test.ts</files>
  <behavior>
    - Test A (URL): fetchCompetitionFixtures(window, { allStatuses: true }) requests exactly `https://api.football-data.org/v4/competitions/PL/matches?dateFrom=2026-08-01&dateTo=2026-10-16` — the query carries exactly the dateFrom and dateTo keys in that order.
    - Test B (payload): a FINISHED-status matches payload (reuse the file's existing finishedPayload fixture, competition envelope matching the requested code) fetched via fetchCompetitionFixtures(..., { allStatuses: true }) passes schema validation + normalization and yields a fixture with status "FINISHED".
    - Existing behavior: fetchCompetitionFixtures(window) with no options still produces the byte-identical default URL pinned at provider-contract lines 131 and 199.
  </behavior>
  <action>Read client.ts and tests/unit/provider-contract.test.ts in full first. Extend `fetchCompetitionFixtures` (client.ts line 28) with an optional second parameter `options?: { allStatuses?: boolean }`. Default path (options undefined or allStatuses falsy): build the query exactly as today — `new URLSearchParams({ status: "SCHEDULED", dateFrom: window.dateFrom, dateTo: window.dateTo })` — so the default request stays byte-identical including key order. When `options.allStatuses` is truthy: build the query from only `dateFrom` and `dateTo` (the status key is omitted so football-data.org returns every match status in the window, FINISHED included). Everything else in the method (competition assertion, headers, timeout, schema check, normalize call, error mapping) is shared by both paths — branch only the query construction. Do NOT change `fetchCompetitionResults`, `fetchCompletedResults`, `fetchCompetitionStandings`, the `FixtureProvider` interface, normalize.ts or schema.ts — an optional param on the class method is already interface-compatible. In tests/unit/provider-contract.test.ts add exactly two new `it` cases (ADDED only — every existing assertion, including the exact-URL assertions at lines 131 and 199, stays untouched): Test A asserts the allStatuses request URL equals the provider path with exactly the dateFrom and dateTo keys, using the same fetcher-mock pattern as the existing routing tests (vi.fn returning a Response of validPayload); Test B feeds finishedPayload through `fetchCompetitionFixtures(..., { allStatuses: true })` with a fetcher mock and asserts the resulting fixture has status "FINISHED" (also proving the schema+normalize path accepts a mixed-status payload). Place the new cases near the existing fixture-routing tests; reuse the file's existing payload fixtures rather than defining new ones where possible.</action>
  <verify>
    <automated>corepack pnpm --filter @bet-stats/football-data build && corepack pnpm vitest run tests/unit/provider-contract.test.ts</automated>
  </verify>
  <done>football-data build exits 0; the provider-contract suite passes with the two ADDED cases (allStatuses URL contains exactly dateFrom and dateTo keys; FINISHED payload normalizes to status FINISHED via the fixtures path); the pre-existing exact-URL assertions pass unmodified, proving default behavior byte-identical; git diff of the test file shows additions only.</done>
</task>

<task type="auto">
  <name>Task 2: All-status chunk fetch and per-chunk budget reservation in both sync services</name>
  <files>apps/api/src/modules/fixtures/fixtures-sync.service.ts, apps/api/src/modules/fixtures/results-sync.service.ts</files>
  <action>Read both service files in full first. (1) FixturesSyncService.syncLeague: capture `const runStamp = now.toISOString();` once at reservation scope (the `now` Date is already captured once per run in `sync()`, so every league of one run shares the stamp while distinct runs differ). DELETE the pre-loop reservation block (current lines 144-155, including its denial return). Inside the existing chunk loop, as the FIRST statement before `waitForProviderSpacing()` and the client construction/fetch, call `reservePriorityRequest` with the same arguments as today (database, provider PROVIDER, resetDate `now.toISOString().slice(0, 10)`, resetTimezone "UTC", endpointFamily "FIXTURES", lane "critical", configuredAllowance DAILY_ALLOWANCE, criticalHeadroom CRITICAL_HEADROOM) but jobKey `manual-fixtures-sync:${code}:${chunk.dateFrom}:${chunk.dateTo}:${runStamp}` — one reservation row per provider fetch per run (same jobKey within a run would be deduplicated by the idempotent path and under-count). On `{reserved:false}` return `{ league: league.name, status: "denied", fixtures: persisted, reason: reservation.reason }` immediately, preserving counts persisted so far. Also in that same loop, pass `{ allStatuses: true }` as the second argument to `fetchCompetitionFixtures` (per Task 1) — this is the defect fix: a past window must return FINISHED matches so their canonical rows and FixtureExternalRef exist for ResultsSyncService; add one short English comment above the call stating that reason. (2) ResultsSyncService.syncLeague: same move — DELETE the pre-loop reservation (current lines 128-139); capture `runStamp = now.toISOString()` once; inside the existing chunk loop, as the first statement of the loop body before `waitForProviderSpacing()` and `fetchCompetitionResults`, reserve with endpointFamily "RESULTS" and jobKey `manual-results-sync:${code}:${chunk.dateFrom}:${chunk.dateTo}:${runStamp}` (all other fields identical to today's call); on `{reserved:false}` return `{ league: league.name, status: "denied", fixtures, results, reason: reservation.reason }` preserving both counters. (3) Keep EVERY league-level gate exactly where it is (provider mapping, season resolution, evaluateCapability, freshness skip) — only the reservation moves. Keep `fetchCompetitionResults` usage, the try/catch failure-reason mapping, `waitForProviderSpacing`, `chunkSyncDateRange`, `resolveSyncDateRange`, budget constants, response shapes and console JSON log style unchanged. The `fixtures` counter keeps counting processed payload rows in the fixtures service and fetched result rows in the results service. Do not add new imports, files or tests — service-level coverage for this task is intentionally client-test-only (fact 7).</action>
  <verify>
    <automated>corepack pnpm --filter @bet-stats/football-data build && corepack pnpm --filter @bet-stats/api build && corepack pnpm vitest run tests/unit/provider-contract.test.ts</automated>
  </verify>
  <done>Both packages build exit 0; fixtures chunk loop passes { allStatuses: true } and reserves per chunk with the chunk-bounds+runStamp jobKey before each fetch; results chunk loop reserves per chunk with its own jobKey before each fetch; both deny mid-run with counts preserved; pre-loop reservation blocks are gone (grep shows only the in-loop reserve calls); league gates, spacing gate, chunking helpers and response shapes unchanged; provider-contract suite green.</done>
</task>

<task type="auto">
  <name>Task 3: Full verification gates, staging discipline and atomic commit</name>
  <files>packages/football-data/src/providers/football-data-org/client.ts, apps/api/src/modules/fixtures/fixtures-sync.service.ts, apps/api/src/modules/fixtures/results-sync.service.ts, tests/unit/provider-contract.test.ts</files>
  <action>Run the full gate battery and report actual exit codes. (1) Builds: `corepack pnpm --filter @bet-stats/football-data build && corepack pnpm --filter @bet-stats/football-data typecheck && corepack pnpm --filter @bet-stats/api build && corepack pnpm --filter @bet-stats/api typecheck` — all exit 0 (both packages use `tsc -p tsconfig.json`; if a filter name differs, read the package.json and use the real script). (2) New + existing client contract: `corepack pnpm vitest run tests/unit/provider-contract.test.ts` — every case green, and `git diff tests/unit/provider-contract.test.ts` shows additions only (no existing assertion edited). (3) Regression guards: `corepack pnpm vitest run tests/unit/forecast-sweep.test.ts tests/integration/forecast-publication.test.ts tests/integration/replay-boundary.test.ts` — all green. (4) Do NOT run or try to fix tests/integration/replay.test.ts — its 6 failures are a known pre-existing baseline (fixed test clock vs DB time, reproduces at bare HEAD); if mentioned in any output, label them pre-existing. (5) Budget sanity: `git diff` review confirms both pre-loop `reservePriorityRequest` blocks are removed, both in-loop reservations use jobKeys containing `${chunk.dateFrom}:${chunk.dateTo}:${runStamp}`, the fixtures loop passes `{ allStatuses: true }`, and no other files were touched. (6) Staging: `git status --short` then stage ONLY the four files in frontmatter `files_modified` plus `.planning/quick/261016-exf-*/` docs — every blacklisted path in <context> Constraints stays unstaged (verify with `git diff --cached --name-only`). (7) Commit once with subject exactly `fix(api): fetch past fixtures across statuses and reserve per chunk` and a body referencing `261016-exf` (English, e.g. bullet points: all-status past fixture fetch; per-chunk budget reservation in both sync services). One atomic commit — no partial staging, no second commit.</action>
  <verify>
    <automated>corepack pnpm --filter @bet-stats/football-data build && corepack pnpm --filter @bet-stats/api build && corepack pnpm vitest run tests/unit/provider-contract.test.ts tests/unit/forecast-sweep.test.ts tests/integration/forecast-publication.test.ts tests/integration/replay-boundary.test.ts</automated>
  </verify>
  <done>All builds/typechecks exit 0; provider-contract (including 2 ADDED cases), forecast-sweep, forecast-publication and replay-boundary suites all green; `git diff --cached --name-only` lists exactly the 4 code files (plus optional `.planning/quick/261016-exf-*/` docs) with the blacklist untouched; one commit exists with the exact required subject and a body referencing 261016-exf.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator HTTP -> Nest internal routes | Manual sync/results-sync requests (OperatorGuard + x-eligibility-* headers) cross into provider-call and DB-write authority |
| provider payload -> Postgres | Untrusted football-data.org JSON (now potentially mixed-status) enters fixture persistence via schema validation + normalization |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261016exf-01 | Repudiation | Request-budget reservation rows (both sync services) | high | mitigate | Per-chunk jobKeys embedding chunk bounds + per-run stamp so every provider fetch inserts its own reservation row; the idempotent same-jobKey path can no longer silently swallow per-chunk counts (observed 7-for-21 under-count). |
| T-261016exf-02 | Tampering | Mixed-status payload through the fixtures path | medium | mitigate | Schema + normalizeStatus remain the unmodified gate: known statuses map to canonical statuses, unknown statuses throw ProviderPayloadError and fail the chunk loudly; fixtures normalization never reads score. |
| T-261016exf-03 | Denial of Service | Larger all-status provider payloads | low | accept | Fetches stay bounded to <=31-day chunks, one per chunk, paced at >=6_500 ms and gated by reservePriorityRequest per chunk — payload growth cannot increase call volume or burst the minute budget. |
| T-261016exf-04 | Information disclosure | Logs and errors | low | accept | No log/error changes in this task; existing single-line JSON logs and token-redacting client errors remain as-is. |
| T-261016exf-SC | Tampering | npm/pip/cargo installs | low | accept | No package installs, no new dependencies — all libraries already in use. |
</threat_model>

<verification>
Run in order and report actual output/exit codes:
1. `corepack pnpm --filter @bet-stats/football-data build && corepack pnpm --filter @bet-stats/api build` (plus typecheck) — all exit 0.
2. `corepack pnpm vitest run tests/unit/provider-contract.test.ts` — pre-existing + 2 ADDED cases green; diff of the file is additions only.
3. `corepack pnpm vitest run tests/unit/forecast-sweep.test.ts tests/integration/forecast-publication.test.ts tests/integration/replay-boundary.test.ts` — green.
4. Budget wiring review: git diff confirms per-chunk reservations with chunk+runStamp jobKeys in both services, the pre-loop reserves removed, `{ allStatuses: true }` passed by the fixtures loop, league gates untouched.
5. Staging check: `git diff --cached --name-only` equals the four allowed files (+ optional `.planning/quick/261016-exf-*/` docs); blacklist untouched.
6. tests/integration/replay.test.ts known baseline: 6 pre-existing failures at bare HEAD — out of scope, not a gate.
</verification>

<success_criteria>
- Past-window fixture sync fetches all statuses: backfill windows persist FINISHED fixtures with external refs (client option + fixtures service wiring), while the client default URL stays byte-identical.
- Budget accounting is accurate: one reservation row per provider fetch per run in both sync services; mid-run denial preserves counts.
- All builds/typechecks exit 0; provider-contract (with 2 new cases), forecast-sweep, forecast-publication and replay-boundary suites green; only allowed files staged.
- One atomic commit with subject `fix(api): fetch past fixtures across statuses and reserve per chunk` (body references 261016-exf).
</success_criteria>

<output>
Create `.planning/quick/261016-exf-retrieve-past-finished-fixtures-in-windo/261016-exf-SUMMARY.md` when done (docs commit may ride with this plan's commit per staging rules; otherwise the orchestrator handles PLAN/SUMMARY/STATE commits).
</output>
