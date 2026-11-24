---
phase: 12-calibration-layer-and-versioned-rollback
plan: 03
subsystem: database
tags: [calibration, postgresql, prisma, append-only, event-log, migrations, advisory-lock, rollback]

requires:
  - phase: 12-calibration-layer-and-versioned-rollback
    provides: "12-01: FittedCalibrator, calibratorContentId, applyCalibrator; 12-02: lifecycle decision and ActiveCalibrator view contract"
provides:
  - "Calibrator and CalibratorEvent tables: append-only, composite identity foreign keys, window chronology CHECK (D-05, D-06, D-09)"
  - "current_calibrators and calibrator_versions views: active calibrator and promotion number derived from the event log; rollback is an appended event"
  - "BEFORE INSERT transition trigger: permitted lifecycle transitions enforced by the database under a per-(identity, market) advisory lock"
  - "createPrismaCalibrationRepository: idempotent persist, identity-parameterised active lookup, promote (SUPERSEDED + PROMOTED pair), rollback, evaluation, event listing"
affects: [12-04, 12-05, 12-06, 12-07]

actuals:
  tokens: 35400
  tasks: 3
  commits: 4

plan_head_before: 5fdcbefa4e8cf6edcc1168dbe224dc6ade5aab7e
plan_head_after: fa28c75b92168de45922991701f76cd6ee5b5d68

tech-stack:
  added: []
  patterns:
    - "Event-sourced active state: the active calibrator is a view over an append-only log, never a stored column"
    - "Structure and transitions guarded in SQL; policy (thresholds, hysteresis) stays in the versioned config (D-07)"
    - "Per-key pg_advisory_xact_lock taken by both the repository and the trigger (hashtextextended of modelVersion:configHash:market)"

key-files:
  created:
    - packages/database/prisma/migrations/20261125_phase12_calibrator_tables/migration.sql
    - packages/database/prisma/migrations/20261125_phase12_calibrator_transitions/migration.sql
    - packages/database/src/calibration-repository.ts
    - packages/database/src/generated/prisma/models/Calibrator.ts
    - packages/database/src/generated/prisma/models/CalibratorEvent.ts
    - tests/helpers/calibration-db.ts
    - tests/integration/calibration-schema.test.ts
    - tests/integration/calibration-transitions.test.ts
    - tests/integration/calibration-upgrade.test.ts
  modified:
    - packages/database/prisma/schema.prisma
    - packages/database/src/index.ts
    - packages/database/src/generated/prisma/browser.ts
    - packages/database/src/generated/prisma/client.ts
    - packages/database/src/generated/prisma/commonInputTypes.ts
    - packages/database/src/generated/prisma/internal/class.ts
    - packages/database/src/generated/prisma/internal/prismaNamespace.ts
    - packages/database/src/generated/prisma/internal/prismaNamespaceBrowser.ts
    - packages/database/src/generated/prisma/models.ts

key-decisions:
  - "Event order is a database identity column `seq`, re-drawn by the transition trigger after the advisory lock is held, so seq order always equals admission order even for concurrent raw-SQL writers"
  - "A rollback target is not stored on the rollback: it is the predecessor recorded by the rolled-back calibrator's own PROMOTED event, and the trigger requires the ROLLED_BACK event to name exactly that (NULL-safe)"
  - "Event decision config (version, hash) defaults to the calibrator's own fit config; the repository accepts an optional override for evaluations and rollbacks taken under a newer config"
  - "Calibrator keeps isotonicHoldoutBrier next to plattHoldoutBrier so a stored row rebuilds a FittedCalibrator equal to the original"

requirements-completed: [CALIB-02, CALIB-03]

