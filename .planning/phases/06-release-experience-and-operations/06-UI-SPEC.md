---
phase: 6
slug: release-experience-and-operations
status: draft
shadcn_initialized: false
preset: none
created: 2026-09-20
---

# Phase 6 — UI Design Contract

> Visual and interaction source of truth for the release experience, methodology, operator center, privacy controls, and production-like release states. Decisions D-01 through D-16 are binding.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | Manual token layer over existing semantic React components; no shadcn |
| Preset | Not applicable |
| Component library | Native HTML (`nav`, `button`, `details`, `dialog`/modal semantics, `table`, forms); existing project components |
| Icon library | None. Text labels are mandatory; symbols must never carry meaning alone. |
| Font | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| Styling | Shared CSS custom properties/classes introduced from the tokens below; new Phase 06 surfaces must not add one-off inline color/spacing values. Existing inline styles migrate when touched. |

Reuse `AnalyticsShell`, `RiskDisclosure`, `DataStateNotice`, `EvidenceStateNotice`, and `ProviderStateNotice`. Extend their state vocabulary without changing server-owned identities or substituting missing data. Use the existing replay preview/confirm flow as the recovery interaction baseline.

### Responsive frame

| Token / rule | Contract |
|--------------|----------|
| Content maximum | `1200px`; centered |
| Page gutter | `16px` below `768px`; `24px` at and above `768px` |
| Breakpoints | `sm: 480px`, `md: 768px`, `lg: 1024px`, `xl: 1200px` |
| Primary transformation | Below `768px`, navigation collapses and dense evidence transforms from tables/charts into conclusion-first cards. |
| Reflow floor | At `320px` CSS width and 200% text zoom, no horizontal page scroll. Only genuinely two-dimensional evidence tables may scroll inside a labeled container. |
| Touch target | Interactive controls are at least `44 × 44px`; primary navigation and destructive controls are `48px` high. |

## Spacing Scale

Declared values are the only layout spacing values for new Phase 06 work:

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 4px | Icon/text micro-gap, focus offset |
| `space-2` | 8px | Inline metadata, compact control gap, dense row/card internal gap |
| `space-4` | 16px | Default element and mobile card padding |
| `space-6` | 24px | Panel padding, form groups, desktop gutter |
| `space-8` | 32px | Section separation |
| `space-12` | 48px | Major page sections |
| `space-16` | 64px | Page-level separation only |

Exceptions: `44px` and `48px` are minimum control dimensions, not spacing. Border widths are `1px`; state emphasis uses `4px` inline-start borders. Radius tokens are `8px` for controls/notices and `10px` for cards/panels.

## Typography

Use exactly four sizes and two weights. Tabular numbers use `font-variant-numeric: tabular-nums`.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Label / metadata | 14px | 400 or 600 | 1.4 |
| Body / controls | 16px | 400 or 600 | 1.5 |
| Section heading | 20px | 600 | 1.3 |
| Page title / display | 28px | 600 | 1.2 |

Rules: body copy never drops below `16px` except nonessential metadata; button/link text is at least `16px`; long IDs use a monospace system stack at `14px`, wrap with `overflow-wrap:anywhere`, and retain a full accessible name. Uppercase is reserved for machine state codes shown alongside a human label, never for paragraphs.

## Color

All text/background combinations must meet WCAG AA: 4.5:1 for normal text and 3:1 for large text and UI boundaries. State meaning always includes text; color is supplemental.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#F8FAFC` | Page background and quiet regions |
| Secondary (30%) | `#FFFFFF` | Header, footer, cards, forms, dialogs |
| Accent (10%) | `#1D4ED8` | Primary links, primary CTA fill/border, active navigation indicator, focus ring |
| Text | `#0F172A` | Primary text |
| Muted text | `#475569` | Secondary metadata only |
| Border | `#CBD5E1` | Cards, inputs, table rules |
| Informational | `#1D4ED8` / tint `#EFF6FF` | Available/current and neutral information |
| Warning | `#A16207` / tint `#FEFCE8` | Stale, limited, quota protected, partial evidence |
| Success | `#15803D` / tint `#F0FDF4` | Ready, delivered, confirmed; never a prediction outcome |
| Destructive | `#B91C1C` / tint `#FEF2F2` | Consent withdrawal and irreversible deletion only |

Accent is reserved for primary links, the single primary action in a region, active navigation, and visible focus rings. It is not used for probability magnitude, value classification, positive profit, or decorative card borders. Destructive red is never used for ordinary retry/replay because those actions are audited recovery, not deletion.

