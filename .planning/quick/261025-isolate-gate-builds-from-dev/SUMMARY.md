---
phase: quick-261025-isolate-gate-builds-from-dev
plan: 1
subsystem: build
tags: [build, turbo, nextjs, dist-dir, dev-server, guard, incident-prevention, lint]

# Dependency graph
requires:
  - phase: 07 (NEXT_DIST_DIR convention)
    provides: "apps/web/next.config.ts honors process.env.NEXT_DIST_DIR (58aa7c2) — the isolation hook this wrapper drives"
provides:
  - "scripts/build.mjs — root `pnpm build` wrapper that redirects production output to apps/web/.next-gate/ whenever the dev lock apps/web/.next/dev/lock exists, so a gate build can never rewrite the running dev server's .next (incident 2026-10-24 root cause)"
  - "Pure exported resolveNextDistDir({ envValue, devLockExists }) decision function, covered by tests/unit/build-distdir-guard.test.ts (7 tests)"
  - "turbo.json NEXT_DIST_DIR env declaration on build+dev (strict env pass-through + distinct cache keys) and .next-gate/** as a declared build output"
affects: [build, ci, web, lint, local-dev]

# Actuals (#2632) — chars/4 over the realized diff of the 3 work commits + this docs commit.
actuals:
  tokens: 5848
  tasks: 5
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Guard-by-construction build wrapper: root package.json `build` runs node scripts/build.mjs instead of bare `turbo run build`; lock EXISTENCE (never readability) triggers isolation — a stale lock only redirects output, a missed live lock breaks the site"
    - "Child spawn via process.execPath + process.env.npm_execpath with ['exec','turbo','run','build'] (the proven verify-release-integration.mjs / verify:release:schema pattern), stdio inherit, exit with the child's status; node_modules/.bin/turbo.CMD + shell:true fallback when npm_execpath is absent"
    - "main() guarded by `process.argv[1] === fileURLToPath(import.meta.url)` so importing the module in tests never spawns"

key-files:
  created:
    - scripts/build.mjs
    - tests/unit/build-distdir-guard.test.ts
  modified:
    - package.json
    - turbo.json
    - .gitignore
    - apps/web/eslint.config.mjs

key-decisions:
  - "Lock EXISTENCE triggers isolation, not readability (plan's fail-safe direction): a stale lock merely redirects output to .next-gate, while a missed live lock lets `next build` rewrite apps/web/.next and kill the running dev server — the failure mode is bounded in the safe direction only."
  - "Spawn fallback picked: node_modules/.bin/turbo(.CMD) with shell:true on win32 / direct shim on POSIX, else a clear BUILD_TURBO_UNAVAILABLE error naming both remedies (`pnpm build` / `pnpm install`) — chosen over erroring out immediately so a bare `node scripts/build.mjs` still works on this host."
  - "Caller-set NEXT_DIST_DIR passes through untouched and prints nothing — E2E/release flows that deliberately target .next-e2e keep their exact behaviour and output."
  - "turbo.json env declaration added to `dev` too (cache:false) so pass-through stays honest under turbo's strict env mode, matching the plan."

patterns-established:
  - "Any new Next dist-dir variant must be ignored in three places: .gitignore (repo), apps/web/eslint.config.mjs globalIgnores (lint), turbo.json build outputs (cache) — missing the lint one produced 461 generated-file errors on the first guarded build (deviation 1)."

requirements-completed: []

# Metrics
duration: "~26m (2026-10-25T01:04Z-01:30Z, UTC+1)"
completed: 2026-10-25
status: complete
---

# Phase quick-261025: Isolate gate builds from the running dev server Summary

**Root `pnpm build` is now safe by construction: a new scripts/build.mjs wrapper detects the dev server's `apps/web/.next/dev/lock` and redirects production output to `apps/web/.next-gate/` (caller-set `NEXT_DIST_DIR` still passes through), verified end-to-end with the live stack up — the guarded build printed the isolation notice, `apps/web/.next/BUILD_ID` mtime stayed byte-identical, and the incident probe `/internal-api/fixtures/quota` kept answering 200 application/json.**

