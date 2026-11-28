# Deferred items: phase 15

## Out of scope, recorded for later phases

1. **Flag «odds replaced by a newer book» (`ManualOddsSnapshot.replacesOddsId`).** Out of scope (15-RESEARCH Open Question 2). Proposal: an additive boolean in the scanner DTO plus a text chip; no change to the selection rules or the order.
2. **Hash navigation into the closed stale block (assumption A5, unresolved in 15-UI-SPEC.md).** Every row has `id="receipt-{receiptId}"`, but a hash link into the closed `details.scanner-stale` may not expand it in every browser. Phase 16 decides whether a server-side open rule is needed (for example a query flag such as `?open=stale`).
3. **UTC session timezone assumption across the repository (15-RESEARCH Pitfall 3, assumption A3).** The scanner is protected by bound `Date` parameters and `AT TIME ZONE 'UTC'`; other modules are not and would read `timestamp` columns wrongly under a non-UTC session. General defect outside this phase.
4. **`scriptTransferBytes` budget breach that predates this phase** (5 960 160 against the 5 500 000 budget, recorded in the phase 14 deferred items). Informational audit after the phase gate (`--record`, receipt outside the repository): **5 960 540 bytes, 380 above the plan's bound of 5 960 160, so that bound is not met.** LCP 19.6 s, TBT 769 ms and CLS 0.057 (medians) are inside their budgets. The scanner page ships no client component, but the premise «no client JavaScript» is not exact:
   - with `release-navigation.tsx` and `date-range-filter.tsx` taken back to the phase start (`b99004a`) the audit gives 5 960 465, so the navigation entry and the later filter markup change together account for 75 bytes;
   - the scanner domain module is exported from the `@bet-stats/domain` barrel and its text (`scanner-freshness-v1`) is present in the large client chunk, the same lever phase 14 recorded. It is the likely source of the remaining 305 bytes; that part was not measured separately, and plan 14-09 also landed after the 5 960 160 figure may have been taken.
   - **Outcome (15-06):** the scanner module is out of the client chunks (measured: 237 bytes of client JS). The same-session audit gives 5 960 303 at the end of the gap closure against 5 960 228 at the phase start. The bound 5 960 160 is still not met (143 bytes above; the phase start itself is 68 bytes above it) and the 5 500 000 budget is exceeded by 460 303 bytes. Nothing was changed to reach either number. decision: user (see «Gap closure»).
5. **The value policy is bound to `forecast-config-v1`** (15-CONTEXT deferred idea): newer forecast configurations produce no candidates. Owner decision, outside this phase.
6. **Filters by league, market and freshness, and notifications** about new candidates (15-CONTEXT deferred ideas): separate phases.
7. **`oddsCapturedAt` is informational only** and freshness is measured from `submittedAt` (15-RESEARCH Open Question 1). Revisit if the owner wants the observation time the user typed to drive freshness instead.
8. **Web typecheck can break on a corrupted generated routes type file** (`apps/web/.next/dev/types/routes.d.ts`, pre-existing, phase 14). Delete the generated dist directory of the dev server before running `pnpm typecheck`.
9. **Closed (15-06): the truncation, name-reconciliation and wording amendments to 15-UI-SPEC.md are confirmed.** The Amendments section marks rows 1-6 as confirmed by the user and adds row 7 (navigation label and padding, accepted by the user on 2026-11-28) and row 8 (44 px target of the match heading link).

## Observations from plan 15-05

10. **Navigation label and width (U-09 applied, not sufficient alone).** At 768 px the seven entries needed about 801 px of 704 available; shortening the nav label to «Сканер» still left about 752 px. Plan 15-05 therefore also narrows the side padding of the nav links to `--space-2` between 768 and 1023 px. The page title, the `h1` and the home card stay «Сканер value». 15-UI-SPEC.md (Navigation and Home Entry, U-09) still shows the long label as the primary one; the owner may update the text or reject the padding change.
    - **Outcome (15-06):** closed. The user accepted the short label and the padding on 2026-11-28 and 15-UI-SPEC.md now states both (amendment 7); the sentence above describes the state before 15-06.
