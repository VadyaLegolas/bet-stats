# Phase 11: Dixon-Coles Model Version - Research

**Researched:** 2026-11-20
**Domain:** Low-score correction for an existing Elo/form-Poisson goal model, versioned model identity, leakage-safe rolling-origin evaluation
**Confidence:** HIGH for the math and the identity surface (verified against the repo this session); MEDIUM for ρ estimation stability across leagues (project-specific data, flagged below)

## Summary

The phase adds a **hybrid** low-score correction: the existing Elo/form/venue/rest-driven `λ_home`, `λ_away` stay exactly as they are, and a Dixon-Coles `τ` factor is applied to the four low scorelines (0-0, 1-0, 0-1, 1-1) before the retained-mass normalization. This is not a full DC attack/defence refit — calling it that would be false, and a full refit would double-count the home advantage already carried by `homeStrength`/`awayStrength`.

Three facts discovered in the repo shape the plan:

1. **The version literal is a closed type, not a runtime string.** `ForecastDraft.modelVersion: "poisson-ensemble-v1"` (`packages/domain/src/forecast/model.ts:30`), `ForecastOrchestratorInput.modelVersion` (`evaluation/forecast-orchestrator.ts:32`), `BacktestPlanReceipt.modelVersion` (`workers/data-sync/src/jobs/backtests.ts:16`), `forecast-sweep.ts:137,154`, `main.ts:66`, `forecasts.service.ts:25`, plus ~15 tests. Widening is a compile-time event — a partial pass cannot build, which is the coherent-pass guarantee MODEL-02 asks for.
2. **`configHash` is the operative identity check.** `ForecastOrchestrator.run` rejects any `configHash` that is not `currentForecastConfigHash()` (`forecast-orchestrator.ts:72`), and `model-card.ts:27` publishes that same hash. Bumping `FORECAST_CONFIG` to v2 would silently change every V1 receipt's expected config hash and break the "V1 unchanged" requirement. The plan therefore **splits** the config: `FORECAST_CONFIG`/`forecast-config-v1` stays byte-identical, and DC gets `DIXON_COLES_CONFIG`/`forecast-config-v2`.
3. **A comparison primitive already exists.** `compareBacktestPlans(database, {leftPlanId, rightPlanId, market, from, to})` (`packages/database/src/evaluation/backtest-repository.ts:120-141`) already refuses mismatched schedules (`COHORT_MISMATCH`) and returns Brier/log-loss per side with deltas. MODEL-03 needs an operator-facing, reproducible receipt around it — not a new metric engine.

**Primary recommendation:** four plans in three waves — (1) version union + config split + τ math + estimator + contract/orchestrator explicit-params path; (2) ρ persistence query, production selector and the default flip; (3) backtest widening with training-boundary ρ plus the comparison receipt endpoint; (4) methodology card, `/methodology` copy and e2e alignment.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01/D-02:** `dixon-coles-ensemble-v1` is the production default immediately; `poisson-ensemble-v1` stays first-class, selectable, un-rewritten.
- **D-03:** selector is versioned configuration (`FORECAST_MODEL_VERSION`), not a literal per call site; backtest plans pin their own version and never read the production default.
- **D-04:** no backfill, no UPDATE of existing snapshots/scores.
- **D-05/D-06:** hybrid integration; pinned τ convention (`τ00=1−λhλaρ`, `τ10=1+λaρ`, `τ01=1+λhρ`, `τ11=1−ρ`), documented as hybrid in the model card.
- **D-07 (amended):** feasible band `max(−1/(λhλa), −1/λh, −1/λa) < ρ < min(1/(λhλa), 1)` with ε margin; fail-closed, never clamp.
- **D-08:** per-league ρ with documented pooled fallback and `ρ=0` reproduce path.
- **D-09:** `MODEL_VERSIONS` union widened in one coherent pass.
- **D-10 (amended):** V1 config untouched; DC gets its own config identity; ρ enters `inputHash`.
- **D-11:** optional `receipt.dixonColes` provenance; legacy V1 receipts keep parsing; DC without provenance is rejected.
- **D-12/D-13:** reproducible comparison procedure with a saved receipt; no automatic promotion.
- **D-14/D-15:** honest methodology card; mandatory pins listed in D-15.

