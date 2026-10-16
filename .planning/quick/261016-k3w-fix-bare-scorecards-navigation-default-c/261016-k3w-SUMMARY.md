---
phase: quick-261016-k3w
plan: 01
subsystem: ui
tags: [nextjs, react, scorecards, cohort-query, iso8601, url-params, tdd]

# Dependency graph
requires:
  - phase: 06-11 (release experience — scorecards page, navigation links, evaluation API contract)
    provides: "apps/web/app/scorecards/page.tsx fetchEvidence, release-navigation.tsx bare /scorecards links, API parseCohortQuery exactUtc contract (read-only)"
provides:
  - "resolveCohortBounds helper defaulting missing cohort from/to bounds in exact-UTC format inside the API 366-day ceiling"
  - "fetchEvidence always sending from/to for both scorecard and value-candidates views so bare /scorecards completes the designed 308 → dashboard flow"
  - "Unit suite covering defaults, explicit precedence, single-bound derivation, format and unparseable input"
affects: [scorecards, release-navigation, evaluation-api]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 1411
  tasks: 2
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure client-side defaulting of untrusted URL bounds before crossing the API trust boundary; explicit values pass through verbatim and stay server-validated"
    - "TDD with vi.useFakeTimers()/setSystemTime pinning now-based defaults as exact strings against the API exactUtc regex"

key-files:
  created:
    - apps/web/app/scorecards/cohort-bounds.ts
    - tests/unit/scorecard-bounds.test.ts
  modified:
    - apps/web/app/scorecards/page.tsx

key-decisions:
  - "Single-bound derivation uses the present bound +/- 365 days (not now-based fill) so ANY explicit age keeps 0 < duration <= 366 days, avoiding INVALID_COHORT_PERIOD against ancient bounds"
  - "Unparseable explicit bounds pass through untouched and the resolver never throws — the API owns rejection (INVALID_FROM), client only guarantees the missing key gets a valid default"
  - "Both-absent default window is now-364d .. now+1d (365-day span) — strictly inside MAX_PERIOD_MS = 366 days"

patterns-established:
  - "Cohort query bounds are always resolved through resolveCohortBounds(search) before crossing the evaluation API boundary"

requirements-completed: []

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "resolveCohortBounds helper defaulting missing cohort from/to with exact-UTC values inside the API period ceiling, explicit bounds passing through byte-identical"
    verification:
      - kind: unit
        ref: "tests/unit/scorecard-bounds.test.ts (6 behaviors: both-missing defaults, explicit precedence, lone-from +365d, lone-to -365d, empty/array handling, unparseable input)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Bare /scorecards (no query string) renders the scorecard dashboard with its Russian empty state instead of the page-level error fallback, via defaulted bounds → API 308 canonicalization → dashboard"
    verification:
      - kind: unit
        ref: "tests/unit/scorecard-ui.test.tsx (8/8 combined with scorecard-bounds run)"
        status: pass
      - kind: automated_ui
        ref: "node C:/Users/Vlad/AppData/Local/Temp/opencode/qa-page.mjs http://127.0.0.1:3000/scorecards — dashboard copy present, consoleErrors [], badResponses [], page-level error copy absent"
        status: pass
      - kind: other
        ref: "curl GET /evaluation/scorecard with the exact default bounds + eligibility headers → 308 (canonical Location); no-params baseline → 400 INVALID_FROM (API untouched)"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-10-16
status: complete
---

# Quick 261016-k3w: Bare /scorecards Default Cohort Bounds Summary

