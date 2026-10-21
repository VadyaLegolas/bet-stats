# Phase 06: Release Experience and Operations — Validation Strategy

**Status:** executable
**Nyquist mode:** enabled
**Requirements:** UX-01, UX-02, OPS-01, OPS-02, OPS-03, PRIV-01

## Validation Contract

Phase 06 uses two ordered Wave 0 layers. Plan 06-01 first creates the shared real-boundary harness, Phase 06 Playwright configuration, desktop Chromium project, lifecycle tracer, and audited axe dependency. Every later `tdd="true"` task then begins with its listed test file and behavioral assertions in RED state before changing production files. No consuming implementation may start until its test command is runnable and fails for the intended missing behavior.

The final release gate runs against owned PostgreSQL 18 and Redis 8 resources, the real BullMQ worker, Nest API, and built Next application. Browser interception, SQLite, in-memory Redis, fabricated UI responses, and downgraded warnings are not valid evidence.

## Wave 0 Dependencies

| Order | Owner | Test-first artifact | Consumed by | Gate |
|---|---|---|---|---|
| 0A | 06-01 Task 1 | `tests/e2e/live-release-stack.ts`, `playwright.phase06.config.ts`, `tests/e2e/release-journey.spec.ts` | Plans 06-02 through 06-09 | Desktop tracer crosses PostgreSQL, Redis, worker, API, and web with zero interception. |
| 0B | 06-01 Task 2 | `@axe-core/playwright@4.13.0` lockfile entry and serial failure-artifact policy | 06-02 and 06-09 accessibility tests | Frozen install and Playwright test discovery succeed. |
| 0C | 06-02 Tasks 1-3 | `tests/e2e/release-accessibility.spec.ts` RED cases | Responsive shell, evidence, local failures | Each named grep fails before its corresponding production edit, then passes. |
| 0D | 06-03 Tasks 1-2 | `tests/e2e/methodology.spec.ts` RED cases | Model card and contextual warnings | Versioned-card and contextual-warning cases fail first, then pass. |
| 0E | 06-04 Tasks 1-3 | `tests/integration/operator-overview.test.ts`, `tests/e2e/operator-overview.spec.ts` RED cases | Operations API, gateway, UI | Closed DTO, signed gateway, canary absence, and ordered UI fail first, then pass. |
| 0F | 06-05 Tasks 1-2 | New RED cases in `tests/integration/replay-boundary.test.ts` and `tests/e2e/operator-recovery.spec.ts` | Shared ingestion/evaluation recovery | Recovery envelope and three-step UI cases fail first, then pass. |
| 0G | 06-07 Tasks 1-2, after the 06-06 D-14 checkpoint | `tests/integration/privacy-retention.test.ts` RED cases | Consent policy/schema/persistence | Default deny, incomplete policy, association isolation, expiry, and immutable-schema cases fail first, then pass. |
| 0H | 06-08 Tasks 1-2 | Expanded `tests/integration/privacy-retention.test.ts` plus `tests/e2e/privacy-retention.spec.ts` RED cases | Consent API/UI and withdrawal | Withdrawal race, future deny, unlinkability, exact copy, and partial-failure cases fail first, then pass. |
| 0I | 06-09 Tasks 1-2 | `tests/e2e/release-degradation.spec.ts` plus expanded journey/accessibility RED cases | Final degradation and parity expansion | All D-16 scenarios and both Chromium projects fail until implemented. |

The D-14 blocking decision precedes 0G because the tests must encode the approved one-way deletion inventory without inventing subject identity or legal retention values.

## Plan and Requirement Test Map

