---
phase: quick-261107-fen
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - infra/operator-gateway/server.mjs
  - tests/integration/operator-gateway.test.ts
  - apps/web/app/layout.tsx
  - apps/web/components/release-navigation.tsx
  - apps/web/components/gateway-home-redirect.tsx
autonomous: true
quick_id: 261107-fen
created: "2026-11-07"
must_haves:
  truths:
    - "Opening any public page (e.g. /fixtures) through the operator gateway on :8080 sends the browser back to http://127.0.0.1:3000 with path, query and hash preserved, so «Обновить матчи» posts /internal-api/fixtures/sync directly to :3000 and the gateway's 10-second 504 «Не удалось запустить обновление.» no longer appears."
    - "Pages under /internal reached through the gateway (the «Центр операций» dashboard) stay on :8080 — the bounce never fires there, so the operator session keeps working behind the gateway."
    - "On direct :3000 (no gateway header) the brand link and nav menu render exactly today's next/link markup — the release-accessibility e2e assertions (nav «Основная навигация», «Матчи» with aria-current=\"page\") remain valid without touching that file."
    - "Through the gateway, the brand link and the five internal destinations («Матчи», «Анализ», «Результаты», «Методология», «FAQ») become absolute http://127.0.0.1:3000/... anchors while «Операции» stays relative, so the gateway entry route works from either origin."
    - "The gateway stamps x-operator-gateway-origin only with its own loopback WEB_ORIGIN: a client-supplied value is replaced on the HTTP path and dropped on the upgrade path, and a WEB_ORIGIN outside the loopback allowlist (docker's http://web:3000) yields no stamp at all — proven by the two new integration tests (19/19 green)."
    - "The root layout is an async server component that reads the header via Next 16's async headers() and passes a single homeOrigin prop to brand, navigation and the bounce component, so server render and hydration emit identical hrefs (no window access during render)."
  artifacts:
    - infra/operator-gateway/server.mjs (x-operator-gateway-origin in operatorHeaders, homeOrigin in requiredConfig, stamp in the HTTP handler)
    - apps/web/app/layout.tsx (async RootLayout reading x-operator-gateway-origin)
    - apps/web/components/release-navigation.tsx (optional homeOrigin prop with absolute-anchor arm)
    - apps/web/components/gateway-home-redirect.tsx (new client bounce component)
    - tests/integration/operator-gateway.test.ts (loopback-stamp test + non-allowlisted-origin test)
  key_links:
    - proxied request -> forwardHeaders strips client x-operator-gateway-origin -> handler stamps config.homeOrigin -> Next headers() in the root layout -> homeOrigin prop -> brand Link, ReleaseNavigation anchors, GatewayHomeRedirect
    - requiredConfig loopback allowlist {127.0.0.1, localhost, ::1, [::1]} -> the only origin value the browser can ever receive from the gateway (no docker-internal host reaches nav or redirect)
    - GatewayHomeRedirect pathname guard (/internal) -> operations dashboard stays on :8080 while every other gateway-served page bounces to :3000
    - homeOrigin null on direct :3000 -> byte-identical Link rendering -> release-accessibility e2e keeps passing
---

<objective>
Make navigation from the operator gateway (:8080) return to the app origin (:3000): the gateway stamps proxied requests with the browser-reachable web origin, the Next root layout reads that header and feeds the brand link, the nav menu and a new bounce component from it, and non-internal gateway pages immediately return the browser to :3000 so «Обновить матчи» never posts through the gateway's 10-second upstream timeout again.
Purpose: direct :3000 usage and gateway usage converge on one working origin — the operations dashboard keeps living on :8080 while public pages stop rendering a broken app behind the proxy.
Output: gateway origin stamp + spoof strip, async root layout with homeOrigin plumbing, homeOrigin-aware release navigation, new gateway-home-redirect component, two new integration tests (19 total), green web typecheck/lint gates.
</objective>

<execution_context>
@C:/Users/Vlad/.config/opencode/gsd-core/workflows/execute-plan.md
@C:/Users/Vlad/.config/opencode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md
@apps/web/AGENTS.md
@infra/operator-gateway/server.mjs
@apps/web/app/layout.tsx
@apps/web/components/release-navigation.tsx
@tests/integration/operator-gateway.test.ts
@apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/headers.md

Verified facts (planning-time reads and probes — use as given, do not re-investigate):

