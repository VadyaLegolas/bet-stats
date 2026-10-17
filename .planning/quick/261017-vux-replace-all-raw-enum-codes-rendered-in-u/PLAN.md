---
phase: 261017-vux-replace-all-raw-enum-codes-rendered-in-u
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/components/enum-labels.ts
  - apps/web/components/enum-labels.test.ts
  - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
  - apps/web/components/provider-state-notice.tsx
  - apps/web/components/data-state-notice.tsx
  - apps/web/components/evidence-state-notice.tsx
  - apps/web/app/teams/[teamId]/evidence/page.tsx
  - apps/web/app/faq/page.tsx
  - apps/web/app/internal/reconciliation/page.tsx
  - apps/web/app/internal/operations/page.tsx
  - tests/unit/odds-draft-ui.test.tsx
  - tests/unit/forecast-comparison-ui.test.tsx
autonomous: true
requirements: []

estimate:
  tokens: 62000
  raw_tokens: 34000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "No forecast-kind code renders raw on the fixture workbench: snapshot selects show «По подтверждённому составу · ревизия 2 — …», the availability list and revision comparison show Russian kind names, and «Вид снимка» shows the Russian name."
    - "The revision-comparison delta conclusion reads «1X2 — Хозяева», not «ONE_X_TWO — HOME»."
    - "Provider and data notices translate receipt outcome, trigger and state reason into Russian while unknown codes still render through the existing lowercase transform."
    - "Evidence limitation reasons render through one label function with English-sentence passthrough on both the evidence page and the evidence-state notice."
    - "FAQ prose reads «первичный», «предматчевый», «по подтверждённому составу» with no raw codes in sentences."
    - "Internal reconciliation and operations pages translate method, service state, incident impact and incident status with raw passthrough for unknown values."
  artifacts:
    - path: apps/web/components/enum-labels.ts
      provides: "Pure Russian label functions with fallbacks for every mapped enum"
      exports: ["forecastKindLabel", "oddsMarketLabel", "oddsSelectionLabel", "routeOutcomeLabel", "routeTriggerLabel", "reasonLabel", "evidenceLimitationLabel", "reconciliationMethodLabel", "serviceStateLabel", "impactLabel", "incidentStatusLabel", "MARKET_LABELS", "SELECTION_LABELS"]
    - path: apps/web/components/enum-labels.test.ts
      provides: "Mapping and fallback assertions for every label function"
  key_links:
    - from: apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
      to: apps/web/components/enum-labels.ts
      via: "imports forecastKindLabel, oddsMarketLabel, oddsSelectionLabel, MARKET_LABELS, SELECTION_LABELS"
      pattern: "from \"\\.\\./\\.\\./\\.\\./\\.\\./components/enum-labels\""
    - from: apps/web/components/provider-state-notice.tsx
      to: apps/web/components/enum-labels.ts
      via: "imports routeOutcomeLabel, routeTriggerLabel, reasonLabel"
      pattern: "from \"\\./enum-labels\""
---

<objective>
Replace every raw enum code that reaches rendered UI copy with an understandable Russian label, keeping a passthrough fallback for unknown values. Scope is the fixture forecast workbench, provider/data/evidence state notices, the team evidence page, the FAQ, and the internal reconciliation and operations pages.

Purpose: Users currently see codes such as «PRE_MATCH revision 1», «Нет снимка LINEUP_CONFIRMED», raw receipt outcome/trigger values and raw reconciliation methods. The user asked for these to be human-readable everywhere.

Output: One shared pure module `apps/web/components/enum-labels.ts` plus its colocated test, every listed render site switched to the label functions, and the affected UI-copy test assertions updated.
</objective>

<execution_context>
@C:/Users/Vlad/.config/opencode/gsd-core/workflows/execute-plan.md
@C:/Users/Vlad/.config/opencode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

apps/web/components/quota-format.ts — precedent for a dependency-free shared pure module with a colocated .test.ts
apps/web/components/quota-format.test.ts — colocated test precedent (vitest, relative "./quota-format" import)
tests/unit/evidence-trace-ui.test.ts — precedent for the "never leaks raw enum codes into rendered markup" renderToStaticMarkup assertion (imports react from ../../apps/web/node_modules/react/index.js and react-dom from ../../apps/web/node_modules/react-dom/server.js)
packages/domain/src/forecast/contract.ts — FORECAST_KINDS and ForecastKind
packages/domain/src/odds/contract.ts — OddsMarket and OddsSelection
</context>

