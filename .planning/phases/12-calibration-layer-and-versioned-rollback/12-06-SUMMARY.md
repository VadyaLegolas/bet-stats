---
phase: 12-calibration-layer-and-versioned-rollback
plan: 06
subsystem: api
tags: [calibration, forecast-api, read-time, identity-pinning, soft-failure, read-only, nestjs]

requires:
  - phase: 12-calibration-layer-and-versioned-rollback
    provides: "12-02: resolveForecastCalibration, unavailableMarketCalibration, CalibratedForecastResponseDto, parseMarketCalibrationMap; 12-03: calibration repository; 12-04: readCalibrationState"
provides:
  - "attachMarketCalibration: per-market calibration state attached to forecast responses at read time"
  - "ForecastsService.list, get and generate return CalibratedForecastResponseDto; controller return types extended"
  - "tests/helpers/forecast-dto.ts: valid full ForecastResponseDto for any pinned identity"
affects: [12-07]

actuals:
  tokens: 12300
  tasks: 2
  commits: 2

plan_head_before: 8bd0a24500a40ad107dd9f375b2390da23faf412
plan_head_after: 610f6a2530e2d8c270b661fa3a7fea642f25bed0

tech-stack:
  added: []
  patterns:
    - "Enrichment is a pure wrapper: { ...forecast, marketCalibration }; the stored DTO and receipt are never rebuilt or mutated"
    - "State read once per distinct forecast identity and request; no cache between requests"
    - "The forecast's own identity is the only identity passed to the resolver, which applies the calibrator with it"

key-files:
  created:
    - apps/api/src/modules/forecasts/forecast-calibration.ts
    - tests/helpers/forecast-dto.ts
    - tests/unit/forecast-calibration.test.ts
    - tests/integration/forecast-calibration-api.test.ts
  modified:
    - apps/api/src/modules/forecasts/forecasts.service.ts
    - apps/api/src/modules/forecasts/forecasts.controller.ts

key-decisions:
  - "The reader is a public mutable property `calibration` of ForecastsService (default: readCalibrationState on the service's own client, `now: () => new Date()`), because an optional constructor parameter would be resolved by Nest dependency injection; it is a test seam only"
  - "A failed read of one identity degrades only the forecasts of that identity; the cause is never put into the response"
  - "asOf of the census is the request moment (ISO UTC); the cache lives only inside one attachMarketCalibration call"

requirements-completed: [CALIB-01, CALIB-02, CALIB-04]

coverage:
  - id: G1
    description: "List, exact request and generate responses carry marketCalibration for ONE_X_TWO, OVER_UNDER_2_5 and BTTS with rawProbabilities equal to probabilities[market]; every stored field and the receipt stay byte-identical, exactly one key is added"
    requirement: CALIB-01
    verification:
      - kind: unit
        ref: "tests/unit/forecast-calibration.test.ts#adds exactly one key..."
        status: pass
      - kind: integration
        ref: "tests/integration/forecast-calibration-api.test.ts#keeps every stored field byte-identical..., #the exact request returns the same enrichment as the list, #generate returns the freshly issued forecast..."
        status: pass
    human_judgment: false
  - id: G2
    description: "The calibrator comes from the forecast's own pinned identity: a calibrator of another model version, config hash or market is UNAVAILABLE (MODEL/MARKET mismatch), never CALIBRATED; V1 forecasts do not inherit the DC calibrator"
    requirement: CALIB-02
    verification:
      - kind: unit
        ref: "tests/unit/forecast-calibration.test.ts#a calibrator of another identity is never applied"
        status: pass
      - kind: integration
        ref: "tests/integration/forecast-calibration-api.test.ts#with a promoted DC calibrator..., #through the service, a reader that hands a calibrator of another identity yields MISMATCH"
        status: pass
    human_judgment: false
  - id: G3
    description: "Below the threshold without a calibrator the state is INSUFFICIENT_DATA with sampleSize 20 and requiredSample 300; at 300 and more without a calibrator UNAVAILABLE/NO_PROMOTED_CALIBRATOR; INITIAL is KIND_NOT_COVERED"
    requirement: CALIB-04
    verification:
      - kind: integration
        ref: "tests/integration/forecast-calibration-api.test.ts#without a calibrator..., #shows a rollback..."
        status: pass
    human_judgment: false
  - id: G4
    description: "Rollback is visible: version 2 after supersession, version 1 with the same calibrated probabilities after the successor is rolled back, raw only after C1 is rolled back"
    requirement: CALIB-02
    verification:
      - kind: integration
        ref: "tests/integration/forecast-calibration-api.test.ts#shows a rollback..."
        status: pass
    human_judgment: false
  - id: G5
    description: "A failing reader is soft (CALIBRATION_READ_FAILED on every market, forecast returned whole, no cause leaked); reads never write: md5 of eight tables unchanged; value decisions identical with and without a calibrator and for raw or enriched input"
    requirement: CALIB-04
    verification:
      - kind: integration
        ref: "tests/integration/forecast-calibration-api.test.ts#a failing reader is soft..., #reads never write..., #shows a rollback..."
        status: pass
    human_judgment: false

