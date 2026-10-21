---
phase: 2
slug: historical-evidence-pipeline
status: draft
shadcn_initialized: false
preset: none
created: 2026-08-29
---

# Phase 2 — UI Design Contract

> Visual and interaction contract for cutoff-aware team evidence and protected pipeline replay. This phase presents reproducible historical inputs, never forecasts, odds, betting recommendations, or confidence scores.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | Project-owned React components using the established Phase 1 inline-style/Tailwind-ready token contract |
| Preset | not applicable |
| Component library | none; prefer semantic HTML and extend Phase 1 components |
| Icon library | Lucide React only if added consistently: 16/20px, `strokeWidth={1.75}`, always paired with text for state/actions |
| Font | Existing `system-ui, sans-serif`; retain Geist Sans/Mono as the eventual Phase 1 target, with mono reserved for IDs, hashes, UTC instants, and correlation IDs |

No `components.json`, shadcn preset, Tailwind config, or third-party UI registry exists. Auto mode preserves the shipped project-owned system instead of introducing a second component vocabulary.

### Visual Direction

- Continue the calm analytical workbench: light neutral canvas, white bordered panels, restrained state color, no sportsbook styling, celebratory graphics, urgency, win/loss framing, or odds-like visual hierarchy.
- Evidence is a receipt. Put cutoff, sample, freshness, provenance, and limitations directly beside the value they qualify; never hide all qualification in a tooltip, drawer, or footer.
- Use 1px borders, 8px radii, and at most `shadow-sm`. Values are visually prominent but never more prominent than the team identity and selected cutoff.
- Reuse and generalize `DataStateNotice` for `AVAILABLE`, `LIMITED`, `STALE`, `UNSUPPORTED`, `UNRESOLVED`, and `PENDING`; every state has text and an icon/shape in addition to color.
- Desktop canvas remains 1200px with 24px gutters; mobile gutters are 16px. Minimum viewport is 320px. No page-level horizontal scrolling.

### Information Architecture

Public route: `/teams/{teamId}/evidence?asOf={ISO-8601}`. Fixture detail links each canonical team to this route and passes fixture kickoff as `asOf`; label: `View {Team} evidence at kickoff`.

Protected operator route: `/internal/pipeline/replay`. It is absent from public navigation and server-denied when operator authorization is missing.

Evidence page eye-first order is fixed:

1. Team name and “Historical evidence”.
2. Resolved cutoff, display timezone, freshness, overall limitation state.
3. Five- and ten-match form summaries.
4. Component evidence (Elo, venue strength, goal rates, rest, H2H).
5. Chronological match trace.
6. Reproduction receipt and provenance details.

The shell header adds no public top-level item in this phase. Team evidence is contextual from fixture/team links, avoiding navigation that suggests a complete team directory.

### Responsive Layout

| Breakpoint | Contract |
|------------|----------|
| `<640px` | One column. Cutoff controls stack. Form summary cards stack. Match trace renders semantic cards, not a squeezed table. Definition lists become label/value blocks. Actions span available width where useful. |
| `640–1023px` | Two summary cards side by side; evidence components use a two-column grid; match trace may remain cards. |
| `≥1024px` | Header uses an 8/4 team-to-cutoff layout; form cards sit side by side; component grid uses three columns; match trace uses a semantic table; receipt is a collapsible full-width panel. Replay uses a 4/8 plan-to-impact layout. |

All information and actions remain available at every breakpoint. A labelled table/code region may scroll horizontally; the page may not.

---

## Spacing Scale

Declared values (inherited from Phase 1; multiples of 4 only):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, badge inset, dense trace metadata |
| sm | 8px | Compact element spacing, definition-list rows |
| md | 16px | Default card/control spacing, mobile gutters |
| lg | 24px | Section/card padding, desktop gutters |
| xl | 32px | Major layout gaps |
| 2xl | 48px | Page section separation |
| 3xl | 64px | Desktop page rhythm only |

Exceptions: minimum interactive target is 48×48px; this is component sizing, not a spacing token. Numeric table rows may be 44px high only when the row contains no interactive control.

---

## Typography