11. **The match heading link is lower than 44 px** (about 24 px, a link inside the `h3`). The same destination has a 44 px control in every row («Страница матча»), so the browser matrix measures row links, disclosure summaries and button links only. Decide whether the heading link should also become a 44 px target.
    - **Outcome (15-06):** closed. `.scanner-match-head > h3 > a` has `min-height: 44px`, the browser matrix measures the heading links (20 targets instead of 17; red at 26 px before the fix) and `verify:scanner` passes 31 of 31.
12. **`value-scanner.spec.ts` fails by design under other Playwright configs.** `playwright.config.ts` has no `testMatch`, so a bare `pnpm test:e2e` collects it and every case stops with the instruction to use `playwright.scanner.config.ts`.
13. **Pre-existing release e2e failure on the match page.** `release-accessibility.spec.ts`, case «200 percent text zoom keeps essential actions and content available», fails in both projects (18 passed, 2 failed): on `/fixtures/{id}` at 320 px the chip «Главная линия» (`.state-chip.tone-positive`, phase 14 Asian handicap section) ends 22 px outside the viewport. The same 22 px overflow reproduces with the web sources of `b8eae11` and of `41b83d0`, so neither plan 15-05 nor the three later UI commits introduced it. Not fixed (outside this phase); it keeps `pnpm verify:release` red before it reaches `verify:scanner`.
    - **Outcome (15-06):** fixed. Cause: the first track of `.evidence-card dl > div` (`minmax(7rem, 0.7fr)`) is wider than the 204 px row at a 32 px root font, so the value column had 0 px. The Asian handicap cards are now inline-size containers and stack label over value below 11rem. `release-accessibility.spec.ts` measures the main-line card at 100% and 200% text and passes 20 of 20.
14. **`tests/integration/replay-crash-recovery.test.ts` needs `workers/data-sync/dist`.** In a fresh checkout `pnpm test:integration:docker` fails it with «claim barrier timeout» until the worker is built (CI builds it first). `verify:release` runs the integration step before `pnpm build`.
15. **`value-scanner-live.spec.ts` leaves its rows in the database named by `DATABASE_URL`** (receipts and snapshots are append-only). Prefer a disposable database; on a shared one the rows show up on `/scanner` until their kickoff passes.

## Gap closure (plan 15-06)

Measured on 2026-11-28 in the plan's own worktree. Dev database and dev containers were not used.

### D-11: method and client chunks

Primary method: `/*#__PURE__*/` before the three top-level `Object.freeze` calls of `packages/domain/src/value/scanner.ts`; the fallback (type-only barrel re-export and a subpath) was not needed. Production build of the plan base `35dd120`: 23 client JS files, 1 288 391 bytes; after the fix 1 288 154 bytes (-237). Occurrences before and after: freshness policy version 1 -> 0, selection order list 1 -> 0, market family list 2 -> 1; positive control `value-policy-v1` present. Static guard (11) in `tests/unit/scanner-guards.test.ts` was red before the fix.

### Bundle measurements (one session, `node scripts/perf-audit.mjs --record`)

| Measurement | Commit | Date (UTC) | scriptTransferBytes median (3 runs) | LCP ms | TBT ms | CLS | Client JS on disk, bytes |
|---|---|---|---|---|---|---|---|
| A (phase start) | `b99004a` | 10:25:26 | 5 960 228 (5 960 228, 5 960 228, 5 960 228) | 16 183.6 | 734 | 0.057 | 1 287 963 |
| C (end of 15-06) | `39b43c9` | 10:20:40 | 5 960 303 (5 960 303, 5 960 303, 5 960 303) | 16 074.8 | 695.5 | 0 | 1 288 154 |