duration: ~60min
completed: 2026-11-24
status: complete
---

# Phase 12 Plan 06: Calibration state in the forecast API Summary

**Forecast responses (list, exact request, issue) now carry a separate `marketCalibration` key with per-market raw probabilities and a closed calibration block, computed at read time from the calibrator pinned to the forecast's own identity; the stored receipt is untouched, a failed read degrades to UNAVAILABLE and value stays on raw probabilities.**

## Performance

- **Duration:** about 60 min
- **Tasks:** 2 (Task 1 tracer, Task 2 TDD)
- **Commits (measured, `git rev-list --count 8bd0a24..HEAD` before the docs commits):** 2 (2a43b61, 610f6a2)
- **`git rev-parse HEAD` before the first edit:** `8bd0a24500a40ad107dd9f375b2390da23faf412`
- No dependency, lockfile or migration changes. `packages/database/src/forecast-repository.ts`, `packages/domain/src/forecast`, `apps/api/src/modules/value`, `apps/web/app/internal-api/fixtures` untouched (`git diff --quiet 3c5f75e..HEAD` exit 0). `parseForecastResponse` and the frozen DTO are not changed; the controller only has new return types (headers and logic untouched).

## Red evidence

- **Task 1:** `pnpm vitest run --project unit tests/unit/forecast-calibration.test.ts` with `forecast-calibration.ts` moved away -> `Error: Cannot find module '../../apps/api/src/modules/forecasts/forecast-calibration.js' imported from .../tests/unit/forecast-calibration.test.ts`, `Tests no tests`. The tests were written before the implementation but first executed after it; the red state was produced by removing the module. The integration suite was not run in a red state (its first run was against the implementation; failures there were seed errors only: the Dixon-Coles provenance convention in the DTO helper).
- **Task 2:** all scenarios green on the first run; the identity mutation below was therefore the proof that the guard tests can fail.

## GUARD MUTATION

- `GUARD MUTATION: forecast identity (the resolver is given the identity read from the active calibrator instead of the forecast's own) -> unit: "a V1 forecast handed a calibrator pinned to Dixon-Coles is UNAVAILABLE/CALIBRATOR_MODEL_MISMATCH on every market", "the same model version with another config hash is a mismatch as well", "a mismatch for one forecast does not touch the matching forecast of the same request"; integration: "through the service, a reader that hands a calibrator of another identity yields MISMATCH, never CALIBRATED"`. The mutation was restored with `git checkout -- apps/api/src/modules/forecasts/forecast-calibration.ts` and not committed.

## Signature

```ts
// apps/api/src/modules/forecasts/forecast-calibration.ts
interface CalibrationEnrichmentDeps {
  readState(identity: CalibratorIdentity, asOf: string): Promise<CalibrationState>;   // CalibrationState from @bet-stats/database (readCalibrationState result)
  now(): Date;
}
attachMarketCalibration<T extends ForecastResponseDto>(
  forecasts: readonly T[],
  deps: CalibrationEnrichmentDeps,
): Promise<Array<T & Pick<CalibratedForecastResponseDto, "marketCalibration">>>;
```

`ForecastsService.calibration: CalibrationEnrichmentDeps` (public property, test seam); `list(fixtureId)`, `get(fixtureId, kind, cutoff)` and `generate(input)` return `CalibratedForecastResponseDto`. `generateForecast` is unchanged.

## Response examples (shape only: numbers illustrative, no calibrator ids)

`marketCalibration.OVER_UNDER_2_5` in each state (the other two markets have the same form):

```json
{ "rawProbabilities": [0.4, 0.6],
  "calibration": { "state": "CALIBRATED", "calibratedProbabilities": [0.43, 0.57], "calibratorVersion": 1, "method": "PLATT", "sampleSize": 80, "holdoutBrierRaw": 0.52, "holdoutBrierCalibrated": 0.49 } }
```
```json
{ "rawProbabilities": [0.4, 0.6],
  "calibration": { "state": "INSUFFICIENT_DATA", "sampleSize": 20, "requiredSample": 300, "reasonCode": "INSUFFICIENT_SETTLED_OUTCOMES" } }
```
```json
{ "rawProbabilities": [0.4, 0.6], "calibration": { "state": "UNAVAILABLE", "reasonCode": "NO_PROMOTED_CALIBRATOR" } }
```

Other `UNAVAILABLE` reason codes seen in the tests: `KIND_NOT_COVERED` (INITIAL), `CALIBRATOR_MODEL_MISMATCH`, `CALIBRATOR_MARKET_MISMATCH`, `CALIBRATION_READ_FAILED` (failed read). The `calibration` block never contains keys outside `state, calibratedProbabilities, calibratorVersion, method, sampleSize, requiredSample, holdoutBrierRaw, holdoutBrierCalibrated, reasonCode`; no parameters, calibrator ids, digests or config hashes (checked by regular expression over the serialised block).