## Performance

- **Started:** 2026-10-25T01:04Z
- **Completed:** 2026-10-25T01:30Z
- **Tasks:** 5 (plan items 1-5)
- **Files changed:** 6 committed (2 created, 4 modified); dev stack untouched (no restart, no port binding, secret `.env` never read)

## Completion table — plan asked vs shipped

| # | PLAN.md asked | Shipped | Status |
|---|---------------|---------|--------|
| 1 | NEW `scripts/build.mjs`: ESM wrapper around `turbo run build`, pure exported `resolveNextDistDir({ envValue, devLockExists })` (env passthrough → `.next-gate` on lock → undefined), lock existence resolved from repo root via `import.meta.url` (never cwd), one stderr notice when redirecting, spawn via `process.execPath` + `npm_execpath` with `["exec","turbo","run","build"]`, exit with child status, import guard | Exactly that; fallback for missing `npm_execpath` implemented as `node_modules/.bin/turbo.CMD` + `shell:true` on win32 (direct shim on POSIX), clear `BUILD_TURBO_UNAVAILABLE` error otherwise; fail-safe rationale documented in a comment | ✅ |
| 2 | Root `package.json`: `"build": "node scripts/build.mjs"` (only that line) | Applied — only line 12 changed | ✅ |
| 3 | `turbo.json`: `"env": ["NEXT_DIST_DIR"]` on `build`, `.next-gate/**` in `build.outputs`, `"env": ["NEXT_DIST_DIR"]` on `dev`, keep formatting | Applied, style preserved | ✅ |
| 4 | `.gitignore`: `.next-gate/` next to `.next-e2e/` | Added on line 20 directly under `.next-e2e/` | ✅ |
| 5 | NEW `tests/unit/build-distdir-guard.test.ts` (vitest unit project): env passthrough, lock→`.next-gate`, neither→undefined, empty-string env unset, plus a cheap structural check of the wrapper | 4 decision tests + 3 structural tests (import guard, repo-root lock path, pnpm-exec spawn + notice line) = 7 tests, all green | ✅ |
| — | CI behaviour unchanged | CI never creates a dev lock → wrapper takes the plain-default branch; `.github/workflows/ci.yml` untouched | ✅ |

## Acceptance battery (real output, run in the prescribed order, dev stack UP throughout)

**(a) BUILD_ID mtime BEFORE the gate run**

```
BEFORE_UTC=2026-10-25T00:45:47.0878919Z
NEXT_DIST_DIR env=[]
LOCK_EXISTS=True
```

**(b) `pnpm build` (no env var — exercises the new guard)**

```
[build] dev lock detected -> NEXT_DIST_DIR=.next-gate      (stderr, from scripts/build.mjs)
@bet-stats/web:build: └ ƒ /scorecards
...
 Tasks:    7 successful, 7 total
Cached:    0 cached, 7 total
  Time:    32.926s
BUILD_EXIT=0
```

**(c) Isolation confirmed**

```
AFTER_UTC=2026-10-25T00:45:47.0878919Z          <- identical to (a): .next untouched
GATE_DIR_EXISTS=True
GATE_BUILD_ID_UTC=2026-10-25T01:12:25.6015646Z <- production build landed in .next-gate
git check-ignore -v apps/web/.next-gate/BUILD_ID
.gitignore:20:.next-gate/  apps/web/.next-gate/BUILD_ID
```

**(d) Site health probe — the exact probe that caught the incident, AFTER the build**

```
STATUS=200
CONTENT_TYPE=application/json; charset=utf-8
BODY_HEAD={"provider":"football-data.org","daily":{"used":20,"allowance":100,"remaining":80,...}}
```

Re-probed again after the whole battery: `FINAL_PROBE_STATUS=200`, `FINAL_PROBE_TYPE=application/json; charset=utf-8`, `BUILD_ID_STILL=2026-10-25T00:45:47.0878919Z`. HTML/404 never observed — the guard held.

