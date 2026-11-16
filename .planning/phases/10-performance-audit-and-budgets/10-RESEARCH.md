# Phase 10: Performance Audit and Budgets - Research

**Researched:** 2026-11-16
**Domain:** Lighthouse performance auditing (programmatic npm package), CI budget gating, Next.js 16 client-bundle code splitting
**Confidence:** HIGH (tooling and APIs verified against official sources this session; CI-variance behavior partially assumed, flagged below)

## Summary

The phase has two deliverables: (1) an honest median-of-3 Lighthouse audit of the fixture detail page against a production build on the owned stack, producing a committed JSON receipt and explicit budgets pinned from real measurements; (2) a `performance-budget` CI job in `.github/workflows/ci.yml` that re-runs the same pinned-profile audit and fails on regression. The locked decisions (D-01…D-09) prescribe the shape: programmatic `lighthouse` npm package + small Node script with explicit assertions, simulated throttling with a fixed mobile profile, one config-driven page list, one seeded fixture, `NEXT_DIST_DIR` isolation, and optimization limited to lazy-loading the heavy secondary panels of `forecast-workbench.tsx`.

Two facts materially shape the design. First, **Lighthouse 13 has no built-in budget/assertion enforcement left to lean on**: the legacy `budgets.json` / `performance-budget` audit does not exist in Lighthouse 13's audit set [VERIFIED: GitHub contents listing of lighthouse `core/audits`, 2026-11-16] — so the phase's own "explicit assertions" (D-02/D-08) means our Node script reads `lhr.audits` values and compares them against a versioned budget config. This is not a workaround; it is exactly the "transparent script, versioned config, receipt in our own shape" that D-08 chose over `@lhci/cli`. Second, **Lighthouse's default profile already matches D-06**: `throttlingMethod: 'simulate'`, mobile slow-4G throttling, 412×823 @1.75 DPR mobile screen emulation [VERIFIED: lighthouse `core/config/constants.js`, main branch] — the config just pins what the default already does, and the receipt records the effective profile from `lhr.configSettings` so comparability is provable, not assumed.

The optimization target is verified in code: `page.tsx` (Server Component) statically imports the whole ~39 KB `forecast-workbench.tsx` ("use client") [VERIFIED: apps/web/app/fixtures/[fixtureId]/page.tsx:7], so every client chunk of the workbench ships on initial load. The Next 16 lazy-loading guide confirms the split must happen *inside* the client component (a Server Component dynamically importing a Client Component does not code-split) and `next/dynamic(() => import(...).then(m => m.NamedExport))` is the documented pattern [VERIFIED: apps/web/node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md]. The production-build audit harness reuses the proven `live-evaluation-stack.ts` pattern — owned PostgreSQL, seeded `ForecastSnapshot` rows, `next build` + `next start` with `ELIGIBILITY_*` env — with the 07-02 `NEXT_DIST_DIR=.next-e2e` isolation added [VERIFIED: tests/e2e/live-evaluation-stack.ts:61-62; apps/web/next.config.ts:10-13].

**Primary recommendation:** Build the phase as three sequential steps the planner should mirror: (1) audit harness + script producing the «before» median-of-3 receipt against the unoptimized production build; (2) the D-09 dynamic-import split of the workbench's comparison/value panels; (3) re-measure, pin budgets = post-optimization medians + modest headroom into the versioned config, commit the receipts, and add the `performance-budget` CI job reusing the Playwright chromium binary via `chromium.executablePath()`.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Бюджеты и страницы (PERF-01)**
- **D-01:** The gated page is `/fixtures/[fixtureId]` (the roadmap goal names it). The audit harness is data-driven — the audited page list lives in config — so `/fixtures` and `/scorecards` join later as config-only additions; PERF-02's "key pages" grows without new code. — **Reversibility:** reversible — the page list is configuration; adding pages later touches no code.
- **D-02:** The budget is a set of explicit Lighthouse assertions on concrete metrics — LCP, TBT, CLS — plus script byte weight (resource-summary). The Lighthouse Performance score is recorded in the receipt but never gated: no composite-score chasing (roadmap, verbatim).
- **D-03:** Budget values are pinned from a measured baseline, not invented: the first honest median-of-3 audit of the production build records the «before» numbers; budgets equal the baseline with modest headroom where the planned workbench optimization lands (D-08). Exact numbers are chosen during research/planning from real measurements against the owned stack.
- **D-04:** The CI gate runs on mobile emulation (worst case, Phase-6 declared Chromium matrix); desktop is recorded in the receipt but not gated in this phase.

