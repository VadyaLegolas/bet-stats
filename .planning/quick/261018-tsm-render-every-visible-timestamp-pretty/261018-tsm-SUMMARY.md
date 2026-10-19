# Quick Task Summary: Render every visible site timestamp in the pretty display format

**Plan:** 261018-tsm
**Status:** complete
**Commit:** `4a9fbbf` — `render every visible timestamp in the pretty display format`

## What Changed

Every timestamp the user READS on the site is now a pretty Russian date-time in the display timezone, extending fast 261018r (fixture page only) across the whole site.

### Helper hardening - `apps/web/components/time-format.ts`

Called with arbitrary API values across the site, `formatInstant` got three guards:

- **ISO-shape gate** - only timestamp-shaped input is formatted, so an id like `2026` or a season like `PL` can never be mangled by `Date()`.
- **Calendar dates** - a plain date (`2026-09-20`) renders as a date with no invented time and no day shift.
- **Invalid zone / unparsable value** - falls back to the exact input instead of throwing a `RangeError` into the page.

+3 unit cases (`web` suite 53/56).

### Converted sites

| Surface | What was raw |
|---|---|
| `/teams/:id/evidence` | requested + resolved cutoffs, trace table (`Время действия`/`Время наблюдения`), both summary cards |
| `/methodology` | model-card `effectiveDate` + changelog dates |
| `/privacy` | policy effective date |
| data/provider state notices | `Захвачено`, `Время захвата`, `Обновление источника`, `Последний корректный захват` |
| `/internal/operations`, `/reconciliation`, `/replay` | operator timestamps |

Raw ISO survives in the `time[dateTime]` attribute and `title`, so every converted value stays verifiable on hover.

### Zone source follows the rendering boundary

- **Server components** read `DISPLAY_TIME_ZONE` directly - they never re-run in the browser, so there is no hydration risk.
- **Client components** take the zone from a server parent, from the payload, or from the browser. Every client timestamp renders only after a fetch, so SSR formats nothing and hydration stays clean.

### `displayTimeZone` injected at the web edge

`apps/web/app/internal-api/teams/[teamId]/evidence/route.ts` now annotates the payload with the env zone, so the evidence page's «Часовой пояс отображения» row is live and authoritative. A zone the API someday provides still wins.

### Left raw on purpose

Verification surfaces, not labels to read: workbench receipt/snapshot identifiers, the evidence reproduction receipt JSON, replay's exact-UTC scope, and receipt payload dumps.

## Verification

Gates green: `pnpm typecheck`, `pnpm test` (354 unit + 56 web, 7 files), `pnpm --filter @bet-stats/web build`.

Live on the running stack (console clean): `/methodology` («20 сентября 2026 г.», no invented time, no raw ISO), AC Monza evidence (14 formatted times, raw ISO only in `title`), Parma-Torino notices («Время захвата: 18 октября 2026 г. в 23:14»), `/privacy` (honest «Недоступно» while signed out), `/internal/operations` + `/internal/reconciliation`.

Two notes for the record:

- Lint reports 6 pre-existing `react-hooks/set-state-in-effect` errors and 13 problems total. Verified against a clean stash - all 6 predate this task and are unchanged (13 → 13). Lint is not a declared release gate for this project.
- The stack had died (0x40010004) mid-task and was restarted via `scripts\app-lifecycle.ps1`; the browser tab used for verification opened at 502 and recovered after restart.