**(e) `pnpm test`**

```
 Test Files  2 failed | 45 passed (47)
      Tests  9 failed | 431 passed (440)
TEST_EXIT=1
```

- `tests/unit/fixtures-sync.test.ts` — **7 failed, the KNOWN tolerated local-only failure** (real-DB auth: `Authentication failed ... credentials for user are not valid`; green in CI).
- `tests/unit/backup-job.test.ts` — **2 failed, NOT caused by this task** (pre-existing uncommitted WIP from the parallel 08-review session; full diagnosis under Deviations → deferred).
- The new `build-distdir-guard.test.ts`: **7/7 passed** inside that run (and re-run standalone at the final tree: `Test Files 1 passed (1), Tests 7 passed (7)`, exit 0).
- `pnpm test` chains with `&&`, so the unit failures short-circuited the web suite; it was then run explicitly: `pnpm --filter @bet-stats/web test` → **9 files / 82 tests passed, WEB_EXIT=0**.

**(f) `pnpm typecheck`** — `Tasks: 7 successful, 7 total`, `TYPECHECK_EXIT=0`.

**(g) `pnpm lint`** — first run **failed** with 461 errors caused by my own change (`.next-gate` output linted as source — deviation 1 below); after the fix: `✖ 8 problems (0 errors, 8 warnings)`, `Tasks: 7 successful, 7 total`, `LINT_EXIT=0` (the 8 warnings are pre-existing).

## Task commits

| # | Commit | Message |
|---|--------|---------|
| 1 | `fc7d13a` | `test(build): cover gate build dist-dir guard decisions` |
| 2 | `e30ad9c` | `fix(build): route builds away from the running dev dist dir` |
| 3 | `72b0f91` | `chore(build): ignore generated .next-gate and .next-e2e output in web lint` |
| 4 | (this docs commit) | `docs(quick-261025-isolate-gate-builds-from-dev): gate build isolation task artifacts` |

Test-before-fix ordering per instructions; zero tracked-file deletions across all commits (`git show --diff-filter=D` empty).

## Files Created/Modified

- `scripts/build.mjs` — New ESM wrapper: `resolveNextDistDir` (pure, exported), repo-root lock probe (`existsSync(resolve(repoRoot, "apps/web/.next/dev/lock"))`), stderr notice on redirect, pnpm-exec spawn with `.bin/turbo` fallback, import guard.
- `tests/unit/build-distdir-guard.test.ts` — 7 vitest unit tests (decision table + wrapper structure, CRLF-normalized source checks).
- `package.json` — `"build": "node scripts/build.mjs"` (single line).
- `turbo.json` — `env: ["NEXT_DIST_DIR"]` on `build` and `dev`; `.next-gate/**` in `build.outputs`.
- `.gitignore` — `.next-gate/`.
- `apps/web/eslint.config.mjs` — `.next-gate/**` and `.next-e2e/**` added to `globalIgnores` (deviation 1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] First guarded build broke `pnpm lint`: generated `.next-gate/**` was linted as source (461 errors)**
- **Found during:** acceptance step (g), right after the successful gate build.
- **Issue:** `apps/web/eslint.config.mjs` ignored only `.next/**`; the new `.next-gate/` directory full of minified build output matched `eslint .`'s default file patterns, so lint failed with 461 errors/5370 warnings.
- **Fix:** added `.next-gate/**` to the existing `globalIgnores([...])` array (and `.next-e2e/**`, the identical latent gap for the sibling dir the plan itself names — same class, same one-token line).
- **Files modified:** apps/web/eslint.config.mjs
- **Commit:** `72b0f91` — re-run: `0 errors, 8 pre-existing warnings`, exit 0.

