---
quick_id: 261124-ppa
description: Port the remaining page layouts of the approved "all pages" design canvas into the real apps/web pages (restyle only, no behavior or data changes) - fixture detail hero and workbench two-card layout, scorecards KPI tiles, methodology card grid with responsible-use band, FAQ step cards and ruled Q&A, chevron disclosure, plus header / footer / fixtures-list leftovers - in light and dark themes.
phase: quick-261124-ppa
plan: 261124-ppa
type: quick
wave: 1
depends_on: []
autonomous: true
requirements: [UX-01]
files_modified:
  - "apps/web/app/fixtures/[fixtureId]/match-hero.tsx"
  - "apps/web/app/fixtures/[fixtureId]/page.tsx"
  - "apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx"
  - "apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx"
  - apps/web/app/scorecards/scorecard-dashboard.tsx
  - apps/web/app/methodology/page.tsx
  - apps/web/app/faq/page.tsx
  - apps/web/app/globals.css
  - tests/unit/match-hero-ui.test.tsx
  - tests/unit/workbench-design-ui.test.tsx
  - tests/unit/inner-pages-design-ui.test.tsx

estimate:
  tokens: 45000
  raw_tokens: 90000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "The fixture detail page opens with a back link (chevron + 'Назад к матчам', >= 44px) and one hero card (24px card radius, card shadow) holding the h1 '<Home> против <Away>' with a muted smaller 'против' and a facts tile grid with the existing five dt/dd pairs (Соревнование, Сезон, Начало (<tz>), Статус, Исторические доказательства); the competition name and the status each appear exactly once (no duplicate chip) and no invented number, chip or demo text is rendered."
    - "On the detail page the odds-entry section and the exact-snapshot comparison section sit side by side as two cards from ~860px and stack below that (no horizontal overflow at 360px), the frozen-forecast dl is a facts tile grid, the value verdict is a card with bordered rows (probability, no-vig probability, edge, expected value) where the expected-value cell is an accent chip only when the outcome is VALUE_CANDIDATE and an outlined neutral chip otherwise; every id, label pairing, role, aria attribute, heading text and button name in the workbench is unchanged."
    - "/scorecards shows the lead paragraph as a muted deck, the two proper-score metrics as KPI tiles whose element text still reads exactly 'Оценка Брайера: 0.4400' and 'Логарифмическая потеря: 0.6700' (label, hidden colon, value), the formula-receipts disclosure as a card, and pagination links at least 44px tall; all other copy, headings, tables and e2e text contracts are unchanged."
    - "/methodology is a full-width page: lead paragraphs, the model-card metadata as a facts tile grid, seven section cards in a responsive grid (h2 stays the first child of each section, ids and DOM order unchanged), the responsible-use section as an accent-soft band, history entries unchanged; the existing 'Технические подробности' details elements get the chevron disclosure look."
    - "/faq keeps its semantics (ordered list, dl; no details element is introduced): the 12 steps render as numbered cards (CSS counter, ol keeps list semantics through role=list) and the five questions render as ruled rows with a muted answer."
    - "Every disclosure (details/summary) in the app uses one chevron treatment (right-aligned chevron that rotates when open, text colour, 44px minimum height) instead of the arrow glyph; tables use muted small column heads and 14px row padding; panels no longer carry a large top gap from a first-child heading."
    - "Header and footer polish matches the canvas: limits card radius 14px, theme toggle radius 16px, 18+ badge 38px with 12px radius; /fixtures date-group headings use the accent-text colour at 24px, the fixtures filter card uses the card radius, filter range chips are 44px tall, and page columns use the full 1200px frame."
    - "Only design-token colours are used in every new or changed rule (no hex / rgb), so both themes follow the contrast-tested tokens (>= 4.5:1); no horizontal overflow at 360px; all touched controls are at least 44px; forced-colors borders cover the new surfaces."
  artifacts:
    - path: "apps/web/app/fixtures/[fixtureId]/match-hero.tsx"
      provides: "BackLink and MatchHero presentational components for the detail page"
    - path: apps/web/app/globals.css
      provides: "back-link, match-*, facts-grid, workbench-*, field--odds, note-strip, ev-rows, value-chip, kpi-*, panel--band, steps-list cards, faq-list, chevron summary, table, header / footer / list polish rules"
    - path: tests/unit/match-hero-ui.test.tsx
      provides: "Hero markup and stylesheet contract tests"
    - path: tests/unit/workbench-design-ui.test.tsx
      provides: "Workbench two-card layout, outcome rows and stylesheet contract tests"
    - path: tests/unit/inner-pages-design-ui.test.tsx
      provides: "Scorecards KPI, methodology structure, FAQ semantics and stylesheet contract tests"
  key_links:
    - from: "apps/web/app/fixtures/[fixtureId]/page.tsx"
      to: "apps/web/app/fixtures/[fixtureId]/match-hero.tsx"
      via: "imports BackLink and MatchHero, replacing the inline back link, h1 and detail-grid dl"
    - from: "apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx"
      to: apps/web/app/globals.css
      via: "class names panel, workbench-card, workbench-duo, field, field--odds, note-strip, facts-grid, status-line, btn-secondary, well"
    - from: "apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx"
      to: apps/web/app/globals.css
      via: "class names workbench-card, outcome-card, ev-rows, value-chip, value-chip--positive, link-touch, cluster"
    - from: apps/web/app/scorecards/scorecard-dashboard.tsx
      to: apps/web/app/globals.css
      via: "class names page-deck, kpi-grid, kpi-tile, kpi-label, kpi-value, link-touch, cluster, panel"
    - from: apps/web/app/methodology/page.tsx
      to: apps/web/app/globals.css
      via: "class names page-column, page-deck, facts-grid, card-grid--lg, panel--band, well"
    - from: apps/web/app/faq/page.tsx
      to: apps/web/app/globals.css
      via: "class names page-deck, steps-list, faq-list"
---

