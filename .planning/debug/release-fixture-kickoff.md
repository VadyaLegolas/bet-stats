---
status: resolved
trigger: "The final Phase 06 release Playwright run had four manual-odds failures because the acceptance fixture kickoff was fixed to 2026-09-24 while the release run occurred on 2026-09-26."
created: 2026-09-26T20:40:00+02:00
updated: 2026-09-26T20:47:00+02:00
---

## Current Focus

hypothesis: Resolved — the release fixture retained a calendar date from the original test setup, so real browser `capturedAt` timestamps were after kickoff.
test: Ran the D-15 release journey and keyboard manual-odds workflow in desktop and mobile Chromium against the owned PostgreSQL/Redis stack.
expecting: All four project/test combinations pass while validating manual odds capture before kickoff and forecast evidence before kickoff.
next_action: None; focused verification passed. The full release gate was intentionally not rerun.
bug_class: Bohrbug

## Symptoms

expected: Release acceptance fixture represents an upcoming match, allowing a current manual-odds capture under the production D-09 chronology rule, followed by result and settlement events.
actual: Fixture kickoff remained 2026-09-24T15:00Z; on 2026-09-26 the API correctly rejected current odds as `ODDS_CAPTURE_NOT_BEFORE_KICKOFF`.
errors: "Odds were not saved. odds capture not before kickoff"
reproduction: "Run tests/e2e/release-journey.spec.ts and the manual-odds test in tests/e2e/release-accessibility.spec.ts on both configured Chromium projects after the fixture's fixed kickoff."
started: "2026-09-26 Phase 06 final release verification."

## Evidence

- timestamp: 2026-09-26T20:40:00+02:00
  checked: "Release fixture setup and D-09 validation contract"
  found: "prepareReleaseFixture hard-coded kickoff to 2026-09-24T15:00Z. The product contract correctly rejects capturedAt >= kickoff and caps future clock skew."
  implication: "This is stale E2E fixture data, not a product validation defect; weakening chronology checks would violate D-09."
- timestamp: 2026-09-26T20:47:00+02:00
  checked: "Focused Node 24.14.0/Docker 29.8.0 Playwright run with durable stdout/stderr/exit capture"
  found: "D-15 release journey and keyboard manual-odds workflow passed in desktop and mobile Chromium: 4/4. Assertions verify odds capturedAt and forecast cutoff precede kickoff; effective result, source observation, and settlement timestamps follow kickoff."
  implication: "Dynamic fixture chronology restores the production-like acceptance flow without altering D-09."

## Resolution

root_cause: "The E2E fixture kickoff was frozen to 2026-09-24 while browser odds capture uses the real current clock, making all current captures correctly fail the D-09 before-kickoff rule."
fix: "Set the release fixture kickoff seven days after runtime time, derive result effective/observed dates from kickoff, and assert odds and forecast capture precede kickoff while settlement evidence follows it."
verification: "Node 24.14.0, Docker 29.8.0; focused desktop/mobile Playwright: 4 passed. Durable artifacts: .planning/debug/odds-kickoff-focused-20260926.stdout.log, .stderr.log, and .exit (0). No full release-gate rerun."
files_changed: [tests/e2e/live-release-stack.ts, tests/e2e/release-journey.spec.ts, tests/e2e/release-accessibility.spec.ts]
---
