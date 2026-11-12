---
phase: 09-degradation-alerting
plan: 06
subsystem: api/alerts
tags: [alerts, http-5xx, exception-filter, redis, ttl, wr-01, wr-02, gap-closure, tdd]
requires:
  - "09-02 (Http5xxBucketFilter + recordMinuteBucket; alerts.ts evaluate5xx reader)"
  - "09-05 (alerting runtime composition; test harness precedents)"
provides:
  - "WR-01 closed: raw (non-HttpException) exceptions counted into the bet-stats:http5xx numerator while the error-response contract stays byte-identical (BaseExceptionFilter delegation untouched)"
  - "WR-02 closed: BUCKET_TTL_SECONDS raised 120 → 420 so per-minute buckets survive the evaluator's documented 5-minute rolling window plus margin"
  - "Cross-module mirror test pinning BUCKET_TTL_SECONDS ≥ HTTP5XX_WINDOW_MINUTES * 60 + 60 so TTL/window drift cannot silently return"
affects:
  - "phase-09-verification (ALRT-01 re-check: 5xx signal honesty)"
  - "future changes to HTTP5XX_WINDOW_MINUTES or the bucket keys (mirror guard will trip)"
tech-stack:
  added: []
  patterns:
    - "Cross-module constant mirror guard: a unit test imports the reader-side constant (workers alerts.js) and the writer-side constant (apps/api filter) and asserts the lifetime invariant"
    - "Single-line RED assertions via mock.calls[*] lookups so vitest failure output stays TAP-YAML-parseable (multi-line toHaveBeenCalledWith diffs break the tdd-red-evidence TAP adapter)"
key-files:
  created: []
  modified:
    - apps/api/src/modules/operations/http-5xx-bucket.filter.ts
    - tests/unit/alerts-5xx-filter.test.ts
key-decisions:
  - "Raw exceptions counted because Nest BaseExceptionFilter renders them 500 «Internal server error»; counting happens before delegation, so response bodies stay byte-identical (T-09-07/D-09 contract preserved)"
  - "TTL margin taken as +120s (420 = 300 + 120) per the 09-REVIEW WR-02 sketch; mirror guard enforces ≥ +60s so smaller margins stay legal but the window is always covered"
  - "Mirror test imports HTTP5XX_WINDOW_MINUTES from workers/data-sync/src/jobs/alerts.js inside an apps/api test file — test-only cross-tree dependency, no runtime coupling (alerts-signals.test.ts precedent)"
  - "RED evidence recorded via one TAP record per failing target test; two expire assertions rewritten from toHaveBeenCalledWith to single-line mock.calls lookups so the TAP adapter can parse vitest's failure YAML"
requirements-completed: [ALRT-01]
commits: 4
plan_head_before: c529345418cbe5bbc1b380a651d06d0ceea67fe5
plan_head_after: a511349ba0a4cc5bc497b8b2cf5307eb121880ab
status: complete
actuals:
  tokens: 1300
  tasks: 2
  commits: 4
estimate:
  tokens: 30000
  raw_tokens: 15000
  tasks: 2
  confidence: med
duration: ~10 min
completed: 2026-11-12
coverage:
  - id: D1
    description: "WR-01: a raw non-HttpException exception increments the bet-stats:http5xx bucket while the base reply contract stays { statusCode: 500, message: \"Internal server error\" } / 500"
    requirement: ALRT-01
    verification:
      - kind: unit
        ref: "tests/unit/alerts-5xx-filter.test.ts#counts a raw exception as a 5xx — Nest answers it 500 «Internal server error»"
        status: pass
      - kind: unit
        ref: "tests/unit/alerts-5xx-filter.test.ts#does not write a bucket for 4xx exceptions and keeps the 404 body byte-identical to the base handler"
        status: pass
    human_judgment: false
  - id: D2
    description: "WR-02: BUCKET_TTL_SECONDS = 420 covers the evaluator's 5-minute read window (offsets 0..4) plus ≥60s margin; both expire assertions and the cross-module mirror guard pin it"
    requirement: ALRT-01
    verification:
      - kind: unit
        ref: "tests/unit/alerts-5xx-filter.test.ts#covers the evaluator's rolling 5-minute window plus margin so minute -4 buckets stay readable"
        status: pass
      - kind: unit
        ref: "tests/unit/alerts-5xx-filter.test.ts#counts a 500 error into bet-stats:http5xx:<minuteIndex> (INCR + EXPIRE 420s) and then delegates to the base handler"
        status: pass
      - kind: unit
        ref: "tests/unit/alerts-5xx-filter.test.ts#increments bet-stats:httpTotal:<minuteIndex> with a 420s TTL on every call"
        status: pass
      - kind: unit
        ref: "tests/unit/alerts-signals.test.ts (38/38 green across both files — reader-side window/thresholds untouched)"
        status: pass
    human_judgment: false
---

# Phase 09 Plan 06: 5xx Signal Quality Closure (WR-01, WR-02) Summary

**One-liner:** Closed both 5xx signal-quality gaps: the Nest exception filter now counts raw unhandled exceptions (the exact class it answers with 500) into the Redis numerator while error bodies stay byte-identical, and bucket TTL rose 120→420s so the documented rolling 5-minute window is real — pinned by a cross-module TTL↔window mirror test.

## What Was Built

### Task 1 — WR-01: raw exceptions into the 5xx numerator (TDD)

