---
status: testing
phase: 03-forecast-and-manual-value-workbench
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-04-SUMMARY.md, 03-05-SUMMARY.md, 03-06-SUMMARY.md, 03-07-SUMMARY.md, 03-08-SUMMARY.md, 03-09-SUMMARY.md, 03-10-SUMMARY.md, 03-11-SUMMARY.md, 03-12-SUMMARY.md]
started: 2026-09-08T11:32:01.192Z
updated: 2026-09-08T11:40:16.000Z
---

## Current Test

number: 4
name: Production workbench flow
expected: |
  A non-round issued forecast is discoverable; HOME and DRAW produce distinct receipts; DOM, clipboard, and downloaded JSON agree; confidence and limitations remain visible.
awaiting: environment verification

## Tests

### 1. Cold start and migrations
expected: A fresh PostgreSQL database accepts the complete migration chain and the application schema validates.
result: pass
source: automated

### 2. Forecast, odds, and value domain/API behavior
expected: Probability, normalization, immutable identity, selection-aware value decisions, and protected internal routes pass their automated contracts.
result: pass
source: automated

### 3. PostgreSQL Phase 3 security matrix
expected: All named CR-01..CR-06 and WR-01..WR-03 PostgreSQL witnesses pass, including concurrent linked revisions and source-verifiable receipts.
result: pass
source: automated
reported: "After fixing advisory-lock execution and value-receipt guard JSON paths, the complete disposable-PostgreSQL run passed 13/13."

### 4. Production workbench flow
expected: A non-round issued forecast is discoverable; HOME and DRAW produce distinct receipts; DOM, clipboard, and downloaded JSON agree; confidence and limitations remain visible.
result: [pending]

## Summary

total: 4
passed: 3
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

None.
