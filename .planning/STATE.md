---
gsd_state_version: 1.0
status: "Fast tasks: forecasts for every listed fixture + readable evidence trace table (fast-261017c/d)"
stopped_at: fast-261017d-inline
last_updated: "2026-10-17T15:10:00.000Z"
last_activity: 2026-10-17
last_activity_desc: INITIAL issues as soon as a fixture enters the 14-day sweep horizon (first tick issued the 8 missing Oct-24 forecasts; zero upcoming fixtures without INITIAL) and the empty workbench state explains INITIAL/PRE_MATCH timing; evidence API attaches fixtureLabels so the trace table shows team names instead of cuids, verified live for Bologna-Inter (365d5aa, d3b4583)
state_head: 3c6384e8e49b7746fd04ca665d22a5f48ff877b2
progress:
  total_phases: 6
  completed_phases: 6
  total_plans: 88
  completed_plans: 88
  percent: 100
current_phase: 06
current_phase_name: Release Experience and Operations
current_plan: 11
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-08)

**Core value:** Produce honest, reproducible probability estimates whose quality can be measured after every completed match.
**Current focus:** Quick task - header quota counter for fixture-sync request limits

## Current Position

Milestone: v1.0 — ARCHIVED
All Phases: Complete (6/6)
All Plans: Complete (88/88)
Status: Quick task 261016-a87 - all 9 inline eligibility-header blocks in apps/web (7 internal-api proxy routes + scorecards page + fixture page) stamp `x-eligibility-checked-at` with `process.env.ELIGIBILITY_CHECKED_AT || new Date().toISOString()`, so the NestJS EligibilityGuard's ≤1h freshness check passes for long-running dev processes while explicit env pins (unit/e2e) keep precedence; region/age headers remain static fail-closed
Last activity: 2026-10-17 - Completed quick task 261016-ooi: manual sync refreshes FixtureProvenance observedAt for unchanged payloads (the "Устаревшие данные" badge now clears on "Обновить матчи") and records a ProviderRouteReceipt + SUCCEEDED attempt per successful league sync (the "Покрытие ожидается" badge clears); commit b0ae96e, 286/286 unit tests
Last Activity Description: Gates green - targeted vitest tests/unit/internal-api-route.test.ts 4/4 (env-pin precedence preserved), web typecheck exit 0; commit fd38793; companion ops (not committed, gitignored .env): ELIGIBILITY_ALLOWED_REGIONS=PL on API, ELIGIBILITY_REGION=PL + ELIGIBILITY_AGE_ACKNOWLEDGED=true on web, ELIGIBILITY_CHECKED_AT deliberately unset

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 88
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 12 | - | - |
| 02 | 28 | - | - |
| 03 | 12 | - | - |
| 04 | 9 | - | - |
| 05 | 16 | - | - |
| 06 | 11 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 6min | 3 tasks | 9 files |
| Phase 01 P02 | 9min | 3 tasks | 12 files |
| Phase 01 P03 | 10min | 2 tasks | 17 files |
| Phase 01 P04 | 8min | 2 tasks | 14 files |
| Phase 01 P05 | 24min | 3 tasks | 34 files |
| Phase 01 P06 | 12min | 2 tasks | 9 files |
| Phase 01 P08 | 6min | 3 tasks | 8 files |
| Phase 01 P07 | 12min | 2 tasks | 13 files |
| Phase 01 P09 | 8min | 2 tasks | 11 files |
| Phase 01 P10 | 22min | 2 tasks | 8 files |
| Phase 01 P11 | 23min | 2 tasks | 10 files |
| Phase 01 P12 | 34min | 2 tasks | 7 files |
| Phase 02 P21 | 9min | 2 tasks | 5 files |
| Phase 02 P22 | 19min | 2 tasks | 3 files |
| Phase 02 P28 | 18min | 3 tasks | 18 files |
| Phase 03 P01 | 9min | 2 tasks | 10 files |
| Phase 03 P02 | 17min | 2 tasks | 9 files |
| Phase 03 P03 | 32min | 3 tasks | 22 files |
| Phase 03 P04 | 9min | 3 tasks | 11 files |
| Phase 03 P05 | 7min | 2 tasks | 11 files |
| Phase 03 P06 | 25min | 3 tasks | 12 files |
| Phase 03 P07 | 47min | 2 tasks | 13 files |
| Phase 04 P01 | 16min | 2 tasks | 18 files |
| Phase 04 P02 | 18min | 2 tasks | 18 files |
| Phase 04 P03 | 9min | 2 tasks | 5 files |
| Phase 04 P04 | 16min | 2 tasks | 20 files |
| Phase 04 P05 | 12min | 2 tasks | 21 files |
| Phase 04 P06 | 18min | 2 tasks | 9 files |
| Phase 04 P07 | 34min | 2 tasks | 4 files |
| Phase 04 P09 | 18min | 3 tasks | 22 files |
| Phase 05 P01 | 25min | 2 tasks | 7 files |
| Phase 05 P02 | 16min | 2 tasks | 23 files |
| Phase 05 P06 | 8min | 2 tasks | 8 files |
| Phase 05 P09 | 12min | 3 tasks | 8 files |
| Phase 05 P03 | 18min | 2 tasks | 12 files |
| Phase 05 P04 | 12min | 2 tasks | 8 files |
| Phase 05 P07 | 18min | 2 tasks | 5 files |
| Phase 05 P05 | 16min | 2 tasks | 7 files |
| Phase 05 P08 | 34min | 2 tasks | 11 files |
| Phase 05 P10 | 18min | 2 tasks | 10 files |
| Phase 05 P11 | 16min | 2 tasks | 6 files |
| Phase 05-provider-aware-coverage-and-enrichment P12 | 31min | 2 tasks | 10 files |
| Phase 05-provider-aware-coverage-and-enrichment P13 | 12min | 2 tasks | 5 files |
| Phase 05-provider-aware-coverage-and-enrichment P14 | 9min | 2 tasks | 5 files |
| Phase 05 P15 | 1h 5m | 3 tasks | 16 files |
| Phase 05-provider-aware-coverage-and-enrichment P16 | 23m | 2 tasks | 7 files |
| Phase 06 P01 | 12min | 2 tasks | 5 files |
| Phase 06 P02 | 5h 6m | 3 tasks | 8 files |
| Phase 06 P04 | 5h 8m | 3 tasks | 9 files |
| Phase 06 P03 | 4h 54m | 2 tasks | 7 files |
| Phase 06 P05 | 5h 3m | 2 tasks | 4 files |
| Phase 06 P06 | 5min | 1 tasks | 4 files |
| Phase 06 P07 | 9min | 2 tasks | 19 files |
| Phase 06 P08 | 35min | 2 tasks | 9 files |
| Phase 06 P09 | 2d | 3 tasks | 19 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

