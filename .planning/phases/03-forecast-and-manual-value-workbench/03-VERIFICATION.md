---
phase: 03-forecast-and-manual-value-workbench
verified: 2026-09-08T06:04:12Z
status: gaps_found
score: 0/5 must-haves verified
behavior_unverified: 1
overrides_applied: 0
requirements:
  PRED-01: blocked
  PRED-02: blocked
  PRED-03: blocked
  PRED-04: blocked
  PRED-05: satisfied
  PRED-06: blocked
  ODDS-01: blocked
  ODDS-02: blocked
  ODDS-03: satisfied
  VALUE-01: blocked
  VALUE-02: blocked
  VALUE-03: blocked
  VALUE-04: blocked
gaps:
  - truth: "A user can discover and inspect issued normalized forecasts and their evidence."
    status: failed
    reason: "The fixture page invents three cutoff timestamps instead of discovering issued snapshots, so valid INITIAL and LINEUP_CONFIRMED forecasts at their actual cutoffs are invisible."
    artifacts:
      - path: "apps/web/app/fixtures/[fixtureId]/page.tsx"
        issue: "Queries only kickoff-minus-24h, minus-6h, and minus-1h exact cutoffs."
      - path: "apps/api/src/modules/forecasts/forecasts.service.ts"
        issue: "Read API requires exact fixture/kind/cutoff and exposes no issued-snapshot list."
    missing:
      - "Add fixture-scoped issued forecast discovery by exact snapshot identity and preserve explicit selection."
  - truth: "Forecast and manual-odds receipts preserve every immutable provenance input and create distinct revisions when those inputs change."
    status: failed
    reason: "Forecast identity omits the official lineup observation; odds identity omits source label and replacement lineage; concurrent distinct forecast revisions can also allocate the same revision."
    artifacts:
      - path: "apps/api/src/modules/forecasts/forecasts.service.ts"
        issue: "snapshotId/inputHash do not bind officialLineupObservationId; revision allocation is a read-then-insert race."
      - path: "apps/api/src/modules/odds/odds.service.ts"
        issue: "inputHash excludes sourceLabel and replacementOfOddsSnapshotId."
      - path: "packages/database/prisma/schema.prisma"
        issue: "Forecast and odds content uniqueness repeats the incomplete identities."
    missing:
      - "Bind official lineup observation identity to forecast content identity and receipt."
      - "Hash and compare all immutable manual-odds fields, including source and replacement lineage."
      - "Serialize or retry fixture/kind revision allocation."
  - truth: "The exact forecast and odds snapshots produce the requested selection's reproducible edge, EV, gate outcome, and receipt."
    status: failed
    reason: "Value identity is only forecastSnapshotId plus oddsSnapshotId. After one selection is evaluated, another selection from the same book returns the first selection's receipt. The database guard also permits internally false receipt fields."
    artifacts:
      - path: "apps/api/src/modules/value/value.service.ts"
        issue: "Lookup, hash ID, and collision recovery omit market/selection."
      - path: "packages/database/prisma/schema.prisma"
        issue: "@@unique([forecastSnapshotId, oddsSnapshotId]) collapses all selections."
      - path: "packages/database/prisma/migrations/20260905_phase03_forecast_value_snapshots/migration.sql"
        issue: "Pair trigger checks fixture/market only, not ISSUED lifecycle, selection membership, or derived values."
    missing:
      - "Include market and selection in value identity, or persist one receipt containing every selection consistently."
      - "Strengthen database enforcement for lifecycle, selection membership, and derived receipt values."
  - truth: "Public odds and snapshot resources reject hostile input and enforce their fixture-scoped identity."
    status: failed
    reason: "Decimal strings are unbounded before Decimal construction, capturedAt accepts non-canonical Date.parse input without a documented fixture window, and the odds GET route ignores its fixtureId parameter."
    artifacts:
      - path: "packages/domain/src/odds/contract.ts"
        issue: "No bounded decimal grammar/length/scale; permissive Date.parse timestamp."
      - path: "apps/api/src/modules/odds/odds.controller.ts"
        issue: "GET passes only oddsSnapshotId to OddsService.get."
    missing:
      - "Bound and canonicalize decimal/timestamp inputs before expensive parsing."
      - "Resolve fixture chronology and enforce documented capture bounds."
      - "Query odds by both fixtureId and oddsSnapshotId and test cross-fixture denial."
behavior_unverified_items:
  - truth: "A user can distinguish event probability from confidence and inspect all confidence components."
    test: "Open an issued forecast in the production-backed browser flow and inspect probability, completeness, lineup, freshness, source reliability, and model stability displays."
    expected: "Probability and confidence remain distinct, all five components and limitations are visible, and no certainty language is used."
    why_human: "The components are present in source, but the focused verifier run did not start application services and the existing browser test does not assert every named confidence component."
---

# Phase 3: Forecast and Manual Value Workbench Verification Report