**2. [Rule 1 - Side effect] The gated build rewrote tracked `apps/web/next-env.d.ts` to reference `./.next-gate/types/...`**
- **Found during:** post-build `git status`.
- **Issue:** `next build` regenerates `next-env.d.ts` against its dist dir; the file was clean before this session and my build dirtied it.
- **Fix:** targeted restore `git checkout -- apps/web/next-env.d.ts` (single named file, repo precedent quick-261017-r3d); never staged (it is on the do-not-commit list).
- **Verification:** `git status --porcelain apps/web/next-env.d.ts` empty afterwards.

### Deviations (planned-but-changed, no fix needed)

**3. Battery step (e) could not be "sole failing file" clean — second pre-existing failure, out of this task's scope (NOT fixed, reported)**
- **Observed:** `pnpm test` also fails 2 tests in `tests/unit/backup-job.test.ts` (`invokes robocopy with bounded-retry flags...` and `keeps the robocopy log a per-run file... (IN-02)`): `expected '/LOG+:...' to match /^\/LOG:/`.
- **Diagnosis (why it is not this task's):** both `tests/unit/backup-job.test.ts` and `workers/data-sync/src/jobs/backup.ts` were **already modified before this session started** (mtimes `2026-10-24T10:35Z` / `2026-10-24T10:38Z`, ~15h before this task's first file at `2026-10-25T01:10Z`) — they are the parallel 08-review session's **uncommitted, mid-TDD red state**: the uncommitted test update expects `/LOG:` (IN-02) while the uncommitted code still emits `/LOG+`. The committed HEAD state is self-consistent (`git show HEAD:` both expect and emit `/LOG+:`), and this task's commits touch only `scripts/build.mjs`, `tests/unit/build-distdir-guard.test.ts`, `package.json`, `turbo.json`, `.gitignore`, `apps/web/eslint.config.mjs` — none imported by the backup job. Fixing it would mean finishing another session's in-flight review slice (its WR-03 code half sits uncommitted in the same file), so per the executor scope boundary it is deferred, not hijacked.
- **Action for orchestrator:** if a green `pnpm test` gate is required, the one-line completion of the other session's IN-02 is `copyOffsite`'s `` `/LOG+:${join(...)}` `` → `/LOG:` in `workers/data-sync/src/jobs/backup.ts` — owned by the 08-review session, not this task.

**4. Battery step (e) executed as `pnpm test` + an explicit web-suite run**
- `pnpm test` is `vitest run --project unit && pnpm --filter @bet-stats/web test`; with any unit failure the `&&` short-circuits and the web suite never starts. Both parts were therefore run and are reported above (unit 431/440, web 82/82).

**Total deviations:** 4 (2 auto-fixed, 2 procedural); zero production-behavior deviation from the plan — items 1-5 of the design shipped as specified.

## Deferred Issues

| Item | Owner | Evidence |
|------|-------|----------|
| `tests/unit/backup-job.test.ts` 2 reds (IN-02 `/LOG:` vs `/LOG+`) from uncommitted 08-review WIP | parallel 08-review session | WIP mtimes 2026-10-24T10:35/10:38Z; HEAD self-consistent; causal isolation from this task's files |

## Known Stubs

None — no placeholder values, TODOs, or unwired data sources were introduced.

## Threat Flags

None — no new endpoints, auth paths, or schema changes; the wrapper only sets an env var for an existing build task.

## Self-Check: PASSED

- `scripts/build.mjs` FOUND, `tests/unit/build-distdir-guard.test.ts` FOUND, `package.json`/`turbo.json`/`.gitignore`/`apps/web/eslint.config.mjs` edits verified by re-read.
- Commits `fc7d13a`, `e30ad9c`, `72b0f91` all ancestors of HEAD (`git merge-base --is-ancestor` ok).
- Battery: build exit 0 with isolation notice, BUILD_ID mtime unchanged (`2026-10-25T00:45:47.0878919Z` before/after), `.next-gate/BUILD_ID` created, quota probe 200 application/json after the build and after the whole battery, typecheck exit 0, lint exit 0, new unit tests 7/7, web suite 82/82.
- Known tolerated failure (`fixtures-sync.test.ts`, 7) present as specified; the second failing file is proven pre-existing and out of scope (deviation 3).
