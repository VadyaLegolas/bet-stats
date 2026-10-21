# Phase 4: Settlement and Evidence Scorecard - Research

**Researched:** 2026-09-08
**Domain:** versioned football settlement, proper scoring rules, calibration, financial evidence, chronological backtesting
**Confidence:** HIGH for repository contracts and core metric definitions; MEDIUM for product defaults

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Settlement truth and lifecycle
- **D-01:** Settlement is append-only and versioned; corrections create linked revisions and never rewrite an earlier settlement. — **Reversibility:** one-way — changing this later would require migrating the audit history and published evaluation identities.
- **D-02:** Only an exact frozen pre-match forecast snapshot is scoreable. Missing or ambiguous eligible snapshots produce an explicit unscored reason, never an implicit “latest” choice.
- **D-03:** Completed fixtures settle normally; postponed fixtures remain pending; cancelled, abandoned, and void fixtures resolve to explicit non-scored/non-financial states under a versioned policy.

### Metrics and cohorts
- **D-04:** Brier Score and Log Loss use server-owned formulas with versioned configuration and are grouped by model version, competition, market, and explicit UTC period.
- **D-05:** Every aggregate displays its denominator and sample size. Empty and weak cohorts render honest unavailable/limited states rather than zero or a performance claim.
- **D-06:** Reliability uses deterministic probability buckets with observed frequency, forecast mean, count, and under/over-confidence direction; bucket edges and minimum counts are versioned.

### Value performance and CLV
- **D-07:** Per-result P/L uses a transparent flat one-unit convention for frozen `VALUE_CANDIDATE` receipts only; ROI and Yield disclose numerator, denominator, count, and settlement policy version.
- **D-08:** No bankroll sizing, staking strategy, personalized recommendation, or guaranteed-profit language is introduced.
- **D-09:** CLV is computed only from comparable market, selection, source convention, and timestamped price observations; otherwise the UI states exactly why CLV is unavailable.

### Backtesting and presentation
- **D-10:** Backtests use chronological rolling-origin windows and call the same as-of feature and forecast contracts as production; no random split and no post-cutoff evidence.
- **D-11:** The primary UI starts with cohort health and sample-size warnings, then scorecards and reliability charts; exact snapshot, formula, and version details remain available through progressive disclosure.
- **D-12:** Filters have stable URL/query identity and default to the broadest honest cohort that meets quality gates; no silent substitution when filters produce insufficient data.

### the agent's Discretion
- Exact visual composition of scorecards and charts, provided denominators, unavailable states, confidence warnings, and responsible-use copy remain prominent.
- Exact bucket count and minimum-sample defaults may be selected during research, but must be versioned and supported by sensitivity tests.

### Deferred Ideas (OUT OF SCOPE)
- Additional goal lines, double chance, and team totals remain deferred until these settlement/calibration rules are verified.
- Personalized staking, bankroll optimization, alerts, and automatic wagering remain out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| EVAL-01 | Resolve completed, postponed, cancelled, abandoned, and void fixtures with explicit versioned rules. | Append-only SettlementReceipt lifecycle and status matrix. |
| EVAL-02 | Score the exact frozen pre-match prediction. | Required FK to an explicit ISSUED ForecastSnapshot; no latest lookup or recomputation. |
| EVAL-03 | Brier and Log Loss by model, competition, market, UTC period, with sample size. | Versioned event-score rows and transparent cohort aggregation. |
| EVAL-04 | Reliability buckets expose under/over-confidence. | Deterministic equal-width bins with forecast mean, observed frequency, count, direction. |
| EVAL-05 | Per-candidate unit P/L and aggregate ROI/Yield. | Flat one-unit receipt formulas and financial eligibility rules. |
| EVAL-06 | Rolling-origin, production-equivalent as-of backtests. | Window receipt and strict feature/source cutoff checks. |
| EVAL-07 | Suppress or label weak performance claims. | Versioned cohort-health state machine and sensitivity tests. |
| EVAL-08 | CLV only for comparable timestamped prices. | Exact comparability tuple and reason-coded unavailable states. |
</phase_requirements>

## Summary

Phase 4 should add a receipt pipeline, not a mutable statistics table. A result revision is mapped by a versioned settlement policy to a new immutable settlement receipt linked to an explicit `ResultVersion` and exact `ForecastSnapshot`; corrections append superseding settlement and scoring receipts. The repository already exposes immutable forecast, odds and value identities plus linked result revisions, so settlement can preserve source identity end to end. [VERIFIED: packages/database/prisma/schema.prisma:430-460,476-492,508-530,534-553]

