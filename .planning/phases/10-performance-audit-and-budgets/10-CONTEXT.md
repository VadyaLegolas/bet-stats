# Phase 10: Performance Audit and Budgets - Context

**Gathered:** 2026-11-16
**Status:** Ready for planning
**Mode:** Interactive (discuss) — operator delegated all selected gray areas to the agent («отвечай все сам как решаешь нужным»); decisions below are agent-authored and grounded in the roadmap, prior phase contracts, and a codebase scout.

<domain>
## Phase Boundary

The fixture detail page meets declared Lighthouse performance budgets — measured honestly as a median-of-3 audit against the production build with before/after metrics recorded — and budget regressions fail CI instead of shipping, so later UI phases (scanner, journal, new markets) inherit the discipline. The optimization scope is the fixture detail page's client JavaScript only; no charting library (Recharts is confirmed absent and must stay absent), no backend/DB latency budgets, no real-user monitoring. Requirements: PERF-01, PERF-02.

</domain>

<decisions>
## Implementation Decisions

### Бюджеты и страницы (PERF-01)
- **D-01:** The gated page is `/fixtures/[fixtureId]` (the roadmap goal names it). The audit harness is data-driven — the audited page list lives in config — so `/fixtures` and `/scorecards` join later as config-only additions; PERF-02's "key pages" grows without new code. — **Reversibility:** reversible — the page list is configuration; adding pages later touches no code.
- **D-02:** The budget is a set of explicit Lighthouse assertions on concrete metrics — LCP, TBT, CLS — plus script byte weight (resource-summary). The Lighthouse Performance score is recorded in the receipt but never gated: no composite-score chasing (roadmap, verbatim).
- **D-03:** Budget values are pinned from a measured baseline, not invented: the first honest median-of-3 audit of the production build records the «before» numbers; budgets equal the baseline with modest headroom where the planned workbench optimization lands (D-08). Exact numbers are chosen during research/planning from real measurements against the owned stack.
- **D-04:** The CI gate runs on mobile emulation (worst case, Phase-6 declared Chromium matrix); desktop is recorded in the receipt but not gated in this phase.

### Среда аудита
- **D-05:** Audits run against a **production build served by the owned stack** (Phase 05/07 release-tracer pattern): owned PostgreSQL/Redis containers, one seeded canonical fixture, zero live provider calls. The web build targets its own distDir via `NEXT_DIST_DIR` (the `.next-e2e` precedent from 07-02) so the developer's running `next dev` on `.next` is never touched (operating rule: agent work must never disturb the user's stack).
- **D-06:** Variance control is pinned in config: Lighthouse **simulated throttling** with a fixed profile (not devtools throttling), fixed viewport, one seeded fixture URL, median-of-3. The same profile drives local «before/after» runs and CI so the numbers are comparable. Runner noise never produces false regressions because thresholds come from the same pinned profile (D-03).

### Запись до/после (PERF-01 «recorded honestly»)
- **D-07:** One committed **JSON receipt per audited run**: median-of-3 values for every gated metric, Lighthouse version, throttling profile, page URL, git SHA, date. The phase's «before» baseline is committed once; CI compares the current run against the committed baseline/budgets. Raw HTML reports are CI artifacts, never committed. The receipt is small, closed-field, secret-free (Phase-8 D-15 redaction discipline).

### Инструмент и CI-джоба (agent discretion — decided)
- **D-08:** Programmatic `lighthouse` (npm, devDependency) driven by a small Node script with explicit assertions — not `@lhci/cli`, not third-party actions (transparent scripts, versioned config, receipt in our own shape). CI gets a separate `performance-budget` job in `.github/workflows/ci.yml` that reuses the chromium already installed by Playwright (`playwright install chromium --with-deps`), runs after build, and fails the build on budget regression.
- **D-09:** Optimization is limited to the fixture detail page's client JS: lazy-load the heavy secondary panels of `forecast-workbench.tsx` (comparison / evidence trace) via dynamic import on interaction, keeping the odds-entry core eager. No charting library — the roadmap's `dynamic-import-per-widget` fallback applies only if a charting lib ever exists (it does not). Audit findings beyond this are fixed only when cheap; otherwise recorded as deferred notes.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §PERF-01, §PERF-02 — the two acceptance requirements (median-of-3 honest measurement; CI fail on regression).
- `.planning/ROADMAP.md` §Phase 10 — goal, success criteria, research flags (Recharts absent — do not add; ~39 KB workbench target; no composite-score chasing).

