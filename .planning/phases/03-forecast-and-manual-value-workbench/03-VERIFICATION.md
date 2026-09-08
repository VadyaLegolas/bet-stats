---
phase: 03-forecast-and-manual-value-workbench
verified: 2026-09-08T11:19:29Z
status: human_needed
score: 1/5 must-haves verified
behavior_unverified: 4
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 0/5
  gaps_closed:
    - "Issued forecasts are discovered by exact immutable ID rather than invented cutoffs."
    - "Forecast and odds identities include official-lineup, source, and replacement provenance."
    - "Value receipts are selection-aware and database guards validate source-derived values."
    - "Odds parsing, chronology, and fixture-scoped retrieval are hardened."
  gaps_remaining: []
  regressions: []
behavior_unverified_items:
  - truth: "Probability/confidence separation and all five confidence components are user-visible."
    test: "Run the production-backed Chromium workbench flow at desktop and 360px/200% zoom."
    expected: "Probability, confidence components, limitations, and responsible-use copy are distinct and visible."
    why_human: "The production browser test could not run without PostgreSQL."
  - truth: "Corrected and concurrent forecast publications preserve immutable linked revisions."
    test: "Run the CR-03 and WR-01 cases in phase-03-security.test.ts against migrated PostgreSQL."
    expected: "Corrected observations create distinct revisions, identical retries converge, and concurrent distinct writes receive consecutive revisions."
    why_human: "This database concurrency invariant cannot be proven from source; DATABASE_URL is absent and Docker Engine unavailable."
  - truth: "Manual odds are durably immutable, provenance-complete, chronologically bounded, and fixture-scoped."
    test: "Run CR-02, CR-05, CR-06, and WR-02 against migrated PostgreSQL."
    expected: "All provenance, hostile-input, chronology, and cross-fixture cases pass."
    why_human: "Available API tests use repository seams; the durable path was not executable."
  - truth: "Each exact forecast/odds/selection tuple produces a source-verifiable receipt."
    test: "Run CR-01/WR-03 PostgreSQL cases and the two-selection production Chromium flow."
    expected: "HOME and DRAW remain distinct, tampered fields are rejected, and server/DOM/clipboard/download JSON agree."
    why_human: "The decisive trigger and end-to-end path require PostgreSQL."
human_verification:
  - test: "Apply all migrations to disposable PostgreSQL and run tests/integration/phase-03-security.test.ts."
    expected: "All named CR-01..CR-06 and WR-01..WR-03 cases pass."
    why_human: "No DATABASE_URL; Docker Engine unavailable."
  - test: "Run tests/e2e/forecast-workbench.spec.ts with production Nest/Next/PostgreSQL services."
    expected: "All three Chromium tests pass, including two-selection receipt parity and confidence/responsive checks."
    why_human: "Production E2E cannot run in the current environment."
requirements:
  PRED-01: verified
  PRED-02: verified
  PRED-03: verified
  PRED-04: human_needed
  PRED-05: human_needed
  PRED-06: human_needed
  ODDS-01: human_needed
  ODDS-02: human_needed
  ODDS-03: verified
  VALUE-01: human_needed
  VALUE-02: human_needed
  VALUE-03: human_needed
  VALUE-04: human_needed
---

# Phase 3: Forecast and Manual Value Workbench Verification Report

**Phase Goal:** As a football analytics user, I want to compare a frozen forecast with manual odds, so that I can see a reproducible value or abstention result.
**Verified:** 2026-09-08T11:19:29Z
**Status:** human_needed
**Re-verification:** Yes — after gap plans 03-08 through 03-12.

## User Flow Coverage

| Step | Expected | Evidence | Status |
| --- | --- | --- | --- |
| Discover forecast | Issued receipts at arbitrary cutoffs are listed and selected by exact ID | Fixture/state DB predicate, stable ordering, no synthesized cutoff; focused API/UI tests pass | ✓ VERIFIED |
| Inspect forecast | Coherent markets, fair odds, evidence and confidence | Domain tests pass; production visual assertion exists but was not run | ⚠ PRESENT_BEHAVIOR_UNVERIFIED |
| Enter/replace odds | Complete canonical book with immutable provenance | Bounded parser and API tests pass; PostgreSQL path not run | ⚠ PRESENT_BEHAVIOR_UNVERIFIED |
| Compare snapshots | Selection-specific edge/EV/gates and receipt | Selection is in hash/lookup/unique key; DB trigger/E2E not run | ⚠ PRESENT_BEHAVIOR_UNVERIFIED |
| Outcome | Reproducible value/no-value/insufficient-evidence result | Pure logic passes; production two-selection flow not run | ⚠ PRESENT_BEHAVIOR_UNVERIFIED |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Inspect normalized 1X2, O/U 2.5, BTTS, fair odds, and evidence | ✓ VERIFIED | Unit suite 152/152 and focused API/contract suite 29/29 pass; exact issued-list wiring exists. |
| 2 | Distinguish probability from confidence and inspect all components | ⚠ PRESENT_BEHAVIOR_UNVERIFIED | Contract/render fields exist; production Chromium not run. |
| 3 | Immutable, provenance-tied forecast kinds and official-only lineup snapshots | ⚠ PRESENT_BEHAVIOR_UNVERIFIED | Official observation hashing and advisory-lock publication exist; PostgreSQL invariant tests not run. |
| 4 | Validated immutable odds with provenance and no-vig normalization | ⚠ PRESENT_BEHAVIOR_UNVERIFIED | Parser, chronology, full identity and fixture scope exist; durable DB path not run. |
| 5 | Exact pair produces correct edge/EV and candidate/abstention | ⚠ PRESENT_BEHAVIOR_UNVERIFIED | Selection-aware identity and source-derived trigger checks exist; DB/browser proof not run. |

