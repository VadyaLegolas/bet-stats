---
phase: 10-performance-audit-and-budgets
plan: 01
subsystem: performance-audit
tags: [perf, lighthouse, budgets, receipts, owned-stack, fail-closed]
requires:
  - "tests/e2e/live-evaluation-stack.ts (owned-stack pattern)"
  - "scripts/verify-release-integration.mjs (gate conventions)"
  - "apps/web/next.config.ts NEXT_DIST_DIR support"
provides:
  - "scripts/perf-audit.mjs (audit harness: --record / --assert-only / default gate modes, exported pure helpers median/extractMetrics/metricBlock/assertMetricsWithinBudgets/buildReceipt/validateReceipt/assertProfileMatch)"
  - "scripts/perf/perf-budget.json (perf-budget-v1: pinned mobile profile, page list, budgets, recorded-only desktopProfile)"
  - "scripts/perf/perf-receipts/perf-baseline-before.json (committed before median-of-3 receipt)"
  - "tests/unit/perf-audit.test.ts (Wave 0: 18 contract tests)"
affects:
  - "10-02 (optimization re-measures against this harness and tightens these budgets)"
  - "10-03 (CI performance-budget job runs this script)"
tech-stack:
  added: ["lighthouse@13.6.0", "chrome-launcher@1.2.3"]
  patterns: ["owned-container lifecycle (Phase 05/07 reuse)", "fail-closed gate script (.mjs, main-entry guard)", "closed-field secret-free receipts (Phase-8 D-15 discipline)", "self-verifying profile pin (first LHR configSettings → verbatim budget pin)"]
key-files:
  created:
    - scripts/perf-audit.mjs
    - scripts/perf/perf-budget.json
    - scripts/perf/perf-receipts/perf-baseline-before.json
    - tests/unit/perf-audit.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
decisions:
  - "Budgets pinned from the committed before-receipt medians with ~20% headroom (LCP ×1.20, TBT ×1.26, CLS +0.02 absolute, script bytes ×1.21) — traced to measurement, never invented (D-03)"
  - "Seed stores the FULL fail-closed ForecastResponseDto in the snapshot receipt column (the eval-stack `receipt: {}` shape 500s the /forecasts list route)"
  - "Desktop profile self-verified from the first desktop LHR and pinned verbatim as recorded-only desktopProfile (D-04: no desktop budgets)"
metrics:
  duration: 87min
  tasks: 3
  files: 6
  completed: 2026-11-17
status: complete
actuals:
  tokens: 56700
  tasks: 3
  commits: 4
  plan_head_before: 2f4102b34a259ddc990789e16351425dbbbfb9ca
  plan_head_after: 79f5234
commits: 4
estimate:
  tokens: 56000
  tasks: 3
---

# Phase 10 Plan 01: Audit Harness + Before-Receipt + Budgets Summary

**One-liner:** Owned-stack Lighthouse audit harness producing the committed «before» median-of-3 receipt (LCP 22051.3 ms / TBT 755.5 ms / CLS 0.0871 / script 5 203 434 B) plus the recorded-only desktop block, with Wave-0 unit tests pinning median/assertion/receipt semantics and a versioned perf-budget.json pinned from the measurement with ~20% headroom.

## What Was Built

### Task 1 — End-to-end audit tracer (commit 08c236c)

`scripts/perf-audit.mjs` — a single ESM harness modeled on `tests/e2e/live-evaluation-stack.ts` with the plan's deliberate divergences:

