---
phase: 11-dixon-coles-model-version
reviewed: 2026-11-23T00:00:00Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - apps/api/src/modules/evaluation/evaluation.controller.ts
  - apps/api/src/modules/evaluation/evaluation.service.ts
  - apps/api/src/modules/forecasts/forecasts.service.ts
  - apps/web/app/methodology/page.tsx
  - packages/config/src/index.ts
  - packages/database/src/dixon-coles-repository.ts
  - packages/database/src/evaluation/backtest-repository.ts
  - packages/database/src/forecast-repository.ts
  - packages/domain/src/evaluation/forecast-orchestrator.ts
  - packages/domain/src/evaluation/model-comparison.ts
  - packages/domain/src/forecast/config.ts
  - packages/domain/src/forecast/contract.ts
  - packages/domain/src/forecast/dixon-coles.ts
  - packages/domain/src/forecast/model-version.ts
  - packages/domain/src/forecast/model.ts
  - packages/domain/src/methodology/model-card.ts
  - workers/data-sync/src/jobs/backtests.ts
  - workers/data-sync/src/jobs/forecast-sweep.ts
  - workers/data-sync/src/jobs/forecasts.ts
  - workers/data-sync/src/main.ts
  - tests/unit/dixon-coles.test.ts
  - tests/unit/model-card.test.ts
  - tests/unit/model-comparison.test.ts
  - tests/e2e/methodology.spec.ts
  - tests/integration/dixon-coles-rho.test.ts
  - tests/integration/model-comparison-api.test.ts
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-11-23
**Depth:** standard
**Files Reviewed:** 26 (the four unit/e2e/integration test files other than dixon-coles-rho.test.ts were only checked for obvious problems)
**Status:** issues_found

## Summary

The tau formulas, the retained-mass normalization order (correction first, then renormalization) and the claim that the 2.5 total is neutral are all mathematically correct. The four tau-weighted cells sum to zero net change, and all four cells lie in Under 2.5. The domain-level model, contract and version pinning (`MODEL_VERSIONS`, fail-closed config, `modelVersion` never inferred from `rho`) are sound.

The production wiring is not. The rho fitter reads expected goals from a receipt shape that production never writes, so the default `dixon-coles-ensemble-v1` always issues `rho = 0`. The integration test hides this by seeding the same wrong shape. The model-comparison endpoint is described as operator-only but is not behind `OperatorGuard`. The rho estimator also has fragile bounds handling that can silently fall back to zero. The model card makes two claims the code does not support.

Necessity review was not run: `necessity-review.md` was not loaded, so no `necessity:` count is emitted.

## Critical Issues

### CR-01: rho fitter reads `expectedGoals` from the wrong receipt level, so every fit silently degrades to rho = 0

**File:** `packages/database/src/dixon-coles-repository.ts:38-46, 80` (writer: `packages/database/src/forecast-repository.ts:81`)
**Issue:** `ForecastSnapshot.receipt` is written as the whole `ForecastResponseDto` (`receipt: response as never`). `parseForecastResponse(row.receipt)` in `toDto` confirms this. In that object `expectedGoals` lives at `receipt.receipt.expectedGoals`. `expectedGoalsOf(snapshot.receipt)` reads `receipt.expectedGoals` at the top level, which is always `undefined`. The function returns `null` and `collectRows` skips every snapshot. The result is `sampleSize = 0` and `method: "insufficient-sample-zero"` for every league. The new default model is therefore the Poisson model under a new label. The model card and methodology page describe a league-fitted rho that never happens. Provenance stays honest (`insufficient-sample-zero`), but the feature is non-functional. The integration test `tests/integration/dixon-coles-rho.test.ts:129` seeds `receipt: { forecastSnapshotId, expectedGoals: {...} }`, a shape production never produces, so the suite passes while production is broken.
**Fix:**
```ts
function expectedGoalsOf(receipt: unknown) {
  const dto = receipt as { receipt?: { expectedGoals?: unknown } } | null;
  const expectedGoals = dto?.receipt?.expectedGoals;
  ...
}
```
Alternatively select the real shape through `parseForecastResponse`. Change the integration test seed to the true DTO shape, `receipt: { ...dto, receipt: { expectedGoals } }`. Better, build the seed through `createPrismaForecastRepository.publish` so a writer/reader mismatch fails the test.

