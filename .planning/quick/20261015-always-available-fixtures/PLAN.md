# Quick Task: Always-available fixtures, Premier League only

**Date:** 2026-10-15
**Type:** Data availability / UX
**Requested:** (user) "сделай сам чтобы матчи были доступны постоянно и я вижу только
выбор премьер лиги а остальные чемпионаты не вижу"

## Root cause

- Bare `/fixtures` queries the API with the default window `now → now+48h`
  (`parseRange`), but the deterministic dev provider row (`fixture-premier-league-001`)
  had a hard-coded kickoff `2026-08-29` — in the past since August, so the default
  window never matches → empty list.
- Without an explicit `competition` param the API returns every league, so in DB mode
  non-Premier-League rows (e.g. `Live Workbench League`) could also appear.

## Fix

1. **Rolling kickoff** (`fixtures.service.ts`): deterministic row kickoff computed per
   request as *today 14:00 UTC, otherwise tomorrow 14:00 UTC* — always inside the
   default 48-hour window, stable within a day, no DB/seed dependency. `sourceUpdatedAt`
   stays `null`, so `classifyFreshness` keeps `LIMITED` forever (freshness bands never
   apply) — provenance assertions stay green.
2. **Competition default** (`fixtures/page.tsx` `load()`): when the URL carries no
   `competition`, request `competition=Premier League` — only Premier League is ever
   listed; the filter already offers no other option.

## Test updates (fixed-date → rolling)

- `fixture-discovery.spec.ts`: explicit Aug-2026 ranges → `now-1h … now+48h`; the RU
  date-group heading assertion becomes a `ru-RU` long-format regex
  (`/^[А-ЯЁ][а-яё]+, \d{1,2} [а-яё]+ \d{4}$/`).
- `walking-skeleton.spec.ts`: same rolling range; drop the now-meaningless
  `FIXED_NOW` browser clock freeze (timezone stays `Europe/Warsaw`).
- `team-evidence.spec.ts`: the fixture→evidence link `asOf` comes from the detail
  kickoff (now rolling) → read it from `GET /fixtures/fixture-premier-league-001`
  instead of the constant. Stub payloads keep the fixed 2026-08-29 instant.

## Not affected (verified)

- DB branch of `FixturesService` (phase06 live stack, forecast-workbench) untouched.
- Release specs on bare `/fixtures` assert only nav/skip-link, never list content;
  live stack does seed `Premier League`, so the competition default is a no-op there.
- Unit/integration tests carry their own fixtures.

## Checklist

- [x] Rolling kickoff in `fixtures.service.ts`
- [x] `competition=Premier League` default in `fixtures/page.tsx`
- [x] Update fixture-discovery / walking-skeleton / team-evidence to rolling dates
- [x] Verify: typecheck api+web ✓; deterministic e2e 21/21 ✓; forecast-workbench 3/3 ✓; phase06 live e2e 74/74 ✓
- [x] Browser sanity: bare `/fixtures` shows the match, single-option Premier League select ✓ (`test-results/sanity-bare-fixtures.png`)
- [x] STATE.md + atomic commit
