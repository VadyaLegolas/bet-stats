---
schema_version: 1
open_count: 14
waived_count: 0
fixed_count: 0
total_count: 14
last_updated: 2026-09-08T07:18:47.219Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 02 | unrun-verify | tests/integration/replay.test.ts |  | Plan 02-04 replay verification depends on previewReplay and queueReplay owned by Plan 02-07 | open |  | 2026-08-29T15:20:08.498Z |  |
| 2 | 02 | unrun-verify | tests/integration/temporal-provenance.test.ts |  | Plan 02-06 temporal provenance verification could not start because Docker Desktop was not running | open |  | 2026-08-30T05:42:22.684Z |  |
| 3 | 2 | unrun-verify | tests/integration/temporal-provenance.test.ts |  | Docker-backed temporal provenance verification could not run because Docker Desktop was unavailable and startup was cancelled | open |  | 2026-08-30T06:10:47.471Z |  |
| 4 | 02 | deviation | tests/integration/phase-01-security.test.ts | 48 | Phase 1 deny-list was narrowed because Phase 2 intentionally added results and standings ingestion | open |  | 2026-08-30T06:20:26.411Z |  |
| 5 | 03 | deviation | .planning/STATE.md |  | state.advance-plan could not parse the initial Not started plan position; state was recorded directly | open |  | 2026-09-05T19:04:48.253Z |  |
| 6 | 03 | deviation | packages/domain/src/index.ts |  | Exposed existing odds and value contracts through the domain package barrel | open |  | 2026-09-06T03:05:12.209Z |  |
| 7 | 03 | deviation | packages/domain/src/value/decision.ts |  | Narrowed value calculation input to fields retained by immutable forecast snapshots | open |  | 2026-09-06T03:05:12.636Z |  |
| 8 | 03 | deviation | tests/integration/phase-03-security.test.ts |  | Phase 3 boundary verification required correctness and concurrency repairs | open |  | 2026-09-06T08:21:44.523Z |  |
| 9 | 03 | deviation | tests/e2e/forecast-workbench.spec.ts |  | Live workbench verification required exact-pair, responsive, and production-build repairs | open |  | 2026-09-06T08:21:44.998Z |  |
| 10 | 03 | deviation | tests/integration/replay-boundary.test.ts |  | Repository-wide verification required cross-phase harness isolation repairs | open |  | 2026-09-06T08:21:45.463Z |  |
| 11 | 03 | unrun-verify | tests/integration/forecast-snapshots.test.ts |  | PostgreSQL migration and concurrent forecast revision gate unrun because Docker daemon and DATABASE_URL were unavailable | open |  | 2026-09-08T07:06:41.815Z |  |
| 12 | 03 | unrun-verify | tests/integration/manual-odds.test.ts |  | PostgreSQL manual-odds verification was not run because DATABASE_URL is unset and Docker Engine is unavailable | open |  | 2026-09-08T07:07:43.665Z |  |
| 13 | 03 | deviation | apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx |  | Kept client odds validation self-contained so direct web tests do not consume stale package build output | open |  | 2026-09-08T07:07:44.088Z |  |
| 14 | 03 | unrun-verify | tests/integration/value-receipt.test.ts |  | PostgreSQL receipt lifecycle, membership, and derived-field integration suite was not run because DATABASE_URL was unavailable | open |  | 2026-09-08T07:18:47.219Z |  |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "02",
    "file": "tests/integration/replay.test.ts",
    "line": null,
    "description": "Plan 02-04 replay verification depends on previewReplay and queueReplay owned by Plan 02-07",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-29T15:20:08.498Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "unrun-verify",
    "phase": "02",
    "file": "tests/integration/temporal-provenance.test.ts",
    "line": null,
    "description": "Plan 02-06 temporal provenance verification could not start because Docker Desktop was not running",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-30T05:42:22.684Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "unrun-verify",
    "phase": "2",
    "file": "tests/integration/temporal-provenance.test.ts",
    "line": null,
    "description": "Docker-backed temporal provenance verification could not run because Docker Desktop was unavailable and startup was cancelled",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-30T06:10:47.471Z",
    "resolved_at": null
  },
  {
    "id": 4,
    "kind": "deviation",
    "phase": "02",
    "file": "tests/integration/phase-01-security.test.ts",
    "line": 48,
    "description": "Phase 1 deny-list was narrowed because Phase 2 intentionally added results and standings ingestion",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-30T06:20:26.411Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "deviation",
    "phase": "03",
    "file": ".planning/STATE.md",
    "line": null,
    "description": "state.advance-plan could not parse the initial Not started plan position; state was recorded directly",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T19:04:48.253Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "deviation",
    "phase": "03",
    "file": "packages/domain/src/index.ts",
    "line": null,
    "description": "Exposed existing odds and value contracts through the domain package barrel",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T03:05:12.209Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "deviation",
    "phase": "03",
    "file": "packages/domain/src/value/decision.ts",
    "line": null,
    "description": "Narrowed value calculation input to fields retained by immutable forecast snapshots",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T03:05:12.636Z",
    "resolved_at": null
  },
  {
    "id": 8,
    "kind": "deviation",
    "phase": "03",
    "file": "tests/integration/phase-03-security.test.ts",
    "line": null,
    "description": "Phase 3 boundary verification required correctness and concurrency repairs",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T08:21:44.523Z",
    "resolved_at": null
  },
  {
    "id": 9,
    "kind": "deviation",
    "phase": "03",
    "file": "tests/e2e/forecast-workbench.spec.ts",
    "line": null,
    "description": "Live workbench verification required exact-pair, responsive, and production-build repairs",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T08:21:44.998Z",
    "resolved_at": null
  },
  {
    "id": 10,
    "kind": "deviation",
    "phase": "03",
    "file": "tests/integration/replay-boundary.test.ts",
    "line": null,
    "description": "Repository-wide verification required cross-phase harness isolation repairs",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T08:21:45.463Z",
    "resolved_at": null
  },
  {
    "id": 11,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "tests/integration/forecast-snapshots.test.ts",
    "line": null,
    "description": "PostgreSQL migration and concurrent forecast revision gate unrun because Docker daemon and DATABASE_URL were unavailable",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-08T07:06:41.815Z",
    "resolved_at": null
  },
  {
    "id": 12,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "tests/integration/manual-odds.test.ts",
    "line": null,
    "description": "PostgreSQL manual-odds verification was not run because DATABASE_URL is unset and Docker Engine is unavailable",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-08T07:07:43.665Z",
    "resolved_at": null
  },
  {
    "id": 13,
    "kind": "deviation",
    "phase": "03",
    "file": "apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx",
    "line": null,
    "description": "Kept client odds validation self-contained so direct web tests do not consume stale package build output",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-08T07:07:44.088Z",
    "resolved_at": null
  },
  {
    "id": 14,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "tests/integration/value-receipt.test.ts",
    "line": null,
    "description": "PostgreSQL receipt lifecycle, membership, and derived-field integration suite was not run because DATABASE_URL was unavailable",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-08T07:18:47.219Z",
    "resolved_at": null
  }
]
````
