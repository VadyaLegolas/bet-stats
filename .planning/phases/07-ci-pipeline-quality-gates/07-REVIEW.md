# Phase 07: Code Review — CI Pipeline & Quality Gates

**Reviewed:** 2026-10-21T21:40:00Z
**Scope:** 936dbeb..HEAD — 45 source/test files (plus package.json scripts, vitest.config.ts, turbo.json, schema.prisma as cross-reference context)
**Mode:** adversarial deep review
**Status:** issues_found (no CRITICAL; 1 HIGH, 4 MEDIUM, rest LOW/NIT)

## Summary

The phase delivers a well-structured three-job CI pipeline (quality / integration / e2e-portable) with least-privilege token, no `pull_request_target`, no `secrets.` references, frozen-lockfile installs, and an executable workflow-security policy (`ci-workflow-contract.test.ts`) that guards the workflow running it. The Docker harnesses own their containers, run `prisma migrate deploy`, and stub every provider call — I traced all provider touchpoints in the CI path and found **no invocation of live external providers**. The fail-closed fixes found in the deferred-items diagnosis (mixed clock domains in `ReplayPreview`, stale circuit fixtures, expired retention consent) are genuine root-cause fixes that preserve the guards rather than weaken them.

The main defect is a cross-platform hardening **gap in the POSIX branch of `live-evidence-stack.ts`**: its children are spawned without `detached: true` while teardown kills by process group — exactly the pattern that *was* correctly applied to `live-provider-stack.ts`. On Linux/macOS the e2e teardown silently fails, leaking API/web stacks that shadow the fixed ports 3210/3211 for subsequent local runs. The rest are robustness/hardening gaps (missing job timeouts, a shared tmpdir state pointer, contract-test evasions).

## Hard-constraint verification

| # | Constraint | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | CI never invokes live providers | **HOLD** | `ci.yml` sets no credentials and the contract test forbids `secrets.`/`API_FOOTBALL`/`FOOTBALL_DATA` (ci-workflow-contract.test.ts:86-94). All CI-path provider calls are stubs: deterministic factories + stub tokens (live-provider-stack.ts:84-85), stub `fetcher` ApiFootballClient (live-provider-stack.ts:115), in-process fixture routing with fake factories (live-provider-stack.ts:145-149). No dotenv loading anywhere in tests/. |
| 2 | Fail-closed gates not weakened | **HOLD** | Circuit freshness: tests refresh `ProviderCircuitState.updatedAt` to the real clock; `STALE_CIRCUIT_STATE` fail-closed path untouched (deferred-items.md row 2; replay.test.ts:254-258 etc.). Gateway: exit-before-listen assertion retained, only the observation window widened 500 ms→5 s (operator-gateway.test.ts:94-98) — a gateway that listens still fails. RETENTION_DENIED mask untouched (privacy-retention fixes change fixtures only). Replay immutability: drill 3 shows the ForecastSnapshot guard trigger firing in CI (07-03-SUMMARY.md D3). |
| 3 | No `.env` secrets in tests/CI logs | **HOLD** | Workflow contains no `secrets.`; test envs inject only dummy literals (live-provider-stack.ts:14-15). `observe()` redacts database URLs and stub tokens from child output (live-provider-stack.ts:52). Harness passes `process.env` through, but CI's env carries no provider secrets by construction. |
| 4 | ForecastSnapshot append-only | **HOLD** | The only SQL change in this phase is `ReplayPreview.createdAt` now persisted from the injected clock (replay.service.ts:152,171) — `ReplayPreview` is a mutable-by-design preview row (`consumedAt` updates pre-exist); no `ForecastSnapshot` path changed. New `mutation-rejection.test.ts` *strengthens* frozen-table enforcement (UPDATE/DELETE rejected on ValueReceipt, ValueSettlement, ClosingOddsObservation, ForecastMarket, ResultVersion, SourceObservation). |
| 5 | Site remains usable | **HOLD, with caveat** | `NEXT_DIST_DIR` isolation (next.config.ts:10-13, live-evidence-stack.ts:131) protects the dev server's `.next` lock — an improvement for dev-stack safety. E2E stacks use dedicated ports (3210/3211, 3240/3241). Caveat = HIGH-01 below: on POSIX, leaked e2e processes can occupy those ports after a local run. |

## Findings

### HIGH

#### HIGH-01: e2e stack spawns children without `detached` on POSIX, but teardown kills by process group — silent leak of API/web stacks

