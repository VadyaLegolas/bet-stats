# Quick Task: Real upcoming matches — all leagues, manual refresh, auto-load

**Date:** 2026-10-15
**Type:** Product enablement (live data ingestion + UI)
**Requested:** (user) "сделай чтобы селект содержал все доступные лиги и сделай кнопку ручного
обновления, чтобы загружать все ближайшие матчи для всех выбранных лиг или чтобы при запуске
страницы сами загружались автоматически. Хочу уже начать пользоваться приложением, но не
отображаются ближайшие матчи для анализа"

## Findings (from exploration)

- Real keys exist in root `.env` (FOOTBALL_DATA_API_TOKEN, API_FOOTBALL_API_KEY); the API/worker
  read `process.env` only — `.env` must be exported by a launcher script.
- football-data.org client: `fetchCompetitionFixtures({competitionCode, dateFrom, dateTo})`,
  allowed codes `PL, PD, BL1, SA, FL1, CL, EL`; no teams endpoint.
- Fixture persist requires pre-existing `TeamExternalRef` rows — teams are NOT auto-created by
  the worker path; the sync service must create teams from the provider payload.
- Gating: `ProviderCapability` row (supported, non-expired) + `reservePriorityRequest`
  (ProviderRequestReservation, allowance/day per provider) from `@bet-stats/domain`.
- No existing HTTP sync trigger; `/internal/*` API routes use `OperatorGuard`
  (x-operator-credential, fail-closed 404); web proxies via `/internal-api/*` adding the
  server-side credential.
- e2e contract to keep: `getByLabel("Соревнование")).toHaveValue("Premier League")`
  (fixture-discovery, walking-skeleton) — deterministic mode must keep a single-option select.

## Design

1. **Seeding** `scripts/seed-configured-leagues.mjs` (idempotent): for the 7 football-data
   codes (PL/PD/BL1/SA/FL1/CL/EL) create canonical League + Season (2025 & 2026, so any real
   current season resolves) + football-data.org external refs + `ProviderCapability` FIXTURES
   rows (expiresAt +1y).
2. **API sync service** `POST /internal/fixtures/sync` (OperatorGuard): per selected league —
   capability check → budget reservation (allowance 100/day, headroom 20, lane critical) →
   `fetchCompetitionFixtures(now..now+7d)` → create missing Team/TeamExternalRef from payload →
   upsert Fixture + FixtureExternalRef + FixtureProvenance (same semantics as worker's
   persistCanonicalFixture). Per-league throttle: skip when provenance fresher than 6h unless
   `force`. Disabled (honest 503) unless `DATA_PROVIDER_MODE=live` + DATABASE_URL + token.
3. **API `GET /fixtures/leagues`**: DB mode → configured canonical leagues; deterministic →
   `["Premier League"]`. `GET /fixtures` accepts single `competition` unchanged (contract).
4. **Web**: league `<select>` populated from `/fixtures/leagues` with «Все лиги» option when
   several (deterministic single option keeps e2e contract); «Обновить матчи» client button →
   `/internal-api/fixtures/sync` proxy → shows per-league summary → `router.refresh()`; auto
   sync on mount when `FIXTURES_AUTO_SYNC=true` (server throttles), silent when unavailable.
5. **Launcher** `scripts/dev-full.ps1`: docker compose up, migrate deploy, seed leagues,
   export `.env`, start worker+api+web with `DATA_PROVIDER_MODE=live`.
6. **Verification**: typecheck, deterministic e2e (5 specs), phase06 accessibility+journey,
   then LIVE smoke: seed + sync Premier League ONLY (1 provider request), browser check that
   real upcoming matches render.

## Budget safety

Live smoke touches exactly 1 football-data.org request (Premier League, 7-day window).
Full 7-league sync = 7 requests/day — well under the 100/day free tier.

## Findings during implementation (live provider reality)

- football-data.org free tier **excludes UEFA Europa League** (403 "restricted... check your
  subscription"); EL sync is classified as `PROVIDER_ACCESS_RESTRICTED` and the UI shows
  «лига недоступна на тарифе провайдера». The EL football-data ref is kept as the canonical
  competition-code carrier.
- API-Football free plan authenticates but **blocks the current season 2026 entirely**
  ("Free plans do not have access to this season, try from 2022 to 2024") — an api-football
  fetch path would not deliver upcoming fixtures either, so it was deliberately not built.
- Sync race (P2002 crash observed in API log) fixed: promise-chain mutex serializes runs;
  fixture+external-ref created in `$transaction` with adopt-winner catch; `ensureTeam` runs in
  an interactive transaction; `PROVIDER_MIN_SPACING_MS=3000` between provider fetches
  (free tier 10 req/min).
- Freshness for scheduled fixtures is driven by OUR observation age
  (`capturedAt` > 6h30m threshold), not the provider record mtime; deterministic rows stay
  LIMITED.
- Next 16 dev blocks requests whose Origin host ≠ init hostname (dead hydration via
  127.0.0.1); fixed with `allowedDevOrigins: ["127.0.0.1"]` in `apps/web/next.config.ts`.
- Unfiltered `GET /fixtures` now lists only leagues with football-data external refs
  (hides e2e junk "Live Workbench League" from the UI).

## Checklist

- [x] Seed script for configured leagues/seasons/refs/capabilities
- [x] API: sync service + POST /internal/fixtures/sync + GET /fixtures/leagues
- [x] Web: league select from API, sync button + proxy + optional auto-sync
- [x] dev-full launcher script
- [x] Verify: typecheck api+web; unit 248+5; deterministic e2e 21/21 (public-shell,
      fixture-discovery, walking-skeleton, team-evidence, reconciliation-review);
      forecast-workbench 3/3 (DATABASE_URL); phase06 accessibility+journey 22/22 (axe clean)
- [x] LIVE smoke: sync all 7 leagues → 6 loaded (PL 10, BL1 9, La Liga 11, Ligue 1 9,
      Serie A 10, CL 18; EL → PROVIDER_ACCESS_RESTRICTED); browser QA: 67 fixture links,
      all «Доступно» badges, zero console errors — screenshot `fixtures-live.png`
- [x] STATE.md + atomic commit