1. Git: HEAD is 3e6be9f (the gateway entry feature). All five files this plan touches are clean. The dirty set — `apps/web/app/faq/page.tsx`, `apps/web/app/globals.css`, `apps/web/components/provider-state-notice.tsx`, `scripts/capture-faq-screenshots.mjs`, `tests/e2e/release-accessibility.spec.ts`, `.gsd/dispatch-isolation-sentinel.json` — is OUT OF SCOPE: never stage it, never edit it, never list it as a plan file.
2. Gateway shape (`infra/operator-gateway/server.mjs`, plain Node ESM, node builtins only): the `operatorHeaders` Set (line 19) is consulted by `forwardHeaders`' blocked set (line 77) AND by `upgradeForwardHeaders` (line 133), so adding one name to that Set strips client values on BOTH the HTTP and the upgrade path. `requiredConfig` (lines 27-62) already parses WEB_ORIGIN with `new URL` and returns `webOrigin: webOrigin.origin`, so `webOrigin.hostname` is available for the loopback gate. Probe-verified hostname forms: `http://127.0.0.1:3000` -> `127.0.0.1`, `http://localhost:3000` -> `localhost`, `http://[::1]:3000` -> `[::1]` (bracketed — which is why the locked set carries both `::1` and `[::1]`), `http://web:3000` -> `web`, `http://127.0.0.2:3000` -> `127.0.0.2`. In the HTTP handler the forwarded request headers are built at line 207 (`forwardHeaders(incoming.headers, ["host", "authorization"])`), optionally merged with `signedOperatorHeaders` for protected paths (line 208), then passed to the upstream request created at line 217. The upgrade handler builds its own headers at line 266 (unchanged here except for shared Set membership). The gateway runs as a plain Node process spawned by `scripts/app-lifecycle.ps1` — no file watcher exists, so its changes take effect only after that process restarts; restarting the stack is an orchestrator/user action, never this task (operating rule: never kill the user's dev servers).
3. Next 16.3.3 (`apps/web/AGENTS.md` rule — read `node_modules/next/dist/docs/` guides before writing code): `headers` from `next/headers` is an async function — `const headersList = await headers()` (docs at the path referenced above, "headers is an async function that returns a promise"). No `force-static` export exists anywhere in apps/web (only two `export const dynamic = "force-dynamic"` route handlers), so an async root layout opts routes into dynamic rendering without conflicting with any static constraint. There is no existing `next/headers` usage in apps/web — the root layout is the first.
4. `apps/web/app/layout.tsx` today: sync `export default function RootLayout` (line 19), brand `<Link href="/">` (line 35), `<ReleaseNavigation />` (line 38), plus metadata/fonts/`ThemeBootstrapScript`/skip-link/footer that stay untouched. `apps/web/components/release-navigation.tsx`: `DESTINATIONS` (line 7) with «Операции» carrying `external: true` -> `/internal/operations/gateway`, a two-branch render (external -> plain `<a>`, otherwise `<Link>`, lines 55-75), `aria-current` from `destination.current(pathname)`, Russian labels.
5. Integration harness (`tests/integration/operator-gateway.test.ts`): `startGateway(webOrigin, overrides)` spawns the real `server.mjs` with `WEB_ORIGIN` as its first argument; `listen(server)` binds `127.0.0.1`; every upstream handler must answer `/health` (readiness and post-test probes are filtered with `path !== "/health"`); tests stop the gateway with `stop()` and close the upstream in `finally`. Baseline measured at planning: `corepack pnpm exec vitest run tests/integration/operator-gateway.test.ts` -> 17 passed (18.4s). Web gates measured at planning: `corepack pnpm --filter @bet-stats/web typecheck` -> exit 0; `corepack pnpm --filter @bet-stats/web lint` -> exit 0 with 9 pre-existing warnings, 0 errors (script `eslint .`; do not "fix" unrelated warnings in other files).
6. Reachability probe (ran green): an upstream bound to `0.0.0.0` answers a request addressed to `http://127.0.0.2:<port>` on this machine (HTTP 200). That is how the non-allowlisted-origin test observes the upstream: the locked example origin `http://web:3000` cannot appear in an assertion that must reach a live upstream, because the hostname `web` does not resolve locally — `http://127.0.0.2:<port>` is an absolute origin outside the loopback allowlist {127.0.0.1, localhost, ::1, [::1]} that still routes back to this machine, so the stamp's absence is observable on a request that genuinely arrives (discretion: substitutes a reachable non-allowlisted origin for the unresolvable example; the gate branch under test is identical).
7. e2e interplay: `tests/e2e/operations-gateway.spec.ts` only navigates `${gatewayOrigin}/internal/operations` — the `/internal` guard keeps it on :8080, unaffected. `tests/e2e/release-accessibility.spec.ts` asserts the nav on direct :3000 (`getByRole("navigation", { name: "Основная навигация")`, «Матчи» with `aria-current="page"`) — it stays valid because a null homeOrigin renders today's Link markup unchanged; it sits in the dirty set and is neither run nor edited here (e2e needs the full stack — out of scope for this task).
8. Conventions and staging: no new UI copy is added (both new/changed components render no strings beyond what exists); identifiers, comments and commit subjects stay English. This plan creates NO commits — the orchestrator handles commits, so stage nothing and run no `git add`/`git commit`. Never stage `.env*`, `.gsd/**`, `.planning/**`, `package.json`, `pnpm-lock.yaml`, `apps/web/next-env.d.ts`.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Gateway stamps the browser-reachable origin, spoof values never pass, integration coverage</name>
  <files>infra/operator-gateway/server.mjs, tests/integration/operator-gateway.test.ts</files>
  <precondition>`git status --porcelain` shows no modifications to `infra/operator-gateway/server.mjs` or `tests/integration/operator-gateway.test.ts` (planning-time state); if either is dirty, stop and report instead of editing.</precondition>
  <action>Make three scoped edits to `infra/operator-gateway/server.mjs`, then add two tests to `tests/integration/operator-gateway.test.ts`. (a) Add `x-operator-gateway-origin` as a fourth member of the `operatorHeaders` Set (line 19) — that single Set is consulted by `forwardHeaders` (HTTP path) and `upgradeForwardHeaders` (upgrade path), so client-supplied values are dropped on both paths; leave the Set's three existing members and both blocked-set constructions untouched (same spoof family as T-mv2-03). (b) In `requiredConfig`, after the WEB_ORIGIN URL validation and before the `return`, compute the browser-reachable home origin: `const homeOrigin = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(webOrigin.hostname) ? webOrigin.origin : null;` (probe facts: URL.hostname is `127.0.0.1`/`localhost`/`[::1]` for loopback and `web` for docker's `http://web:3000`; the unbracketed `::1` stays in the locked list for completeness) and include `homeOrigin` in the returned config object next to `webOrigin`. Docker behavior therefore stays unchanged: a non-allowlisted hostname yields `null` and nothing downstream can stamp. (c) In the HTTP handler, immediately after `const headers = forwardHeaders(incoming.headers, ["host", "authorization"]);` insert `if (config.homeOrigin) headers["x-operator-gateway-origin"] = config.homeOrigin;` — after `forwardHeaders`, so the client value is already stripped and the assignment can never produce a duplicate header, and before the upstream request is created at line 217; do not touch the `signedOperatorHeaders` merge, the upgrade handler's own header build, or any response-path code.

