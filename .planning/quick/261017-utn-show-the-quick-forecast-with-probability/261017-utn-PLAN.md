# Quick Task: Show the quick forecast with probability percentages in the fixtures analysis list

## Objective

On the Анализ page (`/fixtures`, `apps/web/app/fixtures/page.tsx`), each fixture card in the list must show the quick 1X2 forecast inline: «Прогноз: П1 52% · Х 26% · П2 22%», or an honest fallback «Прогноз пока не выпущен» when no forecast has been issued yet (manual fixture sync may outrun the forecast sweep).

**Design principle (locked):** display-only, additive contract. `GET /fixtures` items gain one new optional-at-the-web field `forecast`; `GET /fixtures/:fixtureId` (single fixture), the workbench page, and every `packages/domain` receipt/contract stay untouched. The API never fails because of this enrichment (try/catch around the snapshot query → empty map). Raw enum codes (`HOME`/`DRAW`/`AWAY`, `INITIAL`/`PRE_MATCH`/…) must never reach the UI.

**Verified data facts:** `FixturesService.list()` (`apps/api/src/modules/fixtures/fixtures.service.ts` line 112) returns Prisma rows (DB mode) or a `deterministicFixtureRow(new Date())` demo row (no `DATABASE_URL`), each projected via `project()`; the controller returns the result as-is. Available forecasts live in `ForecastSnapshot` (`packages/database/prisma/schema.prisma` line 612: `fixtureId`, `kind`, `state`, `revision`, `cutoff`, `probabilities` Json, `issuedAt`); "available" = `state: "ISSUED"`. Latest-first ordering precedent: `packages/database/src/forecast-repository.ts` `listIssued` — `orderBy: [{ issuedAt: "desc" }, { cutoff: "desc" }, { revision: "desc" }, { id: "asc" }]`. `probabilities` Json shape: `Record<"ONE_X_TWO" | "OVER_UNDER_2_5" | "BTTS", readonly ForecastEvent[]>` with `ForecastEvent = { selection, probability, fairOdds }`; the ONE_X_TWO selections are `HOME`/`DRAW`/`AWAY` (contract validator `packages/domain/src/forecast/contract.ts`).

## Tasks

### Task 1 — API: `forecast` enrichment on `GET /fixtures` + API-side tests

**Files:**
- `apps/api/src/modules/fixtures/fixtures.service.ts` (edit)
- `apps/api/src/modules/fixtures/fixtures.controller.ts` (edit — `list()` return type only)
- `tests/unit/fixtures-list-forecast.test.ts` (create)

**Actions:**
1. New exported type next to `FixtureProjection`:
   `export type AttachedForecast = { kind: string; cutoff: string; probabilities: { home: number; draw: number; away: number } };` (`cutoff` as ISO string).