- RED (`87fee2e`): rewrote the bug-codifying case into «counts a raw exception as a 5xx — Nest answers it 500», asserting the `bet-stats:http5xx:<minuteIndex>` INCR **and** the unchanged base reply `{ statusCode: 500, message: "Internal server error" }` / 500 in the same case. Validated by `gsd-tools check tdd-red-evidence` → `RED_EVIDENCE_OK` (TAP record; failure on the planned bucket-write assertion).
- GREEN (`d86112e`): `Http5xxBucketFilter.catch` condition `status !== null && status >= 500` → `status === null || status >= 500`; class doc comment states the real behavior. `recordMinuteBucket`, prefixes, `exceptionStatus` and the `super.catch` delegation untouched — response contract byte-identical (T-09-07/D-09).

### Task 2 — WR-02: bucket TTL covers the 5-minute window (TDD)

- RED (`f142f61`): both EXPIRE assertions (5xx filter + httpTotal counter) updated 120→420 and a new cross-module mirror test `BUCKET_TTL_SECONDS ≥ HTTP5XX_WINDOW_MINUTES * 60 + 60` (imports the reader-side constant from `workers/data-sync/src/jobs/alerts.js`). Validated by 3 TAP records → `RED_EVIDENCE_OK` ×3.
- GREEN (`a511349`): `BUCKET_TTL_SECONDS = 420` (300 + 120 margin per the 09-REVIEW WR-02 sketch) with a comment stating the window-coverage invariant (per-minute INCR refreshes TTL; a key lives at most TTL past its minute's last write). Reader side — `HTTP5XX_WINDOW_MINUTES`, `evaluate5xx`, all thresholds — untouched (D-09).

## Verification Results

| Deliverable | Verify | Result |
|---|---|---|
| WR-01 RED evidence | `gsd-tools check tdd-red-evidence` (1 TAP record) | `RED_EVIDENCE_OK` |
| WR-02 RED evidence | `gsd-tools check tdd-red-evidence` (3 TAP records) | `RED_EVIDENCE_OK` ×3 |
| Plan verification | `pnpm vitest run --project unit tests/unit/alerts-5xx-filter.test.ts tests/unit/alerts-signals.test.ts` | 38/38 pass (2 files) |
| Type-safety | `npx tsc --noEmit -p apps/api/tsconfig.json` | exit 0 |
| Scope gates | `git status` for packages/database/prisma/**, apps/web/**, workers/** | no changes — schema push gate not triggered, UI and reader side untouched |
| TDD gate | RED commit precedes GREEN commit on both tasks (merge-base ancestry) | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Single-line RED assertions for TAP-parseable evidence**
- **Found during:** Task 2 (RED evidence validation)
- **Issue:** vitest's `toHaveBeenCalledWith` failure renders a multi-line diff whose YAML block breaks the `tdd-red-evidence` TAP adapter ("Non-TAP data in report", `invalid_record`) — evidence format problem, not a behavior problem
- **Fix:** rewrote the two EXPIRE assertions as single-line `mock.calls[0]?.[1]).toBe(420)` (plus a key lookup) — same behavior asserted, single-line failure output; three records then validated `RED_EVIDENCE_OK` ×3
- **Files modified:** tests/unit/alerts-5xx-filter.test.ts (test code only)
- **Verification:** all three records returned `RED_EVIDENCE_OK`; GREEN run 38/38 pass
- **Committed in:** f142f61 (task 2 RED commit)

---

**Total deviations:** 1 auto-fixed (1 blocking-evidence-format).
**Impact on plan:** evidence plumbing only — planned behavior and assertions unchanged; no scope creep.

## Issues Encountered

- Windows console encoding initially mojibake'd the TAP target-test name (`matched_test: null`) — fixed by pinning `[Console]::OutputEncoding` to UTF-8 before the reporter run and writing TAP with `utf8NoBOM`. No code impact.
- vitest `-t` patterns are regexes: the literal `+` in «(INCR + EXPIRE 420s)» made the first targeted run match nothing (all tests SKIP, exit 0). Re-ran with a specials-free pattern («EXPIRE 420s»). No code impact.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary surface. T-09-16 (mitigated): raw exceptions counted so unhandled-error bursts page, keys still carry only the minute index. T-09-17 (mitigated): TTL 420s covers the window; mirror guard prevents silent drift. T-09-SC: no package installs in this plan.

## Notes for the Phase Verifier

- Plan 6 of 6 for phase 09. ALRT-01 was jointly declared by 09-01/09-02/09-03/09-05/09-06 — with this SUMMARY the last declaring plan is done, so ALRT-01 can be marked complete (subject to the shared-ID gate check).
- Both `<verify>` commands from the plan were executed and passed after the final commit (38/38 unit tests across the two declared files; tsc exit 0).
- REFACTOR phase skipped per the TDD contract: both GREEN implementations are minimal, no cleanup needed (no `refactor(09-06)` commit).

## Next Phase Readiness

- All six plans of Phase 09 complete. WR-01/WR-02 closed on top of CR-01/CR-02/IN-05 from 09-05; the 5xx signal now matches its documented D-09 contract end to end.
- Remaining human-verification items carried from 09-VERIFICATION.md (live-stack evaluator tick, visual adequacy, live Redis counters) are unchanged by this plan — this plan's prohibitions forbade restarting the dev stack; live Redis buckets will now show TTL 420s.

---
*Phase: 09-degradation-alerting*
*Completed: 2026-11-12*
