---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-08-29T15:20:08.498Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 02 | unrun-verify | tests/integration/replay.test.ts |  | Plan 02-04 replay verification depends on previewReplay and queueReplay owned by Plan 02-07 | open |  | 2026-08-29T15:20:08.498Z |  |

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
  }
]
````
