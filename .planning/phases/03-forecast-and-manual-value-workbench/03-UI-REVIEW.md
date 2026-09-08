# Phase 3 — UI Review

**Audited:** 2026-09-08
**Baseline:** Phase 3 CONTEXT.md decisions plus abstract 6-pillar standards (no UI-SPEC.md exists)
**Screenshots:** Not captured (no dev server on ports 3000, 5173, or 8080). Existing production-backed Chromium evidence reports 3/3 passing scenarios, including 360 px viewport and 200% text-size overflow checks.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Outcome and responsible-use copy is precise, but technical identity/version language dominates the primary workflow. |
| 2. Visuals | 2/4 | Semantic hierarchy exists, but the workbench is largely unstyled browser controls and dense tables with no strong focal treatment for the three-state result. |
| 3. Color | 2/4 | The palette is restrained, but there is no tokenized semantic color system or distinct visual treatment for candidate, no-value, error, and limited states. |
| 4. Typography | 2/4 | Heading semantics are sound, but the UI relies entirely on browser/system defaults and exposes long IDs and JSON without a deliberate readable type scale. |
| 5. Spacing | 2/4 | The top-level 24 px grid and overflow guards are useful, but internal sections and form controls lack a consistent spacing/size contract. |
| 6. Experience Design | 3/4 | Core empty/error/draft/disabled/result states and exact selection are covered, but pending and error feedback remain weakly differentiated. |

**Overall: 14/24**

---

## Top 3 Priority Fixes

1. **Create a clear outcome focal card** — users currently have to visually parse a mostly uniform document to find the decision — give `VALUE_CANDIDATE`, `NO_VALUE`, and `INSUFFICIENT_EVIDENCE` distinct semantic borders/backgrounds/icons, while retaining non-prescriptive wording.
2. **Introduce shared design tokens and component styles** — 33 inline-style occurrences and scattered hard-coded colors make hierarchy and consistency fragile — define tokens for surface, text, border, semantic state, spacing, type, focus, and control sizes, then apply reusable card/form/table/button styles.
3. **Reduce technical overload in the primary path** — raw UUIDs, ISO timestamps, config identifiers, and canonical JSON compete with the user's task — show friendly kind/date/source labels first and move full identities and JSON into the existing receipt disclosure with copy controls.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

- **WARNING:** The three outcomes explain why a result was produced and correctly avoid certainty, urgency, stake sizing, and automatic-wager language (`forecast-workbench.tsx:10-14`, `:54`).
- **WARNING:** Confidence is explicitly distinguished from event probability, and limitations are humanized instead of presenting raw enum values (`forecast-workbench.tsx:33`, `:50-51`). This satisfies the central D-07/D-15 trust requirement.
- **WARNING:** Primary labels repeatedly use implementation language such as “immutable snapshot”, “exact snapshot pair”, revision identifiers, and raw cutoffs (`forecast-workbench.tsx:31`, `:47-48`, `:52-55`). Keep these facts accessible, but lead with plain-language labels such as “Forecast issued 11 Sep, 17:43 UTC” and “Odds saved from Live source”.
- **WARNING:** Source-label validation is only summarized in the shared status message (“Enter the bookmaker or source label”) rather than attached to the field (`forecast-workbench.tsx:42`, `:52`). Add field-level error text and `aria-describedby` as used for odds selections.

### Pillar 2: Visuals (2/4)

- **WARNING:** The document has correct semantic sections and headings, but the workbench itself supplies almost no visual styling beyond a one-column grid and scroll wrappers (`forecast-workbench.tsx:46-59`). Forecast, odds entry, comparison, and result therefore have similar visual weight.
- **WARNING:** The most important output is rendered as another plain section after several dense tables (`forecast-workbench.tsx:49`, `:53-54`). A prominent state card should become the focal point immediately after comparison.
- **WARNING:** Controls are text-labelled and do not rely on ambiguous icon-only buttons, which is a positive accessibility result (`forecast-workbench.tsx:52-58`).
- **WARNING:** Screenshot inspection was unavailable because no dev server was running. The passing 360 px/200% Chromium overflow assertion proves containment, not visual hierarchy, contrast, or polish (`forecast-workbench.spec.ts:200-218`).

### Pillar 3: Color (2/4)

