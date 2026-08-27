# Architecture Research

**Domain:** Football prediction and value-betting analytics platform
**Researched:** 2026-08-27
**Confidence:** MEDIUM

## Standard Architecture

### System Overview

Build a **modular monolith with an independently runnable worker**, not microservices. PostgreSQL is the system of record; Redis/BullMQ coordinates asynchronous work but is never the authoritative football-data store. Pure TypeScript domain packages contain prediction, market, and scoring logic so the API and workers call the same deterministic code.

```text
┌──────────────────────────────────────────────────────────────────┐
│ Next.js web                                                     │
│ fixtures · match analysis · manual odds · model performance     │
└──────────────────────────────┬───────────────────────────────────┘
                               │ versioned REST/JSON
┌──────────────────────────────▼───────────────────────────────────┐
│ NestJS API (modular monolith)                                   │
│ query/read modules · manual commands · admin reconciliation     │
└───────────────┬──────────────────────────────┬───────────────────┘
                │ commands/queries             │ enqueue only
┌───────────────▼─────────────────┐   ┌────────▼──────────────────┐
│ PostgreSQL system of record    │   │ Redis + BullMQ            │
│ canonical data, as-of inputs,  │   │ schedules, retries,       │
│ immutable forecasts, outcomes  │   │ priorities, deduplication │
└───────────────▲─────────────────┘   └────────┬──────────────────┘
                │ transactional writes         │ jobs
┌───────────────┴──────────────────────────────▼───────────────────┐
│ Worker process                                                  │
│ provider sync → reconcile → feature snapshot → forecast         │
│ result resolution → rating update → scoring/backtest            │
└───────┬──────────────────────────────────────────────────────────┘
        │ bounded provider ports
┌───────▼──────────────────────────────────────────────────────────┐
│ External adapters                                               │
│ football-data.org · API-Football · TheSportsDB entity aid       │
│ offline-only historical importers (separate command path)       │
└──────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Web | Read models, manual decimal-odds entry, limited-data display, responsible-gambling messaging | Next.js App Router, TanStack Query, feature folders |
| API | Authentication/region policy, validation, synchronous queries and manual commands; enqueue long-running work | NestJS feature modules and DTOs |
| Worker | Scheduled and event-driven orchestration; retryable provider calls and deterministic pipeline steps | Separate Nest application context with `@nestjs/bullmq` processors |
| Provider gateway | Provider-specific transport, coverage and budget policy, raw-response capture, normalized DTO output | Ports in `packages/football-data`, one adapter per provider |
| Reconciliation | Map provider identifiers to canonical leagues/teams/players/fixtures; quarantine ambiguity | Transactional application service plus review queue/table |
| Feature engine | Compute only information available at a declared `asOf` time; persist inputs used for a forecast | Pure functions plus immutable `FeatureSnapshot` record |
| Prediction engine | Elo/form/Poisson lambdas, score matrix, market probabilities, confidence components | Pure `packages/prediction` library with versioned configuration |
| Value engine | Validate odds, normalize overround per complete market, calculate edge and EV | Pure `packages/value-betting` library |
| Evaluation engine | Resolve outcomes and score the exact historical prediction/odds snapshots | Pure scoring functions plus worker-owned persistence |
| Database package | Prisma client, migrations, transactional repositories, database constraints | `packages/database` |
| Observability | Correlation IDs, job attempts, provider health, data-quality and budget metrics | Structured logs plus application metrics |

## Recommended Project Structure

```text
apps/
├── web/                         # Next.js UI and server-side API client
└── api/                         # NestJS HTTP composition root
    └── src/modules/             # fixtures, predictions, odds, performance, admin
workers/
└── pipeline/                    # one deployable worker, multiple queues/processors
    └── src/processors/          # sync, reconcile, forecast, resolve, evaluate
