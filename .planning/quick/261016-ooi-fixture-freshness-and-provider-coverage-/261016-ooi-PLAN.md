---
phase: quick-261016-ooi
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/modules/fixtures/fixtures-sync.service.ts
  - tests/unit/fixtures-sync.test.ts
autonomous: true
must_haves:
  truths:
    - "Pressing the manual refresh after an unchanged provider payload moves FixtureProvenance.observedAt to the new confirmation time, so the /fixtures dataState badge leaves STALE within the 6h30m threshold instead of staying STALE until the payload itself changes."
    - "A successful manual sync of a real league records ProviderRouteReceipt(competitionId, seasonId, FIXTURES) plus a SUCCEEDED attempt linked to a football-data.org SourceObservation, so fixtures.service providerState projects PRIMARY and the card stops showing 'Покрытие ожидается'."
    - "Skipped (recently synced, non-force) and failed league syncs record no receipt, no attempt and no observation — coverage is never claimed without a successful provider call."
    - "Budget reservations (jobKey manual-fixtures-sync:...), league gates, the 6_500 ms spacing gate and all existing SourceObservation/evidence handling behave exactly as before; workers/data-sync stays untouched."
    - "The unit suite and apps/api build/typecheck are green; integration/e2e suites are not run."
  artifacts:
    - apps/api/src/modules/fixtures/fixtures-sync.service.ts (provenance upsert clause + route-receipt recording)
    - tests/unit/fixtures-sync.test.ts (new emulated-DB sync suite, 4 cases)
  key_links:
    - provenance ON CONFLICT DO UPDATE of observedAt/sourceUpdatedAt -> fixtures.service project() observationStale=false -> AVAILABLE dataState badge
    - successful sync -> receipt + SUCCEEDED attempt + linked observation -> providerState latest-receipt read -> projectProviderState PRIMARY instead of PENDING
    - PROVIDER-in-candidates guard -> sole-source (api-football) leagues are never claimed by a football-data.org sync
---

<objective>
Fix both fixture-badge defects in the live manual sync path: (A) re-syncing an unchanged fixture payload must refresh FixtureProvenance.observedAt so the STALE badge clears, and (B) every successful league sync must record a durable provider route receipt (plus SUCCEEDED attempt and linked provider observation) so the coverage badge leaves PENDING for real competitions.
Purpose: every real fixture card currently shows "Покрытие ожидается" and "Устаревшие данные" — freshness is computed from a confirmation time the live sync never refreshes, and the coverage projection reads a receipt table only the deterministic seed ever wrote.
Output: one patched fixtures-sync service, one new unit suite proving both behaviors (RED→GREEN), green unit + typecheck gates, one atomic code commit.
</objective>

<execution_context>
@C:/Users/Vlad/.config/opencode/gsd-core/workflows/execute-plan.md
@C:/Users/Vlad/.config/opencode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md

Key verified facts (orchestrator-verified root cause + my code reads — use as given, do not re-investigate):

