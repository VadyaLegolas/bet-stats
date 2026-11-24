---
phase: quick-261124-o3r
plan: 261124-o3r
subsystem: apps/web styling
tags: [design-tokens, css, style-only, ux]
requires: [quick-261124-n50]
provides:
  - shared design vocabulary in apps/web/app/globals.css (panel, notice, tone-*, state-chip, state-notice, field, page-*, card-grid, utilities)
  - --color-on-danger token (both themes) with contrast test
affects: [apps/web shared components, public pages, internal operator pages]
tech-stack:
  added: []
  patterns: [token classes in globals.css replace inline style objects, tone-* classes drive state chips via --tone-* custom properties]
key-files:
  created: []
  modified:
    - apps/web/app/globals.css
    - apps/web/components/data-state-notice.tsx
    - apps/web/components/provider-state-notice.tsx
    - apps/web/components/risk-disclosure.tsx
    - apps/web/components/contextual-methodology-warning.tsx
    - apps/web/components/results-sync-button.tsx
    - apps/web/components/date-range-filter.tsx
    - apps/web/components/cohort-filter.tsx
    - apps/web/components/design-tokens.test.ts
    - apps/web/app/faq/page.tsx
    - apps/web/app/methodology/page.tsx
    - apps/web/app/privacy/page.tsx
    - apps/web/app/scorecards/scorecard-dashboard.tsx
    - apps/web/app/fixtures/page.tsx
    - "apps/web/app/fixtures/[fixtureId]/page.tsx"
    - "apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx"
    - "apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx"
    - "apps/web/app/teams/[teamId]/evidence/page.tsx"
    - apps/web/app/internal/operations/alerts-block.tsx
    - apps/web/app/internal/operations/alerts-block.test.ts
    - apps/web/app/internal/operations/backup-status-block.tsx
    - apps/web/app/internal/operations/page.tsx
    - apps/web/app/internal/pipeline/replay/page.tsx
    - apps/web/app/internal/reconciliation/page.tsx
decisions:
  - "Tone classes (tone-positive/warning/danger/neutral/info) replace per-component colour records; positive label uses --color-accent-text"
  - "--color-on-danger added to both themes (white on light crimson, near-black on dark rose) and contrast-tested; fixes LIVE badge in dark theme"
  - ".release-main .page-column is scoped so the 960px detail column outranks .release-main article (76ch)"
  - "Alerts channel line keeps its state-computed colour inline because alerts-block.test.ts asserts the token names in markup"
metrics:
  duration: ~35 min
  completed: 2026-11-24
status: complete
commits: 3
plan_head_before: d02fca34f46553668ccd5d68e89d5e1215019932
plan_head_after: 28643cfb3bcb11c1eb800e79a912e80a11f8f438
actuals:
  tokens: 42700
  tasks: 3
  commits: 3
---

# Phase quick-261124-o3r Plan 261124-o3r: New design on all remaining apps/web pages Summary

Moved every static inline style in apps/web/app and apps/web/components (faq, methodology, privacy, scorecards, fixtures list and detail, team evidence, operations, pipeline replay, reconciliation and the shared components) into token-based classes in globals.css, so the n50 shapes (20px panels, 12px controls, pill chips) and both themes apply everywhere. Style only: copy, routes, aria, roles, ids and test ids are unchanged.

## Tasks and commits

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Shared vocabulary in globals.css + shared components without inline styles (tracer) | ff668b2 |
| 2 | Public pages + on-danger token (test first: red, then green) | a079834 |
| 3 | Internal pages + globals.css leftovers + final gates | 28643cf |

## Gate results (final state)

- Inline radius (`borderRadius`) in apps/web/app and apps/web/components: 0 lines (HEAD d02fca3: 28; 4px variant: 14).
- Non-test `style={` lines: exactly 5 (3 homepage probability widths in app/page.tsx, quota meter width in components/quota-counter.tsx, alerts channel colour line in alerts-block.tsx); HEAD: 161.
- Attribute-count invariants unchanged: 32 (shared components), 117 (public pages), 78 (alerts + internal pages).
- `pnpm --filter @bet-stats/web test`: 11 files, 209 tests pass (207 baseline + 2 new on-danger contrast pairs, light and dark).
- `pnpm --filter @bet-stats/web typecheck`: pass. `lint`: 0 errors, 9 pre-existing warnings (unused DAY_MS in cohort-filter, privacy useEffect deps, etc.), none introduced here.
- `pnpm exec vitest run --project unit`: 72 files, 1018 tests pass (same as baseline).
- Production build (`NEXT_DIST_DIR=.next-gate`) compiled successfully after each task; `apps/web/next-env.d.ts` reverted every time and not committed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extra inline style in team evidence receipt pre**
- **Found during:** Task 2 (style grep gate)
- **Issue:** `apps/web/app/teams/[teamId]/evidence/page.tsx` had one more inline style (`overflow: auto; max-width: 100%` on the receipt `<pre>`) that the plan did not list; the final gate requires exactly five dynamic inline styles.
- **Fix:** added a `.scroll-auto` utility (overflow auto, max-width 100%) and used it. It is deliberately separate from `.pre-scroll` (which has max-height 240px for the reconciliation snapshot) so the receipt keeps its unbounded height.
- **Files modified:** apps/web/app/globals.css, apps/web/app/teams/[teamId]/evidence/page.tsx
- **Commit:** a079834

Otherwise the plan was executed as written, including the one allowed test edit (alerts-block.test.ts: the dd assertion now expects the `tabular-nums` class) and the new contrast pair.

## Notes

- Border-radius review (Task 3 step 1): the remaining small-radius rules (`.quota-counter`, `.quota-meter`, `.release-age-badge`, `.prob-bar`, `.ev-chip`, `.pill-novalue`) all belong to the header/footer/homepage design approved in n50 and were left untouched (UD-05); no other small-radius rule exists outside them.
- Known side effect accepted by plan (PD-08): panel padding is now 16px on mobile and 24px from 768px instead of 20px; the provider retry button is now 44px (was 38px); the replay textarea now matches the neighbouring inputs.
- No stubs, no new network surface, no dependency or lockfile change.

## Out-of-scope follow-ups

- Regenerate the FAQ screenshots in apps/web/public/images/faq via scripts/capture-faq-screenshots.mjs (every page looks different now).
- Playwright e2e specs were NOT run (they need the e2e stack); selectors were checked by attribute-count invariants only.
- Human visual pass at 1440, 768 and 390 px in light and dark: /faq, /methodology, /privacy, /scorecards, /fixtures, one /fixtures/[id], /teams/[id]/evidence, /internal/operations, /internal/pipeline/replay, /internal/reconciliation (confirm 20px/12px shapes, no horizontal scroll at 320px, readable LIVE badge in dark, replay textarea styling). Not performed here.

## Self-Check: PASSED

- Commits ff668b2, a079834, 28643cf exist on main (ancestor of HEAD).
- Modified files present; globals.css contains every class in the three task class loops plus --color-on-danger in both themes.