**Client-side `resolveCohortBounds` defaults the cohort from/to in `fetchEvidence`, so bare `/scorecards` lands on the rendered dashboard (empty state) via API 308 canonicalization instead of the page-level error fallback — API contract untouched.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-16T14:41:00Z
- **Completed:** 2026-10-16T14:47:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- New pure helper `resolveCohortBounds` fills missing `from`/`to` with exact-UTC defaults (`now-364d` / `now+1d`, or `presentBound ± 365d`) satisfying the API `exactUtc` regex and `0 < duration <= MAX_PERIOD_MS` (366 days) for any explicit bound
- `fetchEvidence` now always sets `from`/`to` for both the `scorecard` and `value-candidates` views; the dimension whitelist still only forwards `modelVersion`, `competitionId`, `market`, so unknown params can never reach the API (`INVALID_COHORT_QUERY` property preserved)
- TDD suite (RED confirmed: module-not-found, then GREEN 6/6) pins now-based defaults as exact strings and asserts derived values against the API's exact-UTC regex
- Live-verified: curl with exact default bounds → `308` + canonical `Location: /scorecards?modelVersion=all&...&from=...&to=...`; no-params baseline still `400 INVALID_FROM`; browser QA on bare `/scorecards` shows the dashboard with the Russian empty state and empty console/network error lists

## Task Commits

Both tasks are carried by exactly ONE atomic code commit (quick-task constraint: one commit at the end of Task 2):

1. **Task 1: TDD the default cohort-bounds resolver** - `c6b1603` (fix, test part)
2. **Task 2: Wire defaults into fetchEvidence, verify live, single atomic commit** - `c6b1603` (fix)

**Plan metadata:** handled by the orchestrator (docs commit not performed by executor, per constraint)

## Files Created/Modified
- `apps/web/app/scorecards/cohort-bounds.ts` - New `resolveCohortBounds(search)` helper: first-element array access, empty string = absent, explicit values byte-identical pass-through, derived values via `Date.prototype.toISOString()`, never throws on unparseable input
- `tests/unit/scorecard-bounds.test.ts` - Six behavior tests with `vi.useFakeTimers()` + `vi.setSystemTime`, asserting exact strings and the API exact-UTC regex / period ceiling
- `apps/web/app/scorecards/page.tsx` - `fetchEvidence` computes `bounds = resolveCohortBounds(search)` once and sets `from`/`to` after the three-key dimension whitelist loop; error-fallback branch, 308 branch, cursor/limit block and eligibility headers untouched

## Decisions Made
- Single-bound derivation is `presentBound ± 365 days` (planner refinement over now-based fill) so an ancient explicit `from` cannot trip `INVALID_COHORT_PERIOD`
- Unparseable explicit bound passes through verbatim; only the *missing* key falls back to the now-based default — the API remains the sole validator (`INVALID_FROM`)
- Commit message appends the quick id `(261016-k3w)` per orchestrator constraint (plan's base message otherwise verbatim)

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written (no API, nav, README, or Russian-copy changes beyond the specified wiring).

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** No scope creep; staging blacklist respected (only the 3 named files committed).

## Issues Encountered
- The plan's combined verify command used `curl -o /dev/null`, which yields an empty status code under Windows PowerShell (`$null` expands to an empty argument). Re-ran with `-o NUL` → `308` confirmed, and header dump confirmed the canonical `Location`. Verification mechanics only — no code or contract change.
- Pre-existing working-tree noise (`.env*`, `pnpm-lock.yaml`, `packages/database/src/generated/**`, `next-env.d.ts`, `.planning/**`, root scripts) left untouched per the staging blacklist.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Bare `/scorecards` navigation links now work end-to-end as README documents; no blockers.
- API evaluation contract verified unchanged (`GET /evaluation/scorecard` without params still 400 `INVALID_FROM`).

## Known Stubs
None.

## Self-Check: PASSED

Verified after writing this summary:
- `FOUND: apps/web/app/scorecards/cohort-bounds.ts`
- `FOUND: apps/web/app/scorecards/page.tsx`
- `FOUND: tests/unit/scorecard-bounds.test.ts`
- `FOUND: .planning/quick/261016-k3w-fix-bare-scorecards-navigation-default-c/261016-k3w-SUMMARY.md`
- Commit `c6b1603` exists (`git cat-file -t` → `commit`) and `git show --name-only` lists exactly the three plan files.
