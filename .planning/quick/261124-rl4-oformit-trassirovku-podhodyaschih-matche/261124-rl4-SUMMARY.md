---
phase: quick-261124-rl4
plan: 261124-rl4
subsystem: web
tags: [evidence, trace, design-system, css, state-chip]
requires: []
provides:
  - EvidenceTraceSection, traceOutcomeCounts (exported from the team evidence page module)
  - scoped .evidence-trace* stylesheet block
affects: [apps/web/app/teams/[teamId]/evidence/page.tsx, apps/web/app/globals.css]
tech-stack:
  added: []
  patterns: [scoped CSS block with tokens only, lookup object for tone and label]
key-files:
  created:
    - tests/unit/evidence-trace-design-ui.test.tsx
  modified:
    - "apps/web/app/teams/[teamId]/evidence/page.tsx"
    - apps/web/app/globals.css
decisions:
  - "Summary strip lives in EvidenceTraceSection, not in the table component; zero-count tiles are never rendered."
  - "Scroll region is focusable (tabindex 0) because the table now has a min-width and really scrolls."
status: complete
estimate-actuals: n/a
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
plan_head_before: 86bf78bd48e5636bfd4500eb7b0378008fbd7a95
plan_head_after: e5be2d86060ffd60d06417ae66706270ac168307
completed: 2026-11-24
---

# Phase quick-261124-rl4 Plan 261124-rl4: Evidence trace block restyle Summary

The "Трассировка подходящих матчей" block of /teams/[teamId]/evidence is now one panel card with a tile strip, outcome state chips and a focusable, non-word-breaking scroll table, styled with design tokens only.

## What was done

- **Task 1 (tracer, cfb22f8):** `EvidenceTraceSection` (exported) renders `section.panel.evidence-trace` with the unchanged `h2#trace-heading` first, a neutral `.evidence-trace-empty` sentence for no rows, otherwise the table. `EvidenceTraceTable` keeps props, caption, header order, cell data and `<time>` markup; the region is `scroll-x evidence-trace-scroll` with `tabIndex={0}`; the table and columns carry scoped classes; the seven fallbacks are the muted `TraceUnknown` span. New scoped CSS block after `.evidence-table-scroll::after` (card, empty well, scroll region resetting the inherited `overflow-wrap: anywhere`, min-width 56rem table, muted head, hover wash, tabular figures, per-column rules, caption bounded by `100cqw`) plus forced-colors borders.
- **Task 2 (e5be2d8):** exported pure `traceOutcomeCounts`; one `TRACE_OUTCOMES` lookup (label plus tone) feeds both the outcome chip (`state-chip state-chip--md tone-*` with an aria-hidden `state-dot`) and the strip tiles; `TraceStats` renders `dl.evidence-trace-stats` with the total tile plus Победы / Ничьи / Поражения tiles only when the count is above zero. Scoped tile and chip-nowrap CSS, tile border in forced-colors.
- Tests: new file `tests/unit/evidence-trace-design-ui.test.tsx` (20 tests: markup contract, escaping T-rl4-01, chips, strip, counts, stylesheet contract). No existing test file was edited.

## Verification

| Gate | Result |
| ---- | ------ |
| `vitest --project unit` (whole) | 77 files / 1095 tests passed (baseline 76 / 1075 plus the new file) |
| Integration `phase-01-security`, `evidence-browser-contract` | 7 passed, unchanged |
| `@bet-stats/web typecheck` | clean |
| `@bet-stats/web test` (design-tokens included) | 11 files / 209 tests passed |
| `@bet-stats/web lint` | 0 errors, 9 warnings (same 9 as before) |
| `NEXT_DIST_DIR=.next-gate ... build` | succeeded, extra named exports accepted; `next-env.d.ts` reverted, `git status` empty for it |
| `grep -c evidence-trace globals.css` | 31 (HEAD 0, expect >= 20) |
| English certainty/urgency word grep on page.tsx | 0 |
| `git status --short apps tests` | clean after commits (only page.tsx, globals.css, new test file were touched) |

## Not run

- **Playwright e2e and 1440px/360px light/dark screenshots: NOT RUN** per the task constraints (dev stack in use, no process start/stop, orchestrator runs e2e). Consequently the 360px `scrollWidth <= 360` check, the caption wrapping inside the scroll container (`max-width: min(100cqw, 40rem)`) and the 1280px+ no-inner-scrollbar tuning are unverified visually. The caption visually-hidden fallback from the plan was therefore not needed or applied; if the screenshot shows a clipped caption, that fallback is the follow-up. e2e contracts were preserved by construction (first td label-only, 5th td effective time, no standalone `0`, no `Недоступно` / `3/5` strings introduced, region role/label unchanged and focusable).
- FAQ screenshot `apps/web/public/images/faq/evidence.png` was not recaptured (binary asset, needs the live stack): follow-up for the orchestrator.

## Deviations from Plan

None - plan executed as written. (Forced-colors border was added as its own rule line in the existing block rather than appended to an existing multi-selector line, so every selector of the new block starts with `.evidence-trace`, as the stylesheet test requires.)

## Known Stubs

None.

## Threat Flags

None. T-rl4-01 mitigated (all values are React text children, tone classes from a fixed enum lookup, escaping test added); T-rl4-02 mitigated (min-width inside a focusable overflow-x region).

## Self-Check: PASSED

- FOUND: tests/unit/evidence-trace-design-ui.test.tsx
- FOUND commits cfb22f8, e5be2d8 (both ancestors of HEAD)