### the agent's Discretion

- ρ estimator (MLE vs moment), pooled-fallback weights and minimum league sample.
- Comparison artifact shape (endpoint + JSON receipt vs script vs dashboard).
- Env selector name/placement and model-card layout.

### Deferred (OUT OF SCOPE)

Full DC campaign refit; calibration (Phase 12); new markets (Phase 14); automatic promotion/rollback by metrics; live A/B dashboard.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MODEL-01 | DC low-score correction with pinned τ, bounded ρ, `ρ=0` reproduces Poisson | §Math, §Estimator, §Validation Architecture |
| MODEL-02 | New model-version identity across snapshots, backtests, comparisons, validators in one pass | §Identity Surface, §Snapshot Identity, §Config Split |
| MODEL-03 | Operator can compare rolling-origin metrics against the frozen baseline; card names integration and limitations | §Comparison Procedure, §Model Card, §Pitfalls |

## Math: the correction, applied once, after λ

```
τ(0,0) = 1 − λh·λa·ρ
τ(1,0) = 1 + λa·ρ
τ(0,1) = 1 + λh·ρ
τ(1,1) = 1 − ρ
```

For `ρ < 0`: 0-0 and 1-1 gain, 1-0 and 0-1 lose — draws rise, which is the documented sign for football. The other 60 cells multiply by 1.