Focus styling: `3px solid #1D4ED8` with `4px` (`space-1`) offset, visible under `:focus-visible`; focused content must not be obscured by the sticky header. Disabled controls use reduced contrast only when paired with native `disabled` and a visible reason.

## Copywriting Contract

Product UI copy is English to match the existing application. Copy uses plain language first, machine codes second, no certainty claims, and no imperative betting language.

| Element | Exact copy |
|---------|------------|
| Release primary CTA | `View match analysis` |
| Operator overview CTA | `Refresh system status` |
| Recovery primary CTA | `Preview recovery impact` |
| Recovery confirm CTA | `Confirm and queue recovery` |
| Methodology CTA | `Read technical details` |
| Empty fixture list | Heading: `No fixtures match these filters`; body: `Change the date or competition. Existing filters were not broadened.` |
| Empty operator failures | Heading: `No active failures`; body: `No failed or dead-lettered work matches this view. Last checked {localized time}.` |
| Empty retained history | Heading: `No retained betting history`; body when consent is off: `History is not saved by default. You can use manual odds without retaining personal history.` |
| Block load error | `{Block name} could not be loaded. Valid information elsewhere on this page is unchanged. Last valid update: {localized time or "Not available"}. Try again.` |
| Stale data | `{Block name} is not current. Last valid update: {localized time}. Missing values were not treated as zero.` |
| Generic retry | `Try again` |
| Consent opt-in | `Allow retention of my betting-related history under policy {version}` |
| Consent helper | `Optional. Manual odds and analysis still work when history retention is off.` |
| Withdrawal action | `Withdraw consent and delete history` |
| Withdrawal confirmation | Heading: `Delete retained betting history?`; body: `This permanently deletes your retained odds and viewed-result history and stops future retention. Anonymous model receipts may remain only when they cannot be linked to you. This cannot be undone.`; confirm: `Delete history and withdraw consent`; cancel: `Keep consent` |
| Recovery confirmation | `Queue recovery for the exact scope shown? Existing observations and issued snapshots remain immutable. A reason is required and the action receives a correlation ID.` |
| Recovery success | `Recovery queued. Correlation ID: {id}. Existing immutable facts were not changed.` |
| Unauthorized operator route | Render the established not-found experience; do not reveal that an operator surface exists. |

Contextual warning beside every forecast: `Probabilities are estimates, not guarantees. Evidence may be incomplete or stale.` Beside every value result: `A positive expected value is a model estimate, not a promise of profit.` Beside every scorecard: `Historical evaluation does not guarantee future performance.` The full persistent responsible-use disclosure remains in the global/footer and `AnalyticsShell` boundary.

## Information Architecture and Navigation

### Public top navigation

The only primary destinations, in fixed DOM and visual order, are:

1. `Fixtures` → `/fixtures`
2. `Analysis` → the canonical analysis entry/workbench route
3. `Results` → `/scorecards`
4. `Methodology` → `/methodology`

At `md` and above, show brand at start and all four links inline. The current route uses `aria-current="page"`, weight 600, and a 2px accent underline; no color-only indication. The header may be sticky only if skip-link targets and focused controls remain fully visible.

Below `md`, show the brand plus a native `button` labeled `Menu`, with `aria-expanded` and `aria-controls`. The disclosed panel contains the same four ordinary links in the same order, each at least 48px high. It closes on destination activation, Escape, or viewport transition to desktop; Escape returns focus to the trigger. Tab follows DOM order and is not trapped. Outside-click closure is optional and must not replace those mechanisms. No hover-only submenu exists.

A `Skip to main content` link is the first focusable element and becomes visible on focus. Operator pages are not added to public navigation; they remain behind the signed internal gateway.

## Responsive Evidence Contract

Desktop and mobile render from the same typed server projection. No field, warning, action, receipt, filter, exact identity, freshness timestamp, or denominator may exist in only one layout.

### Mobile card anatomy

Every transformed table row/chart panel follows this order:

1. Conclusion heading: human result/state, never only a code.
2. Primary measure and denominator (`value`, sample/count, unit).
3. Confidence/evidence state and contextual warning.
4. Freshness/source timestamp where applicable.
5. Primary action if one exists.
6. Native `<details>` summary `Complete evidence` containing remaining fields, exact identities, receipts, and technical values.

Cards are one column below `768px`; two columns are permitted from `768px` when reading order remains row-major. Do not use CSS visual ordering that differs from DOM order. `details` remains closed by default except when it contains the sole explanation of an error, validation problem, or destructive consequence; those are always visible.

### Tables and charts

