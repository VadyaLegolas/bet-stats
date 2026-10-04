# Football Prediction & Value Betting Platform — Specification

## 1. Project Goal

Build a web application that automatically analyzes upcoming football matches from the top five European leagues and UEFA competitions, estimates event probabilities, and identifies potential value-bet opportunities.

The application must not claim that a bet will win. It must estimate probabilities and compare them with market odds.

## 2. Supported Competitions

- Premier League
- La Liga
- Serie A
- Bundesliga
- Ligue 1
- UEFA Champions League
- UEFA Europa League (see data source constraint, section 3)
- Optional: UEFA Conference League (see data source constraint, section 3)

The competition list must be configurable.

## 3. Data Sources and Fallback Strategy

The MVP must use only free tiers. **Actual free-tier limitations (verified as of 2026) are meaningfully narrower than they first appear, so the strategy below is written honestly rather than optimistically.** This isn't two interchangeable sources — it's a role map: each source has a strictly bounded responsibility, and they must not be mixed.

### 3.1 Primary fixtures/standings source — football-data.org Free
- Limit: 10 requests/minute.
- Covers 12 competitions: the top-5 leagues + Champions League + a few others. **Europa League and Conference League are NOT part of the free list.**
- Lineups, detailed statistics, and odds are paid add-ons, not available for free.
- Role: **prod**, primary fixtures/standings source for the top-5 leagues + UCL.

### 3.2 Fallback fixtures/lineups source — API-Football Free
- Limit: ~100 requests/day.
- Actually free: fixtures, standings, teams, lineups (once confirmed).
- **Not guaranteed on the free tier**: injuries, odds, predictions, detailed statistics — per the provider's pricing page these sit behind paid tiers (Pro and above). The app must check the `coverage` flags programmatically before calling an endpoint and must not assume this data is available by default.
- Role: **prod**, fallback for top-5+UCL, and the primary source for Europa League / Conference League (which football-data.org does not cover at all).

### 3.3 Entity normalization — TheSportsDB Free
- Limit: 30 requests/min (test key), community-driven data — lower accuracy than the prod sources.
- Role: **entity-aid, not a stats source**. Used only to feed the `TeamExternalRef`/`PlayerExternalRef` layer (see section 14) — TheSportsDB carries many alternate team-name spellings, which simplifies fuzzy matching between football-data.org and API-Football. Team logos also come from here.
- Do not use it as a source of live stats or match results.

### 3.4 xG and advanced statistics — three distinct roles, don't conflate them
- **Understat** — xG/PPDA for the top-5 leagues. Not an official API: data is embedded as JSON inside HTML, accessed via unofficial scraping. Role: **caution** — use only with an explicit rate limit and caching, understanding that access can be blocked at any time; must not be a hard MVP dependency.
- **FBref** — lost its Opta data license in January 2026: **current/live advanced stats (xG, etc.) no longer update**, only the historical archive stays complete. Role: **historical-only** — fine for training/validating the model on past seasons, not for live current-season features.
- **StatsBomb Open Data** (GitHub, JSON, official Python/R packages) — top-quality event-level data with xG, but covers only selected historical competitions and seasons (not live top-5 leagues for the current season). Role: **training-only** — calibration and backtesting of the Poisson/Elo model against reference data, not wired into the prod pipeline.

### 3.5 Product implications (important)
1. Europa League / Conference League don't lose data entirely when the primary source fails — they fall over to API-Football (see section 3.2) — but this doesn't work the other way (if API-Football is down, EL/UECL has no fallback). Explicitly show the user a "limited data" status for these competitions when API-Football degrades.
2. Injuries and odds should not be designed as "automatically available for free" — in practice, in the MVP this will either be absent or based on manual user input. Manual odds entry is not a fallback in this spec; it is the primary mechanism for the MVP.
3. Before every call to API-Football, check the `coverage` object for the specific league/season so the request budget is not spent on endpoints known to be unavailable.
4. The sources in 3.3–3.4 are outside the prod pipeline's DailyApiBudget (section 13): TheSportsDB has its own separate budget as an entity-aid service, and the training-only/caution sources (FBref, StatsBomb, Understat) are never called synchronously while processing live matches — only offline, in batch jobs outside the user-facing path.