**Phase Goal:** As a football analytics user, I want to compare a frozen forecast with manual odds, so that I can see a reproducible value or abstention result.
**Verified:** 2026-09-08T06:04:12Z
**Status:** gaps_found
**Re-verification:** No prior Phase 3 verification report existed; this is the initial goal verification after the MVP user-story correction in `bdd8e69`.

## User Flow Coverage

| Step | Expected | Actual code evidence | Status |
| --- | --- | --- | --- |
| Open a fixture forecast | Discover an issued frozen forecast at its real cutoff | `page.tsx` fabricates three cutoff instants and the API only supports exact kind+cutoff lookup | ✗ FAILED |
| Inspect forecast and confidence | See normalized markets, fair odds, evidence, and distinct confidence components | Domain calculation and workbench rendering are substantive; focused unit tests pass, but all named UI components lack a current behavioral witness | ⚠ PRESENT_BEHAVIOR_UNVERIFIED |
| Enter manual odds | Submit a complete positive book and correct field errors | Complete-book and normalization logic works, but unbounded decimals and incomplete immutable identity violate the public/audit contract | ✗ FAILED |
| Compare exact snapshots | Receive the selected event's edge, EV, and gated outcome | Receipt identity collapses all selections in one forecast/odds pair | ✗ FAILED |
| Outcome | See a reproducible value or abstention result | A second selection can return the first selection's values and receipt | ✗ FAILED |

## Goal Achievement

### Observable Truths

| # | Roadmap truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | User can inspect normalized 1X2, O/U 2.5 and BTTS probabilities, fair odds, and evidence | ✗ FAILED | The model is implemented and tested, but the page cannot discover valid snapshots except at invented exact cutoffs. |
| 2 | User distinguishes probability from confidence and inspects all components | ⚠ PRESENT_BEHAVIOR_UNVERIFIED | Separate DTO/render fields exist; no current named behavioral test asserts all five displayed components. |
| 3 | Forecast kinds are immutable, cutoff/provenance tied, and LINEUP_CONFIRMED is official-only | ✗ FAILED | Official-only DB guard exists, but official observation is absent from forecast identity; corrected observations cannot create a distinct revision. |
| 4 | Complete validated odds are immutable, provenance-visible, and no-vig normalized | ✗ FAILED | Validation/normalization work, but identity drops source and replacement lineage and accepts unbounded decimal strings. |
| 5 | Exact snapshot pair produces edge/EV and correct candidate/abstention gates | ✗ FAILED | Value identity omits selection; subsequent selections return the wrong immutable result. |

**Score:** 0/5 truths verified (1 present, behavior-unverified). Present-but-behavior-unverified truths are excluded from the verified score.

### Required Artifacts and Data Flow

| Artifact | Levels 1-2 | Wiring/data flow | Status |
| --- | --- | --- | --- |
| `packages/domain/src/forecast/model.ts` | Exists, substantive | Evidence DTO to coherent matrix/markets; exercised by unit tests | ✓ VERIFIED |
| `packages/domain/src/odds/normalize.ts` | Exists, substantive | Complete book to implied/no-vig probabilities | ✓ VERIFIED |
| `packages/domain/src/value/decision.ts` | Exists, substantive | Exact DTO inputs to edge/EV/gates | ✓ VERIFIED at pure-function level |
| `packages/database/prisma/schema.prisma` + Phase 3 migration | Exists, substantive | Wired to Prisma repositories | ✗ INCOMPLETE identities/guard |
| Forecast/odds/value Nest services | Exist, substantive | Wired through guarded controllers to PostgreSQL | ✗ WIRED WITH BLOCKING correctness defects |
| Fixture workbench and proxies | Exist, substantive | Next to Nest routes; server results render | ✗ HOLLOW discovery for non-invented forecast cutoffs |
| Phase 3 unit/integration/E2E tests | Exist, substantive | Active Vitest/Playwright config | ⚠ Missing adversarial cases corresponding to all nine review findings |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| Phase 2 evidence | Forecast receipt | `generateForecast` and `createForecast` | ⚠ PARTIAL | Evidence flows, but official lineup provenance does not participate in immutable identity. |
| Issued forecasts | Fixture workbench | Exact kind+cutoff GET | ✗ NOT WIRED FOR DISCOVERY | Page guesses cutoffs instead of listing issued identities. |
| Manual odds form | Immutable odds row | Proxy → controller → service → Prisma | ⚠ PARTIAL | Real persistence, but source/lineage are absent from identity and hostile numerics are unbounded. |
| Forecast + odds + selection | Value receipt | `compareValue` → `decideValue` → Prisma | ✗ INCORRECT | Selection is used for calculation but omitted from durable identity. |
| Value receipt | DOM/copy/download | API receipt as single source | ✓ WIRED | Existing E2E source compares canonical JSON, but correctness depends on the broken receipt identity upstream. |

### Code Review Claim Validation