- [Roadmap]: Six vertical MVP slices preserve auditability before provider breadth.
- [Roadmap]: Evaluation closes the evidence loop before fallback providers and enrichment are added.
- [Phase 1]: Provider identity is canonicalized independently of external IDs; ambiguity is resolved through append-only audited decisions.
- [Phase 1]: Capability and request-budget authorization are durable, fail closed, and occur before provider calls.
- [Phase 1]: Betting analytics remain server-gated while neutral fixture discovery stays public.
- [Phase 2]: Component provenance matches receipt inputs on fixture, effective time, observed time, payload hash, and payload byte count.
- [Phase 2]: Malformed receipt inputs are discarded at projection time so only dependent components fail closed while valid siblings remain visible.
- [Phase 2]: The live evidence gate owns a uniquely named PostgreSQL container and exact child PIDs, and cleanup targets only those recorded resources.
- [Phase 2]: Browser assertions compare the production Nest payload with the Next DOM without installing any request interception.
- [Phase 02]: PostgreSQL clock and row locks own replay execution lease decisions.
- [Phase 02]: Every possible remote dispatch receives a distinct attempt-specific budget reservation.
- [Phase 02]: Canonical publication and durable success commit under the same fencing-token transaction.
- [Phase 3]: Phase 03: Normalize all supported markets from one retained 64-cell score matrix and disclose tail mass separately.
- [Phase 3]: Phase 03: Treat evidence and confidence failures as ordered tagged abstentions while reserving exceptions for malformed calculation contracts.
- [Phase 3]: Phase 03: Use forecast-config-v1 minimum samples of goal rates 5, Elo 1, form 3, venue 3, rest 1, and optional H2H 3 as transparent starting policy.
- [Phase 3]: Phase 03: Order value gates as policy, canonical identity, cutoff, data quality, confidence, edge, then expected value.
- [Phase 3]: Phase 03: Treat issued forecast identity and input facts as permanent; corrections append linked revisions.
- [Phase 3]: Phase 03: Require exact fixture- and market-compatible forecast and odds snapshot IDs for each value receipt.
- [Phase 3]: Phase 03: Use one strict forecast DTO across API and worker boundaries.
- [Phase 3]: Phase 03: Derive forecast and job identities from exact cutoff, model/config, and sorted evidence fingerprints.
- [Phase 3]: Phase 03: Reject unknown odds fields before persistence and derive value receipt identity from the exact forecast/odds pair.
- [Phase 3]: Phase 03: Forward eligibility facts from server-only configuration and expose only allowlisted proxy response headers.
- [Phase 3]: Phase 03: Keep incomplete odds books in versioned fixture/market local drafts until immutable submission succeeds.
- [Phase 3]: Exact forecast/odds pairing binds immutable IDs, fixture, market, and contents without requiring equal capture timestamps.
- [Phase 3]: Concurrent immutable IDs converge only for identical canonical payloads; conflicting reuse remains an error.
- [Phase 3]: Phase 3 acceptance evidence uses durable PostgreSQL data and production Nest/Next boundaries rather than mocked analysis responses.
- [Phase 4]: Phase 04: Settlement identity is the exact ResultVersion, ForecastSnapshot, and policy hash tuple.
- [Phase 4]: Phase 04: Corrections append linked settlement revisions under a fixture-scoped PostgreSQL advisory lock.
- [Phase 4]: Phase 04: Use unscaled categorical Brier sum and natural Log Loss clipped at epsilon 1e-15.
- [Phase 4]: Phase 04: Score corrections append linked facts and current aggregates include only leaf revisions.
- [Phase 4]: Phase 04: Reliability expands each categorical score into one binary event per selection before deterministic bucket aggregation.
- [Phase 4]: Phase 04: Only populated buckets participate in the minimum-bucket cohort health gate; empty buckets remain visible as insufficient.
- [Phase 4]: Phase 04: Cohort policy identities hash exact serialized thresholds so changed gates cannot silently relabel evidence.
- [Phase 4]: Phase 04: ROI and Yield are disclosed aliases of totalProfitUnits / totalStakedUnits under flat-one-unit-v1.
- [Phase 4]: Phase 04: CLV requires an explicitly labeled market-close observation with an exact comparable tuple.
- [Phase 4]: Phase 04: Production and backtest forecasts share ForecastOrchestrator.run; future evidence fails closed before publication.
- [Phase 4]: Phase 04 acceptance seeds canonical sources and invokes the production settlement service before comparing PostgreSQL, Nest JSON and browser DOM.
- [Phase 4]: Phase 04: Forecast evidence uses forecastCutoff while result knowledge independently uses evaluationAsOf.
- [Phase 4]: Phase 04: BullMQ carries only plan identity and hash; workers reconstruct immutable work from PostgreSQL.
- [Phase 05]: Phase 05: Provider names use a closed production registry while external IDs remain provenance-only.
- [Phase 05]: Phase 05: API-Football envelopes must match exact request parameters and league/season entities before normalization.
- [Phase 05]: Phase 05: Transport, rate-limit, and 5xx failures are fallback-eligible; payload violations quarantine.
- [Phase 05]: Phase 05: Provider admission locks the provider, endpoint and UTC request day before counting reservations.
- [Phase 05]: Phase 05: Observed quota facts may only narrow configured capacity; later wider observations cannot restore capacity.
- [Phase 05]: Phase 05: Successful attempts require an exact provider-matching immutable SourceObservation; denied attempts carry no response fact.
- [Phase 05]: Phase 05: Forecast comparison validates both requested IDs, ISSUED state and fixture ownership before calculating any delta.
- [Phase 05]: Phase 05: Availability always projects INITIAL, PRE_MATCH and LINEUP_CONFIRMED in fixed order, with exact receipts or closed reason codes.
- [Phase 05]: Phase 05: Probe artifacts remain pending and non-authoritative until promoted through the OperatorGuard-protected Nest route.
- [Phase 05]: Phase 05: Invalid approval evidence appends a denied route attempt for its exact scope without changing unrelated capability records.
- [Phase 05]: Phase 05: Approval idempotency keys converge concurrent requests to one durable decision.
- [Phase 05]: Phase 05: Fallback fixture identity resolves external refs first, then exactly one canonical participant match inside a versioned 15-minute kickoff window.
- [Phase 05]: Phase 05: Provider fallback is a closed two-attempt list; UEL and UECL are API-Football sole-source with timestamped NO_FALLBACK state.
- [Phase 05]: Phase 05: Optional enrichment constructs provider I/O only after exact capability, closed circuit and provider-wide optional reservation.
- [Phase 05]: Phase 05: LINEUP_CONFIRMED requires an official same-fixture source observed no later than cutoff; empty enrichment remains OBSERVED_EMPTY.
- [Phase 05]: Phase 05: Forecast comparison URL IDs initialize once and are never substituted by refresh or discovery.
- [Phase 05]: Phase 05: Web renders only server-authoritative comparison deltas after verifying echoed exact snapshot IDs.
- [Phase 05]: Phase 05: Provider degradation is an orthogonal safe DTO and never replaces or duplicates canonical fixture identity.
- [Phase 05]: Phase 05: Fixture surfaces disclose only receipt ID, policy version, outcome and trigger from durable provider routes.
- [Phase 05]: Phase 05: TheSportsDB enrichment remains a structurally review-only, provenance-bearing input and never production match evidence.
- [Phase 05]: Phase 05: Provider logos are exposed only as opaque references after HTTPS, host, DNS/IP, redirect, MIME, size and signature validation.
- [Phase 05]: Phase 05: Browser logo requests use only server-signed opaque references through guarded application routes.
- [Phase 05]: Phase 05: Provider image bytes require public network destinations, allowlisted MIME plus signature, bounded size and restrictive response headers.
- [Phase 05]: Phase 05: Provider season external IDs are scoped by provider plus canonical league so identical API-Football season values can coexist across PL, UEL and UECL without ambiguous lookup.
- [Phase 05]: Phase 05: Provider factories are constructed only after durable admission and admitted attempts reach exactly one classified terminal state.
- [Phase 05]: Phase 05: ADMITTED-to-terminal is the only permitted provider-attempt update; identity fields and historical observations remain immutable.
- [Phase 05]: Phase 05: Every production endpoint resolves provider request identities from canonical league and season IDs before constructing a client.
- [Phase 05]: Phase 05: Provider credentials remain isolated in a closed factory map and the selected factory is constructed only after durable admission.
- [Phase 05]: Provider season identity is provider + canonical leagueId + exact externalId.
- [Phase 05]: SeasonExternalRef league consistency is enforced by a composite foreign key.
- [Phase 05]: Phase 5 live acceptance uses owned migrated PostgreSQL/Redis and real worker, Nest and Next boundaries without interception.
- [Phase 05]: Strict forecast comparison strips repository-only state only after persisted-state validation.
- [Phase 06]: Phase 06: The release tracer extends the proven Phase 05 owned stack with a dedicated BullMQ settlement worker and exact queue prefix.
- [Phase 06]: Phase 06: Limited forecast evidence remains fail-closed as INSUFFICIENT_EVIDENCE rather than being fabricated into a value candidate.
- [Phase 06]: Render desktop tables and mobile conclusion-first cards from one typed evidence projection so semantics cannot drift by breakpoint.
- [Phase 06]: Keep retry state local to forecast availability, retain the last valid content, and restore focus to the retry control after a failed retry.
- [Phase 06]: Phase 06: Operations projections use explicit Prisma selects and closed scalar DTO constructors so raw payloads, secrets, headers, environments, stacks, arbitrary metadata, and logs never cross the browser boundary.
- [Phase 06]: Phase 06: Operations failure details are bounded to 25 safe logical job identities per page behind canonical signed HMAC ingress.
- [Phase 06]: Phase 06: Public methodology binds directly to executable forecast and evaluation constants so disclosed identities cannot drift.
- [Phase 06]: Phase 06: Contextual methodology links are fixed fragment-only URLs and never carry analytical activity state.
- [Phase 06]: Phase 06: Recovery reasons are frozen at preview time and bounded to 10-500 characters.
- [Phase 06]: Phase 06: Evaluation recovery identity is exact ResultVersion, ForecastSnapshot, and policy hash.
- [Phase 06]: Phase 06: Recovery confirmation re-locks and revalidates the frozen preview before converging to one durable plan and delivery.
- [Phase 06]: Phase 06: Durable personal-history opt-in remains disabled unless an approved signed subject-provider adapter and retention duration, policy version, and effective date are all configured.
- [Phase 06]: Phase 06: Withdrawal locks the subject boundary, revokes consent, deletes all linkable retained odds/view history, invalidates related cache, denies future writes, and leaves no reverse link in logs or immutable receipts.
- [Phase 06]: Phase 06: No subject mechanism, retention duration, policy version, or effective date was supplied or may be invented.
- [Phase 06]: Durable retention stays unavailable until signed subject mode, duration, policy version, and effective timestamp are all explicitly configured.
- [Phase 06]: Personal odds and viewed-result history remains cascade-deletable and one-way linked; immutable analytical facts have no reverse subject link.
- [Phase 06]: Phase 06: Privacy ingress accepts only bounded HMAC-signed subject-provider assertions and otherwise fails closed.
- [Phase 06]: Phase 06: Consent, retained writes, and withdrawal serialize on one subject row; only serialization conflicts are retried.
- [Phase 06]: Phase 06: Cache invalidation failure rolls back withdrawal and can never produce a success response.
- [Phase 06]: Phase 06: Cache invalidation failure rolls back withdrawal and can never produce a success response.
- [Phase 06]: Phase 06: Desktop and mobile Chromium are the declared automated browser support matrix; broader support requires an explicit release project.
- [Phase 06]: Phase 06: The release integration gate uses parent-owned PostgreSQL and Redis with awaited child supervision and exact test-owned BullMQ cleanup.

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Launch jurisdiction and age-policy details require a concrete product/legal decision during planning.
- [Phase 4]: Settlement taxonomy and minimum calibration/sample gates need explicit thresholds.
- [Phase 5]: Live provider coverage and quota/reset semantics must be reverified with current credentials.
- [Phase 5 2026-10-15]: Verified with real credentials: football-data.org free tier excludes UEFA
  Europa League (403 restricted) and API-Football free plan blocks the current season 2026
  entirely ("access to seasons 2022-2024"). UEL shows a honest restricted state in the UI; an
  api-football fetch path was not built because it cannot deliver upcoming fixtures either.