2. New exported PURE function `summarizeLatestForecasts(rows: readonly { fixtureId: string; kind: unknown; cutoff: Date | string; probabilities: unknown }[]): ReadonlyMap<string, AttachedForecast>` with these exact semantics (document the fall-through choice in a doc comment):
   - The caller pre-sorts rows newest-first (the `listIssued` orderBy above); the function preserves input order and processes row by row.
   - A fixtureId that already has an accepted summary is skipped entirely (first accepted row wins).
   - Per-row validation ("valid" = all pass, else the row is skipped and a LATER row for the same fixture may still be accepted — this is the documented fall-through when the newest snapshot's `probabilities` are malformed):
     - `fixtureId` non-empty string; `kind` non-empty string; `cutoff` is a `Date` or string parsing to a valid date → stored as `cutoff.toISOString()`;
     - `probabilities` is a non-null object whose `ONE_X_TWO` is an array containing at least one event per selection `HOME`, `DRAW`, `AWAY` — match each event BY its `selection` value (position-independent; first matching event wins, extra/unknown events ignored);
     - each matched event's `probability` is a `number`, `Number.isFinite`, and within `[0, 1]`.
   - Returns a `ReadonlyMap` keyed by fixtureId containing only valid rows, values `{ kind, cutoff, probabilities: { home, draw, away } }`.
3. Wire into `list()` — DB path only:
   - After the existing `fixture.findMany`, if `rows` are non-empty run a second query inside try/catch:
     `this.database.forecastSnapshot.findMany({ where: { fixtureId: { in: rows.map((row) => row.id) }, state: "ISSUED" }, orderBy: [{ issuedAt: "desc" }, { cutoff: "desc" }, { revision: "desc" }, { id: "asc" }], select: { fixtureId: true, kind: true, cutoff: true, probabilities: true } })`
     — on ANY throw, treat the result as `[]` (the list endpoint must never fail because of forecast enrichment).
   - `const forecastByFixture = summarizeLatestForecasts(snapshotRows);` then attach at projection stage:
     `(await Promise.all(rows.map(async (row) => project(row, await this.providerState(row))))).map((item) => ({ ...item, forecast: forecastByFixture.get(item.id) ?? null }))`.
   - Deterministic path (`this.database` null): no snapshot query, empty map → the demo row automatically gets `forecast: null` (no special-casing).
   - Types: new exported `type FixtureListProjection = FixtureProjection & { forecast: AttachedForecast | null };` and `list()` returns `{ items: readonly FixtureListProjection[]; range: ... }`. `FixtureRow` stays unchanged — `forecast` is a projection-stage attachment, not a DB row field (fixtures rows are returned to the controller as-is, so serialization is automatic).
   - `detail()` stays byte-identical: `GET /fixtures/:fixtureId` response shape unchanged.
4. `apps/api/src/modules/fixtures/fixtures.controller.ts`: update the `list()` method's Promise type to `{ items: readonly FixtureListProjection[]; range: { from: string; to: string } }` (import `FixtureListProjection` alongside the existing `FixtureProjection` import). `detail()` untouched.
5. Create `tests/unit/fixtures-list-forecast.test.ts` — import `summarizeLatestForecasts` from `../../apps/api/src/modules/fixtures/fixtures.service.js` (proven import path: `tests/unit/fixtures-sync.test.ts` already imports `projectProviderState` from that file; the root vitest `unit` project resolves the `@bet-stats/*` aliases). Cover:
   - two ISSUED rows for the same fixtureId (pre-sorted newest first) → the newest accepted, the older ignored;
   - newest row has malformed `probabilities` (e.g. missing the `AWAY` event) → falls through and the next valid row for that fixture is accepted;
   - missing `ONE_X_TWO` key → row skipped; `ONE_X_TWO` holding foreign selections (e.g. `OVER_2_5`/`UNDER_2_5`) → skipped; fewer than HOME+DRAW+AWAY → skipped;
   - non-finite probability (`NaN`, `Infinity`) and out-of-range values (`1.2`, `-0.1`) → row skipped;
   - position-independent matching: array ordered `AWAY, DRAW, HOME` still maps correctly;
   - `kind: ""` → row skipped; `cutoff: new Date("2026-10-17T12:00:00.000Z")` → ISO string in the summary; string cutoff passes through as ISO;
   - empty input → empty `Map`; a fixture whose only rows are invalid → absent from the map.

**Verification:** `pnpm vitest run --project unit tests/unit/fixtures-list-forecast.test.ts` exits 0 (all new cases green), and `pnpm --filter @bet-stats/api typecheck` exits 0.

### Task 2 — Web: `FixtureForecastLine` on each fixture card + tests

**Files:**
- `apps/web/app/fixtures/page.tsx` (edit)
- `apps/web/app/globals.css` (edit — no suitable existing class, `.fixture-forecast` is new)
- `tests/unit/fixtures-forecast-ui.test.tsx` (create)

**Actions:**
1. Per `apps/web/AGENTS.md`, consult the Next.js docs under `apps/web/node_modules/next/dist/docs/` before touching the page — this stays a display-only change inside the existing server component (no routing/file-convention change expected).
2. The `Fixture` type (line 6) gains:
   `forecast?: { kind?: string; cutoff?: string; probabilities?: { home?: unknown; draw?: unknown; away?: unknown } } | null`
   — all fields optional so a stale API that sends no `forecast` at all still typechecks and renders the fallback.
3. New exported pure helper `forecastPercentages(probabilities: { home: number; draw: number; away: number } | undefined | null): { home: number; draw: number; away: number } | null`:
   - `undefined`/`null` input → `null`; any of the three not a finite number or negative → `null`;
   - `sum = home + draw + away`; documented tolerance: if `sum < 0.9` or `sum > 1.1` → `null`; otherwise normalize proportionally `p = value / sum` and scale ×100;
   - largest-remainder rounding: floor each scaled value, then distribute the `100 - Σfloors` shortfall (one point each) to the largest fractional remainders first, ties broken deterministically home → draw → away, so the three integers ALWAYS sum to exactly 100;
   - returns the integer triple `{ home, draw, away }`.
4. New exported presentational component `FixtureForecastLine({ forecast }: { forecast?: { kind?: string; cutoff?: string; probabilities?: { home?: unknown; draw?: unknown; away?: unknown } } | null })`:
   - Narrow defensively: treat `probabilities` as usable only when `home`, `draw`, `away` are ALL `typeof "number"`, then run `forecastPercentages` on the numeric triple; anything else counts as absent;
   - valid percentages → `<div className="fixture-forecast">Прогноз: П1 {h}% · Х {d}% · П2 {a}%</div>` (literal `·` separators);
   - absent/invalid → `<div className="fixture-forecast fixture-forecast--pending">Прогноз пока не выпущен</div>`;
   - NEVER render raw codes (`HOME`/`DRAW`/`AWAY`, kind codes) — only the Russian labels and integers.
5. Render `<FixtureForecastLine forecast={fixture.forecast} />` inside each `<li className="fixture-card">` — after the `fixture-header` div, before the `fixture-badges` div.
6. `apps/web/app/globals.css`: add the two rules next to the `.fixture-badges` block (keep minimal, consistent with `.fixture-meta`):
   `.fixture-forecast { color: var(--color-text-secondary); font-size: 0.9rem; font-variant-numeric: tabular-nums; margin: 0; }` — spacing comes from the card's existing flex `gap`, exactly like `.fixture-meta` which also sets `margin: 0`;
   `.fixture-forecast--pending { font-style: italic; }`.
7. Create `tests/unit/fixtures-forecast-ui.test.tsx` following the `tests/unit/provider-state-ui.test.tsx` / `tests/unit/evidence-trace-ui.test.ts` pattern (`createElement` from `apps/web/node_modules/react/index.js`, `renderToStaticMarkup` from `apps/web/node_modules/react-dom/server.js`, node environment, no jsdom; import `{ forecastPercentages, FixtureForecastLine }` from `../../apps/web/app/fixtures/page.js` — importing a page module that uses `next/link` is a proven pattern via `tests/unit/evidence-trace-ui.test.ts`). Cover:
   - `forecastPercentages`: `{0.52, 0.26, 0.22}` → `{52, 26, 22}`; `{0.3333, 0.3333, 0.3334}` → `{33, 33, 34}` (remainder goes to the largest fraction); `{0.5, 0.3, 0.2}` → `{50, 30, 20}`; tie-break case `{0.335, 0.335, 0.33}` → `{34, 33, 33}` (equal remainders → home first); within-tolerance normalization `{0.52, 0.26, 0.23}` (sum 1.01) → `{52, 26, 22}`; every result sums to exactly 100;
   - `forecastPercentages` nulls: `undefined`, `null`, `NaN`, negative value, `1.2`, sum below tolerance `{0.2, 0.15, 0.15}`, sum above tolerance `{0.7, 0.4, 0.3}`;
   - `FixtureForecastLine` markup via `renderToStaticMarkup`: valid forecast renders exactly «Прогноз: П1 52% · Х 26% · П2 22%»; `forecast={null}` and `forecast={undefined}` render «Прогноз пока не выпущен» with class `fixture-forecast--pending`; invalid probabilities (string/NaN values) render the fallback; the rendered markup contains NONE of the raw codes `HOME`, `DRAW`, `AWAY` (design test fixture data so those substrings cannot leak through ids);
8. Existing-tests guard (grep before finalizing, all stay green WITHOUT edits): `tests/unit/provider-state-ui.test.tsx` and `tests/unit/responsible-copy.test.ts` read `apps/web/app/fixtures/page.tsx` source and assert specific copy present/absent; `tests/integration/phase-01-security.test.ts` asserts the page source matches none of the quoted literals `prediction`/`odds`/`value` or `coming soon` — the new Russian forecast copy introduces none of those.

**Verification:** `pnpm vitest run --project unit tests/unit/fixtures-forecast-ui.test.tsx` exits 0 and `pnpm --filter @bet-stats/web typecheck` exits 0.

### Task 3 — Gates + one atomic commit

**Files:** none new; gates + staging only.

**Actions:**
1. Full gates (all must pass; test counts must GROW, not shrink):
   - `pnpm test` at repo root (root unit project + `@bet-stats/web` tests — currently 314 unit tests in 36 files + 13 web tests in 2 files, all green today);
   - `pnpm --filter @bet-stats/web typecheck`;
   - `pnpm --filter @bet-stats/api typecheck`.
2. Commit — ONE atomic English-conventional commit, staging EXPLICIT paths only (never `git add -A`):
   - `apps/api/src/modules/fixtures/fixtures.service.ts`
   - `apps/api/src/modules/fixtures/fixtures.controller.ts`
   - `apps/web/app/fixtures/page.tsx`
   - `apps/web/app/globals.css`
   - `tests/unit/fixtures-list-forecast.test.ts`
   - `tests/unit/fixtures-forecast-ui.test.tsx`
   - Message: `feat(api,web): show quick forecast probabilities in fixtures analysis list`
   - Do NOT stage `.gsd/dispatch-isolation-sentinel.json`, `.env`/`.env2`, docs, or `.planning/`.
3. Write `.planning/quick/261017-utn-show-the-quick-forecast-with-probability/261017-utn-SUMMARY.md` next to this plan (what changed, test counts before/after, any live-data observations such as how many fixtures got a forecast vs the fallback). Do NOT commit it — the orchestrator handles docs/STATE.md in a separate commit.

**Verification:** `git show --stat HEAD` shows exactly the six staged files; `git status --porcelain` clean except intentionally-untracked planning files.

## Risks / notes

- Both dev servers (:3000 web, :3001 API) are live and run from compiled dist — NEVER restart or rebuild them; live verification of the new `forecast` field and the card line is the orchestrator's job after execution.
- The snapshot enrichment is wrapped in try/catch by design: on any DB error `GET /fixtures` degrades to all-fallback cards (`Прогноз пока не выпущен`) but never 500s.
- Deterministic demo mode (no `DATABASE_URL`) always shows the fallback line — expected and honest; do not fake a forecast there.
- `summarizeLatestForecasts` treats rows as pre-sorted and is order-dependent by contract — the caller owns the `orderBy` (same tuple as `forecast-repository.ts` `listIssued`).
- Malformed-newest fall-through is an explicit, tested choice: a corrupt newest snapshot lets the next valid ISSUED row for that fixture surface instead of hiding the forecast entirely.
- The web tolerance window `[0.9, 1.1]` with proportional normalization plus largest-remainder rounding guarantees the three displayed integers always sum to exactly 100 — the percentages are presentational; the immutable `probabilities` contract in `packages/domain` is never touched or rewritten.
- Additive-only contract: single-fixture `detail()`, the workbench `/fixtures/[fixtureId]`, `FixtureProjection` consumers, and all receipt validators remain unchanged; the web `Fixture` type is tolerant of a stale API omitting `forecast` entirely.
