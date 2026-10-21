---
phase: 02-historical-evidence-pipeline
plan: 27
status: complete
completed: 2026-09-05
requirements: [PIPE-03, PIPE-04, PIPE-05, PIPE-06]
commits: [e7a31e1, 80c1fe0, eb1c3ef, b152782, 4fb8618]
---

# Plan 02-27 Summary

Replay approvals now fingerprint the stable configured policy identity (`identity-v2`) while every unit still evaluates current quota and circuit observations before provider I/O. Existing legacy SHA-256 approvals remain read-only compatible after exact legacy validation; malformed and unknown formats fail closed.

The production boundary proves three sequential units complete under both new and legacy approvals while reservations grow, and proves a newly OPEN circuit stops the affected unit. Fixture scope validation errors are classified as unrecoverable so BullMQ does not repeat invalid provider work.

## Verification

- `provider-resilience.test.ts` plus `replay-boundary.test.ts`: 61/61 passed with real isolated PostgreSQL and Redis.
- Domain, data-sync worker, and API typechecks passed.
- Tests ran on Node 25.2.1 and emitted the repository engine warning (`>=24 <25`); the assertions and compilation completed successfully.

## Deviations

- Added narrow `UnrecoverableError` handling for `FIXTURE_SCOPE_MISMATCH` and `INVALID_FIXTURE_SCOPE` after the full suite exposed repeated invalid I/O. The change is covered by RED/GREEN integration evidence.