**Среда аудита**
- **D-05:** Audits run against a **production build served by the owned stack** (Phase 05/07 release-tracer pattern): owned PostgreSQL/Redis containers, one seeded canonical fixture, zero live provider calls. The web build targets its own distDir via `NEXT_DIST_DIR` (the `.next-e2e` precedent from 07-02) so the developer's running `next dev` on `.next` is never touched (operating rule: agent work must never disturb the user's stack).
- **D-06:** Variance control is pinned in config: Lighthouse **simulated throttling** with a fixed profile (not devtools throttling), fixed viewport, one seeded fixture URL, median-of-3. The same profile drives local «before/after» runs and CI so the numbers are comparable. Runner noise never produces false regressions because thresholds come from the same pinned profile (D-03).

**Запись до/после (PERF-01 «recorded honestly»)**
- **D-07:** One committed **JSON receipt per audited run**: median-of-3 values for every gated metric, Lighthouse version, throttling profile, page URL, git SHA, date. The phase's «before» baseline is committed once; CI compares the current run against the committed baseline/budgets. Raw HTML reports are CI artifacts, never committed. The receipt is small, closed-field, secret-free (Phase-8 D-15 redaction discipline).

**Инструмент и CI-джоба (agent discretion — decided)**
- **D-08:** Programmatic `lighthouse` (npm, devDependency) driven by a small Node script with explicit assertions — not `@lhci/cli`, not third-party actions (transparent scripts, versioned config, receipt in our own shape). CI gets a separate `performance-budget` job in `.github/workflows/ci.yml` that reuses the chromium already installed by Playwright (`playwright install chromium --with-deps`), runs after build, and fails the build on budget regression.
- **D-09:** Optimization is limited to the fixture detail page's client JS: lazy-load the heavy secondary panels of `forecast-workbench.tsx` (comparison / evidence trace) via dynamic import on interaction, keeping the odds-entry core eager. No charting library — the roadmap's `dynamic-import-per-widget` fallback applies only if a charting lib ever exists (it does not). Audit findings beyond this are fixed only when cheap; otherwise recorded as deferred notes.

### the agent's Discretion

- Exact budget values, receipt file layout, audit script location, CI job internals — decided from real measurements and repo conventions (see Open Questions).

### Deferred Ideas (OUT OF SCOPE)

- Lighthouse-бюджеты для `/fixtures` и `/scorecards` — добавление конфигом, когда понадобится (PERF-02 growth path).
- Desktop-гейт — записывается с этой фазы, гейтится позже при необходимости.
- RUM / real-user monitoring — новая возможность, отдельная фаза.
- Серверные/БД латентные бюджеты — вне фазы 10.
- `dynamic-import-per-widget` — активируется только если в проекте появится библиотека графиков.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PERF-01 | Fixture detail page meets configured Lighthouse budgets measured as median-of-3 audit against the production build, with before/after metrics recorded | Harness pattern (live-evaluation-stack production build), programmatic Lighthouse API, receipt schema, D-09 split pattern, budget-pinning sequence (§Architecture Patterns) |
| PERF-02 | Lighthouse assertions run in CI against key pages and fail on budget regression | `performance-budget` CI job design, Playwright chromium reuse via `executablePath()`, fail-closed assertion script, config-driven page list |

## Recharts Verification (research flag resolved)

