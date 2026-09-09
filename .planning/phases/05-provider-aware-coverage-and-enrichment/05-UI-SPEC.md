---
phase: 5
slug: provider-aware-coverage-and-enrichment
status: draft
shadcn_initialized: false
preset: none
created: 2026-09-09
---

# Phase 5 — UI Design Contract

> Visual and interaction contract for provider-aware fixture coverage, honest degradation, immutable forecast-revision comparison, and suggestion-only reconciliation enrichment.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | Project-owned React components using the established Tailwind-ready token contract |
| Preset | not applicable |
| Component library | none; extend semantic HTML and existing project components |
| Icon library | Lucide React only if already installed or added consistently: 16/20px, `strokeWidth={1.75}`, always paired with text for state and actions |
| Font | Existing `system-ui, sans-serif`; mono only for snapshot IDs, receipt IDs, hashes, provider references, and UTC instants |

No `components.json`, shadcn preset, Tailwind configuration, or third-party UI registry exists. Auto mode preserves the established project-owned component vocabulary instead of initializing another design system.

### Visual Direction

- Continue the calm analytical workbench: light neutral canvas, white bordered panels, restrained state color, 1px borders, 8px radii, and at most `shadow-sm`.
- Provider identity and fallback are trust metadata, not branding. Do not use provider brand colors, logos, or card prominence to imply data quality.
- Place provider, route reason, capture time, freshness, and limitation beside the fixture or evidence they qualify. Progressive disclosure may reveal exact receipts, but must not hide the current limitation or provider.
- Every status is written and paired with an icon/shape; color alone never communicates primary/fallback, limited, unavailable, stale, unsupported, pending, or ambiguous.
- Never use sportsbook styling, flashing odds, celebratory deltas, urgency, “winning” framing, or red/green alone for probability movement.

### Information Architecture

Phase 5 extends existing routes rather than adding a provider dashboard:

1. `/fixtures` adds the configured top-five leagues, Champions League, Europa League, and Conference League to the existing competition filter. Each result retains canonical identity and carries a compact provider/data-state summary.
2. `/fixtures/{fixtureId}` keeps canonical fixture identity first, then current provider/coverage status, analysis, and the new forecast-revision comparison.
3. `/internal/reconciliation` extends each case with a visually separated `Suggestion-only enrichment` panel for TheSportsDB names, aliases, and validated logo candidates.

Release-wide provider operations, quota dashboards, dead-letter controls, and methodology pages remain Phase 6 scope. Public UI exposes only sanitized route evidence needed to understand the displayed data.

### Fixture Detail Eye-First Order

1. Canonical teams, competition, kickoff, fixture status, and data-quality state.
2. Persistent risk disclosure before any forecast content.
3. Provider coverage notice: selected provider, primary/fallback role, route reason, captured/source-updated times, and whether displayed data is current or last valid.
4. Forecast revision comparison, leading with selected pair and material changes.
5. Existing manual-odds/value workbench, still bound to one exact selected forecast snapshot.
6. Exact route, source, snapshot, and receipt IDs under labelled disclosures.

### Responsive Layout

| Breakpoint | Contract |
|------------|----------|
| `<640px` | One column. Competition filters stack. Provider notice remains above analysis. Snapshot selectors stack in left-then-right order. Delta rows render semantic cards; no squeezed comparison table. Primary actions use available width. |
| `640–1023px` | Two-column snapshot selector/header; summary changes use two columns; market deltas may remain cards. |
| `≥1024px` | Comparison header is a 1/1 pair; material-change summaries use a 3-column grid; stable market deltas use a semantic table. Provenance disclosures span full width. |

Desktop content max-width is 1200px with 24px gutters; mobile gutters are 16px; minimum viewport is 320px. Only labelled table/code regions may scroll horizontally. The page itself must not.

---

## Spacing Scale

Declared values, inherited from earlier phases:

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, badge inset, signed-delta marker gap |
| sm | 8px | Compact metadata and definition-list spacing |
| md | 16px | Default control/card spacing and mobile gutters |
| lg | 24px | Section/card padding and desktop gutters |
| xl | 32px | Major layout gaps |
| 2xl | 48px | Page section separation |
| 3xl | 64px | Desktop page rhythm only |

Exceptions: interactive controls are at least 48×48px; this is component sizing, not a spacing token. Dense non-interactive data rows may be 44px high.

