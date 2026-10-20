---
phase: 1
slug: trustworthy-fixture-discovery
status: draft
shadcn_initialized: false
preset: none
created: 2026-08-27
---

# Phase 1 — UI Design Contract

> Visual and interaction contract for trustworthy fixture discovery, fixture detail, eligibility denial, and protected ambiguity review. Prediction, odds, value, historical-form, and provider-fallback UI is out of scope.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | Tailwind CSS 4.1; project-owned components (default — no existing design system detected) |
| Preset | not applicable |
| Component library | none; use semantic HTML before introducing abstractions |
| Icon library | Lucide React, 16/20px, `strokeWidth={1.75}`, always paired with text for status and destructive actions |
| Font | Geist Sans with system-ui fallback; Geist Mono for IDs, timestamps, and provider references |

### Visual Direction

- Calm analytical workbench, not a sportsbook: no odds tickers, celebratory graphics, neon gradients, urgency treatments, or red/green win-loss framing.
- Content canvas is light and neutral. Trust metadata is adjacent to the fixture or field it qualifies, never hidden only in a footer or tooltip.
- Use 1px borders and restrained shadows. Cards use `border`, `rounded-lg` (8px), and no more than `shadow-sm`.
- Desktop content max-width is 1200px with 24px gutters; mobile gutters are 16px. Minimum supported viewport is 320px.

### Responsive Layout

| Breakpoint | Contract |
|------------|----------|
| `<640px` | One column; filter controls stack; fixture cards replace tables; primary tap targets span available width where useful. |
| `640–1023px` | Two-column filter row; fixture content remains cards; detail metadata uses a two-column definition list. |
| `≥1024px` | Dashboard uses compact fixture rows grouped by date; detail uses 8/4 content-to-provenance grid; review uses queue rail (320px) plus case workspace. |

All information and actions remain available at every breakpoint. Horizontal page scrolling is prohibited; only explicitly labelled data regions may scroll.

---

## Spacing Scale