- [Ops 2026-10-16]: Result publication after matchdays is manual — `POST /internal/fixtures/results-sync`
  must be called per matchday; there is no scheduled results job yet (forecast evidence and
  scorecards depend on it).
- [Ops 2026-10-16]: Importing `workers/data-sync/src/main.ts` from tests executed its top-level
  `start()`; a test process whose env carried DATABASE_URL/REDIS_URL/provider tokens booted a
  second sweep-enabled worker against the dev DB (root cause of the 09:02Z empty-evidence
  INITIAL snapshots). FIXED in quick 261016-kpi: auto-start is now behind a main-module entry
  check (`isDirectExecution()`), imports are side-effect-free, hermetic unit test guards it.
- [Ops 2026-10-16]: The stack must run with `turbo run dev --env-mode=loose` (or direct `node dist/main.js`);
  turbo's default strict env mode strips `.env` values so the worker reports readiness false and
  exits without ticking. Background shells holding API/worker/web do NOT survive an OpenCode
  session restart — restart the stack after resuming a session.
- [Ops 2026-10-16]: Data loading is MANUAL ONLY (quick 261016-l90 + .env FIXTURES_AUTO_SYNC=false):
  no page-mount sync, sweep is DB-only, 288 stale enrichment jobs flushed from Redis. Refresh data
  explicitly via the "Обновить матчи" button, `POST /internal/fixtures/sync` or
  `POST /internal/fixtures/results-sync` (operator headers via curl.exe). Verified: two full
  /fixtures reloads left the quota unchanged at 75/100; enrichment queue stayed empty across sweep
  ticks. Do NOT re-enable FIXTURES_AUTO_SYNC without user consent.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 261016-a87 | Add dynamic eligibility decision timestamp so protected analytics pages pass the guard with region PL | 2026-10-16 | fd38793 | [261016-a87-add-dynamic-eligibility-decision-timesta](./quick/261016-a87-add-dynamic-eligibility-decision-timesta/) |