<objective>
Bring the page layouts of the user-approved "all pages" design canvas (fixture analysis, results, methodology, shared header / footer) to the real pages in `apps/web` where they still differ, in both themes. Restyle only: real data bindings, real Russian copy, headings, aria / role / id / test-id contracts and exported signatures stay as they are. The canvas data (fictional teams, numbers, EV values, demo captions) is never copied.

Purpose: tokens, fonts, header, footer, homepage (261124-n50), inner-page token classes (261124-o3r) and the fixtures list rows (261124-oy4) are shipped, but the detail / workbench page, scorecards, methodology and FAQ still use plain stacked blocks, an arrow-glyph disclosure and 960px / 76ch columns while the canvas has hero cards, tile grids, two-card layouts and a chevron accordion.

Output: `match-hero.tsx` (BackLink, MatchHero), class-level markup edits in the workbench, value outcome, scorecards, methodology and FAQ files, one coherent block of token-only rules in `apps/web/app/globals.css`, and three unit test files (markup contracts plus stylesheet contracts).

Source audit (quick mode: no CONTEXT.md, RESEARCH.md or phase requirement list; the brief is the source). GOAL (port the canvas layouts, style only) -> Tasks 1-3. Brief item "Match: hero + two cards + facts grid" -> T1 (hero, facts tiles), T2 (two-card duo, facts tiles for the frozen forecast, EV rows). "Results: KPI tiles, calibration card, recent results table, operations cards" -> T3 covers the KPI tiles and the table styling; the calibration chart card, recent-matches table and operations cards have no counterpart on the real /scorecards page and would need invented data (see PD-05). "Methodology: model cards with tag chips, responsible-gambling band, FAQ accordion" -> T3 (card grid, band, chevron on the existing details; no tag chips because there is no real copy for them, PD-04). "FAQ accordion only if disclosure elements exist" -> the real FAQ has none, so no accordion (PD-03). "Header / Footer polish" -> T3 values. "Fixtures list: filter card, date-group headings, rows" -> T3 leftovers (rows were done in oy4). Brief constraints (style / markup only, keep signatures, light + dark by tokens, contrast >= 4.5, targets >= 44px, no overflow at 360px) -> every task and the verification block.

Planner decisions (this plan is the decision record; no discuss-phase artifact exists):
- PD-01 No 1X2 hero bar and no league / date / status chips on the detail page. The real page shows no forecast in its header; a bar there would present one snapshot above the workbench's explicit snapshot picker (the product rule is that a newer snapshot never replaces the user's choice) and chips would duplicate dl text that e2e locators match by text. The hero keeps the real facts as tiles instead.
- PD-02 Canvas EV calculator is layout only. The real odds form and verdict are restyled into the two-card layout and bordered rows; no logic, state or field is added or removed.
- PD-03 FAQ has no details / summary, so it stays a list and a dl (numbered cards and ruled rows); adding a disclosure would change semantics.
- PD-04 Methodology gets no tag chips and no call-to-action button: the real page has no copy for them and invented copy is prohibited.
- PD-05 Scorecards get KPI tiles only for the two existing proper-score metrics. Denominator and financial sentences stay single paragraphs (e2e `getByText` matches them as one string). No chart card, matches table or status cards are rendered because the page has no such data.
- PD-06 Radii use the approved tokens (--radius-card 24px for hero and band, --radius-panel 20px for panels and tiles, --radius-control 12px); canvas values of 28 / 22 / 14 map to these, except fixed 14 / 16px values called out below.
- PD-07 Only chevron-style disclosure changes globally (one summary rule); it replaces the arrow glyph everywhere for consistency.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md
@apps/web/AGENTS.md
@.planning/quick/261124-n50-primenit-utverzhdennyy-dizayn-i-pereklyu/261124-n50-SUMMARY.md
@.planning/quick/261124-o3r-primenit-novyy-dizayn-ko-vsem-vnutrennim/261124-o3r-SUMMARY.md
@.planning/quick/261124-oy4-stranitsa-matchey-kak-primer-na-glavnoy/261124-oy4-SUMMARY.md
@apps/web/app/globals.css
@"apps/web/app/fixtures/[fixtureId]/page.tsx"
@"apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx"
@"apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx"
@apps/web/app/scorecards/scorecard-dashboard.tsx
@apps/web/app/methodology/page.tsx
@apps/web/app/faq/page.tsx
@tests/unit/fixtures-row-ui.test.tsx
@tests/unit/scorecard-ui.test.tsx

Canvas source (read-only, outside the repo; values only, never copy its demo text or numbers): C:/Users/Vlad/AppData/Local/Temp/claude/9b0ad02d655964ca/acc8ce29-02da-41a4-8379-2468a0ab0df9/scratchpad/allpages/project/ (Match.dc.html, Results.dc.html, Methodology.dc.html, Fixtures.dc.html, Header.dc.html, Footer.dc.html). Executors need not reopen it: the values below are extracted from it.

