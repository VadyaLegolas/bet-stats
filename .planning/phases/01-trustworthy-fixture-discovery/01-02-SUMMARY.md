---
phase: 01-trustworthy-fixture-discovery
plan: 02
subsystem: web-api
tags: [nextjs, react, nestjs, typescript, pnpm]
requires:
  - phase: 01-01
    provides: Pinned pnpm/Turborepo workspace and strict TypeScript base
provides:
  - Compile-safe Next.js public process with neutral semantic shell
  - Safe NestJS bootstrap with bounded request and correlation defaults
  - Compile-safe football-data workspace package
affects: [fixture-tracer, web, api, football-data]
actuals:
  tokens: 1800
  tasks: 3
  commits: 3
tech-stack:
  added: [next-16.3.3, react-19.2.8, nestjs-11.1.29]
  patterns: [semantic-public-shell, safe-bootstrap-errors, bounded-correlation-id]
key-files:
  created: [apps/web/package.json, apps/web/tsconfig.json, apps/web/next.config.ts, apps/web/app/layout.tsx, apps/web/app/page.tsx, apps/api/package.json, apps/api/tsconfig.json, apps/api/src/main.ts, packages/football-data/package.json, packages/football-data/src/index.ts, pnpm-lock.yaml, .gitignore]
  modified: []
key-decisions:
  - "Keep the Phase 1 home page limited to neutral fixture discovery and the persistent responsible-use disclosure."
  - "Return only a generic API bootstrap failure while validating bounded non-secret configuration before listen."
patterns-established:
  - "Public process packages use exact dependency versions and strict independent typecheck scripts."
  - "API request correlation accepts a bounded caller ID or generates a UUID without logging request secrets."
requirements-completed: [FOUND-01, FOUND-03]
coverage:
  - id: D1
    description: "Next.js renders a semantic neutral public shell without deferred analytics or wagering controls."
    requirement: FOUND-01
    verification:
      - kind: other
        ref: "pnpm --filter @bet-stats/web typecheck"
        status: pass
      - kind: other
        ref: "deferred UI copy scan"
        status: pass
    human_judgment: false
  - id: D2
    description: "NestJS bootstrap compiles with bounded body parsing, port validation, correlation metadata, and generic startup errors."
    requirement: FOUND-03
    verification:
      - kind: other
        ref: "pnpm --filter @bet-stats/api typecheck"
        status: pass
    human_judgment: false
  - id: D3
    description: "The football-data workspace package is traversable without implementing external provider calls."
    requirement: FOUND-01
    verification:
      - kind: other
        ref: "pnpm --filter @bet-stats/football-data typecheck"
        status: pass
    human_judgment: false
duration: 9min
completed: 2026-08-28
status: complete
---

# Phase 01 Plan 02: Web and API Process Scaffold Summary

**Strict Next.js 16 public shell, safe NestJS 11 bootstrap, and compile-ready football-data workspace package**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-28T03:13:00Z
- **Completed:** 2026-08-28T03:22:00Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Added a semantic public fixture-discovery shell with the persistent responsible-use disclosure and no deferred feature controls.
- Added a strict NestJS bootstrap with bounded JSON requests, validated port configuration, correlation IDs, shutdown hooks, and non-secret startup errors.
- Added the football-data package entrypoint and a frozen pnpm dependency graph.

## Task Commits

1. **Task 1: Scaffold the Next.js public process** — `635f5a7` (feat)
2. **Task 2: Scaffold the NestJS API process** — `1047d33` (feat)
3. **Task 3: Declare the provider workspace package** — `c1cb35c` (chore)

## Files Created/Modified

- `apps/web/` — Next.js configuration, package metadata, semantic layout, and neutral home page.
- `apps/api/` — NestJS package, compiler configuration, and safe bootstrap.
- `packages/football-data/package.json` — provider workspace manifest.
- `packages/football-data/src/index.ts` — empty ESM public boundary for later provider contracts.
- `pnpm-lock.yaml` — frozen exact dependency graph.
- `.gitignore` — excludes dependencies, outputs, reports, logs, and populated environment files.

## Decisions Made

- Selected exact compatible patch versions within the researched Next.js/React/NestJS lines.
- Used `NestExpressApplication` explicitly because body-parser limits are adapter-specific.

## Deviations from Plan

### Auto-fixed Issues

**1. Missing repository ignore contract**
- **Found during:** Task 1
- **Issue:** Dependency installation exposed unignored `node_modules`, build outputs, and local environment files.
- **Fix:** Added `.gitignore` with narrowly scoped dependency/output/secret patterns.
- **Verification:** Git status no longer lists generated dependency or build directories.
- **Committed in:** `635f5a7`

**2. Missing provider module entrypoint**
- **Found during:** Task 3
- **Issue:** An empty `src/**/*.ts` include makes TypeScript fail with TS18003 and the manifest already exports `dist/index.js`.
- **Fix:** Added an empty ESM `src/index.ts` boundary without provider behavior.
- **Verification:** Focused provider typecheck passes.
- **Committed in:** `c1cb35c`

## Issues Encountered

- The host remains on Node 25.2.1; pnpm correctly warns because the workspace requires Node 24 LTS. Typechecks pass, but runtime verification must use Node 24.
- The first non-interactive frozen install attempted a modules purge and stopped for lack of TTY. A fresh `--frozen-lockfile --lockfile-only --offline` check passed.

## User Setup Required

Select Node 24 LTS before running development processes.

## Next Phase Readiness

Web, API, and provider packages compile independently and are ready for Plan 01-03 worker/config/test harness scaffolding.

## Self-Check: PASSED

- All three focused typechecks pass.
- Frozen offline lockfile validation passes.
- Deferred UI copy scan passes.
- All three task commits are present.

---
*Phase: 01-trustworthy-fixture-discovery*
*Completed: 2026-08-28*