### CR-02: `GET /evaluation/model-comparison` is described as an operator endpoint but has no `OperatorGuard`

**File:** `apps/api/src/modules/evaluation/evaluation.controller.ts:10-11, 35-39` and `apps/api/src/modules/evaluation/evaluation.module.ts:7`
**Issue:** The controller carries only `@UseGuards(EligibilityGuard)`. That guard trusts client-supplied `x-eligibility-*` headers and is not an authorization control. All other operator surfaces (`fixtures`, `operations`, `provider-policy`, `provider-logo`) use `OperatorGuard`, which answers 404 without `x-operator-credential`. Any caller who can set the eligibility headers can therefore:
- enumerate plan IDs, `planHash`, `configHash` and model versions;
- trigger `compareBacktestPlans`, which loads all `scoreIds` for two plans and runs `IN (...)` aggregates with no rate limit.

This is an authorization gap and an information/load exposure.
**Fix:** Protect the route with `@UseGuards(OperatorGuard)` on `modelComparison` only. `EligibilityGuard` stays class-level for the public routes. Register `OperatorGuard` in `EvaluationModule.providers`. Add an integration test that expects 404 without `x-operator-credential`.

## Warnings

### WR-01: Spurious lower bound `-1/(λh·λa)` over-restricts rho, so one high-scoring row can force a zero fallback for a whole league

**File:** `packages/domain/src/forecast/dixon-coles.ts:64-75` (also stated in `packages/domain/src/methodology/model-card.ts:74`)
**Issue:** The doc says the band comes from strict positivity of the four tau factors. Positivity gives only:
- ρ > −1/λa (from τ10)
- ρ > −1/λh (from τ01)
- ρ < 1/(λh·λa) (from τ00)
- ρ < 1 (from τ11)

τ00 = 1 − λhλaρ is greater than 1 for negative ρ, so `-1/(λh·λa)` is not a positivity bound. For λh, λa ≥ 1 it is the largest of the three lower values (for example λ = (2, 2) gives −0.25 instead of the true −0.5). The estimator intersects the bands of all rows (`min = max over rows`). A single row with a large λ product therefore raises `min` above the true MLE, `score(min) > 0` fails, and the fitter returns zero for the whole window. At forecast time the same bound can make `assertDixonColesRho` reject a legitimate rho. The model card publishes the incorrect bound to users.
**Fix:** Use `min: Math.max(-1 / lambdaHome, -1 / lambdaAway)`. Fix the formula in `model-card.ts` and the methodology page. Add a unit test for λ = (2, 2) with ρ = −0.4 accepted.

### WR-02: Score function is evaluated exactly at the open-interval endpoints where tau = 0

**File:** `packages/domain/src/forecast/dixon-coles.ts:181`
**Issue:** `score(min)` and `score(max)` are evaluated at points where one tau equals 0 by construction. `1 + λa·(−1/λa)` is not exactly 0 in floating point for roughly 15% of λ values (it can be ±1.1e-16). The term `derivative / tau` then becomes ±huge or ±Infinity, and Infinity − Infinity yields NaN. A slightly negative tau flips the sign of the term, so `!(score(min) > 0)` can be true even though a root exists. The estimator then silently falls back to `rho = 0` depending on the exact lambda values. The behaviour is deterministic but arbitrary.
**Fix:** Bracket with the same epsilon the forecast assertion uses: `lo = min + eps`, `hi = max - eps`, with `eps = DIXON_COLES_CONFIG.dixonColes.boundsEpsilon`. Evaluate the sign checks at those points. Add a test with λ values for which `x * (1 / x) !== 1`.

### WR-03: A fitted rho that is outside the forecast's own band throws an uncoded error (HTTP 500, silent sweep miss)