| Finding | Current verdict | Independent evidence |
| --- | --- | --- |
| CR-01 selection-collapsing value identity | CONFIRMED BLOCKER | Service lookup/hash/collision and Prisma uniqueness use only two snapshot IDs. |
| CR-02 odds source/replacement omitted from identity | CONFIRMED BLOCKER | `inputHash` JSON excludes both fields; DB content key uses that hash. |
| CR-03 official lineup observation omitted from forecast identity | CONFIRMED BLOCKER | Observation is persisted but absent from `snapshotId`, model input, and content key. |
| CR-04 invented UI cutoffs | CONFIRMED BLOCKER | Page hardcodes kickoff offsets 24/6/1 and service GET requires exact cutoff. |
| CR-05 fixture ignored by odds GET | CONFIRMED BLOCKER | Controller receives only `oddsSnapshotId`; service queries by ID. |
| CR-06 unbounded decimal input | CONFIRMED BLOCKER | Arbitrary strings reach `new Decimal()` before any grammar/size bound. |
| WR-01 concurrent revision allocation | CONFIRMED WARNING | Transaction reads latest then inserts `latest+1`; no lock/serializable retry for distinct content. |
| WR-02 non-canonical/unbounded odds time | CONFIRMED WARNING | Contract uses `Date.parse`; service does not resolve fixture chronology. |
| WR-03 incomplete database pair trigger | CONFIRMED WARNING | Trigger checks fixture/market only. |

Commits `223bebb` and `37db10e` were inspected directly. They respectively defer database-unavailable errors until endpoint calls and render a null source-updated value in an explicit element. Both are valid regression fixes, but neither touches any of the nine findings above.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Phase 3 calculation, contracts, proxies, drafts, and responsible copy | `node node_modules/vitest/vitest.mjs run` on seven focused Phase 3 unit files | 7 files, 59 tests passed | ✓ PASS |
| Same focused run inside sandbox | Same command | Vite startup `spawn EPERM` | INFO: sandbox limitation; rerun outside sandbox passed |
| Production browser chain | Not run: requires application services and PostgreSQL | Existing test source covers a single HOME receipt path but not the review counterexamples | ? SKIP / human after fixes |

No Phase 3 probe scripts are declared.

### Requirements Coverage

| Requirement | Status | Evidence / blocker |
| --- | --- | --- |
| PRED-01, PRED-02, PRED-03 | ✗ BLOCKED | Calculations pass, but issued forecast discovery is false for arbitrary real cutoffs. |
| PRED-04 | ✗ BLOCKED | Official lineup provenance is not part of immutable content identity. |
| PRED-05 | ✓ SATISFIED in source | Probability/confidence separation and components exist; final visual behavior remains human-unverified. |
| PRED-06 | ✗ BLOCKED | Official guard exists, but corrected official observations collapse to the same identity. |
| ODDS-01 | ✗ BLOCKED | Complete-book validation exists; hostile unbounded decimal strings violate the public parser contract. |
| ODDS-02 | ✗ BLOCKED | Source and replacement lineage are stored but omitted from identity/deduplication. |
| ODDS-03 | ✓ SATISFIED | Multiplicative normalization and invariant tests pass. |
| VALUE-01, VALUE-02, VALUE-03, VALUE-04 | ✗ BLOCKED | Selection-specific calculations collapse into one pair receipt and can return the wrong result. |

All 13 Phase 3 requirements are claimed by the plans; none are orphaned. REQUIREMENTS.md checkmarks are planning metadata, not verification evidence.

### Anti-Patterns Found

No unreferenced `TBD`, `FIXME`, or `XXX` debt markers were found in the Phase 3 implementation surfaces. The blocking issues are substantive identity, discovery, validation, and database-enforcement defects rather than placeholder code.

### Human Verification Required

1. **Confidence and evidence presentation**

   **Test:** After the blockers are fixed, open a real issued forecast and inspect every confidence and evidence section at desktop and 360px/200% zoom.
   **Expected:** Probability remains distinct from confidence; completeness, lineup, freshness, source reliability, model stability, limitations, and probabilistic disclosure are all readable.
   **Why human:** Visual hierarchy and comprehensibility require judgment; the focused automated run did not launch the live stack.

2. **Complete reproducible user flow**

   **Test:** Discover a forecast at a non-round INITIAL cutoff, submit and replace a full book, then evaluate two different selections from the same exact snapshot pair and export both receipts.
   **Expected:** Both forecasts/books are discoverable, immutable provenance differs when inputs differ, and each selection has its own correct DOM/copy/download receipt.
   **Why human:** This is the MVP outcome flow; current blockers make it fail before visual acceptance is meaningful.

### Deferred Items

None of these gaps are deferred. Phases 4-6 consume trustworthy frozen receipts; their goals do not repair Phase 3 identity, discovery, parser, or resource-scoping defects.

### Gaps Summary

Phase 3 has substantial domain math, persistence, API, worker, and UI implementation, and the focused unit gate passes. The goal is nevertheless not achieved: a user cannot reliably discover real issued forecasts, immutable forecast/odds identities omit required provenance, and the value receipt identity can return another selection's result. Six security/correctness blockers and three robustness warnings from the independent code review remain observable in current source. Gap closure must precede MVP UAT or Phase 4.

---

_Verified: 2026-09-08T06:04:12Z_
_Verifier: the agent (gsd-verifier)_
