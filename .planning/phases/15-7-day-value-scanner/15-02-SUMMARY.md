---
phase: 15-7-day-value-scanner
plan: 02
subsystem: value-scanner
tags: [scanner, unit-tests, freshness, ui-spec, vitest]
requires:
  - phase: 15-7-day-value-scanner
    provides: "Plan 15-01 scanner domain module, loadScanner/getScanner, ScannerController"
provides:
  - "Unit specification of freshness boundaries, constants and D-09 order lists"
  - "Unit specification of loadScanner, getScanner and ScannerController with an in-memory repository"
  - "15-UI-SPEC.md reconciled with the shipped contract via six listed amendments"
affects: [15-03, 15-04, 15-05]
tech-stack:
  added: []
  patterns:
    - "In-memory ScannerRepository recording its arguments; no database in unit tests"
    - "Controller constructed directly with a stub service; guard covered by the integration access test"
key-files:
  created:
    - tests/unit/scanner-domain.test.ts
    - tests/unit/scanner-service.test.ts
  modified:
    - .planning/phases/15-7-day-value-scanner/15-UI-SPEC.md
key-decisions:
  - "No production code changed: every new case passed against the Plan 15-01 implementation."
  - "UI-SPEC amendments are documentation only and carry the marker pending user confirmation; frontmatter stays status: approved."
patterns-established:
  - "Unit tests import Nest exceptions and Logger from apps/api/node_modules so instanceof and the Logger spy hit the same module instance as the service."
requirements-completed: [SCAN-01, SCAN-02]
status: complete
duration: ~25 min
completed: 2026-11-25
commits: 3
plan_head_before: 7caeb33b3cd9d4e49dbf852966a46f24757463dc
plan_head_after: 0200ef203c5876f11b4990d1ee3bfe6e77e96cb3
actuals:
  tokens: 9000
  tasks: 3
  commits: 3
---

# Phase 15 Plan 02: Scanner unit specifications and UI-SPEC reconciliation Summary

**Freshness boundaries (21599 FRESH, 21600/86400 AGING, 86401 STALE, negative FRESH), one-instant ages, verbatim stored strings, repository order kept, typed 503 mapping without message leakage and query rejection are locked by 34 fast unit tests; 15-UI-SPEC.md now matches the shipped names through six listed, user-confirmation-pending amendments.**

## What was built

- `tests/unit/scanner-domain.test.ts` (11 tests): classifier boundaries including fractional ages, the policy-derived boundaries, frozen `SCANNER_FRESHNESS_V1`, window 7 and cap 200, D-09 market and selection order (frozen, no duplicates, market order differs from the registry order, mutation rejected).
- `tests/unit/scanner-service.test.ts` (23 tests): exact window and cap call, one `generatedAt` instant for all ages, boundary labels through the row mapping, `oddsCapturedAt` never affecting freshness, verbatim strings (`0.0432109876543210987654321`, `1.2e-7`, `0.1000`, 40-digit decimal, trailing zeros) and null edge staying null, no reordering (edge descending and ascending give the same item order), EMPTY / AVAILABLE / truncated / all-policy-mismatch states, exact top-level and item keys with no receipt-internal keys, empty-row failure as `SCANNER_READ_FAILED`, `DATABASE_UNAVAILABLE`, no leakage of a repository error (table name, connection string) into the exception response, the operator log carrying the internal reason, controller delegation and `INVALID_SCANNER_QUERY` for any query key.
- `15-UI-SPEC.md`: six scoped edits plus a final section `Amendments (Phase 15 planning, pending user confirmation)` with a table of original line numbers, old text, new text and the marker «ожидает подтверждения пользователя» on each row.

## Task commits

1. Task 1: `919ad55` test(15-02): scanner domain constants, order lists and freshness boundaries
2. Task 2: `cdefd50` test(15-02): loadScanner, getScanner and controller unit specifications
3. Task 3: `0200ef2` docs(15-02): reconcile 15-UI-SPEC with the shipped scanner contract

## Verification

- `pnpm exec vitest run --project unit tests/unit/scanner-domain.test.ts tests/unit/scanner-service.test.ts tests/unit/clv-evaluation-only.test.ts tests/unit/responsible-copy.test.ts`: 4 files, 59 tests passed (11 + 23 + 13 + 12).
- `grep -c "Amendments (Phase 15 planning, pending user confirmation)"` gives 1; `grep -c valuePolicyVersion` gives 2; the pending marker appears on exactly 6 rows; frontmatter still `status: approved`.
- Not run: the PostgreSQL integration suite (no files it covers changed; it ran green in Plan 15-01), eslint (the repository root has no ESLint config for `tests/`), typecheck of the test files (no tsconfig covers `tests/`; vitest transpiles them).

## Deviations from Plan

None - plan executed exactly as written. No production file needed a fix.

## Notes

- The operator log line of `getScanner` includes the raw error message. That is intended by the plan (typed codes for clients, reason for the operator), but a driver error that embeds a connection string would reach the log; the unit test documents that the client response never carries it. Not changed here.
- In the first Task 2 run one assertion of my own test failed because the log line is JSON, which escapes the quotes of the table name in a raw substring check; the test now parses the log entry. No production behaviour changed.

## Known Stubs

None in this plan's files (the tracer page stub belongs to Plan 15-01 and is replaced by Plan 15-03).

## Threat Flags

None. T-15-08 (message leakage), T-15-09 (documented amendments), T-15-10 (single clock) are mitigated by the tests and the Amendments section; no package or lockfile changed.

## Self-Check: PASSED

- Files exist: `tests/unit/scanner-domain.test.ts`, `tests/unit/scanner-service.test.ts`, `15-UI-SPEC.md`, this SUMMARY.
- Commits `919ad55`, `cdefd50`, `0200ef2` are ancestors of HEAD.