Facts verified while planning (HEAD 099e6c6):
- globals.css: tokens at lines 9-139 (radius tokens 12 / 20 / 24 are asserted by apps/web/components/design-tokens.test.ts; do not change token values). Global h1 / h2 / h3 at ~160-167; `summary` rules at ~202-219 draw an arrow glyph through a before pseudo-element and underline the label; `table / th / td` at ~223-232; `.panel / .panel--stack / .panel--grid` at ~607-618; `.card-grid` at ~1214; `.well` at ~1231; `.steps-list` at ~1221; `.release-main .page-column { max-width: 960px }` at ~1185 (used only by the fixtures list and the detail page); `.release-main article { max-width: 76ch }` at ~1265; `.date-group-heading` ~1162 (colour --color-accent), `.fixtures-filter-card` ~1006, `.filter-chip` ~1015 (min-height 40px); `.quota-counter` radius 10px ~332, `.theme-toggle` radius 14px ~408, `.release-age-badge` 36px / 10px ~458; the forced-colors block at the end lists bordered surfaces; `.release-main` padding-block 32px 48px at ~434.
- The detail page (apps/web/app/fixtures/[fixtureId]/page.tsx) renders, inside `article.page-column.page-column--wrap.page-column--inset`: a plain Link 'Назад к матчам', the h1, `dl.detail-grid` (5 dt/dd pairs), ProviderStateNotice, DataStateNotice, RiskDisclosure and ForecastWorkbench. Error and not-found branches render a section with an h1, a paragraph and the same plain Link.
- forecast-workbench.tsx (client component, 129 lines, very long JSX lines 119-128): root `section.page-stack`; header with the h2 'Прогнозы и ручной поиск value'; then sections with aria-labelledby revision-comparison-heading, forecast-heading, odds-heading, comparison-heading; the value verdict is `ValueOutcomeSection` (value-outcome-section.tsx) rendered after them when a result exists.
- Test contracts that constrain the markup (do not break): tests/unit/forecast-comparison-ui.test.tsx asserts the exact strings `<h3 id="outcome-heading">Нет value-сигнала</h3>`, bare `<dt>Вероятность без перекрытия</dt>`, `<dt>Преимущество</dt>`, `<dt>Ожидаемое value</dt>` and bare `<li>` reasons, so the h3, every dt and every li in ValueOutcomeSection must stay class-less. tests/e2e/release-accessibility.spec.ts finds the forecast id with `getByRole('heading', { name: 'Сравнение точных снимков' })` + `xpath=following-sibling::p` + `code`, so in the comparison section that h3 and the paragraph with the code element must stay siblings (no wrapper between them). tests/e2e/methodology.spec.ts needs `main h2` order unchanged and each h2 to be a direct child of its section that contains 'Технические подробности'. tests/e2e/evidence-scorecard.spec.ts needs the 'Реестр кандидатов' h2 to be a direct child of the section holding the table, the health heading above the metrics heading, and `getByText('Оценка Брайера: <n>')`, `getByText('Логарифмическая потеря: <n>')`, the denominators sentence and the financial sentence as single-element strings. tests/e2e/fixture-discovery.spec.ts needs link 'Назад к матчам' with its href. tests/e2e/forecast-workbench.spec.ts clicks summaries by their text, so summary children must stay plain text (no wrapper span).
- tests/unit/responsible-copy.test.ts scans EVERY .tsx under apps/web/app and apps/web/components for prohibited English words (including inside identifiers, class names and comments): never use the words lock, sure, guaranteed, safe bet, risk-free, act now, must bet, stake size, auto bet in any tsx you touch.
- tests/integration/phase-01-security.test.ts only scans apps/web/app/fixtures/page.tsx (this plan does not edit that file).
- Test layout: markup tests live in tests/unit/*.test.tsx and run from the repo root with `pnpm exec vitest run --project unit <files>`, importing React and react-dom/server from apps/web/node_modules (pattern in tests/unit/fixtures-row-ui.test.tsx; its stylesheet-contract block strips comments with a regex before matching). apps/web runs only app/**/*.test.ts and components/**/*.test.ts via `pnpm --filter @bet-stats/web test` (baseline 209 tests).
- No new Next API is used: only plain React components, className edits and the existing next/link. If anything beyond that is needed, read the matching guide under apps/web/node_modules/next/dist/docs/ first (apps/web/AGENTS.md).
- Language rule (AGENTS.md): user-facing text and comments in components are Russian; identifiers, code and commit messages English. `next build` with NEXT_DIST_DIR rewrites apps/web/next-env.d.ts: revert it with git checkout -- apps/web/next-env.d.ts after each build and never commit it.
- Tracer-first: the work is one presentation layer, so Task 1 is the tracer (one page region proven end to end: component, page wiring, stylesheet and render test) and Tasks 2 and 3 expand it.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Fixture detail hero (BackLink, MatchHero, facts tiles, full-width column) - tests first</name>
  <files>tests/unit/match-hero-ui.test.tsx, "apps/web/app/fixtures/[fixtureId]/match-hero.tsx", "apps/web/app/fixtures/[fixtureId]/page.tsx", apps/web/app/globals.css</files>
  <read_first>apps/web/app/fixtures/[fixtureId]/page.tsx, apps/web/app/globals.css (sections: h1/h2 rules, .page-column, .detail-grid, .detail-links, .link-touch, forced-colors block), tests/unit/fixtures-row-ui.test.tsx (stylesheet contract pattern)</read_first>
  <behavior>
    - BackLink renders an anchor with class back-link and the given href: an aria-hidden svg chevron first, then the exact text 'Назад к матчам'; its accessible text is unchanged.
    - MatchHero renders a header with class match-hero containing an h1 with class match-title whose text content is '<Home> против <Away>' with the word 'против' in a span of class match-vs, followed by a dl with class facts-grid whose dt texts in order are 'Соревнование', 'Сезон', 'Начало (<timeZone>)', 'Статус', 'Исторические доказательства'; every dt/dd pair sits in its own div and the last div has class facts-wide.
    - The kickoff dd holds a time element with dateTime and title equal to the raw kickoff and the text produced by formatInstant(kickoff, timeZone); the status dd holds statusLabel(status); the last dd keeps class detail-links with two links of class link-touch whose texts are 'Доказательства <Home> на момент начала' / 'Доказательства <Away> на момент начала' and whose hrefs come from the evidenceHref callback.
    - The competition name and the status label each occur exactly once in the visible text of the hero (no chip duplicate); team names containing angle brackets or ampersands are escaped as text.
    - Stylesheet contract (globals.css with comments stripped): every class emitted by the two components has a selector; the .back-link rule declares min-height 44px; rules whose selectors start with .back-link, .match- or .facts- contain no hex colour and no rgb / rgba literal; the .release-main .page-column rule has no 960px max-width (it is max-width none).
  </behavior>
  <action>