| Plan | Requirements / decisions | Automated evidence | Manual evidence |
|---|---|---|---|
| 06-01 | OPS-03, D-15 | `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/release-journey.spec.ts --project=desktop-chromium` | None. Environment prerequisites fail explicitly. |
| 06-02 | UX-01, D-01–D-04 | `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/release-accessibility.spec.ts` | Deferred to final screen-reader check in 06-07. |
| 06-03 | UX-02, D-05–D-08 | `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/methodology.spec.ts` | None. Published identities are asserted against source constants. |
| 06-04 | OPS-01, D-09/D-10/D-12 | `pnpm exec vitest run --project integration tests/integration/operator-overview.test.ts && pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-overview.spec.ts` | None. Secret canaries are checked recursively in JSON, DOM, traces, and screenshots. |
| 06-05 | OPS-02, D-11 | `pnpm exec vitest run --project integration tests/integration/replay-boundary.test.ts -t "recovery preview|evaluation recovery|immutable" && pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-recovery.spec.ts` | None. Immutable before/after hashes and counts are machine checked. |
| 06-06 | PRIV-01, D-14 | Recorded checkpoint outcome in `06-06-SUMMARY.md` | Blocking D-14 checkpoint approves the deletion inventory/policy seam before schema execution. |
| 06-07 | PRIV-01, D-13/D-14 | `pnpm exec vitest run --project integration tests/integration/privacy-retention.test.ts -t "default deny|policy incomplete|approved policy|identity rejection|association boundary|expiry|immutable schema"` | None; consumes the recorded 06-06 decision. |
| 06-08 | PRIV-01, D-13/D-14 | `pnpm exec vitest run --project integration tests/integration/privacy-retention.test.ts -t "consent transaction|withdrawal race|future deny|unlinkable immutable" && pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/privacy-retention.spec.ts` | None; irreversible authority is inherited from 06-06. |
| 06-09 | All requirements, D-15/D-16 | `pnpm verify:release` | Screen-reader pass for navigation, chart alternative, recovery dialog, and consent-withdrawal dialog. |

## Degradation and Invariant Evidence

`tests/e2e/release-degradation.spec.ts` must seed quota exhaustion, OPEN circuit, sole-source provider unavailability, quarantined input, stale/limited evidence, dead-letter exhaustion, and safe replay at durable production boundaries. Each scenario records the named seed, browser project, safe correlation ID, expected UI state, provider-call count where applicable, and PostgreSQL before/after identities, hashes, and counts. Seeded secret/raw-payload canaries must be absent from API JSON, DOM, trace, screenshot, and bounded child diagnostics.

Privacy evidence records default-deny row counts, approved-policy availability, transactional consent state, concurrent write/withdrawal outcome, cache invalidation, future-write denial, and unchanged/unlinkable immutable facts. Incomplete subject or retention inputs must produce a deterministic unavailable state rather than guessed configuration.

## Execution Cadence

- Per task: run the exact targeted `<verify><automated>` command after demonstrating the corresponding RED test.
- Per wave: run `pnpm test && pnpm test:integration && pnpm typecheck && pnpm build`, then all Phase 06 specs touched in that wave.
- Phase gate: under Node 24 with Docker available, run `pnpm verify:release`; any missing prerequisite, test failure, canary leak, browser-project omission, invariant change, or dishonest degradation state exits nonzero.

## Evidence Retention

Keep the command, exit code, test/scenario name, browser project, deterministic seed identity, safe correlation ID, and invariant summary in the corresponding `06-NN-SUMMARY.md`. Retain Playwright traces/screenshots only on failure and scan them for canaries before sharing. Never retain credentials, raw provider payloads, personal subject values, unrestricted logs, or environment dumps.

## Manual Checkpoints

1. Plan 06-06 blocking decision: approve the fail-closed D-14 boundary or provide exact approved signed-subject and retention-policy inputs.
2. Plan 06-09 end-of-phase human check: with a screen reader, confirm navigation, one chart alternative, recovery confirmation, and consent-withdrawal focus/announcements match `06-UI-SPEC.md`.

## Completion Criteria

- Every plan has executable automated evidence and references this strategy.
- Every production behavior starts with a scheduled RED assertion; shared harness dependencies complete in 06-01 before consumers run.
- Desktop and mobile Chromium both pass the same factual journeys.
- The complete D-15 lifecycle and D-16 degradation matrix cross real service boundaries without interception.
- All six phase requirements have automated evidence, with the two explicit human checkpoints recorded.