Application order inside `createForecast` (`model.ts:145-149`): compute `expectedGoals` → build `raw` Poisson grid → multiply the four cells by `τ` → recompute `retainedMass` from the corrected grid → normalize. Normalizing **after** correction keeps `Σ markets = 1` within `probabilityTolerance` (1e-12) and keeps `retainedMass + tailMass = 1`; correcting after normalization would break both. Immediate consequence to publish honestly: **O/U 2.5 is unchanged** by the correction in aggregate unless the retained-mass renormalization shifts it (it does, by a tiny amount, because the four cells' total changes) — the card must say "neutral by construction" rather than claim an improvement.

`over`/`btts` do move slightly through renormalization; draws move materially. Do not claim draw improvement without the backtest.

### Feasible ρ band

All four τ must be strictly positive **per match**. Solving each inequality gives three lower bounds and two upper bounds:

`min = max(−1/(λh·λa), −1/λh, −1/λa)`, `max = min(1/(λh·λa), 1)`.

Use ε = `DIXON_COLES_CONFIG.dixonColes.boundsEpsilon` (1e-9) inside the band. Reject, never clamp: `INVALID_DIXON_COLES_RHO`.

## Estimator: one-dimensional, pure, deterministic

Because τ touches only four cells, the DC log-likelihood contribution of a match is `log τ(x,y)` for those cells and 0 otherwise. Given historical rows `{ λh, λa, homeGoals, awayGoals }` the score function is

`S(ρ) = Σ_matches [ τ′/τ ]` evaluated only on the four low cells.

`τ′` values: `−λhλa`, `+λa`, `+λh`, `−1`. `S` is strictly decreasing on the feasible band (each term is `−k/(a+bρ)` shaped for τ00/τ11 and `+k/(a+bρ)` for τ10/τ01 with positive denominators; the sum is monotone in practice for football-sized λ). Deterministic **bisection** over the band, fixed 80 iterations, no randomness, no library:

- `S(lo) ≤ 0` or `S(hi) ≥ 0` → no interior root → fall back to the boundary-adjacent value only if `|S|` tolerance is not met? **No** — fall back to `ρ = 0` with method `insufficient-sample-zero` and record it. Honest and reproducible.
- Otherwise return the midpoint with method `mle-low-score-v1`.

`samples` = count of historical matches contributing; `tauMin` = `min(τ over the four cells at the fitted ρ)`, stored in provenance so a consumer can see the correction stayed positive.

Do **not** pool across λ scales: pooled fallback pools *rows* (each row keeps its own λ), it does not average per-league ρ values.

## Identity Surface (MODEL-02)

| File | Current pin | Required change |
|---|---|---|
| `packages/domain/src/forecast/model.ts:30,178` | `modelVersion`, `configVersion` literals in `ForecastDraft` | widen to `ForecastModelVersion` / `ForecastConfigVersion`; conditional config version |
| `packages/domain/src/forecast/contract.ts:135` | `dto.modelVersion !== "poisson-ensemble-v1" \|\| dto.configVersion !== "forecast-config-v1"` | membership in union + per-version config version map |
| `packages/domain/src/evaluation/forecast-orchestrator.ts:32,71` | input literal + `MODEL_VERSION_MISMATCH` | union + `forecastConfigHashFor(version)` |
| `packages/domain/src/methodology/model-card.ts:25` | `currentModel.modelVersion` | default version + DC section |
| `workers/data-sync/src/jobs/forecasts.ts:8,33` | two literals | union |
| `workers/data-sync/src/jobs/forecast-sweep.ts:137,154` | two literals | read resolver, not literal |
| `workers/data-sync/src/jobs/backtests.ts:16,120` | plan + origin literals | union |
| `workers/data-sync/src/main.ts:66` | LINEUP_CONFIRMED literal | resolver |
| `apps/api/src/modules/forecasts/forecasts.service.ts:25` | literal | resolver |
| `apps/web/app/methodology/page.tsx:27` | renders card values | no code pin, copy only |

Validators that must accept both without change: `parseForecastResponse` (after union), `admitBacktestPlan` (after union), `EvaluationService` cohort filters (`modelVersion` is a plain `String` query there, `evaluation.service.ts:141`), `resolveHistoricalResultGraph` (unaffected).

## Config Split (supersedes the original D-10 wording)

```ts
// unchanged, still forecast-config-v1
export const FORECAST_CONFIG = Object.freeze({ version: "forecast-config-v1", ... });

// new
export const DIXON_COLES_CONFIG = Object.freeze({
  ...FORECAST_CONFIG,
  version: "forecast-config-v2" as const,
  dixonColes: Object.freeze({
    convention: "tau-1x2-v1" as const,
    boundsEpsilon: 1e-9,
    estimation: Object.freeze({
      method: "mle-low-score-v1" as const,
      windowDays: 730,
      minLeagueMatches: 150,
      minPooledMatches: 300,
      bisectionIterations: 80,
      fallback: "zero" as const,
    }),
  }),
});

export const FORECAST_CONFIGS = Object.freeze({
  "poisson-ensemble-v1": FORECAST_CONFIG,
  "dixon-coles-ensemble-v1": DIXON_COLES_CONFIG,
});
```

`forecastConfigHashFor(version)` = `sha(FORECAST_CONFIGS[version])`. `currentForecastConfigHash()` keeps returning the V1 hash unchanged for existing callers/tests; production call sites use `forecastConfigHashFor(selectedVersion)`.

Why not mutate `FORECAST_CONFIG.version`: every stored V1 receipt contains `configVersion: "forecast-config-v1"` and the orchestrator recomputes the expected hash on every request. A mutated config would make every historical V1 row un-reissuable and would break the V1 regression pin.

## Snapshot Identity

`ForecastSnapshot` uniqueness is `[fixtureId, kind, cutoff, modelHash, configHash, inputHash, evidenceFingerprint, state]` (`schema.prisma:612-650` region; `forecast-repository.ts:63` builds the same identity). `modelHash = sha({version})` already separates versions; `configHash` separates config families. **ρ must go into `inputHash`** — same fixture, cutoff and evidence can legitimately yield different ρ after a later fit. Implementation: build `canonicalInput` with an extra `dixonColes: { rho, convention, method, windowFrom, windowTo, sampleSize }` key **only when the version is DC**, so the V1 input hash is bit-identical to today (that is the regression pin).

No Prisma schema change is needed: `modelVersion`/`configVersion` are `String` columns (`schema.prisma:621-624`) and `receipt` is `Json` storing the full `ForecastResponseDto` (`forecast-repository.ts:79`). The receipt parser is the schema.

## ρ Data Path

Production (`asOf = forecast cutoff`, no lookahead):
1. `findFixture` gains `leagueId` (already in `Fixture`, `schema.prisma:186`; current select omits it at `forecast-repository.ts:52`).
2. Repository hook `findDixonColesParameters({ leagueId, asOf })` → `fitLeagueRho`:
   - select issued `PRE_MATCH` snapshots of the league with `cutoff < asOf` and `kickoffUtc <= asOf`, latest revision per fixture;
   - read `receipt.expectedGoals` (λ pair) from the stored DTO — no recomputation, so the historical λ is the one actually used;
   - resolve the historical result with the existing `resolveHistoricalResultGraph(rows, fixtureId, asOf)` (`backtest-repository.ts:88-90` pattern) and require non-null goals;
   - keep rows whose `cutoff < kickoffUtc` (leakage guard);
   - if `rows.length < minPooledMatches` → `rho = 0`, method `insufficient-sample-zero`;
   - else estimate per league when `rows.length >= minLeagueMatches`, otherwise pooled across all leagues in the same window with method `pooled-fallback-v1`.
3. Provenance `{ rho, convention, method, windowFrom, windowTo, sampleSize, tauMin }` is attached to the receipt and to `inputHash`.

Backtest path: identical math, but `asOf = window.trainingEndsAt`, passed explicitly into `runBacktestOrigin` so the estimator can never see post-cutoff results even if the caller's repository is production-shaped.

## Comparison Procedure (MODEL-03)

`compareBacktestPlans` already enforces identical `version` and identical window identity `(fixtureId, forecastCutoff, evaluationAsOf)` and equal sample sizes. Wrap it:

- `packages/domain/src/evaluation/model-comparison.ts` — pure `buildModelComparisonReceipt({left, right, market, plans, computedAt})` returning a closed-field, secret-free JSON receipt: `{ version: "model-comparison-v1", market, from, to, windowsDigest, left: {planId, planHash, modelVersion, configHash, sampleSize, brier, logLoss}, right: {...}, deltas, verdict: "BETTER" | "WORSE" | "INCONCLUSIVE", computedAt }`. `verdict` uses a documented Brier delta threshold (`MODEL_COMPARISON_POLICY.deltaMateriality`, e.g. 0.002) — a delta inside the band is honestly `INCONCLUSIVE`.
- `GET /evaluation/model-comparison?leftPlanId&rightPlanId&market&from&to` with the existing `EligibilityGuard` and `PRIVATE_NO_STORE`, returning `{available:false, reason}` for `PLAN_NOT_COMPLETE`/`COHORT_MISMATCH` rather than a 500.
- Operator procedure (documented in the plan's SUMMARY and in the model card): create two backtest plans over the identical window list, one pinned `poisson-ensemble-v1`, one `dixon-coles-ensemble-v1`, wait for both `SUCCEEDED`, call the endpoint, save the JSON under the operator's own evidence folder. The window digest + plan hashes make the artifact re-derivable.

## Model Card and UI

`MODEL_CARD` is the single source (`model-card.ts`), rendered by `apps/web/app/methodology/page.tsx` without duplication. Changes: bump `version` to `model-card-v1.1.0`, `currentModel` → DC + `forecast-config-v2` + DC hash, new `forecast.dixonColes` section (convention string, ρ policy, window/min samples, fallback, expected effects, O/U 2.5 neutrality, "V1 available for rollback and comparison"), new `changeHistory` entry. `tests/e2e/methodology.spec.ts:12` pins the literal `"poisson-ensemble-v1 / forecast-config-v1"` — it must become version-aware, not deleted.

## Pitfalls (from research, re-checked against this code)

1. **Sign convention drift** — a single sign flip in τ10/τ01 turns draws *down*. Pin the sign with a test asserting `draw(rho<0) > draw(rho=0)` and `P(0-0)` up while `P(1-0)` down.
2. **Double home advantage** — avoided by construction (D-05). The card must not call this "the Dixon-Coles model".
3. **Normalization order** — correct before normalization; asserting `Σ=1` after is the guard.
4. **V1 drift** — the V1 regression pin must compare against a committed numeric vector (probabilities + `configHash` + `inputHash`), not just "it still runs". Commit the vector in the test file.
5. **ρ lookahead in backtests** — fit at `trainingEndsAt`, not `forecastCutoff`; the integration test must assert the estimator is called with `trainingEndsAt`.
6. **Mixed-version cohorts** — scorecards group by `modelVersion`; a DC and V1 score in the same cohort would make the comparison meaningless. The comparison endpoint refuses mixed plans by `version`.
7. **Insufficient history in CI** — seeded fixtures may have no settled history, so DC falls back to `rho=0`. Tests must assert the *provenance method*, not "rho is non-zero".
8. **`exactKeys` receipts** — adding `dixonColes` must be conditional; a V1 receipt carrying the block should be rejected, and a DC receipt missing it must be rejected.

## Validation Architecture

`nyquist_validation_enabled: true`, so this section seeds `11-VALIDATION.md`.

| Dimension | How this phase is sampled |
|---|---|
| Pure math (τ, bounds, estimator, normalization) | `tests/unit/dixon-coles.test.ts` — property-style cases over a deterministic λ grid; no DB |
| V1 freeze | `tests/unit/forecast-v1-regression.test.ts` — committed numeric vector: probabilities of all 7 selections, `configHash`, `inputHash`, `expectedGoals` for two fixed projections |
| Version identity | `tests/unit/forecast-model-version.test.ts` — union membership, per-version config version/hash, contract accept/reject matrix (V1 no block, DC with block, DC without block, V1 with block) |
| Orchestrator | extend `tests/integration/forecast-publication.test.ts` / `forecast-api.test.ts` — both versions accepted, mismatched config hash rejected, DC without ρ fails closed |
| ρ persistence | `tests/integration/dixon-coles-rho.test.ts` — synthetic settled history: per-league fit, pooled fallback, insufficient-sample zero, lookahead refusal (`cutoff >= kickoff` excluded) |
| Backtests | `tests/integration/backtest-origin.test.ts` / `backtest-production.test.ts` — plan pins DC, estimator called with `trainingEndsAt`, comparison refuses mixed versions and mismatched windows |
| Comparison receipt | `tests/unit/model-comparison.test.ts` + `tests/integration/model-comparison-api.test.ts` |
| Documentation contract | `tests/unit/model-card.test.ts` (new) + updated `tests/e2e/methodology.spec.ts` |

Wave 0 (must exist before dependent tasks): `tests/unit/dixon-coles.test.ts`, `tests/unit/forecast-v1-regression.test.ts`, `tests/unit/forecast-model-version.test.ts`. They can be written against the target API before the implementation because the API is fully specified above.

**Feedback latency:** unit subset < 30 s; integration subset requires PostgreSQL (Testcontainers/dev DB) and runs at wave boundaries, not per commit.

## Open Questions (resolved or deferred at planning)

- **Estimator root-finding:** bisection chosen over Newton (no derivative sign assumptions, deterministic iteration count). Deferred: per-league decay weighting — not in this phase; window is a flat `windowDays`.
- **Pooled fallback definition:** pools rows from all leagues with the same `windowDays`; if still under `minPooledMatches`, zero. Deferred: hierarchical shrinkage.
- **Comparison verdict threshold:** a policy constant, documented and pinned; deferred: statistical significance testing (bootstrap CI) — an honest `INCONCLUSIVE` band is enough for V1.
- **Selector default in tests:** integration harnesses that need V1 semantics must pass `FORECAST_MODEL_VERSION=poisson-ensemble-v1` explicitly rather than relying on the ambient default.

## Sources

- Repo (verified 2026-11-20): `packages/domain/src/forecast/{model,config,contract}.ts`, `packages/domain/src/evaluation/{forecast-orchestrator,backtest}.ts`, `packages/domain/src/methodology/model-card.ts`, `packages/database/src/{forecast-repository.ts,evaluation/backtest-repository.ts}`, `workers/data-sync/src/{main.ts,jobs/{forecasts,forecast-sweep,backtests}.ts}`, `apps/api/src/modules/{forecasts/forecasts.service.ts,evaluation/evaluation.service.ts}`, `apps/web/app/methodology/page.tsx`, `packages/database/prisma/schema.prisma`, `tests/**`.
- `.planning/research/FEATURES.md` §6, `PITFALLS.md` §6, `ARCHITECTURE.md` (F6, anti-patterns), `SUMMARY.md`.
- Dixon & Coles (1997), "Modelling Association Football Scores and Inefficiencies in the Football Betting Market" — τ form and the low-score likelihood structure. Convention as pinned in D-06.