RED first. Create tests/unit/match-hero-ui.test.tsx with the createElement + renderToStaticMarkup import pattern of tests/unit/fixtures-row-ui.test.tsx and import BackLink and MatchHero from "../../apps/web/app/fixtures/[fixtureId]/match-hero.js". Implement every bullet of the behavior block (the stylesheet block reads apps/web/app/globals.css and strips block comments the way tests/unit/fixtures-row-ui.test.tsx does). Run it and confirm it fails because the module does not exist.

GREEN, markup. (a) Create apps/web/app/fixtures/[fixtureId]/match-hero.tsx with Russian comments. Export BackLink({ href }) rendering next/link Link with className back-link, an aria-hidden svg (viewBox 0 0 24 24, one path for a left chevron, no title) and the text 'Назад к матчам'. Export MatchHero({ fixture, timeZone, evidenceHref }) where fixture is a structural type { competition: { name; season }; teams: { home: { id; name }; away: { id; name } }; kickoff; status } (do not import the page-local Fixture type) and evidenceHref is (teamId: string) => string. It renders the header and dl exactly as described in the behavior block, reusing formatInstant from ../../../components/time-format and statusLabel from ../status-labels, with the same dt/dd texts and link texts the page rendered before. (b) In page.tsx: import BackLink and MatchHero; the error branch and the not-found branch keep their markup and position but use BackLink instead of the plain Link; the main return becomes an article with className 'page-column page-column--wrap match-page' (the inset modifier is dropped because the frame already pads) rendering, in this order, BackLink, MatchHero (props: fixture, timeZone, evidenceHref built from the existing evidenceHref function), ProviderStateNotice, DataStateNotice, RiskDisclosure, ForecastWorkbench with unchanged props. Do not touch loaders, eligibilityHeaders, safeReturn or the types; remove imports that become unused (Link, statusLabel, formatInstant) so lint stays clean.

GREEN, stylesheet (apps/web/app/globals.css, tokens only, comments in Russian or neutral). (1) Type scale: h1 becomes font-size clamp(2rem, 5vw, 3rem), letter-spacing -0.03em, line-height 1.1 (weight and margins unchanged); h2 becomes font-size 1.625rem (weight 600 unchanged; every homepage h2 already overrides the size, so the homepage is unaffected). (2) Change the .release-main .page-column rule to max-width none (keep margin-inline auto); the frame already caps the content at 1200px. (3) New rules, placed after the .detail-links / .link-touch rules so same-specificity ties resolve in their favour: .match-page is a grid with one minmax(0, 1fr) column and gap var(--space-6), and .match-page > aside has margin-block 0 (the notices carry their own margins); .back-link is inline-flex, align-items center, gap 8px, min-height 44px, width fit-content, colour var(--color-accent-text), weight 600, no underline, with a hover colour var(--color-accent-hover) and underline, and its svg is flex none, 18px, fill none, stroke currentColor, stroke-width 2, round caps and joins; .match-hero is a grid with gap 24px, padding 24px, background var(--color-surface), 1px solid var(--color-border), radius var(--radius-card), box-shadow var(--shadow-card), min-width 0, and from 768px padding 36px and gap 28px; .match-title has margin 0, the clamp size 2rem..3rem, letter-spacing -0.03em, line-height 1.1, overflow-wrap anywhere; .match-vs has colour var(--color-muted), weight 500, font-size 0.58em; .facts-grid has margin 0 and grid-template-columns repeat(auto-fit, minmax(min(100%, 220px), 1fr)) with gap 16px; each direct child div of .facts-grid has min-width 0, padding 18px, radius 16px, background var(--color-surface-2), 1px solid var(--color-border); its dt is 13px in var(--color-muted); its dd has margin 0, font-family var(--font-heading), weight 700, size 1.25rem, overflow-wrap anywhere; .facts-wide spans grid-column 1 / -1; .facts-grid .detail-links switches back to var(--font-body), 1rem, weight 600. (4) Add .match-hero and the .facts-grid child tiles to the existing forced-colors border list.

Hero values come from the canvas (hero card radius / shadow, 48px title, muted 'против', tile grid); the aggregate 1X2 bar is deliberately not rendered (PD-01).
  </action>
  <verify>
    <automated>pnpm exec vitest run --project unit tests/unit/match-hero-ui.test.tsx tests/unit/responsible-copy.test.ts tests/unit/forecast-comparison-ui.test.tsx tests/unit/odds-draft-ui.test.tsx && pnpm --filter @bet-stats/web typecheck && test "$(grep -c 'max-width: 960px' apps/web/app/globals.css)" = 0 && test "$(grep -c 'match-hero' apps/web/app/globals.css)" -ge 1</automated>
    <!-- gate baselines: 'max-width: 960px' [HEAD=1 EXPECT==0] (the page-column rule is the only 960px rule); 'match-hero' [HEAD=0 EXPECT>=1] -->
  </verify>
  <done>The detail page renders BackLink, one hero card with the h1 and five facts tiles, then the unchanged notices and workbench inside a full-width grid column; the page-column rule no longer caps at 960px; the match-hero test (markup plus stylesheet contract), the responsible-copy scan, the workbench-related unit tests and web typecheck pass; no competition or status duplicate, chip or invented value is rendered.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Workbench two-card layout, facts tiles, EV rows, chevron disclosure and table polish (tests first)</name>
  <files>tests/unit/workbench-design-ui.test.tsx, "apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx", "apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx", apps/web/app/globals.css</files>
  <read_first>apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx (lines 117-128), apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx, tests/unit/forecast-comparison-ui.test.tsx (how snapshot() and ValueResult fixtures are built), tests/unit/forecast-comparison.test.ts (snapshot helper signature), apps/web/app/globals.css (summary, table, panel, field rules)</read_first>
  <behavior>
    - ValueOutcomeSection for a NO_VALUE result: section keeps aria-labelledby outcome-heading and role status; the h3 is exactly `<h3 id="outcome-heading">Нет value-сигнала</h3>`; the four dt texts (Модельная вероятность, Вероятность без перекрытия, Преимущество, Ожидаемое value) are bare `<dt>` elements in that order, each pair inside its own div of the dl with class ev-rows; the expected-value dd has class value-chip and NOT value-chip--positive; reasons stay bare li elements.
    - For a VALUE_CANDIDATE result the expected-value dd has classes value-chip and value-chip--positive and no other dd has them; for INSUFFICIENT_EVIDENCE the section role is alert and the chip is the neutral one.
    - ForecastWorkbench rendered with two issued snapshots (use the snapshot helper from tests/unit/forecast-comparison.test.ts, cast to the prop type): the sections with aria-labelledby odds-heading and comparison-heading are the only two children of one div with class workbench-duo, in that order; the frozen-forecast dl has class facts-grid with four div groups; the input ids source-label, market, forecast-snapshot, odds-snapshot, left-snapshot, right-snapshot and odds-HOME / odds-DRAW / odds-AWAY exist with their original label for= pairing; between the h3 id comparison-heading and the paragraph that starts 'Идентификатор снимка прогноза' there is no div element (sibling contract); the disclosure sentence 'Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.' is still present. If rendering the full branch under the test runner fails because of next/dynamic, keep the ValueOutcomeSection and stylesheet tests and replace the full render by assertions on the workbench source text for the same contracts, and say so in the summary.
    - Stylesheet contract: every workbench-, outcome-, ev-, value-, field--, note-strip and status-line class emitted has a selector; rules for those selectors contain no hex and no rgb / rgba; .workbench-duo uses a min(100%, ...) track so a 360px viewport gets one column; .field--odds input declares min-height 52px; the arrow-glyph summary rules are gone and a summary chevron rule exists.
  </behavior>
  <action>
