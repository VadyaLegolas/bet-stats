---
task: isolate-gate-builds-from-dev
created: "2026-10-25"
status: planned
---

# Isolate gate builds from the running dev server

## Problem (incident 2026-10-24/25)

The live site broke: every `/internal-api/*` route answered the HTML not-found page
(quota header showed «Лимиты обновления: недоступно», the sync button showed
«Синхронизация недоступна: нет учётных данных оператора» — both are just the UI's
mapping of HTTP 404).

Root cause: a wave-gate `pnpm build` ran **while the dev stack was up**. The root
`build` script is bare `turbo run build`, so `next build` wrote production artifacts
(`BUILD_ID`, `server/app-paths-manifest.json`, 2026-10-24 20:36) into the shared
`apps/web/.next` and disrupted the running `next dev` (Next 16 keeps an exclusive
`<distDir>/dev/lock`; the log also shows `pnpm run dev exited (1073807364)` and
`The destination stream closed early`). Recovery required a full stack restart via
`scripts\app-lifecycle.ps1` plus wiping `apps/web/.next`.

The repo already has the isolation convention — `apps/web/next.config.ts` reads
`NEXT_DIST_DIR` (phase 07, `58aa7c2`; E2E stacks use `.next-e2e`) — but it only
works when the caller remembers to set the variable. One executor battery forgot,
and the site went down.

## Change

Make the root `pnpm build` path safe **by construction**:

1. `scripts/build.mjs` (new): wrapper around `turbo run build`.
   - If `NEXT_DIST_DIR` is already set in the environment → pass through untouched.
   - Else if `apps/web/.next/dev/lock` exists (dev server holds or held it) → set
     `NEXT_DIST_DIR=.next-gate` for the child so the build cannot touch `.next`,
     and print one stderr line.
   - Else → plain default behaviour (CI, fresh clone, launcher start while stopped).
   - Export the pure decision function for unit testing; run `main()` only when
     executed as a script.
   - Fail-safe direction: lock **existence** (not readability) triggers isolation —
     a stale lock merely redirects output, while a missed live lock breaks the site.
2. Root `package.json`: `"build": "node scripts/build.mjs"`.
3. `turbo.json`: declare `"env": ["NEXT_DIST_DIR"]` on `build` (and `dev`) so the
   redirected runs hash and cache under their own key, and add `".next-gate/**"`
   to `build.outputs`.
4. `.gitignore`: add `.next-gate/`.
5. `tests/unit/build-distdir-guard.test.ts`: unit tests for the decision function
   (env set → passthrough; lock present → `.next-gate`; neither → default).

## Why not only documentation

The failure was an LLM operator (executor prompt) forgetting one env var. Gates for
phases 09..16 will keep running `pnpm build`; the guard must not depend on memory.

## Acceptance / verification (all run with the dev stack UP)

- `pnpm build` (no env) succeeds, prints the isolation notice, creates
  `apps/web/.next-gate/`, and **does not modify** `apps/web/.next/BUILD_ID` mtime.
- Immediately after that build: `GET http://127.0.0.1:3000/internal-api/fixtures/quota`
  still answers `200 application/json` (the exact probe that caught the incident).
- `pnpm test`, `pnpm typecheck`, `pnpm lint` green (known pre-existing local-only
  failure `tests/unit/fixtures-sync.test.ts` tolerated in `pnpm test`).
- No changes to `.github/workflows/ci.yml` behaviour: CI never sets a dev lock and
  calls `pnpm exec turbo run build --filter=...` for non-web packages anyway.

## Out of scope

- Restarting or reconfiguring the user's dev stack (launcher-owned).
- The secret `.env` (never read).