packages/
├── domain/                      # IDs, enums, market contracts, domain errors
├── database/                    # Prisma schema/client/repositories/migrations
├── football-data/
│   ├── src/ports/               # provider and raw-ingest contracts
│   ├── src/policy/              # routing, coverage, budgets, circuit state
│   └── src/adapters/            # provider-specific implementations
├── reconciliation/              # canonical matching and review decisions
├── prediction/                  # as-of features, Elo, Poisson, market derivation
├── value-betting/               # odds normalization, edge, EV
├── evaluation/                  # outcome rules, proper scores, calibration, ROI
├── contracts/                   # versioned API DTO schemas; no ORM models
├── config/                      # validated runtime and model configuration
└── ui/                          # reusable presentational components only
tools/
└── historical-import/           # offline FBref/StatsBomb/optional Understat path
infra/                           # local Postgres/Redis and deployment manifests
```

### Structure Rationale

- **One API and one worker:** gives process isolation for slow/retryable work without the operational cost of microservices.
- **Domain packages are framework-free:** forecasts and evaluation can be tested and replayed without NestJS, Redis, or HTTP.
- **Provider policy is separate from adapters:** coverage, routing, budget reservation, and degradation are product rules, not HTTP-client details.
- **Reconciliation is a first-class package:** it is upstream of every historical feature and cannot be buried in provider code.
- **Offline imports are outside the live worker:** historical/training sources cannot accidentally become synchronous production dependencies.
- **`contracts` is distinct from `domain` and Prisma:** UI/API types can evolve without leaking database records or provider payloads.

The supplied monorepo draft places provider modules both under `apps/api/src/modules/providers` and `packages/football-data`; assign adapter ownership only to the package, with the API module acting as a thin composition layer. Rename `workers/data-sync` to a broader pipeline worker because prediction, resolution, and evaluation also belong off the request path.

## Architectural Patterns

### Pattern 1: Ports, Adapters, and Explicit Provider Capabilities

**What:** The pipeline depends on a narrow provider port. Every adapter advertises competition/season/endpoint coverage, while a routing policy chooses the allowed source and reserves budget before the call.
**When to use:** For every external football-data integration.
**Trade-offs:** More types and mapping code, but provider failure or schema drift stays outside the domain model.

```typescript
type Capability = "fixtures" | "results" | "standings" | "lineups";

interface FootballProvider {
  readonly id: ProviderId;
  coverage(scope: CompetitionSeason): Promise<ReadonlySet<Capability>>;
  fixtures(query: FixtureQuery): Promise<ProviderFixture[]>;
}

// Policy performs: allowed-role check → cached coverage check → atomic
// budget reservation → adapter call → raw audit + quality log.
```

### Pattern 2: Idempotent Staged Jobs with Database Guards

**What:** Split fetch, normalize/reconcile, feature generation, forecasting, and evaluation into small retryable jobs. Use a deterministic job ID to suppress obvious duplicates, but enforce correctness with database uniqueness and short transactions.
**When to use:** All scheduled and provider-driven pipelines.
**Trade-offs:** Eventual consistency and more job states; in return, one failed provider call does not repeat completed writes.

```typescript
await syncQueue.add(
  "fixtures.fetch",
  { provider, competitionId, date },
  { jobId: `${provider}:fixtures:${competitionId}:${date}`, attempts: 4,
    backoff: { type: "exponential", delay: 2_000 } },
);
```

BullMQ explicitly recommends small, atomic, idempotent jobs for safe retries. Treat processing as **at least once**: a queue job ID is an optimization, not a replacement for unique constraints/upserts.

### Pattern 3: As-of Feature and Immutable Prediction Snapshots

**What:** Every forecast references a persisted feature snapshot with `asOf`, input-data watermark, model version, configuration hash, and source-quality components. A new prediction is appended; previous rows are never updated.
**When to use:** Every INITIAL, PRE_MATCH, and LINEUP_CONFIRMED forecast and every backtest replay.
**Trade-offs:** Additional storage, but forecasts become reproducible and leakage can be detected mechanically.

```typescript
const features = buildFeatures(history.filter(m => m.completedAt! <= asOf), config);
const input = await featureSnapshots.append({ fixtureId, asOf, features, configHash });
await predictions.append(runModel(input, modelVersion));
```

The current schema stores output probabilities but not the exact inputs/configuration that generated them. Add a feature/input snapshot relation before claiming reproducibility.

### Pattern 4: Transactional Reconciliation with Ambiguity Quarantine

**What:** Resolve exact external references first. Candidate matching never silently creates a canonical entity when confidence is ambiguous; it creates a review item containing candidates, score, raw name, and provider payload reference. Accepted decisions are applied transactionally.
**When to use:** On every previously unseen provider entity or fixture.
**Trade-offs:** Some data remains pending, but a false team match is much more damaging than delayed ingestion.

The schema currently has an index on `(homeTeamId, awayTeamId, kickoff)`, not a uniqueness guarantee. A ±36-hour application lookup is race-prone and can also incorrectly merge rescheduled or two-legged fixtures. Use exact external refs first, then a competition/season/team-pair/time candidate search with row locking or serializable retry, and persist reconciliation decisions. Do not encode the wide time window as a unique key.

### Pattern 5: Append Outcomes, Derive Read Models

**What:** Store immutable prediction, odds, and outcome facts; calculate value candidates and performance from explicit references to those facts. Materialize summaries only as rebuildable read models.
**When to use:** Value selection, bet resolution, calibration, and model comparison.
**Trade-offs:** More joins and explicit versioning, but historical claims remain auditable.

`BetCandidate` currently duplicates odds/probability/confidence without foreign keys to the originating `Odds` and `PredictionSnapshot`. Add those references or the displayed EV cannot be reconstructed after formulas change.

## Data Flow

### Request Flow

```text
Browser action
    ↓
