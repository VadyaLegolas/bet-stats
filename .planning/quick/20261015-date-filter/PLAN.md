# Quick Task: Beautiful date picker in the fixtures filter

**Date:** 2026-10-15
**Type:** UI/UX
**Requested:** (user) "сделай красивый выбор даты в фильтре и отвечай всегда на русском"

## Current state

`/fixtures` filter has two plain text inputs «С (UTC)» / «По (UTC)» where users must
type raw ISO 8601 UTC instants (`2026-10-15T00:00:00.000Z`) — error-prone and ugly.

## Fix

1. **Client component `date-range-filter.tsx`** (permitted interactivity — the site
   already ships a client nav menu):
   - two native `<input type="date">` fields (browser calendar, localized, no extra JS
     libraries);
   - preset chips: «Ближайшие 48 часов» (default), «Сегодня», «Завтра»,
     «Ближайшие 3 дня», «Ближайшая неделя» — each navigates immediately, active chip
     marked with `aria-pressed`;
   - submit converts date-only values to the API's UTC-instant contract:
     `from → T00:00:00.000Z` (inclusive), `to → next-day T00:00:00.000Z`
     (exclusive bound, so the picked end day is fully included);
   - incoming instant URLs are parsed back into `YYYY-MM-DD` for display; invalid or
     missing values fall back to the effective range.
2. **Server `load()` convenience**: accepts date-only `from`/`to` in the URL
   (start-of-UTC-day / next-day-00:00Z) so hand-edited links also work; full instants
   pass through unchanged (API stays strict; range-echo contract untouched).
3. **Conventions**: record «answers and UI copy in Russian» in CONVENTIONS.md (+AGENTS.md)
   per the user's standing request.

## Compatibility (verified by reading current specs)

- `page.getByLabel("Соревнование")` label kept (fixture-discovery, walking-skeleton).
- Empty-state / reflow / zero-range tests unchanged.
- Release axe scan (release-accessibility) must stay clean: labelled inputs, textful
  buttons, contrast via existing design tokens.

## Checklist

- [x] Client date-range filter with calendar inputs + preset chips
- [x] `load()` accepts date-only from/to convenience
- [x] CONVENTIONS.md (+ AGENTS.md): Russian responses/copy
- [x] Verify: typecheck web ✓; deterministic e2e 21/21 ✓; phase06 accessibility+journey 22/22 ✓ (axe clean)
- [x] Browser sanity: presets, calendar entry, URL contract ✓ (`test-results/date-filter-default.png`, `date-filter-final.png`)
- [x] STATE.md + atomic commit

## Notes

- `URLSearchParams` encodes the space in "Premier League" as `+` — assertions on
  generated filter URLs must accept `Premier\+League`, not `%20`.
- Fixed during sanity: test expectation only; component behavior was correct.