Desktop tables retain semantic headers and captions. A two-dimensional table may use an internal horizontal scroller with `tabindex="0"`, an accessible label, and a visible gradient/description indicating overflow; the page itself must not scroll horizontally. Mobile must prefer cards over a shrunken table.

Every chart has an adjacent visible conclusion, exact denominator, evidence/limitation status, and a data-table or definition-list alternative reachable without pointer interaction. Tooltips cannot be the sole source of values. Patterns/labels supplement color. Empty buckets remain visible as `Insufficient evidence`; null is never plotted as zero. With reduced motion, chart transitions are disabled.

## Localized Degraded States

Each independently fetched/calculated block implements `loading`, `available`, `limited`, `stale`, `unavailable`, and `retrying` when applicable. A block failure never replaces the route or successful siblings.

| State | Required presentation | Interaction |
|-------|-----------------------|-------------|
| Loading | Heading remains; skeleton lines match final geometry; `aria-busy="true"`; one polite status `Loading {block name}…` | Existing content remains if refreshing; never blank the page. |
| Available | Data, source/evidence label, current freshness where relevant | Normal controls enabled. |
| Limited | Warning notice, exact reason in plain language, retained valid facts, missing fields as `Not available` | Retry only if the server says `retryAllowed`; technical reason in disclosure. |
| Stale | Warning plus `Last valid update`; stale values remain explicitly labeled | Retry remains local and preserves the prior value while pending. |
| Unavailable | Alert on first failure, reason, freshness, no numeric substitution | `Try again` acts on only this block. |
| Retrying | Prior valid content stays visible; trigger disabled and label becomes `Trying again…`; polite status | On success announce `Updated`; on failure retain content and local error. |

Dates are rendered with the active locale and explicit time-zone abbreviation in visible copy, while `<time dateTime>` retains ISO UTC. Machine reason codes are available only in technical details. Provider states reuse `ProviderStateNotice`; evidence states reuse `EvidenceStateNotice`; data quality uses `DataStateNotice`.

## Methodology and Versioned Model Card

The page begins with `How forecasts work`, a 2–3 paragraph plain-language summary, a prominent metadata panel (`Model card version`, `Effective date`, `Current model/config`), and the persistent limitation/risk statement.

Primary sections appear in this fixed order: `Inputs`, `What is excluded`, `Confidence`, `Limitations`, `Evaluation`, `Responsible use`, `Change history`. Each section exposes an accessible primary explanation before a nested native `<details>` labeled `Technical details`.

The technical layer must include, as applicable: formulas; thresholds; minimum samples; freshness rules; model/config hashes and versions; settlement/cohort/formula policy IDs; leakage prevention; known failure modes; and links to exact receipt destinations. Long formulas wrap or scroll inside a labeled code region; they never cause page overflow. Receipt links use descriptive names, not raw IDs alone.

The version and effective date stay visible without opening disclosures. Change history is newest first; each entry has version, effective date, summary of material changes, affected policies/models, and migration/interpretation note. Deep links to every primary and technical section use stable fragment IDs. Contextual `Methodology and limitations` links appear beside forecast, value, and scorecard warnings and preserve no personal activity parameters.

## Operator Center

### Landing hierarchy

The internal page title is `Operations center`. Content order is fixed:

1. System readiness summary.
2. Provider health.
3. Quota consumption.
4. Failed and dead-lettered work.
5. Data-quality errors.
6. Recent incidents.

Readiness is a text state (`Ready`, `Degraded`, `Not ready`) with contributing services and last checked time. Provider cards include provider, circuit state, endpoint family, last successful observation, and safe reason. Quota uses `used / effective allowance`, percentage, reset time, and critical reservations; it is never a color-only gauge. Default refresh is manual; if 30-second polling is implemented, it pauses when the tab is hidden, shows `Last checked`, and preserves keyboard focus.

Failures are grouped by root cause then impact (`Blocking`, `Degraded`). Group cards show count, affected domain/scope, first and last occurrence, retryability, and representative safe correlation IDs. Expanding a group reveals paginated affected jobs and exact safe logical identities. IDs have visible `Copy correlation ID` buttons; copy success is announced politely. Raw payloads, request/response headers, credentials, tokens, environment variables, stack traces, arbitrary metadata blobs, and unrestricted logs are never rendered or returned to the browser.

Long identifiers wrap; group names and reasons wrap without truncation. Lists paginate after 25 items, show `Showing {start}–{end} of {total}`, and retain filters in the URL. Empty, partial, and failed operator blocks use the local state contract.

### Safe recovery flow

Recovery is a three-step workflow with no direct row-level requeue:

