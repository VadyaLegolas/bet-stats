---
phase: quick
plan: 261107-fen
quick_id: 261107-fen
title: "Return navigation from the operator gateway (:8080) to the app origin (:3000)"
status: complete
created: "2026-11-07"
tags: [operator-gateway, next-16, navigation, headers, integration-tests]
dependency_graph:
  requires: [3e6be9f — one-time token gateway entry with session cookie]
  provides: [gateway-origin stamping, homeOrigin nav plumbing, gateway bounce component]
  affects: [infra/operator-gateway, apps/web root layout/navigation, tests/integration]
tech_stack:
  added: []
  patterns: [async headers() in Next 16 root layout, loopback-allowlisted origin stamp, client bounce via location.replace]
key_files:
  created:
    - apps/web/components/gateway-home-redirect.tsx
  modified:
    - infra/operator-gateway/server.mjs
    - tests/integration/operator-gateway.test.ts
    - apps/web/app/layout.tsx
    - apps/web/components/release-navigation.tsx
decisions:
  - "x-operator-gateway-origin joins the operatorHeaders Set, so client spoofs are stripped on both the HTTP and the WebSocket upgrade path from one edit"
  - "homeOrigin is stamped only for loopback WEB_ORIGIN hostnames {127.0.0.1, localhost, ::1, [::1]}; docker's http://web:3000 yields null and nothing downstream stamps"
  - "Integration Test B substitutes http://127.0.0.2:<port> for the locked example http://web:3000 (unresolvable hostname; same non-loopback gate branch)"
metrics:
  duration: ~12min
  completed: "2026-11-07"
  tasks: 2
  files: 5
---

# Quick 261107-fen Summary: Return navigation from the operator gateway to the app origin

The operator gateway now stamps proxied requests with a browser-reachable `x-operator-gateway-origin` (loopback WEB_ORIGIN only, client spoofs stripped on both proxy paths), and the Next root layout feeds that value to the brand link, the release navigation and a new bounce component — so any public page opened through :8080 sends the browser back to :3000 (path/query/hash preserved) and «Обновить матчи» never posts through the gateway's 10-second 504 again, while `/internal` pages stay on :8080.

## Files changed

| File | Change |
|------|--------|
| `infra/operator-gateway/server.mjs` | `x-operator-gateway-origin` added to `operatorHeaders` Set (stripped on HTTP + upgrade paths); `requiredConfig` computes loopback-gated `homeOrigin`; HTTP handler stamps it after `forwardHeaders` |
| `tests/integration/operator-gateway.test.ts` | 2 new tests appended to the HTTP-boundary describe: loopback stamp replaces a client spoof; no stamp for a non-allowlisted WEB_ORIGIN |
| `apps/web/app/layout.tsx` | Async root layout reads `(await headers()).get("x-operator-gateway-origin")`; brand link, `<ReleaseNavigation homeOrigin>` and `<GatewayHomeRedirect>` consume it |
| `apps/web/components/release-navigation.tsx` | Optional `homeOrigin?: string | null` prop; middle ternary arm renders absolute `<a>` anchors when set — null keeps today's `<Link>` markup byte-identical; «Операции» stays relative |
| `apps/web/components/gateway-home-redirect.tsx` | **New** `"use client"` bounce: no-ops when `homeOrigin` is null/same-origin or pathname starts with `/internal`, otherwise `window.location.replace(homeOrigin + pathname + search + hash)` |

## Verification results (exact command outputs)

Run from repo root `D:/Documents/Atom/bet-stats`:

1. `node --check infra/operator-gateway/server.mjs` → **exit 0** (parses).
2. `corepack pnpm exec vitest run tests/integration/operator-gateway.test.ts` → **19 passed (19)**, 1 file, 18.77s, **exit 0** (baseline was 17/17).
3. `corepack pnpm --filter @bet-stats/web typecheck` → **exit 0**.
4. `corepack pnpm --filter @bet-stats/web lint` → **exit 0** — `✖ 9 problems (0 errors, 9 warnings)`, exactly the 9 pre-existing warnings (no new errors; warned files untouched).

Not run (per plan): e2e suites, full `pnpm test`, `next build`, ROADMAP update. No commits created, no files staged — the orchestrator handles commits.

## Pre-change baselines (measured at planning time)

- Integration gateway tests: **17/17 passed** (18.4s) → now **19/19**.
- Web typecheck: **exit 0** → still 0.
- Web lint: **exit 0, 0 errors, 9 pre-existing warnings** → identical after changes.

## `127.0.0.2` substitution rationale (non-allowlisted-origin test)

Integration Test B («omits the gateway-origin stamp when WEB_ORIGIN is outside the loopback allowlist») uses `WEB_ORIGIN=http://127.0.0.2:<port>` instead of the plan's locked example `http://web:3000` because **the hostname `web` does not resolve in the test environment** — a gateway started with `http://web:3000` could never reach a live upstream, so the stamp's *absence* would be unobservable (nothing arrives upstream to inspect). `http://127.0.0.2:<port>` is an absolute origin outside the loopback allowlist `{127.0.0.1, localhost, ::1, [::1]}` that still routes back to this machine (the upstream binds `0.0.0.0`, verified by a reachability probe at planning). Both origins exercise the **identical non-loopback gate branch** in `requiredConfig` (`hostname` not in the allowlist → `homeOrigin = null` → no stamp), and the test's HTTP 200 assertion proves the request genuinely reached the upstream — making the header's absence meaningful. The rationale is also recorded as an English comment inside the test itself.

## Gateway restart requirement

`infra/operator-gateway/server.mjs` runs as a plain Node process spawned by `scripts/app-lifecycle.ps1` — **no file watcher exists**, so the gateway changes take effect only after that process restarts. Restarting the stack is an orchestrator/user action (operating rule: never kill the user's dev servers). `next dev` picks up the layout/component edits via HMR.

## Deviations from Plan

None — the plan's locked approach was executed exactly as written (the `127.0.0.2` substitution was the plan's own recorded discretion, not an execution-time deviation).

## Threat Flags

None — all security-relevant surface (gateway origin stamp, spoof strip, loopback allowlist, bounce guard) is in the plan's threat model with `mitigate` dispositions; mitigations implemented and covered by the two new integration tests.

## Known Stubs

None.

## Self-Check: PASSED

- Files exist: `infra/operator-gateway/server.mjs`, `tests/integration/operator-gateway.test.ts`, `apps/web/app/layout.tsx`, `apps/web/components/release-navigation.tsx`, `apps/web/components/gateway-home-redirect.tsx` — all FOUND.
- Commits: none created by design (orchestrator commits); HEAD verified unchanged at `3e6be9f`.