The MVP must not require:
- paid APIs;
- paid xG providers;
- paid odds providers;
- scraping that violates a source's Terms of Service.

## 4. Core Features

The system must:

1. discover upcoming fixtures;
2. persist fixtures in PostgreSQL;
3. collect recent team match history;
4. calculate 5-match and 10-match form;
5. analyze home and away form separately;
6. calculate Elo ratings;
7. use H2H with low predictive weight;
8. account for injuries, suspensions and unavailable players **only when confirmed by a source's coverage flag or entered manually**;
9. use confirmed lineups when available;
10. calculate probabilities using Poisson + Elo + form;
11. support 1X2, Double Chance, Over/Under and BTTS;
12. ingest bookmaker odds **primarily via manual user input** (see section 3.5);
13. calculate implied probability, edge and expected value;
14. persist immutable prediction snapshots;
15. perform backtesting after matches finish;
16. expose results through a React/Next.js interface;
17. reconcile entities (teams, players, matches) across data providers so that switching to the fallback source does not create duplicates (see section 14).

## 5. Stack

### Frontend
- Next.js
- React
- TypeScript
- Tailwind CSS
- TanStack Query
- Recharts

### Backend
- Node.js
- TypeScript
- NestJS

### Data
- PostgreSQL
- Prisma
- Redis
- BullMQ

### Prediction V1
- TypeScript
- Poisson
- Elo

### Prediction V2+
- Python
- FastAPI
- pandas
- NumPy
- scikit-learn
- XGBoost or LightGBM

## 6. Data and Features

Use only fields that are actually available from free sources.

Candidate features:
- wins / draws / losses;
- goals for / against;
- goals per match;
- clean sheets;
- failed to score;
- shots;
- shots on target;
- possession;
- corners;
- yellow/red cards;
- league position;
- rest days;
- home/away form;
- Elo difference;
- H2H;
- missing-player impact;
- confirmed-lineup status.

## 7. Weighted Form

Recent games receive greater weight.

Example:
- match -1: 1.00
- match -2: 0.90
- match -3: 0.80
- match -4: 0.70
- match -5: 0.60

## 8. Prediction Engine V1

Base model:

Poisson + Elo + Recent Form + Home/Away Strength + H2H + Missing Players

Poisson calculates lambdaHome and lambdaAway, then builds a score probability matrix from at least 0:0 to 7:7.

Derived markets:
- Home / Draw / Away;
- 1X / X2 / 12;
- Over/Under 1.5;
- Over/Under 2.5;
- Over/Under 3.5;
- BTTS Yes/No;
- team totals.

## 9. Value Bet Engine

For decimal odds:

`impliedProbability = 1 / odds`

For multi-outcome markets normalize probabilities to remove bookmaker overround.

The MVP baseline is multiplicative normalization (sum of probabilities divided by sum of implied probabilities). It's simple but biases the estimate toward favorites/longshots (favorite-longshot bias). For V2, plan for a more accurate overround-removal method (e.g. Shin's method or the power method) as a configurable `oddsNormalizationMethod` option.

`edge = modelProbability - marketProbability`

`EV = modelProbability * odds - 1`

Recommended default filter:
- Edge >= 5%
- EV > 0

## 10. Confidence Score

Confidence is not the event probability.

Range: 0–100.

### 10.1 Components and Formula

Confidence must be computed as an explicit weighted sum, not left as a qualitative description:

```
confidence =
    dataCompletenessScore   * 0.30  +
    lineupConfirmedScore    * 0.25  +
    dataFreshnessScore      * 0.20  +
    sourceReliabilityScore  * 0.15  +
    modelStabilityScore     * 0.10
```