---

## Typography

Exactly four sizes and two weights are permitted:

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Label / metadata | 14px | 400 or 600 | 1.4 |
| Body / controls | 16px | 400 or 600 | 1.5 |
| Section heading | 20px | 600 | 1.3 |
| Page display | 28px | 600 | 1.2 |

- Probabilities, expected goals, confidence components, and deltas use tabular numerals. Deltas never exceed 20px/600.
- Signed probability deltas always include `+` or `−` and percentage-point unit, for example `+2.4 pp`; never rely on arrow or color alone.
- Snapshot IDs, receipt IDs, hashes, provider references, and exact UTC instants use 14px mono and remain copyable.
- Canonical team, competition, provider, limitation, and route-reason text wraps. Never truncate the only visible identity or reason.

---

## Color

All text/background pairs meet WCAG 2.2 AA: 4.5:1 for normal text and 3:1 for large text/UI boundaries.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#F8FAFC` | Page background and large neutral surfaces |
| Secondary (30%) | `#FFFFFF` | Cards, controls, comparison panels, notices, tables |
| Accent (10%) | `#1D4ED8` | Primary CTA, selected snapshot border, links, active filter, keyboard focus ring |
| Destructive | `#B91C1C` | Reject/create and correction confirmations, true error semantics only |

Accent reserved for: `Apply filters`, active competition, selected left/right snapshot controls, `Compare revisions`, links, copy controls, and focus rings. Accent never encodes a provider, favorable probability movement, value quality, or confidence.

Supporting semantic states:

| State | Foreground | Background | Contract |
|-------|------------|------------|----------|
| AVAILABLE / CURRENT | `#166534` | `#DCFCE7` | Check shape plus written status |
| LIMITED / FALLBACK | `#92400E` | `#FEF3C7` | Triangle/info shape; provider and route reason adjacent |
| STALE / LAST VALID | `#9A3412` | `#FFEDD5` | Clock shape; source and capture timestamps visible |
| UNSUPPORTED | `#334155` | `#E2E8F0` | Slash/info shape; endpoint and season scope stated |
| PENDING | `#1E3A8A` | `#DBEAFE` | Clock/loader shape plus static text under reduced motion |
| UNAVAILABLE / ERROR | `#991B1B` | `#FEE2E2` | Alert shape; state-change and retry guidance |
| SUGGESTION ONLY | `#5B21B6` | `#EDE9FE` | Spark/info shape; never reused for production evidence |

Probability movement uses neutral slate text by default. If direction color is added, it must remain supplemental to the signed value and `increased`/`decreased` accessible label; do not infer that an increase is good.

---

## Component Inventory and Interaction Contract

### Provider Coverage Notice

- Extend `DataStateNotice`/`EvidenceStateNotice`; do not create an unrelated banner vocabulary.
- Required projection: `state`, safe reason, selected provider, route role (`Primary`, `Fallback`, or `Sole source`), route trigger when fallback was used, captured time, source-updated time, and freshness label.
- Compact form appears on fixture cards: `{state} · {provider role}`. Expanded form on detail adds the provider name and safe route explanation.
- A fallback success says `Fallback source used`; it does not render as an error. Exact copy: `football-data.org was not used because {safe reason}. API-Football supplied this capture without changing the canonical fixture.`
- UEL/UECL no-fallback failure is persistent and non-dismissible. If last valid data exists, keep it below the notice with `Last valid capture — not current` and exact timestamps. Otherwise render no synthetic fixture/evidence values.
- Unknown, stale, malformed, or absent capability never becomes `available`; missing enrichment is `Not available — {reason}`, never `0`.
- Sanitized disclosures may show route policy version, route receipt ID, and source receipt ID. Never expose quota credentials, authorization headers, raw provider errors, origins containing secrets, or unexpected headers.

### Competition Filter and Fixture Collection

- Competition choices use canonical user-facing names and group as `Domestic leagues` and `UEFA competitions`; do not expose provider codes as labels.
- Applying a filter writes stable URL query state. Browser Back restores competition/date/filter state and focus behavior from Phase 1.
- A competition with known terminal limited coverage remains selectable and returns an honest state; do not disable it in a way that hides the reason.
- Fixture ordering remains canonical date then kickoff. Background provider recovery or fallback must not reorder equal fixtures or create duplicate cards.
- One canonical fixture appears once even when multiple provider receipts exist. The card may say `2 source captures` under disclosure.