Then extend `tests/integration/operator-gateway.test.ts` with two `it` blocks appended as the last tests of the existing `describe("operator gateway HTTP boundary")` (before its closing brace, ahead of the WebSocket describe), reusing the file's harness verbatim: the `{ path, headers }` requests recorder, `listen`, `startGateway`, `stop`, the `path !== "/health"` filter, and `try/finally` closes. Test A — loopback stamp overwrites the spoof: upstream via `listen(upstream)` (so WEB_ORIGIN is `127.0.0.1`-based and inside the allowlist), then `fetch(`${gateway.origin}/fixtures`, { headers: { "x-operator-gateway-origin": "http://evil.example" } })` expects status 200, exactly one forwarded non-health request, and that request's `x-operator-gateway-origin` header equals `upstreamOrigin`. Test B — stamp absence for a WEB_ORIGIN outside the allowlist: record headers the same way, but bind the upstream inside the test with `upstream.listen(0, "0.0.0.0", ...)` wrapped in a promise (the shared `listen()` helper stays untouched — it binds `127.0.0.1`; mirror its `address()` narrowing to read the port), start the gateway with `startGateway(`http://127.0.0.2:${port}`)`, send the same spoofed client value to `/fixtures`, and expect status 200 — that status is what proves the request genuinely reached the upstream, which is what makes the absence observable — together with the forwarded `x-operator-gateway-origin` entry evaluating to `undefined`. Add a short English comment in Test B recording why the locked example `http://web:3000` is replaced by `127.0.0.2` (unresolvable hostname vs. a reachable origin outside the allowlist — the same gate branch under test).</action>
  <verify>
    <automated>node --check infra/operator-gateway/server.mjs && corepack pnpm exec vitest run tests/integration/operator-gateway.test.ts</automated>
  </verify>
  <done>The command exits 0 from the checkout root with 19 passed (17 prior + the 2 new origin-header tests): with loopback WEB_ORIGIN the upstream observes `upstreamOrigin` as the header value even though the client sent `http://evil.example`, and with the `127.0.0.2` WEB_ORIGIN the upstream observes the header key with value `undefined` on a 200 response; every prior gateway behavior (spoof replacement, 401/502/504 classification, Set-Cookie passthrough, WebSocket upgrade suite) stays green; `node --check` parses the gateway; no commit created and no file outside the two listed was modified.</done>