coverage:
  - id: D1
    description: "Calibrator and CalibratorEvent are append-only: UPDATE and DELETE are rejected with `... is immutable`"
    requirement: CALIB-03
    verification:
      - kind: integration
        ref: "tests/integration/calibration-schema.test.ts#rejects UPDATE and DELETE on both tables"
        status: pass
    human_judgment: false
  - id: D2
    description: "An event cannot reference a calibrator of another model version, config hash or market: composite foreign keys on all four links (ON DELETE RESTRICT); lookup takes the forecast identity as a query parameter and returns null for any other identity or market"
    requirement: CALIB-02
    verification:
      - kind: integration
        ref: "tests/integration/calibration-schema.test.ts#has the composite identity key..., #rejects an event bound to a calibrator of another..., #rejects optional calibrator links..., #derives the active calibrator..."
        status: pass
    human_judgment: false
  - id: D3
    description: "Window chronology fitFrom<=fitTo<=holdoutFrom<=holdoutTo<=fitAsOf, identity/market/method/type/shape/format CHECKs"
    requirement: CALIB-02
    verification:
      - kind: integration
        ref: "tests/integration/calibration-schema.test.ts#rejects a calibrator whose windows are not chronological, #rejects malformed identity, market, method, event type and shape"
        status: pass
    human_judgment: false
  - id: D4
    description: "Invalid transitions rejected by the trigger (promotion over a non-active predecessor, re-promotion, rollback of an inactive calibrator, wrong rollback target, evaluation of an inactive calibrator, bad supersession), each proved by raw SQL as well as through the repository"
    requirement: CALIB-03
    verification:
      - kind: integration
        ref: "tests/integration/calibration-transitions.test.ts (14 it blocks on transitions)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Rollback restores the predecessor with its own version number (v1 stays v1) or raw probabilities; full series promote, supersede, rollback, rollback leaves six ordered unchanged events"
    requirement: CALIB-03
    verification:
      - kind: integration
        ref: "tests/integration/calibration-transitions.test.ts#restores the predecessor with its own version number..., #walks the full series..."
        status: pass
    human_judgment: false
  - id: D6
    description: "Concurrency: two concurrent promotions (repository), two concurrent supersessions and two raw-SQL promotions give exactly one winner and one coded CALIBRATOR_TRANSITION_REJECTED; three consecutive full runs green"
    requirement: CALIB-03
    verification:
      - kind: integration
        ref: "tests/integration/calibration-transitions.test.ts#never lets two concurrent..., #serialises concurrent raw-SQL promotions..."
        status: pass
    human_judgment: false
  - id: D7
    description: "Frozen tables (ForecastSnapshot, ForecastMarket, ResultVersion, SettlementReceipt, ForecastScore, ValueReceipt, ValueSettlement) are byte-identical, with unchanged relfilenode, after the migrations on a populated database and after every repository operation"
    requirement: CALIB-02
    verification:
      - kind: integration
        ref: "tests/integration/calibration-upgrade.test.ts"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-11-24
status: complete
---

# Phase 12 Plan 03: Calibrator storage, event log and repository Summary

**Append-only `Calibrator` and `CalibratorEvent` tables with composite identity foreign keys, a transition-guard trigger and event-derived active-calibrator views, plus a Prisma repository whose rollback is an appended event; the frozen evidence tables are provably untouched.**

## Performance

- **Duration:** about 40 min
- **Tasks:** 3 (Task 1 tracer, Tasks 2 and 3 TDD)
- **Commits (measured, `git rev-list --count 5fdcbef..HEAD`):** 4 (86c50c2, 4f1c89c, 89b1bc1, fa28c75)
- **`git rev-parse HEAD` before the first edit:** `5fdcbefa4e8cf6edcc1168dbe224dc6ade5aab7e`
- No dependency, lockfile or `package.json` changes.

## Red evidence

- **Task 1:** `pnpm vitest run --project integration tests/integration/calibration-schema.test.ts` before the migration -> 9 of 9 failed; first database error line: `ERROR:  relation "Calibrator" does not exist` (`LINE 1: INSERT INTO "Calibrator" ...`). Green afterwards: 9 tests.
- **Task 2:** `pnpm vitest run --project integration tests/integration/calibration-transitions.test.ts` with the repository operations present but the transitions migration moved away -> `Tests 11 failed | 3 passed (14)`. The 11 failures are exactly the invalid-transition and concurrency cases (invalid transitions were accepted, two concurrent promotions both succeeded); the 3 that passed are the valid sequences (supersede, restore with own version, full series). Green with the migration: 14, later 15 tests.
- **Task 3:** the migrations already existed, so the suite could not be red against a missing feature; it was green on the second run after a seed fix (the first run failed only because the seeded forecast probabilities disagreed with the seeded value receipt: `value receipt derived fields disagree with immutable source snapshots`).

## Migrations (order and content)