### Immutable Forecast Revision Comparison

- Section H2: `Forecast revision comparison`. Intro: `Compare two exact immutable snapshots for this fixture. Newer snapshots never replace your selections automatically.`
- Render two labelled selectors: `Earlier snapshot` and `Later snapshot`. Options show kind, revision, cutoff, and a shortened ID with full copy access.
- Default recommended pair is the earliest and latest available issued kinds at initial load only. Once the user changes either side, keep both exact IDs stable in URL search parameters `leftSnapshotId` and `rightSnapshotId`; background refresh must not replace them.
- Disable `Compare revisions` until two distinct snapshots for the same canonical fixture are selected. Server validation remains authoritative.
- The server result must echo both full IDs and cutoffs. If an ID is missing, revoked from selection, belongs to another fixture, or is not issued, show an inline blocking error and preserve both selected strings; never substitute a nearby/latest snapshot.
- When only one snapshot exists, render the absent-kind reasons panel and disable comparison. Do not duplicate the single snapshot on both sides.
- Present `What changed` first: cutoff interval; evidence sources added/removed; expected-goal deltas; bounded adjustment deltas; confidence-component deltas; limitations added/resolved; then market/selection probability deltas in stable market order.
- Every delta row shows earlier value, later value, signed delta, and qualifier. Missing earlier/later values say `Not available — {reason}` and produce no numeric delta.
- Source additions/removals use explicit `Added` and `Removed` labels. A provider change is provenance, not automatically an improvement.
- A `No material changes` result still shows exact pair/cutoffs and says `These snapshots differ in identity or cutoff, but no displayed model component changed.`
- `Show exact comparison receipt` is collapsed by default and contains full snapshot IDs, evidence build IDs, source receipt IDs, route receipt IDs, model/config versions, limitations, and inert escaped JSON.

### Snapshot Availability Panel

- Always list the three kinds in order: `INITIAL`, `PRE_MATCH`, `LINEUP_CONFIRMED`.
- Available entries show cutoff, issued time, revision, provider-source count, and select action.
- Absent entries show one server-provided reason: `No confirmed lineup`, `Capability denied`, `Coverage record stale`, `Budget protected`, `Provider unavailable`, or `Insufficient evidence`.
- `LINEUP_CONFIRMED` must say `Official confirmed lineup receipt required`. Predicted or incomplete lineups never receive this label.
- Do not render absent kinds as skeleton forecasts, zero probabilities, disabled empty cards without explanation, or inferred copies of another kind.

### Suggestion-Only Reconciliation Panel

- Within the protected reconciliation workspace, place TheSportsDB content in a bordered purple-tinted panel titled `Suggestion-only enrichment`.
- Persistent notice: `Names, aliases, and logos in this panel are review aids only. They are not production match evidence and cannot approve or change canonical identity.`
- Each suggestion shows provider label, received time, proposed name/alias, validated image status, and `Use as review input`; this action only copies the value into an editable review field and never submits a decision.
- Logo candidates render only through the application’s validated image boundary. Loading, rejected host/type/size, broken image, and missing image use the neutral crest placeholder plus written status. Never fetch arbitrary candidate URLs directly in the browser.
- Existing approve, manual link, reject/create, and correction flows retain evidence-note, confirmation, optimistic concurrency, and append-only history contracts. The final decision area restates the canonical target and does not visually merge suggestion provenance with production evidence.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Fixture filter primary CTA | Apply filters |
| Comparison primary CTA | Compare revisions |
| Comparison empty heading | No comparable forecast pair yet |
| Comparison empty body | This fixture does not have two issued forecast snapshots. Review each absent snapshot reason below. |
| Comparison loading | Comparing the selected immutable snapshots… |
| Comparison error | These forecast revisions could not be compared. Your selected snapshot IDs were kept. Review the reason and try again. |
| No material changes | No displayed model components changed between these exact snapshots. |
| Fallback state heading | Fallback source used |
| No-fallback heading | Limited data — no production fallback |
| No-fallback body | API-Football is the sole configured source for this competition and is unavailable. Last valid data remains labelled with its capture time; missing values are not treated as zero. |
| Last-valid label | Last valid capture — not current |
| Missing enrichment | {Enrichment} is not available: {safe reason}. Missing evidence is not treated as zero. |
| No confirmed lineup | No LINEUP_CONFIRMED snapshot: no official confirmed lineup receipt was available before the cutoff. |
| Suggestion-only notice | Names, aliases, and logos in this panel are review aids only. They are not production match evidence and cannot approve or change canonical identity. |
| Destructive confirmation | Create canonical entity: Create a new canonical entity? This may affect future reconciliation. Suggestions remain review evidence only, and the original evidence and decision remain in audit history. |