**File:** `tests/e2e/live-evidence-stack.ts:78-84` (spawn) vs `:91-97` (stopOwned), also `cleanup()` at `:99-105`
**Issue:** `start()` spawns the API and web children with no `detached` flag, so on Linux/macOS they inherit the Playwright process group (their PGID ≠ their PID). `stopOwned()` then calls `process.kill(-pid, "SIGTERM")` — a process-group kill whose group id equals the child's PID. No such group exists → `ESRCH` → swallowed by the bare `catch`. Teardown therefore **never stops the api (`nest dev`) or web (`next dev`) trees on POSIX**; the same broken kill is used in the mid-setup failure path (`cleanup`, line 100-101). On a local Linux/macOS host, every e2e run leaks a live API+web pair still listening on the fixed ports 3210/3211; the next run's `waitFor(LIVE_API_ORIGIN…)`/`waitFor(LIVE_WEB_ORIGIN)` (lines 130, 133) pass against the **stale stack bound to a removed Postgres container**, producing confusing, possibly misleading failures. This directly contradicts the phase's own recorded pattern ("posix -> corepack + process.kill(-pid) with detached spawn … live-provider-stack.ts mirrors live-evidence-stack.ts", 07-03-SUMMARY.md:48) — the mirror runs the other way: `live-provider-stack.ts:86` correctly sets `detached: process.platform !== "win32"`, and its POSIX stop works. In GitHub CI the runner VM reclaims orphans at job end, so the leak is currently invisible in CI — which is likely why it survived the green runs. On the current Windows dev host `taskkill /T /F` masks it entirely.
**Fix:** mirror live-provider-stack.ts — add `detached: process.platform !== "win32"` to the `spawn()` options in `start()`:

```ts
const child = spawn(executable, args, {
  cwd: process.cwd(),
  env: { ...process.env, ...env },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
  detached: process.platform !== "win32",
});
```

and (belt-and-braces) escalate to `SIGKILL` in `stopOwned()` if the group kill does not reap the child within the timeout.

### MEDIUM

#### MEDIUM-01: CI jobs declare no `timeout-minutes` — a hung harness burns the 6-hour default

**File:** `.github/workflows/ci.yml:17,37,54`
**Issue:** All three jobs run with GitHub's 360-minute default. The integration and e2e jobs shell out to Docker pulls, `prisma migrate deploy`, service-readiness loops (up to 60 s each) and `pnpm dev` servers — a stalled `docker pull` or a readiness loop that never resolves hangs the job for six hours per push, and (worse) a hung required check blocks merges while silently consuming runner quota.
**Fix:** add per-job limits, e.g. `timeout-minutes: 20` (quality), `timeout-minutes: 20` (integration), `timeout-minutes: 20` (e2e-portable).

#### MEDIUM-02: Global fixed state-pointer file in shared tmpdir — concurrent runs clobber each other's ownership metadata

**File:** `tests/e2e/live-evidence-stack.ts:15` (`const statePointer = join(tmpdir(), "bet-stats-live-evidence-state-pointer")`), used at `:110`, `:145`, `:152`
**Issue:** The pointer path is a single fixed filename in the OS-wide temp directory. Two overlapping runs (second checkout/worktree, two Playwright invocations, CI-adjacent local run) overwrite it; the later teardown then reads the *other* run's `state.json` and `cleanup()` kills the other run's containers and PIDs (lines 99-105), while its own stack leaks. Even a crashed prior run leaves a stale pointer that the next teardown may partially act on.
**Fix:** scope the pointer per run, e.g. `join(tmpdir(), `bet-stats-live-evidence-state-pointer-${process.pid}`)` (and let `appendLaterCorrection()`/teardown resolve it via the same env/pid), or store the pointer path in a Playwright fixture-shared env var instead of a fixed file.

#### MEDIUM-03: Workflow contract test is evadable by trivial syntax variations

**File:** `tests/unit/ci-workflow-contract.test.ts:83-108`
**Issue:** The security policy is enforced with substring/one-line heuristics: `not.toContain("secrets.")` is bypassed by `secrets['X']` or `secrets` accessed via env indirection from another expression; the interpolation guard `filter((line) => /run:.*\$\{\{/.test(line))` only scans the line containing `run:` — a multi-line `run: |` block with `${{ github.event.issue.title }}` on a continuation line passes clean. The current workflow is genuinely clean, so this is a guard-strength defect, not a present vulnerability — but the test is explicitly billed as "the executable security policy" (line 8), so its evasions matter.
**Fix:** parse the workflow (a ~200-line YAML dep-free scan is enough): flag `${{` on *any* line inside a run block, and match `secrets` with `/\bsecrets[\[.]/`. Keep the current assertions as well.

#### MEDIUM-04: `/health/ready` is a static env-var assertion, and the new e2e harnesses cement it

