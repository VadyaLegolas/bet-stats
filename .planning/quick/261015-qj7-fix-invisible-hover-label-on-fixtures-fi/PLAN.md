# Quick Task: Fix invisible hover label on fixtures filter chips

**Date:** 2026-10-15
**Type:** UI bug fix (CSS specificity)
**Requested:** (user) "Надписей на наведённой кнопке не видно" — hovering a preset chip on
/fixtures shows a dark green pill with an unreadable label (screenshot).

## Findings

- Global `button:hover:not(:disabled)` (specificity **0,2,1**) paints background/border
  `--color-accent-hover` (#0e3b2b, dark green).
- `.filter-chip:hover` (specificity **0,2,0**) loses `background` to the global rule but wins
  `color` → label becomes #0e3b2b **on** #0e3b2b background — same color on same color, the
  text vanishes. The active-chip rule `[aria-pressed="true"]` (also 0,2,0) loses the
  background to the global hover rule as well.
- Same defect class affects `<button className="btn-secondary">` («Обновить матчи» on the same
  filter, provider-state-notice retry): global hover background wins, `.btn-secondary:hover`
  sets the identical accent-hover text color → invisible label on hover.
- Project precedents for exactly this failure: `.release-menu-trigger:hover:not(:disabled)`
  in globals.css and the comment in `.btn-primary:hover` (commit d44f65f "fix hover label").
- `.btn-secondary` on `<a>` elements is unaffected (global `button` rules do not match
  anchors) — the fix must keep anchor behavior byte-identical.

## Design

1. `.filter-chip:hover:not(:disabled)` (**0,3,1**) — declared secondary hover look: light wash
   `--color-surface-hover`, border `--color-text-secondary`, text `--color-accent-hover`.
2. `.filter-chip[aria-pressed="true"]:hover:not(:disabled)` (**0,4,1**) — active chips stay
   solid on hover: bg/border `--color-accent-hover` (keeps today's darker-hover look), text
   #ffffff. Base active rule keeps `--color-accent` + #ffffff.
3. `.btn-secondary:hover:not(:disabled)` (**0,3,1**) — same declarations as
   `.btn-secondary:hover`; anchors never match `:disabled` so their behavior is unchanged,
   real `<button>` elements finally outrank the global rule.

## Checklist

- [x] CSS fix in `apps/web/app/globals.css` (chip hover, active-chip hover, secondary hover)
- [x] Verify: real browser computed styles on hover — chip `#eaebe6`/`#0e3b2b`, active chip
      dark-green/`#ffffff`, sync button light/accent (bg ≠ text in every state, `:hover`
      matches); screenshot with hovered chip shows a readable label; zero console errors;
      web typecheck green; web unit tests 5/5
- [x] STATE.md + atomic commit + push to origin/main