Copy rules:

- Use `estimate`, `comparison`, `source`, `capture`, `limitation`, `may`, and `not available`. Never use certainty, guaranteed-profit/win, urgency, “best bet”, “lock”, “risk-free”, or provider-superiority claims.
- State whether data is current, stale, last valid, absent, or pending. Never use generic `available` without scope and time.
- Errors say what failed, confirm whether selection/data changed, and provide one next action. Never surface raw exceptions, secrets, credentials, provider payloads, or stack traces.
- Forecast/value surfaces retain the persistent disclosure: `Probabilities are estimates, not guarantees. You can lose money when betting.`
- Manual odds remain the primary value workflow. Provider odds are labelled `Provider-supplied provenance` and never presented as an invitation or automatically selected bookmaker offer.

---

## Interaction and Data States

| Surface | Loading | Empty | Error | Partial / degraded |
|---------|---------|-------|-------|--------------------|
| Fixture collection | Stable neutral skeleton cards and one status; filter controls remain usable | Preserve filters and use existing no-fixtures copy | Preserve URL filters, show retry, reveal no raw provider error | Render valid canonical fixtures once; each limited/stale item carries provider, reason, and time |
| Provider notice | Keep canonical fixture header; announce `Checking provider coverage` | Not applicable; absent provider projection is unavailable/error | Fail closed to sanitized unavailable notice | Fallback, last-valid, stale, unsupported, pending, and no-fallback remain distinct |
| Snapshot availability | Three reserved rows labelled by kind | Three explicit absent reasons; never blank cards | Keep any verified entries; retry exact fixture | Available and absent kinds coexist, with absence reason per kind |
| Pair selectors | Selectors remain visible and disabled only during compare request | Fewer than two snapshots shows documented empty state | Preserve both exact IDs and focus blocking alert | A newly discovered snapshot may appear as an option but never replaces either selection |
| Comparison result | Preserve previous result but label it `Previous comparison` while loading only if pair IDs differ visibly | No material changes is a populated result, not an empty state | No substitute pair or client-side delta; retry exact IDs | Null components show reasons and no numeric delta; valid siblings remain visible |
| Receipt details | Summary skeleton only | Not applicable for a successful comparison | `Exact receipt details could not be loaded` with retry | Missing required provenance blocks the affected comparison section |
| Suggestion panel | Candidate placeholders are non-interactive; one loading status | `No suggestion-only enrichment is available for this case.` | `Suggestions could not be loaded. The reconciliation case and decisions were not changed.` | Invalid/broken logos use placeholder; valid text suggestions remain review-only |
| Reconciliation submit | Preserve selected target and note; disable duplicate actions | Not applicable | Preserve fields; conflict requires reload | Missing suggestion data never blocks manual review based on production evidence |

- Any operation over 10 seconds adds `This is taking longer than expected` with a safe retry where applicable.
- Background refresh never steals focus or announces timestamp-only changes. Announce meaningful provider-state transitions politely; a transition to unavailable alerts once.
- Honor `prefers-reduced-motion`; transitions are opacity/color only and at most 150ms. Static status text remains when animation is removed.

---

## Accessibility and Keyboard Contract

- One H1 per page; heading levels do not skip. Use semantic landmarks, labelled sections, fieldsets, definition lists, real tables, and native details/summary.
- Snapshot selectors have persistent visible labels and accessible descriptions containing kind, cutoff, revision, and selection side. The comparison result heading receives focus only after explicit submit, not background refresh.
- Keyboard users can select a competition, choose either snapshot, swap pair with a text-labelled `Swap snapshots` button, compare, open disclosures, and copy IDs. No drag-only or hover-only interaction.
- Focus indicators use a visible 2px blue ring with 2px offset. No positive `tabindex`. Interactive targets are at least 48×48px.
- Tables have captions and scoped headers. Mobile cards retain the exact reading order of desktop columns. Raw receipts scroll within labelled regions.
- Deltas expose `increased by`, `decreased by`, or `unchanged` to assistive technology and show a signed visible value; arrows/icons are decorative.
- Status is never color-only. `role=status`/polite live regions handle loading and successful changes; blocking unavailable/error uses `role=alert` once.
- Dialog focus is trapped, Escape closes unless submit is active, and focus returns to the trigger. Reconciliation conflicts focus `Reload case`.
- At 320px and 200% zoom, all copy and controls reflow without lost actions. Forced-colors preserves borders, focus, selection, and written state labels.
- Timestamps use `<time datetime>` and show timezone/UTC offset. IDs and long reasons wrap or use copyable full-value access.

