---
phase: 08
review: 08-REVIEW.md
titles: json
findings:
  - id: WR-01
    severity: warning
    disposition: open
    title: "Post-rm inspect failure is recorded as REMOVED — fail-open against the stated G-08-5 invariant"
  - id: WR-02
    severity: warning
    disposition: open
    title: "Cleanup verdict keys on the mutable container NAME although the immutable container ID is already captured — residual rename window still yields a false REMOVED"
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
    disposition: open
    title: "Unguarded exec calls in the finally block can skip `record()` entirely — no receipt at all"
  - id: IN-03
    severity: info
    disposition: open
    title: "Unit test asserts gateway source text instead of behavior"
open: 7
total: 7
recorded: 2026-11-01T00:50:00.384Z
---

# Phase 08: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-01 | warning | open | - |
| WR-02 | warning | open | - |
| WR-03 | warning | open | - |
| WR-04 | warning | open | - |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