Exactly four sizes and two weights are permitted:

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Label / metadata | 14px | 400 or 600 | 1.4 |
| Body / controls | 16px | 400 or 600 | 1.5 |
| Section heading | 20px | 600 | 1.3 |
| Page display | 28px | 600 | 1.2 |

- Feature values use 20px/600 with tabular numerals; no oversized scorecard typography that implies a prediction.
- Exact UTC instants, config hashes, fixture IDs, source IDs, and correlation IDs use mono at 14px and wrap/copy safely.
- Team, competition, limitation, and provider names wrap. Do not truncate the only visible identity. Secondary hashes may middle-ellipsize only when a copyable full value is adjacent.
- Dates use localized readable text plus explicit timezone; machine-readable `<time datetime>` retains the resolved UTC instant.

---

## Color

Light theme remains the Phase 2 contract. All text/background pairs meet WCAG 2.2 AA: 4.5:1 for normal text and 3:1 for large text/UI boundaries.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#F8FAFC` | Page background and large neutral surfaces |
| Secondary (30%) | `#FFFFFF` | Cards, controls, trace rows, receipt and replay panels |
| Accent (10%) | `#1D4ED8` | Primary CTA, active view, links, selected cutoff preset, keyboard focus ring |
| Destructive | `#B91C1C` | Forced-new-revision warning/confirmation and destructive/error semantics only |

Accent reserved for: `View evidence`, `Apply cutoff`, `Preview replay`, `Queue replay`, active navigation/filter state, links, and focus rings. Accent does not color evidence values or imply favorable performance.

Supporting semantic states inherit Phase 1: green `AVAILABLE`, amber `LIMITED`, orange `STALE`, slate `UNSUPPORTED`, purple `UNRESOLVED`. Add:

| State | Foreground | Background | Contract |
|-------|------------|------------|----------|
| PENDING / REBUILDING | `#1E3A8A` | `#DBEAFE` | Clock/loader shape + written state; no infinite animation under reduced motion |
| DEGRADED / CIRCUIT OPEN | `#92400E` | `#FEF3C7` | Triangle-alert + provider/endpoint reason and last transition |
| DEAD LETTER | `#991B1B` | `#FEE2E2` | Circle-alert + written state; never use alarming animation |

Red is never used for a poor football result, weak form, negative goal difference, or betting urgency. Positive/negative match outcomes use neutral `W/D/L` text badges with distinct shapes/borders, not red/green alone.

---

## Public Team Evidence Surface

### Cutoff Header and Control

- H1: `{Team} historical evidence`. Supporting copy: `What the system could know at the selected time.`
- Show `As of {localized date/time} ({zone}, UTC{offset})` and exact resolved UTC instant in the same header panel.
- GET form contains one labelled datetime control, explicit display timezone text, and primary CTA `Apply cutoff`. Submission writes an ISO-8601 `asOf` query parameter so the view is linkable and browser Back restores it.
- Fixture-origin context is visible: `Evidence requested for {fixture name} kickoff` with `Back to fixture`. It does not alter the server-resolved cutoff.
- Invalid, ambiguous, future-forbidden, or unsupported cutoff never falls back to latest. Keep the entered value, show field error, and render no substitute evidence: `This cutoff could not be used. Enter a valid supported date and time.`
- On success, echo both the requested instant and server-resolved UTC instant when they differ through normalization. Do not infer browser timezone silently; always write the active zone.

### Five- and Ten-Match Summary

- Two sibling cards titled `Last 5 weighted form` and `Last 10 weighted form`; five-match card appears first at all breakpoints.
- Each card shows: available sample `n/5` or `n/10`, weighted points/result components supplied by the API, earliest/latest eligible match, newest source capture, config version, and limitation label.
- Label the calculation `Weighted form`, never `form score prediction`, `confidence`, `hot`, or `cold`.
- If sample is weak, render the computed component if valid and a persistent `Limited sample: {n} eligible matches` notice. Do not pad to five/ten and do not rescale the count as if complete.
- Unavailable is `Not available` plus a reason. It is never `0`, `0%`, an empty progress ring, or a disabled-looking card.
- Do not use gauges, traffic lights, or progress bars: no universal good/bad threshold exists in Phase 2.

### Evidence Components

Render separate cards for `Elo rating`, `Home strength`, `Away strength`, `Goal rates`, `Rest days`, and `Head-to-head`. Never combine them into a Phase 3 aggregate.

