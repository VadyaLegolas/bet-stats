---
status: awaiting_human_verify
trigger: "Diagnose and fix the confirmed Phase 3 cross-phase regression: the Phase 1 fixture-discovery E2E cannot start Nest API without DATABASE_URL because Phase 3 services create Prisma clients during construction."
created: 2026-09-06T00:00:00+02:00
updated: 2026-09-06T01:20:00+02:00
---

## Current Focus

hypothesis: Commit 7d22722 removed the unrelated standalone "Additional data / Not available" element that accidentally satisfied the Phase 1 exact-text locator, exposing that DataStateNotice renders the real missing source-update value only as part of the parent text "Source updated: Not available".
test: Completed focused/full Playwright, adjacent unit test, web/API typechecks, and revert/reapply checks.
expecting: All automated checks remain green and the user confirms the fixture workflow in the real environment.
next_action: Await human confirmation that the fixture-discovery workflow is fixed end-to-end.
bug_class: bohrbug
reasoning_checkpoint:
  hypothesis: "The Phase 1 browser assertion was coupled to an unrelated standalone placeholder; commit 7d22722 correctly removed that placeholder, revealing that the intended missing source-update value has no independently targetable element."
  confirming_evidence:
    - "The Playwright accessibility snapshot contains 'Source updated: Not available' but no element whose exact text is 'Not available'."
    - "Git history shows the Phase 1 page originally had an unrelated <dd>Not available</dd>; commit 7d22722 replaced it with historical-evidence links while leaving DataStateNotice unchanged."
  falsification_test: "If wrapping only the null source-update value does not satisfy the focused exact-text browser assertion, then the missing semantic target is not the cause."
  fix_rationale: "A span around the fallback gives the real unavailable provenance value a targetable semantic boundary without changing its wording, inventing data, or undoing Phase 3 functionality."
  blind_spots: "The focused detail test must still be followed by the complete fixture-discovery spec and web typecheck."
  candidate_causes:
    - "code: DataStateNotice concatenates the fallback into a labeled parent instead of exposing the value as its own element"
    - "test/history: the exact-text test previously passed against an unrelated placeholder removed by commit 7d22722"
  and_gate: "yes — the failure surfaced only when the unrelated matching element was removed and the intended fallback remained structurally inseparable from its label."

## Symptoms

expected: The API starts without DATABASE_URL in deterministic provider mode so Phase 1 fixture discovery remains usable; Phase 3 database-backed endpoints fail explicitly only when invoked.
actual: Nest API startup fails because ForecastsService constructs a Prisma client when DATABASE_URL is absent; OddsService and ValueService have the same eager initialization pattern.
errors: Missing DATABASE_URL during API startup from createPrismaClient().
reproduction: Run the Chromium Playwright fixture-discovery spec with DATABASE_URL absent; its web server cannot start the Nest API.
started: Introduced by Phase 3 database-backed services.

## Eliminated

## Evidence

- timestamp: 2026-09-06T00:00:00+02:00
  checked: User-supplied reproduction summary
  found: The failure is deterministic and occurs during Nest service construction before Phase 3 endpoints are invoked.
  implication: This is a Bohrbug in initialization/config handling and is suitable for a focused TDD regression.
- timestamp: 2026-09-06T00:10:00+02:00
  checked: ForecastsService, OddsService, ValueService, FixturesService, EvidenceService, and ReconciliationService implementations
  found: The three Phase 3 services call createPrismaClient() during construction; working cross-phase services conditionally create a client and defer missing-database failure or limited behavior until method invocation.
  implication: The code/config interaction is localized and the task-specified call-time fail-closed contract can be tested without a running database.
- timestamp: 2026-09-06T00:20:00+02:00
  checked: Focused Vitest regression with DATABASE_URL removed
  found: RED reproduced exactly; ForecastsService construction throws "DATABASE_URL is required to create the database client" at forecasts.service.ts:156.
  implication: The test directly confirms the eager construction mechanism and provides a specified call-time error oracle.
- timestamp: 2026-09-06T00:30:00+02:00
  checked: Focused test, three adjacent integration suites, API typecheck, and revert/reapply guardrail
  found: Focused test passed; 4 files/13 tests passed; API typecheck exited 0; removing the production fix made the focused test fail at eager construction and reapplying it made the test pass.
  implication: The change specifically fixes the startup mechanism without breaking directly adjacent Phase 3 contracts.
- timestamp: 2026-09-06T00:40:00+02:00
  checked: Phase 1 fixture-discovery Playwright spec on Chromium
  found: API and web servers started without DATABASE_URL and 7 of 8 tests passed; the remaining UI-only assertion could not find exact text "Not available" on fixture detail.
  implication: The original startup blocker is removed, but full-suite acceptance is blocked by a separate fixture-detail presentation mismatch outside the changed Phase 3 services.
- timestamp: 2026-09-06T01:00:00+02:00
  checked: Playwright accessibility snapshot, Phase 1 source/history, current fixture detail, and commit 7d22722
  found: The visible fallback is "Source updated: Not available" in one paragraph. The exact locator previously matched a separate <dd>Not available</dd> placeholder, which 7d22722 replaced with valid historical-evidence links.
  implication: The current assertion expresses the correct unavailable-value contract but had a false-positive target; the minimal production fix is to expose the actual fallback value as its own element.
- timestamp: 2026-09-06T01:20:00+02:00
  checked: Focused fixture-detail Playwright test, full fixture-discovery Playwright spec, data-state unit tests, web typecheck, and revert/reapply guardrail
  found: Focused browser test passed; full spec passed 8/8; data-state unit suite passed 15/15; web typecheck exited 0; removing the semantic wrapper reproduced the exact locator failure and reapplying it restored GREEN.
  implication: The semantic wrapper is both necessary and sufficient for the intended missing-provenance assertion, with no regression to Phase 3 or adjacent data-state behavior.

## Resolution

root_cause: "Two contributing regressions were confirmed: Phase 3 services eagerly created Prisma clients during Nest construction when deterministic mode intentionally omitted DATABASE_URL; after that was fixed, commit 7d22722 removed an unrelated standalone 'Not available' placeholder that had masked the Phase 1 browser test's inability to target the actual missing source-update fallback embedded in a labeled paragraph."
fix: "Conditionally create nullable Prisma clients in ForecastsService, OddsService, and ValueService with call-time DATABASE_UNAVAILABLE guards; render the real missing source-update fallback in DataStateNotice as its own semantic span."
verification:
  target_test: { result: pass }
  mutation_check: { result: skipped, reason_if_skipped: "No Stryker configuration or dependency is present", mutant_killed: false }
  no_op_deletion: { result: pass, deletion_justified_by_rca: false }
  adjacent_tests: { result: pass, suites_run: ["phase-03-database-availability", "forecast-api", "manual-odds-api", "value-api", "apps/api typecheck"] }
  revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
  guardrail_verdict: accepted
  e2e: { result: pass, startup_fixed: true, passed: 8, failed: 0 }
  fixture_detail_target_test: { result: pass }
  fixture_detail_adjacent_tests: { result: pass, suites_run: ["data-state unit 15/15", "apps/web typecheck", "fixture-discovery Playwright 8/8"] }
  fixture_detail_revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
files_changed:
  - apps/api/src/modules/forecasts/forecasts.service.ts
  - apps/api/src/modules/odds/odds.service.ts
  - apps/api/src/modules/value/value.service.ts
  - tests/integration/phase-03-database-availability.test.ts
  - apps/web/components/data-state-notice.tsx
oracle_type: specified