1. `Preview`: choose exact failed scope and enter a reason (10–500 characters); request a server-owned preview.
2. `Review impact`: show frozen logical identity, affected count/time window, estimated quota reservations and remaining headroom, policy lane, expiry, and guarantees `Existing observations preserved`, `Issued prediction snapshots not changed`, `Duplicate facts not created`.
3. `Confirm`: modal/dialog with the same scope summary and required reason; confirm queues the frozen preview only.

The dialog receives focus on its heading, traps focus while open, closes on Escape/cancel, and restores focus to the trigger. A stale/expired or changed preview is not confirmable; show `This preview is no longer current. Preview recovery again.`, close confirmation, and move focus to `Preview recovery impact`. Double submission is disabled client-side and converges server-side. Completion shows plan ID, correlation ID, lane, queued/existing-plan state, and immutable guarantees. Evaluation recovery additionally shows exact `ResultVersion + ForecastSnapshot + policy hash` identity.

## Consent, Retention, and Withdrawal

Retention is off by default. No prechecked checkbox, bundled consent, or consent inferred from continued use is permitted. The privacy panel must state current status (`History retention is off/on`), policy version, effective date, covered data categories, retention boundary supplied by the approved policy, and a link to the full privacy explanation.

Opt-in is a separate explicit control. Before confirmation, show categories retained: submitted manual-odds history and viewed-result history. Also show excluded data: immutable model receipts and non-personal system facts are not personal history and may remain only when unlinkable. If no approved subject identity or retention duration is configured, durable opt-in is disabled with `History retention is unavailable until the retention policy is complete`; ordinary analysis remains functional.

Withdrawal is destructive and one-way. It requires the confirmation copy in the Copywriting Contract, but no dark pattern, typed phrase, or repeated confirmation. While processing, the action reads `Deleting history…` and cannot be submitted twice. Success moves focus to a status heading and announces `Consent withdrawn. Retained betting history was deleted and future retention is off.` Partial deletion must never be reported as success; show a blocking alert with a support-safe correlation ID and leave the server-authoritative state visible. The UI must not imply deletion of unlinkable immutable analytical facts.

## Accessibility Contract

- Use landmarks (`header`, primary `nav`, `main`, `footer`) and one page-level `h1`; headings never skip levels within a surface.
- All functionality works with keyboard alone. Enter/Space activation follows native behavior. Hover/focus content is dismissible and reachable.
- Focus order follows visual/DOM order. Route changes focus the page heading; local retries preserve focus; errors receive focus only when action is blocked.
- Async nonblocking updates use `role="status"`/polite live regions; blocking submission/deletion failures use `role="alert"`. Do not repeatedly announce polling updates when state is unchanged.
- Every input has a visible label, description, and inline error linked by `aria-describedby`; error summaries link back to invalid fields.
- Minimum target is 44px; navigation/destructive controls are 48px. Do not disable zoom.
- At 320px width and 200% zoom, information and actions remain available without two-axis page scrolling.
- Respect `prefers-reduced-motion`; no essential meaning depends on animation. Respect forced colors and do not remove native outlines without the specified replacement.
- Charts require visible textual conclusions and complete data alternatives. Status, confidence, readiness, profit, and provider health never rely on color alone.
- English is the document language. Localized date/number formatting does not translate stored reason codes; UI maps codes to reviewed human copy.

## UI Considerations

