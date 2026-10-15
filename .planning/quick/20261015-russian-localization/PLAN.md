# Quick Task: Russian localization + hover fix + home link

**Date:** 2026-10-15
**Type:** UI / i18n / bugfix
**Requested:** (1) button hover hides its label; (2) translate the whole site to Russian;
(3) clicking the header brand navigates to the home page.

**Decision (user-approved):** translate UI *and* update the e2e/unit test expectations
that assert English copy, keeping the whole suite green.

## Bugs

- Hover: `a:hover { color: var(--color-accent-hover) }` outranks `.btn-primary` (0,1,1 > 0,1,0),
  so `<a class="btn-primary">` paints its label `#0e3b2b` on the same `#0e3b2b` hover
  background → invisible text. Fix: explicit `color` in `.btn-primary:hover` (and pin
  `.btn-secondary:hover`).
- Header brand `<strong>Bet Stats</strong>` is not a link → wrap in `<a href="/">`.

## Localization scope

- `lang="en"` → `lang="ru"`; shell (skip link, nav, footer, metadata), every page under
  `apps/web/app/**`, every user-visible component under `apps/web/components/**`
  (labels, badges, empty states, aria-labels, chart alt copy).
- Terminology: Fixtures → Матчи, Analysis → Анализ, Results → Результаты,
  Methodology → Методология; "Limited data" → «Неполные данные»;
  h2 date groups → Russian long format (Суббота, 29 августа 2026).
- Tests: update asserted copy in `tests/e2e/*.spec.ts` (public-shell, fixture-discovery,
  methodology, release-accessibility, scorecards, privacy, …) and any unit copy checks.

## Contracts to re-verify after translation

- `pnpm --filter @bet-stats/web typecheck` and web unit tests
- `tests/unit/responsible-copy.test.ts` (scans apps/web .tsx — Russian copy is exempt)
- deterministic Playwright suite (all specs, now asserting Russian copy)
- phase06 live stack: methodology.spec.ts + release-accessibility.spec.ts
  (Node 24.22.0 portable in Temp\opencode)

## Work checklist

- [x] Hover fix + brand home link
- [x] Shell + layout localization (lang, skip link, nav, footer, metadata)
- [x] Pages localization (home, fixtures list/detail, methodology, privacy, scorecards, teams, internal)
- [x] Components localization (notices, disclosures, workbench, navigation)
- [x] Update e2e/unit expected copy
- [x] Verify: typecheck, unit, deterministic e2e, phase06 live e2e
- [x] Screenshot sanity check
- [x] Atomic commit

## Verification results (2026-10-15)

- `pnpm --filter @bet-stats/web typecheck` — green.
- `pnpm test` (unit + web tests, incl. `phase-05-security` 40/40, `responsible-copy`) — green.
- Deterministic e2e without DB: public-shell, fixture-discovery, walking-skeleton,
  team-evidence, reconciliation-review — **21/21 green**.
- Deterministic e2e with `DATABASE_URL`: forecast-workbench — **3/3 green**.
- phase06 live stack: methodology, release-accessibility, release-degradation,
  release-journey, operator-overview, operator-recovery, privacy-retention,
  evidence-scorecard, forecast-comparison, provider-degradation — **green**
  (re-run after fixes: provider-degradation + evidence-scorecard 12/12).
- `team-evidence-live` via `playwright.live-evidence.config.ts` (own stack) — **2/2 green**.

## Fixes made along the way (test-side, date/environment bugs)

- `team-evidence.spec.ts`: first click-through raced the dev-server's cold route
  compile → wait for the evidence heading with a 30s timeout; exact-kickoff echo made
  unambiguous (`.first()`).
- `reconciliation-review.spec.ts`: RU button label substring collision → `exact: true`.
- `forecast-workbench.spec.ts`: fixed kickoff (2026-09-12) fell into the past, breaking
  the D-09 odds capture window (`ODDS_CAPTURE_NOT_BEFORE_KICKOFF` → 400) →
  relative dates (kickoff = now + 48h, cutoffs = now − 12h/− 6h); save-status timeout 30s.
- `team-evidence-live.spec.ts`: 30s timeout on the resolved-cutoff assertion
  (cold route compile on the disposable stack).
- `provider-degradation.spec.ts`: match headings → «Arsenal против Chelsea» / «Roma против Ajax».
- `evidence-scorecard.spec.ts`: the full ledger table is CSS-hidden on mobile widths
  (responsive evidence, since phase 06-02) → query by `table[aria-label]` instead of
  `getByRole("table")` so the mobile project reconciles too.

## Known pre-existing failure (out of scope)

- `tests/e2e/pipeline-replay.spec.ts` — 5 tests red **since the redesign commit
  `0eb424f`**: the spec targets the pre-redesign page (old preview shape without
  `scope/expiresAt/quotaEffect`, English strings that no longer exist in the UI such as
  "2 logical units", "Replay queued"). Requires a spec rewrite against the new
  "Безопасное восстановление" screen — a separate redesign task, not localization.