---

## UI Considerations

Applicable state considerations resolved: 31 covered, 7 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | fixture collection | ✅ covered | Preserve competition/date filters and show the existing no-fixtures state without implying provider failure. |
| loading | fixture collection | ✅ covered | Stable skeletons plus one status; filters remain usable and canonical identities are never guessed. |
| error | fixture collection | ✅ covered | Preserve URL state, offer retry, and expose no raw provider response. |
| populated | fixture collection | ✅ covered | Canonical fixtures appear once in date/kickoff order with compact provider and freshness metadata. |
| partial | fixture collection | ✅ covered | Valid fixtures remain visible while limited/stale siblings carry explicit reasons and timestamps. |
| overflow | fixture cards/filter | 🧪 backstop | Visual tests at 320px and 200% zoom prove long competition/team/provider text reflows without page scrolling. |
| zero-one-many | fixtures/source captures | ✅ covered | Zero uses empty copy, one renders one canonical card, many remain stable; multiple receipts never duplicate the fixture. |
| long-text | fixture/provider reason | 🧪 backstop | Long safe reasons wrap completely; the only visible identity or limitation is never ellipsized. |
| loading | provider coverage notice | ✅ covered | Keep canonical header visible and announce coverage checking without showing optimistic availability. |
| error | provider coverage notice | ✅ covered | Unknown or malformed projection fails closed to unavailable and reveals no secret/header detail. |
| partial | provider coverage notice | ✅ covered | Primary, fallback, sole-source, last-valid, stale, unsupported, pending, and unavailable stay distinct. |
| long-text | route reason/receipt IDs | 🧪 backstop | Reason wraps; full IDs are copyable from progressive disclosure. |
| empty | snapshot availability | ✅ covered | Each of the three kinds renders an explicit absent reason rather than a blank forecast. |
| loading | snapshot availability | ✅ covered | Three labelled reserved rows prevent layout shift and never fabricate probability content. |
| error | snapshot availability | ✅ covered | Verified snapshots remain selectable; failed refresh retains them with a labelled stale/error state. |
| populated | snapshot availability | ✅ covered | INITIAL, PRE_MATCH, LINEUP_CONFIRMED appear in fixed order with kind, revision, cutoff, and source count. |
| partial | snapshot availability | ✅ covered | Available and absent kinds coexist; official lineup provenance gates LINEUP_CONFIRMED. |
| zero-one-many | snapshots | ✅ covered | Zero/one disables comparison with reasons; two or many enable stable exact-pair selection. |
| long-text | snapshot options | 🧪 backstop | Long labels wrap in adjacent selected-summary text; full ID stays copyable even if native option display truncates. |
| empty | comparison pair | ✅ covered | Fewer than two snapshots renders documented empty copy and absent-kind panel. |
| loading | comparison request | ✅ covered | Exact selectors remain visible, duplicate submit is disabled, and progress names the selected pair. |
| error | comparison request | ✅ covered | Preserve exact IDs, never substitute latest, and offer retry after a safe reason. |
| populated | comparison result | ✅ covered | Lead with material evidence/model/limitation changes, then stable market probability deltas and receipt. |
| partial | comparison values | ✅ covered | Missing side/value has a specific reason and no numeric delta; valid sibling rows remain visible. |
| overflow | delta table/receipt | 🧪 backstop | Only labelled table/code regions scroll; controls and pair identity remain on page. |
| zero-one-many | change rows | ✅ covered | Zero material changes is explicit; one reads as a focused row; many group in stable semantic order. |
| long-text | evidence/limitation lists | 🧪 backstop | Sources and limitations wrap, preserve added/removed labels, and do not obscure pair identity. |
| empty | suggestion-only list | ✅ covered | Empty panel says no enrichment is available and leaves production review unaffected. |
| loading | suggestion-only list | ✅ covered | Non-interactive placeholders and one status prevent accidental early selection. |
| error | suggestion-only list | ✅ covered | Failure explicitly says reconciliation data and decisions were unchanged. |
| populated | suggestion-only list | ✅ covered | Each item exposes provider, time, safe candidate data, validation state, and review-only action. |
| partial | suggestion images | ✅ covered | Missing/rejected/broken images use a neutral placeholder while safe text suggestions remain available. |
| overflow | suggestion names/aliases | 🧪 backstop | Long multilingual names and aliases wrap and remain inert escaped text. |
| zero-one-many | suggestions | ✅ covered | Zero uses empty copy; one/many retain explicit selection and never auto-apply. |
| loading | reconciliation action | ✅ covered | Selected canonical target and evidence note remain visible; duplicate writes are disabled. |
| error | reconciliation action | ✅ covered | Save failure preserves fields; optimistic conflict requires reload and never overwrites. |
| long-text | action/notice copy | ✅ covered | Labels and safety notice wrap while retaining 48px target sizing. |
| error | untrusted logo candidate | ✅ covered | Rejected URL/type/size and load failure produce placeholder plus written status; arbitrary browser fetch is prohibited. |

