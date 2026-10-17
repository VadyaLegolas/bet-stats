---
phase: quick-261017-pyp
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/modules/fixtures/results-sync.service.ts   (restored to committed HEAD — no net diff)
  - apps/web/app/internal-api/fixtures/results-sync/route.ts (new)
  - apps/web/components/date-range-filter.tsx
  - tests/unit/internal-api-route.test.ts
  - tests/unit/results-sync-button-ui.test.tsx (new)
  - .env (gitignored ops file — edited, NEVER committed)
autonomous: true
must_haves:
  truths:
    - "The fixtures page shows a «Загрузить результаты» button next to «Обновить матчи»; it is disabled while either sync runs and, when pressed, publishes finished-match outcomes through the operator-guarded endpoint — no background or scheduled results loading exists anywhere in the API."
    - "After a run the single role=status area shows one Russian summary line per league: «Лига: опубликовано N результатов» (correct Russian plural via the existing plural helper), «Лига: уже опубликовано недавно», «Лига: лига недоступна на тарифе провайдера», «Лига: сбой запроса к провайдеру», or «Лига: отказ (REASON)» — and the two buttons' messages never overwrite each other."
    - "A run with any synced league dispatches the fixtures-quota-refresh window event (header quota counter updates) and calls router.refresh(); HTTP failures render results-specific Russian error copy without claiming success."
    - "The new Next proxy answers fail-closed 404 { message: \"Not found\" } with NO upstream call when OPERATOR_CREDENTIAL is missing; otherwise it forwards the request body verbatim to the Nest /internal/fixtures/results-sync endpoint with the x-operator-credential header added server-side — the browser never holds the credential."
    - "The bottom hint paragraph explains that «Загрузить результаты» публикует итоги завершённых матчей; all UI strings are Russian, identifiers English."
    - "Gates green: full unit project passes (the 3 deleted auto-scheduler tests drop out of the pre-change 294 baseline) and web typecheck exits 0; nothing about fixtures/lineups/odds sync behavior changes."
  artifacts:
    - apps/api/src/modules/fixtures/results-sync.service.ts (restored to committed manual-only HEAD)
    - apps/web/app/internal-api/fixtures/results-sync/route.ts (new operator proxy)
    - apps/web/components/date-range-filter.tsx (button + runResultsSync + formatResultsSyncResults + describeResultsSyncFailure + resultsSyncState/messageOwner)
    - tests/unit/results-sync-button-ui.test.tsx (new, ~5 cases)
    - tests/unit/internal-api-route.test.ts (extended with fail-closed + forwarding cases for the new proxy)
    - .env without the results auto-sync interval line (ops-only, never staged)
  key_links:
    - button onClick -> runResultsSync -> POST /internal-api/fixtures/results-sync -> Next proxy adds x-operator-credential -> Nest POST /internal/fixtures/results-sync (fixtures.controller.ts @Controller("internal/fixtures"))
    - response.results -> formatResultsSyncResults -> single role=status paragraph (owner state) -> fixtures-quota-refresh event -> header quota counter
    - OPERATOR_CREDENTIAL missing -> fail-closed 404 in the proxy before any upstream fetch
---

<objective>
Replace the uncommitted auto-scheduler for results publication with an explicit manual control: first revert the uncommitted ResultsSyncService auto-tick work (user decision: NO auto loading of results), then add an end-to-end manual «Загрузить результаты» path — a fail-closed Next proxy route mirroring the existing fixtures sync proxy, and a second button in the fixtures date-range filter that publishes per-league Russian summaries into the shared status area — verified by focused unit tests.
Purpose: result publication stays a deliberate operator action (provider budget and honest data flow stay under human control) while users get a one-click way to publish finished-match outcomes instead of curl.
Output: service restored to committed HEAD, one new proxy route, one new button + handler + formatters in the filter component, two test files (one new, one extended), green unit + typecheck gates, one atomic code commit.
</objective>

<execution_context>
@C:/Users/Vlad/.config/opencode/gsd-core/workflows/execute-plan.md
@C:/Users/Vlad/.config/opencode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md
@apps/web/AGENTS.md
@apps/web/components/date-range-filter.tsx
@apps/web/app/internal-api/fixtures/sync/route.ts
@tests/unit/internal-api-route.test.ts
@tests/unit/odds-draft-ui.test.tsx