**File:** `apps/api/src/modules/health/health.controller.ts:25-30` (pre-existing; activated by `tests/e2e/live-evidence-stack.ts:128` and `tests/e2e/live-provider-stack.ts:88`)
**Issue:** `readiness()` reports ready iff `POSTGRES_READY === "true" && REDIS_READY === "true"` — env vars set once at process start. It never touches Postgres/Redis, so it cannot go not-ready when a dependency dies, and the CI e2e stacks now hardcode both to `"true"`. Any future orchestrator (compose healthcheck, k8s readinessProbe) wired to this endpoint would route traffic to a dead-DB instance. Not introduced by this phase and not one of the four named fail-closed gates, but this phase is what first *certifies* the endpoint in CI, so the fake is now load-bearing.
**Fix (follow-up, can be deferred):** make `readiness()` perform a cheap real probe (`SELECT 1` / `PING` with a short timeout) and keep the env vars only as an explicit test override; or document in the controller that the endpoint is diagnostic-only and must not be used as an orchestrator probe.

### LOW

#### LOW-01: Actions pinned to mutable major tags, not immutable SHAs

**File:** `.github/workflows/ci.yml:20-24,42-46,59-63`
**Issue:** `actions/checkout@v6`, `pnpm/action-setup@v6`, `actions/setup-node@v7` are floating majors; a compromised upstream release executes in all three jobs at the next run. The contract test hard-codes these majors (ci-workflow-contract.test.ts:112-116), so the repo's own policy locks in the mutable refs. Read-only token limits blast radius, and this matches the recorded "sanctioned action majors" decision — noted as hardening, not a violation.
**Fix:** pin each `uses:` to a full commit SHA with a `# vX` comment; update the contract test's regex to accept `owner/repo@[a-f0-9]{40}` and keep majors only via Dependabot-managed updates.

#### LOW-02: `tests/`, `scripts/*.mjs`, and root Playwright configs are outside every lint gate

**Files:** no root `eslint.config.mjs`; `tests/unit/lint-coverage.test.ts:21-29` codifies the gap by enumerating workspace packages only
**Issue:** The phase's ESLint extension covers all seven workspace packages, but the CI harnesses themselves — `tests/e2e/live-*.ts`, `tests/integration/*`, `scripts/verify-release-integration.mjs` — contain the most safety-critical new logic and run unlinted. `lint-coverage.test.ts` will not notice this because it never looks above the package roots.
**Fix (follow-up):** add a root `eslint.config.mjs` covering `tests/**` and `scripts/**`, or add a root `lint` script plus an assertion in the meta-test that a fixed set of non-package dirs is linted.

#### LOW-03: Failing e2e CI runs leave no uploaded diagnostics

**File:** `.github/workflows/ci.yml:54-72` (with `playwright.ci.config.ts:15` `trace: "retain-on-failure"`)
**Issue:** Traces and screenshots are retained on the runner but no `actions/upload-artifact` step exists, so a red e2e-portable run on GitHub yields only console output — costly for a stack that boots containers and two dev servers.
**Fix:** add an `if: failure()` artifact-upload step for `test-results/` (pinned major, consistent with LOW-01 direction).

#### LOW-04: `ForecastComparisonService` builds a repository over a `null` client when `DATABASE_URL` is unset

**File:** `apps/api/src/modules/forecasts/forecast-comparison.service.ts:18-21` (pre-existing; file touched in phase)
**Issue:** With no injected repository and no `DATABASE_URL`, `client` is `null` but `createProductionRepository(this.client!)` still runs; the first `compare()`/`availability()` call throws a raw `TypeError` (HTTP 500) instead of a clean configuration error. Pre-existing and only reachable in a misconfigured deployment.
**Fix:** throw an explicit configuration error in the constructor (or lazily in the repository methods) when neither a repository nor `DATABASE_URL` is present.

#### LOW-05: `NODE_ENV: "test"` passed to `next dev` / `nest dev` in the e2e stacks

**File:** `tests/e2e/live-evidence-stack.ts:128,131` (same pattern in live-provider-stack.ts:88,90)
**Issue:** Next.js warns on non-standard `NODE_ENV` for `dev` and forces development semantics; libraries that branch on `NODE_ENV === "production"` may behave subtly differently than the real dev/prod paths the site uses. Tests currently pass, so impact is latent divergence between the certified stack and the real one.
**Fix:** use `NODE_ENV: "development"` for the dev-server children (keep `"test"` only where a test branch is genuinely intended).

#### LOW-06: `stop()` on POSIX sends SIGTERM only, with no escalation

**File:** `tests/e2e/live-provider-stack.ts:51`
**Issue:** After SIGTERM to the group, teardown races 5 s and returns regardless; a child ignoring SIGTERM leaks (then crashes on removed DB/Redis, so impact is transient noise). Minor sibling of HIGH-01, already fixed there in the same commit's design.
**Fix:** follow the 5-second wait with `process.kill(-pid, "SIGKILL")` if the child has not closed.