- **WARNING:** The application uses a restrained neutral base (`layout.tsx:13-23`) and avoids decorative accent overuse.
- **WARNING:** Colors are hard-coded inline (`#F8FAFC`, `#0F172A`, `#FFFFFF`, `#CBD5E1`, `#1D4ED8`, `#475569`, `#94A3B8`) rather than expressed as shared semantic tokens (`layout.tsx:13-23`, `risk-disclosure.tsx:8`, `data-state-notice.tsx:4`, `fixtures/page.tsx:13`).
- **WARNING:** Candidate, no-value, insufficient-evidence, general status, and errors have no declared semantic color distinction in the workbench (`forecast-workbench.tsx:52-54`). Add accessible state tokens and never rely on color alone.
- **WARNING:** No evidence supports a deliberate 60/30/10 distribution; the implementation is effectively neutral browser UI with one link accent.

### Pillar 4: Typography (2/4)

- **WARNING:** Heading levels, labels, definition lists, tables, and details/summary establish a sound semantic reading order (`forecast-workbench.tsx:47-58`).
- **WARNING:** The only explicit typography decision is `system-ui, sans-serif` on the body (`layout.tsx:13`). There is no declared size/weight/line-height scale, so visual hierarchy depends on browser defaults.
- **WARNING:** Full UUIDs, version strings, ISO timestamps, and large JSON blocks create high cognitive density (`forecast-workbench.tsx:31`, `:48`, `:53-58`). Use compact human-readable summaries, monospace only for identifiers, sensible line-height, and constrained disclosure panels.

### Pillar 5: Spacing (2/4)

- **WARNING:** The workbench establishes a consistent 24 px vertical grid and `minmax(0, 1fr)` containment (`forecast-workbench.tsx:46`); tables and JSON use overflow-safe wrappers (`:49`, `:53`, `:56-58`).
- **WARNING:** Internal controls rely on natural inline flow, `<br>`, paragraph margins, and browser defaults rather than a shared field/card spacing scale (`forecast-workbench.tsx:48`, `:52-53`). This will vary across browsers and makes the dense form harder to scan.
- **WARNING:** The broader frontend contains 33 inline `style={{...}}` occurrences and mixes values such as 12, 16, 20, and 24 px without a named scale. Consolidate them into shared layout primitives or CSS tokens.
- **WARNING:** Production E2E proves no horizontal document overflow at 360 px with 200% text sizing (`forecast-workbench.spec.ts:203-218`), so this is a quality warning rather than a task-completion blocker.

### Pillar 6: Experience Design (3/4)

- **WARNING:** The implementation handles no-forecast, field validation, draft restoration, submit failure, comparison failure, insufficient evidence, no value, value candidate, copy failure, and disabled action states (`forecast-workbench.tsx:38-45`, `:52-59`).
- **WARNING:** Exact forecast selection is stable, exact odds selection is explicit, drafts cannot trigger analysis, and receipt DOM/clipboard/download parity is covered by production E2E (`forecast-workbench.spec.ts:121-198`).
- **WARNING:** A single `pending` boolean disables both save and compare actions, but button labels do not change and no busy indicator or `aria-busy` state is exposed (`forecast-workbench.tsx:36`, `:42-43`, `:52-53`). Provide action-specific pending labels and scoped busy state.
- **WARNING:** Success and failure share the same `message` container with `role="status"` (`forecast-workbench.tsx:42`, `:52`), so failed submissions/comparisons may not be announced with appropriate urgency. Separate non-blocking success status from errors using `role="alert"`.
- **WARNING:** The odds selector only contains snapshots created during the current client session (`forecast-workbench.tsx:36-37`, `:42`, `:53`). If durable prior snapshots are intended to remain selectable after navigation, add fixture-scoped odds discovery; otherwise clarify this session-only constraint in copy.

---

## Files Audited

- `.planning/phases/03-forecast-and-manual-value-workbench/03-CONTEXT.md`
- `.planning/phases/03-forecast-and-manual-value-workbench/03-01-PLAN.md` through `03-12-PLAN.md`
- `.planning/phases/03-forecast-and-manual-value-workbench/03-01-SUMMARY.md` through `03-12-SUMMARY.md`
- `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx`
- `apps/web/app/fixtures/[fixtureId]/page.tsx`
- `apps/web/app/fixtures/page.tsx`
- `apps/web/app/layout.tsx`
- `apps/web/components/analytics-shell.tsx`
- `apps/web/components/data-state-notice.tsx`
- `apps/web/components/evidence-state-notice.tsx`
- `apps/web/components/risk-disclosure.tsx`
- `tests/e2e/forecast-workbench.spec.ts`

Registry audit skipped: shadcn is not initialized (`components.json` is absent).
