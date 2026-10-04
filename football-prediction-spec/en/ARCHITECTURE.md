# Project Architecture

## 1. High-Level Diagram

```text
Free Football APIs
        |
        v
Data Collector
        |
        +--> Redis Cache
        |
        v
PostgreSQL + Prisma
        |
        +--> Feature Engine
        +--> Elo Engine
        +--> Poisson Engine
        +--> Odds Engine
        +--> Value Bet Engine
        +--> Backtest Engine
        |
        v
NestJS REST API
        |
        v
Next.js / React
```

## 2. Components

### apps/web
User interface:
- fixtures list;
- match page;
- predictions;
- value bets;
- model performance;
- backtesting.

### apps/api
Main backend:
- REST API;
- orchestration;
- future authentication;
- competition configuration;
- database access;
- background job scheduling.

### workers/data-sync
Background jobs:
- fixtures sync;
- results sync;
- standings sync;
- injuries sync;
- lineups sync;
- odds sync.

### packages/database
- Prisma schema;
- Prisma Client;
- migrations;
- seed.

### packages/domain
Shared domain types and enums.

### packages/football-data
Abstraction over external data sources. Providers are split by role — not all of them implement the same interface, because not all sources carry the same responsibility (see SPEC.md section 3).

```ts
// Prod sources for live data (fixtures, standings, lineups)
interface FootballDataProvider {
  getUpcomingFixtures(): Promise<FixtureDto[]>;
  getTeamRecentMatches(teamId: string): Promise<FixtureDto[]>;
  getStandings(leagueId: string): Promise<StandingDto[]>;
  getInjuries(fixtureId: string): Promise<InjuryDto[]>;   // may throw NotCoveredError
  getLineups(fixtureId: string): Promise<LineupDto[]>;
  getOdds(fixtureId: string): Promise<OddsDto[]>;          // may throw NotCoveredError
  getCoverage(leagueId: string, season: string): Promise<CoverageFlagsDto>;
}
// Implementations: FootballDataOrgProvider (primary, top-5+UCL),
// ApiFootballProvider (fallback for top-5+UCL, primary for EL/UECL)

// Entity-aid source — name/logo normalization only,
// not used for match statistics
interface EntityResolutionProvider {
  searchTeamByName(name: string, country?: string): Promise<TeamCandidateDto[]>;
  getTeamLogo(externalId: string): Promise<string | null>;
}
// Implementation: TheSportsDbProvider

// Offline/training-only sources — called only by batch jobs
// outside the user-facing path, never synchronously while processing a live match
interface HistoricalStatsProvider {
  getHistoricalMatchEvents(competitionId: string, season: string): Promise<MatchEventsDto[]>;
}
// Implementations: StatsBombOpenDataProvider (training-only, limited set of competitions/seasons),
// FBrefProvider (historical-only since January 2026 — current-season xG no longer updates)

// Caution source — unofficial access, not a hard MVP dependency
interface CautionStatsProvider {
  getXgStats(teamId: string, season: string): Promise<XgStatsDto[]>;
}
// Implementation: UnderstatProvider (unofficial scraping, strict rate limit and caching)
```

### packages/prediction
Contains:
- Elo;
- Poisson;
- feature builder;
- probability normalization;
- market calculations.

### packages/value-betting
Contains:
- implied probability;
- overround removal;
- edge;
- EV;
- value-bet filters.

### packages/backtesting
Contains:
- Brier Score;
- Log Loss;
- calibration;
- ROI/Yield;
- model comparison.

## 3. Data Flows

### Morning sync
1. Fetch fixtures for today and the next 48 hours.
2. Update completed fixtures.
3. Update standings.
4. Build features.
5. Create INITIAL snapshots.

### Before kickoff
1. Check injuries.
2. Check odds.
3. Recalculate PRE_MATCH snapshot.
4. Check lineups close to kickoff.
5. When official lineups exist, create LINEUP_CONFIRMED snapshot.

### After the match
1. Persist the result.
2. Update Elo.
3. Calculate backtest metrics.
4. Resolve BetCandidate result.

## 4. API Limit Protection

DailyApiBudget is tracked per combination of provider + date + endpointType (see schema.prisma), not as one aggregate number — otherwise the priority tiers below have nothing to enforce them programmatically: the worker must check the remaining budget for the specific endpoint type before calling it.

Priority levels:
- CRITICAL (1): fixtures/results;
- HIGH (2): lineups;
- MEDIUM (3): injuries/odds — **only if the provider's coverage flag confirms free-tier availability**, otherwise the endpoint is not called at all and the data is treated as unavailable (see SPEC.md section 3);
- LOW (4): secondary statistics.

Before the first call to any endpoint for a league/season, the worker must read the provider's `coverage` object (where available) and cache the result — this saves daily request budget instead of spending it on data known to be unavailable.

## 4.1 Entity Matching and Fixture Reconciliation

Problem: API-Football and football-data.org assign different external IDs to the same team/player/match. Storing provider+externalId directly on Team/Fixture would create duplicates when switching to the fallback source instead of continuing the same entity's history.

Solution — a canonical entity layer (see schema.prisma):
- `Team` / `Player` / `League` are canonical, with no provider dependency;
- `TeamExternalRef` / `PlayerExternalRef` / `LeagueExternalRef` link a given provider+externalId to the canonical entity, with a `matchedBy` field (exact_id / fuzzy_name / manual_admin) for auditing;
- `FixtureExternalRef` does the same for matches; fixture reconciliation runs on the pair (canonical homeTeamId, canonical awayTeamId) + kickoff within a ±36-hour window, rather than on a direct external-ID match.

Sync pipeline when data arrives from a new provider:
1. Look up an existing `TeamExternalRef` by (provider, externalId) — if found, continue with the linked canonical Team.
2. If not found, search for a canonical Team by normalized name + country. On a match, create a new `TeamExternalRef` pointing at it.
3. On an ambiguous match (multiple candidates or low fuzzy-match confidence), do not auto-create — queue it for manual review in the admin panel.
4. Same logic for Fixture: look up `FixtureExternalRef` first, then fall back to the canonical team pair + date window.

All automatic matches are logged with `matchedBy` and a timestamp so fuzzy-match decisions can be spot-checked and reverted if wrong.

## 5. Caching

Suggested Redis TTL:
- fixtures: 6 hours;
- standings: 12 hours;
- injuries: 3 hours;
- odds: 30–60 minutes;
- lineups: 10 minutes close to kickoff;
- historical results: persistent in PostgreSQL.

## 6. Reliability

- idempotent jobs;
- unique constraints on external IDs (via *ExternalRef tables, see 4.1);
- retries with exponential backoff;
- provider error logging into `DataQualityLog` (feeds sourceReliabilityScore in the Confidence Score, see SPEC.md section 10.1);
- circuit breaker for unstable APIs;
- immutable prediction snapshots;
- **Europa League / Conference League**: these competitions have no fallback at all — only API-Football covers them (football-data.org's free tier excludes them entirely). So the circuit breaker cannot fail over to football-data.org for these competitions when API-Football degrades; instead of retrying indefinitely, the UI should mark their data status as "limited" (see SPEC.md section 3.5).

## 7. Scaling

The MVP can run as one backend plus one worker.

Later it can be split into:
- ingestion service;
- prediction service;
- ML service;
- backtest service.
