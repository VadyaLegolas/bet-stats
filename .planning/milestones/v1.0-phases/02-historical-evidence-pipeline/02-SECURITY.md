---
phase: 02
slug: historical-evidence-pipeline
status: verified
verdict: SECURED
threats_total: 88
threats_closed: 74
threats_accepted: 14
threats_open: 0
asvs_level: 1
blocking_threshold: high
verified: 2026-09-05
---

# Phase 02 — Security

Phase 02 threat mitigations were audited against the implementation, migrations, integration tests, final clean code review, and passed phase verification. All 58 critical/high mitigated threats and 16 medium mitigated threats are closed. No unregistered threat flags were found.

## Verified boundaries

| Boundary | Verified control |
|---|---|
| replay approval → worker admission | Allowlisted stable `identity-v2` projection; exact legacy verification; malformed and unknown formats fail closed; every unit evaluates the full fresh policy snapshot. |
| BullMQ delivery → execution ledger | PostgreSQL row lock, database clock, random owner token, bounded expiry/deadline, atomic reclaim and durable attempt allocation. |
| stale worker → external effects | Token, expiry and deadline fence admission, renewal, failure and publication. Facts, provenance and success commit in one owner-validated transaction. |
| migration → existing RUNNING work | Exclusive migration boundary, expired random-token backfill and populated PostgreSQL 18 upgrade witness preserve attempt history for reclaim. |
| test process → child worker | Allowlisted test environment, exact PID ownership, forced process-tree termination on Windows or SIGKILL elsewhere, awaited exit and scoped cleanup. |

## Accepted risks

| Threat ID | Severity | Disposition | Rationale |
|---|---|---|---|
| T-02-10 | low | accept | Receipt exposure is intentionally bounded to the approved auditable operator response described by the plan. |
| T-02-SC (02-16 through 02-28) | low | accept | Thirteen repeated supply-chain entries add no package: they reuse previously approved pinned dependencies and introduce no direct unapproved client import. |

## Audit evidence

- Stable/volatile policy classification and three-unit replay: `provider-resilience.test.ts`, `replay-boundary.test.ts`.
- Lease, stale-owner fencing, terminal exhaustion and real hard crash: `pipeline-jobs.test.ts`, `replay-crash-recovery.test.ts`.
- Empty and populated migrations: `migration-empty.test.ts`, `replay-lease-upgrade.test.ts`.
- Dependency legitimacy: approved `bullmq@6.3.2` and `ioredis@5.11.1`; production contains no direct `ioredis` import.
- Final code review status: clean. Phase verification: passed 5/5, PIPE-01 through PIPE-08 satisfied.

## Sign-off

- [x] All critical/high mitigations verified.
- [x] All accepted risks documented.
- [x] No open threats at the configured high blocking threshold.
- [x] `threats_open: 0` and verdict `SECURED` recorded.