Every component card contains:

- value or `Not available`;
- sample count and requested window;
- effective-time range and newest included observation time;
- limitation reason adjacent to value;
- `Show inputs` disclosure revealing ordered fixture IDs, timestamps, component parameters, and source references needed to reproduce it.

Elo additionally exposes starting value, K-factor, and home adjustment. Weighted form exposes its versioned weighting curve. H2H says `Low-weight historical context` and shows its configured cap; it must not be framed as causal or predictive. Rest days names the prior fixture used and displays `Not available — no eligible prior match` when appropriate.

### Chronological Match Trace

- Title: `Eligible match trace`; supporting text: `Only completed matches effective and captured on or before the resolved cutoff are included.`
- Default order is newest eligible match first for inspection, while a visible note states calculations fold oldest-to-newest using kickoff, capture time, then canonical fixture ID. Provide `Newest first` / `Oldest first` control without changing feature output.
- Desktop columns: kickoff, opponent, venue, result, score, observed/captured, source, included components. Mobile cards preserve that order.
- Each row has a disclosure `View match evidence` with canonical fixture ID, exact effective/observed times, payload hash/reference, and any correction/supersession relationship.
- Late observations excluded by cutoff are not mixed into the eligible list. An optional separate collapsed `Excluded after cutoff` audit section may show count and reasons, but never values that could be mistaken as inputs.
- Zero rows use the evidence empty state, not a blank table. One row uses singular copy. Many rows paginate or use `Load more` in stable chunks of 25; do not virtualize in MVP because semantic reading and find-in-page matter.

### Reproduction Receipt

- Collapsed by default after the trace; summary: `Reproduction receipt — config {version}, {n} inputs`.
- Contains team ID, requested and resolved cutoff, configuration version/hash, build ID/state, ordered input count and bounds, observation/source references, publication time, and all limitation codes.
- Copy buttons use `Copy receipt ID` and `Copy config hash`, announce `Copied`, and retain visible text fallback. Raw JSON is escaped inert text in a labelled scroll region; never render source HTML.
- A published receipt is read-only. A building/partial receipt is not shown as current evidence; show the explicit pending state and last published receipt only if labelled with its older cutoff/build time.

---

## Protected Replay Workspace

- Route is server-protected, not linked publicly, and returns a generic unavailable/unauthorized response before client rendering. Credentials, raw auth headers, and provider secrets never appear in UI, URL, storage, logs, or copy.
- H1: `Historical pipeline replay`. Intro: `Preview bounded work before adding it to the queue. Replaying the same logical input does not duplicate durable facts.`
- Form fields: purpose (`Failed job` or `Historical window`), provider from server allowlist, competition/season, endpoint family, UTC start/end, lane (read-only policy-derived), optional original job/correlation ID, and evidence rebuild checkbox.
- Date range is required, UTC-labelled, bounded by server policy, and validated inline. Arbitrary URLs, queue names, provider origins, job IDs, priority numbers, and config values are never accepted from the browser.
- Primary CTA is `Preview replay`. Preview is mandatory and read-only: show logical units, estimated provider calls/reservations, cache candidates, affected evidence builds, lane/headroom result, and warnings. Preview never queues work.
- After a valid preview, CTA `Queue replay` opens a confirmation dialog summarizing provider, endpoint, UTC range, unit count, lane, and idempotent identity. Confirmation: `Queue this replay using the existing logical identities? Existing observations remain immutable and duplicate facts will not be created.` The secondary action is `Return to replay preview`.
- `Start a new revision` is off by default, visually separated, and requires a reason. Enabling it shows destructive styling and a second confirmation: `Start a new audited revision? This creates new logical run identities but does not replace observations or future prediction snapshots.` Confirmation button: `Queue new revision`; secondary action: `Keep current replay`.
- During submit, preserve preview, disable mutable fields and duplicate actions, label button `Queueing replay…`. Success announces `Replay queued` and shows plan ID, unit count, lane, correlation ID, and link `View replay status`.
- Conflict/stale preview response blocks submission and focuses: `Pipeline state changed after this preview. Preview the replay again before queueing.`
- Provider state panel shows closed/open/half-open, endpoint family, last transition, next probe when known, quota allowance/reserved/remaining, reset zone/date, and lane headroom. Unknown values say `Not available`; circuit-open calls are explicitly `Blocked before reservation`.
- Status list shows queued/running/retrying/completed/failed/dead-letter with attempt count, next retry, classified reason, correlation ID, and duplicate/no-op outcome. It must distinguish a successful idempotent no-op from skipped/failed work.

