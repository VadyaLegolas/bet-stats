# Quick Task: Beautiful used/remaining fixture-sync request quota counter in the site header

**Date:** 2026-10-15
**Type:** Product feature (quota transparency)
**Requested:** (user) "Сделай сверху сайта счётчик использованных лимитов и оставшихся лимитов на
запросы для обновления матчей. Найди информацию когда сбрасывают лимиты и сделай чтобы в этом
счётчик тоже происходил сброс чтобы можно было следить за остатком лимитов. Сделай счётчик
красивым."

## Research findings

- **football-data.org free tier (measured live, 2026-10-15, 1 request from today's budget):**
  response headers `X-RequestCounter-Reset: 60` + `x-requests-available-minute: 9` → the
  provider limits **10 requests/minute**, rolling window **reset every 60 seconds**; there is
  **no daily counter header** from the provider.
- **Our daily budget** (project config): `DAILY_ALLOWANCE = 100`, `CRITICAL_HEADROOM = 20`,
  reservations keyed by `requestDate` (UTC date) in `ProviderRequestReservation` — resets at
  **00:00 UTC** by construction (`reservePriorityRequest` with `resetTimezone: "UTC"`).
  `ProviderRequestReservation.reservedAt` exists → rolling-minute usage is computable.
- Budget enforcement counts **provider-wide** rows for the current UTC day
  (`request-budget.ts` line 116), so the counter must report the same scope.
- Header: `apps/web/app/layout.tsx` → `.release-header-inner` flex row (brand | nav).
  e2e contracts: `public-shell` asserts only H1+footer; `release-accessibility` scopes nav by
  role name «Основная навигация» and checks menu-button behavior at 390px + axe + 320px
  reflow → the badge must live **outside** the `<nav>`, stay inside 320 CSS px, and carry an
  accessible name for its meter.

## Design

1. **API** `GET /fixtures/quota` (public, registered before `/fixtures/:fixtureId`):
   `{ provider, daily: { used, allowance, remaining, resetAt, resetTimezone: "UTC" },
   minute: { used, limit: 10, remaining, windowSeconds: 60 } }`.
   - `used` = `count(*)` of `ProviderRequestReservation` where provider + `requestDate` = today
     UTC (same scope as enforcement); minute `used` = rows with `reservedAt >= now()-60s`.
   - `resetAt` = next UTC midnight → client renders live countdown and **resets the counter**
     (refetch when countdown hits 0 and on every 60s poll).
   - Shared constants move to `fixtures-budget.ts` (PROVIDER, DAILY_ALLOWANCE,
     CRITICAL_HEADROOM); deterministic mode (no DB) reports 0 used / 100 allowance.
2. **Web** `components/quota-counter.tsx` (client) + `GET /internal-api/fixtures/quota`
   proxy route (same pattern as sync proxy):
   - pill in the header (inside a new `.release-header-tools` wrapper with the nav): small-caps
     label «Лимиты обновления матчей», big `used/allowance`, «осталось N», slim progress meter,
     «Сброс через X» live countdown + «00:00 UTC», footer «Провайдер: N/10 за минуту · окно 60 с».
   - refresh triggers: mount, 60s poll, `fixtures-quota-refresh` window event (dispatched by
     the sync button after a successful refresh), countdown zero-crossing.
   - RU plural formatting (запрос/запроса/запросов) + countdown (X ч Y мин / <1 мин → секунды).
   - responsive: label/meter scale down ≤720px, provider line hidden ≤480px; must fit 320px.
3. **CSS** `.quota-counter*` in globals.css using design tokens (surface, border, accent bar).

## Checklist

- [x] API: shared budget constants + `GET /fixtures/quota` (+ deterministic fallback)
- [x] Web: internal-api quota proxy + QuotaCounter component + header wiring + refresh event
- [x] CSS: beautiful pill with meter, countdown, responsive rules
- [x] Unit test for RU plural/countdown formatting
- [x] Verify: typecheck api+web, unit tests (root 248 + web 13), live browser QA (real numbers,
      desktop/390/320 screenshots, zero console errors, no horizontal overflow),
      deterministic e2e 21/21, phase06 release-journey + release-accessibility 22/22 (axe,
      320px reflow, mobile nav)
- [x] STATE.md + atomic commit + push to origin/main

## Results / notes

- Measured live (2026-10-15): football-data.org free tier exposes **10 req/min** via response
  headers `X-RequestCounter-Reset: 60` + `x-requests-available-minute` (rolling 60 s window);
  there is **no provider daily counter header** — the 100/UTC-day guard rail is our own policy
  and resets at 00:00 UTC by construction of `ProviderRequestReservation.requestDate`.
- **e2e contract collision (fixed):** `team-evidence.spec.ts` D-19 asserts the page contains
  no element whose exact text is `"0"` (guards against rendering null sample as zero). The
  counter's initial markup rendered `<strong>0</strong>` + `из 100` in the header, which
  matched that assertion on every page. Fixed by rendering `used/allowance` as a **single text
  node** (`<strong>28/100</strong>`, no bare number element) — test contracts untouched.