Verified facts (planning-time reads and probes — use as given, do not re-investigate):

1. Git tree: `apps/api/src/modules/fixtures/results-sync.service.ts` modified ONLY with the auto-scheduler blocks (diff verified: added interval helper `resolveAutoResultsSyncInterval`, `type OnModuleInit` import + `implements OnModuleInit`, `autoTimer`/`autoRunning` fields, `onModuleInit()`, `runAutoSync()`, and a widened `onModuleDestroy`). Committed HEAD is the manual-only form with the single-line `async onModuleDestroy(): Promise<void> { await this.database?.$disconnect(); }`. `tests/unit/results-sync-auto.test.ts` is UNTRACKED (never committed). Nothing else in the repo references the auto-interval helper or variable (git grep verified). `.gsd/dispatch-isolation-sentinel.json` is also modified — a runtime artifact: leave it alone, never stage it.
2. `.env` (gitignored ops file) contains `RESULTS_AUTO_SYNC_INTERVAL_MINUTES=60` next to `FIXTURES_AUTO_SYNC=false` (keep the latter). Edit .env in place; NEVER stage or commit it.
3. API endpoint exists and is operator-guarded: `apps/api/src/modules/fixtures/fixtures.controller.ts` `@Controller("internal/fixtures")` + `@Post("results-sync")` → `POST /internal/fixtures/results-sync`. Response shape (verified live): `{ results: [{ league, status: "synced" | "skipped" | "failed", fixtures: number, results: number, reason?: string }] }`; the service can additionally return status `"denied"` (capability/budget/mapping gates) which must map to the same «отказ (REASON)» fallback the existing formatter uses.
4. Proxy pattern is `apps/web/app/internal-api/fixtures/sync/route.ts` (13 lines, Next 16.3.3): fail-closed 404 without `process.env.OPERATOR_CREDENTIAL`, upstream `${API_ORIGIN ?? "http://127.0.0.1:3001"}/internal/fixtures/sync`, POST with `content-type: application/json` + `x-operator-credential`, body `await request.text()` as-is, `new NextResponse(response.body, …)` passing through status + content-type and stamping `cache-control: private, no-store, max-age=0`, `export const POST = proxy;`. This sibling file is the authoritative Next-version pattern (apps/web/AGENTS.md warns the Next version may differ from training data).
5. Component facts (`apps/web/components/date-range-filter.tsx`): `plural` helper line 38; `SyncResult` type line 36; `formatSyncResults` line 46; `describeSyncFailure` line 55 (its copy says «Синхронизация…» — results wording must be results-specific); `runSync` lines 78-99 (fetch, error path, quota event dispatch, `router.refresh()` only when some league synced); status `<p role="status" aria-live="polite">` lines 187-191; buttons lines 174-185 (`btn-secondary`, `minHeight: 44`, `padding: "8px 20px"`, `disabled={syncState.pending}`, pending label «Обновляю…»); bottom hint lines 192-195. The `autoSync` page-mount path stays as-is (disabled by `.env FIXTURES_AUTO_SYNC=false`) — do not touch it and do not change `runSync` behavior beyond one `messageOwner` line.
6. Unit test environment is `node` (vitest.config.ts project "unit"); the repo has NO jsdom, happy-dom, @testing-library or react-test-renderer anywhere (root, apps/web and the pnpm store all checked) and adding a dependency here is forbidden (package-legitimacy gate + quick scope). Existing UI tests render with `renderToStaticMarkup` from `../../apps/web/node_modules/react-dom/server.js` and `createElement` from `../../apps/web/node_modules/react/index.js` (odds-draft-ui.test.tsx); fetch is stubbed with `vi.stubGlobal("fetch", …)` and env with `vi.stubEnv` (internal-api-route.test.ts).
7. PROBE RESULT (ran and passed): mocking `next/navigation` with the bare specifier from a root test file does NOT intercept the component's import. The form that works: `vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => ({ push: vi.fn(), refresh: <spy> }) }))` together with `const <spy> = vi.hoisted(() => vi.fn())`. With that mock, `renderToStaticMarkup(createElement(DateRangeFilter, { leagues, competition, autoSync: false }))` renders successfully in the unit project.
8. Consequence of fact 6: a real DOM click cannot be simulated (no DOM library, and installing one is out of scope). The behavioral tests therefore drive `runResultsSync` — the exact exported function the button's onClick delegates to — with `vi.stubGlobal("fetch", …)` and `vi.stubGlobal("window", { dispatchEvent: vi.fn() })`, and the render test asserts the button/hint markup statically. State this limitation and the probe result (fact 7) in the SUMMARY.
9. Gates: `corepack pnpm vitest run --project unit` (root; pre-change baseline 294 tests including the 3 auto-scheduler tests that this plan deletes → 291 + the new tests' count) and `corepack pnpm --filter @bet-stats/web typecheck` (script = `tsc --noEmit`, covers `components/**` and `app/**` per apps/web/tsconfig.json include). Node runtime warning about v25 vs engines <25 appears on every pnpm command in this environment — expected, not a failure.
10. Do NOT run the stack launcher, do NOT restart dev processes, do NOT run integration or e2e suites — the orchestrator restarts the stack and live-verifies.

Constraints (hard): Russian UI strings, English code, comments and commit messages; NEVER stage or commit `.env`, `.env2`, `.gsd/**`, `.planning/**`, `infra/docker-compose.yml`, `package.json`, `pnpm-lock.yaml`, `packages/database/src/generated/**`, `tsconfig.json`, `apps/web/next-env.d.ts`, `.agents/`, `.claude/`; NO new dependencies (no jsdom/testing-library install); do not modify `runSync` semantics, the `autoSync` mount path, the fixtures sync proxy route, or anything under `apps/api` beyond restoring the service to HEAD; ONE atomic code commit staging ONLY the four plan code files (service file has no net diff, deleted test was untracked); docs artifacts (SUMMARY.md) are committed by the orchestrator, not this plan.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Revert the uncommitted auto-scheduler — restore manual-only results service</name>
  <files>apps/api/src/modules/fixtures/results-sync.service.ts, tests/unit/results-sync-auto.test.ts (delete), .env (ops edit, never committed)</files>
  <precondition>`git diff apps/api/src/modules/fixtures/results-sync.service.ts` shows only the auto-scheduler blocks described in context fact 1; if any other change appears, stop and report instead of reverting.</precondition>
  <action>Run `git diff apps/api/src/modules/fixtures/results-sync.service.ts` and confirm the working-tree delta is exactly the auto-scheduler additions (the interval-mapping helper, the OnModuleInit import and interface clause, the timer/re-entrancy fields, the two lifecycle methods, and the widened destroy method). Then restore the committed manual-only state with `git checkout -- apps/api/src/modules/fixtures/results-sync.service.ts` — this returns the file to the HEAD form where the class implements only OnModuleDestroy and `onModuleDestroy` is the single line that disconnects the database. If checkout is blocked by tooling, remove each auto-scheduler block with Edit so the file matches HEAD byte-for-byte; checkout is preferred because it guarantees exactness. Delete the untracked `tests/unit/results-sync-auto.test.ts` with a plain file deletion (it was never committed, so nothing is staged or committed for it). Edit the gitignored `.env` ops file: remove the results auto-sync interval line (the `RESULTS_AUTO_SYNC_INTERVAL_MINUTES=60` entry) while keeping `FIXTURES_AUTO_SYNC=false` intact; `.env` must never be staged or committed.

<!-- planner-discipline-allow: RESULTS_AUTO_SYNC_INTERVAL_MINUTES -->

Leave `.gsd/dispatch-isolation-sentinel.json` untouched. This task produces no commit of its own: the revert leaves no diff, the test deletion leaves none either — the plan ships one atomic commit in Task 3.</action>
  <verify>
    <automated>git diff --exit-code -- apps/api/src/modules/fixtures/results-sync.service.ts; if ($LASTEXITCODE -ne 0) { exit 1 }; if (Test-Path tests/unit/results-sync-auto.test.ts) { exit 1 }; if (Select-String -Path .env -Pattern 'RESULTS_AUTO_SYNC_INTERVAL_MINUTES' -Quiet) { exit 1 }; exit 0</automated>
  </verify>
  <done>The service file is byte-identical to committed HEAD (git diff exit 0): no auto-interval helper, no OnModuleInit lifecycle, no timer fields, and `onModuleDestroy` only disconnects the database; the auto test file no longer exists; `.env` keeps `FIXTURES_AUTO_SYNC=false` and no longer holds the results auto-interval line; `.gsd/dispatch-isolation-sentinel.json` untouched; `git status --porcelain` shows no residue from this task.</done>
</task>

<task type="auto">
  <name>Task 2: Add the results-sync proxy route and the «Загрузить результаты» button</name>
  <files>apps/web/app/internal-api/fixtures/results-sync/route.ts (new), apps/web/components/date-range-filter.tsx</files>
  <action>First read `apps/web/AGENTS.md` (Next 16.3.3 may differ from training data). Create `apps/web/app/internal-api/fixtures/results-sync/route.ts` as an exact mirror of the sibling `apps/web/app/internal-api/fixtures/sync/route.ts`: same imports, same two-line concise English doc-comment adapted to the manual results sync, the same `proxy(request: NextRequest)` body — fail-closed `NextResponse.json({ message: "Not found" }, { status: 404 })` when `process.env.OPERATOR_CREDENTIAL` is missing, upstream URL `/internal/fixtures/results-sync` against `process.env.API_ORIGIN ?? "http://127.0.0.1:3001"`, POST with `content-type: application/json` and `x-operator-credential` headers and `await request.text()` passed through as-is, `cache: "no-store"`, then `return new NextResponse(response.body, { status: response.status, headers: { "content-type": …, "cache-control": "private, no-store, max-age=0" } })` — and `export const POST = proxy;`. No extra exports, no eligibility headers, no new dependencies; when in doubt, mirror the sibling file character-for-character except the upstream path and comment wording.

Then extend `apps/web/components/date-range-filter.tsx` (keep `runSync` semantics and the `autoSync` mount path untouched; Russian UI strings, English identifiers and comments). (a) Name the existing inline sync-state shape `export type FilterSyncState = { pending: boolean; message?: string; error?: boolean }` and reuse it for both states. (b) Extend the existing `SyncResult` type with optional `results?: number`. (c) Add `export const formatResultsSyncResults` mapping the API's per-league entries, joined with ` · ` like `formatSyncResults`: status `synced` → `${league}: опубликовано ${results ?? 0} ${plural(count, "результат", "результата", "результатов")}` using the existing `plural` helper; `skipped` → `${league}: уже опубликовано недавно`; `failed` with reason `PROVIDER_ACCESS_RESTRICTED` → `${league}: лига недоступна на тарифе провайдера`; `failed` with reason `PROVIDER_REQUEST_FAILED` → `${league}: сбой запроса к провайдеру`; everything else (other failure reasons and the service's `denied` status) → `${league}: отказ (${reason ?? "UNKNOWN"})`. (d) Add a private `describeResultsSyncFailure(status, reason)` mirroring `describeSyncFailure`'s reason mapping but with results-specific Russian copy: 503/DETERMINISTIC_MODE → «Загрузка результатов недоступна в демонстрационном режиме без базы данных.», 503/DATABASE_NOT_CONFIGURED → «Загрузка результатов недоступна: не настроена база данных (DATABASE_URL).», 503/PROVIDER_TOKEN_NOT_CONFIGURED → «Загрузка результатов недоступна: не настроен токен футбольного провайдера.», 404 → «Загрузка результатов недоступна: нет учётных данных оператора.», otherwise → «Не удалось запустить загрузку результатов.». (e) Add `export const runResultsSync = async (league: string, setState: (state: FilterSyncState) => void, refresh: () => void): Promise<void>` — the function the new button's onClick delegates to (exported so the node-environment unit tests can drive it directly; one short English comment saying so). Its flow mirrors `runSync` exactly: `setState({ pending: true })`; POST `/internal-api/fixtures/results-sync` with `content-type: application/json`, `cache: "no-store"` and body `JSON.stringify({ force: true, ...(league ? { competitions: [league] } : {}) })` (force first); on `!response.ok` read `{ reason }` from the JSON body (catch → null) and `setState({ pending: false, message: describeResultsSyncFailure(response.status, detail?.reason), error: true })`; on success cast the payload to `{ results: readonly SyncResult[] }`, `setState({ pending: false, message: formatResultsSyncResults(results), error: false })`, always `window.dispatchEvent(new CustomEvent("fixtures-quota-refresh"))`, and call `refresh()` only when some result has status `synced`; catch → `setState({ pending: false, message: "Сервер данных недоступен — загрузка результатов не выполнена.", error: true })`. (f) Component state: add `const [resultsSyncState, setResultsSyncState] = useState<FilterSyncState>({ pending: false })` plus `const [messageOwner, setMessageOwner] = useState<"sync" | "results" | null>(null)`; at the start of `runSync` add `setMessageOwner("sync")` next to its existing `setSyncState({ pending: true })` (its only change); the status paragraph renders from `const statusState: FilterSyncState = messageOwner === "results" ? resultsSyncState : syncState` while keeping the existing `role="status" aria-live="polite"`, `filter-hint` class and danger-color-on-error styling — this way each button's message survives and the most recently started action owns the shared area. (g) Add the button right after «Обновить матчи»: `type="button"`, `className="btn-secondary"`, `style={{ minHeight: 44, padding: "8px 20px" }}`, `disabled={syncState.pending || resultsSyncState.pending}`, label `{resultsSyncState.pending ? "Загружаю результаты…" : "Загрузить результаты"}`, and `onClick` that sets `messageOwner` to `"results"` and calls `void runResultsSync(selectedLeague, setResultsSyncState, () => router.refresh())`; leave the «Обновить матчи» disabled condition unchanged. (h) Append to the bottom hint paragraph the sentence ««Загрузить результаты» публикует итоги завершённых матчей.».</action>
  <verify>
    <automated>corepack pnpm --filter @bet-stats/web typecheck</automated>
  </verify>
  <done>Web typecheck exits 0; the proxy route is a character-level mirror of the sync proxy except the upstream path and comment; the component renders the «Загрузить результаты» button disabled while either sync is pending, its handler posts the exact URL/body and produces the specified per-league Russian summaries through the shared status area, quota-refresh dispatch and conditional router.refresh() mirror `runSync`; no behavior of `runSync`, `autoSync` or the fixtures sync proxy changed.</done>