---

## Interaction and Data States

| Surface | Loading | Empty | Error | Partial / degraded |
|---------|---------|-------|-------|--------------------|
| Evidence page | Stable header plus two summary and component skeletons; one `Loading historical evidence` status; never show cached values under a new unlabeled cutoff | Documented insufficient-history state with resolved cutoff and next action | Page alert preserves cutoff; retry reloads exact URL; no latest-state fallback | Publish only terminal build; component nulls show reasons; an explicitly labelled older published build may remain visible during rebuild |
| Cutoff submit | Control and entered value stay visible; button says `Applying cutoff…` | Missing input is field error | Focus validation summary and retain input | Normalized UTC value is echoed; unsupported cutoff blocks all substitute evidence |
| Match trace | Fixed-height neutral rows/cards, decorative blocks hidden from assistive tech | Documented empty state | Component-level retry only if summary remains valid; otherwise page error | Eligible rows render with row-level limitation; excluded-later data stays separate |
| Receipt | Summary skeleton only | Not applicable when evidence is published | `Receipt details could not be loaded` with retry; displayed evidence remains labelled | Missing provenance makes affected component unavailable, not partially authoritative |
| Replay preview | Form stays visible; preview panel says `Calculating replay impact…` | No preview before submit; guidance remains | Preserve form; say no work was queued; focus alert | Warnings and rejected units are counted separately; queue CTA disabled until all blocking issues resolve |
| Replay submit/status | Preview frozen; action says `Queueing replay…` | Status list: `No replay runs match these filters` | No false success; classified safe reason, correlation ID, retry/preview action | Mixed unit outcomes show exact counts and per-unit state; never collapse into one green success banner |

- Any operation over 10 seconds adds `This is taking longer than expected` with a safe retry or context-specific stop action when interruption is supported.
- Background refresh does not steal focus or announce timestamp-only changes. Announce meaningful state transitions politely; dead-letter/failure uses alert once.
- Honor `prefers-reduced-motion`; transitions are opacity/color only and at most 150ms. Spinners have static text equivalents and become static under reduced motion.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Evidence primary CTA | Apply cutoff |
| Evidence empty heading | No eligible match history at this cutoff |
| Evidence empty body | No completed matches were both played and captured by the selected time. Choose a later supported cutoff or return to the fixture. |
| Evidence error | Historical evidence could not be loaded for this cutoff. No newer data was substituted. Try again. |
| Limited sample | Limited sample: {n} eligible matches. The calculation remains visible with its actual sample size. |
| Unsupported component | {Component} is not available for this cutoff: {safe reason}. Missing evidence is not treated as zero. |
| Pending build | Evidence is being rebuilt for this cutoff. Partial calculations are not published. |
| Trace empty | No matches qualify under the effective-time and capture-time cutoff. |
| Replay preview CTA | Preview replay |
| Replay queue CTA | Queue replay |
| Replay empty | No replay runs match these filters. |
| Replay error | Replay impact could not be calculated. No work was queued. Check the range and try again. |
| Idempotent confirmation | Queue replay: Queue this replay using the existing logical identities? Existing observations remain immutable and duplicate facts will not be created. |
| Idempotent confirmation secondary action | Return to replay preview |
| Destructive confirmation | Start new revision: Start a new audited revision? This creates new logical run identities but does not replace observations or future prediction snapshots. |
| Destructive confirmation secondary action | Keep current replay |

Copy rules:

- Say `historical evidence`, `as of`, `eligible matches`, `sample`, `source`, `limitation`, and `replay`; never `prediction`, `pick`, `tip`, `chance`, `confidence`, `recommended bet`, `winning`, `hot team`, or `safe` on Phase 2 surfaces.
- Never claim that replay “fixes everything”; say what will be queued and what immutable data cannot change.
- Errors state what failed, whether any state changed, and one next action. User-facing messages never include raw exceptions, secrets, credentials, DSNs, provider payloads, or stack traces.
- Phase 2 neutral evidence does not require the betting-analytics eligibility gate or risk disclosure. If any future forecast/value content is accidentally introduced, it must remain server-gated and use the persistent Phase 1 disclosure.