Applicable state considerations resolved: **30 covered, 8 backstop, 0 unresolved**.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| Empty | Fixture/results/failure/history collections | ✅ covered | Each collection uses the exact empty copy in the Copywriting Contract and preserves active filter/consent context. |
| Loading | Navigation destinations, analytical blocks, operator blocks, recovery actions | ✅ covered | Stable headings and geometry remain; `aria-busy`, explicit pending labels, and a single polite announcement are required. |
| Error | Analytical blocks, operator projections, consent/recovery forms | ✅ covered | Errors remain block-local, name the problem and next action, preserve valid siblings, and never claim success after partial deletion or queue failure. |
| Populated | Fixtures, mobile evidence cards, model card, failure groups | ✅ covered | Typical content follows the fixed hierarchy and shared typed projections defined above. |
| Partial | Forecast/evidence/operator blocks | ✅ covered | Available facts remain; absent fields read `Not available`; reason, freshness, and local retry are adjacent. |
| Overflow | Navigation, tables, identifiers, formulas, copy | ✅ covered | Mobile menu discloses all links; tables alone may internally scroll; IDs/formulas wrap; page-level horizontal overflow is forbidden. |
| Zero / one / many | Failure groups, incidents, fixtures, candidates | ✅ covered | Exact counts drive singular/plural labels; zero uses empty state; 25+ operator items paginate. |
| Long text | Failure reasons, consent copy, model-card prose, IDs | ✅ covered | Prose wraps; IDs use `overflow-wrap:anywhere`; no essential content is ellipsized. |
| Reflow parity | All public workflows | 🧪 backstop | Playwright must assert required data/actions at desktop, Pixel 7, 320px, and 200% text zoom using the same server projection. |
| Keyboard journey | Navigation, odds/value, disclosures, replay, withdrawal | 🧪 backstop | Keyboard-only E2E covers skip link, menu, forms, details, dialog focus/restore, retry, and withdrawal. |
| Chart comprehension | Scorecard and analytical charts | 🧪 backstop | Tests assert visible conclusion, denominator, limitation state, and accessible data alternative for every chart. |
| Secret absence | Operator API and DOM | 🧪 backstop | Seed canary secrets/raw payloads and recursively assert they do not appear in JSON, DOM, traces, or screenshots. |
| Immutable recovery | Replay/retry result | 🧪 backstop | Production-boundary test compares immutable IDs, hashes, and counts before/after preview-confirm recovery. |
| Consent default | Betting-related history | 🧪 backstop | Integration/E2E proves no durable personal association before explicit versioned consent. |
| Withdrawal boundary | Retained history | 🧪 backstop | Test proves atomic deletion, cache invalidation, future-write denial, and unlinkability while non-personal receipts remain valid. |
| Honest degradation | All representative degraded states | 🧪 backstop | Real PostgreSQL/Redis/API/worker/web tests cover quota exhaustion, open circuit, provider unavailable, quarantine, stale/limited evidence, dead letter, and safe replay without network interception. |

## Testable UI State Matrix

| Surface | Required states and assertions |
|---------|--------------------------------|
| Primary navigation | Desktop expanded; mobile collapsed/expanded; current page; Escape close; route activation; focus return; all four links always present. |
| Fixture/analysis/value/scorecard blocks | Loading, available, empty, limited, stale, unavailable, retrying, retry success/failure; valid sibling content remains unchanged. |
| Mobile evidence | Zero/one/many cards; details closed/open; long IDs; missing data; parity with desktop; 320px reflow. |
| Methodology | Current metadata, all seven primary sections, every technical disclosure, receipt links, long formula, multi-entry changelog, contextual warning backlinks. |
| Operator readiness | Ready, degraded, not ready, partial block error, stale last-checked, manual refresh, unchanged poll. |
| Provider/quota | Closed/open/half-open circuit, quota normal/near limit/exhausted, reset known/unknown, critical reservation present, sole-source unavailable. |
| Failures/dead letters | Empty, one, grouped many, pagination, long reason/ID, non-retryable, retryable, data-quality quarantine, incident detail. |
| Recovery | Form invalid, preview loading/error/zero/valid/stale/expired, confirmation cancel/confirm, duplicate submission, queue failure/success/existing plan, focus restoration. |
| Consent | Off by default, policy incomplete, opt-in pending/error/success, on, withdrawal cancel/pending/error/success, future retention denied. |
| Global accessibility | Axe smoke plus explicit keyboard, focus, accessible-name, status-announcement, reduced-motion, contrast, 200%-zoom, and chart-alternative assertions. |

The release gate must exercise the complete fixture → forecast → manual odds → value → result → settlement → scorecard journey and every D-16 degradation through real PostgreSQL, Redis, API, worker, and web boundaries. Browser route interception, fabricated page-only state, or hidden zero substitution fails the contract.

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | None | Not applicable — shadcn is not initialized. |
| Third-party registries | None | No registry code permitted by this contract. |

## Source Traceability

| Source | Decisions used |
|--------|----------------|
| `06-CONTEXT.md` | D-01 through D-16; all locked hierarchy, recovery, privacy, and verification decisions |
| `06-RESEARCH.md` | Native semantic controls, 768px transformation, local degradation, safe DTOs, recovery preview, accessibility/reflow, validation matrix |
| `REQUIREMENTS.md` / `ROADMAP.md` | UX-01, UX-02, OPS-01, OPS-02, OPS-03, PRIV-01 and five phase success criteria |
| Existing web code | Current palette, 1200px shell, 44/48px controls, risk disclosure, state notices, scorecard receipts, replay preview/confirm |

Defaults selected under the agent's discretion: breakpoints, exact tokens, focus style, manual-first operator refresh, 25-item operator pagination, and the precise user-facing copy above. Legal retention duration and consenting-subject mechanism are intentionally not invented: the UI fails closed until an approved versioned policy is supplied.

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