1. `20261125_phase12_calibrator_tables`: tables `Calibrator` (id `calibrator_`+64 hex, pinned identity, market, method, JSONB parameters, config version and hash, samples digest, fit/holdout sizes, five timestamps, holdout Briers, createdAt) and `CalibratorEvent` (id `calibrator_event_`+64 hex, `seq` BIGINT GENERATED ALWAYS AS IDENTITY, type, identity, four calibrator links, reasonCode, asOf, evaluation JSONB, config version and hash); named CHECKs (formats, closed vocabularies, shape by type, window chronology, Brier in [0, 2]); unique index `(id, modelVersion, configHash, market)` as the composite foreign-key target; four composite foreign keys with ON DELETE/UPDATE RESTRICT; indexes on `(modelVersion, configHash, market)`, `(modelVersion, configHash, market, seq)`, `(calibratorId, seq)`, `seq`; append-only triggers `Calibrator_append_only` / `CalibratorEvent_append_only`; views `current_calibrators` and `calibrator_versions`.
2. `20261125_phase12_calibrator_transitions`: function `guard_calibrator_event_transition()` and BEFORE INSERT trigger `CalibratorEvent_guarded_transition`. Takes `pg_advisory_xact_lock(hashtextextended('<modelVersion>:<configHash>:<market>', 0))`, re-draws `seq` from the identity sequence, derives the active calibrator by the rule of the view, then applies per type: PROMOTED (no earlier PROMOTED/ROLLED_BACK for that calibrator; predecessor equals active NULL-safely; a non-NULL predecessor needs a prior SUPERSEDED(predecessor -> this)), ROLLED_BACK (calibrator is active; restored equals the predecessor of its PROMOTED event NULL-safely), SUPERSEDED (calibrator is active; successor differs and has no PROMOTED/ROLLED_BACK), EVALUATED (calibrator is active). Messages start with `CalibratorEvent transition rejected:`.

Both are forward-only: only CREATE statements, no UPDATE/DELETE/INSERT, no edits of existing migrations or models.

## Contract for plans 04-07

Exports of `@bet-stats/database` (all from `packages/database/src/calibration-repository.ts`): `createPrismaCalibrationRepository(client)`, `CALIBRATION_MARKETS`, `readStoredCalibratorEvaluation(value)`, and the types below.

```ts
interface CalibrationRepository {
  persistCalibrator(fitted: FittedCalibrator): Promise<{ calibratorId: string; created: boolean }>;   // id = calibratorContentId; idempotent (ON CONFLICT DO NOTHING)
  findCalibrator(calibratorId: string): Promise<FittedCalibrator | null>;
  findActiveCalibrator(identity: CalibratorIdentity, market: ScoreMarket): Promise<ActiveCalibratorState | null>;
  findActiveCalibrators(identity: CalibratorIdentity): Promise<Record<ScoreMarket, ActiveCalibratorState | null>>;  // one query; identity is a query parameter
  promoteCalibrator(i: { identity; market; calibratorId; predecessorCalibratorId: string | null; asOf: string; reasonCode: string; evaluation: Record<string, unknown>; calibrationConfig?: { version; hash } }):
    Promise<{ eventId: string; created: boolean; supersededEventId: string | null }>;   // predecessor non-null => SUPERSEDED(predecessor) + PROMOTED in one transaction
  rollbackCalibrator(i: { identity; market; calibratorId; restoredCalibratorId: string | null; asOf; reasonCode; evaluation: Record<string, unknown>; calibrationConfig? }): Promise<{ eventId; created }>;
  recordEvaluation(i: { identity; market; calibratorId; asOf; reasonCode; evaluation: StoredCalibratorEvaluation; calibrationConfig? }): Promise<{ eventId; created }>;
  listCalibratorEvents(calibratorId: string): Promise<readonly CalibratorEventRecord[]>;   // events whose subject is this calibrator, ascending seq
  hasBeenRolledBack(calibratorId: string): Promise<boolean>;
}

interface ActiveCalibratorState {   // structurally assignable to the domain's ActiveCalibrator (calibratorId, version, calibrator)
  calibratorId: string; version: number; calibrator: FittedCalibrator;
  activationSeq: number; activatedBy: "PROMOTED" | "ROLLED_BACK"; activatedAt: string;
  restoreTargetId: string | null;   // predecessor of this calibrator's PROMOTED event = rollback target (null = raw only)
}
type StoredCalibratorEvaluation = { sampleSize: number; eligible: boolean; verdict: "BETTER" | "NEUTRAL" | "WORSE" | null; brierRaw: number | null; brierCalibrated: number | null; delta: number | null };
```

How plan 05 builds `LifecycleInput` from the log:

- `active` = `findActiveCalibrator(identity, market)`: `calibratorId`, `restoreTargetId`; `priorEvaluations` = `listCalibratorEvents(calibratorId)` filtered to `type === "EVALUATED" && seq > activationSeq`, mapped through `readStoredCalibratorEvaluation(event.evaluation)` to `{ eligible, verdict }` (null means a malformed row: fail closed). `activationSeq` is the event that made this calibrator active (a PROMOTED, or a ROLLED_BACK that restored it), so evaluations of an earlier activation never count.
- `candidate.everRolledBack` = `hasBeenRolledBack(candidateId)`.
- Persist the lifecycle's `RECORD_EVALUATION` action through `recordEvaluation` with exactly its fields (`sampleSize, eligible, verdict, brierRaw, brierCalibrated, delta`), not a precomputed `evaluation.eligible`; `ROLL_BACK` through `rollbackCalibrator` with `restoredCalibratorId = action.restoreCalibratorId` (must equal `restoreTargetId`, otherwise the database refuses); `PROMOTE` through `promoteCalibrator` with `predecessorCalibratorId = action.predecessorCalibratorId`.
- Event ids are deterministic per (type, calibrator, UTC day of `asOf`, related calibrator): a retry the same UTC day returns `created: false`; the first evaluation of a day wins, a second one the same day is not stored.
- Reads can throw `CalibrationRepositoryError` with `code: "CALIBRATOR_ROW_INVALID"` (unknown model version, market, method or non-object parameters in a stored row); API plan 06 should map it to `CALIBRATION_READ_FAILED`. Parameter contents are validated later by `applyCalibrator`.
- Refusals by the transition trigger surface as `CalibrationRepositoryError` with `code: "CALIBRATOR_TRANSITION_REJECTED"` and the original error as `cause`; a malformed event (bad `asOf`, non-finite number) is `INVALID_CALIBRATION_EVENT`.

## Verification run

- `pnpm vitest run --project integration tests/integration/calibration-schema.test.ts tests/integration/calibration-transitions.test.ts tests/integration/calibration-upgrade.test.ts tests/integration/migration-empty.test.ts tests/integration/settlement-chain-upgrade.test.ts` -> 5 files, 37 tests passed.
- `calibration-transitions.test.ts` three consecutive runs (before the final `seq` re-draw test was added: 14 tests each, then 15): 15/15 passed three times in a row.
- `pnpm vitest run --project unit tests/unit/calibration-platt.test.ts tests/unit/calibration-calibrator.test.ts` -> 59 passed.
- `prisma validate` (placeholder `DATABASE_URL`) valid; `pnpm typecheck` 7 successful; `pnpm --filter @bet-stats/database lint` clean; root `tsc -p tsconfig.json --noEmit` reports nothing under `calibration`/`helpers`.
- Invariants: `git diff --quiet 3c5f75e..HEAD -- package.json pnpm-lock.yaml packages/database/package.json` exit 0; `git diff --quiet 3c5f75e..HEAD -- <phase04_settlement_receipts, 20261123_phase11_settlement_chain_per_forecast, 20261124_phase11_forecast_snapshot_origin>` exit 0; `git diff 3c5f75e -- packages/database/prisma/schema.prisma` has no removed line.
- Acceptance greps: `CalibratorEvent` in schema.prisma >= 1, `createPrismaCalibrationRepository` in index.ts = 1, `CALIBRATOR_TRANSITION_REJECTED` in the repository >= 1.
- Throwaway containers (`bet-stats-calibration-*`) were removed by `docker rm --force --volumes` in `afterAll`; only the two pre-existing development containers remain; the development database was neither used nor migrated.

## Files changed by the Prisma generator

`browser.ts`, `client.ts`, `commonInputTypes.ts`, `internal/class.ts`, `internal/prismaNamespace.ts`, `internal/prismaNamespaceBrowser.ts`, `models.ts` (modified) and `models/Calibrator.ts`, `models/CalibratorEvent.ts` (new). The plan listed only five; `browser.ts`, `client.ts` and `commonInputTypes.ts` are also regenerated by `prisma generate` and were committed. The only removal in the generated diff is the changed `inlineSchema` line.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `isotonicHoldoutBrier` column**
- **Found during:** Task 1 (round-trip test)
- **Issue:** The plan lists only `plattHoldoutBrier`, but `FittedCalibrator` also carries `isotonicHoldoutBrier`; without it a stored row could not rebuild a calibrator equal to the original (the test requires equality of metrics).
- **Fix:** nullable `isotonicHoldoutBrier DOUBLE PRECISION` with the same CHECK, in the first migration and the Prisma model.
- **Commit:** 86c50c2

