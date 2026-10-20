---
phase: 03-forecast-and-manual-value-workbench
reviewed: 2026-09-06T00:00:00Z
depth: standard
files_reviewed: 55
files_reviewed_list:
  - apps/api/src/app.module.ts
  - apps/api/src/modules/forecasts/forecasts.controller.ts
  - apps/api/src/modules/forecasts/forecasts.module.ts
  - apps/api/src/modules/forecasts/forecasts.service.ts
  - apps/api/src/modules/odds/odds.controller.ts
  - apps/api/src/modules/odds/odds.module.ts
  - apps/api/src/modules/odds/odds.service.ts
  - apps/api/src/modules/reconciliation/operator.guard.ts
  - apps/api/src/modules/value/value.controller.ts
  - apps/api/src/modules/value/value.module.ts
  - apps/api/src/modules/value/value.service.ts
  - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
  - apps/web/app/fixtures/[fixtureId]/page.tsx
  - apps/web/app/internal-api/fixtures/[fixtureId]/forecasts/route.ts
  - apps/web/app/internal-api/fixtures/[fixtureId]/odds/route.ts
  - apps/web/app/internal-api/fixtures/[fixtureId]/value/route.ts
  - apps/web/app/internal-api/value/[receiptId]/route.ts
  - apps/web/app/internal/pipeline/replay/page.tsx
  - apps/web/app/teams/[teamId]/evidence/page.tsx
  - packages/database/prisma/migrations/20260905_phase03_forecast_value_snapshots/migration.sql
  - packages/database/prisma/schema.prisma
  - packages/domain/package.json
  - packages/domain/src/forecast/confidence.ts
  - packages/domain/src/forecast/config.ts
  - packages/domain/src/forecast/contract.ts
  - packages/domain/src/forecast/model.ts
  - packages/domain/src/index.ts
  - packages/domain/src/odds/contract.ts
  - packages/domain/src/odds/draft.ts
  - packages/domain/src/odds/normalize.ts
  - packages/domain/src/value/contract.ts
  - packages/domain/src/value/decision.ts
  - playwright.config.ts
  - tests/e2e/forecast-workbench.spec.ts
  - tests/integration/forecast-api.test.ts
  - tests/integration/forecast-publication.test.ts
  - tests/integration/forecast-snapshots.test.ts
  - tests/integration/manual-odds-api.test.ts
  - tests/integration/manual-odds.test.ts
  - tests/integration/migration-empty.test.ts
  - tests/integration/phase-03-security.test.ts
  - tests/integration/replay-boundary.test.ts
  - tests/integration/value-api.test.ts
  - tests/integration/value-receipt.test.ts
  - tests/unit/forecast-value-tracer.test.ts
  - tests/unit/forecast.test.ts
  - tests/unit/internal-api-route.test.ts
  - tests/unit/odds-draft-ui.test.tsx
  - tests/unit/odds-draft.test.ts
  - tests/unit/responsible-copy.test.ts
  - tests/unit/value.test.ts
  - vitest.config.ts
  - workers/data-sync/src/jobs/forecasts.ts
  - workers/data-sync/src/jobs/pipeline.ts
  - workers/data-sync/src/jobs/results.ts
findings:
  critical: 6
  warning: 3
  info: 0
  total: 9
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-09-06T00:00:00Z
**Depth:** standard
**Files Reviewed:** 55
**Status:** issues_found

## Summary

The Phase 3 source, configuration, migration, and reliability-relevant tests were reviewed against the explicit diff from `8f160f9`, all seven phase summaries, and the phase context/research constraints. Prisma-generated client output was excluded as generated code. The implementation has six shipping blockers concentrated in immutable identity, exact-pair retrieval, and snapshot discovery, plus three robustness gaps.

## Critical Issues

### CR-01: Value receipt identity collapses every selection in a book into one result

**File:** `apps/api/src/modules/value/value.service.ts:48-74`
**Issue:** Receipt lookup, deterministic ID generation, collision recovery, and the database unique key use only `(forecastSnapshotId, oddsSnapshotId)`, even though the command and persisted result are selection-specific. After evaluating `HOME`, a request for `DRAW` with the same snapshots returns the existing `HOME` receipt. The UI therefore displays an incorrect selection, probability, edge, EV, and outcome. The schema cements the same collision at `packages/database/prisma/schema.prisma:530` and migration line 97.
**Fix:** Include `market` and `selection` in the receipt identity everywhere: repository lookup, hash input, unique constraint, Prisma compound selector, collision recovery, and tests. Alternatively, make one receipt contain decisions for every selection and remove the singular selection contract consistently.

### CR-02: Manual-odds deduplication omits immutable source and replacement fields

**File:** `apps/api/src/modules/odds/odds.service.ts:54-86`
**Issue:** `inputHash` excludes `sourceLabel` and `replacementOfOddsSnapshotId`, although D-10 defines the source label and replacement lineage as immutable snapshot content. Reusing an `oddsSnapshotId` with changed source/lineage is accepted as an identical retry and returns the old row; distinct submissions with the same fixture/market/capture/odds also collide under the database content key. This silently loses audit data and can attach a receipt to a different user-intended source or correction chain.
**Fix:** Canonically hash every immutable field, including normalized source label and replacement ID. Make the database content identity match that hash semantics, and on ID collision compare the full canonical payload rather than a partial hash.