RED first. Create tests/unit/workbench-design-ui.test.tsx (same import pattern as tests/unit/forecast-comparison-ui.test.tsx; reuse its ValueResult fixture shape for the three outcomes) covering every bullet above; confirm the markup assertions fail at HEAD.

GREEN, markup (class-only edits plus the wrappers named here; no state, handler, id, label or text changes; keep every dt, li and the outcome h3 class-less; never use the prohibited English words listed in the context in classes or comments). In forecast-workbench.tsx: (1) the four sections revision-comparison, forecast, odds and comparison get className 'panel workbench-card'; the odds and comparison sections are wrapped together in one new div className 'workbench-duo' (the wrapper holds exactly those two sections). (2) Wrap each bare label + select pair (forecast-snapshot, market, odds-snapshot) in a div className 'field'; give the paragraphs that hold label + br + input (source-label and the per-selection odds inputs) className 'field' and the per-selection ones 'field field--odds'; give the paragraph with the selection select className 'field'; the label / select pairs inside the revision fieldset keep their structure. (3) The frozen-forecast dl (Вид снимка, Отсечка, Модель, Хвост вне 0-7 голов) gets className 'facts-grid' and each dt/dd pair is wrapped in a plain div. (4) The two details in the forecast section and the receipts details in the value outcome get className 'well'. (5) The 'Перекрытие' paragraph gets className 'note-strip'. (6) The revision status paragraph (role status / alert, usually empty) gets className 'status-line'. (7) 'Поменять снимки местами' gets className 'btn-secondary'. (8) Keep the h3 id comparison-heading and the paragraph with the forecast id code element as direct siblings. In value-outcome-section.tsx: the section keeps its aria-labelledby and role and gets className 'panel workbench-card outcome-card'; the first dl gets className 'ev-rows' with each dt/dd pair wrapped in a div; the expected-value dd gets className 'value-chip value-chip--positive' when result.outcome is VALUE_CANDIDATE and 'value-chip' otherwise (the text stays percent(result.expectedValue)); the paragraph with the copy button and download link gets className 'cluster', the download anchor gets className 'link-touch', the copy button gets className 'btn-secondary'.

GREEN, stylesheet (apps/web/app/globals.css, tokens only; place the new rules after the inner-pages block (after .pre-scroll) and before the operations block so ties resolve in their favour). (1) Disclosure: remove the two rules that draw the arrow glyph through the before pseudo-element and rewrite the summary rule: min-height 44px, flex with justify-content space-between and gap 16px, padding-block 8px, colour var(--color-text), weight 600, no underline, hover colour var(--color-accent-text); add an after pseudo-element chevron (10px box, border-inline-end and border-block-end 2px solid var(--color-muted), rotate 45deg, flex none, transition transform 0.2s, margin-inline-end 4px) that rotates to -135deg when its details is open; in the forced-colors block give it CanvasText borders. Keep the existing focus-visible outline. (2) Tables: th gets colour var(--color-muted), weight 500, size 0.8125rem; td and tbody th get padding-block 14px and a bottom border of var(--color-border); tbody th gets colour var(--color-text), weight 600, size 1rem. (3) .workbench-card is a grid with gap var(--space-4), align-content start, overflow-wrap anywhere; its direct children have margin-block 0; its direct h3 is 1.5rem with letter-spacing -0.01em; its direct buttons get justify-self start; labels inside .field within it are 0.875rem and var(--color-muted). (4) .workbench-duo is a grid with repeat(auto-fit, minmax(min(100%, 26rem), 1fr)), gap var(--space-6), align-items start. (5) .field br is display none; .field [role="alert"] uses var(--color-danger) at 0.875rem; .field--odds input has min-height 52px, size 1.125rem, weight 600. (6) .note-strip: margin 0, padding 14px 16px, radius 14px, background var(--color-surface-2), colour var(--color-muted), size 0.875rem. (7) .status-line:empty is position absolute so the always-rendered live region adds no grid row while staying in the accessibility tree. (8) .ev-rows is a grid with gap var(--space-3) and margin 0; each child div is flex-wrap, align center, justify space-between, gap 8px 12px, padding 16px 18px, 1px solid var(--color-border), radius 16px; its dt weight 600; its dd margin 0, heading font, weight 700, 1.25rem, tabular-nums; .ev-rows .value-chip is 1rem with padding 6px 14px, radius var(--radius-pill), 1px solid var(--color-border-strong), colour var(--color-muted), weight 600; .ev-rows .value-chip--positive uses background and border var(--color-accent-fill), colour var(--color-on-accent), weight 700. (9) .outcome-card > ul has padding-inline-start 1.25rem. (10) Add .workbench-card, .ev-rows child divs and .note-strip to the forced-colors border list.

