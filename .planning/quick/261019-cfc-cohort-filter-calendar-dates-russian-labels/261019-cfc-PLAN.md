# Quick Task: Cohort filter on /scorecards with Russian labels and a calendar date picker

## Objective

The user's screenshot shows the exact-cohort form on `/scorecards` reading like an API dump: raw keys as labels (`modelVersion`, `competitionId`, `market`, `from`, `to`) and raw ISO instants as field values (`2025-10-20T13:14:45.531Z`). Make the period pickable by calendar, name the fields in Russian, and update the FAQ to describe the result.

**User request:** «сделай красивый выбор дат и более понятным языком, переделай изменения в faq».

## Findings (verified in code)

- `apps/web/app/scorecards/scorecard-dashboard.tsx:73` maps the five raw keys into labels and text inputs, one uniform code path.
- The API contract is strict: `parseCohortQuery` → `exactUtc` (`evaluation.service.ts:84-86`) requires `YYYY-MM-DDTHH:mm:ss.sssZ` and throws `INVALID_FROM`/`INVALID_TO` otherwise. So a calendar day must be converted back to an instant on submit — the day is never sent as-is.
- Selection is `kickoffUtc: { gte: from, lt: to }` (`:140`, `:191`, `:200`): `from` inclusive, `to` exclusive.
- `type="date"` values are ISO days only, so an instant cannot be stuffed into the value. `defaultValue` on a date input would be dropped as invalid (today's date) and would silently corrupt the cohort — so the instant→day mapping must produce a `date`-shaped initial value.
- The existing fixtures filter already solves this exact problem (`components/date-range-filter.tsx`): `toDateInput(value, end)` floors to a UTC day, walking `to` back one millisecond first because its bound is exclusive. Same semantics here, so the behaviour matches `/fixtures`.
- Reusable today: `formatInstant` (`components/time-format.ts`) — hardens against non-timestamp shapes and invalid zones, and keeps the raw value exact.
- `tests/unit/scorecard-ui.test.tsx:68` asserts the button order by the submit-button text `Применить точную когорту`; `:72` asserts `canonicalScorecardQuery` emits the exact instants. Neither may regress.

## Policy (locked)

- Labels in Russian: «Версия модели», «Соревнование», «Рынок», «Период с», «Период по».
- `from`/`to` become `type="date"` pickers in UTC days, matching `/fixtures` semantics: the picked start day begins at `T00:00:00.000Z` (inclusive), the picked end day is closed by the next day's start (exclusive), so the whole end day is kept.
- The submitted values stay exact instants; the API contract is untouched.
- The three dimension fields stay free text: they are a narrow, expert tool and enumerating them would need a new API surface. Clarity comes from the labels, not from inventing options.
- Submit button text `Применить точную когорту` is preserved (test-locked and accurate).
- FAQ gains the label mapping and the UTC/inclusive-end-day rule.

## Tasks

1. `apps/web/components/cohort-filter.tsx` — new client component: Russian labels, two UTC day pickers, hidden exact `from`/`to` carrying the instants, three text dimensions, submit button.
2. `apps/web/app/scorecards/scorecard-dashboard.tsx` — mount it instead of the inline raw-key form.
3. `tests/unit/scorecard-ui.test.tsx` — Russian labels, ISO-free visible text, exact instants still submitted, ordering test kept green.
4. `apps/web/app/faq/page.tsx` — describe the cohort filter in plain language.
5. `scripts/capture-faq-screenshots.mjs` — recapture `scorecards.png`; its alt text names the old filter wording.

## Gates

`pnpm typecheck` → `pnpm test` (unit + web) → `pnpm --filter @bet-stats/web build` → live check on `/scorecards` (labels, date pickers, no raw ISO visible, submit produces a working cohort, console clean) → recapture scorecards.png.
