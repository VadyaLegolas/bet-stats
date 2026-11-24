---
phase: 13-clv-price-diary
verified: 2026-11-24T20:45:00Z
status: passed
score: 3/3 must-haves verified
covered_files:
  - ".planning/phases/13-clv-price-diary/13-01-PLAN.md"
  - ".planning/phases/13-clv-price-diary/13-01-SUMMARY.md"
  - ".planning/phases/13-clv-price-diary/13-02-PLAN.md"
  - ".planning/phases/13-clv-price-diary/13-02-SUMMARY.md"
  - ".planning/phases/13-clv-price-diary/13-03-PLAN.md"
  - ".planning/phases/13-clv-price-diary/13-03-SUMMARY.md"
  - ".planning/phases/13-clv-price-diary/13-04-PLAN.md"
  - ".planning/phases/13-clv-price-diary/13-04-SUMMARY.md"
  - "apps/api/src/modules/closing-odds/closing-odds.controller.ts"
  - "apps/api/src/modules/closing-odds/closing-odds.module.ts"
  - "apps/api/src/modules/closing-odds/closing-odds.service.ts"
  - "apps/api/src/modules/evaluation/evaluation.service.ts"
  - "apps/web/app/methodology/page.tsx"
  - "apps/web/app/scorecards/scorecard-dashboard.tsx"
  - "docs/closing-odds-operator.md"
  - "packages/database/src/closing-odds-repository.ts"
  - "packages/database/src/evaluation/no-vig-clv-reader.ts"
  - "packages/domain/src/evaluation/closing-odds.ts"
  - "packages/domain/src/evaluation/no-vig-clv.ts"
  - "packages/domain/src/methodology/model-card.ts"
  - "scripts/closing-odds.mjs"
covered_digest: "v4:sha256:912a8ab46544872b0018cc5cffcdd493e28b21fc050f5d6930c1e1b70d1edee2"
behavior_unverified: 0
overrides_applied: 0
---

# Phase 13: CLV Price Diary Verification Report

**Phase Goal:** A user can judge closing-line value on every value candidate from a recorded pre-kickoff closing price, with explicit unavailable states when no comparable price exists, and CLV remains strictly evaluation-only.
**Verified:** 2026-11-24
**Status:** passed
**Re-verification:** No, initial verification (plan 13-01 was re-executed from scratch after reverting d864203 via 917f2d6; the verified code is the re-executed version, commits 990b659..627f6c1)

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An operator can record a closing-odds observation per fixture, market and selection with a UTC observed-at timestamp validated as pre-kickoff and pre-settlement | VERIFIED | `POST internal/closing-odds` (`closing-odds.controller.ts`, class-level `OperatorGuard`, 404 fail-closed) -> `ClosingOddsService.parseClosingOddsBody` (strict keys, `observationKind`/`oddsFormat` never accepted from client) -> `createPrismaClosingOddsRepository.recordClosingOddsBook` (one transaction, advisory lock per fixture, kickoff and settlement-receipt presence read from the DB, server clock) -> pure `validateClosingOddsBook` (canonical UTC instant, `observedAt < kickoff`, not in future, write not after kickoff, fixture not settled, complete market set, odds > 1). Also CLI `scripts/closing-odds.mjs record` (`--help` runs). Re-run by me: `tests/integration/closing-odds-repository.test.ts` and `closing-odds-api.test.ts` on real PostgreSQL containers: pass (73 tests across the 4 integration files). |
| 2 | A user sees CLV per value candidate from de-vigged forecast-time and closing prices on the same line; missing closing price renders as explicit unavailable and is never synthesized | VERIFIED | `calculateNoVigClv` (`no-vig-clv.ts`): `clv = pClose_fair / pCandidate_fair - 1`, both sides multiplicatively de-vigged through the frozen `normalizeOddsBook` over the full same-market, same-source set; 8 typed `UNAVAILABLE` reasons, no interpolation. `readNoVigClvForCandidates` reads the candidate's `ManualOddsSnapshot` and the latest pre-kickoff same-source closing set, constant 2 queries per page (no N+1; asserted by integration test). Wired: `evaluation.service.ts#listValueCandidates` adds `clvNoVig` to each row; the web proxy `internal-api/scorecards/route.ts` streams the upstream body unchanged; `scorecard-dashboard.tsx` renders `NoVigClvCell` (percent, policy version, closing time, source) or Russian reason from `NO_VIG_CLV_REASON_COPY` (typed `Record` so a new reason is a compile error). Frozen `clv` field (`odds-ratio-clv-v1`) retained with unchanged meaning. |
| 3 | Closing observations are append-only, and no test or integration path lets CLV influence value ranking, scanner ordering or journal decisions | VERIFIED | Append-only: repository only does `findMany`/`create` on `closingOddsObservation`; DB trigger `guard_closing_odds_observation` untouched (`git diff ae1754b HEAD -- packages/database/prisma` empty, no migrations); replay is idempotent (deterministic id), changed odds on same key -> `CLOSING_OBSERVATION_CONFLICT` (409), correction = new later `observedAt`. Evaluation-only: `tests/unit/clv-evaluation-only.test.ts` is a symbol-level import-graph guard (follows barrels/re-exports, pessimistic for namespace/dynamic/require, path-mask roots `domain/value`, `api/modules/value`, `api/modules/odds`, any `scanner|journal` path, plus direct `closingOddsObservation` table access) with red-proof synthetic graphs and a non-vacuity check on the real workspace; passes. Runtime invariance: `tests/integration/clv-ranking-invariance.test.ts` (candidates and order byte-identical with and without observations) passes. `grep` confirms no CLV/closing module name appears in `apps/api/src/modules/value`, `modules/odds`, `packages/domain/src/value`. |

