---
phase: 01-trustworthy-fixture-discovery
plan: 09
subsystem: access-control
tags: [typescript, nestjs, nextjs, responsible-gambling, tdd]
requires:
  - phase: 01-08
    provides: Shared ESM domain boundary and honest fail-closed projection patterns
provides:
  - Server-authoritative deny-by-default region and 18+ eligibility policy
  - Non-cacheable NestJS eligibility endpoint and reusable protected-route guard
  - Server-rendered protected analytics shell with persistent risk disclosure
  - Repository-wide user-facing copy gate for prohibited betting claims
affects: [protected-analytics, forecast-shells, value-betting-ui, api-authorization]
actuals:
  tokens: 5121
  tasks: 2
  commits: 5
tech-stack:
  added: []
  patterns: [deny-by-default-access, server-withheld-descendants, private-no-store-decisions, tokenized-copy-gate]
key-files:
  created: [packages/domain/src/eligibility.ts, apps/api/src/modules/eligibility/eligibility.controller.ts, apps/api/src/modules/eligibility/eligibility.guard.ts, apps/web/components/analytics-shell.tsx, apps/web/components/risk-disclosure.tsx, tests/integration/eligibility.test.ts, tests/unit/responsible-copy.test.ts]
  modified: [packages/domain/src/index.ts, packages/domain/package.json, apps/api/src/app.module.ts, apps/api/package.json, apps/web/package.json, pnpm-lock.yaml, apps/web/next-env.d.ts]
key-decisions:
  - "Treat only an explicit two-letter region in the deployment allowlist plus affirmative 18+ acknowledgement as eligible; advisory hints never grant access."
  - "Require a fresh server timestamp and mark every eligibility response private/no-store so protected decisions cannot leak through shared caches."
  - "Scan all App Router and component TSX sources while exempting only exact approved neutral disclosures from prohibited-claim detection."
patterns-established:
  - "Protected descendants are selected by a Server Component only after an allowed domain decision; denied content never enters the returned React tree."
  - "Eligibility failures use stable reason codes and never expose allowlist configuration."
requirements-completed: [FOUND-04, FOUND-05, FOUND-06]
coverage:
  - id: D1
    description: "Unknown, disallowed, underage, missing, stale, or failed eligibility denies protected analytics server-side."
    requirement: FOUND-04
    verification:
      - kind: integration
        ref: "tests/integration/eligibility.test.ts#server-authoritative eligibility"
        status: pass
    human_judgment: false
  - id: D2
    description: "18+ acknowledgement is unchecked by default and required together with an explicit allowed region."
    requirement: FOUND-05
    verification:
      - kind: integration
        ref: "tests/integration/eligibility.test.ts#denies every non-affirmative input"
        status: pass
    human_judgment: false
  - id: D3
    description: "Protected shells persist the exact risk disclosure and prohibited certainty, urgency, and risk-free claims fail CI."
    requirement: FOUND-06
    verification:
      - kind: unit
        ref: "tests/unit/responsible-copy.test.ts#responsible user-facing copy"
        status: pass
    human_judgment: false
duration: 8min
completed: 2026-08-28
status: complete
---

# Phase 01 Plan 09: Responsible Access and Claims Policy Summary

**Server-authoritative fail-closed eligibility with non-cacheable decisions, withheld protected React descendants, persistent risk disclosure, and a prohibited-claims CI gate**

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-28T13:04:00Z
- **Completed:** 2026-08-28T13:11:59Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments

- Added an empty-by-default, validated region allowlist and stable reason-coded policy that requires explicit region, affirmative 18+ acknowledgement, and a fresh decision.
- Added a NestJS check endpoint and guard that fail closed and emit `private, no-store, max-age=0`; locale and IP-style advisory input cannot authorize access.
- Added a Server Component shell that omits denied descendants entirely and renders the exact persistent risk disclosure for allowed protected analytics.
- Added a tokenized CI copy scanner covering all app/component TSX sources and naming certainty, urgency, and risk-free violations without flagging approved neutral disclosures.

## Task Commits

1. **Task 1 RED: Define fail-closed eligibility contract** — `01e7a44` (test)
2. **Task 1 GREEN: Enforce server eligibility** — `cfc30ca` (feat)
3. **Task 2 RED: Define responsible copy gate** — `c8abc17` (test)
4. **Task 2 GREEN: Persist responsible risk disclosure** — `0d9dcde` (feat)
5. **Task 2 hardening: Scan all user-facing web copy** — `af6eb0b` (test)

## Verification

- `.\node_modules\.bin\vitest.cmd run eligibility responsible-copy --project unit --project integration` — 3 files, 20 tests passed.
- `pnpm typecheck` — all 7 workspace packages passed.
- `pnpm build` — all 7 workspace packages passed; Next.js production build completed.
- Representative allowed/denied copy with an empty default allowlist was reviewed through the integration matrix and source scanner.

## Decisions Made

- A missing decision timestamp is stale; the check endpoint supplies a server timestamp while guards require clients to carry that fresh decision explicitly.
- The protected shell accepts a completed domain decision rather than performing client-side inference, keeping hydration unable to reveal protected descendants.
- The approved negative statements are exact exemptions; the scanner still rejects the same claim tokens anywhere else.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Published live domain types to workspace consumers**
- **Found during:** Task 1 GREEN typecheck
- **Issue:** The domain package exposed stale generated declarations, so API/web could not typecheck the newly exported eligibility contract until a build had already occurred.
- **Fix:** Matched the established config/database/football-data workspace pattern by pointing the package `types` export at `src/index.ts`.
- **Files modified:** `packages/domain/package.json`
- **Verification:** Full monorepo typecheck and build passed.
- **Committed in:** `cfc30ca`

**2. [Rule 2 - Missing Critical] Expanded copy scanning to all current user-facing TSX sources**
- **Found during:** Task 2 GREEN hardening
- **Issue:** A fixed four-file list would let future app routes or components bypass the prohibited-claims gate.
- **Fix:** Discover every TSX source under `apps/web/app` and `apps/web/components` at test time.
- **Files modified:** `tests/unit/responsible-copy.test.ts`
- **Verification:** Responsible-copy suite passed with representative allow/deny phrases.
- **Committed in:** `af6eb0b`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Both fixes enforce reliable workspace consumption and durable CI coverage; no prediction behavior or product scope was added.

## Issues Encountered

- The plan's literal `pnpm test -- responsible-copy --run` command is incompatible with the root Turbo CLI, which consumes `--run`. The equivalent focused Vitest command was used and passed.
- The host runs Node 25.2.1 while the repository requests Node 24.x; pnpm emitted engine warnings, but tests, typecheck, and production build passed.

## Known Stubs

None. Empty region and unchecked age values are intentional deny-by-default security inputs, not unwired UI data.

## User Setup Required

- Production operators must set `ELIGIBILITY_ALLOWED_REGIONS` to a validated comma-separated ISO alpha-2 allowlist before any protected analytics can be eligible. Leaving it unset intentionally denies every region.

## Next Phase Readiness

- Future forecast/value routes can apply `EligibilityGuard` and render through `AnalyticsShell` without client-authoritative access decisions.
- Public fixture discovery remains unchanged and neutral; no prediction behavior was introduced.

## Self-Check: PASSED

- All 14 planned and supporting implementation/test/config files exist.
- Commits `01e7a44`, `cfc30ca`, `c8abc17`, `0d9dcde`, and `af6eb0b` exist.
- Focused tests, full workspace typecheck, and production build passed.

---
*Phase: 01-trustworthy-fixture-discovery*
*Completed: 2026-08-28*