Roadmap flag: "STACK.md/ARCHITECTURE.md verify Recharts is absent from the repo; do not add a charting library." Verified this session: a repo-wide grep for `recharts` across `*.ts,*.tsx,*.json,*.js` returns **no matches**, and `apps/web/package.json` dependencies contain only `@bet-stats/domain`, `next`, `react`, `react-dom` [VERIFIED: apps/web/package.json:15-19]. **No charting library may be added in this phase.** The `dynamic-import-per-widget` fallback stays inactive.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Metric collection (LCP/TBT/CLS/script bytes) | Node audit script + `lighthouse` package | Chromium (Playwright's) | Measurement tooling belongs outside the app; the web app must not carry audit code |
| Budget definition | Versioned JSON config in repo | — | D-03/D-06: pinned values + profile live in config, not code |
| Gate enforcement | CI job (`performance-budget` in ci.yml) | Node script exit code | D-08: separate job after build; build fails on regression |
| Bundle reduction | Web client bundle (`forecast-workbench.tsx` split) | Next.js chunk graph | D-09: split inside the "use client" file; Server Component static import stays |
| Audited stack (Postgres/API/web prod build) | Owned containers + harness script | — | D-05: reuse Phase 05/07 owned-stack pattern; zero live provider calls |
| Receipt (median-of-3 record) | Committed JSON in repo | CI artifact (raw HTML only) | D-07: closed-field, secret-free, committed |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `lighthouse` | 13.6.0 (latest; npm modified 2026-11-13) | Programmatic audit runner; produces the LHR (Lighthouse Result) object | Official GoogleChrome tool; `type: "module"` fits the repo; engines `node >= 22.19` → Node 24 OK [VERIFIED: npm registry, `npm view lighthouse`] |
| `chrome-launcher` | 1.2.3 (transitive dep of lighthouse; import directly) | Launches the Chromium binary with an open CDP port | Lighthouse's own launcher; accepts explicit `chromePath` and falls back to `CHROME_PATH` env [VERIFIED: chrome-launcher source, main branch] |
| `@playwright/test` | 1.62.1 (already root devDependency) | Source of the Chromium binary — `chromium.executablePath()` | D-08: reuse the chromium installed by Playwright; no second browser download [VERIFIED: package.json:30; local run resolved `...\ms-playwright\chromium-1234\chrome-win64\chrome.exe` and the file exists] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node built-ins (`node:child_process`, `node:fs`, `node:crypto`) | Node 24 | Stack orchestration (docker, spawn), receipt writing, git SHA | Harness modeled on `live-evaluation-stack.ts` uses exactly these |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Programmatic `lighthouse` + own assertions | `@lhci/cli` | Rejected by D-08: third-party config shape, assertion semantics not ours; also @lhci is effectively unmaintained vs Lighthouse 13 |
| Programmatic `lighthouse` | GitHub Actions lighthouse wrappers (foo-software, treosh) | Rejected by D-08: third-party actions, opaque |
| Legacy `budgets.json` config | — | Does not exist in Lighthouse 13 (see Pitfall 3) — own script is the only path |
| `next/dynamic` | `React.lazy` + `Suspense` | Equivalent (next/dynamic *is* React.lazy + Suspense per Next 16 docs); either is fine — pick one and stay consistent [VERIFIED: Next 16 lazy-loading guide] |
| Lighthouse desktop preset for the gate | Desktop recorded only | D-04: gate mobile, record desktop |

**Installation:**
```bash
# root package.json devDependencies (never imported from apps/web code)
pnpm add -D -w lighthouse@13.6.0
```

**Version verification:** `npm view lighthouse version` → 13.6.0, `time.modified` 2026-11-13; `npm view chrome-launcher version` → 1.2.3 [VERIFIED: npm registry, 2026-11-16].

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| lighthouse | npm | 11+ yrs (GoogleChrome project) | ~2M+/wk | github.com/GoogleChrome/lighthouse | OK | Approved |
| chrome-launcher | npm | 9+ yrs (GoogleChrome project) | ~2M+/wk | github.com/GoogleChrome/chrome-launcher | OK | Approved |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

Both packages are verified this session from official sources (GitHub repo of GoogleChrome + npm registry engines/type fields) — tagged `[VERIFIED: npm registry]` per the package-name provenance rule.

## Architecture Patterns

### System Architecture Diagram

```
                        ┌────────────────────────────────────────────────┐
                        │        audit harness (Node script)             │
                        │  (pattern: tests/e2e/live-evaluation-stack.ts) │
                        └──────┬─────────────────────┬───────────────────┘
                               │ owns                │ owns
                    ┌──────────▼─────────┐  ┌────────▼──────────────────────┐
                    │ PostgreSQL 18      │  │ Nest API (prod dist, port ...)│
                    │ container          │  │ ELIGIBILITY_ALLOWED_REGIONS=PL│
                    │ + migrations       │  │ zero live provider calls      │
                    │ + seeded canonical │  └────────┬──────────────────────┘
                    │ fixture + ≥2 ISSUED│           │ /fixtures/:id, /forecasts
                    │ ForecastSnapshots  │  ┌────────▼──────────────────────┐
                    └────────────────────┘  │ Next.js PRODUCTION server     │
                                            │ next build + next start       │
                                            │ NEXT_DIST_DIR=.next-e2e       │
                                            │ ELIGIBILITY_REGION=PL,        │
                                            │ ELIGIBILITY_AGE_ACKNOWLEDGED  │
                                            └────────┬──────────────────────┘
                                                     │ http://127.0.0.1:<port>
                                                     │ /fixtures/<seeded-id>
                        ┌────────────────────────────▼─────────────────────────┐
                        │ audit runner (same script, phase 2 of the run)       │
                        │  for run in 1..3:                                    │
                        │    chrome-launcher.launch({chromePath: playwright    │
                        │      chromium executablePath()})                     │
                        │    lighthouse(url, {port, onlyCategories:['perf']},  │
                        │               pinnedConfig)  ← simulated throttling  │
                        │    extract lhr.audits LCP/TBT/CLS + resource-summary │
                        │    chrome.kill()                                     │
                        │  median-of-3 per metric → receipt JSON (committed)   │
                        │  assert receipt metrics ≤ budgets → exit 0/1         │
                        └──────────────────────────────────────────────────────┘
                                                     │
                        ┌────────────────────────────▼─────────────────────────┐
                        │ CI: `performance-budget` job (ci.yml, after build)   │
                        │ same script, same pinned config, fails the build     │
                        └──────────────────────────────────────────────────────┘
```

Entry point: the audit script; data flows owned-container → API → prod web page → Lighthouse/LHR → receipt → CI assertion. No interception anywhere (Phase 05 "real boundaries" discipline).

### Recommended Project Structure

```
scripts/ (or tests/perf/ — planner picks one convention)
├── perf-audit.mjs          # harness (owned stack) + runner + median + receipt + assertions
├── perf-budget.json        # versioned config: page list, throttle profile pin, budgets, headroom
└── perf-receipts/          # committed receipts: perf-baseline-before.json, perf-baseline-after.json, ...
```

(Exact location/naming per planner; the split of "harness" vs "runner" may live in one script.)

### Pattern 1: Programmatic Lighthouse run with Playwright's Chromium

**What:** Launch Chromium (the binary Playwright already installed), point Lighthouse at its CDP port, extract metric values from the LHR.
**When to use:** Every audit run (local before/after and CI — identical code path per D-06).
**Example:**
```js
// Adapted from lighthouse docs/readme.md "Using programmatically" [VERIFIED]
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import { chromium } from "@playwright/test";

const chrome = await launch({
  chromePath: chromium.executablePath(),          // [VERIFIED: chrome-launcher opts.chromePath; local resolution]
  chromeFlags: ["--headless=new"],                // CI has no display; same flag locally for parity
});
try {
  const runnerResult = await lighthouse(
    "http://127.0.0.1:<port>/fixtures/<seeded-id>",
    { port: chrome.port, onlyCategories: ["performance"], output: "json" },
    pinnedConfig,                                  // extends lighthouse:default; settings pin the profile
  );
  const lhr = runnerResult.lhr;
  // metrics are audits: [VERIFIED: lighthouse core/config/default-config.js — all four ids exist in v13]
  const lcp = lhr.audits["largest-contentful-paint"].numericValue;      // ms
  const tbt = lhr.audits["total-blocking-time"].numericValue;           // ms
  const cls = lhr.audits["cumulative-layout-shift"].numericValue;       // unitless
  const scriptItem = lhr.audits["resource-summary"].details.items
    .find((i) => i.resourceType === "script");                          // transferSize in bytes
  const perfScore = lhr.categories.performance.score;                   // recorded, never gated (D-02)
  // receipt also records lhr.environment.lighthouseVersion and
  // lhr.configSettings.throttling / throttlingMethod / screenEmulation (D-06 provenance)
} finally {
  await chrome.kill();
}
```

### Pattern 2: The pinned Lighthouse config (D-06)

**What:** `extends: 'lighthouse:default'` with settings that pin the profile; the defaults already are simulated-throttling mobile [VERIFIED: lighthouse `core/config/constants.js` — `throttlingMethod: 'simulate'`, `throttling: throttling.mobileSlow4G`, `screenEmulation` mobile 412×823 DPR 1.75, Moto G4 UA].
**Example:**
```js
export const pinnedConfig = {
  extends: "lighthouse:default",
  settings: {
    onlyCategories: ["performance"],
    // Explicit, not inherited-by-accident: values = lighthouse:default mobile profile
    throttlingMethod: "simulate",
    throttling: {
      rttMs: 150, throughputKbps: 1.6 * 1024 * 1024 / 8 * 0.9, // verify exact numbers from
      requestLatencyMs: 562.5,                                  // the FIRST receipt and copy
      downloadThroughputKbps: 1.6 * 1024 * 0.9,                 // them verbatim into the config
      uploadThroughputKbps: 150 * 1024 * 0.9,
      cpuSlowdownMultiplier: 4,
    },
    screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75 },
    emulatedUserAgent: undefined,               // keep the default Moto G4 UA (recorded in receipt)
    maxWaitForLoad: 45_000,
  },
};
```
**Important:** rather than trusting the snippet's constant values, the executor should read the effective profile from the first LHR (`lhr.configSettings.throttling`) and copy those exact numbers into `perf-budget.json` — that is the honest, self-verifying way to pin the profile.

### Pattern 3: D-09 split inside the client component

**What:** Move the heavy secondary panels (`ForecastComparisonPanel` + its `SourceRefItem`/revision-columns support, and optionally `ValueOutcomeSection`) into their own module(s) and load via `next/dynamic` only when the user's interaction produces data to show.
**When to use:** `forecast-workbench.tsx` only; the odds-entry core (market select, fields, submit/compare handlers, availability block) stays eager.
**Example (from Next 16 lazy-loading guide, named exports):**
```tsx
// inside forecast-workbench.tsx ("use client")
import dynamic from "next/dynamic";

// Renders only when revisionComparison state is set — the chunk loads on first need.
const ForecastComparisonPanel = dynamic(
  () => import("./forecast-comparison-panel").then((m) => m.ForecastComparisonPanel),
  { loading: () => <p role="status">Загружаем результат сравнения…</p> },
);
```
Key doc constraints [VERIFIED: Next 16 lazy-loading guide]: `ssr: false` is only allowed inside Client Components; a Server Component dynamically importing a Client Component does **not** code-split (so the split lives in `forecast-workbench.tsx`, not `page.tsx`); `dynamic()` calls must sit at module top level.

### Pattern 4: CI job shape (D-08)

**Example:**
```yaml
performance-budget:
  runs-on: ubuntu-latest
  timeout-minutes: 20
  needs: build            # or run the same build steps as e2e-portable
  steps:
    - uses: actions/checkout@v6
    - uses: pnpm/action-setup@v6
    - uses: actions/setup-node@v7
      with: { node-version: 24, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: pnpm exec turbo run build --filter=@bet-stats/config --filter=@bet-stats/domain --filter=@bet-stats/football-data --filter=@bet-stats/database --filter=@bet-stats/data-sync
    - run: pnpm --filter @bet-stats/web build   # NEXT_DIST_DIR=.next-e2e env
    - run: pnpm exec playwright install chromium --with-deps
    - run: node scripts/perf-audit.mjs          # exits 1 on budget regression
```

### Anti-Patterns to Avoid

- **Gating the Lighthouse Performance score:** D-02 forbids it (composite-score chasing). The score is recorded in the receipt only.
- **Inventing budget numbers:** D-03 forbids it. Budgets come from the measured medians; the «before» receipt is the audit trail.
- **Splitting from `page.tsx`:** a Server Component `dynamic()`-importing a Client Component does not code-split [VERIFIED: Next 16 guide]; the split belongs inside `forecast-workbench.tsx`.
- **Intercepting API responses in the audited stack:** owned containers + real boundaries, per Phase 05/07 discipline.
- **Adding a charting library:** forbidden by roadmap and CONTEXT; Recharts confirmed absent.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Launching/killing Chromium with CDP port | Custom spawn + ws-port scraping | `chrome-launcher` (`chromePath`, `port`) | Cross-platform install detection, flag defaults, cleanup — all edge cases |
| Trace processing → LCP/TBT/CLS | Reading the raw trace yourself | `lighthouse` package LHR | Lantern simulation, metric definitions, versioned semantics |
| Variance methodology | Statistical wizardry | median-of-3 + fixed simulated profile (official variability guidance: run multiple times, consistent environments) [CITED: lighthouse docs/variability.md] | Simple, honest, pinned; matches D-06 |
| Browser binary download | Downloading Chrome in CI | Playwright's already-installed chromium via `executablePath()` | D-08 explicitly reuses it; one less download/cache |

**Key insight:** The only thing this phase *should* hand-roll is the small assertion/receipt layer — because Lighthouse 13 ships no enforcement layer, and D-08 wants the logic transparent and versioned in our repo. Everything below the metrics (browser lifecycle, trace → metric) is Google's tooling.

## Common Pitfalls

### Pitfall 1: Budgets pinned before the optimization exists (or from imagination)
**What goes wrong:** CI goes red on landing (budgets = guesses below current numbers) or green-forever (guesses above everything), violating D-03's "not invented".
**Why it happens:** wanting the budget file committed in the first task.
**How to avoid:** sequence — (1) harness + «before» receipt committed; (2) D-09 split; (3) re-measure → budgets = post-optimization medians + modest headroom; commit budgets + «after» receipt; (4) CI job joins. Alternatively pin budgets = baseline + headroom in step 1 and tighten in step 3 — but the first sequence keeps CI honest about the *shipped* state.
**Warning signs:** a budget file whose numbers cannot be traced to a committed receipt.

### Pitfall 2: Local (Windows) vs CI (Linux) number drift
**What goes wrong:** budget passes locally, fails in CI (or vice versa) despite identical code.
**Why it happens:** simulated throttling (Lantern) is designed to be hardware-independent but trace-dependent residuals remain.
**How to avoid:** same pinned profile everywhere (D-06); headroom absorbs drift; **verify** in the baseline step that the CI run lands within headroom of the local run — if not, re-pin budgets from a CI-environment run (budgets must describe the environment CI runs in).
**Warning signs:** first CI `performance-budget` run red on a day-old baseline.

### Pitfall 3: Expecting Lighthouse's legacy budgets feature
**What goes wrong:** looking for `budgets.json`/`performance-budget` audit support in Lighthouse 13 and finding nothing.
**How to avoid:** implement assertions in the phase's own script comparing extracted LHR values against `perf-budget.json` [VERIFIED: v13 `core/audits` contains no `performance-budget.js`].
**Warning signs:** any plan task that says "configure Lighthouse budgets" without naming our script.

### Pitfall 4: Test/import breakage from the component split
**What goes wrong:** moving panels out of `forecast-workbench.tsx` breaks unit tests that import named exports from it.
**How to avoid:** `tests/unit/forecast-comparison-ui.test.tsx` imports `availabilityReasonCopy, ForecastComparisonPanel, ForecastWorkbench, initializeComparisonPair, swapComparisonPair, ValueOutcomeSection` and `tests/unit/odds-draft-ui.test.tsx` imports from the same module [VERIFIED: tests/unit/forecast-comparison-ui.test.tsx:5]; `tests/unit/responsible-copy.test.ts` reads the file's raw source [VERIFIED: tests/unit/responsible-copy.test.ts:68]. Update imports to the new module(s) and re-check the source-scanning test's expectations after the move.
**Warning signs:** red unit tests immediately after the split task.

### Pitfall 5: Audit stack missing eligibility env → degraded page → dishonest audit
**What goes wrong:** the eligibility guard is fail-closed — empty allowlist denies every region [VERIFIED: packages/domain/src/eligibility.ts:34-66] — so without env the fixture page renders the empty/degraded workbench and the audit measures the wrong page state.
**How to avoid:** API gets `ELIGIBILITY_ALLOWED_REGIONS: "PL"`; web prod server gets `ELIGIBILITY_REGION: "PL"`, `ELIGIBILITY_AGE_ACKNOWLEDGED: "true"`; **leave `ELIGIBILITY_CHECKED_AT` unset** so the proxies stamp per-request (a value captured at stack start goes stale after the guard's 1-hour max age on long audits) [VERIFIED: apps/web/app/internal-api/fixtures/[fixtureId]/forecasts/route.ts:8].
**Warning signs:** receipt LCP suspiciously low; page HTML contains "Сопоставимая пара прогнозов пока недоступна" in the harness preflight.

### Pitfall 6: Dev-server contention on `.next`
**What goes wrong:** a local production `next build` while the developer's `next dev` runs on `.next` (Next 16 exclusive dist lock) kills or corrupts their session — violates the operating rule "agent work must never disturb the user's stack".
**How to avoid:** `NEXT_DIST_DIR=.next-e2e` on both `next build` and `next start` in the harness [VERIFIED: apps/web/next.config.ts:10-13; 07-02 precedent].
**Warning signs:** any harness invocation without `NEXT_DIST_DIR`.

### Pitfall 7: Missing `--headless` in CI
**What goes wrong:** chrome-launcher launches headful Chrome; ubuntu runners have no display → launch failure/hang.
**How to avoid:** `chromeFlags: ["--headless=new", ...]` pinned in the script for both local and CI (parity).
**Warning signs:** CI job hanging at browser launch until `timeout-minutes`.

### Pitfall 8: Fail-open metric extraction
**What goes wrong:** a Lighthouse upgrade renames/moves an audit id; `undefined` numericValue slips past a naive comparison and the gate silently passes.
**How to avoid:** extraction is fail-closed — absent audit id, non-numeric value, or missing `resource-summary` script item fails the run loudly (Phase 07 "anything unmeasurable fails loudly" discipline).
**Warning signs:** any `?? 0` or `Number(undefined)` in the extraction code.

### Pitfall 9: Median-of-3 computed wrongly
**What goes wrong:** taking the median run (one full run's values) instead of the per-metric median across the 3 runs — different honesty semantics.
**How to avoid:** per-metric median over the 3 run values; receipt records both the raw per-run values and the per-metric median (closed fields).
**Warning signs:** receipt with a single `runs` winner or only one array.

### Pitfall 10: TBT-chasing scope creep
**What goes wrong:** "fixing" TBT by changing mount-time fetch behavior (availability/odds-list fetches are part of the workbench contract).
**How to avoid:** optimization scope is D-09 only (lazy secondary panels); other findings → deferred notes in the receipt/review.
**Warning signs:** tasks touching `useEffect` fetch logic.

## Code Examples

### Extracting receipt fields from the LHR
```js
// All field paths verified against lighthouse v13 default-config audit ids [VERIFIED]
const receipt = {
  schemaVersion: "perf-receipt-v1",
  date: new Date().toISOString(),
  gitSha: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
  lighthouseVersion: lhr.environment.lighthouseVersion,
  profile: { throttlingMethod: lhr.configSettings.throttlingMethod,
             throttling: lhr.configSettings.throttling,
             screenEmulation: lhr.configSettings.screenEmulation,
             formFactor: lhr.configSettings.formFactor },
  pages: [{ url: lhr.finalDisplayedUrl,
            metrics: { lcp: { median: med(lcps), runs: lcps }, tbt: {...}, cls: {...},
                       scriptTransferBytes: { median: med(bytes), runs: bytes } },
            performanceScore: lhr.categories.performance.score }], // recorded, not gated
};
```

### Budget assertion (fail-closed)
```js
for (const [metric, { median, budget }] of Object.entries(gated)) {
  if (median === undefined || Number.isNaN(median)) fail(`UNMEASURABLE_${metric}`);
  if (median > budget) fail(`${metric}: ${median} > budget ${budget}`);
}
```

### Harness skeleton (per `live-evaluation-stack.ts` + `next start`)
```js
// 1. owned postgres:18-alpine container + prisma migrate deploy
// 2. build: @bet-stats/config, domain, database, api dists; web: NEXT_DIST_DIR=.next-e2e pnpm --filter @bet-stats/web build
// 3. seed canonical fixture (fixed id, e.g. "perf-audit-fixture") + ≥2 ISSUED ForecastSnapshots
//    [VERIFIED seeding shape: tests/e2e/live-evaluation-stack.ts:41 forecastSnapshot.create]
// 4. start API (ELIGIBILITY_ALLOWED_REGIONS=PL, POSTGRES_READY=true, REDIS_READY=true)
//    and web prod (next start, ELIGIBILITY_REGION=PL, ELIGIBILITY_AGE_ACKNOWLEDGED=true)
//    [VERIFIED pattern: tests/e2e/live-evaluation-stack.ts:61-62]
// 5. preflight: page HTML renders the full workbench (not the degraded state)
// 6. 3 × lighthouse run → receipt → assertions → exit code; teardown owned PIDs/container
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Lighthouse legacy `budgets.json` + `performance-budget` audit | No budget enforcement in Lighthouse 13; assertions belong to the consumer script | by Lighthouse 13 era | Our D-08 script design is the current best practice, not a workaround |
| Chrome launcher auto-detects system Chrome | Explicit binary reuse: `chromium.executablePath()` → `chromePath` | Playwright-managed browsers are standard in CI | No second Chrome download; D-08's "reuse Playwright chromium" is directly supported |
| Lighthouse defaults use "Simulated Slow 4G" (Lantern) | Same, plus new insights/agentic audits in v13 | v13 | Only gate concrete metrics; ignore new categories |

**Deprecated/outdated:** @lhci/cli as the integration layer (D-08 rejects; also lagging Lighthouse 13), `next lint`-style tooling irrelevant here.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `next start` reads the same `distDir` that `next build` wrote (config applies to both commands) | Harness design | Harness would fail to find the build → visible immediately; fallback: build+start without isolation in CI only |
| A2 | GitHub ubuntu runner can launch Playwright's Chromium with the default sandbox; `--no-sandbox` only as recorded fallback | CI job | First CI run fails at launch → add flag in one step; low risk |
| A3 | Simulated-throttling numbers are comparable enough between the local Windows machine and the Linux CI runner that one headroom covers both | Budget pinning (D-03/D-06) | False CI regressions → re-pin budgets from a CI-environment run (Pitfall 2) |
| A4 | `--headless=new` works with the Playwright chromium build (chromium-1234 / current) | Runner flags | Launch failure → use `--headless`; trivially testable in the first run |
| A5 | One full CI perf-job run fits a ~20 min `timeout-minutes` (build web + 3 audits × 1 page) | CI job shape | Bump timeout to 25-30; measured in the first run |

## Open Questions

1. **Exact budget values (LCP/TBT/CLS/script bytes)**
   - What we know: they must come from the measured medians (D-03); they do not exist yet.
   - What's unclear: the actual numbers until the first harness run.
   - Recommendation: planner writes a task that runs the harness, records the «before» receipt, and fills `perf-budget.json` from measured values; the plan should not contain invented numbers.
2. **Receipt/budget file location and naming**
   - What we know: CONTEXT suggests `scripts/` or `tests/perf/`; receipts are committed (D-07).
   - Recommendation: one directory (e.g. `scripts/perf/` with `perf-budget.json` + `perf-receipts/`), decided once by the planner.
3. **ValueOutcomeSection in the split or not**
   - What we know: D-09 names "comparison / evidence trace" panels; `ValueOutcomeSection` (value result + full receipt JSON) also only renders post-interaction and is test-imported [VERIFIED: tests/unit/forecast-comparison-ui.test.tsx:5].
   - Recommendation: measure both; split whichever keeps the odds-entry core eager while maximizing script-byte savings; keep `ResponsiveEvidence` eager (used by the primary forecast tables).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 24 | everything | ✓ | local `.tools/node24` (v24.22.0), CI setup-node 24 | — |
| Docker | owned PostgreSQL container | ✓ | (stack runs daily on this machine; CI has Docker) | — |
| Playwright Chromium | the audited browser binary | ✓ | chromium-1234, `executablePath()` resolved and file exists (verified locally) | — |
| lighthouse 13.6.0 / chrome-launcher 1.2.3 | audit runner | to be installed (devDependency) | registry-verified | — |
| pnpm/corepack | build/start commands | ✓ | 10.34.5 | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (root devDependency) + existing apps/web vitest config for component tests |
| Config file | existing `vitest.config.*` per workspace; new tests in `tests/unit/` |
| Quick run command | `pnpm test` (config `test_command`) |
| Full suite command | `pnpm test` + the audit harness run itself is the phase acceptance |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PERF-01 | median-of-3 computation + fail-closed budget assertion + receipt closed-field shape | unit (pure functions) | `pnpm test` (new `tests/unit/perf-audit.test.ts`) | ❌ Wave 0 |
| PERF-01 | harness produces a receipt for the seeded production stack, workbench fully rendered | integration (script run, local) | `node scripts/perf-audit.mjs` (once, manually in the executor session) | ❌ (task itself) |
| PERF-02 | CI job exists, reuses pinned config, exits 1 on regression | review + dry run of the same script locally; CI green/red observed on first push | CI run | ❌ |

### Sampling Rate

- **Per task commit:** `pnpm test` (fast unit subset)
- **Per wave merge:** full `pnpm test`
- **Phase gate:** full suite green + one successful harness run with committed receipts + CI `performance-budget` job observed green on the PR

### Wave 0 Gaps

- [ ] `tests/unit/perf-audit.test.ts` — median, assertion, receipt-schema (secret-free closed fields) unit tests
- [ ] None else — existing test infrastructure covers the workspace; the harness is validated by running it

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no new surface) |
| V3 Session Management | no | — |
| V4 Access Control | no | existing EligibilityGuard unchanged; audit stack env is test-scoped |
| V5 Input Validation | yes | `perf-budget.json` parsed fail-closed (unknown metric, non-numeric budget, missing field → loud failure); receipt is a closed-field schema |
| V6 Cryptography | no | — |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Receipt/env leakage (URLs, env values, headers with secrets) | Information Disclosure | closed-field receipt built field-by-field, never spread of process.env; mirror Phase-8 D-15 redaction discipline + unit test forbidding secret-shaped values |
| Silently-passing gate (renamed audit id, missing data) | Tampering | fail-closed extraction (Pitfall 8); unit test |
| Config drift making budgets meaningless | Tampering | budgets + profile pinned in one versioned file; receipt records the effective profile for comparison |

## Sources

### Primary (HIGH confidence)
- [VERIFIED: npm registry] lighthouse 13.6.0 (2026-11-13), engines `node>=22.19`, `type: module`; chrome-launcher 1.2.3 — `npm view` this session
- [VERIFIED: github.com/GoogleChrome/lighthouse — docs/readme.md, docs/configuration.md, core/config/constants.js, core/config/default-config.js, main branch, fetched 2026-11-16] programmatic API, config shape, default audit ids (largest-contentful-paint / total-blocking-time / cumulative-layout-shift / resource-summary), default mobile simulated-throttling profile; absence of a budget audit in v13 `core/audits`
- [VERIFIED: github.com/GoogleChrome/chrome-launcher — src main] `chromePath` option and `CHROME_PATH` env fallback
- [VERIFIED: apps/web/node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md + 03-api-reference/.../distDir.md] Next 16 dynamic import patterns, ssr:false constraints, distDir
- [VERIFIED: repo files this session] apps/web/app/fixtures/[fixtureId]/page.tsx:7; apps/web/next.config.ts:10-13; tests/e2e/live-evaluation-stack.ts:61-62; tests/e2e/live-evidence-stack.ts; packages/domain/src/eligibility.ts:34-66; .github/workflows/ci.yml; package.json (root + apps/web); tests/unit imports (forecast-comparison-ui.test.tsx:5, odds-draft-ui.test.tsx:12, responsible-copy.test.ts:68); local Playwright chromium resolution run

### Secondary (MEDIUM confidence)
- [CITED: lighthouse docs/variability.md] multi-run methodology rationale for median-of-3

### Tertiary (LOW confidence)
- Assumption items A1–A5 in the Assumptions Log (flagged for the planner/executor to verify on first run)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package/API verified from npm registry + official sources this session
- Architecture/harness: HIGH — direct reuse of verified in-repo patterns (live-evaluation-stack, NEXT_DIST_DIR)
- Budget mechanics: HIGH (LHR field paths) / MEDIUM (CI-vs-local variance — assumption A3, resolved by the baseline task)
- Pitfalls: HIGH — all grounded in verified repo files or official docs

**Research date:** 2026-11-16
**Valid until:** ~2026-12-16 (stable tooling domain; re-verify lighthouse minor if planning slips >30 days)