Next.js feature → Nest controller → application service
    ↓                                  ├─ query PostgreSQL read model
UI result       ← versioned DTO      └─ validate manual odds, append Odds,
                                            compute/append candidate
```

The browser never calls providers and user-facing requests never wait on provider sync or model backfills.

### Asynchronous Pipeline Flow

```text
Scheduler
  ↓
coverage/routing → atomic budget reservation → provider fetch → raw audit
  ↓
normalize → canonical reconciliation ──ambiguous──→ manual review
  ↓ accepted
transactional canonical upsert
  ↓
as-of feature snapshot → prediction snapshot → query/read-model refresh
  ↓ after result
outcome append → Elo update → prediction scoring → calibration/performance rollup
```

### Key Data Flows

1. **Morning sync:** Results first, then fixtures/standings, reconciliation, rating/form recomputation, and INITIAL forecasts. Updating results before features prevents stale form and Elo.
2. **Pre-kickoff:** Refresh only permitted inputs, append PRE_MATCH, then optionally LINEUP_CONFIRMED. Never mutate INITIAL.
3. **Manual odds:** Validate a complete market set, append odds with user/source and timestamp, normalize overround, then link the candidate to both odds and prediction snapshots.
4. **Post-match:** Persist the result once, settle candidate outcomes against explicit market rules, update Elo once per fixture, and score all eligible snapshots whose `asOf < kickoff`.
5. **Backtest:** Walk fixtures chronologically; build each feature set solely from facts whose event/capture time was available before that simulated kickoff. Random train/test splits are invalid for this temporal domain.
6. **Degradation:** Circuit/budget/coverage failure writes a provider-health state consumed by fixture read models, so the UI can show limited coverage instead of silently using stale or missing inputs.

## Dependency Order and Vertical Build Slices

1. **Walking skeleton and contracts** — workspace, API/web/worker deployables, PostgreSQL/Redis health, shared IDs/markets/config validation, migrations and CI. This proves the process boundaries.
2. **Canonical fixture ingestion slice** — one competition and football-data.org only: budget reservation, raw audit, league/team/fixture reconciliation, upcoming-fixtures API and limited-data UI. This establishes the trustworthy timeline everything else needs.
3. **Results and historical state slice** — completed-result sync, team history, deterministic Elo/form updates, idempotency tests and replay command. Prediction must not precede trustworthy chronological history.
4. **Baseline forecast slice** — as-of feature snapshots, versioned Poisson/Elo model, immutable INITIAL predictions, 1X2/O-U/BTTS derivation, explanation UI. Keep secondary features behind availability flags.
5. **Manual value-analysis slice** — decimal odds validation, complete-market normalization, prediction/odds-linked candidates, edge/EV UI and responsible-gambling/region gates.
6. **Outcome evaluation slice** — market settlement rules, per-snapshot Brier/Log Loss/calibration records, ROI/Yield for stored candidates, model performance UI, chronological backtest runner. This closes the core learning loop.
7. **Fallback and ambiguity operations slice** — API-Football routing, coverage cache, competition-specific fallback/degradation, TheSportsDB entity aid, manual reconciliation UI. Add only after single-provider canonical behavior is proven.
8. **Pre-match enrichment slice** — scheduled refresh, confirmed lineups where covered, confidence components, PRE_MATCH/LINEUP_CONFIRMED snapshots. Injuries remain optional/manual unless coverage is verified.
9. **Scale/operability hardening** — queue dashboards/alerts, dead-letter/replay tooling, read-model caching, partition/retention review. Split services only after measured contention.

This order is vertical: each slice has an observable UI/API result and an auditable database outcome. It deliberately brings evaluation before broad provider/enrichment work because the product's core value is measured probability quality, not maximum input breadth.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0–1k users | One API, one worker process, one PostgreSQL database, one Redis; add indexes and cache public fixture reads |
| 1k–100k users | Scale stateless web/API horizontally; separate worker pools by queue and provider rate limit; add read replicas/materialized performance views if measurement proves necessary |
| 100k+ users | Partition large append-only odds/prediction/audit tables; isolate ingestion/evaluation workers by workload; introduce an outbox/event bus only if cross-service extraction is justified |

### Scaling Priorities

1. **First bottleneck:** External provider quotas, not compute. Reduce calls through coverage caching, persisted history, request coalescing, and atomic budget reservations.
2. **Second bottleneck:** Repeated feature/backtest queries over growing history. Precompute stable team state, index `(teamId, capturedAt)`/`(fixtureId, capturedAt)`, and process backtests in batches.
3. **Third bottleneck:** Public fixture/prediction read traffic. Add short-lived read caching and prebuilt DTO views before splitting services.

## Anti-Patterns

### Microservices Before a Measured Boundary

**What people do:** Split ingestion, prediction, value, and evaluation into network services immediately.
**Why it's wrong:** Distributed transactions and version drift make auditability harder while free-tier quotas keep throughput low.
**Do this instead:** Use package boundaries inside one API plus one worker; extract only a saturated or independently deployed workload.

### Redis as Source of Truth

**What people do:** Treat successful queue completion or cached provider payloads as durable domain state.
**Why it's wrong:** Redis is coordination infrastructure; retention/restart behavior should not determine forecast history.
**Do this instead:** Commit canonical facts and snapshots to PostgreSQL, then acknowledge the job.

### Mutable or Output-only Forecasts

**What people do:** Update a prediction row when lineups arrive or store probabilities without inputs.
**Why it's wrong:** It destroys the historical forecast and makes backtest claims irreproducible.
**Do this instead:** Append a new typed snapshot tied to an immutable as-of feature snapshot and model/config version.

### Application-only Deduplication

**What people do:** Query for a nearby fixture and insert if none is found.
**Why it's wrong:** Concurrent workers can both insert; a broad time window can merge distinct fixtures.
**Do this instead:** Combine provider-ref uniqueness, transaction isolation/conflict retry, explicit reconciliation decisions, and manual review.

### One Giant Sync Job

**What people do:** Fetch providers, update all entities, compute forecasts, and score results in one retry unit.
**Why it's wrong:** A late failure repeats external calls and partially completed writes.
**Do this instead:** Use small idempotent jobs and explicit dependencies; BullMQ flows are appropriate only when the dependency graph adds clarity.

### Leakage Through Current Tables

**What people do:** Backtest a past fixture by querying today's team state or rows captured after kickoff.
**Why it's wrong:** It uses information unavailable at prediction time and inflates performance.
**Do this instead:** Require `asOf` in feature APIs, enforce capture/event-time predicates, and test chronological replay invariants.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| football-data.org | Primary live adapter for supported competitions | Provider limiter and persisted cache; never called from HTTP request |
| API-Football | Policy-selected fallback/competition-primary adapter | Cached coverage check and atomic daily endpoint budget before each call |
| TheSportsDB | Entity-resolution aid adapter | Suggestions only; never authoritative results/stats |
| StatsBomb/FBref | Offline import command | Separate provenance and dataset version; cannot trigger live forecasts |
| Understat | Disabled-by-default offline/cached adapter | Optional and non-blocking; legal/availability review required |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Web ↔ API | Versioned REST DTOs | No Prisma/provider objects cross boundary |
| API ↔ worker | BullMQ job contracts | API enqueues; worker owns long-running execution |
| Worker ↔ domain packages | In-process pure calls | Deterministic, framework-free, unit-testable |
| Provider gateway ↔ reconciliation | Normalized DTO plus raw payload reference | Preserve provenance and source timestamps |
| Reconciliation ↔ database | Short transaction | Ambiguity creates review work, not speculative entities |
| Feature engine ↔ prediction | Immutable feature snapshot ID | Enforces reproducible inputs and `asOf` boundary |
| Prediction/odds ↔ value | Explicit snapshot IDs | Candidate must name the exact facts used |
| Outcome ↔ evaluation | Append fact plus deterministic settlement/scoring | Rollups are rebuildable projections |

## Supplied Design Inconsistencies to Resolve

| Issue | Consequence | Recommended correction |
|------|-------------|------------------------|
| Fixture comment claims uniqueness, schema defines only an index | Duplicate fixtures under concurrent ingestion | Transactional reconciliation, review decisions, and stronger identity invariant; do not pretend an index enforces uniqueness |
| Predictions have outputs but no feature/input snapshot or config hash | Forecasts cannot be reproduced | Add immutable `FeatureSnapshot`/input payload and reference it from each prediction |
| `PredictionSnapshot` is not database-immutable | Accidental update/delete remains possible | Repository append-only API plus database trigger/permissions in production; test mutation rejection |
| `BetCandidate` has no `predictionSnapshotId` or `oddsId` | EV/ROI lineage is ambiguous | Reference exact prediction and odds set; treat summaries as derived facts |
| Aggregate-only `BacktestResult` | Cannot audit individual scoring or rebuild calibration | Store per-snapshot evaluation/outcome, derive aggregate runs and calibration bins |
| `TeamElo.fixtureId`, `Lineup.teamId`, and `DataQualityLog.leagueId` are scalar-only | Referential drift | Add relations/FKs where the referenced canonical row is required |
| Budget counter lacks atomic reservation semantics and timezone date type | Concurrent overspend/day-boundary bugs | Reserve in a transaction with provider reset timezone/date key; record request ledger or reservation ID |
| Coverage cache and reconciliation review entities are absent | Required operational flows have nowhere durable to live | Add provider capability cache and match-review/decision tables |
| Market/selection are free-form strings and odds use `Float` | Invalid combinations and precision drift | Canonical market/selection types, validated complete market sets, decimal/numeric storage |
| `FINAL` snapshot name is temporally ambiguous | Risk of post-result data entering a forecast | Define it strictly as final pre-kickoff or remove it; outcome/evaluation is a separate record |
| Source timestamps are inconsistent | `asOf` leakage checks are incomplete | Store provider event time, fetched time, captured time, and provenance on imported facts/raw batches |

## Sources

- [NestJS queues documentation](https://docs.nestjs.com/techniques/queues) — Redis-backed BullMQ integration, producers/consumers/listeners, persisted jobs (MEDIUM confidence; official source discovered via websearch).
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs) — atomic, simple retry-safe jobs (MEDIUM confidence; official source).
- [BullMQ retrying failed jobs](https://docs.bullmq.io/guide/retrying-failing-jobs) — bounded attempts and backoff (MEDIUM confidence; official source).
- [BullMQ flows](https://docs.bullmq.io/guide/flows/) — explicit parent/child dependencies (MEDIUM confidence; official source).
- [Prisma transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions) — ACID operations, isolation and concurrency conflicts (MEDIUM confidence; official source).
- [Prisma schema reference](https://docs.prisma.io/docs/orm/reference/prisma-schema-reference) — compound uniqueness maps to database constraints/indexes (MEDIUM confidence; official source).
- [scikit-learn data leakage guidance](https://scikit-learn.org/stable/common_pitfalls.html) and [time-series cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html) — information available at prediction time and chronological evaluation (MEDIUM confidence; official sources; architecture principle is framework-independent).
- Project sources reviewed as design inputs: `.planning/PROJECT.md`, `SPEC.md`, root `ARCHITECTURE.md`, `MONOREPO_STRUCTURE.md`, and `schema.prisma` (HIGH confidence for stated project intent; not external validation).

## Confidence Notes and Open Questions

- **Overall MEDIUM:** Framework and persistence patterns are grounded in official documentation and cross-checked against the supplied schema, but provider-specific operational claims belong to the stack/pitfall research tracks and should be revalidated before implementation.
- Confirm authentication, tenancy, privacy-consent, and jurisdiction rules before finalizing user-owned odds/history boundaries.
- Decide whether raw provider payloads are stored inline, in PostgreSQL JSON, or in object storage; retain a checksum and provenance either way.
- Define precise competition/season/round/leg identity before schema migration; team pair plus a time window is insufficient for all football schedules.
- Define snapshot lifecycle terminology and per-market settlement rules before the evaluation slice.

---
*Architecture research for: Football prediction and value-betting analytics platform*
*Researched: 2026-08-27*