**Score:** 3/3 truths verified (0 behavior-unverified; the behavior-dependent truths 1 and 3 each have a passing behavioral test that I re-ran)

### PLAN must-haves cross-check

- 13-01: validator rejects incomplete/duplicate/non-canonical/late input with typed codes, deterministic id independent of odds, `no-vig-clv-v1` formula, typed unavailable set, frozen `clv.ts` untouched: VERIFIED (code read; `closing-odds.test.ts`, `no-vig-clv.test.ts` pass; `git diff` on `clv.ts`, `odds/*` empty).
- 13-02: operator route, atomic one-market set, server-side time/settlement decision, idempotent replay / 409 conflict, no writes to `ManualOdds*`/`ValueReceipt`/`ValueSettlement`/`ForecastSnapshot` (integration test asserts it): VERIFIED by re-run.
- 13-03: reader per candidate with typed unavailable, both policy versions in the response, import-graph and ranking-invariance tests: VERIFIED by re-run.
- 13-04: scorecard registry column, Russian reason per code, methodology section `#clv`, model card `model-card-v1.3.0` with history and test, operator doc, browser form consciously deferred (documented decision), e2e spec present: VERIFIED (unit/web tests re-run; e2e see caveat).

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/domain/src/evaluation/closing-odds.ts` | VERIFIED | substantive, exported from domain index, used by repository |
| `packages/domain/src/evaluation/no-vig-clv.ts` | VERIFIED | substantive, exported, used by reader and model card |
| `packages/database/src/closing-odds-repository.ts` | VERIFIED | exported from database index, used by API service |
| `packages/database/src/evaluation/no-vig-clv-reader.ts` | VERIFIED | exported, used by `evaluation.service.ts` |
| `apps/api/src/modules/closing-odds/*` | VERIFIED | `ClosingOddsModule` imported in `app.module.ts` |
| `scripts/closing-odds.mjs` | VERIFIED | CLI present, `--help` prints Russian usage |
| `docs/closing-odds-operator.md` | VERIFIED | present (90 lines) |
| `tests/unit/{closing-odds,no-vig-clv,clv-evaluation-only}.test.ts`, `tests/integration/{closing-odds-repository,closing-odds-api,no-vig-clv-reader,clv-ranking-invariance}.test.ts`, `tests/e2e/clv.spec.ts` | VERIFIED | all present; all except e2e re-run by me |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `no-vig-clv.ts` | `odds/normalize.ts` | `normalizeOddsBook` for both sets | WIRED |
| `closing-odds.ts` | `odds/contract.ts` | `MARKET_SELECTIONS`, `canonicalizeDecimalOdds`, `CANONICAL_UTC_INSTANT_PATTERN` | WIRED |
| `closing-odds.controller.ts` | `operator.guard.ts` | `@UseGuards(OperatorGuard)` on class | WIRED |
| `closing-odds-repository.ts` | `closing-odds.ts` | `validateClosingOddsBook` decides admission | WIRED |
| `evaluation.service.ts` | `no-vig-clv-reader.ts` | `readNoVigClvForCandidates` -> `clvNoVig` per row | WIRED |
| `no-vig-clv-reader.ts` | `no-vig-clv.ts` | `calculateNoVigClv` | WIRED |
| `scorecard-dashboard.tsx` | evaluation API | `clvNoVig` through `page.tsx` -> API -> unchanged proxy | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| `NoVigClvCell` | `clvNoVig` | `readNoVigClvForCandidates` <- `manualOddsSnapshot` + `closingOddsObservation` Prisma queries | Yes | FLOWING |
| Closing write | rows | operator request -> validated -> `closingOddsObservation.create` | Yes | FLOWING |

### Behavioral Spot-Checks (run by verifier)

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| New unit files + scorecard/model-card tests | `vitest run --project unit` on 5 files | 5 files, 123 tests passed | PASS |
| Full unit project | `vitest run --project unit` | 80 files, 1199 tests passed | PASS |
| Web workspace tests | `pnpm --filter @bet-stats/web test` | 209 passed | PASS |
| Import-graph guard (real workspace) | part of `clv-evaluation-only.test.ts` | passed (incl. non-vacuity) | PASS |
| Docker-backed integration (4 CLV files) | `vitest run --project integration` on repository, api, reader, invariance | 4 files, 73 tests passed (own PostgreSQL containers, ~57 s) | PASS |
| Typecheck | `pnpm typecheck` | 7/7 tasks successful (turbo cache hit, inputs unchanged) | PASS |
| Lint | `pnpm lint` | 7/7 successful (turbo cache hit) | PASS |
| CLI | `node scripts/closing-odds.mjs --help` | usage printed | PASS |

### Probe Execution

No phase-declared probe scripts (`scripts/*/tests/probe-*.sh`); step skipped.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| CLV-01 | 13-01, 13-02, 13-04 | Operator records closing-odds observation with UTC pre-kickoff / pre-settlement validation | SATISFIED | Truth 1 |
| CLV-02 | 13-01, 13-03, 13-04 | CLV per candidate from de-vigged prices on the same line; missing close is explicit unavailable | SATISFIED | Truth 2 |
| CLV-03 | 13-02, 13-03, 13-04 | Append-only observations; CLV never influences ranking/scanner/journal | SATISFIED | Truth 3 |

No orphaned requirements: REQUIREMENTS.md maps only CLV-01..03 to Phase 13 and all three are claimed by plans.

### Anti-Patterns Found

None. `TBD|FIXME|XXX|TODO|HACK` grep over all 13 product files modified by the phase returned no matches. No stub returns; `clv.ts`, `odds/*` and the Prisma schema/migrations are unchanged since the phase plan commit (`ae1754b`).

### Caveats (not gaps)

- **Playwright e2e not re-run by the verifier.** `tests/e2e/clv.spec.ts` (and `methodology.spec.ts`) were taken from the 13-04 SUMMARY claim (2 passed desktop+mobile, methodology 4 passed on the isolated 3240/3241 stack). I read the spec: it asserts 404 without operator key, 201 then 200 replay, 3 rows in DB, 422 for a late write, independently computed expected CLV in the row, policy label/source/closing time, the explicit unavailable copy for a match with no closing, no raw reason codes, no certainty vocabulary, and the persistent disclaimers. The same behaviors are independently covered by the integration and unit tests I did re-run.
- Per D-02/D-03, retrospective/late closing entries are rejected rather than stored with a tag; this satisfies the ROADMAP note "tagged and excluded" in the stronger form (never stored). A labelled retrospective import is listed as deferred in CONTEXT, not required here.
- Browser entry form intentionally deferred (signed proxy forwards no JSON body); input via API and CLI documented in `docs/closing-odds-operator.md`. Matches roadmap criterion 1 (operator can record), which does not require a browser form.

### Human Verification Required

None.

### Gaps Summary

No gaps. All three roadmap success criteria and all CLV-01..03 requirements are backed by code that exists, is wired end to end, and is exercised by tests that I re-ran (unit, web, Docker-backed integration). Phase goal achieved.

---

_Verified: 2026-11-24_
_Verifier: Claude (gsd-verifier)_