<context_fidelity>
This is a developer-discretion quick task, not a discuss-phase CONTEXT.md run. No locked decisions (D-NN) and no deferred ideas apply, so the decision-coverage gate has nothing to check. The user request and the verified live inventory are honored in full: every listed render site is covered by a task, every dictionary value is reproduced verbatim, and the shared-module design plus fallback behavior specified by the user is implemented exactly as described.
</context_fidelity>

<discovery>
Level 0. All affected files were read and the render sites, line numbers and dictionary values were verified in this session. The change follows existing project patterns: inline `Record` label dictionaries already exist in provider-state-notice.tsx and data-state-notice.tsx, and quota-format.ts establishes the shared pure module plus colocated test shape. No new external dependencies.
</discovery>

<tasks>

<task type="tracer">
  <name>Task 1: Create enum-labels module and wire the forecast workbench</name>
  <files>apps/web/components/enum-labels.ts, apps/web/components/enum-labels.test.ts, apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx</files>
  <action>
    Create the shared pure module `apps/web/components/enum-labels.ts` following the quota-format.ts precedent: no imports, no "use client" directive, ES module named exports, JSDoc on the fallback contract. Type the enum parameters by importing types and the FORECAST_KINDS constant from `@bet-stats/domain` (ForecastKind, OddsMarket, OddsSelection) so the Records stay exhaustive; import types only for the `string`-typed parameters (route outcome/trigger, reason, evidence limitation, reconciliation method, service state, impact, incident status) — those come from DTOs typed as `string` at the render sites.

    Export these functions, each falling back so an unknown value can never render as empty or throw:
    - `forecastKindLabel(kind: ForecastKind): string` — INITIAL → "первичный", PRE_MATCH → "предматчевый", LINEUP_CONFIRMED → "по подтверждённому составу". Fallback returns the raw code.
    - `oddsMarketLabel(market: OddsMarket): string` — ONE_X_TWO → "1X2", OVER_UNDER_2_5 → "Тотал 2.5", BTTS → "Обе забьют". Fallback returns the raw code.
    - `oddsSelectionLabel(selection: OddsSelection): string` — HOME → "Хозяева", DRAW → "Ничья", AWAY → "Гости", OVER_2_5 → "Тотал больше 2.5", UNDER_2_5 → "Тотал меньше 2.5", YES → "Да", NO → "Нет". Fallback returns the raw code.
    - `routeOutcomeLabel(outcome: string): string` — ADMITTED → "Допущено", DENIED → "Отклонено", NO_FALLBACK → "Резервный источник недоступен", SUCCEEDED → "Успешно", FAILED → "Сбой", QUARANTINED → "Карантин". Fallback returns the raw code.
    - `routeTriggerLabel(trigger: string): string` — PRIMARY → "Первичный источник", UNSUPPORTED_COVERAGE → "Регион не поддерживается", ALLOWANCE_EXHAUSTED → "Бюджет запросов исчерпан", CIRCUIT_OPEN → "Сработал предохранитель", TRANSPORT_FAILURE → "Сбой транспорта", RATE_LIMITED → "Превышен лимит частоты", PROVIDER_UNAVAILABLE → "Провайдер недоступен", ROUTE_PENDING → "Маршрут ожидается", NO_PRODUCTION_FALLBACK → "Продакшен-резерв недоступен", UNSUPPORTED_CAPABILITY → "Возможность не поддерживается", STALE_CAPABILITY → "Устаревшая возможность", EXPIRED_CAPABILITY → "Возможность истекла", CRITICAL_HEADROOM → "Критический запас бюджета", UNKNOWN_CAPABILITY → "Неизвестная возможность", CAPABILITY_MISMATCH → "Несовпадение возможности". Fallback returns the raw code.
    - `reasonLabel(reason: string): string` — PROVIDER_OBSERVATION_RECORDED → "получено наблюдение провайдера", PROVENANCE_NOT_AVAILABLE → "провенанс источника недоступен", FRESHNESS_THRESHOLD_EXCEEDED → "превышен порог свежести", SOURCE_UPDATE_TIME_MISSING → "нет времени обновления источника", INVALID_SOURCE_UPDATE_TIME → "недопустимое время обновления источника", UNKNOWN_DATA_STATE → "состояние данных неизвестно". Fallback MUST reproduce the existing lowercase-underscore transform exactly: `reason.replaceAll("_", " ").toLowerCase()`.
    - `evidenceLimitationLabel(reason: string): string` — NO_ELIGIBLE_HISTORY → "нет пригодной истории", LIMITED_HISTORY → "история ограничена", MISSING_TIMESTAMP → "нет отметки времени", EMPTY → "нет данных". Fallback returns the input unchanged, because DTO limitation reasons can be full English sentences that must not be mangled by a lowercase transform.
    - `reconciliationMethodLabel(method: string): string` — EXACT_EXTERNAL_REF → "точное совпадение внешней ссылки", UNIQUE_CONSERVATIVE_MATCH → "уникальное консервативное совпадение", MANUAL_REVIEW → "ручная проверка", OPERATOR_CONFIRMED → "подтверждено оператором". Fallback returns the raw code.
    - `serviceStateLabel(state: string): string` — UP → "доступно", DOWN → "недоступно", DEGRADED → "деградация". Fallback returns the raw code.
    - `impactLabel(impact: string): string` — BLOCKING → "блокирует", DEGRADED → "деградация". Fallback returns the raw code.
    - `incidentStatusLabel(status: string): string` — OPEN → "открыт", RESOLVED → "решён". Fallback returns the raw code.

    Also move the two records out of forecast-workbench.tsx into this module, keeping their `Record<OddsMarket, string>` / `Record<OddsSelection, string>` typing and their current Russian values verbatim: `MARKET_LABELS` (ONE_X_TWO "1X2", OVER_UNDER_2_5 "Тотал 2.5", BTTS "Обе забьют") and `SELECTION_LABELS` (HOME "Хозяева", DRAW "Ничья", AWAY "Гости", OVER_2_5 "Тотал больше 2.5", UNDER_2_5 "Тотал меньше 2.5", YES "Да", NO "Нет"). oddsMarketLabel and oddsSelectionLabel should read from these records rather than duplicating the values.

    Then in `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx`:
    1. Delete the local `MARKET_LABELS` and `SELECTION_LABELS` constants (currently lines 12-13) and import them plus the needed label functions from `../../../components/enum-labels`. Leave `ODDS_FIELD_LABELS`, `OUTCOME_COPY`, `AVAILABILITY_COPY` and the local `labelReason` helper untouched — they are not part of this task.
    2. `forecastOptionLabel` (line 38) currently returns `` `${snapshot.kind} revision ${snapshot.revision} — ${snapshot.cutoff} — ${snapshot.id}` ``. Change it to `` `${forecastKindLabel(snapshot.kind)} · ревизия ${snapshot.revision} — ${snapshot.cutoff} — ${snapshot.id}` `` so a LINEUP_CONFIRMED option renders «По подтверждённому составу · ревизия 2 — 2026-09-06T11:17:23.000Z — forecast-lineup-2».
    3. In the no-forecast early return (line 124) replace the three absence paragraphs with kind-labelled versions. Read the exact current sentences first and preserve each tail after the colon verbatim; only the «Нет снимка {CODE}: » prefix changes to «Нет {label}: ». The result for the three kinds is: INITIAL → «Нет первичного снимка: прогноз выпускается за 14 дней до кикоффа, как только матч попадает в горизонт данных.»; PRE_MATCH → «Нет предматчевого снимка: обновление выпускается за 6 часов до кикоффа.»; LINEUP_CONFIRMED → «Нет снимка по подтверждённому составу: до отсечки не было официальной квитанции подтверждённого состава.».
    4. Availability list (line 126): change `<strong>{kind}</strong>` to `<strong>{forecastKindLabel(kind)}</strong>`.
    5. Revision comparison (line 127): change `<strong>{kind}</strong>` to `<strong>{forecastKindLabel(kind)}</strong>`, and rewrite the inline LINEUP_CONFIRMED fallback from the string «Нет снимка LINEUP_CONFIRMED: до отсечки не было официальной квитанции подтверждённого состава.» to the same Russian sentence as item 3, keyed on the `kind === "LINEUP_CONFIRMED"` branch.
    6. Frozen forecast dl (line 128): change `<dd>{forecast.kind}</dd>` to `<dd>{forecastKindLabel(forecast.kind)}</dd>`.
    7. `ForecastComparisonPanel` revision table (lines 70-76): the `market` column currently returns `row.market` and the `selection` column returns `row.selection`, rendering raw codes into the table. Route both through `oddsMarketLabel(row.market)` and `oddsSelectionLabel(row.selection)`.
    8. `ForecastComparisonPanel` conclusion (line 83): change `` `${row.market} — ${row.selection}` `` to `` `${oddsMarketLabel(row.market)} — ${oddsSelectionLabel(row.selection)}` `` so it renders «1X2 — Хозяева».

    Do not touch the JSON `<pre>` receipt dumps, the `<code>` snapshot IDs, domain contracts, or the API. Those legitimately carry codes and are not user-facing prose.
  </action>
  <verify>
    <automated>pnpm --filter @bet-stats/web exec vitest run ../../apps/web/components/enum-labels.test.ts && pnpm --filter @bet-stats/web typecheck</automated>
    <expected>enum-labels.test.ts passes all mapping and fallback cases; typecheck exits 0 with no unused-import or missing-export errors in forecast-workbench.tsx.</expected>
  </verify>
  <done>
    enum-labels.ts exists and is dependency-free; forecast-workbench.tsx imports MARKET_LABELS/SELECTION_LABELS and the label functions from it with no local duplicates; forecastOptionLabel returns the «· ревизия» format; the three absence sentences, both kind `<strong>` render sites, the «Вид снимка» dd, the revision delta columns and the delta conclusion all render Russian labels; enum-labels.test.ts passes.
  </done>