Declared values (multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, badge inset |
| sm | 8px | Compact controls, metadata rows |
| md | 16px | Default card/control spacing, mobile gutters |
| lg | 24px | Section/card padding, desktop gutters |
| xl | 32px | Major layout gaps |
| 2xl | 48px | Page section separation |
| 3xl | 64px | Desktop page rhythm only |

No spacing values outside this scale are permitted. Interactive components have a minimum target size of 48×48px; this is a component sizing rule, not a spacing token.

---

## Typography

Exactly four sizes and two weights are permitted:

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Label / metadata | 14px | 400 or 600 | 1.4 |
| Body / controls | 16px | 400 or 600 | 1.5 |
| Section heading | 20px | 600 | 1.3 |
| Page display | 28px | 600 | 1.2 |

- Never communicate state through weight alone. Uppercase is limited to short state badges with `letter-spacing: 0.02em`.
- Dates use localized readable text; exact timestamps and provider identifiers may use the mono font with tabular numerals.
- Team and competition names wrap to two lines on cards; never truncate the only visible identity. Secondary provider IDs may ellipsize with the full value available through copyable text, not tooltip alone.

---

## Color

Light theme is the Phase 1 contract. Every text/background pair must meet WCAG 2.2 AA (4.5:1 normal text, 3:1 large text and UI boundaries).

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#F8FAFC` slate-50 | Page background and large neutral surfaces |
| Secondary (30%) | `#FFFFFF` | Cards, top navigation, filters, detail and review panels |
| Accent (10%) | `#1D4ED8` blue-700 | Primary CTA background, selected date/filter, active navigation indicator, links, keyboard focus ring |
| Destructive | `#B91C1C` red-700 | Reject/create-new confirmation and destructive/error semantics only |

Supporting semantic colors:

| State | Foreground | Background | Icon/label contract |
|-------|------------|------------|---------------------|
| AVAILABLE | `#166534` | `#DCFCE7` | Check-circle + “Available” |
| LIMITED | `#92400E` | `#FEF3C7` | Triangle-alert + “Limited” |
| STALE | `#9A3412` | `#FFEDD5` | Clock-alert + “Stale” |
| UNSUPPORTED | `#475569` | `#E2E8F0` | Circle-slash + “Unsupported” |
| UNRESOLVED | `#7E22CE` | `#F3E8FF` | Git-compare-arrows + “Unresolved” |
| Focus | `#1D4ED8` | 2px ring + 2px offset | Visible on every interactive element |

Accent is reserved for primary CTA, selected filters/date, active navigation, links, and focus rings. Semantic state colors never replace the written state label or icon. Red is never used merely to make a fixture feel urgent.

---

## Information Architecture and Components

### Public Shell

- Header: product name, “Fixtures” as the sole Phase 1 public navigation item, and a non-interactive system-health summary link only if a public health view is implemented.
- Main content begins with a unique H1. Breadcrumbs appear on fixture detail only: `Fixtures / {Home} vs {Away}`.
- Footer contains persistent neutral copy: “Football data and analytical information only. No outcome is guaranteed. If betting is legal where you are, be aware of the risk of financial loss.” This disclosure remains visible without opening a modal and must not overlap content.
- Do not show prediction, odds, value, “coming soon,” or disabled betting controls.

### Fixture Dashboard

- H1: “Upcoming fixtures”. Supporting line: “Premier League fixtures for your local time zone ({zone}).”
- The dashboard’s primary visual anchor is the “Upcoming fixtures” page heading. The eye-first sequence is: page heading, active filter/date context, then fixture results; layout, contrast, and spacing must preserve this order at every breakpoint.
- Filter region has an accessible name “Fixture filters” and contains:
  - date range control defaulting from start of today through +48 hours in the browser’s IANA zone;
  - competition select showing Premier League only in Phase 1, without implying unsupported competitions work;
  - primary CTA “Apply filters” and secondary text action “Reset filters”.
- URL query parameters are the shareable source of filter state. Applying filters updates the URL and results; browser Back restores prior filters and focus.
- Results are grouped under local calendar-date headings. Each fixture row/card shows kickoff time, home and away canonical names, fixture status, data-state badge, provider, and “Updated {relative time}”.
- The entire fixture card is not a nested interactive target. Use a clear link labelled `View {Home} vs {Away}`; the visible match name may be the link text.
- Sort groups ascending by date and fixtures ascending by kickoff. Preserve stable order during background refresh.
- A data-state summary above results announces counts in an `aria-live="polite"` region only after an explicit refresh/filter operation, not on initial render.

### Fixture Detail

- Header block shows canonical home and away names with no fabricated crests, local kickoff plus explicit time zone, competition and season, and provider-independent fixture status.
- Data-quality badge is adjacent to the heading. A visible explanation panel includes the exact state, reason, source, captured time, source-updated time, and freshness threshold applied.
- Core metadata uses a semantic definition list: Competition, Season, Kickoff, Status, Source, Captured, Source updated, Canonical fixture ID.
- Unknown fields display “Not available” or “Not reported”; never `0`, em dash without explanation, empty cell, or synthetic value.
- `LIMITED` and `STALE` fixtures remain readable. `UNSUPPORTED` explains the missing capability. `UNRESOLVED` explains that identity is under review and explicitly states “Forecasting is blocked until the fixture identity is resolved.” No forecast action is rendered.
- A “Back to fixtures” link returns to the preserved dashboard URL and scroll position where browser behavior permits.

### Data-State Component Contract

`DataStateNotice` accepts only `AVAILABLE | LIMITED | STALE | UNSUPPORTED | UNRESOLVED`, plus `reason`, `provider`, `capturedAt`, `sourceUpdatedAt`, and `freshnessThreshold`. It renders:

- compact badge for every state;
- expanded inline notice for every non-AVAILABLE state;
- full timestamps in the user’s zone plus machine-readable `<time datetime>` values;
- no dismiss control, because the state materially qualifies the data;
- no color-only encoding and no generic “Something went wrong” substitution.

### Eligibility Gate

- Fixture dashboard and detail remain accessible without age or region eligibility because Phase 1 exposes neutral fixture data only.
- Any forecast/value-capable shell or protected analytics route must receive a server-authoritative decision before rendering protected content. Client locale/IP hints may prefill but never grant access.
- Gate form fields: explicit region selector and unchecked checkbox “I confirm that I am 18 or older.” Primary CTA: “Check eligibility”.
- On denial, render the stable reason without exposing configuration: unknown region → “Betting-related analytics are unavailable until your region can be verified.”; disallowed region → “Betting-related analytics are not available in your selected region.”; age not acknowledged → “Confirm that you are 18 or older to continue.”
- Unknown, missing, request failure, or stale eligibility state denies access. Protected content must not appear briefly during hydration, loading, or error.
- Denial has no persuasive retry copy. Region can be corrected; age acknowledgement can be changed. Do not store betting behavior or create an account.
- Persistent disclosure on allowed protected shells: “Probabilities are estimates, not guarantees. You can lose money when betting.” This shell contract is established now, even though Phase 1 adds no forecast/value surface.

### Protected Ambiguity Review Queue

- Route is excluded from public navigation, server-protected by operator credential, and returns a generic unavailable/unauthorized page rather than rendering then hiding content. If the credential is not configured, the route is disabled.
- Queue row shows provider, entity type, incoming name/reference, received time, candidate count, and review status. Default sort is oldest unresolved first.
- Case workspace shows raw provider reference as inert escaped text, normalized evidence, candidate comparison, confidence/method, and prior append-only decisions. Raw JSON is collapsed by default, horizontally scrollable inside its own region, and copyable; it must never render HTML from provider data.
- Candidate choices are radio controls inside a labelled group. Selecting a candidate does not mutate data.
- Actions:
  - “Approve selected match” — primary; requires a selected candidate and an evidence note of at least 10 non-whitespace characters.
  - “Link manually” — opens a searchable canonical-entity selector and requires an evidence note.
  - “Reject all and create canonical” — destructive; requires a review summary and a confirmation dialog quoting the incoming entity name. Copy: “Create a new canonical entity? This may affect future reconciliation. The original evidence and this decision will remain in the audit history.” Confirmation button: “Create canonical entity”.
  - “Correct decision” — available from history; creates a new superseding decision and never edits or deletes the prior record. Confirmation summarizes old and new targets.
- While submitting, disable all case actions, keep selected values visible, label the active button “Saving decision…”, and prevent duplicate requests. On success, announce “Decision recorded” via polite live region, append history, remove the resolved case from the unresolved queue, and focus the next case or queue heading.
- On conflict because another operator resolved the case, do not overwrite. Show “This case changed while you were reviewing it. Reload the latest decision before continuing.” with “Reload case”.
- Operator credential must never be echoed in UI, URL, client storage, error copy, or telemetry.

---

## Interaction States

| Surface | Loading | Empty | Error | Partial / degraded |
|---------|---------|-------|-------|--------------------|
| Dashboard | Six fixed-height fixture skeletons with hidden decorative animation under reduced motion; filter controls remain usable | Copy contract below; retain active filters and local zone | Inline alert with correlation ID if safe and “Try again”; preserve filters | Render valid groups and per-item state notices; never remove stale rows during refetch |
| Fixture detail | Header and metadata definition-list skeleton; no guessed team names | Not applicable for an addressed fixture; 404 uses “Fixture not found” | Page alert, “Return to fixtures”, and “Try again” for transient failure | Render known fields and explicit non-available values/state notice |
| Eligibility | Server-render neutral checking state only when necessary; protected content absent | Missing input is denied and form remains visible | Deny by default with retry; no protected data in response/body | Not applicable; decision is allow or deny with reason |
| Review queue | Queue-row skeletons; no action workspace until case loaded | “No ambiguity cases need review.” | Preserve current case form locally, show retry; never imply a decision saved | Cases missing evidence are view-only and labelled LIMITED; decision actions disabled with reason |
| Review submit | Selected data remains visible; button shows progress | Not applicable | Inline error beside action area; fields and note preserved | Conflict state requires reload before any new decision |

- Skeletons use neutral blocks and `aria-hidden`; a single nearby status element says “Loading fixtures” or “Loading review cases”.
- Any operation over 10 seconds adds “This is taking longer than expected” and a safe retry/cancel affordance where cancellation is possible.
- Background refresh does not steal focus or announce every timestamp change.
- Honor `prefers-reduced-motion`; transitions are opacity/color only, ≤150ms, and nonessential animation is removed.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Dashboard primary CTA | Apply filters |
| Dashboard empty heading | No fixtures in this window |
| Dashboard empty body | No Premier League fixtures were found for these dates. Choose a different date range and apply the filters again. |
| Dashboard error | Fixtures could not be loaded. Your filters have been kept. Try again. |
| Fixture not found | Fixture not found. It may have been removed or the link may be incorrect. Return to fixtures. |
| LIMITED | Some fixture information is unavailable. Review the source and update times before relying on it. |
| STALE | This fixture has not been updated within the expected freshness window. The last known information remains visible. |
| UNSUPPORTED | This provider does not support the requested data for this competition and season. Missing values are not treated as zero. |
| UNRESOLVED | The fixture identity is under review. Forecasting is blocked until the canonical teams and fixture are resolved. |
| Review empty heading | No ambiguity cases need review |
| Review error | Review cases could not be loaded. No decision was changed. Try again. |
| Review primary CTA | Approve selected match |
| Destructive confirmation | Create canonical entity: Create a new canonical entity? This may affect future reconciliation. The original evidence and this decision will remain in the audit history. |
| Eligibility CTA | Check eligibility |
| Persistent risk disclosure | Probabilities are estimates, not guarantees. You can lose money when betting. |

Copy rules:

- Use “estimate”, “may”, “data unavailable”, and “under review”. Never use “sure”, “safe bet”, “guaranteed”, “risk-free”, “lock”, “must bet”, “act now”, or guaranteed win/profit language.
- Error copy states what failed, confirms whether state changed, and provides one next action.
- State reasons may include provider and timestamps but never raw exceptions, secrets, credentials, DSNs, or internal stack traces.

---

## Accessibility and Keyboard Contract

- One H1 per page; heading levels do not skip. Landmarks: header, nav where present, main, footer; review queue and workspace use labelled regions.
- All controls are reachable and operable by keyboard. Logical focus order follows visual order. No positive `tabindex`.
- Native select, checkbox, radio, button, dialog, table, definition list, and link semantics are preferred. Custom dialogs trap focus, close with Escape unless a save is in progress, and restore focus to the trigger.
- Validation summary receives focus on failed submit and links to each invalid field; each error is also associated with its field using `aria-describedby`.
- Status changes use `role=status`/polite live regions; load failures and blocked decisions use `role=alert`. Do not announce decorative skeletons.
- Fixture rows rendered as tables at desktop require column headers; mobile card ordering must remain equivalent. Do not use table markup solely for layout.
- Interactive components have a minimum target size of 48×48px. Focus is never hidden behind a sticky header. At 200% zoom, content reflows without lost actions.
- Local time is visible and programmatic; ambiguous abbreviations are paired with UTC offset or full zone on detail.

---

## UI Considerations

Applicable state considerations resolved: 25 covered, 5 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | fixture results | ✅ covered | Empty results render the documented heading/body, preserve filters, and offer a date-range next step. |
| loading | fixture results and filters | ✅ covered | Six stable skeleton rows plus one programmatic loading status; filters remain operable. |
| error | fixture results | ✅ covered | Inline retry preserves URL-backed filters and reveals no raw provider error. |
| populated | fixture results | ✅ covered | Fixtures group by local date and sort by kickoff with canonical identity and adjacent trust metadata. |
| partial | fixture results | ✅ covered | Valid fixtures remain visible and each incomplete record carries its explicit state and reason. |
| overflow | fixture results | 🧪 backstop | Visual test at 320px and 200% zoom proves long club names wrap without horizontal page scroll. |
| zero-one-many | fixture results | ✅ covered | Zero uses empty state, one uses a single group/card, many retain date headings and stable order. |
| long-text | fixture cards and metadata | 🧪 backstop | Held-out long team/competition/provider strings wrap or safely ellipsize secondary IDs with copy access. |
| loading | fixture detail | ✅ covered | Header and definition-list skeleton reserve layout while avoiding guessed identity. |
| error | fixture detail | ✅ covered | Transient failures offer retry and return; missing fixture has distinct 404 copy. |
| partial | fixture detail | ✅ covered | Known fields render; unknown fields say “Not available” or “Not reported”, never zero. |
| long-text | data-state explanations | 🧪 backstop | Reason strings reflow at 320px and remain readable at 200% zoom. |
| loading | eligibility gate | ✅ covered | Protected content is absent until the server returns an allow decision. |
| error | eligibility gate | ✅ covered | Failure denies by default and provides a retry without leaking protected data. |
| partial | eligibility form | ✅ covered | Missing region or age acknowledgement remains denied with field-specific guidance. |
| long-text | eligibility denial | ✅ covered | Denial explanation wraps; no fixed-height container or ellipsis. |
| empty | review queue | ✅ covered | Queue renders the documented “No ambiguity cases need review” state. |
| loading | review queue | ✅ covered | Queue skeletons show while case actions remain absent. |
| error | review queue | ✅ covered | Retry retains unsaved local inputs and explicitly says no decision changed. |
| populated | review queue | ✅ covered | Oldest unresolved cases lead; rows expose provider, reference, age, candidates, and status. |
| partial | review case | ✅ covered | Missing evidence makes the case view-only and explains why actions are unavailable. |
| overflow | review evidence/history | 🧪 backstop | Large raw payload and long audit history scroll within labelled regions without moving action controls off-page. |
| zero-one-many | review candidates/history | ✅ covered | No candidate enables reject/create or manual link; one or many use an explicit radio choice; history renders chronologically. |
| long-text | raw provider content | 🧪 backstop | Provider text is escaped, wraps where readable, and raw JSON scrolls in its own code region. |
| loading | review submit | ✅ covered | Active action shows progress, preserves context, disables duplicate submissions, and does not imply success. |
| error | review submit | ✅ covered | Failure preserves fields; conflict blocks overwrite and requires reload. |
| populated | audit history | ✅ covered | Every decision shows action, actor/source, timestamp, evidence, target, and supersession relationship. |
| overflow | public navigation | ✅ covered | Phase 1 exposes only Fixtures; narrow layouts keep brand and navigation without clipping. |
| long-text | buttons and filters | ✅ covered | Labels wrap rather than clip; primary action remains at least 48px high. |
| error | state badge/notice | ✅ covered | Unknown enum values fail closed into a generic unavailable notice and telemetry event, never an AVAILABLE presentation. |

---

## Testable Acceptance Contract

- Dashboard E2E at desktop and 320px verifies default today-through-48-hours range, local-date grouping, URL-backed filters, stable order, and list/detail navigation.
- Data-state fixture matrix verifies all five states by visible label, icon, reason, provider, source/capture times, and non-color semantics. Null fields assert “Not available” and never `0`.
- `UNRESOLVED` fixture test asserts the blocking explanation and absence of all forecast/odds/value controls or links.
- Accessibility test covers keyboard-only filter, fixture navigation, eligibility form, review candidate selection, confirmation dialog, conflict reload, and focus restoration; automated axe scan has no serious/critical violations.
- Eligibility API/E2E matrix asserts unknown region, missing acknowledgement, disallowed region, request error, and stale decision all deny protected content server-side with no hydration flash.
- Review E2E verifies approve, reject/create, manual link, and superseding correction; failed/conflicting writes never show success and never overwrite history.
- Content scan fails on prohibited certainty, guaranteed-win/profit, urgency, or risk-free terms and asserts persistent disclosure on any protected analytics shell.
- Snapshot/visual checks cover 320, 768, and 1440px, 200% zoom, forced-colors mode, reduced motion, long names, large raw payload, zero/one/many fixtures, and zero/one/many candidates.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — shadcn not initialized |
| third-party | none | no third-party code permitted in Phase 1 UI contract |

---

## Source Decisions Applied

| Source | Applied contract |
|--------|------------------|
| `01-CONTEXT.md` | Premier League scope, local-date/+48h browsing, read-only detail, deny-by-default eligibility, 18+ acknowledgement, five explicit data states, visible provenance/freshness, protected review semantics, no prediction placeholders |
| `REQUIREMENTS.md` | FOUND-04–06 and DATA-01–08 visual/interaction acceptance |
| `01-RESEARCH.md` | Next.js/Tailwind shape, explicit state projection, server-authoritative gate, append-only review, null-not-zero, safe raw provider rendering |
| Codebase scout | Greenfield UI; no existing components, tokens, Tailwind config, or `components.json` to preserve |
| Autonomous defaults | Exact spacing, type, palette, responsive layout, copy, and accessibility behavior |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
