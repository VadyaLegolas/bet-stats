---
schema_version: 1
open_count: 4
waived_count: 0
fixed_count: 0
total_count: 4
last_updated: 2026-08-30T06:20:26.411Z
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
  }
]
````