</task>

<task type="auto">
  <name>Task 2: Route state notices and evidence limitation copy through the label module</name>
  <files>apps/web/components/enum-labels.test.ts, apps/web/components/provider-state-notice.tsx, apps/web/components/data-state-notice.tsx, apps/web/components/evidence-state-notice.tsx, apps/web/app/teams/[teamId]/evidence/page.tsx, tests/unit/provider-state-ui.test.tsx</files>
  <action>
    First extend `apps/web/components/enum-labels.test.ts` with a `describe("evidenceLimitationLabel")` block covering the four mapped values and — importantly — the passthrough: a full English sentence such as "Not enough completed matches before this cutoff." must come back byte-identical, proving the fallback does not lowercase or underscore-mangle DTO prose.

    Then wire the three notice components and the evidence page:
    1. `apps/web/components/provider-state-notice.tsx`: import `reasonLabel`, `routeOutcomeLabel`, `routeTriggerLabel` from `./enum-labels`.
       - Line 81 renders the reason via `state.reason.replaceAll("_", " ").toLowerCase()`. Replace that expression with `reasonLabel(state.reason)`. Keep the surrounding «Источник: … Причина: …» sentence and the trailing period exactly as-is.
       - Line 105 `<dd style={{ margin: 0 }}>{state.receipt.outcome}</dd>` → wrap with `routeOutcomeLabel(...)`.
       - Line 107 `<dd style={{ margin: 0 }}>{state.receipt.trigger}</dd>` → wrap with `routeTriggerLabel(...)`.
       - Leave the JSON receipts, `<code>` id, `policyVersion` and the `headings`/`providerBadgeStyles` records untouched.
    2. `apps/web/components/data-state-notice.tsx`: import `reasonLabel` from `./enum-labels` and replace the line-64 `data.reason.replaceAll("_", " ").toLowerCase()` with `reasonLabel(data.reason)`. Keep the trailing period outside the call. The state badge `labels` record stays as-is.
    3. `apps/web/components/evidence-state-notice.tsx`: import `evidenceLimitationLabel` from `./enum-labels` and change line 17 from `{limitationReason && <p>{limitationReason}</p>}` to `{limitationReason && <p>{evidenceLimitationLabel(limitationReason)}</p>}`.
    4. `apps/web/app/teams/[teamId]/evidence/page.tsx`: import `evidenceLimitationLabel` from `../../../components/enum-labels` (this page is at `app/teams/[teamId]/evidence/page.tsx`, so four levels up reaches `apps/web/components`). Apply it at both render sites:
       - `SummaryCard` (line 85): `{summary.limitationReason && <p>{summary.limitationReason}</p>}` → `{summary.limitationReason && <p>{evidenceLimitationLabel(summary.limitationReason)}</p>}`.
       - Component details (line 146): `{component.limitation && <p>{component.limitation}</p>}` → `{component.limitation && <p>{evidenceLimitationLabel(component.limitation)}</p>}`.
    5. `tests/unit/provider-state-ui.test.tsx` line 14 asserts the exact lowercase string «no production fallback». reasonLabel's fallback preserves that transform, so that assertion still passes — verify it does before changing anything. Only update the file if an assertion genuinely breaks; when it does, update the UI-copy assertion to the new rendered Russian label and leave every domain/API assertion asserting raw codes untouched.
  </action>
  <automated>MISSING — Task 2 has no new unit test target of its own; its covered behavior is asserted by the enum-labels.test.ts additions in this task plus the existing provider-state-ui.test.tsx suite, which the verify command runs.</automated>
  <verify>
    <automated>pnpm exec vitest run tests/unit/provider-state-ui.test.tsx apps/web/components/enum-labels.test.ts && pnpm --filter @bet-stats/web typecheck</automated>
    <expected>provider-state-ui.test.tsx and enum-labels.test.ts pass; typecheck exits 0.</expected>
  </verify>
  <done>
    Provider, data and evidence notices plus both evidence-page render sites call the shared label functions; unknown values still render through the previous fallback behavior (lowercase transform for reasons, raw passthrough for limitation sentences); the provider-state-ui suite is green.
  </done>