Persist atomic per-forecast/per-market score facts and per-value-candidate financial facts. Compute scorecards from those facts using an explicit formula/policy version and cohort query identity. For reliability, expand each categorical market into selection-level binary events and bucket those event probabilities; show mean forecast, observed rate, count and signed calibration gap. Strictly proper scores assess more than calibration alone, so the UI must not describe a lower Brier score as proof of better calibration without the reliability view. [CITED: https://scikit-learn.org/stable/modules/calibration.html]

Backtesting must reuse the production as-of evidence and forecast functions across rolling origins, where every training/evidence set precedes the test fixture. This prevents future observations from entering the forecast. [CITED: https://otexts.com/fpp3/tscv.html]

**Primary recommendation:** implement one append-only chain `ResultVersion → SettlementReceipt → ForecastScore/ValueSettlement`, then expose server-owned cohort aggregates and a no-store scorecard UI; never derive evaluation from mutable fixture status or recompute forecasts.

## Project Constraints (from AGENTS.md)

- Use the established pnpm/Turborepo TypeScript stack: Next.js/React/Tailwind/TanStack Query/Recharts, NestJS, PostgreSQL/Prisma, Redis/BullMQ. [VERIFIED: AGENTS.md]
- MVP uses free data tiers and manual odds; do not add a paid closing-price provider. [VERIFIED: AGENTS.md]
- Preserve canonical identities, provider-reference tables, auditable matching and immutable snapshots. [VERIFIED: AGENTS.md]
- Jobs must be idempotent, cached, retried with backoff and circuit-breaker protected. [VERIFIED: AGENTS.md]
- Backtests must prevent leakage and measure probability quality, not hit rate alone. [VERIFIED: AGENTS.md]
- No automatic wagering or certainty claims; retain region gates and persistent responsible-gambling disclaimers. [VERIFIED: AGENTS.md]
- Direct implementation edits must run through GSD execution; this research changes only the planning artifact. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Result-to-policy settlement | API / Backend | Database / Storage | Domain policy decides state; database binds exact sources immutably. |
| Idempotent settlement scheduling | API / Backend worker | Redis / Queue | Worker reacts to result revisions; PostgreSQL remains truth. |
| Brier, Log Loss, P/L and CLV facts | API / Backend | Database / Storage | Server-owned deterministic formulas produce receipts. |
| Cohort aggregation and quality gates | Database / Storage | API / Backend | SQL groups persisted facts; API applies versioned response contract. |
| Scorecard and reliability chart | Browser / Client | Frontend Server (SSR) | UI presents returned aggregates and stable URL filters without recalculation. |
| Rolling-origin orchestration | API / Backend worker | Database / Storage | Worker advances chronological windows; persistence records replay identity. |

## Existing Contracts to Preserve

The source-of-truth schema defines forecast kinds verbatim as `INITIAL`, `PRE_MATCH`, `LINEUP_CONFIRMED`, and forecast states as `BUILDING`, `ISSUED`, `FAILED`. Only `ISSUED` plus an explicit allowed pre-match kind may be scored; the allowed-kind set must be versioned rather than inferred. [VERIFIED: packages/database/prisma/schema.prisma:71-80]

The exact immutable forecast identity is quoted verbatim: `@@unique([fixtureId, kind, cutoff, modelHash, configHash, inputHash, evidenceFingerprint, officialLineupObservationId])`; revisions are also unique by `@@unique([fixtureId, kind, revision])`. [VERIFIED: packages/database/prisma/schema.prisma:459-460]

The exact value identity is quoted verbatim: `@@unique([forecastSnapshotId, oddsSnapshotId, market, selection])`. Financial settlement must therefore bind the existing selection-aware receipt, not reconstruct a wager from odds JSON. [VERIFIED: packages/database/prisma/schema.prisma:508-530]

The result source provides verbatim fields `effectiveAt`, `observedAt`, `homeGoals`, `awayGoals`, `status`, `revision`, and `supersedesResultVersionId`, with exact identities `@@unique([fixtureId, revision])` and `@@unique([fixtureId, observationId])`. [VERIFIED: packages/database/prisma/schema.prisma:534-553]

## Standard Stack

### Core

| Library / facility | Version | Purpose | Why Standard |
|---|---:|---|---|
| Existing TypeScript domain package | 5.9.3 compiler | Pure settlement and metric formulas | Keeps production/backtest formulas identical and unit-testable. [VERIFIED: package.json] |
| Prisma ORM / PostgreSQL | 7.10.0 / existing service | Immutable receipts, constraints, aggregate queries | Existing source of truth; transactions support atomic multi-write work. [VERIFIED: pnpm-lock.yaml] [CITED: https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions] |
| `decimal.js` | 10.6.0 | Decimal odds, one-unit P/L and aggregate financial arithmetic | Already pinned and used at financial boundaries. [VERIFIED: pnpm-lock.yaml] |
| BullMQ | 6.3.2 | Idempotent settlement/backtest jobs | Existing queue stack; retries/backoff and custom IDs are documented patterns. [VERIFIED: pnpm-lock.yaml] [CITED: https://docs.bullmq.io/patterns/idempotent-jobs] |
| NestJS + existing eligibility guard | existing workspace | Guarded settlement/scorecard APIs | Extends established server-owned analytics boundary. [VERIFIED: apps/api/src/modules/value/value.controller.ts] |
| Next.js + Recharts | existing workspace | Scorecard, reliability diagram and progressive disclosure | Required project stack; chart receives server-computed points only. [VERIFIED: AGENTS.md] |
| Vitest / Playwright | 4.1.11 / 1.62.1 | Formula, DB invariant, API and browser tests | Existing configured validation layers. [VERIFIED: package.json,vitest.config.ts,playwright.config.ts] |

### Supporting

No new package is required. Use Node crypto for content hashes, existing Zod parsers for DTO boundaries, and SQL/Prisma for aggregation. [VERIFIED: apps/api/src/modules/value/value.service.ts] [ASSUMED]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| Persisted atomic evaluation facts | Aggregate directly from forecast JSON on every request | Simpler schema, but cannot preserve formula revision identity or correction lineage. [ASSUMED] |
| Selection-level reliability bins | Only one bucket row per match market | Loses class-specific calibration direction and makes 1X2 reliability ambiguous. [ASSUMED] |
| Existing TS formulas | Python/scikit-learn service | Adds an unnecessary service; sklearn is a documentation reference, not a runtime dependency. [ASSUMED] |

## Package Legitimacy Audit

No external packages are added in this phase; the legitimacy gate is not applicable. Existing locked dependencies are reused. [VERIFIED: .planning/phases/04-settlement-and-evidence-scorecard/04-CONTEXT.md]

## Architecture Patterns

### System Architecture Diagram

```text
ResultVersion appended
        |
        v
settlement job (fixtureId + resultVersionId + policyVersion)
        |
        +--> postponed --------------------> PENDING receipt
        +--> cancelled/abandoned/void ----> NON_SCORED + NON_FINANCIAL receipt
        +--> completed
                |
                v
        exact eligible ForecastSnapshot? --no/ambiguous--> UNSCORED(reason)
                |
               yes
                v
      SettlementReceipt (append-only revision)
          |                         |
          v                         v
 ForecastScore facts      VALUE_CANDIDATE only -> ValueSettlement facts
          |                         |              |
          +------------+------------+              +--> comparable close price?
                       v                                   | yes/no reason
            cohort aggregate API <-------------------------+
                       |
                       v
 URL-stable scorecard -> cohort health -> metrics -> reliability -> receipt details
```

### Recommended Project Structure

```text
packages/domain/src/evaluation/       # policy, scoring, buckets, P/L, CLV, cohort health
packages/database/prisma/             # receipt models, indexes, triggers, migration
apps/api/src/modules/evaluation/      # guarded commands and query endpoints
workers/data-sync/src/jobs/           # idempotent settlement/backtest job adapters
apps/web/app/scorecards/              # URL-filtered evidence UI
tests/unit/                            # formula/property/boundary tests
tests/integration/                     # PostgreSQL lifecycle and API aggregation
tests/e2e/                             # production-backed user scorecard flow
```

### Pattern 1: Append-only, source-bound receipt chain

Create `SettlementReceipt` with `fixtureId`, `resultVersionId`, `policyVersion`, `policyHash`, lifecycle state, scoreability/financial eligibility, reason code, revision, `supersedesSettlementId`, receipt JSON and timestamps. Add unique `(fixtureId, resultVersionId, policyHash)` for retry convergence and `(fixtureId, revision)` for the audit chain. Create dependent score rows in the same short transaction; use an advisory lock or serializable retry consistent with Phase 3 revision allocation. Prisma documents short interactive transactions and Serializable retry for concurrency conflicts. [CITED: https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions]

Never update/delete settlement, score, financial or backtest receipts; enforce immutability with PostgreSQL triggers as Phase 3 does. Corrections point at the prior receipt and produce fresh dependent facts. [VERIFIED: packages/database/prisma/migrations/20260905_phase03_forecast_value_snapshots/migration.sql] [ASSUMED]

### Pattern 2: Exact frozen scoring

The settlement command must carry `forecastSnapshotId`; validate fixture equality, `state === "ISSUED"`, `cutoff < kickoffUtc`, an allowed pre-match kind, and no ambiguity. Do not call forecast generation. Store the probability vector copied from the immutable receipt plus its hash in the score receipt, then calculate:

```typescript
// Formula contract v1; categorical K-class forecast.
brier = sum(classes, c => (p[c] - oneHot[c]) ** 2);
logLoss = -Math.log(Math.max(epsilon, p[observedClass]));
```

Use an explicit `epsilon` only as a versioned numerical guard, persist both raw chosen probability and clipped value, and reject non-normalized/non-finite vectors before scoring. Multi-class Brier has range `[0, 2]` under this unscaled sum convention, so do not silently divide by class count. [CITED: https://scikit-learn.org/1.8/auto_examples/calibration/plot_calibration_multiclass.html] The exact `epsilon` is a project policy choice; recommend `1e-15` for v1 with boundary tests. [ASSUMED]

For 1X2 use one three-class score per match. For O/U 2.5 and BTTS use their complete two-class vectors rather than scoring only the selected side. [ASSUMED]

### Pattern 3: Reliability facts and deterministic buckets

Expand each scored vector to one binary event per selection: `(probability, occurred ∈ {0,1})`. Assign `[0,0.1) ... [0.9,1.0]` with integer arithmetic `min(9, floor(p * 10))`, then aggregate `forecastMean`, `observedFrequency`, `count`, `gap = observedFrequency - forecastMean`. Positive gap means the event occurred more often than forecast (`UNDER_CONFIDENT` for that event probability); negative means `OVER_CONFIDENT`; use `ALIGNED` only within a versioned tolerance. Calibration diagrams conventionally plot mean predicted probability against fraction positive and should include counts. [CITED: https://scikit-learn.org/stable/modules/calibration.html]

Recommended v1 policy: 10 equal-width buckets, bucket display minimum 20, cohort performance-claim minimum 50, direction tolerance 0.02. These are product defaults, not universal statistical truths. Version them and test sensitivity with 5/10/20 buckets and thresholds 20/30/50. [ASSUMED]

Do not infer calibration quality from Brier alone because proper scoring rules combine reliability, resolution and uncertainty. [CITED: https://scikit-learn.org/stable/modules/calibration.html]

### Pattern 4: One-unit financial settlement

Only existing `outcome === "VALUE_CANDIDATE"` receipts enter financial facts. For a normal decimal-odds win: `stakeUnits=1`, `returnUnits=decimalOdds`, `profitUnits=decimalOdds-1`; loss: `returnUnits=0`, `profitUnits=-1`; void: `returnUnits=1`, `profitUnits=0`; postponed remains pending. [ASSUMED] Persist outcome class, odds snapshot/selection, stake, return, profit and policy version in each fact.

Define both disclosed aggregate labels identically unless product semantics deliberately distinguish them: `ROI = totalProfitUnits / totalStakedUnits` and `Yield = totalProfitUnits / totalStakedUnits`. If both are retained, UI must state that v1 flat-unit ROI and yield are aliases; do not manufacture different denominators. [ASSUMED] Always return numerator, denominator and count, never only a percentage.

### Pattern 5: CLV comparability gate

CLV needs an immutable second price observation. Compare only the exact tuple `fixtureId + market + selection + decimal convention + source convention`, where the candidate price precedes kickoff and the closing observation is timestamped as the last eligible pre-kickoff price under a versioned window/source rule. [ASSUMED] Recommend odds-ratio CLV `candidateOdds / closingOdds - 1`, while also returning both raw prices and timestamps. [ASSUMED]

Manual odds alone do not guarantee a true market close. Therefore use first-class reasons: `NO_CLOSING_OBSERVATION`, `MARKET_MISMATCH`, `SELECTION_MISMATCH`, `SOURCE_CONVENTION_MISMATCH`, `TIMESTAMP_INVALID`, `POST_KICKOFF_OBSERVATION`, `NON_COMPARABLE_ODDS_FORMAT`. These exact new values are recommendations and remain [ASSUMED] until locked in implementation.

### Pattern 6: Rolling-origin receipt

Represent a backtest as a versioned plan plus immutable windows: training/evidence interval ends strictly before each test fixture cutoff; the test set advances chronologically. Each window records its origin, train range, test range, model/config hashes, evidence build IDs, cutoff and output score IDs. Time-series cross-validation requires training observations to precede each test observation; no future observation may construct the forecast. [CITED: https://otexts.com/fpp3/tscv.html]

Call the same `resolveTeamEvidence({ teamId, asOf })` and forecast domain function used in production. Reject any source time, evidence cutoff, result effective time or observed time after the forecast cutoff. A backtest may score only the artifact generated at that origin, never regenerate it after the result is known. [VERIFIED: apps/api/src/modules/forecasts/forecasts.service.ts] [ASSUMED]

### Pattern 7: Query identity and honest UI states

Use canonical URL parameters `modelVersion`, `competitionId`, `market`, `from`, `to`; parse UTC periods server-side, normalize ordering, and echo canonical filters in the response. New exact parameter names are [ASSUMED]. Empty results return `UNAVAILABLE`, weak cohorts `LIMITED`, qualified cohorts `AVAILABLE`; do not broaden filters silently. Render health/sample warning before score cards, then Brier/Log Loss, one-unit results, reliability chart, and expandable source/formula receipts. [ASSUMED]

### Anti-Patterns to Avoid

- **Score latest forecast:** breaks D-02; require exact immutable ID.
- **Read mutable `Fixture.status` as settlement truth:** bind a `ResultVersion` revision instead.
- **Update a settlement after correction:** append a superseding receipt and dependent facts.
- **Average per-market scores with hidden weighting:** expose event count and aggregation convention.
- **Drop probability 0/1 rows to avoid log(0):** version and disclose clipping.
- **Compute financial return for `NO_VALUE`:** only frozen `VALUE_CANDIDATE` receipts qualify.
- **Call manual odds “closing odds”:** require an independently timestamped comparable observation.
- **Random train/test split:** violates chronological as-of behavior.
- **Let Recharts calculate metrics:** send complete server-owned points and denominators.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Decimal odds arithmetic | Floating-point financial math | Existing `decimal.js` | Exact decimal boundary is already established. [VERIFIED: pnpm-lock.yaml] |
| Durable retry semantics | In-process timer loop | Existing BullMQ jobs plus DB idempotency key | BullMQ documents retry/backoff; DB receipts survive queue removal. [CITED: https://docs.bullmq.io/guide/retrying-failing-jobs] |
| Concurrent revision allocation | Read-then-write without lock | Existing transaction/advisory-lock pattern | Phase 3 already serializes immutable revisions. [VERIFIED: apps/api/src/modules/forecasts/forecasts.service.ts] |
| Chart primitives | Bespoke SVG interaction | Existing Recharts | Required project stack; retain accessible tabular fallback. [VERIFIED: AGENTS.md] |
| Statistical ML service | Python microservice for four formulas | Pure TypeScript domain functions | No training library is needed for deterministic scoring. [ASSUMED] |

**Key insight:** libraries do not protect audit identity. PostgreSQL constraints and immutable source IDs must make it impossible to score a different forecast/result pair than the receipt claims. [ASSUMED]

## Common Pitfalls

### Pitfall 1: Settlement revision fan-out
**What goes wrong:** a corrected result creates a new settlement but old scores remain included beside new ones.  
**How to avoid:** aggregate only leaf/current receipts within a requested `asOf`, while retaining all historical revisions for audit; test correction and replay convergence. [ASSUMED]

### Pitfall 2: Ambiguous multi-class Brier scaling
**What goes wrong:** one endpoint uses sum over classes while another averages classes.  
**How to avoid:** formula receipt states `categorical-sum-v1`, class order and range; golden tests cover perfect, uniform and confidently wrong vectors. [CITED: https://scikit-learn.org/1.8/auto_examples/calibration/plot_calibration_multiclass.html]

### Pitfall 3: Log Loss infinities hidden
**What goes wrong:** zero probability for the observed class yields infinity or an unexplained finite result.  
**How to avoid:** validate probabilities and persist versioned clipping epsilon plus raw/clipped probability. [ASSUMED]

### Pitfall 4: Reliability chart without population
**What goes wrong:** sparse bins look authoritative.  
**How to avoid:** return counts, hide/mark bins below policy minimum, show an event histogram/table and run bucket sensitivity tests. [CITED: https://scikit-learn.org/stable/modules/calibration.html]

### Pitfall 5: Outcome leakage in rolling origin
**What goes wrong:** evidence selected by ingestion time or latest status includes facts unavailable at forecast cutoff.  
**How to avoid:** assert every source timestamp and build cutoff `<= origin cutoff`; use chronological fixtures and adversarial future-row tests. [CITED: https://otexts.com/fpp3/tscv.html]

### Pitfall 6: Queue dedupe mistaken for durable idempotency
**What goes wrong:** BullMQ can accept the same custom job ID again after an old job is removed.  
**How to avoid:** queue ID reduces duplicates, but PostgreSQL unique receipt identity is authoritative. [CITED: https://docs.bullmq.io/guide/jobs/job-ids]

### Pitfall 7: Unsupported performance language
**What goes wrong:** positive short-run yield is presented as evidence of predictive certainty or advice.  
**How to avoid:** gate claims by sample policy, retain persistent risk copy, state flat-unit historical evidence and never recommend staking. [VERIFIED: AGENTS.md]

## Code Examples

### Pure categorical score receipt

```typescript
// Source: formula shape cross-checked against sklearn proper-score documentation.
export function scoreCategorical(
  probabilities: readonly number[],
  observedIndex: number,
  epsilon: number,
) {
  const brier = probabilities.reduce(
    (sum, probability, index) => sum + (probability - (index === observedIndex ? 1 : 0)) ** 2,
    0,
  );
  const rawObservedProbability = probabilities[observedIndex]!;
  const clippedObservedProbability = Math.max(epsilon, Math.min(1 - epsilon, rawObservedProbability));
  return { brier, logLoss: -Math.log(clippedObservedProbability), rawObservedProbability, clippedObservedProbability };
}
```

[CITED: https://scikit-learn.org/stable/modules/model_evaluation.html] Exact names and epsilon are [ASSUMED].

### Deterministic reliability bucket

```typescript
export const bucketIndex = (probability: number, bucketCount: number) =>
  Math.min(bucketCount - 1, Math.floor(probability * bucketCount));
```

Mean predicted probability and fraction positive are the standard plotted quantities. [CITED: https://scikit-learn.org/stable/modules/calibration.html] Exact function is [ASSUMED].

### Idempotent job identity

```typescript
const jobId = `settle-${fixtureId}-${resultVersionId}-${policyHash}`;
await queue.add("settle-fixture", payload, {
  jobId,
  attempts: 3,
  backoff: { type: "exponential", delay: 1_000, jitter: 0.25 },
});
```

BullMQ supports custom job IDs, attempts and exponential backoff. [CITED: https://docs.bullmq.io/guide/jobs/job-ids] [CITED: https://docs.bullmq.io/guide/retrying-failing-jobs] Exact job string and retry values reuse local patterns but are [ASSUMED].

## State of the Art

| Old approach | Current recommended approach | Impact |
|---|---|---|
| Hit rate/accuracy alone | Proper probability scores plus reliability and population | Separates outcome correctness from probability quality. [CITED: https://scikit-learn.org/stable/modules/calibration.html] |
| Random split | Rolling forecasting origin | Ensures training observations precede each test observation. [CITED: https://otexts.com/fpp3/tscv.html] |
| Mutable aggregate counters | Immutable atomic facts + query-time/materialized cohort views | Corrections remain replayable and auditable. [ASSUMED] |
| BullMQ repeatable jobs | Job Schedulers in BullMQ v6 | Repeatable API was removed in v6; use scheduler only if periodic sweep is needed. [CITED: https://docs.bullmq.io/guide/jobs/repeatable] |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---:|---|---|
| Node.js | all workspaces | ✓, wrong project major | 25.2.1 | Run validation under declared Node 24.x. [VERIFIED: package.json; local probe] |
| pnpm | workspace | ✓ | 10.34.5 | — [VERIFIED: local probe] |
| Docker CLI | PostgreSQL/Redis integration | ✓ CLI only | 29.7.2 | Provide external disposable PostgreSQL/Redis if engine unavailable. [VERIFIED: local probe] |
| PostgreSQL | persistence tests | not probed as running | — | Docker Compose or explicit `DATABASE_URL`. [ASSUMED] |
| Redis | worker tests | not probed as running | — | Unit-test adapter; real Redis required for integration gate. [ASSUMED] |

**Missing dependency with no behavioral fallback:** Node 24 runtime parity and a reachable PostgreSQL instance are required before phase verification can claim production-equivalent persistence. [VERIFIED: package.json] [ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | Vitest 4.1.11 + Playwright 1.62.1 [VERIFIED: package.json] |
| Config | `vitest.config.ts`, `playwright.config.ts` [VERIFIED: repository files] |
| Quick run | `corepack pnpm test` [VERIFIED: package.json] |
| Full suite | `corepack pnpm test && corepack pnpm test:integration && corepack pnpm test:e2e` [ASSUMED] |

### Phase Requirements → Test Map

| Req | Behavior | Test type | Automated command | File exists? |
|---|---|---|---|---|
| EVAL-01/02 | status matrix, corrections, exact snapshot | unit + PostgreSQL integration | `corepack pnpm exec vitest run tests/integration/settlement.test.ts --project integration` | ❌ Wave 0 |
| EVAL-03/04/07 | formula vectors, buckets, cohort health | unit | `corepack pnpm exec vitest run tests/unit/evaluation.test.ts --project unit` | ❌ Wave 0 |
| EVAL-05/08 | one-unit P/L and CLV comparability | unit + integration | `corepack pnpm exec vitest run tests/integration/value-settlement.test.ts --project integration` | ❌ Wave 0 |
| EVAL-06 | rolling-origin and hostile future evidence | integration | `corepack pnpm exec vitest run tests/integration/backtest-origin.test.ts --project integration` | ❌ Wave 0 |
| EVAL-03/04/05/07/08 | scorecard filters, warnings, chart/table/details | Playwright | `corepack pnpm exec playwright test tests/e2e/evidence-scorecard.spec.ts --project=chromium` | ❌ Wave 0 |

### Sampling Rate

- Per task commit: focused unit/integration file under 30 seconds. [ASSUMED]
- Per wave merge: unit suite plus affected PostgreSQL integration tests. [ASSUMED]
- Phase gate: migrations from empty DB, full unit/integration suite, production Chromium scorecard flow. [ASSUMED]

### Wave 0 Gaps

- [ ] `tests/unit/evaluation.test.ts` — perfect/uniform/wrong Brier and Log Loss, clipping, bucket edges, direction, weak cohorts.
- [ ] `tests/integration/settlement.test.ts` — lifecycle matrix, retry convergence, correction chain, immutability triggers, exact snapshot.
- [ ] `tests/integration/value-settlement.test.ts` — candidate-only P/L, void/pending, aggregate denominators, CLV reason matrix.
- [ ] `tests/integration/backtest-origin.test.ts` — rolling origins and post-cutoff poison rows.
- [ ] `tests/e2e/evidence-scorecard.spec.ts` — URL identity, empty/limited/available states, accessible chart table and receipt details.

## Security Domain

### Applicable ASVS Categories

| ASVS category | Applies | Standard control |
|---|---:|---|
| V2 Authentication | no new mechanism | Preserve existing eligibility/access boundary. [VERIFIED: AGENTS.md] |
| V3 Session Management | no new mechanism | Preserve existing guarded surface. [ASSUMED] |
| V4 Access Control | yes | Apply EligibilityGuard to every evaluation/backtest endpoint; operator-only mutation where applicable. [VERIFIED: apps/api/src/modules/value/value.controller.ts] [ASSUMED] |
| V5 Input Validation | yes | Exact DTO parsing, canonical UTC periods, allowlisted filters and bounded pagination. [ASSUMED] |
| V6 Cryptography | yes for integrity hash only | Node crypto content hashes; never treat unkeyed hashes as authentication. [VERIFIED: apps/api/src/modules/value/value.service.ts] |

### Known Threat Patterns

| Pattern | STRIDE | Mitigation |
|---|---|---|
| Result or receipt tampering | Tampering | FKs, content hash, append-only triggers, source-derived DB guards. [ASSUMED] |
| Hindsight rescore | Tampering / Repudiation | Exact ForecastSnapshot FK and prohibition on generation inside settlement. [ASSUMED] |
| Filter/query injection | Tampering | DTO allowlists and Prisma parameterization; no user-built SQL fragments. [ASSUMED] |
| Expensive unbounded cohorts/backtests | Denial of Service | bounded UTC periods, pagination, job admission, concurrency and queue limits. [ASSUMED] |
| Misleading performance output | Repudiation | formula/policy receipts, denominators, limited/unavailable states and risk copy. [VERIFIED: AGENTS.md] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Ten equal-width reliability buckets, minimum bucket 20, cohort 50, tolerance .02. | Reliability | UI thresholds may be statistically unsuitable; sensitivity tests and versioning contain risk. |
| A2 | Multi-class Brier uses unscaled sum across classes. | Exact scoring | Scores become incomparable if another convention is expected; formula version must lock it. |
| A3 | Log Loss epsilon is `1e-15`. | Exact scoring | Different numeric convention changes extreme scores; disclose raw/clipped values. |
| A4 | ROI and Yield are aliases under flat one-unit stake. | Financial | Product may require distinct terminology; planner should preserve disclosed denominator. |
| A5 | CLV uses `candidateOdds / closingOdds - 1`. | CLV | Other CLV conventions exist; formula and source convention must be explicit. |
| A6 | Proposed enum/reason names and URL parameter names. | Schema/API | Must be locked verbatim before schema/DTO implementation. |
| A7 | Current PostgreSQL/Redis engine reachability. | Environment | Full integration gate may require runtime startup. |

## Resolved Planning Decisions

The three research questions are resolved here so executors receive closed contracts rather than making schema or policy choices during implementation.

1. **Result status vocabulary:** `settlement-policy-v1` accepts the closed canonical values `FINISHED`, `POSTPONED`, `CANCELLED`, `ABANDONED`, and `VOID`. Provider spellings must be normalized before `ResultVersion` publication; any other stored value returns `UNKNOWN_RESULT_STATUS` and creates no scored or financial facts. This preserves the required five-state matrix without guessing aliases from a free-form column.
2. **Exact score source:** the settlement command always carries `forecastSnapshotId`. `settlement-policy-v1` allows only an `ISSUED` snapshot whose kind is `PRE_MATCH` or `LINEUP_CONFIRMED`, whose cutoff precedes kickoff and whose fixture matches the result. There is no precedence lookup; `INITIAL` is explicitly ineligible for Phase 4 scoring. If the exact ID is missing or invalid, emit `EXACT_FORECAST_REQUIRED`/`FORECAST_NOT_SCOREABLE` and do not select another snapshot.
3. **Manual closing evidence:** a closing observation is a separate immutable manual odds observation labelled `MANUAL_CLOSING`, for the exact fixture/market/selection/decimal/source-convention tuple, recorded after the candidate observation and before kickoff. `closing-policy-v1` chooses the latest eligible observation by `(observedAt, id)` only within that exact tuple. With none, CLV is `NO_CLOSING_OBSERVATION`; it is never synthesized from the candidate or a paid feed.

## Sources

### Primary (HIGH confidence)

- Repository source files cited inline: Prisma schema, Phase 4 context, requirements, AGENTS.md, package manifests, forecast/value services.
- [scikit-learn probability calibration](https://scikit-learn.org/stable/modules/calibration.html) — reliability diagrams and limits of proper scores as calibration-only measures.
- [scikit-learn multi-class calibration example](https://scikit-learn.org/1.8/auto_examples/calibration/plot_calibration_multiclass.html) — categorical Brier convention/range and Log Loss usage.
- [Prisma v7 transactions](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions) — short transactions, Serializable isolation and retry.
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), [retries](https://docs.bullmq.io/guide/retrying-failing-jobs), [job IDs](https://docs.bullmq.io/guide/jobs/job-ids) — worker semantics.

### Secondary (MEDIUM confidence)

- [Forecasting: Principles and Practice — time-series cross-validation](https://otexts.com/fpp3/tscv.html) — rolling forecasting origin and no-future-observation rule.
- [Oxford Economic Papers: online betting market prices](https://academic.oup.com/oep/article/78/1/90/8244336) — unit-sized soccer-bet analysis and closing-odds data context; not used to define product policy.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all runtime packages already exist in the repository; no install proposed.
- Architecture: HIGH — anchored to exact immutable Phase 3/ResultVersion schema and official transaction/job guidance.
- Metrics: HIGH for formula families, MEDIUM for scaling/epsilon/bucket defaults because those are versioned product choices.
- CLV: MEDIUM — comparability rule is locked, but formula/source convention remains a product decision.
- Pitfalls: HIGH for leakage/identity risks; MEDIUM for presentation thresholds.

**Research date:** 2026-09-08
**Valid until:** 2026-10-08 for stable architecture; re-check package/docs versions if execution begins later.
