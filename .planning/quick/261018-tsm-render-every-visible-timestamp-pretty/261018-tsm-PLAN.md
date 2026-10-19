# Quick Task: Render every visible site timestamp in the pretty display format

## Objective

Continue fast 261018r («Начало (Europe/Warsaw)» on the fixture page) to the whole site: every raw ISO timestamp a user READS becomes a human Russian date-time in the display timezone, while the machine value stays verifiable.

**User request:** «измени все временные метки на сайте в красивый формат».

## Policy (locked)

- **Readable UI text → pretty** via shared `formatInstant(value, timeZone)` (`ru-RU`, `dateStyle: long`, `timeStyle: short`) with the raw ISO preserved in `title` and/or the `time[dateTime]` attribute.
- **Zone source:** server components read `process.env.DISPLAY_TIME_ZONE ?? "UTC"` directly (they never re-run in the browser → no hydration risk); client components/pages receive the zone explicitly (prop from a server parent, the evidence payload's `displayTimeZone`, or the browser zone — every timestamp on those pages renders only after a client fetch, so SSR never formats and hydration stays clean).
- **Stays raw on purpose (verification surfaces, same rationale as fast 261018r):** workbench «Точные квитанции» / «Точная неизменяемая квитанция» blocks and `forecastOptionLabel` snapshot identifiers, the evidence reproduction receipt `<pre>` JSON, replay's «Точная область» exact-UTC scope, receipt payload `String(value)` dumps, `SourceRefItem` hover titles. Raw ISO in these places is the data being verified, not a label to read.
- **Already-pretty local formatters are left alone:** `local-data-block.visibleTime` («06 сент. 2026, 03:00 GMT+2»).
- **`formatInstant` hardening (new):** only timestamp-shaped input is formatted (`/^\d{4}-\d{2}-\d{2}([Tt ].*)?$/` — so ids like `2026` or `PL` can never be mangled), plain calendar dates (`2026-09-20`) render as a date with no invented time in UTC (no day shift), an invalid zone falls back to the exact input instead of throwing.

## Inventory → tasks

| # | Site (file) | Raw sites | Zone source |
|---|---|---|---|
| 1 | `components/time-format.ts` + test | — | hardening: ISO gate, date-only, invalid-zone fallback |
| 2 | `components/data-state-notice.tsx` | «Захвачено», «Обновление источника» | server: env |
| 3 | `components/provider-state-notice.tsx` | «Время захвата», «Последний корректный захват» | server: env |
| 4 | `app/methodology/page.tsx` | effectiveDate ×2 (date-only!) | server: env |
| 5 | `app/teams/[teamId]/evidence/page.tsx` | summary sourceUpdatedAt, trace effectiveAt/observedAt, requestedAsOf, resolvedAsOf (+drop «(UTC)» label, now zoned) | payload `displayTimeZone` ∥ browser zone; SummaryCard/EvidenceTraceTable gain a required zone prop |
| 6 | `app/internal-api/teams/[teamId]/evidence/route.ts` | — | inject `displayTimeZone` from env so the «Часовой пояс отображения» row is live and authoritative |
| 7 | `tests/unit/evidence-trace-ui.test.ts` | 4 renders + 2 markup assertions | pass `Europe/Warsaw` |
| 8 | `app/privacy/page.tsx` | «Дата вступления в силу» effectiveAt | browser zone (post-fetch) |
| 9 | `app/internal/pipeline/replay/page.tsx` | «Срок действия предпросмотра» expiresAt | existing `displayTimeZone` state |
| 10 | `app/internal/reconciliation/page.tsx` | «захвачено …» capturedAt | browser zone |
| 11 | `app/internal/operations/page.tsx` | unify `date()` (locale/zone-dependent custom format) onto `formatInstant` | browser zone |

## Gates

`pnpm typecheck` → `pnpm test` (unit + web incl. updated assertions) → `pnpm --filter @bet-stats/web build` → live browser pass: evidence page (pretty times + zone row), methodology (date-only), fixture page notice block («Захвачено: …»), privacy (policy date), console clean.

## Commit

One atomic code commit + one docs commit (`.planning/` STATE + this task's artifacts).