Where:
- `dataCompletenessScore` (0–100) — share of required fields actually populated for this fixture;
- `lineupConfirmedScore` — 100 if the lineup is confirmed (LINEUP_CONFIRMED snapshot), 40 if only predicted, 0 if unavailable;
- `dataFreshnessScore` — decays as data ages relative to kickoff (scale defined in config);
- `sourceReliabilityScore` — pulled from `DataQualityLog` (see schema, section 14) for the specific provider;
- `modelStabilityScore` — historical variance of predictions from the same model version on similar fixtures.

Weights must live in configuration, not be hardcoded — they will be calibrated as backtesting data accumulates.

## 11. Prediction Snapshots

Predictions must never be changed retroactively.

Snapshot types:
- INITIAL
- PRE_MATCH
- LINEUP_CONFIRMED
- FINAL

Every snapshot must include capturedAt.

## 12. Backtesting

After matches finish calculate:
- Brier Score;
- Log Loss;
- Accuracy;
- Calibration;
- ROI;
- Yield;
- CLV when historical odds are available.

All backtests must prevent data leakage.

## 13. API Budget

Target: fewer than 100 external requests per day (this is API-Football Free's limit specifically; football-data.org is tracked separately, at 10 requests/minute).

The budget must be tracked **per provider and per endpoint type separately** (fixtures, results, lineups, injuries, odds, misc), not as one aggregate number — otherwise the prioritization from ARCHITECTURE.md has nothing to enforce it programmatically.

Update priority:
1. fixtures;
2. results;
3. lineups before kickoff;
4. injuries (only if coverage is confirmed);
5. odds (only if coverage is confirmed; otherwise manual entry);
6. secondary statistics.

Historical data must be persisted and not downloaded repeatedly without need.

## 14. Entity Matching and Fixture Reconciliation

Because the primary and fallback sources assign different external IDs to the same team/player/match, a plain `provider + externalId` field on the entity itself **creates duplicates** when switching sources. Therefore:

- Team and Player are stored as canonical entities; the link to a specific provider is moved into separate `TeamExternalRef` / `PlayerExternalRef` tables (see schema.prisma).
- When data arrives from a new provider, first look up an existing canonical Team/Player by name + country (fuzzy match); only create a new canonical record if no match is found.
- Fixture reconciliation runs on the pair (canonical homeTeamId, canonical awayTeamId, kickoff within a ±36-hour window) — if a matching record already exists from another provider, the new externalId is attached to that same Fixture instead of creating a duplicate.
- All matching decisions are logged (what was matched to what, and why) so they can be manually reviewed in the admin panel.

## 15. Legal, Ethical and Responsible Gambling Requirements

- The application must never claim guaranteed profit in any UI text, notification, or marketing copy; wording is limited to "probability estimate", "analytical forecast".
- Every prediction screen carries a persistent disclaimer about betting risk and the probabilistic nature of the forecast.
- The MVP does not place bets automatically and does not integrate with bookmaker APIs for execution.
- Age restrictions and the availability of betting-related features must respect the user's jurisdiction (a configurable region flag).
- Use of data sources must comply with their Terms of Service; scraping outside ToS is prohibited.
- User personal data (saved matches, prediction history) is stored with privacy requirements in mind; storing betting-related behavioral data requires separate consent.
- Self-exclusion / activity limits are out of scope for the MVP; record as a future roadmap item.

## 16. REST API

- GET /api/fixtures/upcoming
- GET /api/fixtures/:id
- GET /api/fixtures/:id/statistics
- GET /api/fixtures/:id/prediction
- GET /api/predictions/today
- GET /api/value-bets
- GET /api/teams/:id
- GET /api/teams/:id/form
- GET /api/models/performance
- GET /api/backtest

## 17. MVP Definition of Done

The MVP is complete when it can automatically:
1. fetch upcoming fixtures;
2. persist fixtures;
3. retrieve team history;
4. calculate form;
5. calculate Elo;
6. run Poisson;
7. generate 1X2 probabilities;
8. generate O/U 2.5 probabilities;
9. generate BTTS probabilities;
10. display predictions in the UI;
11. save a prediction snapshot;
12. retrieve the final result;
13. evaluate the quality of the previous prediction;
14. correctly reconcile entities across providers without creating duplicate teams or matches.
