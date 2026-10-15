# Quick Task: Matchday Programme visual redesign of apps/web

**Date:** 2026-10-15
**Type:** UI / design-system
**Requested:** Use the frontend-design skill to give Bet Stats a modern, distinctive, beautiful design.

## Context

The working tree contains an unfinished dark "SaaS" restyle (slate/indigo, gradients, glow,
emoji, card grid) that (a) reads like a bookmaker app rather than a trustworthy analytics
product, (b) breaks two e2e contracts (home H1 copy, fixtures empty-state copy), and
(c) leaves light-theme inline hex styles unreadable on the dark base.

User approved direction: **Matchday Programme** — a light, editorial "results page" look
grounded in the physical objects of football data (printed programme, newspaper results
column, pools coupon).

## Design tokens (source of truth: apps/web/app/globals.css)

- Paper `#F1F3F0`, panel `#FFFFFF`, subtle surface `#EAEFEA`
- Ink `#17211D`, secondary `#3F5049`, muted `#5B6B62`
- Anchor turf `#14503B`, deep `#0B2C21`, subtle rgba(20,80,59,.08)
- Signal mustard `#D99A0B` (dark text variant `#7A5605`) for limited-data
- Alert crimson `#A32B2B` for risk disclosure
- Data blue `#35618A` (dark text variant `#274F73`) for provenance/secondary chart series
- Type: Source Serif 4 (headings/editorial) + IBM Plex Sans (UI, tabular figures), self-hosted via next/font/local
- Radii 2–3px, hairline borders instead of shadows, no gradients/glass/neon/emoji

## Test contracts to preserve (must re-pass)

- public-shell.spec.ts: H1 "Trustworthy football fixture data"; footer "Football data and analytical information only."
- fixture-discovery.spec.ts: H1 "Upcoming fixtures"; h2 date groups; label "Competition"; empty state "No fixtures are available for this range."; "Limited data"; no betting words on empty page
- methodology.spec.ts: H1 "How forecasts work"; h2 order; "Technical details" summaries; axe clean
- release-accessibility.spec.ts: nav labels; skip link; 320px reflow; footer "Outcomes remain uncertain"; forced-colors + reduced-motion; axe clean
- unit/responsible-copy.test.ts: no prohibited words (beware substrings: sure/ensure, lock/block) in any apps/web .tsx

## Work

1. Rewrite globals.css token system + shell/hero/fixture styling (editorial rules, ledger rows, colophon footer).
2. Self-host fonts; wire into layout.tsx via next/font/local.
3. Restore exact H1/empty-state copy in app/page.tsx and app/fixtures/page.tsx; drop emoji.
4. Migrate hardcoded light hexes (methodology, privacy, scorecards, teams evidence, internal pages, risk-disclosure, contextual-methodology-warning, state notices) to tokens with light-theme-appropriate badge colors.
5. Verify: web typecheck, responsible-copy unit test, dev-server screenshots at 320/1280 for self-critique; run targeted e2e if feasible.

## Status

- [x] Design plan approved by user (Matchday Programme)
- [x] Implementation (tokens, fonts, shell/hero/fixtures, token migration, copy restoration)
- [x] Verification (typecheck, unit, deterministic + phase06 live e2e, axe, screenshot critique)
- [x] Commit (apps/web + .planning/quick + STATE.md only; unrelated tree changes untouched)

## Verification log

- `pnpm --filter @bet-stats/web typecheck` — pass.
- `tests/unit/responsible-copy.test.ts` — 11/11 pass.
- Web unit tests — 5/5 pass.
- ESLint — 9 problems, byte-identical to stashed baseline (pre-existing).
- Playwright (deterministic config): public-shell + fixture-discovery — 8/8 pass after restoring
  the `Source updated: Not available` fallback in data-state-notice.tsx.
- Playwright (phase06 live stack, Docker + portable Node 24.22.0): methodology.spec.ts +
  release-accessibility.spec.ts — green. One real regression found and fixed: axe color-contrast
  in the colophon under `forced-colors: active` (forced canvas replaced the dark footer panel
  while light text stayed) → `.release-footer p { color: CanvasText; }` in the forced-colors
  block of globals.css; release-accessibility re-run 20/20 pass (desktop + mobile chromium).