**File:** `packages/domain/src/forecast/dixon-coles.ts:78-85, 107`, `packages/domain/src/forecast/model.ts:160`, `apps/api/src/modules/forecasts/forecasts.service.ts:11-38`, `workers/data-sync/src/jobs/forecast-sweep.ts:172`
**Issue:** rho is fitted against the intersection of historical bands. The new fixture has its own λ pair, and `applyDixonColesCorrection` calls `assertDixonColesRho`, which throws a plain `Error("INVALID_DIXON_COLES_RHO")` with no `.code`. In the API, `generateForecast` only maps errors that carry a `code`, so it rethrows an unclassified error that surfaces as HTTP 500. In the sweep the error is caught per fixture and logged as `fixture_failed`, and the fixture is retried every tick and never issued. Fail-closed is right in principle, but there is no coded error, no degrade path, and no alert.
**Fix:** Throw a coded error (`coded("DIXON_COLES_RHO_OUT_OF_BAND")`). In the orchestrator, either clamp the fit into the new fixture's band (then record that in provenance) or fall back to an explicit `rho = 0` with `method: "insufficient-sample-zero"`. Map the code in `failure()`.

### WR-04: Fitted rho depends on mutable DB state, so receipts are not reproducible for the same (league, asOf)

**File:** `packages/database/src/dixon-coles-repository.ts:60-72`
**Issue:** The snapshot filter uses `cutoff < asOf`, but nothing bounds `issuedAt` or `createdAt` by `asOf`.
- Snapshots backfilled later, and snapshots published by the backtest itself (`initiator: backtest` goes through the same `publish`), enter the training set of later fits. Re-running a plan, running windows concurrently (`concurrency` up to 4), or re-fitting after a backfill changes `rho`, `sampleSize` and `inputHash` for the same inputs.
- This contradicts "reproducible" in the project core value. It also makes the poisson-versus-DC backtest comparison depend on execution order.
- The lambdas themselves are cutoff-safe, so this is not look-ahead leakage. It is non-determinism.
- The latest revision is chosen per fixture. If that revision has `cutoff >= kickoff` the fixture is dropped entirely instead of falling back to the last pre-kickoff revision.

**Fix:** Filter on `issuedAt: { lte: asOf }` for production fits. For backtests, pin the training set explicitly (for example persist the fixture IDs or a digest of the training rows in the provenance and assert it). Choose the latest revision among those that satisfy `cutoff < min(asOf, kickoff)`.

### WR-05: Comparison receipt does not describe the cohort it was computed on, and the verdict has no sample-size guard

**File:** `packages/database/src/evaluation/backtest-repository.ts:128-140`, `packages/domain/src/evaluation/model-comparison.ts:81-92`
**Issue:**
- `windows` and `windowsDigest` come from every window of the plan. The Brier and log-loss scores are filtered by `market` and `kickoffUtc BETWEEN from AND to`. A receipt for a sub-range therefore carries a digest of a different cohort ("Stable digest of the evaluated cohort" is false).
- `sampleSize` equality is a count check, not an identity check. Missing scores on one side could be offset elsewhere.
- The upper bound is inclusive (`lte: to`). `/evaluation/scorecard` uses `[from, to)`, so the two surfaces disagree at the boundary.
- `modelComparisonVerdict` returns `BETTER` or `WORSE` from a point Brier delta ≥ 0.002 with no minimum sample size or uncertainty. A one-window plan can be published as `BETTER`, which risks an overclaim given the project's "no certainty" rule.

**Fix:** Derive `windows` from the fixtures that actually have scores in the filtered set. Compare fixture ID sets, not counts. Use `lt: to`. Add a `minimumSampleSize` to `MODEL_COMPARISON_POLICY` and return `INCONCLUSIVE` below it.

### WR-06: Methodology page and model card make claims that the product does not back