Update an existing test only if it asserted the old arrow glyph or old summary styling (none is expected); say so in the summary if one is touched.
  </action>
  <verify>
    <automated>pnpm exec vitest run --project unit tests/unit/workbench-design-ui.test.tsx tests/unit/forecast-comparison-ui.test.tsx tests/unit/odds-draft-ui.test.tsx tests/unit/calibration-panel-ui.test.tsx tests/unit/responsible-copy.test.ts tests/unit/fixtures-row-ui.test.tsx tests/unit/match-hero-ui.test.tsx && pnpm --filter @bet-stats/web typecheck && test "$(grep -vE '^\s*(/\*|\*)' apps/web/app/globals.css | grep -c 'summary::before')" = 0 && test "$(grep -c 'workbench-duo' apps/web/app/globals.css)" -ge 1</automated>
    <!-- gate baselines: 'summary::before' outside comments [HEAD=2 EXPECT==0]; 'workbench-duo' [HEAD=0 EXPECT>=1] -->
  </verify>
  <done>Odds entry and exact-snapshot comparison render as two side-by-side cards that stack below ~860px; the frozen-forecast values are tiles; the verdict is a card of bordered rows with an accent chip only for VALUE_CANDIDATE; all ids, label pairings, roles, headings, button names and the h3 / code sibling contract are unchanged; every disclosure uses the chevron treatment and tables use the muted-head 14px-row style; the new workbench test and the related unit tests pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Scorecards KPI tiles, methodology grid and band, FAQ cards, panel / header / footer / list polish (tests first)</name>
  <files>tests/unit/inner-pages-design-ui.test.tsx, apps/web/app/scorecards/scorecard-dashboard.tsx, apps/web/app/methodology/page.tsx, apps/web/app/faq/page.tsx, apps/web/app/globals.css</files>
  <read_first>apps/web/app/scorecards/scorecard-dashboard.tsx (lines 64-89), apps/web/app/methodology/page.tsx, apps/web/app/faq/page.tsx (lines 65-80 and 356-408), tests/unit/scorecard-ui.test.tsx (vi.mock of next/navigation and the model fixture), apps/web/app/globals.css (panel, well, steps-list, page-deck, date-group-heading, fixtures-filter-card, filter-chip, quota-counter, theme-toggle, release-age-badge, release-main)</read_first>
  <behavior>
    - ScorecardDashboard (reuse the vi.mock of the resolved next/navigation path and a minimal model like tests/unit/scorecard-ui.test.tsx): the paragraph whose class contains kpi-tile has, after tags are stripped and whitespace normalised, exactly 'Оценка Брайера: 0.4400' (and a second one 'Логарифмическая потеря: 0.6700'); label and value are separate spans with classes kpi-label and kpi-value and the colon sits in an sr-only span; both tiles are inside one div with class kpi-grid after the h2 'Правильные меры оценки' (which stays a direct child of its section); the lead paragraph has class page-deck; the health heading still precedes 'Оценка Брайера' in the markup; the pagination links (rendered with a nextCursor and a cursor) have class link-touch; details#formula-policy-receipts has classes panel and panel--stack; the null-metrics branch still renders its single honest paragraph.
    - MethodologyPage: the article has class page-column; the h2 texts in document order are exactly Входы, Поправка на низкие счета, Что исключается, Уверенность, Ограничения, Оценка, Калибровка вероятностей, Ответственное использование, История изменений; each of the nine sections is `<section id=...>` whose first child is its h2; the first seven sections (inputs ... calibration) are inside one div with classes card-grid and card-grid--lg, in that order, and responsible-use and change-history are outside it; responsible-use has class panel--band; the metadata dl keeps its aria-label, has classes panel and facts-grid and five div groups; both intro paragraphs have class page-deck; every TechnicalDetails is still a details with class well and a summary whose only child is the text 'Технические подробности'; the change-history article count equals MODEL_CARD.changeHistory.length.
    - FaqPage: the ol has classes steps-list and role list with 12 li; the Q&A dl has class faq-list with 5 dt; no details element exists anywhere in the FAQ markup; the first paragraph has class page-deck; headings and link hrefs are unchanged.
    - Stylesheet contract (comments stripped): every class emitted by these three pages that starts with kpi-, card-grid--, panel--band, faq- or steps- (and page-deck, link-touch, cluster) has a selector; rules for kpi-, card-grid--lg, panel--band, steps-list, faq-list, well, page-deck, back-link contain no hex / rgb / rgba; .release-main .page-deck exists; summary chevron exists (already from Task 2); .filter-chip declares min-height 44px and no 40px remains; .date-group-heading uses var(--color-accent-text); .quota-counter declares border-radius 14px, .theme-toggle 16px, .release-age-badge 38px with radius 12px.
  </behavior>
  <action>
RED first. Create tests/unit/inner-pages-design-ui.test.tsx (same import pattern; import MethodologyPage from apps/web/app/methodology/page.js, FaqPage from apps/web/app/faq/page.js, MODEL_CARD from the domain package as the page does, and ScorecardDashboard from apps/web/app/scorecards/scorecard-dashboard.js with the same vi.mock header and a small model fixture copied in shape from tests/unit/scorecard-ui.test.tsx). Implement every bullet above and confirm the markup assertions fail at HEAD.