---

## Testable Acceptance Contract

- Fixture E2E covers all configured competitions, primary football-data.org, eligible API-Football fallback, API-Football sole-source UEL/UECL, and no-fallback degradation. Canonical fixture/team IDs remain identical across source changes and duplicate cards never appear.
- Provider-state matrix covers current primary, fallback, last-valid stale, unavailable, limited, unsupported, pending, stale capability, budget protected, and circuit denied; each has written reason/provider/time and never substitutes zero.
- Pair-comparison E2E selects exact left/right IDs, writes them to URL state, refreshes available snapshots, and verifies neither side changes. Server rejects cross-fixture/non-issued/missing IDs without client substitution.
- Snapshot matrix covers zero, one, two, and three kinds; every absent kind has a concrete reason, and LINEUP_CONFIRMED appears only with an official same-fixture confirmed-lineup receipt.
- Delta tests cover increased, decreased, unchanged, absent-side value, no material changes, sources added/removed, limitations added/resolved, and stable market/selection ordering.
- Reconciliation E2E verifies TheSportsDB content remains in the suggestion-only panel, cannot auto-submit/approve, never enters forecast evidence, and survives missing/rejected/broken logo candidates safely.
- Content scan rejects guaranteed-win/profit, certainty, urgency, “safe bet”, and provider-superiority language and asserts the persistent risk disclosure on forecast/value content.
- Accessibility tests cover keyboard competition filtering, both selectors, swap, compare, disclosures, copy controls, suggestion selection, reconciliation confirmations/conflict, and focus restoration; axe has no serious/critical violations.
- Visual checks cover 320, 768, and 1440px; 200% zoom; forced colors; reduced motion; long team/provider/reason/snapshot strings; zero/one/many fixtures, snapshots, deltas, and suggestions.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — shadcn not initialized |
| third-party | none | no third-party registry code permitted in Phase 5 contract |

External provider logos and names are untrusted data, not component-registry dependencies. Logo URLs require application allowlist/proxy validation for HTTPS host, content type, and size before rendering.

---

## Source Decisions Applied

| Source | Decisions Used |
|--------|----------------|
| `05-CONTEXT.md` | D-01–D-14: versioned provider roles, fallback triggers, canonical identity, five degradation states, quota-safe enrichment, stable immutable pairs, absent-kind reasons, and suggestion-only TheSportsDB boundary |
| `REQUIREMENTS.md` | PROV-01–PROV-07 plus inherited responsible-use and explicit data-state requirements |
| `05-RESEARCH.md` | Server-authoritative exact-pair projection, coverage-as-seasonal-evidence, no generic availability boolean, sanitized route receipts, and validated logo boundary |
| Existing web UI | `DataStateNotice`, `EvidenceStateNotice`, `ForecastWorkbench`, `AnalyticsShell`, reconciliation semantics, semantic HTML, stable snapshot selection, progressive receipt disclosure |
| Auto-mode defaults | Exact responsive composition, delta notation, copy, palette, state matrix, and no-shadcn continuation |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