### Research
- `.planning/research/STACK.md` — confirms the no-charting-library constraint and the dev-tooling baseline (Vitest, Playwright, CI).
- `.planning/research/ARCHITECTURE.md` — app/worker boundaries the audit stack must respect (Nest API origin `API_ORIGIN`, owned containers).

### Inherited phase contracts
- `.planning/phases/07-ci-pipeline-quality-gates/07-CONTEXT.md` — CI discipline the perf job must fit: Node 24 portable, lint/typecheck gates, portable E2E specs, `NEXT_DIST_DIR=.next-e2e` isolation, "never kill the developer's stack" operating rule.
- `.planning/phases/05-provider-aware-coverage-and-enrichment/05-CONTEXT.md` — owned-stack live acceptance pattern (owned migrated PostgreSQL/Redis, real boundaries, no interception) that the audit stack reuses.
- `.planning/phases/06-release-experience-and-operations/06-CONTEXT.md` — declared desktop+mobile Chromium support matrix (D-04's mobile gate choice).

### Live implementation contracts
- `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` — the ~40 KB client component; the optimization target (D-09).
- `apps/web/app/fixtures/[fixtureId]/page.tsx` — server component; eager static import of ForecastWorkbench (the bundle path to break).
- `apps/web/next.config.ts` — existing `NEXT_DIST_DIR` support the audit build uses.
- `.github/workflows/ci.yml` — where the `performance-budget` job attaches; Playwright chromium install to reuse.
- `playwright.ci.config.ts` + `tests/e2e/live-evidence-stack.ts` — owned-stack/globalSetup pattern for the audit harness.
- Next.js version note: `apps/web/AGENTS.md` — Next 16 has breaking changes; read the relevant guide under `node_modules/next/dist/docs/` before touching web code (dynamic imports, client/server components).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tests/e2e/live-evidence-stack.ts` — owned PostgreSQL/Redis + web origin globalSetup; the audit harness reuses this shape instead of inventing a new stack.
- `playwright.ci.config.ts` — CI pattern: no webServer, explicit closed surface, chromium project.
- `next.config.ts` `NEXT_DIST_DIR` — isolated prod build for the audit without contending with the developer's `.next`.
- Seeded fixture data path (Phase 04 acceptance seeds canonical sources) — supplies the one fixture URL the audit measures.

### Established Patterns
- Owned containers + real boundaries + no live provider calls in CI (Phases 05–07).
- Receipt discipline: immutable, closed-field, secret-free JSON records (Phases 02/04/08).
- Fail-closed CI gates: anything unmeasurable fails loudly, never skips (Phase 07).
- Manual-only data loading / no background sweeps during test stacks (Ops rules).

### Integration Points
- CI: new `performance-budget` job in `.github/workflows/ci.yml`, depends on build.
- Web: dynamic-import split inside `forecast-workbench.tsx`; no new routes or components.
- Scripts: a Node audit script (location per planner convention, e.g. `scripts/` or `tests/perf/`) reading a versioned budget config.

</code_context>

<specifics>
## Specific Ideas

- «Отвечай все сам как решаешь нужным» — оператор делегировал все выбранные области; решения авторские, привязаны к коду и прошлым фазам.
- Честность измерения — главный принцип фазы: пороги из реальных замеров, медиана-из-3, без погони за композитным баллом, receipts с полной прозрачивостью прогона.
- Инфраструктура аудита максимально переиспользует owned-стек фаз 05/07 — ничего нового не изобретать.
- Оптимизация — только сплит тяжёлых панелей workbench; ядро ввода коэффициентов должно оставаться интерактивным сразу.

</specifics>

<deferred>
## Deferred Ideas

- Lighthouse-бюджеты для `/fixtures` и `/scorecards` — добавление конфигом, когда понадобится (PERF-02 growth path).
- Desktop-гейт — записывается с этой фазы, гейтится позже при необходимости.
- RUM / real-user monitoring — новая возможность, отдельная фаза.
- Серверные/БД латентные бюджеты — вне фазы 10.
- `dynamic-import-per-widget` — активируется только если в проекте появится библиотека графиков.

### Reviewed Todos
None — `todo.match-phase 10` returned 0 matches; discussion stayed within phase scope.

</deferred>

---

*Phase: 10-performance-audit-and-budgets*
*Context gathered: 2026-11-16*