</task>

<task type="auto">
  <name>Task 3: Focused unit tests, gates, staging and one atomic commit</name>
  <files>tests/unit/results-sync-button-ui.test.tsx (new), tests/unit/internal-api-route.test.ts</files>
  <action>Create `tests/unit/results-sync-button-ui.test.tsx` following the repo's UI-test shape (`createElement` from `../../apps/web/node_modules/react/index.js`, `renderToStaticMarkup` from `../../apps/web/node_modules/react-dom/server.js`, vitest imports). Establish the router mock exactly as probed in context fact 7: `const refreshSpy = vi.hoisted(() => vi.fn())` and `vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshSpy }) }))` — the bare `next/navigation` specifier does NOT intercept from a root test file (probe-verified), do not use it. Cases: (1) static render of `DateRangeFilter` with `leagues: ["Премьер-лига"], competition: "", autoSync: false` contains both «Обновить матчи» and «Загрузить результаты», the `btn-secondary` class, and the hint's distinctive substring «публикует итоги завершённых матчей»; (2) driving the exported `runResultsSync` directly (it is the exact function the button's onClick calls — state this rationale in a test comment, since the node unit environment has no DOM library and installing one is out of scope): stub `fetch` with a 200 `Response` whose JSON is `{ results: [{ league: "Премьер-лига", status: "synced", fixtures: 3, results: 3 }] }`, stub `window` as `{ dispatchEvent: vi.fn() }`, pass a `setState` spy and a refresh spy, then assert fetch was called once with `"/internal-api/fixtures/results-sync"`, method `POST`, and a body whose parsed JSON deep-equals `{ force: true, competitions: ["Премьер-лига"] }`; the last `setState` call is `{ pending: false, message: "Премьер-лига: опубликовано 3 результатов", error: false }`; `window.dispatchEvent` was called once with a CustomEvent of type `fixtures-quota-refresh`; the refresh spy was called once; (3) same call with empty league and an all-`skipped` response: body deep-equals `{ force: true }` (no `competitions` key), message «Премьер-лига: уже опубликовано недавно», refresh NOT called while the quota event still fires; (4) a 503 `{ reason: "DETERMINISTIC_MODE" }` response yields the error message «Загрузка результатов недоступна в демонстрационном режиме без базы данных.» with no quota event and no refresh; (5) direct `formatResultsSyncResults` cases: `failed`/`PROVIDER_ACCESS_RESTRICTED` → «Премьер-лига: лига недоступна на тарифе провайдера», `failed`/`PROVIDER_REQUEST_FAILED` → «Премьер-лига: сбой запроса к провайдеру», `failed` with another reason → «Премьер-лига: отказ (RESULT_FIXTURE_UNRESOLVED)», `denied` → the same отказ fallback, and plurals for 1/2/5 published results («1 результат» / «2 результата» / «5 результатов»). Clean up with `afterEach` calling `vi.unstubAllGlobals()` and `vi.clearAllMocks()`.

Extend `tests/unit/internal-api-route.test.ts` (existing `vi.stubGlobal("fetch", …)` / `vi.stubEnv` pattern, existing `beforeEach`/`afterEach` already handle unstubbing): import `POST as postResultsSync` from `../../apps/web/app/internal-api/fixtures/results-sync/route.js` and add two cases for the new proxy — (a) fail-closed: `vi.stubEnv("OPERATOR_CREDENTIAL", "")` → 404 with body `{ message: "Not found" }` and the fetch stub NOT called (stub the credential explicitly either way, because the dev `.env` may or may not leak a value into the test process); (b) forwarding: `vi.stubEnv("OPERATOR_CREDENTIAL", "test-operator-secret")` with a 200 JSON fetch stub → upstream URL `http://api.test/internal/fixtures/results-sync`, method POST, header `x-operator-credential` equal to the secret, body passed through verbatim, response status 200 with `cache-control: private, no-store, max-age=0` and no credential in the response headers.

Then run the gates and commit. (1) `corepack pnpm vitest run tests/unit/results-sync-button-ui.test.tsx tests/unit/internal-api-route.test.ts` — targeted green. (2) `corepack pnpm vitest run --project unit` — full unit project green; the 3 deleted auto-scheduler tests drop out of the pre-change 294 baseline, so the expected total is 291 plus the new tests' count (≈298); the invariant is zero failures and every pre-existing test still passing (a lone engine warning about Node v25 vs engines <25 is expected noise). (3) `corepack pnpm --filter @bet-stats/web typecheck` — exit 0. (4) Do NOT run integration or e2e suites, the stack launcher, or any dev restart. (5) Stage ONLY `apps/web/app/internal-api/fixtures/results-sync/route.ts`, `apps/web/components/date-range-filter.tsx`, `tests/unit/results-sync-button-ui.test.tsx`, `tests/unit/internal-api-route.test.ts`; verify with `git diff --cached --name-only`; `.env`, `.gsd/**`, `.planning/**` and everything else stay unstaged. (6) Commit exactly once with subject `feat(web): add manual results publication button with operator proxy route` and an English bulleted body referencing 261017-pyp (auto-scheduler revert, fail-closed proxy, button + summaries, tests).</action>
  <verify>
    <automated>corepack pnpm vitest run --project unit && corepack pnpm --filter @bet-stats/web typecheck</automated>
  </verify>
  <done>Both test files pass targeted and in the full unit project (zero failures; expected count 291 + new tests); web typecheck exits 0; `git diff --cached --name-only` lists exactly the four plan code files; one commit exists with the required subject referencing 261017-pyp; no integration/e2e suite was executed and the dev stack was not restarted.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → Next internal-api proxy | Unauthenticated browser reaches a server-side route that gains authority to call operator-guarded endpoints |
| Next proxy → Nest internal fixtures API | Operator credential is injected server-side; the forwarded body is attacker-influencable |
| manual button → provider request budget | A force=true operator run consumes football-data.org RESULTS allowance |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261017pyp-01 | Spoofing / Elevation of Privilege | New proxy `apps/web/app/internal-api/fixtures/results-sync/route.ts` | high | mitigate | Exact mirror of the proven sync proxy: fail-closed 404 `{ message: "Not found" }` with no upstream call when `OPERATOR_CREDENTIAL` is absent; credential is read from server env only and attached as `x-operator-credential` at the proxy boundary; unit tests assert both the fail-closed 404 (fetch not called) and header forwarding. |
| T-261017pyp-02 | Information disclosure | Proxy response passthrough | medium | mitigate | The proxy copies only status, content-type and `cache-control: private, no-store, max-age=0` — never the credential or upstream-only headers; the browser bundle never contains the credential (server-side env read, same as all sibling internal-api routes). |
| T-261017pyp-03 | Denial of service / budget exhaustion | «Загрузить результаты» button sending `force: true` | medium | mitigate | Server-side gates unchanged: ResultsSyncService still enforces capability, the daily budget reservation per chunk and provider spacing, so a click can never exceed the provider allowance; the button optionally narrows to the selected league and is disabled while either sync runs; this plan REMOVES the only unattended results ticker. |
| T-261017pyp-04 | Tampering | Residual auto-scheduler code paths | low | mitigate | The service is restored to the committed manual-only HEAD (gated by `git diff --exit-code`) and its unit test is deleted, so no code path parses or reacts to the auto-interval variable; `.env` line removed as ops hygiene. |
| T-261017pyp-SC | Tampering | npm/pip/cargo installs | low | accept | No package installs and no new dependencies — tests use the existing vitest, react-dom/server and `vi.stubGlobal`/`vi.mock` (probe-verified router mock path); a DOM test library would require the package-legitimacy gate and is out of quick scope. |
</threat_model>

<verification>
Run in order and report actual output/exit codes:
1. `git diff --exit-code -- apps/api/src/modules/fixtures/results-sync.service.ts` exits 0; `Test-Path tests/unit/results-sync-auto.test.ts` is False; `.env` retains `FIXTURES_AUTO_SYNC=false` and the results auto-interval line is gone.
2. `corepack pnpm vitest run tests/unit/results-sync-button-ui.test.tsx tests/unit/internal-api-route.test.ts` — targeted green (button handler URL/body/summaries/quota-event/refresh semantics; proxy fail-closed and forwarding).
3. `corepack pnpm vitest run --project unit` — full unit project green (expected 291 + new tests; zero failures).
4. `corepack pnpm --filter @bet-stats/web typecheck` — exit 0.
5. Staging check: `git diff --cached --name-only` equals exactly the four code files; `.env`, `.gsd/**`, `.planning/**` absent; one commit with subject `feat(web): add manual results publication button with operator proxy route` referencing 261017-pyp.
6. No integration/e2e suite, no stack launcher, no dev restart — the orchestrator restarts the stack and live-verifies the button.
</verification>

<success_criteria>
- Auto results publication is fully gone: the service matches committed manual-only HEAD and no test or config references the removed scheduler.
- A user can press «Загрузить результаты» on the fixtures page, optionally scoped to one league, and sees honest per-league Russian summaries in the shared status area; the two buttons never clobber each other's messages.
- Successful publication refreshes the quota counter and page; failures render results-specific Russian copy; the proxy fails closed without the operator credential.
- Full unit project and web typecheck are green; exactly one atomic commit with the four plan code files staged.
</success_criteria>

<output>
Create `.planning/quick/261017-pyp-add-a-manual-load-results-button-to-the-/261017-pyp-SUMMARY.md` when done (docs artifacts are committed by the orchestrator per this plan's staging rules). The summary must state that DOM click simulation was impossible in the existing setup (node-env unit project, no DOM library anywhere in the store, installs out of scope) and that the behavioral tests drive the exact exported onClick handler with stubbed fetch/window, per the probe-verified router-mock recipe.
</output>