- **Owned stack:** unique PostgreSQL 18 container (`bet-stats-perf-audit-<pid>-<ts>`, dynamic port, pg_isready poll), `prisma migrate deploy`, builds of config/domain/database dists, seed, API build; Nest API on 127.0.0.1:3231 (`POSTGRES_READY/REDIS_READY=true`, `ELIGIBILITY_ALLOWED_REGIONS=PL`, `NODE_ENV=test`); production web `next build` + `next start` on 127.0.0.1:3230 with `NEXT_DIST_DIR=.next-e2e` set by the script for BOTH commands. `ELIGIBILITY_CHECKED_AT` is deliberately NOT set (per-request stamping, Pitfall 5). Zero live provider calls; the developer's `.next` and dev servers untouched.
- **Seed:** one canonical fixture `perf-audit-fixture` (kickoff now + 3 days, status SCHEDULED) with two ISSUED ForecastSnapshots (INITIAL rev 1, PRE_MATCH rev 1) forming a comparable pair.
- **Preflight:** page HTML must contain the workbench heading («Прогнозы и ручной поиск value») and must NOT contain the degraded marker («Сопоставимая пара прогнозов пока недоступна») — otherwise `AUDIT_PREFLIGHT_FAILED`.
- **Runner:** 3 gated mobile Lighthouse runs (simulated throttling; profile pinned from `perf-budget.json` when present, otherwise self-verified from the first run's `lhr.configSettings`) + 3 recorded-only desktop runs against the same seeded URL (D-04). chrome-launcher with `chromePath: chromium.executablePath()` and `--headless=new` (parity local/CI). Raw HTML/JSON artifacts go to a throwaway OS temp dir (or `--html-dir`), never the repo.
- **Fail-closed extraction:** absent audit id / non-numeric value / missing resource-summary script item → `UNMEASURABLE_<METRIC>` (no `?? 0`, no `Number(undefined)`). Per-metric median-of-3 (Pitfall 9). Performance score recorded, never asserted (D-02).
- **Receipt:** closed-field `perf-receipt-v1` built field-by-field (never a spread of env or the LHR). Cleanup kills exactly its recorded PIDs (`taskkill /T /F` / `process.kill(-pid)`) and `docker rm --force` of the exact owned container. Main-entry guarded (imports never boot the harness).
- CLI: `--record` (measure+write, skip assertions), `--assert-only --receipt <path>` (no stack), default (measure+write+assert), `--budget`, `--receipt` (required — `RECEIPT_PATH_REQUIRED`), `--html-dir`.

**Committed before-receipt** (`perf-baseline-before.json`, gitSha 2f4102b, Lighthouse 13.6.0, mobile simulate profile recorded verbatim):

| Metric | Median of 3 | Runs |
|--------|-------------|------|
| LCP | 22 051.317 ms | 14 420.1 / 22 051.3 / 24 138.1 |
| TBT | 755.5 ms | 904.5 / 755.5 / 740.5 |
| CLS | 0.08710918036748198 | ×3 identical |
| scriptTransferBytes | 5 203 434 B | ×3 identical |
| performanceScore | 0.35 (recorded only) | — |

Desktop block (recorded-only, D-04): LCP 27 998.3 ms, TBT 767 ms, CLS 0.0295, script 5 203 434 B, performanceScore 0.28, `recordedOnly: true` — never asserted.

The 5.2 MB script transfer is the honest unoptimized baseline: the whole client `forecast-workbench.tsx` ships eagerly over simulated slow 4G, which is exactly what 10-02's D-09 split attacks.

### Task 2 — Wave 0 TDD unit tests (RED 95cd387 → GREEN c875bf4)

`tests/unit/perf-audit.test.ts` — 18 contract tests, message-first style:

- **Median semantics:** middle of sorted triple (never min/max), per-metric across runs, loud failure on empty input.
- **Fail-closed assertions:** `UNMEASURABLE_LCP` / `UNMEASURABLE_SCRIPT_TRANSFER_BYTES` on undefined/NaN; exact breach message `lcp: 3000 > budget 2500`; missing budget value fails closed; gated set is exactly `lcp, tbt, cls, scriptTransferBytes`.
- **Closed-field receipt schema (implemented in GREEN):** `validateReceipt` rejects unknown top-level keys, rejects secret-shaped values anywhere in the tree (credential connection strings, bearer tokens), rejects missing gated metric blocks; accepts the exact closed field set.
- **Recorded-only discipline:** a receipt whose desktop medians are `Number.MAX_VALUE` still validates and still passes `assertMetricsWithinBudgets` (desktop outside the gated set, D-04); performanceScore 0.01 is recorded, never asserted (D-02).
- **Module hygiene:** no static import of lighthouse/chrome-launcher/@playwright/test — the browser stack stays lazy-imported so unit tests never load it.

**TDD Gate Compliance:** RED commit 95cd387 precedes GREEN commit c875bf4 (verified ancestry). RED evidence: `pnpm vitest run --project unit tests/unit/perf-audit.test.ts` exit 1 — 6 failed / 12 passed; all 6 failures were the receipt-validator subset (unknown-key rejection, accept-valid, connection-string rejection, bearer-token rejection, missing-gated-metric, desktop-recorded-only), failing because `validateReceipt` was not yet implemented — the planned missing behavior, not load/syntax errors. `gsd_run check tdd-red-evidence` is unavailable in this environment (established operating rule), so the evidence above is the machine-verifiable record (command, exit code, failing test names, planned-vs-observed). No REFACTOR commit needed.

### Task 3 — Budget pinning (commit 79f5234)

`scripts/perf/perf-budget.json` (`perf-budget-v1`):

| Metric | Before median | Budget | Headroom rationale |
|--------|---------------|--------|--------------------|
| lcp | 22 051.317 ms | 26 500 ms | ×1.20, rounded up to a sensible 500 ms unit — absorbs run-to-run variance (observed spread 14.4–24.1 s) without detaching from the measurement |
| tbt | 755.5 ms | 950 ms | ×1.26, rounded to 50 ms — fresh-run check measured 861 ms, so headroom is real but modest |
| cls | 0.08711 | 0.11 | unitless near-zero value: small absolute increment (+0.02), rounded to 2 decimals |
| scriptTransferBytes | 5 203 434 B | 6 300 000 B | ×1.21, rounded to 100 KB — bytes are deterministic (identical ×3), headroom covers the fresh-run equality plus minor drift |

- `profile` and `desktopProfile` copied **verbatim** from the committed receipt's `lhr.configSettings` (self-verifying pin, D-06 comparability; drift fails the run with `PROFILE_DRIFT`).
- No desktop budgets anywhere — desktop stays recorded-only (D-04).
- **Gate proven:** a fresh default-mode run read the page list from the budget file, passed the profile-drift check, and asserted green (exit 0): fresh medians LCP 14 636.6 / TBT 861 / CLS 0.0871 / bytes 5 203 434, all within budget. The check receipt was written to OS temp and deleted; the tracked receipts directory is unchanged.

## Deviations from Plan

**1. [Rule 1 - Bug] `bootOwnedStack()` was invoked without `await`**
- **Found during:** Task 1 (first verify run)
- **Issue:** the unhandled boot promise raced the preflight, producing a confusing double failure; the stack was torn down before audits.
- **Fix:** `await bootOwnedStack();`
- **Commit:** 08c236c

**2. [Rule 1 - Bug] Seeded snapshots carried `receipt: {}`, which 500s the /forecasts route**
- **Found during:** Task 1 (preflight failed with the degraded-workbench marker)
- **Issue:** `ForecastRepository.listIssued` parses the snapshot's `receipt` column as a full fail-closed `ForecastResponseDto` (exact keys, `modelVersion: "poisson-ensemble-v1"`, all three markets); the eval-stack seed shape copied by the plan's read_first note does not satisfy that contract, so the SSR page rendered the degraded state and the honest audit was impossible.
- **Fix:** the seed now stores the full valid response DTO (all 20 exact keys, three markets with normalized probability vectors, confidence-v1 components, retained-mass-v1 tail, matching receipt block) in the `receipt` column.
- **Files modified:** scripts/perf-audit.mjs
- **Commit:** 08c236c

**3. [Rule 3 - Blocking] `pnpm add -D -w lighthouse chrome-launcher` left `next` missing from the pnpm store**
- **Found during:** Task 1 (web build failed: `Cannot find module .../apps/web/node_modules/next/dist/bin/next`)
- **Issue:** the install re-hashed next's peer context (lighthouse's `@opentelemetry/api` joined the root) and the `next@16.3.3` store directory vanished, leaving a dangling junction.
- **Fix:** `pnpm install` restored the store (next 16.3.3, junction valid again). Lockfile diff reviewed: same versions, peer-hash key change only. The developer's running dev server was never touched.
- **Commit:** 08c236c (package.json + lockfile)

**4. [Operating rule] `gsd_run check tdd-red-evidence` unavailable** — RED evidence recorded manually in the TDD Gate Compliance section above (07-01..08-01 precedent).

## Known Stubs

None — every value in the committed receipt and budget file is a real measurement from a real run.

## Deferred Issues

- `tests/unit/fixtures-sync.test.ts` has 7 pre-existing unit failures (provider-sync domain, `PrismaClientKnownRequestError`), unrelated to this plan (scope boundary: nothing this plan touches is imported there). Recorded in `.planning/phases/10-performance-audit-and-budgets/deferred-items.md` for a future repair task.

## Threat Flags

None — no new trust-boundary surface beyond the plan's threat model (receipt writer, extraction/assertion, budget profile — all mitigated as planned and pinned by tests).

## Self-Check: PASSED

- scripts/perf-audit.mjs, scripts/perf/perf-budget.json, scripts/perf/perf-receipts/perf-baseline-before.json, tests/unit/perf-audit.test.ts — all exist on disk.
- Commits 08c236c, 95cd387, c875bf4, 79f5234 are ancestors of HEAD.
- Unit suite for the new test file: 18/18 green; full unit project: 530/537 (7 pre-existing fixtures-sync failures, see Deferred Issues).
