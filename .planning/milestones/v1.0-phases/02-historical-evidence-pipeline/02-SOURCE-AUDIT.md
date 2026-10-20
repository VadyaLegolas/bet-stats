# Phase 2 Multi-Source Coverage Audit

| SOURCE | ID | Feature / requirement | Plan | Status | Notes |
|---|---|---|---|---|---|
| GOAL | — | Time-correct team evidence from resilient quota-aware replayable jobs | 02-05 through 02-10 | COVERED | Provider call through UI/replay vertical path. |
| REQ | PIPE-01 | Idempotent retryable fixture/result/standings jobs | 02-05, 02-07 | COVERED | Existing fixture job is explicitly registered as critical BullMQ work. |
| REQ | PIPE-02 | Raw provenance and capture timestamps | 02-04 through 02-06 | COVERED | Immutable raw JSON, hash, size and observation ledger. |
| REQ | PIPE-03 | Atomic pre-call budget reservation | 02-01, 02-06 | COVERED | Edge probes, reset uncertainty and concurrency witnesses included. |
| REQ | PIPE-04 | Critical quota priority | 02-06, 02-07 | COVERED | Durable lane headroom plus physical lanes. |
| REQ | PIPE-05 | Retry/backoff/circuit/degraded state | 02-07, 02-09, 02-10 | COVERED | BullMQ retry only; Cockatiel circuit only. |
| REQ | PIPE-06 | Safe replay without duplicates | 02-04, 02-07, 02-09, 02-10 | COVERED | Dry-run and forced revision contract. |
| REQ | PIPE-07 | As-of history and 5/10 form | 02-02, 02-08 through 02-10 | COVERED | Pure fold, published API and UI. |
| REQ | PIPE-08 | Chronological feature set | 02-02, 02-08 through 02-10 | COVERED | Dual-time component receipts. |
| RESEARCH | — | PostgreSQL truth; Redis/BullMQ coordination | 02-04, 02-07 | COVERED | Database uniqueness remains correctness boundary. |
| RESEARCH | — | Package legitimacy gate | 02-06 | COVERED | Blocking human verification precedes install. |
| RESEARCH | — | Phase-local football-data.org endpoint coverage | 02-03 | COVERED | COVERAGE.md produced with later-phase opt-outs. |
| CONTEXT | D-01..D-06 | Chronological evidence contract | 02-04, 02-08 | COVERED | Each ID cited in task actions/truths. |
| CONTEXT | D-07..D-11 | Queue and quota priorities | 02-06, 02-07 | COVERED | Each ID cited in task actions/truths. |
| CONTEXT | D-12..D-16 | Failure recovery and replay | 02-04, 02-07, 02-09 | COVERED | Each ID cited in task actions/truths. |
| CONTEXT | D-17..D-20 | Team evidence experience | 02-01, 02-02, 02-08 through 02-10 | COVERED | Each ID cited in task actions/truths. |

Deferred Phase 3/4/5 features are excluded, not gaps. No source item is missing.