## Verification run

- Three consecutive runs of `tests/unit/forecast-calibration.test.ts` (13 tests) and `tests/integration/forecast-calibration-api.test.ts` (12 tests): 13/13 and 12/12 each time.
- Regression: `pnpm vitest run --project integration tests/integration/value-api.test.ts tests/integration/forecast-api.test.ts tests/integration/forecast-publication.test.ts` plus `tests/integration/value-receipt.test.ts` -> value-receipt needs a `DATABASE_URL` (it would otherwise fail at import with `DATABASE_URL is required`); it was run against a throwaway container migrated by `prisma migrate deploy` (10 tests passed), the other three files passed together (17 tests with value-api and forecast-api). `pnpm vitest run --project unit tests/unit/calibration-view.test.ts` 57 passed.
- `pnpm --filter @bet-stats/api typecheck` and `lint` clean; `pnpm typecheck` 7 successful; root `tsc -p tsconfig.json --noEmit` reports nothing under `forecast-calibration`/`forecast-dto`.
- `grep -c attachMarketCalibration apps/api/src/modules/forecasts/forecasts.service.ts` = 4.
- Throwaway containers (`bet-stats-forecast-calibration-*`, `bet-stats-vr-*`) removed with `docker rm --force --volumes`; only the two pre-existing development containers remain; the development database and `.env*` were not touched. No browser tests, no ports 3000 or 3001.

## Deviations from Plan

### Auto-fixed Issues

None: no scenario exposed a defect in the enrichment or the resolver.

### Plan variations

**1. [Seam] Reader as a public property instead of a constructor argument**
- The plan says the reader is created "in the constructor"; a typed optional constructor parameter would be picked up by Nest's dependency injection (emitted as `Object`). `calibration` is therefore a public mutable property initialised in the constructor from the service's own Prisma client; tests replace it.

**2. [Additions beyond files_modified]**
- `tests/helpers/forecast-dto.ts` (a valid full DTO for any identity, shared by both suites); the Dixon-Coles block uses `DIXON_COLES_CONVENTION`.
- The generate scenario runs the real service with the publication repository replaced (`repository` field) by a fake like the existing `generateForecast` tests; the reader for it is the real database reader.

**3. [Test scope]**
- Value independence is proven on the value service's decision for the stored forecast: identical receipts (without `createdAt`) for the raw stored DTO and for the enriched API object, with C1 active, C2 active, C1 restored, no calibrator and with 305 outcomes. The value service itself does not import anything of calibration (not modified).
- "A real reader failure" is simulated by a throwing reader (the service cannot read forecasts at all when the database is down, so a calibration-only database failure is not separable at that level).

**Total deviations:** 0 auto-fixes, 3 plan variations. **Impact:** none on scope.

## Authentication Gates

None.

## Issues Encountered

- A Node one-liner over a CRLF file (`forecasts.service.ts`) matched nothing the first time (patterns assumed LF); the files were normalised and edited again, and a failed partial edit of the controller was completed by hand before any commit.
- `value-receipt.test.ts` requires an externally supplied `DATABASE_URL`; it was never pointed at the development database.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-12-21 (identity from the forecast itself, mutation proof), T-12-22 (new key only, byte-identical receipt, value unchanged), T-12-23 (soft failure), T-12-24 (closed key set, no ids or parameters), T-12-25 (`Cache-Control: private, no-store, max-age=0` unchanged, asserted on `get` and `generate`; no cache between requests), T-12-SC (no dependencies).

## Not verified / limits

- The HTTP layer was not exercised: controller methods were called directly, the `EligibilityGuard` and Nest routing were not started, and the `Cache-Control` header was checked through the decorator metadata rather than a live response.
- The web proxy (`apps/web/app/internal-api/fixtures/[fixtureId]/forecasts/route.ts`) passes the JSON through; it was not run against the new payload, and the UI does not read `marketCalibration` yet (plan 12-07).
- Performance: each request runs one census (full fit-sample read) per distinct identity; with hundreds of rows today this is cheap, at thousands of forecasts per identity it should be cached or precomputed (threshold noted in the plan's T-12-15).
- The census `asOf` is the request moment: a forecast issued in the past gets today's calibrator and today's count, as required by "computed at read time", and not the state at issuance.

## Next Phase Readiness

Ready for 12-07: the UI can read `marketCalibration` from the existing forecast endpoints (types: `CalibratedForecastResponseDto`, closed `calibration` block, reason codes above, seed numbers in `12-05-SUMMARY.md`).

## Self-Check: PASSED

- Files: `forecast-calibration.ts`, `forecasts.service.ts`, `forecasts.controller.ts`, `forecast-dto.ts`, both test files exist.
- Commits: 2a43b61 and 610f6a2 are ancestors of HEAD.