</task>

<task type="auto">
  <name>Task 2: Async root layout, homeOrigin-aware nav, gateway bounce component</name>
  <files>apps/web/app/layout.tsx, apps/web/components/release-navigation.tsx, apps/web/components/gateway-home-redirect.tsx (new)</files>
  <action>Read `apps/web/AGENTS.md` first (Next 16.3.3 may differ from training data) and the async `headers()` guide referenced in context, then wire three files. (a) `apps/web/app/layout.tsx`: import `headers` from `next/headers` and the new `GatewayHomeRedirect` component; change the default export to `export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>)` whose first statement is `const homeOrigin = (await headers()).get("x-operator-gateway-origin");` (type `string | null`); keep the `metadata` export, fonts, `ThemeBootstrapScript`, skip-link, footer and every Russian string byte-for-byte; change the brand anchor to `<Link href={homeOrigin ? `${homeOrigin}/` : "/"} className="release-brand">…</Link>`; render `<ReleaseNavigation homeOrigin={homeOrigin} />` in place of the current call; render `<GatewayHomeRedirect homeOrigin={homeOrigin} />` inside `<body>` immediately after the closing `</header>` element. Server render and client hydration receive the same prop, so hrefs are identical on both sides and no `window` access happens during render. (b) `apps/web/components/release-navigation.tsx`: add the optional prop `homeOrigin?: string | null` to `ReleaseNavigation` and leave everything else (DESTINATIONS, open-state effects, Escape handling, Russian labels, `aria-current` logic) untouched; in the destination map keep the existing `external` branch exactly as-is — the «Операции» anchor stays relative because its gateway route works from either origin — add a middle arm for every non-external destination that renders a plain `<a href={`${homeOrigin}${destination.href}`}>` carrying the same `key`, `aria-current={destination.current(pathname) ? "page" : undefined}` and `onClick={() => setOpen(false)}` as the Link arm (a cross-origin full page navigation is the point), and keep the final arm as today's `<Link>` markup — with `homeOrigin` null the component must emit byte-identical output to today, which is what keeps `tests/e2e/release-accessibility.spec.ts` green on direct :3000 (that file stays untouched). The current eslint config (`eslint-config-next/core-web-vitals` + `/typescript`) has no nested-ternary rule, so a three-arm ternary is acceptable; if lint disagrees, use a small local render function producing the identical markup. (c) Create `apps/web/components/gateway-home-redirect.tsx`: a `"use client"` component exporting `GatewayHomeRedirect({ homeOrigin }: { homeOrigin?: string | null })` that renders `null`, reads `const pathname = usePathname()` from `next/navigation`, and runs one `useEffect` keyed on `[homeOrigin, pathname]` which returns early when `homeOrigin` is falsy, when `homeOrigin === window.location.origin`, or when `pathname.startsWith("/internal")`, and otherwise calls `window.location.replace(`${homeOrigin}${pathname}${window.location.search}${window.location.hash}`)` — this is the bounce that returns a browser which backed into a stale gateway-served public page (e.g. /fixtures on :8080) to the app origin, so match sync never runs through the gateway. One short English comment states that purpose; SSR and client both render `null`, so hydration is safe.</action>
  <verify>
    <automated>corepack pnpm --filter @bet-stats/web typecheck && corepack pnpm --filter @bet-stats/web lint</automated>
  </verify>
  <done>Typecheck exits 0 and lint exits 0 with the same 9 pre-existing warnings and no new errors; the root layout is async and derives homeOrigin from `x-operator-gateway-origin`; with a null homeOrigin the brand link, nav anchors and bounce component produce today's output (Link-based, no redirect), while with a set homeOrigin the internal destinations become absolute :3000 anchors, «Операции» stays relative, and a non-/internal page on a different origin is replaced with the same path, query and hash on the home origin; no file outside the three listed was modified and no commit created.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → gateway :8080 (HTTP + upgrade) | Untrusted client headers, including `x-operator-gateway-origin`, cross into the proxy before any upstream forwarding |