### CR-03: Confirmed-lineup forecast identity does not bind the official observation

**File:** `apps/api/src/modules/forecasts/forecasts.service.ts:63-93`
**Issue:** A `LINEUP_CONFIRMED` snapshot records `officialLineupObservationId`, but neither `snapshotId` nor `inputHash` includes that ID (the model input includes only `lineupAvailable: true`). Two different official observations at the same cutoff/evidence/config resolve to the same ID and are treated as the same immutable forecast. A corrected official lineup therefore cannot create the required new revision and the returned receipt may claim an observation different from the submitted one.
**Fix:** Include `officialLineupObservationId` in the canonical model input, snapshot ID/content key, and receipt. Add a test where two official observations at one cutoff produce distinct linked revisions.

### CR-04: Fixture page asks for invented cutoffs and cannot discover valid INITIAL or LINEUP_CONFIRMED snapshots

**File:** `apps/web/app/fixtures/[fixtureId]/page.tsx:19-20`
**Issue:** The page queries INITIAL at kickoff minus 24 hours and LINEUP_CONFIRMED at kickoff minus one hour. The scheduling contract defines INITIAL as the first eligible evidence cutoff and LINEUP_CONFIRMED as the official observation's actual confirmation time. Since the GET endpoint requires exact kind+cutoff, legitimate snapshots at any other instant are invisible; users receive a false “No issued forecast snapshot” state even though snapshots exist.
**Fix:** Add a fixture forecast-list endpoint (or query by kind without fabricating a cutoff) that returns issued snapshot metadata, then let the user select exact IDs. Preserve the exact selected ID after discovery and test non-round INITIAL/lineup timestamps.

### CR-05: Odds retrieval route does not enforce the fixture in its URL

**File:** `apps/api/src/modules/odds/odds.controller.ts:17-19`
**Issue:** `GET /fixtures/:fixtureId/odds/:oddsSnapshotId` ignores `fixtureId`; `OddsService.get` fetches solely by snapshot ID. A caller can place fixture A in the URL and retrieve a snapshot belonging to fixture B. This violates the authoritative fixture/snapshot relationship check required by the phase security boundary and makes the resource path misleading.
**Fix:** Pass both parameters to the service and query by `{ id, fixtureId }` (or fetch then reject mismatches with the project's non-disclosing not-found response). Add an integration test for a cross-fixture ID.

### CR-06: Decimal odds accept unbounded attacker-controlled numeric strings

**File:** `packages/domain/src/odds/contract.ts:28-41`
**Issue:** The public parser sends arbitrary-length strings directly to `decimal.js` and imposes no digit, length, scale, or exponent grammar limit. This contradicts the phase threat model's explicit max-length/scale requirement and permits CPU/memory exhaustion before the database's `VARCHAR(128)` boundary is reached. Source labels and IDs are also unbounded, but Decimal construction is the directly exploitable expensive operation.
**Fix:** Before constructing `Decimal`, enforce a small canonical decimal grammar and maximum length/scale (aligned with persistence), then reject exponents, signs, excess precision, and oversized strings with `INVALID_DECIMAL_ODDS`. Mirror the limit in client validation and adversarial tests.

## Warnings

### WR-01: Concurrent distinct forecast revisions can fail with a uniqueness error

**File:** `apps/api/src/modules/forecasts/forecasts.service.ts:121-144`
**Issue:** Two concurrent publications with different content identities for the same fixture/kind can both read the same latest revision and attempt the same next revision. Only an identical-content collision is recovered; the loser of `@@unique([fixtureId, kind, revision])` is rethrown as a server error. This is a correctness/robustness gap in revision assignment.
**Fix:** Serialize revision allocation with a transaction-scoped advisory lock or serializable retry loop keyed by fixture+kind, then re-read the predecessor and allocate the next revision.

### WR-02: Odds capture timestamps are neither canonical nor bounded by fixture time

**File:** `packages/domain/src/odds/contract.ts:29`
**Issue:** `Date.parse` accepts non-canonical and implementation-dependent date strings, which are persisted verbatim inside the immutable receipt. The service also never checks the referenced fixture or whether `capturedAt` is plausible for the pre-match workbench, so malformed chronology can enter later CLV/settlement analysis while the foreign key error for a missing fixture surfaces only at persistence.
**Fix:** Require the same exact UTC-instant representation used by forecast contracts, resolve the fixture before append, and explicitly enforce/document the permitted capture window.

### WR-03: Database value-pair trigger validates only fixture and market, not the actual decision

**File:** `packages/database/prisma/migrations/20260905_phase03_forecast_value_snapshots/migration.sql:157-169`
**Issue:** The trigger described as enforcing exact pairing does not require an ISSUED forecast, verify that `selection` exists in both snapshots, or verify stored probability/odds/edge/EV against immutable source receipts. Direct or future repository writes can therefore create an immutable but internally false value receipt that passes the database guard.
**Fix:** Strengthen the trigger (or a single audited database write function) to require lifecycle state and selection membership, and validate the immutable receipt fields against the selected forecast market and odds selection. Add negative integration cases for BUILDING/FAILED forecasts and selection mismatch.

---

_Reviewed: 2026-09-06T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
