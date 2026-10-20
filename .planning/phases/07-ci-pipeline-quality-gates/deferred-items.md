# 07-01 Deferred Items

## Pre-existing integration-harness failures (out of scope — not caused by this plan)

Baseline proof: `pnpm run test:integration:docker` executed twice on 2026-10-20 —
once with this plan's `tests/integration/mutation-rejection.test.ts` present
(467 tests: 455 passed, 12 failed) and once with the file renamed out of the include
pattern (461 tests: 449 passed, 12 failed). The identical 12 failures appear in both
runs; this plan's 6 new tests pass and add zero new failures. The harness therefore
cannot exit 0 until the items below are fixed — they predate phase 07.

| # | File(s) | Failing tests | Root cause (diagnosed) |
|---|---------|---------------|------------------------|
| 1 | tests/integration/evidence-browser-contract.test.ts (2), tests/integration/evidence-publication.test.ts (2, one cascading) | label assertions expect English ("Requested cutoff", "Goals for", "Value"/"Not available") while `apps/web/app/teams/[teamId]/evidence/page.tsx` renders Russian labels since commit `d44f65f` (Russian localization, 2026-10-15 convention). The second evidence-publication failure is a cascade: the label assertion at line 95 aborts the test before `result-late` is created at line 101, so line 112's `supersedesResultVersionId: "result-late"` hits a foreign-key violation. | Stale English expectations after localization |
| 2 | tests/integration/replay.test.ts (6) | First failure: `ReplayPreview_consumed_after_created` check constraint (`23514`) — the consumed timestamp (DB clock inside the postgres container) lands before the created timestamp (app clock on the host) under host↔container clock skew; the five following tests fail with cascading 409 conflicts from the poisoned first run. | Host↔container clock skew + cascading state |
| 3 | tests/integration/privacy-retention.test.ts (2) | `RETENTION_DENIED` raised at apps/api/src/modules/privacy/privacy.service.ts:99-101, whose catch block rewrites ANY transaction error (including Serializable isolation conflicts under full-suite load) as `RETENTION_DENIED`. | Serialization-conflict masking under load |

Action owner: a future repair plan (not 07-01). None of these touch CI configuration,
lint coverage, or the mutation-rejection gaps closed by this plan.
