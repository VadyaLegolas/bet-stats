---
phase: quick-261019-cfc
status: complete
---

# Quick 261019-cfc: Cohort filter with calendar dates and Russian labels — Summary

## Objective (user request)

«сделай красивый выбор дат и более понятным языком, переделай изменения в faq» — the exact-cohort
form on `/scorecards` read like an API dump (raw keys `modelVersion`/`competitionId`/`market`/
`from`/`to` as labels, raw ISO instants as values). Make the period pickable by calendar, name the
fields in Russian, and describe the result in the FAQ.

## What changed

### New components
- `apps/web/components/cohort-filter.tsx` — client filter: Russian labels («Период с (по UTC)»,
  «Период по (включительно, по UTC)», «Версия модели», «Соревнование», «Рынок»), two `type="date"`
  UTC day pickers, three text dimensions, full-width `filter-hint`, submit button. Built on
  `next/form`'s `<Form action="/scorecards">` — Next 16's GET form: client-side navigation on
  submit with a native GET fallback when JS is off (`method` must not be passed to `<Form>`).
- `apps/web/app/scorecards/cohort-identity.ts` — `resolveCohortIdentity`: the evaluation API takes
  the identity as all three dimensions or none (400 `INCOMPLETE_COHORT_IDENTITY` on a partial set,
  308 canonicalization when fully absent, quick 261016-k3w). Rule is "mentioned vs. absent", not
  "filled vs. empty": a cleared dimension becomes the API's `all` sentinel (empty string would also
  fail `scalar()` → `INVALID_*`), an identity that never was in the URL stays absent.

### Changed
- `apps/web/app/scorecards/cohort-bounds.ts` — `toApiInstant`: a day-shaped `from` opens at
  `T00:00:00.000Z`, a day-shaped `to` closes at the next day's start, so the API's `lt` bound keeps
  the whole picked end day. Instants pass through byte-identical (existing contract).
- `apps/web/app/scorecards/page.tsx` — `fetchEvidence` routes both identity and bounds through the
  two helpers; page source itself unchanged otherwise.
- `apps/web/app/scorecards/scorecard-dashboard.tsx` — inline raw-key `<form>` replaced by
  `<CohortFilter identity={...} />` inside the same panel.
- `apps/web/app/faq/page.tsx` — new paragraph in «Результаты» describing the filter: UTC calendar
  period, inclusive end day, empty dates = default 365 days, the three exact identifiers and their
  "empty = don't restrict" meaning, and that applying rewrites the address to the exact query.
  Screenshot alt text updated to name the calendar picker.
- `scripts/capture-faq-screenshots.mjs` — optional shot-name argument to recapture one screenshot
  instead of all six (`node scripts/capture-faq-screenshots.mjs scorecards`).
- `apps/web/public/images/faq/scorecards.png` — recaptured (1600×1000, 93995 bytes): new form with
  date pickers, Russian labels, full-width hint.

### Tests
- `tests/unit/scorecard-ui.test.tsx` +1: Russian labels present, raw keys not used as labels, two
  `type="date"` inputs with floored UTC days (`2026-01-01`/`2026-01-31` for an exclusive
  `2026-02-01T00:00:00.000Z` bound), no raw ISO visible, hint present. Asserts `name=`+`value=`
  pairs rather than whole tags — React reorders attributes in SSR markup.
- `tests/unit/scorecard-cohort-day-bounds.test.ts` — new: day→instant conversion (inclusive open,
  exclusive close, mixed pair pass-through, lone-bound derivation at exactly +365 days).
- `tests/unit/scorecard-cohort-identity.test.ts` — new: absent stays absent (308 path preserved),
  partial → completed with `all`, fully cleared → `all/all/all`, explicit identity byte-identical,
  single mentioned dimension completed.

## Gates

`pnpm typecheck` ✓ · `pnpm test` → 364 unit + 56 web ✓ · `pnpm --filter @bet-stats/web build` ✓
· `next-env.d.ts` restored after build.

## Live verification (browser, console clean on all tabs)

- `/scorecards` renders: labels «Период с (по UTC)»…, `type="date"` with `2025-10-20`/`2026-10-20`,
  no raw ISO in the form, hint full-width.
- Submit with cleared «Версия модели» → previously 400 `INCOMPLETE_COHORT_IDENTITY` error page;
  now renders the honest empty cohort «Точная когорта: all · all · all» (API answers
  `UNAVAILABLE/NO_SCOREABLE` for that window — matches direct curl).
- Bare `/scorecards` → still 308 → canonical URL → 42 matches (quick 261016-k3w preserved).
- Period 2026-08-01…2026-10-18 → 42 matches, date inputs round-trip the picked days.
- `/faq` shows the new filter paragraph.

## Environment note

Unit run failed once with `ENOSPC` mid-session (C: down to 0.7 GB) — `npm cache clean --force`
freed 4.9 GB, no code implication; all gates green afterwards.

## Deviations from plan

- Plan sketched hidden `from-day`/`to-day` inputs plus JS conversion; replaced by visible
  `type="date"` fields named `from`/`to` with server-side day→instant conversion in
  `resolveCohortBounds` — the plain GET then works without JS and the API contract is untouched.
- Plan did not anticipate the `INCOMPLETE_COHORT_IDENTITY` 400 discovered during live testing;
  `cohort-identity.ts` is the fix, with its own test file.

## Not touched

API contract, `canonicalScorecardQuery` URL identity, submit button text «Применить точную
когорту» (test-locked), the three dimension fields as free text (a narrow expert tool; enumerating
them would need a new API surface).