---

## Accessibility and Keyboard Contract

- One H1 per page; headings do not skip. Use semantic `main`, labelled sections, forms, fieldsets, definition lists, tables, details/summary, status, and alert regions.
- Every cutoff/replay field has a persistent visible label, UTC/timezone help, and associated error via `aria-describedby`. Validation summary receives focus and links to invalid fields.
- All controls are keyboard operable with visible 2px blue focus ring and 2px offset; no positive `tabindex`. Minimum interactive target is 48×48px.
- Desktop trace tables use real headers and captions. Mobile card order matches desktop column order. Never use table markup for layout.
- Dialog focus is trapped, Escape closes unless queue submission is active, the contextual secondary action (`Return to replay preview` or `Keep current replay`) is always visible, and focus returns to the trigger.
- State is never color-only. W/D/L, circuit, limitations, retrying, and dead-letter states use written labels plus icon/shape.
- Exact timestamps include `<time datetime>`. Visible local time includes full timezone or UTC offset; UTC is explicit at input boundaries.
- At 200% zoom and 320px, content reflows with no lost controls. Raw receipt/provider regions may scroll internally and receive an accessible name.
- Copy-to-clipboard has a visible fallback and live announcement. Details disclosures expose their expanded/collapsed state natively.
- Forced-colors preserves boundaries, focus, and status labels. Reduced motion removes nonessential animation.

---

## UI Considerations

Applicable state considerations resolved: 28 covered, 6 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | team match history | ✅ covered | Render the documented no-eligible-history heading/body with resolved cutoff and later-cutoff/return action. |
| loading | evidence view | ✅ covered | Reserve summary/component layout, announce one loading status, and never expose unlabeled values from another cutoff. |
| error | evidence view | ✅ covered | Preserve requested cutoff, state that no newer data was substituted, and retry the same URL. |
| populated | evidence summary | ✅ covered | Lead with 5/10 cards, then component receipts and ordered match trace with adjacent qualifications. |
| partial | evidence components | ✅ covered | Valid values retain actual samples; unsupported values are null with specific limitation reasons. |
| overflow | evidence cards/trace | 🧪 backstop | Visual tests at 320px and 200% zoom prove team/source strings wrap and only labelled data regions scroll. |
| zero-one-many | eligible matches | ✅ covered | Zero has empty copy, one uses singular sample/row copy, many use stable 25-item chunks without virtualization. |
| long-text | team/competition/limitation copy | 🧪 backstop | Long identity and limitation text reflows without hiding the only visible identity or reason. |
| empty | weighted form windows | ✅ covered | A zero sample is `Not available` with reason, not numeric zero; short windows show `n/5` and `n/10`. |
| loading | cutoff form | ✅ covered | Entered value stays visible and control progress is explicit. |
| error | cutoff form | ✅ covered | Invalid/unsupported cutoff receives focusable validation and never falls back to current evidence. |
| partial | normalized cutoff | ✅ covered | Requested and resolved UTC instants are both shown when normalization changes representation. |
| long-text | cutoff/timezone | ✅ covered | Full timezone/offset wraps; exact instant remains copyable and machine-readable. |
| empty | evidence component | ✅ covered | Unsupported component says `Not available` plus reason, sample, and window where known. |
| loading | evidence build | ✅ covered | Building data is not published; explicit pending state may retain only a clearly older published receipt. |
| error | evidence component/receipt | ✅ covered | Missing provenance makes the qualified component unavailable rather than silently partial. |
| partial | weak samples | ✅ covered | Computed values remain visible only when valid and always carry actual sample and limitation wording. |
| populated | match trace | ✅ covered | Rows expose match identity, venue, result, score, observed time, source, and included components. |
| overflow | receipt/raw evidence | 🧪 backstop | Large JSON/hashes scroll in labelled inert code regions; action controls stay on page. |
| long-text | IDs/hashes/source references | 🧪 backstop | Secondary identifiers may middle-ellipsize only with adjacent copy access to the full value. |
| zero-one-many | provenance sources | ✅ covered | Zero blocks the affected component, one shows singular source, many list/count sources deterministically. |
| empty | replay preview | ✅ covered | Before preview, render guidance rather than an empty result card; zero-unit preview explains why queueing is disabled. |
| loading | replay preview/submit | ✅ covered | Preview and queue phases are distinct; fields/impact stay visible and duplicate action is disabled. |
| error | replay preview/submit | ✅ covered | Errors explicitly say no work queued; stale preview blocks submit and requests a new preview. |
| populated | replay impact/status | ✅ covered | Show unit/call/build counts, lane/headroom, immutable effects, and per-unit outcomes. |
| partial | mixed replay outcomes | ✅ covered | Completed, no-op, rejected, retrying, failed, and dead-letter counts remain distinct. |
| overflow | replay status list | 🧪 backstop | Long correlation/job IDs wrap or copy; desktop table scroll is local and mobile cards retain every field. |
| zero-one-many | replay runs/units | ✅ covered | Zero uses filtered empty copy, one uses singular count, many paginate with stable ordering. |
| long-text | replay reasons | 🧪 backstop | Classified safe reasons wrap fully; raw exceptions are never displayed. |
| loading | confirmation control | ✅ covered | Confirmation freezes preview, shows queueing label, and prevents duplicate requests. |
| error | provider state | ✅ covered | Unknown circuit/quota metadata fails closed into explicit unavailable/blocked text. |
| populated | provider state | ✅ covered | Circuit, endpoint, transition, next probe, allowance, reserved, remaining, reset, and headroom are written labels. |
| partial | provider quota | ✅ covered | Missing reset/allowance never becomes zero or an open-to-call state. |
| long-text | navigation/action labels | ✅ covered | Labels wrap without clipping and preserve 48px minimum targets. |