| gateway → Next :3000 | The gateway-injected origin header becomes the web app's authority for navigation and redirects |
| gateway-served page → browser navigation | `homeOrigin` steers brand/nav anchors and the auto-bounce across origins |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261107fen-01 | Spoofing | `x-operator-gateway-origin` request header on both gateway paths (`infra/operator-gateway/server.mjs`) | medium | mitigate | The name joins the `operatorHeaders` Set, so `forwardHeaders` (HTTP) and `upgradeForwardHeaders` (upgrade) drop client values, and the handler assigns only `config.homeOrigin` after stripping; integration Test A asserts a client-spoofed value is replaced by WEB_ORIGIN upstream. |
| T-261107fen-02 | Tampering (open redirect) | `homeOrigin` consumed by brand Link, `ReleaseNavigation`, `GatewayHomeRedirect` (`apps/web`) | medium | mitigate | `requiredConfig` computes `homeOrigin` only when WEB_ORIGIN's hostname is in {127.0.0.1, localhost, ::1, [::1]} — otherwise `null`, so a docker-internal origin can never reach nav or redirect; `GatewayHomeRedirect` additionally no-ops when `homeOrigin` equals `window.location.origin` or the pathname starts with `/internal`; integration Test B asserts no stamp for a non-allowlisted origin. Residual accepted (low): a client talking directly to :3000 can supply the header itself — impact confined to that same client's own browser, no other user is affected. |
| T-261107fen-SC | Tampering | npm/pip/cargo installs | high | mitigate | No package installs and no new dependencies — three existing files edited, one component file created; gates reuse the existing vitest/eslint/tsc toolchain. |
</threat_model>

<verification>
Run in order from the checkout root and report actual output/exit codes:

1. `node --check infra/operator-gateway/server.mjs` — exit 0.
2. `corepack pnpm exec vitest run tests/integration/operator-gateway.test.ts` — 19 passed (the 17-test baseline was measured green at planning time in 18.4s; 2 new origin-header tests are added).
3. `corepack pnpm --filter @bet-stats/web typecheck` — exit 0 (baseline verified at planning).
4. `corepack pnpm --filter @bet-stats/web lint` — exit 0 (baseline: 0 errors, 9 pre-existing warnings; new code must add no errors — do not touch the warned files).
5. Restart note: `infra/operator-gateway/server.mjs` runs as a plain Node process (spawned by `scripts/app-lifecycle.ps1`) with no file watcher — the gateway change takes effect only after that process restarts; restarting the stack is an orchestrator/user action, never this task. `next dev` picks up the layout/component edits by HMR.
6. Not run here: any e2e suite (needs the full stack), full `pnpm test`, `next build`; ROADMAP.md is not updated; no commits are created (the orchestrator handles them).
</verification>

<success_criteria>
- From the operations dashboard on :8080, clicking «Матчи», any internal nav link or the brand lands on :3000 with the same path/query/hash, and a browser back into a stale :8080 public page bounces back to :3000 immediately — so «Обновить матчи» posts directly to :3000 and the gateway's 10s 504 «Не удалось запустить обновление.» is gone from that flow.
- `/internal` pages through the gateway («Центр операций») stay on :8080 — the bounce never fires there and the operator session keeps working.
- Direct :3000 renders byte-identical brand/nav markup (release-accessibility spec untouched and still valid); docker topology (`WEB_ORIGIN=http://web:3000`) behaves exactly as today — no stamp, no absolute anchors, no bounce.
- 19/19 integration gateway tests green, web typecheck and lint exit 0 with no new errors, and a client-chosen `x-operator-gateway-origin` value never reaches the upstream.
</success_criteria>

<output>
Create `.planning/quick/261107-fen-return-navigation-from-operator-gateway-/261107-fen-SUMMARY.md` when done (docs artifacts are committed by the orchestrator). The summary must record: the `127.0.0.2` substitution rationale for the non-allowlisted-origin test (locked example `http://web:3000` is unresolvable locally; same gate branch), the pre-change baselines (integration 17/17, typecheck 0, lint 0 errors / 9 warnings), and the gateway plain-Node restart requirement.
</output>