</task>

<task type="auto">
  <name>Task 3: Translate FAQ prose and internal page codes, then run the full gates</name>
  <files>apps/web/app/faq/page.tsx, apps/web/app/internal/reconciliation/page.tsx, apps/web/app/internal/operations/page.tsx, apps/web/components/enum-labels.test.ts, tests/unit/odds-draft-ui.test.tsx, tests/unit/forecast-comparison-ui.test.tsx</files>
  <action>
    1. `apps/web/app/faq/page.tsx` — replace the raw kind codes appearing in prose with the lowercase Russian names. Read each line first and preserve meaning and the responsible-gambling tone; do not add the codes back in parentheses:
       - Line 29 (the fixtures alt text): «снимки прогнозов INITIAL и PRE_MATCH» → «снимки прогнозов первичный и предматчевый».
       - Lines 112-114 (the «Когда выпускаются прогнозы?» answer): the three `<strong>INITIAL</strong>`, `<strong>PRE_MATCH</strong>`, `<strong>LINEUP_CONFIRMED</strong>` lead-ins become `<strong>первичный</strong>`, `<strong>предматчевый</strong>`, `<strong>по подтверждённому составу</strong>`; keep the surrounding sentence tails («сразу, как только матч попадает в 14-дневный горизонт свипа…», «за 6 часов до кикоффа», «только когда появляется официальная квитанция подтверждённого состава…») unchanged.
       - Lines 200-201 (the same explanation further down): «INITIAL снимок выпускается…» → «Первичный снимок выпускается…», «PRE_MATCH — за 6 часов» → «Предматчевый — за 6 часов», «LINEUP_CONFIRMED — только после официальной квитанции состава» → «Снимок по подтверждённому составу — только после официальной квитанции состава». Preserve the trailing sentence about the forecast not being issued yet.
    2. `apps/web/app/internal/reconciliation/page.tsx`: import `reconciliationMethodLabel` from `../../../components/enum-labels` (the page sits at `app/internal/reconciliation/page.tsx`, three levels up). On line 11, the candidate radio label currently ends with `({x.method})`; change it to `({reconciliationMethodLabel(x.method)})`. Leave the JSON evidence `<pre>` and the audit-history `{d.action}` render as-is — this task's scope is the `method` code only.
    3. `apps/web/app/internal/operations/page.tsx`: import `serviceStateLabel`, `impactLabel`, `incidentStatusLabel` from `../../components/enum-labels` (two levels up from `app/internal/operations/page.tsx`).
       - Line 54: `<dd>{service.state}</dd>` → `<dd>{serviceStateLabel(service.state)}</dd>`.
       - Line 70: the incident list item currently ends with `{incident.impact} · {incident.status}`; change it to `{impactLabel(incident.impact)} · {incidentStatusLabel(incident.status)}`. Leave `incident.summary`, the date and the correlation-id copy button untouched. The failure-group rows on line 63 and 64 are outside the verified inventory scope — leave them.
    4. Update the two forecast UI tests to the new copy:
       - `tests/unit/odds-draft-ui.test.tsx` line 60: the `forecastOptionLabel` expectation changes from "LINEUP_CONFIRMED revision 2 — …" to "По подтверждённому составу · ревизия 2 — 2026-09-06T11:17:23.000Z — forecast-lineup-2".
       - Same file, lines 67-68: the two absence-sentence assertions change to «Нет первичного снимка: прогноз выпускается за 14 дней до кикоффа, как только матч попадает в горизонт данных.» and «Нет предматчевого снимка: обновление выпускается за 6 часов до кикоффа.».
       - `tests/unit/forecast-comparison-ui.test.tsx` line 43: «Нет снимка LINEUP_CONFIRMED: до отсечки не было официальной квитанции подтверждённого состава.» → «Нет снимка по подтверждённому составу: до отсечки не было официальной квитанции подтверждённого состава.».
       - Sweep `tests/unit` for any other assertion of the copy this task changes (search for «Нет снимка», «revision », receipt outcome/trigger strings, and limitation text) and update only assertions that check rendered UI prose. Domain and API tests that assert raw codes — for example fixtures-sync.test.ts asserting `receipt.trigger`/`receipt.outcome`, forecast-comparison.test.ts, chronological-features.test.ts, form.test.ts, evidence-display.test.ts — must stay untouched; those code values are correct in the domain layer.
    5. Optionally, if cheap, add a markup-level guard to an existing UI test file using the `renderToStaticMarkup` pattern already established in `tests/unit/evidence-trace-ui.test.ts` (react imported from `../../apps/web/node_modules/react/index.js`, react-dom from `../../apps/web/node_modules/react-dom/server.js`), asserting that the rendered `ForecastWorkbench` markup with one INITIAL snapshot contains no `PRE_MATCH` or `LINEUP_CONFIRMED` token outside `<code>`/`<pre>` dumps. Skip this if it requires restructuring a fixture.
    6. Run the full gates from the repo root. Do not restart Docker or the running stack; apps/api is untouched and needs no rebuild. Do not run Playwright — the orchestrator handles live verification separately.
  </action>
  <verify>
    <automated>pnpm test && pnpm --filter @bet-stats/web typecheck && pnpm --filter @bet-stats/api typecheck</automated>
    <expected>All unit suites and the web suite pass (the previous baseline was 335 unit + 13 web; counts may shift slightly as tests are added or updated, but every suite must be green); both typecheck runs exit 0.</expected>
  </verify>
  <done>
    FAQ prose and both internal pages render Russian labels; the three updated UI-copy assertions match the new strings; the full `pnpm test` and both typecheck commands are green.
  </done>