1. Defect A: fixtures-sync.service.ts line 211 persists provenance with `INSERT INTO "FixtureProvenance" ... ON CONFLICT ("provider", "payloadHash") DO NOTHING` — identical payload => no row update => observedAt frozen at the last CHANGE. fixtures.service.ts `project()` (lines 61-75) deliberately treats provenance.observedAt as "how recently WE confirmed the fixture with the provider" (comment lines 66-68) against `readFreshnessThresholds().fixture` = 6h30m (packages/config/src/freshness.ts line 6), so unchanged fixtures badge STALE ~6.5h after the last real change no matter how often the operator refreshes. `fixture.capturedAt` bound as observedAt is the fetch instant (normalize.ts default `capturedAt = new Date()`), i.e. the correct confirmation time.
2. Skip semantics after the fix: fixtures-sync.service.ts lines 135-142 skip a league when `MAX(FixtureProvenance.observedAt)` per league is younger than MIN_SYNC_INTERVAL_MS (6h) unless `force`. The UI manual button "Обновить матчи" sends force=true (apps/web/components/date-range-filter.tsx line 182 runSync(true)), the page-mount autoSync sends force=false and is disabled (.env FIXTURES_AUTO_SYNC=false). So after the fix: manual refresh always fetches and re-confirms (badge clears); a non-force run inside 6h skips with the badge already fresh from the previous run. Semantics stay coherent — keep them as-is.
3. FixtureProvenance consumers (grep verified, whole repo): apps/api fixtures.service.ts (provenance include orderBy observedAt desc take 1), fixtures-sync.service.ts line 137 (MAX skip query), workers/data-sync/src/jobs/fixtures.ts line 299 (its own DO NOTHING insert — OUT OF SCOPE, do NOT touch workers/data-sync), tests only TRUNCATE the table. Nothing anywhere depends on observedAt immutability.
4. Evidence isolation (grep verified): evidence builds consume SourceObservation only through ResultVersion/LineupObservation/ClosingOddsObservation links and endpointFamily-scoped reads (evidence-rebuild, operations.service line 85 provider+endpointFamily, worker loadObservation endpointFamily check, enrichment exact-hash upsert). Adding ONE new FIXTURES-family observation cannot enter any evidence capture window. Do NOT modify any existing SourceObservation handling; the worker's observation code and the enrichment upsert stay untouched.
5. Defect B: fixtures.service.ts `providerState()` (lines 124-132) reads the latest ProviderRouteReceipt by {competitionId, seasonId, endpointFamily "FIXTURES"} with attempts+observation; none found => projectProviderState(null) => PENDING/ROUTE_PENDING. DB has receipts only for the deterministic seed. The live sync path reserves budget (ProviderRequestReservation, jobKey line 162) but never writes a receipt.
6. Shared repository exists and IS used from the API process already: createProviderRoutingRepository (packages/database/src/provider-routing/repository.ts, exported by @bet-stats/database; apps/api provider-policy.service.ts line 115 imports it). Relevant API: appendRoute(AppendRouteInput) — runs assertRouteReceipt, recomputes routeReceiptContentHash, idempotent by receipt id (IDENTITY_COLLISION on hash mismatch); appendAttempt(AppendAttemptInput) — validateAttempt requires SUCCEEDED to carry admitted=true + provider + observationId and verifies observation.provider === attempt.provider (ATTEMPT_OBSERVATION_MISMATCH), idempotent by attemptKey when every field matches. admitAttempt/completeAttempt are NOT used here — see Task 2 rationale.
7. Worker conventions to mirror (workers/data-sync/src/ingestion/provider-route-runtime.ts line 76): policyVersion = PROVIDER_ROUTE_POLICY_VERSION ("provider-route-policy/v1"), policyHash = `sha256:` + sha256(PROVIDER_ROUTE_MATRIX_VERSION "provider-route-v1"), trigger "PRIMARY", receipt outcome "ADMITTED", capabilitySnapshot {status:"SUPPORTED"}, budgetSnapshot {configuredAllowance: DAILY_ALLOWANCE}, circuitSnapshot {state:"CLOSED"}, correlationId; receipt id = `${version}:${leagueId}:${seasonId}:${endpoint}:${correlationId}`. Displayed outcome SUCCEEDED is derived by projectProviderState from the SUCCEEDED attempt (fixtures.service line 49), so receipt ADMITTED + attempt SUCCEEDED reproduces exactly the worker end-state the badge expects.
8. Route matrix: createProviderRoute (packages/football-data/src/routing/provider-route.ts) returns candidates ["football-data.org","api-football"] for PL/PD/BL1/SA/FL1/CL but sole-source ["api-football"] for EL, while isConfiguredCompetitionCode includes "EL". assertRouteReceipt rejects selectedProvider outside candidates — guard required (Task 2).
9. Schema (packages/database/prisma/schema.prisma): SourceObservation @@unique([provider, endpointFamily, payloadHash]) with required externalIdentity/observedAt/rawPayload/payloadBytes (line 289-310); ProviderRouteReceipt id @id + contentHash @unique + @@index([competitionId, seasonId, endpointFamily, createdAt]) (line 474-497); ProviderRouteAttempt attemptKey @unique, observationId FK to SourceObservation (line 500-517). Enums: providerRouteOutcomes = ADMITTED | DENIED | NO_FALLBACK | SUCCEEDED | FAILED | QUARANTINED, triggers include PRIMARY (packages/domain/src/provider-routing.ts lines 3-5). Both are re-exported from @bet-stats/domain (`export * from "./provider-routing.js"`).
10. Observation dedupe precedents: worker persistObservation inserts raw SQL with ON CONFLICT DO NOTHING RETURNING then selects the existing row (provider-route-runtime.ts lines 92-95); enrichment.ts line 72 uses model-level upsert + read-back. The new recording code follows the worker pattern at model level (findFirst by hash, create when absent) — no raw SQL needed.
11. Test harness facts: NO service-level fixtures-sync tests exist (grep verified) and tests/unit contains no vi.mock usage yet — the new file establishes the pattern. vitest.config.ts aliases @bet-stats/* to package SOURCES, so `vi.mock("@bet-stats/database", partial-with-importOriginal)` and `vi.mock("@bet-stats/football-data", partial)` apply to the service's imports; keep isConfiguredCompetitionCode/createProviderRoute real. readServerConfig (packages/config/src/index.ts lines 10-28) only enforces DATABASE_URL/FOOTBALL_DATA_API_KEY-style requirements when NODE_ENV=production (vitest sets NODE_ENV=test), but the service still needs DATA_PROVIDER_MODE=live, DATABASE_URL (postgresql://...) and FOOTBALL_DATA_API_TOKEN set BEFORE `new FixturesSyncService()` (readServerConfig runs in the class field initializer) and createPrismaClient mocked to return the emulated DB. reservePriorityRequest (domain request-budget.ts lines 101-135) runs REAL against the fake via $transaction (support BOTH the array form used by fixture.create transactions and the callback form) plus $queryRawUnsafe routed by SQL substring (EXISTS -> [{exists:false}], `count(*)` -> [{count:0n}], `MAX(p."observedAt")` -> per-test rows) and $executeRawUnsafe capturing provenance/reservation statements. NormalizedFixture shape: packages/football-data/src/provider.interface.ts lines 12-26.
12. Timing: `waitForProviderSpacing` (module-level, 6_500 ms) is real production code — each provider fetch after the first in the same test file waits 6.5s. Keep the suite to at most 3 fetches (~13s added); do NOT stub the gate. One league + default 7-day window = one chunk = one fetch per run.
13. Gates environment: apps/api scripts are build = `tsc -p tsconfig.json`, typecheck = `tsc -p tsconfig.json --noEmit`; root `vitest run --project unit` is the unit gate. Dev stack (API :3001, compiled dist, no watch) is running — do NOT restart it; dist goes live only after the orchestrator restarts.

Constraints (hard): code, comments and commit messages in English; NO UI text changes (badge labels stay); API-side changes only — do NOT touch apps/web, packages/domain, workers/data-sync, ROADMAP.md; no integration/e2e runs (tests/integration/replay.test.ts has 6 pre-existing failures — out of scope); ONE atomic code commit staging ONLY `apps/api/src/modules/fixtures/fixtures-sync.service.ts` and `tests/unit/fixtures-sync.test.ts`; blacklist keeps .env, .env2, infra/docker-compose.yml, package.json, pnpm-lock.yaml, packages/database/src/generated/**, tsconfig.json, apps/web/next-env.d.ts, .agents/, .claude/, .planning/**, untracked scripts unstaged (docs artifacts are committed by the orchestrator, not this plan).
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED→GREEN — re-sync refreshes FixtureProvenance.observedAt for unchanged payloads</name>
  <files>apps/api/src/modules/fixtures/fixtures-sync.service.ts, tests/unit/fixtures-sync.test.ts</files>
  <behavior>
- New file tests/unit/fixtures-sync.test.ts, describe "fixtures live sync (emulated db)": the harness instantiates the real FixturesSyncService with env pins (DATA_PROVIDER_MODE=live, DATABASE_URL=postgresql://..., FOOTBALL_DATA_API_TOKEN=test-token, originals restored in afterAll), partial vi.mock of @bet-stats/database exposing createPrismaClient -> current fake, partial vi.mock of @bet-stats/football-data replacing ONLY FootballDataOrgClient with a state-driven fake (constructor ignored; fetchCompetitionFixtures delegates to a per-test impl capturing window/options), all other exports real. Fake DB serves: league.findMany -> one PL league with football-data.org externalRef; season.findMany -> one in-range season with externalRef; providerCapability.findUnique -> supported row with expiresAt null; seasonExternalRef/teamExternalRef/fixtureExternalRef lookups; $transaction handling both array and callback forms; $queryRawUnsafe and $executeRawUnsafe routed by SQL substring while capturing every executed statement with its bound params, a per-test switch for the MAX(p."observedAt") skip rows, and stores for receipts/attempts/observations.
- Test 1 (RED first): running sync with one unchanged NormalizedFixture (provider football-data.org, capturedAt a fixed instant, sourceUpdatedAt older, raw carrying the fixture id) executes a FixtureProvenance statement whose SQL contains `ON CONFLICT ("provider", "payloadHash") DO UPDATE SET` together with `"observedAt" = EXCLUDED."observedAt"` and `"sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt"`; today's statement fails this assertion.
- Test 1 also asserts the bound observedAt parameter equals the fixture capturedAt (the fetch instant), proving a re-confirmation moves the confirmation time forward while the payload is byte-identical.
- Non-regression asserts in the same run: the league gates resolve (status "synced", fixtures 1), the budget reservation INSERT ran with a jobKey starting `manual-fixtures-sync:`, and the `MAX(p."observedAt")` skip query ran before fetching.
  </behavior>
  <action>Build the harness first (facts 11-12 in <context> spell out the env pins, the two partial mocks, the SQL-substring routing and the NormalizedFixture shape), write Test 1, run it and confirm it fails against the current code (RED). Then fix the provenance insert at fixtures-sync.service.ts line 211: replace the conflict handling with an upsert clause `ON CONFLICT ("provider", "payloadHash") DO UPDATE SET "observedAt" = EXCLUDED."observedAt", "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt"` — update ONLY those two columns; the id, fixtureId and rawPayload columns must keep their current positions and never be updated (one row per payload hash, raw payload immutable, only the confirmation time moves). Add one short English comment above the insert stating the design intent it satisfies (freshness = how recently WE confirmed the fixture; see the project() comment in fixtures.service.ts). Leave the worker insert (workers/data-sync/src/jobs/fixtures.ts line 299) untouched — API-only scope. Run the suite to GREEN. Do NOT commit: this plan ships one atomic commit in Task 3.</action>
  <verify>
    <automated>corepack pnpm vitest run tests/unit/fixtures-sync.test.ts</automated>
  </verify>
  <done>The new suite passes: the executed provenance SQL carries the DO UPDATE SET upsert for observedAt/sourceUpdatedAt with fixture.capturedAt bound as observedAt; the synced/skip-query/budget-reservation asserts pass; `git diff` shows production changes only in the provenance statement plus its comment; no file outside the two plan files is modified.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: RED→GREEN — record a provider route receipt after each successful league sync</name>
  <files>apps/api/src/modules/fixtures/fixtures-sync.service.ts, tests/unit/fixtures-sync.test.ts</files>
  <behavior>
- Success test: syncing one league to status "synced" additionally creates exactly one SourceObservation (provider "football-data.org", endpointFamily "FIXTURES", externalIdentity equal to the correlation id, observedAt equal to the run instant, rawPayload containing the run's exact raw provider match objects plus the run identity, payloadBytes set), one ProviderRouteReceipt (competitionId/seasonId of the synced league scope, endpointFamily "FIXTURES", selectedProvider "football-data.org", trigger "PRIMARY", outcome "ADMITTED", policyVersion "provider-route-policy/v1", contentHash with `sha256:` prefix, correlationId starting `manual-fixtures-sync:`) and one ProviderRouteAttempt (state "SUCCEEDED", admitted true, provider "football-data.org", reason null, observationId referencing that observation).
- Badge test: feeding the recorded receipt and attempt into the exported projectProviderState returns state "PRIMARY" (never "PENDING"), receipt.outcome "SUCCEEDED", capturedAt equal to the observation's observedAt — the exact projection /fixtures cards render.
- Skip test: with a recent MAX(p."observedAt") and no force -> status "skipped" reason RECENTLY_SYNCED, zero provider fetches, zero receipts/attempts/observations.
- Fail test: fetchCompetitionFixtures throws an error carrying statusCode 403 -> status "failed" reason PROVIDER_ACCESS_RESTRICTED, zero receipts/attempts/observations.
  </behavior>
  <action>Write the four tests against the Task 1 harness (RED: nothing records receipts today), then implement recording in fixtures-sync.service.ts. (1) Accumulate the raw provider match objects (`fixture.raw`) across the chunk loop into a per-run collection. (2) Add a private method invoked ONLY on the path that returns status "synced", after the chunk loop and before the return; skipped, denied and failed returns must return before it, so a partial/mid-run failure claims nothing. (3) Inside it: correlationId = `manual-fixtures-sync:${code}:${runStamp}` (runStamp already captured at line 146); route = createProviderRoute({ competition: code, season: season.label, endpoint: "FIXTURES" }); guard `route.candidates.includes(PROVIDER)` with an English comment explaining that a sole-source (api-football) league must not be claimed by a football-data.org sync — if absent, return without recording. (4) Receipt content mirrors the worker end-state exactly (fact 7): policyVersion PROVIDER_ROUTE_POLICY_VERSION, policyHash `sha256:` + sha256(PROVIDER_ROUTE_MATRIX_VERSION), competitionId league.id, seasonId season.id, endpointFamily "FIXTURES", candidates from the route, selectedProvider PROVIDER, trigger "PRIMARY", outcome "ADMITTED", capabilitySnapshot { status: "SUPPORTED" }, budgetSnapshot { configuredAllowance: DAILY_ALLOWANCE }, circuitSnapshot { state: "CLOSED" }, correlationId; receipt id = `${route.version}:${league.id}:${season.id}:FIXTURES:${correlationId}`. (5) Observation at model level, worker dedupe pattern: payloadHash = sha256 hex of JSON.stringify({ correlationId, competitionCode: code, dateFrom, dateTo, matches: collectedRaw }); findFirst by (provider, endpointFamily, payloadHash) and reuse the id, else create with provider PROVIDER, endpointFamily "FIXTURES", externalIdentity correlationId, observedAt = run instant, rawPayload parsed object, payloadBytes byte length — the correlation id inside the payload makes the hash unique per run, so observedAt truthfully equals the latest confirmation. (6) repository = createProviderRoutingRepository({ database }) (fact 6): await appendRoute({ id: receiptId, contentHash: routeReceiptContentHash(content), ...content }) then await appendAttempt({ id: `${receiptId}:attempt:result`, routeReceiptId: receiptId, attemptKey: `${receiptId}:result`, provider: PROVIDER, state: "SUCCEEDED", reason: null, observationId, admitted: true }) — deterministic attempt id/attemptKey make the call idempotent under repository rules. (7) Add one English comment recording why the attempt is appended directly instead of admitAttempt/completeAttempt: the live manual path performs admission before each fetch via evaluateCapability + reservePriorityRequest, and a post-hoc admitAttempt would re-gate an already-succeeded call (it can deny on circuit/quota/throttle facts and requires a CLOSED circuit row) while contradicting the observed success; the receipt+attempt shapes still match the worker's durable end-state. (8) A recording error propagates to the sync caller exactly like persistence errors today — no swallowing. Imports to add: createProviderRoutingRepository from "@bet-stats/database", PROVIDER_ROUTE_POLICY_VERSION and routeReceiptContentHash from "@bet-stats/domain", createProviderRoute from "@bet-stats/football-data"; createHash/randomUUID are already imported. Budget reservation (line 153-163) and the skip gate (135-142) stay untouched. Run the suite to GREEN. Do NOT commit.</action>
  <verify>
    <automated>corepack pnpm vitest run tests/unit/fixtures-sync.test.ts</automated>
  </verify>
  <done>All five behaviors hold: a synced league records receipt (ADMITTED/PRIMARY/FIXTURES for its competition+season) + SUCCEEDED admitted attempt with linked football-data.org observation; projectProviderState over them yields PRIMARY with outcome SUCCEEDED and the observation's capturedAt; skipped and 403-failed syncs record nothing and issue no receipt writes; budget reservation and skip queries still execute as before; no file outside the two plan files is modified.</done>
</task>

<task type="auto">
  <name>Task 3: Verification gates, staging discipline and one atomic commit</name>
  <files>apps/api/src/modules/fixtures/fixtures-sync.service.ts, tests/unit/fixtures-sync.test.ts</files>
  <action>Run the gate battery and report actual exit codes. (1) `corepack pnpm --filter @bet-stats/api build && corepack pnpm --filter @bet-stats/api typecheck` — both exit 0 (scripts confirmed: tsc -p tsconfig.json / --noEmit). (2) `corepack pnpm vitest run --project unit` — the full unit project green, including the new fixtures-sync suite (the suite adds up to three provider fetches, so up to ~13 s of intentional 6_500 ms spacing waits — expected, not a failure). (3) Do NOT run any integration or e2e suite; if tests/integration/replay.test.ts is mentioned anywhere, label its 6 failures pre-existing at bare HEAD. (4) Review `git diff` and confirm: the provenance statement updates only observedAt/sourceUpdatedAt; route recording sits solely on the status "synced" return path behind the PROVIDER-in-candidates guard; skip gate, budget reservation jobKey and spacing gate unchanged; workers/data-sync, apps/web, packages/domain, ROADMAP.md untouched. (5) Staging: `git status --short`, then stage ONLY `apps/api/src/modules/fixtures/fixtures-sync.service.ts` and `tests/unit/fixtures-sync.test.ts`; blacklist stays unstaged (.env, .env2, infra/docker-compose.yml, package.json, pnpm-lock.yaml, packages/database/src/generated/**, tsconfig.json, apps/web/next-env.d.ts, .agents/, .claude/, .planning/**, untracked scripts); verify with `git diff --cached --name-only`. (6) Commit exactly once, subject `fix(api): refresh fixture provenance and record route receipts on manual sync`, English body with bullets for the observedAt upsert and the route-receipt recording referencing 261016-ooi. One atomic commit — no partial staging, no second commit.</action>
  <verify>
    <automated>corepack pnpm --filter @bet-stats/api build && corepack pnpm --filter @bet-stats/api typecheck && corepack pnpm vitest run --project unit</automated>
  </verify>
  <done>Build and typecheck exit 0; the whole unit project passes; `git diff --cached --name-only` lists exactly the two plan code files with the blacklist untouched; a single commit exists with the required subject and a body referencing 261016-ooi; no integration/e2e suite was executed and the dev stack was not restarted.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator HTTP -> Nest internal sync route | Operator-guarded manual sync requests gain authority to write routing receipts in addition to budget reservations and fixture rows |
| provider payload -> Postgres | Untrusted football-data.org JSON enters FixtureProvenance (upserted now) and the new FIXTURES SourceObservation rawPayload |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261016ooi-01 | Spoofing | Route receipt recording in fixtures-sync.service.ts | medium | mitigate | Recording executes only on the status "synced" return path (at least one successful provider fetch per league run); skipped, denied and failed returns exit beforehand; the SUCCEEDED attempt must reference a provider-matching immutable SourceObservation (repository validates observation.provider === attempt.provider) — unit tests assert skip/failure paths record nothing. |
| T-261016ooi-02 | Tampering | FixtureProvenance ON CONFLICT upsert | medium | mitigate | The conflict clause updates only observedAt and sourceUpdatedAt; id, fixtureId and rawPayload are never updated, so payload-hash row identity and raw evidence stay immutable while confirmation time moves — no retrospective payload mutation. All SQL stays parameterized via the existing $executeRawUnsafe pattern. |
| T-261016ooi-03 | Tampering | Duplicate or conflicting receipts from overlapping/forced runs | low | mitigate | Deterministic receipt id, attempt id and attemptKey derived from correlationId (per run stamp) plus the repository's identity checks (ROUTE_IDENTITY_COLLISION / ATTEMPT_IDENTITY_COLLISION) make recording idempotent per run; sync() already serializes runs through the pending promise chain. |
| T-261016ooi-04 | Information disclosure | New FIXTURES SourceObservation rawPayload | low | accept | Payload stores only provider match objects already persisted in FixtureProvenance.rawPayload plus run scope metadata — no tokens, headers or operator data; every reader is endpointFamily-scoped (fact 4), so evidence windows cannot absorb it. |
| T-261016ooi-SC | Tampering | npm/pip/cargo installs | low | accept | No package installs and no new dependencies — vitest vi.mock and already-imported workspace packages only. |
</threat_model>

<verification>
Run in order and report actual output/exit codes:
1. `corepack pnpm vitest run tests/unit/fixtures-sync.test.ts` — 5 assertions green (provenance upsert SQL + params + gates; receipt/attempt/observation recording; badge projection; skip records nothing; failure records nothing).
2. `corepack pnpm --filter @bet-stats/api build && corepack pnpm --filter @bet-stats/api typecheck` — exit 0.
3. `corepack pnpm vitest run --project unit` — full unit project green.
4. Diff review: provenance clause updates only observedAt/sourceUpdatedAt; recording only on the synced path with the candidates guard; skip gate, budget jobKey, spacing gate untouched; workers/data-sync, apps/web, packages/domain, ROADMAP.md absent from the diff.
5. Staging check: `git diff --cached --name-only` equals exactly the two code files; blacklist paths absent.
6. tests/integration/* and tests/e2e/* are not run (replay.test.ts 6 failures pre-existing, out of scope); the dev stack is not restarted.
</verification>

<success_criteria>
- Re-syncing an unchanged fixture payload refreshes FixtureProvenance.observedAt, so dataState leaves STALE within the 6h30m threshold after a manual refresh.
- A successful manual league sync yields a durable FIXTURES route receipt + SUCCEEDED attempt + linked football-data.org observation, and the /fixtures cards project provider state PRIMARY instead of PENDING; skipped/failed syncs claim nothing.
- All builds/typechecks exit 0 and the full unit project is green; only the two plan code files are staged.
- One atomic commit with subject `fix(api): refresh fixture provenance and record route receipts on manual sync` (body references 261016-ooi).
</success_criteria>

<output>
Create `.planning/quick/261016-ooi-fixture-freshness-and-provider-coverage-/261016-ooi-SUMMARY.md` when done (docs artifacts are committed by the orchestrator per this plan's staging rules).
</output>