GREEN, markup (class-only edits plus the wrappers named here; no copy, heading, id, aria or link changes; avoid the prohibited English words in classes and comments). scorecard-dashboard.tsx: the lead paragraph gets className 'page-deck'; in the 'Правильные меры оценки' section the two metric paragraphs are wrapped in one div className 'kpi-grid' and each becomes `<p className="kpi-tile">` containing a span 'kpi-label' (the Russian label without the colon followed by a span className 'sr-only' holding the colon), a space, and a span 'kpi-value' holding the same toFixed(4) number as before; the null-metrics paragraph is untouched; the two pagination Links get className 'link-touch' and the nav gets className 'cluster'; details#formula-policy-receipts gets className 'panel panel--stack'. methodology/page.tsx: article className 'page-column'; both intro paragraphs className 'page-deck'; the metadata dl gets className 'panel panel--stack facts-grid' (keep aria-label) with each dt/dd pair wrapped in a plain div; the seven sections inputs, dixon-coles, what-is-excluded, confidence, limitations, evaluation and calibration change className from 'panel panel--stack' to 'panel' and are wrapped together in one div className 'card-grid card-grid--lg' placed where the first of them stood; responsible-use becomes 'panel panel--stack panel--band'; change-history stays 'panel panel--stack'; TechnicalDetails is unchanged. faq/page.tsx: first paragraph className 'page-deck'; the ol gets role='list' besides className steps-list (restores list semantics where list-style none drops them); the Q&A dl gets className 'faq-list'; nothing else changes and no details element is added (PD-03).

GREEN, stylesheet (apps/web/app/globals.css, tokens only; add rules after the Task 2 block unless noted). (1) Panels and tables: .panel > :first-child gets margin-block-start 0 and .panel > :last-child margin-block-end 0; .panel--stack margin-block becomes var(--space-6). (2) .well becomes background var(--color-surface-2), 1px solid var(--color-border), radius 16px, padding var(--space-1) var(--space-4) var(--space-4), margin-block-start var(--space-4). (3) .release-main padding-block becomes var(--space-12) var(--space-16) (the homepage override that zeroes padding through the has() rule is untouched). (4) Page head: .release-main .page-deck gets font-size 1.0625rem, colour var(--color-muted), line-height 1.55 (the .release-main prefix outranks the editorial article paragraph rule); keep its max-width 68ch and bottom margin. (5) KPI: .kpi-grid is a grid with repeat(auto-fit, minmax(min(100%, 240px), 1fr)) and gap var(--space-4); .kpi-tile is a flex column with gap 6px, margin 0, padding 20px 24px, background var(--color-surface-2), 1px solid var(--color-border), radius var(--radius-panel); .kpi-label is 0.875rem in var(--color-muted); .kpi-value uses the heading font, weight 700, 2.5rem, letter-spacing -0.02em, tabular-nums, overflow-wrap anywhere. (6) Methodology: .card-grid--lg sets --card-min to 26rem, gap var(--space-6), align-items start, and its h2 is 1.4375rem; .panel--band uses background var(--color-accent-soft), border-color transparent, radius var(--radius-card), padding 20px 20px (28px 32px from 768px); .panel--band .well uses background var(--color-surface). (7) FAQ: .steps-list becomes list-style none, padding 0, margin 0, a grid with gap var(--space-4) and counter-reset faq-step; each li has counter-increment faq-step, position relative, padding 20px 20px 20px 72px, background var(--color-surface), 1px solid var(--color-border), radius var(--radius-panel), min-width 0; li::before shows the counter in a 40px square at inset-block-start 20px / inset-inline-start 20px with radius 12px, background var(--color-accent-soft), colour var(--color-accent-text), heading font, weight 700, centred; li > :first-child margin-block-start 0, li > :last-child margin-block-end 0, li h3 is 1.25rem. .faq-list has margin 0; its dt is 1.0625rem with padding-block-start 18px, margin-block-start 18px and a top 1px solid var(--color-border); dt:first-of-type has no margin, padding or border; dd has margin 6px 0 0 and colour var(--color-muted). (8) Header / footer: .quota-counter radius 14px, .theme-toggle radius 16px, .release-age-badge 38px by 38px with radius 12px. (9) Fixtures list leftovers: .date-group-heading colour var(--color-accent-text) and size 1.5rem; .fixtures-filter-card radius var(--radius-card) with padding var(--space-6) from 768px; .filter-chip min-height 44px. (10) Add .kpi-tile, .steps-list > li and .panel--band to the forced-colors border list.

Do not edit apps/web/app/fixtures/page.tsx (its source is scanned by tests/integration/phase-01-security.test.ts and the rows were finished in 261124-oy4). Update an existing test only if it asserted old styling itself (none is expected); say so in the summary if one is touched.
  </action>
  <verify>
    <automated>pnpm exec vitest run --project unit tests/unit/inner-pages-design-ui.test.tsx tests/unit/scorecard-ui.test.tsx tests/unit/workbench-design-ui.test.tsx tests/unit/match-hero-ui.test.tsx tests/unit/fixtures-row-ui.test.tsx tests/unit/home-page-ui.test.tsx tests/unit/responsible-copy.test.ts && pnpm exec vitest run --project integration tests/integration/phase-01-security.test.ts && pnpm --filter @bet-stats/web test && pnpm --filter @bet-stats/web typecheck && pnpm --filter @bet-stats/web lint && test "$(grep -c 'min-height: 40px' apps/web/app/globals.css)" = 0 && test "$(grep -c 'kpi-' apps/web/app/globals.css)" -ge 1 && test "$(grep -c 'faq-list' apps/web/app/globals.css)" -ge 1 && test "$(grep -c 'panel--band' apps/web/app/globals.css)" -ge 1</automated>
    <!-- gate baselines: 'min-height: 40px' [HEAD=1 EXPECT==0]; 'kpi-' [HEAD=0 EXPECT>=1]; 'faq-list' [HEAD=0 EXPECT>=1]; 'panel--band' [HEAD=0 EXPECT>=1] -->
  </verify>
  <done>/scorecards shows the deck, two KPI tiles with unchanged element text, a receipts card and 44px pagination links; /methodology is full width with metadata tiles, a seven-card grid, the accent band and chevron disclosures with ids and heading order intact; /faq shows numbered step cards and ruled Q&A with list and dl semantics; header, footer and fixtures-list leftovers match the canvas values; panels have no first-child gap; the new inner-pages test, the scorecard test, the security source scan, web test / typecheck / lint pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| API JSON -> server-rendered markup | Team names, competition names, fixture ids, forecast and value payloads come from the Nest API / providers and are untrusted strings |