**2. [Rule 1 - Bug] Event order could diverge from admission order**
- **Found during:** Task 2 (analysis of the trigger)
- **Issue:** the identity default of `seq` is evaluated before a BEFORE INSERT trigger, so a concurrent raw-SQL writer waiting for the trigger's advisory lock could keep a lower `seq` than a writer that was admitted earlier; the "latest by seq" views would then derive the wrong active calibrator. The repository path was already safe (it locks first).
- **Fix:** the trigger re-draws `seq` from the same sequence after it holds the lock; a deterministic test (`setval` to 1000000, expect 1000002) proves the override takes effect on a GENERATED ALWAYS column. Gaps in `seq` are expected.
- **Commit:** 89b1bc1

**3. [Rule 3 - Blocking] Structural tests cannot reach FK/CHECK past the transition trigger**
- **Found during:** Task 2 (4 of 9 schema tests failed after the second migration)
- **Issue:** BEFORE ROW triggers run before CHECK and foreign-key checks, so raw events that are deliberately malformed were answered by the transition trigger instead of the constraint under test.
- **Fix:** `calibration-schema.test.ts` disables `CalibratorEvent_guarded_transition` only around the statements under test (`withoutTransitionGuard`, re-enabled in `finally`); the trigger itself is proved in `calibration-transitions.test.ts`.
- **Commit:** 89b1bc1

**4. [Plan addition] Test helper and repository extras**
- `tests/helpers/calibration-db.ts` (container lifecycle, `migrate deploy`, deterministic fitted calibrators) is shared by the three suites; not in the plan's file list.
- Repository additions needed by plan 05: optional `calibrationConfig` override per event (defaults to the calibrator's own fit config), `readStoredCalibratorEvaluation`, `CalibrationRepositoryError`, `supersededEventId` in the promote result.
- `promoteCalibrator` in commit 4f1c89c (Task 1) wrote a lone PROMOTED event (no database transition rules yet); the SUPERSEDED + PROMOTED pair arrived with Task 2 as planned.

**Total deviations:** 3 auto-fixed (1 Rule 1, 1 Rule 2, 1 Rule 3) plus the additions above. **Impact:** none on scope or on frozen tables.

## Authentication Gates

None.

## Issues Encountered

- A shell heredoc/`node -e` string-escaping slip twice produced a broken edit (a lost backtick and a lost backslash); both were noticed immediately and fixed with the Edit tool before any commit.
- `pg_get_constraintdef` / index definitions are asserted from the real catalog, not migration text; the only text-based check is the supplementary "migrations contain no DROP/TRUNCATE/UPDATE/DELETE/INSERT INTO" test in `calibration-upgrade.test.ts`.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-12-07 (append-only triggers, raw UPDATE/DELETE tests), T-12-08 (composite foreign keys, tests for foreign model, config hash, market and optional links), T-12-09 (transition trigger plus advisory lock, one raw-SQL and one repository test per rule, three concurrency tests), T-12-10 (md5, row counts and relfilenode of seven frozen tables before and after migrations and operations) and T-12-SC (no dependency changes) are covered. T-12-11 accepted as in the plan.

## Not verified / limits

- A lone SUPERSEDED event (without the following PROMOTED) is permitted by the database; the SUPERSEDED + PROMOTED pair is made atomic only by the repository transaction. A later PROMOTED can still complete the pair; a rollback or evaluation in between behaves per the rules above. Not exercised against a crashed writer.
- Behaviour under `SERIALIZABLE` isolation was not tested (everything runs under the default READ COMMITTED); the trigger's reads rely on READ COMMITTED statement snapshots.
- `calibratorContentId` is not recomputed in SQL: the database checks the id format, not that it equals the hash of the content.
- The Prisma schema was validated and the client regenerated, but `prisma migrate diff` against the migrated database was not run (the repository has no such check); the migrations were applied by `prisma migrate deploy` in `migration-empty.test.ts`, the schema and transitions suites.
- No run against the development database (forbidden by the constraints).

## Next Phase Readiness

Ready for 12-04. The worker job (plan 05) writes only through this repository; the API (plan 06) reads through `findActiveCalibrators(forecastIdentity)`.

## Self-Check: PASSED

- Files: both migrations, `calibration-repository.ts`, `Calibrator.ts`, `CalibratorEvent.ts`, `calibration-db.ts` and the three integration suites exist.
- Commits: 86c50c2, 4f1c89c, 89b1bc1 and fa28c75 are ancestors of HEAD.