C was taken first, A right after it. Comparability with 15-05: |A - 5960540| = 312 and |C - 5960540| = 237, both within the 1 000 byte tolerance, so the pair is comparable. C - A = +75 bytes of transfer (the navigation entry required by D-11). On disk C - A = +191 bytes: the navigation chunk +75 and the later `date-range-filter.tsx` markup +58 in each of two chunks that the audited page does not load; no other chunk differs. Against the bounds: 5 960 160 is **not met** (C is 143 bytes above; A is already 68 bytes above); 5 500 000 is exceeded by 460 303 (C) and 460 228 (A). LCP, TBT and CLS are inside their budgets. decision: user.

### Gate stages (final code)

| Stage | Command | Log | Result |
|---|---|---|---|
| lint | `pnpm lint` | lint.log | passed: 7 of 7 tasks, 0 errors, 9 warnings |
| first `verify:release` attempt | `pnpm verify:release` | env-blocked/release-attempt1.log | stopped at the prerequisites: `cmd.exe` did not find `docker` (item 20); no code check ran |
| prerequisites, frozen install, schema | `pnpm verify:release` | release.log | passed |
| typecheck | `pnpm verify:release` | release.log | passed: 7 of 7 tasks |
| unit tests | `pnpm verify:release` | release.log | passed: 94 files, 1652 tests |
| web tests | `pnpm verify:release` | release.log | passed: 14 files, 305 tests |
| integration (owned containers) | `pnpm verify:release` | release.log | passed: 86 files, 801 tests |
| build | `pnpm verify:release` | release.log | passed: 7 of 7 tasks |
| release e2e (8 specs) | `pnpm verify:release` | release.log | **failed**: 62 passed, 2 failed (item 18); `release-accessibility` 20 of 20 |
| scanner matrix (not reached by the chain) | `pnpm verify:scanner` | stage-scanner.log | passed: 31 of 31 |

The release gate as a whole is **not green** because of item 18. Logs and receipts are outside the repository, in the temporary directory `bs-15-06` of the machine that ran the plan.

### New items

16. **The shared rule `.evidence-card dl > div` still squeezes the value column under enlarged text in other cards.** Only the Asian handicap cards were changed. Other users of `ResponsiveEvidence` (forecast, comparison, calibration and scorecard views) keep the `minmax(7rem, 0.7fr)` first track; their closed details were not measured. Not fixed (the shared rule and component were out of bounds).
17. **`scripts/perf-audit.mjs` deletes the directory passed in `--html-dir`.** `measureAndAssert` marks the directory as owned even when the caller supplied it, and `cleanup` removes it recursively. The flag was not used. decision: user.
18. **Pre-existing red release case: `release-degradation.spec.ts`, «D-16 sole-source outage preserves canonical facts and last-valid timestamp»** (both projects). The test expects the raw code `PROVIDER_UNAVAILABLE`; `ProviderStateNotice` prints the Russian label of `providerReasonLabel` since `e7505c5` (2026-10-17), an ancestor of the phase start. Proof of age: the same two failures with the same message reproduce on a worktree of `b99004a` (log repro/base-degradation.log), and 15-06 changed neither the spec nor the component. Not fixed. decision: user.
19. **`verify:release` does not prebuild the dist packages that CI prebuilds** (`.github/workflows/ci.yml`: config, domain, football-data, database, data-sync). A fresh checkout needs that step by hand, otherwise `replay-crash-recovery` fails (item 14); with it the whole integration stage passed. decision: user.
20. **The `PATH` of this machine has a stray double quote** after the `AppData\Roaming\npm` entry. `cmd.exe` then does not see the later entries, Docker included, so `pnpm verify:release` stops at its prerequisites. The gate was run with the quote removed for that one process; the system setting was not changed. decision: user.
21. **`extended-markets.spec.ts` was not rerun**: it runs under `playwright.config.ts`, which needs the dev stack ports 3000 and 3001 and a `DATABASE_URL`. The Asian handicap card CSS is covered by `release-accessibility.spec.ts` and the web tests only.