**File:** `apps/web/app/methodology/page.tsx:57`, `packages/domain/src/methodology/model-card.ts:74, 85-91`
**Issue:**
- The page says the scorecards link ("Сравнение моделей ... на одинаковых окнах") shows how the hybrid compares with V1. `/scorecards#formula-policy-receipts` renders only formula and policy identifiers (`scorecard-dashboard.tsx:88`). No UI consumes `/evaluation/model-comparison`.
- The card describes a league-fitted rho within the window and a pooled fallback. Per CR-01 production never fits.
- `rhoBounds` publishes the incorrect formula from WR-01.

**Fix:** Remove or soften the sentence until a comparison view exists. Do not publish the card (version v1.1.0) until CR-01 and WR-01 are fixed, or add an honest note. Correct the bounds string.

## Info

### IN-01: Hash canonicalization sorts keys with `localeCompare` (locale/ICU-dependent) in three places

**File:** `packages/domain/src/forecast/model.ts:62`, `packages/domain/src/forecast/config.ts:65`, `packages/domain/src/evaluation/forecast-orchestrator.ts:49`
**Issue:** `localeCompare` ordering depends on ICU and locale. Hash determinism should not depend on the host. Current keys happen to order identically, but any future mixed-case or underscore key can diverge. Hashes are pinned for V1, so a change needs a regression check. Three copies of `canonical()` also drift easily.
**Fix:** Extract one `canonicalJson` helper with code-unit ordering (`a < b ? -1 : a > b ? 1 : 0`). Assert the V1 hash is unchanged.

### IN-02: Backtest plan admission does not validate `configHash` against `modelVersion`

**File:** `workers/data-sync/src/jobs/backtests.ts:40`
**Issue:** A plan with a mismatching `configHash` is persisted and enqueued. Every window then fails with `CONFIG_HASH_MISMATCH` inside the orchestrator after claim and failure bookkeeping.
**Fix:** Check `value.configHash === forecastConfigHashFor(value.modelVersion)` in `admitBacktestPlan` and throw before persisting.

### IN-03: Server-side configuration errors are mapped to HTTP 400

**File:** `apps/api/src/modules/forecasts/forecasts.service.ts:12-15`
**Issue:** `DIXON_COLES_RHO_UNAVAILABLE`, `MODEL_VERSION_MISMATCH` and `CONFIG_HASH_MISMATCH` are server-side failures but fall through to `BadRequestException`. This misleads clients and monitoring.
**Fix:** Map them to `ServiceUnavailableException` or 500.

### IN-04: Undefined symbol "μ" in user-facing text

**File:** `apps/web/app/methodology/page.tsx:56`, `packages/domain/src/methodology/model-card.ts:85`
**Issue:** The text says "при фиксированных λ и μ", but the formulas use λh and λa. μ is never defined.
**Fix:** Write "λh и λa".

---

_Reviewed: 2026-11-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Disposition (2026-11-23)

| Finding | Status | Where |
|---------|--------|-------|
| CR-01 | fixed | `2f8cea6` |
| CR-02 | fixed | `2f8cea6` |
| WR-01 | fixed | rho bounds `max(-1/λh, -1/λa) < ρ < min(1/(λh·λa), 1)`; test λ=(2,2) |
| WR-02 | fixed | bisection bracketed at `min+ε` / `max-ε`; non-finite scores fall back |
| WR-03 | fixed | out-of-band fitted rho degrades to explicit `rho = 0`, method `out-of-band-zero` (recorded in receipt); `assertDixonColesRho` throws a coded error |
| WR-04 | fixed (partly) | fit uses only snapshots with `issuedAt <= asOf`, newest usable revision per fixture. Residual: snapshots issued by a backtest are indistinguishable from production ones for a fit at `asOf = now` |
| WR-05 | fixed | scored-cohort windows, fixture-set identity, `[from, to)`, `minimumSampleSize = 30`, policy `model-comparison-v2` |
| WR-06 | fixed | card bounds string, rho policy/fallbacks, page no longer claims a public comparison view |
| IN-04 | fixed | «μ» replaced with λh / λa |
| IN-01, IN-02, IN-03 | open | duplicated `canonical()`, late `configHash` check in plan admission, config errors mapped to HTTP 400 |
