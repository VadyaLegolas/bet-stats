# 07-01 Deferred Items

## Pre-existing integration-harness failures (out of scope — not caused by this plan)

Baseline proof: `pnpm run test:integration:docker` executed twice on 2026-10-20 —
once with this plan's `tests/integration/mutation-rejection.test.ts` present
(467 tests: 455 passed, 12 failed) and once with the file renamed out of the include
pattern (461 tests: 449 passed, 12 failed). The identical 12 failures appear in both
runs; this plan's 6 new tests pass and add zero new failures. The harness therefore
cannot exit 0 until the items below are fixed — they predate phase 07.

**Resolved on 2026-10-21 (wave 07-03): all three groups fixed and verified —
`pnpm run test:integration:docker` now passes 467/467.** Root causes below were
re-diagnosed from code and migrations during wave 07-03; two of the original
diagnosed causes (rows 2 and 3) were wrong and are corrected here.

| # | File(s) | Failing tests | Root cause (verified 2026-10-21) |
|---|---------|---------------|------------------|
| 1 | tests/integration/evidence-browser-contract.test.ts (2), tests/integration/evidence-publication.test.ts (2, one cascading) | label assertions expect English ("Requested cutoff", "Goals for", "Value"/"Not available") while `apps/web/app/teams/[teamId]/evidence/page.tsx` renders Russian labels since commit `d44f65f` (Russian localization, 2026-10-15 convention). The second evidence-publication failure is a cascade: the label assertion at line 95 aborts the test before `result-late` is created at line 101, so line 112's `supersedesResultVersionId: "result-late"` hits a foreign-key violation. | Stale English expectations after localization (as originally diagnosed). Fixed by `d630083`. |
| 2 | tests/integration/replay.test.ts (6) | First failure `23514`: `queue()` writes `consumedAt` from the injected `now()` while the `ReplayPreview` INSERT omitted `createdAt`, letting the DB default `CURRENT_TIMESTAMP` (real wall clock) win — the `consumed_after_created` CHECK compared two different clock domains, so any fixed test clock in the past violated it. Original diagnosis "host↔container clock skew" was wrong: the two clocks are app-injected vs DB default. The five later failures were not cascades: real-clock services read `ProviderCircuitState` rows stamped with fixed 2026-09-30 timestamps by earlier tests; the 5-minute freshness window had elapsed, so `preview()` correctly failed closed with `STALE_CIRCUIT_STATE` 409. | Mixed clock domains in one CHECK + stale shared circuit fixtures (time-bombs). Fixed by `5972d2a` (createdAt from `now()`) and `a50277f` (fresh circuit per test); fail-closed freshness check unchanged. |
| 3 | tests/integration/privacy-retention.test.ts (2) | Both failures were `RETENTION_DENIED` rethrown by the catch mask at `privacy.service.ts:99-102`, but the masked original error was `active approved retention consent required` from trigger `enforce_active_retention_consent` (migration `20260920_privacy_retention`): the trigger validates `consent."expiresAt" > clock_timestamp()` — the real DB clock. Fixtures granted consent at fixed `2026-09-20` + 30 days, which expired `2026-10-20`; from 2026-10-21 every retained write raised deterministically. Original diagnosis "Serializable isolation conflicts under load" was wrong — `fileParallelism:false`/`concurrent:false` and the fixed expiry date make it fully deterministic. | Expired fixed-date consent vs `clock_timestamp()` (time-bomb). Fixed by `44b9dc5` (real-clock grant/retain, purge cutoff from `view.expiresAt`); mask and fail-closed denials unchanged. |

Action owner: closed by wave 07-03 (see commits above). None of these touch CI
configuration, lint coverage, or the mutation-rejection gaps closed by 07-01.
