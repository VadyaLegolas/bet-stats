---
phase: 08
review: 08-REVIEW.md
titles: json
findings:
  - id: WR-05
    severity: warning
    disposition: open
    title: "Post-rm inspect with an undefined exit code and no spawnError still records REMOVED — the last fall-through without absence evidence (residual of prior WR-01)"
  - id: WR-02
    severity: warning
    disposition: open
    title: "Cleanup verdict keys on the mutable container NAME although the immutable container ID is already captured (carried from review at b626569)"
  - id: IN-04
    severity: info
    disposition: open
    title: "`isDockerUnreachableError` is a phrase blacklist — the comment claims \"reached the daemon\", but any unlisted daemon-fault wording counts as absence evidence"
  - id: IN-05
    severity: info
    disposition: open
    title: "Two of three classifier branches and the \"No such object\" absence variant are unpinned by tests"
  - id: IN-06
    severity: info
    disposition: open
    title: "`record()` guarantee covers cleanup-exec throws only — a throwing injected logger still escapes the finally block"
  - id: WR-01
    severity: warning
    disposition: fixed
    title: "Post-rm inspect failure is recorded as REMOVED — fail-open against the stated G-08-5 invariant"
  - id: WR-03
    severity: warning
    disposition: open
    title: "Status/Stop never load `.env`, so a non-default GATEWAY_PORT diverges between Start and Status/Stop"
  - id: WR-04
    severity: warning
    disposition: open
    title: "Operator gateway binds 0.0.0.0 — cleartext Basic credentials and signed operations triggers reachable from the LAN"
  - id: IN-01
    severity: info
    disposition: open
    title: "Gateway readiness probe conflates \"gateway down\" with \"upstream down\""
  - id: IN-02
    severity: info
    disposition: fixed
    title: "Unguarded exec calls in the finally block can skip `record()` entirely — no receipt at all"
  - id: IN-03
    severity: info
    disposition: open
    title: "Unit test asserts gateway source text instead of behavior"
open: 9
total: 11
recorded: 2026-11-02T14:45:41.630Z
---

# Phase 08: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-05 | warning | open | - |
| WR-02 | warning | open | - |
| IN-04 | info | open | - |
| IN-05 | info | open | - |
| IN-06 | info | open | - |
| WR-01 | warning | fixed | Closed by plan 08-06 Task 1 — commits 86f801c (RED cases G/H), 8eb37e3 (GREEN fail-closed verdict); unit 32/32 |
| WR-03 | warning | open | - (not in the current review) |
| WR-04 | warning | open | - (not in the current review) |
| IN-01 | info | open | - (not in the current review) |
| IN-02 | info | fixed | Closed by plan 08-06 Task 2 — commits 5085314 (RED case I), 8d2eab1 (GREEN safeCleanupRun guard); `record()` always lands |
| IN-03 | info | open | - (not in the current review) |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