| Rendered analytics -> user decision | Percentages, expected value and chips are read by users who may bet; the UI must not imply certainty, invented value or hidden risk |

## STRIDE Threat Register

Threat IDs are unique within this quick task (no other plan in this directory uses T-ppa).

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ppa-01 | Tampering | MatchHero / BackLink building text and links from API strings | medium | mitigate | Names render as React text children (no raw-HTML injection API); hrefs still come from the existing encodeURIComponent-based evidenceHref and safeReturn, unchanged; the hero test asserts escaping of angle brackets and ampersands |
| T-ppa-02 | Information disclosure | Positive-looking chip or hero numbers implying value or certainty | high | mitigate | The accent chip is emitted only for outcome VALUE_CANDIDATE, every other outcome gets the neutral outline; no demo number, no 1X2 hero bar and no invented caption is added (PD-01, PD-02, PD-05); the workbench test asserts the chip class per outcome and that the disclosure sentence is still rendered; RiskDisclosure and the contextual warnings stay in place; responsible-copy scan runs |
| T-ppa-03 | Repudiation | Immutable snapshot identity and receipts visually hidden by the layout | medium | mitigate | No text, id, label, dt or heading is removed or reworded; the h3 / forecast-id sibling contract, the receipt details and the exact verdict dt strings are asserted by tests |
| T-ppa-04 | Denial of service (usability) | Overflow at 360px / 200% text, targets under 44px, contrast loss in a theme, glyph-only disclosure in forced colors | medium | mitigate | min(100%, ...) tracks for every new grid, min-width 0 and overflow-wrap anywhere on cards, 44px minimum asserted for back link, chips, summaries and pagination links, token-only colours covered by the existing design-tokens contrast tests (accent-soft band uses accent-text and text colours, measured above 6.9:1 in light), CanvasText borders added to the forced-colors list; the Playwright specs listed below are the end-to-end check |
| T-ppa-SC | Tampering | npm/pip/cargo installs | high | accept | No dependency is added or changed (style and markup only, no lockfile diff), so the package-legitimacy gate is not triggered |
</threat_model>

<verification>
Run from the repo root.

1. Unit and source scans: `pnpm exec vitest run --project unit tests/unit/match-hero-ui.test.tsx tests/unit/workbench-design-ui.test.tsx tests/unit/inner-pages-design-ui.test.tsx tests/unit/scorecard-ui.test.tsx tests/unit/forecast-comparison-ui.test.tsx tests/unit/odds-draft-ui.test.tsx tests/unit/calibration-panel-ui.test.tsx tests/unit/fixtures-row-ui.test.tsx tests/unit/fixtures-forecast-ui.test.tsx tests/unit/home-page-ui.test.tsx tests/unit/provider-state-ui.test.tsx tests/unit/results-sync-button-ui.test.tsx tests/unit/responsible-copy.test.ts`, then the whole unit project `pnpm exec vitest run --project unit` (baseline 72 files / 1018 tests plus the new ones, none failing), and `pnpm exec vitest run --project integration tests/integration/phase-01-security.test.ts`.
2. Web package: `pnpm --filter @bet-stats/web test` (baseline 209 tests incl. design-tokens), `pnpm --filter @bet-stats/web typecheck`, `pnpm --filter @bet-stats/web lint` (0 errors; 9 pre-existing warnings, none new).
3. Production build: `NEXT_DIST_DIR=.next-gate pnpm --filter @bet-stats/web build`, then `git checkout -- apps/web/next-env.d.ts` (never commit it).
4. Best effort, state the outcome honestly in the summary (port 3001 was occupied last time, which aborted Playwright): `pnpm exec playwright test tests/e2e/forecast-workbench.spec.ts tests/e2e/evidence-scorecard.spec.ts tests/e2e/methodology.spec.ts tests/e2e/release-accessibility.spec.ts tests/e2e/fixture-discovery.spec.ts`. These are the only automated checks of 360px no-overflow, the sibling / heading / text contracts against the real DOM and forced colors. If the stack cannot boot, report NOT RUN instead of claiming success and do not stop foreign processes.
5. Scope check: `git status --short` lists only the files in files_modified (plus the SUMMARY); apps/web/next-env.d.ts is clean; `git diff --stat -- apps/web/app/fixtures/page.tsx apps/web/app/page.tsx` is empty.
6. Human visual pass recommended and not performed by the executor: /fixtures/<id>, /scorecards, /methodology, /faq at 1440, 768 and 390px in light and dark (hero card, two-card duo stacking, KPI tiles, band contrast, chevron rotation, step numbers).
</verification>

<success_criteria>
- The detail page has a back link, a hero card with the real facts as tiles, a side-by-side odds / comparison layout, a facts-tile frozen forecast and a bordered-row verdict, with every id, label, role, heading and button name unchanged.
- /scorecards, /methodology and /faq follow the canvas card, tile, band and chevron treatments with real copy and data only; FAQ keeps list / dl semantics; no demo number, chip, chart or status card is invented.
- One chevron disclosure style, muted-head tables, panel top gaps removed, header / footer / fixtures-list leftovers aligned to the canvas values, full 1200px page columns.
- Token-only colours in every new rule; 44px targets; no horizontal overflow at 360px by construction; forced-colors borders cover the new surfaces.
- Unit, integration source-scan, web test / typecheck / lint and the production build pass; next-env.d.ts is reverted; Playwright outcome reported honestly; any edited existing test is named in the summary.
</success_criteria>

<output>
Create `.planning/quick/261124-ppa-vnedri-dizayn-vseh-stranits-v-prilozheni/261124-ppa-SUMMARY.md` when done
</output>