**Score:** 1/5 truths verified (4 present and wired, behavior-unverified).

### Required Artifacts and Key Links

| Artifact/link | Status | Evidence |
| --- | --- | --- |
| Evidence → one 64-cell forecast matrix → all markets/fair odds | ✓ VERIFIED | Domain implementation and unit assertions pass. |
| Official lineup → forecast hash/receipt → linked revision | ⚠ WIRED | CR-03 static gap closed; WR-01 requires PostgreSQL. |
| Issued DB rows → fixture list → exact client selection | ✓ WIRED | CR-04 closed; no kickoff-offset synthesis remains. |
| Odds input → bounded parse → chronology → full identity → fixture-scoped row | ⚠ WIRED | CR-02/05/06 and WR-02 code exists; durable path unexecuted. |
| Forecast+odds+market+selection → decision → guarded receipt | ⚠ WIRED | CR-01/WR-03 static gaps closed; DB proof unavailable. |

### Review Finding Closure

| Finding | Code evidence | Runtime evidence |
| --- | --- | --- |
| CR-01 | Market+selection in lookup/hash/Prisma unique key | Named DB test not run |
| CR-02 | Source and replacement lineage in canonical odds identity | API seam passes; DB test not run |
| CR-03 | Official observation in forecast hash, ID, receipt and DB key | Focused publication passes; DB test not run |
| CR-04 | Issued-list API replaces invented cutoffs | Focused API/UI tests pass |
| CR-05 | Fixture ID reaches compound odds lookup | Focused API test passes; DB case not run |
| CR-06 | Bounded grammar precedes Decimal construction | Unit/API cases pass |
| WR-01 | Transaction advisory lock and protected predecessor read | DB concurrency case not run |
| WR-02 | Canonical UTC and explicit kickoff/clock-skew bounds | Unit/API cases pass; DB case not run |
| WR-03 | Trigger checks lifecycle, selection and derived fields | Migration inspected; DB negative case not run |

### Behavioral Spot-Checks

| Check | Result | Status |
| --- | --- | --- |
| `corepack pnpm test` | 15 files, 152 tests passed | ✓ PASS |
| Four focused forecast/odds/value API files | 4 files, 29 tests passed | ✓ PASS |
| PostgreSQL security matrix | Not run: no DATABASE_URL; Docker Engine unavailable | ? SKIP |
| Production Chromium workbench | Not run for the same PostgreSQL blocker | ? SKIP |

No Phase 3 probes are declared.

### Requirements Coverage

| Requirements | Status | Evidence |
| --- | --- | --- |
| PRED-01..03 | ✓ SATISFIED | Model invariants, fair odds and discovery pass available tests. |
| PRED-04, PRED-06 | ? NEEDS RUNTIME | Immutable/official/revision code exists; PostgreSQL proofs unavailable. |
| PRED-05 | ? NEEDS UAT | Separation/components exist; production visual assertion unavailable. |
| ODDS-01, ODDS-02 | ? NEEDS RUNTIME | Parser/provenance/scope exist; durable path unavailable. |
| ODDS-03 | ✓ SATISFIED | Multiplicative normalization passes unit tests. |
| VALUE-01..04 | ? NEEDS RUNTIME/UAT | Exact selection-aware logic exists; DB trigger and receipt parity unexecuted. |

All 13 Phase 3 requirements are claimed; none are orphaned.

### Test Quality and Anti-Patterns

No disabled requirement tests, circular expected-value generation, unreferenced `TBD`/`FIXME`/`XXX`, or rendering stubs were found. The PostgreSQL matrix contains 13 named value/behavioral cases and Playwright contains 3 active tests, but their existence is not counted as a pass.

### Decision Coverage

All 17 trackable CONTEXT.md decisions are honored by shipped artifacts (`check.decision-coverage-verify`: 17/17).

### Human Verification Required

1. Apply all migrations to disposable PostgreSQL and run `tests/integration/phase-03-security.test.ts`; all CR-01..06 and WR-01..03 cases must pass.
2. Run the production Nest/Next/PostgreSQL stack and `tests/e2e/forecast-workbench.spec.ts`; all three Chromium tests must pass.

### Gaps Summary

All four previous implementation gaps are closed in current source and no new static blocker was found. The phase is not yet `passed`: four runtime-dependent truths lack PostgreSQL and production-browser evidence. Therefore the canonical status is `human_needed`, not `gaps_found`.

---

_Verified: 2026-09-08T11:19:29Z_
_Verifier: the agent (gsd-verifier)_