---

## Testable Acceptance Contract

- E2E follows a fixture team link and asserts fixture kickoff is sent as `asOf`, resolved UTC is echoed, browser Back returns to the fixture, and an invalid cutoff never displays latest evidence.
- Evidence fixture matrix covers full 10, partial 1–9, zero, stale, unsupported component, pending rebuild, missing provenance, and post-cutoff correction; every null renders reason and never `0`.
- Chronology test verifies only dual-time-eligible matches appear, display sort can change without changing feature values, and reproduction receipt exposes config/build/input identities.
- Content test asserts absence of forecast probabilities, odds, value, recommendation, confidence-score, guaranteed-win/profit, urgency, and risk-free language.
- Replay E2E verifies mandatory preview, bounded validation, idempotent confirmation, explicit forced-revision confirmation/reason, stale-preview block, no duplicate submit, and success identifiers.
- Provider-state matrix covers closed/open/half-open, headroom rejection, allowance unknown, retrying, dead-letter, successful no-op, and mixed run outcomes without color-only semantics.
- Accessibility test covers keyboard cutoff form, disclosures, trace sort, copy controls, replay form, both confirmations, validation focus, and focus restoration; automated axe scan has no serious/critical violations.
- Visual checks cover 320, 768, and 1440px; 200% zoom; forced colors; reduced motion; long club/provider/reason/hash strings; zero/one/many trace rows and replay units.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — shadcn not initialized |
| third-party | none | no third-party registry code permitted in Phase 2 contract |

---

## Source Decisions Applied

| Source | Decisions used |
|--------|----------------|
| `02-CONTEXT.md` | D-17 through D-20 fully define cutoff, summaries/trace, limitations/nulls, and reproducible-input boundary; D-07 through D-16 define lanes, circuits, replay, immutable provenance, and terminal publication behavior |
| `REQUIREMENTS.md` | PIPE-01 through PIPE-08 user/operator states and responsible-use boundary |
| `02-RESEARCH.md` | Dual-time receipt, published evidence-build state, dry-run replay, provider health/quota visibility, deterministic parameters and null-not-zero defaults |
| Phase 1 UI/code | Light palette, 1200px canvas, semantic notices, system font, 48px targets, explicit source/freshness, safe raw evidence, no horizontal page scroll |
| Auto-mode defaults | Exact responsive composition, component inventory, copy, state matrix, trace pagination, and replay confirmation behavior |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
