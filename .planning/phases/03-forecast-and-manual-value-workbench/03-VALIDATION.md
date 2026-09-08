---
phase: 03
slug: forecast-and-manual-value-workbench
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-05
validated: 2026-09-08
---

# Phase 3 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (unit/integration), Playwright Chromium (production E2E) |
| **Config files** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `corepack pnpm test` |
| **PostgreSQL command** | `node node_modules/vitest/vitest.mjs run tests/integration/phase-03-security.test.ts --project integration` |
| **Production E2E command** | `corepack pnpm exec playwright test tests/e2e/forecast-workbench.spec.ts --project=chromium` |
| **Estimated runtime** | Unit ~5s; PostgreSQL/E2E environment-dependent |

## Sampling Rate

- **After every task commit:** run the focused command named in the owning PLAN.
- **After every plan wave:** run the affected Vitest project(s).
- **Before `$gsd-verify-work`:** run unit, migrated PostgreSQL security, and production Chromium gates.
- **Max fast-feedback latency:** approximately 5 seconds for the unit suite.

## Requirement Verification Map

| Requirement | Plans | Observable behavior | Automated evidence | Status |
|-------------|-------|---------------------|--------------------|--------|
| PRED-01 | 01,02,06,07,11,12 | Normalized 1X2 probabilities satisfy the invariant and are discoverable by exact issued ID. | `forecast-value-tracer.test.ts`, `forecast.test.ts`, `forecast-api.test.ts`, `forecast-workbench.spec.ts` | ✅ green |
| PRED-02 | 01,02,06,07,12 | O/U 2.5 and BTTS derive from the same 0:0–7:7 matrix with tail disclosure. | `forecast-value-tracer.test.ts`, `forecast.test.ts`, `forecast-workbench.spec.ts` | ✅ green |
| PRED-03 | 01,02,06,07,11,12 | Fair decimal odds correspond to supported probabilities; unavailable cases never become infinity. | `forecast-value-tracer.test.ts`, `forecast.test.ts`, `forecast-workbench.spec.ts` | ✅ green |
| PRED-04 | 03,04,07,08,11,12 | Forecasts are append-only, provenance-complete exact-cutoff snapshots with linked revisions. | `forecast-snapshots.test.ts`, `forecast-api.test.ts`, `phase-03-security.test.ts` | ✅ green |
| PRED-05 | 01,02,04,06,07,11,12 | Probability and confidence remain separate; all five confidence components and limitations are inspectable. | `forecast.test.ts`, `forecast-api.test.ts`, `forecast-workbench.spec.ts` | ✅ green |
| PRED-06 | 03,04,06,07,08,11,12 | INITIAL/PRE_MATCH are deterministic; LINEUP_CONFIRMED requires exact official provenance; concurrent revisions serialize. | `forecast-publication.test.ts`, `forecast-snapshots.test.ts`, `phase-03-security.test.ts` | ✅ green |
| ODDS-01 | 01,02,05,06,07,09,12 | Only complete bounded canonical positive decimal books are accepted; invalid fields fail before mutation. | `forecast-value-tracer.test.ts`, `manual-odds-api.test.ts`, `phase-03-security.test.ts`, `forecast-workbench.spec.ts` | ✅ green |
| ODDS-02 | 03,05,06,07,09,12 | Odds are immutable, fixture-scoped, chronologically valid, provenance-complete, and replacement-linked. | `manual-odds.test.ts`, `manual-odds-api.test.ts`, `phase-03-security.test.ts`, `forecast-workbench.spec.ts` | ✅ green |
| ODDS-03 | 01,02,05,06,07,12 | Complete books expose implied probability, multiplicative no-vig probability, and overround. | `forecast-value-tracer.test.ts`, `manual-odds-api.test.ts`, `forecast-workbench.spec.ts` | ✅ green |
| VALUE-01 | 01,03,05,06,07,10,12 | Edge and EV use one exact forecast/odds/market/selection tuple. | `value.test.ts`, `value-api.test.ts`, `value-receipt.test.ts`, `forecast-workbench.spec.ts` | ✅ green |
| VALUE-02 | 01,02,05,06,07,10,12 | A candidate appears only when every versioned quality, confidence, edge, and EV gate passes. | `value.test.ts`, `value-api.test.ts`, `forecast-workbench.spec.ts` | ✅ green |
| VALUE-03 | 01,02,05,06,07,10,12 | Failed thresholds/data quality yield explicit NO_VALUE or INSUFFICIENT_EVIDENCE with ordered reasons. | `forecast-value-tracer.test.ts`, `value.test.ts`, `value-api.test.ts`, `forecast-workbench.spec.ts` | ✅ green |
| VALUE-04 | 01,03,05,06,07,10,12 | Selection-aware receipts expose exact provenance/calculation inputs; server, DOM, clipboard and download agree. | `value-receipt.test.ts`, `value-api.test.ts`, `phase-03-security.test.ts`, `forecast-workbench.spec.ts` | ✅ green |

Test paths above are under `tests/unit/`, `tests/integration/`, and `tests/e2e/` respectively.

## Review Counterexample Matrix

| Finding | Behavioral witness | Status |
|---------|--------------------|--------|
| CR-01 | HOME and DRAW persist as distinct exact-pair receipts. | ✅ green |
| CR-02 | Source provenance and replacement lineage alter immutable odds identity. | ✅ green |
| CR-03 | Each official lineup observation alters forecast identity and receipt. | ✅ green |
| CR-04 | Non-round issued cutoffs are discovered without synthesized timestamps. | ✅ green |
| CR-05 | Cross-fixture odds retrieval returns the non-disclosing not-found result. | ✅ green |
| CR-06 | Hostile decimals fail before repository access. | ✅ green |
| WR-01 | Concurrent distinct forecasts receive linked revisions; identical retries converge. | ✅ green |
| WR-02 | Canonical UTC and kickoff/server-skew boundaries are enforced before append. | ✅ green |
| WR-03 | PostgreSQL rejects receipt fields inconsistent with immutable sources. | ✅ green |

All nine witnesses are named cases in `tests/integration/phase-03-security.test.ts`.

## Wave 0 Requirements

Existing infrastructure and completed TDD plans cover all Phase 3 requirements. No missing test stubs remain.

## Manual-Only Verifications

All Phase 3 behaviors have automated verification. No manual-only requirement remains.

## Validation Audit 2026-09-08

| Metric | Count |
|--------|-------|
| Phase requirements audited | 13 |
| Missing behavioral tests | 0 |
| Partial requirements | 0 |
| Automated requirements | 13 |
| Escalated | 0 |

Execution evidence:

- Fresh Nyquist run: `corepack pnpm test` — 15 files, 152 tests passed.
- UAT runtime gate: `phase-03-security.test.ts` — 13/13 passed against migrated disposable PostgreSQL after commits `8803809` and `ba6a66d`.
- UAT production gate: `forecast-workbench.spec.ts --project=chromium` — 3/3 passed against production Nest/Next/PostgreSQL with the current E2E fixes.
- UAT summary: 4/4 passed, 0 issues, 0 pending, 0 skipped.

## Validation Sign-Off

- [x] All tasks have an automated verify command or completed Wave 0 dependency.
- [x] Sampling continuity has no three consecutive tasks without automated verification.
- [x] Every Phase 3 requirement has a real behavioral test capable of failing.
- [x] Persistence requirements are witnessed against PostgreSQL rather than mocked semantics.
- [x] User-visible receipt parity is witnessed through production Chromium.
- [x] No watch-mode flags are used.
- [x] `nyquist_compliant: true` is set in frontmatter.

**Approval:** approved 2026-09-08