</task>

</tasks>

<verification>
Run from the repo root, in order:
1. `pnpm exec vitest run apps/web/components/enum-labels.test.ts` — every mapping and fallback case passes.
2. `pnpm test` — full unit + web suites green. Counts may shift from the 335/13 baseline because tests are added and copy assertions are updated; no suite may fail.
3. `pnpm --filter @bet-stats/web typecheck` and `pnpm --filter @bet-stats/api typecheck` — both exit 0.

No Docker restart and no Playwright run; the stack is already up and live verification is the orchestrator's step.
</verification>

<success_criteria>
- Every render site named in the inventory routes through the shared label module or uses prose with no raw codes.
- No raw UPPER_SNAKE enum code appears in user-facing prose on the fixture workbench, the three notices, the evidence page, the FAQ, or the two internal pages. Codes remain only inside JSON `<pre>` receipts, `<code>` ids and domain/API tests.
- Unknown enum values still render through the previous fallback behavior — the lowercase-underscore transform for `reason`, raw passthrough for limitation sentences and every other mapped field — so nothing breaks when the API emits a value this module does not know.
- One atomic code commit lands all changes.
</success_criteria>

<output>
Create `.planning/quick/261017-vux-replace-all-raw-enum-codes-rendered-in-u/261017-vux-SUMMARY.md` when done.
</output>