| 261016-bf3 | Auto-issue INITIAL and PRE_MATCH forecasts from a periodic evidence-building sweep | 2026-10-16 | 42c0761 | [261016-bf3-auto-issue-initial-and-pre-match-forecas](./quick/261016-bf3-auto-issue-initial-and-pre-match-forecas/) |
| 261016-d9t | Windowed fixtures backfill and production results-sync endpoint | 2026-10-16 | 2083eaf | [261016-d9t-windowed-fixture-backfill-and-production](./quick/261016-d9t-windowed-fixture-backfill-and-production/) |
| 261016-exf | Retrieve past finished fixtures in date windows with per-chunk budget reserves | 2026-10-16 | 106ee4e | [261016-exf-retrieve-past-finished-fixtures-in-windo](./quick/261016-exf-retrieve-past-finished-fixtures-in-windo/) |
| 261016-k3w | Fix bare /scorecards navigation: default cohort from/to bounds so landing without query renders the dashboard instead of 400 INVALID_FROM error | 2026-10-16 | c6b1603 | [261016-k3w-fix-bare-scorecards-navigation-default-c](./quick/261016-k3w-fix-bare-scorecards-navigation-default-c/) |
| 261016-kpi | Guard top-level auto-start in workers/data-sync/src/main.ts behind a main-module entry check so importing from tests never boots a background forecast sweep | 2026-10-16 | 0ffc248 | [261016-kpi-guard-top-level-auto-start-in-workers-da](./quick/261016-kpi-guard-top-level-auto-start-in-workers-da/) |
| 261016-l90 | Restrict provider data loading to manual sync only: drop the forecast sweep's automatic enrichment enqueue and stop hardcoding FIXTURES_AUTO_SYNC in dev-full.ps1 | 2026-10-16 | ea86607 | [261016-l90-manual-only-data-loading-drop-the-sweep-](./quick/261016-l90-manual-only-data-loading-drop-the-sweep-/) |
| 261016-nbo | Show team name instead of a raw cuid on the evidence page heading: API evidence response now carries team/fixture display entities and the web heading omits ids when a name is missing | 2026-10-16 | 31ad67f | [261016-nbo-team-evidence-page-shows-a-raw-cuid-in-t](./quick/261016-nbo-team-evidence-page-shows-a-raw-cuid-in-t/) |
| 261016-ooi | Make manual sync refresh fixture freshness and record provider route receipts: FixtureProvenance upserts observedAt on identical payloads so STALE clears on refresh, and successful league syncs write a ProviderRouteReceipt with a SUCCEEDED attempt so the coverage badge clears | 2026-10-16 | b0ae96e | [261016-ooi-fixture-freshness-and-provider-coverage-](./quick/261016-ooi-fixture-freshness-and-provider-coverage-/) |
| fast-261017 | Issue INITIAL forecasts seven days before kickoff instead of 24 hours so users can place bookmaker bets days ahead; PRE_MATCH stays at kickoff-6h, boundary tests updated | 2026-10-17 | e94b4da | inline (gsd-fast) |
| fast-261017b | Add double-click launcher for the local stack without a terminal: app-lifecycle.ps1 runs docker/migrations/build and a detached dev daemon (log %TEMP%\bet-stats-stack.log), start/stop .bat wrappers, desktop shortcuts | 2026-10-17 | 2442516 | inline (gsd-fast) |
| fast-261017c | Issue INITIAL forecasts as soon as a fixture enters the 14-day sweep horizon so every listed upcoming match has probabilities; empty workbench state explains INITIAL/PRE_MATCH timing | 2026-10-17 | 365d5aa | inline (gsd-fast) |
| fast-261017d | Show team names instead of raw fixture ids in the evidence trace table: API attaches fixtureLabels from receipt inputs and component source refs, web renders label with id fallback | 2026-10-17 | d3b4583 | inline (gsd-fast) |

### Roadmap Evolution

- Phase 6 edited: edited field: goal (MVP user-story framing; preserved nine completed plans)

## Deferred Items

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-10-16T05:45:00.000Z
Stopped at: Quick task 261016-a87-add-dynamic-eligibility-decision-timesta - atomic commit on main
Resume file: .planning/quick/261016-a87-add-dynamic-eligibility-decision-timesta/PLAN.md