### NIT

- **NIT-01** `tests/integration/provider-worker-routing.test.ts:35-37` — after the EL removal, the mapped-provider assertions pass `competitionCode: "CL"` against an API-Football mapping for league id 78 (Europa League). Functionally fine (the code only routes by provider), but the fixture is now semantically inconsistent; prefer a CL league mapping or a UEL competition code to keep the test legible.
- **NIT-02** `tests/integration/mutation-rejection.test.ts:117-121` — `persist_settlement_receipt(...)` is invoked with ids string-interpolated into the SQL text while the sibling `persist_value_settlement` call is parameterized. No untrusted input reaches the string (pid-scoped ids), but parameterize for consistency and to keep the file copy-paste safe.
- **NIT-03** `tests/unit/ci-workflow-contract.test.ts:11-12` — the comment "the Windows dev host checks files out as CRLF (core.autocrlf)" is now stale: `.gitattributes` `* text=auto eol=lf` pins LF checkouts everywhere. The normalization itself is harmless defense-in-depth; update the comment.
- **NIT-04** `tests/e2e/live-evidence-stack.ts:25-35` — `unusedPort()` closes the reservation before `docker run` binds it (TOCTOU); a rare local race would fail `docker run` loudly, acceptable, but binding via Docker's ephemeral port (`-p 127.0.0.1::5432` + `docker port`, as live-provider-stack does) removes the window entirely.
- **NIT-05** `.github/workflows/ci.yml:12-14` — `cancel-in-progress: true` also cancels in-flight `main` runs; the newest commit's run still validates tip-of-main, so this is acceptable, but a red run's evidence is lost when superseded. Consider `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` if red-run forensics on main matter.
- **NIT-06** `.github/workflows/ci.yml:66-71` — the e2e job builds workspace dist via turbo (step at line 69) and then rebuilds api/data-sync again inside `live-evidenceStack` globalSetup (`live-evidence-stack.ts:123,126-127`); duplication is safe (turbo cache would make it cheap) but worth knowing when tuning job time.
- **NIT-07** `packages/football-data/src/routing/provider-route.ts:15` — `API_FOOTBALL_ONLY` still contains the now-dead `"EL"` code after the configured-competitions removal (`provider.interface.ts:28`); harmless defense-in-depth, keep or drop with a comment.

## Clean files (reviewed, no findings)

`.npmrc`, `.gitattributes`, `playwright.ci.config.ts` (aside LOW-03/NIT-04 interactions), `apps/api/src/modules/odds/odds.service.ts`, `apps/api/src/modules/reconciliation/reconciliation.controller.ts`, `apps/api/src/modules/reconciliation/reconciliation.service.ts`, `apps/api/src/modules/replay/replay.service.ts` (createdAt fix verified against `consumed_after_created` CHECK semantics — consistent clock domain; RETURNING/projection unaffected), `apps/api/src/modules/value/value.service.ts`, `apps/api/src/modules/media/provider-logo.controller.ts`, `packages/database/src/provider-routing/repository.ts`, `packages/database/src/reconciliation/provider-fixture-resolver.ts`, `packages/domain/src/replay-provider-policy.ts`, `packages/domain/src/value/decision.ts`, `packages/football-data/src/provider.interface.ts`, `workers/data-sync/src/ingestion/provider-route-runtime.ts` (type-only hardening; `classifyFailure` rewrite is behavior-preserving), `workers/data-sync/src/jobs/fixtures.ts`, `workers/data-sync/src/jobs/results.ts`, `workers/data-sync/src/jobs/standings.ts`, `workers/data-sync/src/queues/index.ts`, `workers/data-sync/src/replay/service.ts`, `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx`, `apps/web/app/internal/operations/page.tsx`, `apps/web/app/privacy/page.tsx`, `apps/web/components/date-range-filter.tsx`, `apps/web/components/quota-counter.tsx`, `apps/web/components/release-navigation.tsx`, `apps/web/next.config.ts`, `scripts/seed-configured-leagues.mjs`, `tests/e2e/live-provider-stack.ts` (aside LOW-06), `tests/integration/privacy-retention.test.ts` (real-clock anchoring is the correct fix; mask intact), `tests/integration/replay.test.ts` (circuit refresh preserves freshness gate), `tests/integration/operator-gateway.test.ts` (assertion semantics intact), `tests/integration/evidence-browser-contract.test.ts`, `tests/integration/evidence-publication.test.ts`, `tests/unit/coverage-contract.test.ts`, `tests/unit/lint-coverage.test.ts`, `tests/unit/provider-contract.test.ts`.

---

_Reviewed: 2026-10-21T21:40:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
