---
phase: 10
slug: performance-audit-and-budgets
status: approved
shadcn_initialized: false
preset: none
created: "2026-11-18"
reviewed_at: "2026-11-18"
---

# Phase 10 — UI Design Contract

> Visual and interaction contract for Phase 10 (Performance Audit and Budgets), authored for the `--gaps` replan. All three base plans (10-01/10-02/10-03) are executed; the only open gap (PERF-02: the CI job calls `scripts/perf-audit.mjs` without the required `--receipt` flag → `RECEIPT_PATH_REQUIRED`) touches **scripts and CI YAML only — zero UI surfaces**. This contract therefore has two jobs: (1) pin the contract for the phase's only user-visible surfaces — the two lazily-loaded panel fallbacks inside `forecast-workbench.tsx` — so the gap-closure plan cannot drift them; (2) lock the scope: no new UI is built in this phase, and the fixture detail page's visual design is governed by earlier phases. Decisions D-01…D-09 from `10-CONTEXT.md` are binding. All user-facing copy is Russian (AGENTS.md convention, 2026-10-15); technical identifiers stay English.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — no `components.json` exists anywhere in the repo (re-verified 2026-11-18); the project uses a hand-authored token layer |
| Preset | Not applicable |
| Component library | None installed. Native HTML (`p`, `section`, `button`, `select`, `label`) plus existing project components |
| Icon library | None. The loading fallbacks are text-only `<p role="status">` lines — a spinner glyph would add weight against the gated script-byte budget and must not be added |
| Font | Body `--font-sans` = self-hosted IBM Plex Sans (variable 400–700, `apps/web/app/fonts.ts`); headings `--font-serif` = self-hosted Source Serif 4. No font CDN |
| Styling | Tailwind 4 CSS-first is available; this phase introduces **no new styles at all** — the split moves existing code verbatim, and the fallback copy inherits the page's body typography from `apps/web/app/globals.css` (matchdata-theme). No one-off inline values |

---

## Component Inventory

Enumerated by `Get-ChildItem apps/web/components -Filter *.tsx | Measure-Object` — 18 components — `@bet-stats/web@0.0.0` (private workspace package, version unresolved: never published) — 2026-11-18.

Non-exhaustive list of known-good components, never a closed allowlist. The phase moves code between colocated modules; it adds **no** new components and imports **no** new ones beyond what the moved code already used.

| Component / asset | Import path | Use in this phase |
|-------------------|-------------|-------------------|
| `ResponsiveEvidence` | `apps/web/components/responsive-evidence.tsx` | Eager core of the workbench — stays eager, untouched (D-09; RESEARCH Open Question 3 resolution) |
| `enum-labels.ts` | `apps/web/components/enum-labels.ts` | Russian label maps imported by the moved `ValueOutcomeSection` (`valueReasonLabel`) — verbatim move, no new labels |
| `time-format.ts` | `apps/web/components/time-format.ts` | `formatUtc` support for the moved comparison panel — verbatim move |
| `odds-format.ts` | `apps/web/components/odds-format.ts` | Odds display helpers used by the panel — verbatim move |
| `risk-disclosure.tsx` | `apps/web/components/risk-disclosure.tsx` | Persistent responsible-gambling disclosure on the page — untouched; budget work must never weaken it |
| Badge pattern | `apps/web/components/data-state-notice.tsx` | Reference pattern for state chips if any copy ever needs one — not used by this phase's fallbacks |

---

## Spacing Scale

No new spacing is introduced by this phase. The existing `--space-*` tokens from `globals.css` govern every surface; all are multiples of 4.

| Token | Value | Usage in this phase |
|-------|-------|---------------------|
| `space-1` | 4px | Inherited element gaps only |
| `space-2` | 8px | Inherited inline metadata gaps |
| `space-3` | 12px | Inherited table cell padding |
| `space-4` | 16px | Inherited block inner spacing |
| `space-6` | 24px | Inherited panel/card padding |
| `space-8` | 32px | Inherited section separation |
| `space-12` | 48px | Inherited major breaks |
| `space-16` | 64px | Page-level only (inherited) |

Exceptions: `44px` is the minimum control height (inherited page convention), not a spacing value. Radius: `--radius-control` 3px / `--radius-panel` 4px (inherited). Borders 1px. The loading fallback `<p>` adds no spacing of its own — it inherits the default paragraph margin only.

---

## Typography

Exactly the project's existing sizes and the two weights. This phase introduces no new type; the fallback strings render as body text.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Loading fallback / status line | 16px | 400 | 1.5 (inherited body) |
| Metadata / table rows (moved code) | 14px | 400 (600 emphasis) | 1.4 (inherited) |
| Body / buttons (eager core, moved code) | 16px | 400 (600 `<strong>`) | 1.5 (inherited) |
| Heading `h3` «Ручная полная книга коэффициентов» and section headings (inherited) | 1.4rem ≈ 22.4px (`h2` convention) / component-inherited | 600 | 1.2 (inherited) |

Rules: the fallback copy is never truncated, uppercased, or styled smaller than body; machine identifiers (snapshot hashes) keep `overflow-wrap: anywhere` behavior from the moved code; `font-variant-numeric: tabular-nums` stays on numeric columns as already implemented. Heading hierarchy of the page is unchanged by the split (`h1 → h2 → h3` as before — the moved panels contained no headings).

---

## Color

All values are existing tokens from `globals.css`; this phase uses **no new colors**. The fallback lines inherit the default text color. State meaning always includes text — color is supplemental.

| Role | Light | Dark | Usage in this phase |
|------|-------|------|---------------------|
| Dominant (60%) `--color-page` | `#f1f3f0` | `#0e1512` | Page background (inherited, unchanged) |
| Secondary (30%) `--color-surface` | `#ffffff` | `#17211d` | Panels, tables, moved panel cards (inherited, unchanged) |
| Accent (10%) `--color-accent` | `#14503b` | `#5aab8a` | Existing links, focus rings, primary buttons (inherited, unchanged) |
| Destructive `--color-danger` | (existing token) | (existing token) | **No destructive actions exist in this phase** — the budget gate fails CI, it never mutates or deletes anything user-visible |

Accent reserved for (inherited page contract, unchanged by this phase): links, visible focus rings, and the page's existing primary buttons. The split does not add any accent-bearing element.

---

## Performance Interaction Contract

This is the core of the phase's UI contract: the interaction design exists to protect the gated Lighthouse budgets (mobile gate per D-04: LCP 26500ms, TBT 950ms, CLS 0.09, scriptTransferBytes 5500000B — pinned from committed receipts per D-03; the Performance score is recorded, never gated, per D-02).

| Rule | Contract |
|------|----------|
| Lazy mount condition | `ForecastComparisonPanel` and `ValueOutcomeSection` render **only after the user's interaction produces data to show** (comparison submitted / value result present). They are bound via `next/dynamic(() => import('./forecast-comparison-panel').then(m => m.ForecastComparisonPanel))` at module top level inside `forecast-workbench.tsx` (Next 16 constraint: a Server Component dynamic import in `page.tsx` does not code-split) |
| Fallback anatomy | Each lazy binding renders exactly one `<p role="status">` with the exact Russian copy from the Copywriting table — no spinner, no icon, no fixed height, no skeleton layout, no animation. Geometry is a single body-text line |
| Initial-load honesty | The fallbacks must never be mounted during the gated initial-load audit: both panels are post-interaction only, so LCP/TBT/CLS medians never include fallback geometry. Any change that mounts a fallback (or a skeleton) on initial render breaks the honest-audit premise (Pitfall 5 in 10-RESEARCH.md) and fails the phase |
| Eager core | The odds-entry core stays eager and interactive on mount: market select, odds fields, submit/compare handlers, availability block, `ResponsiveEvidence` (D-09). Gap-closure tasks must not touch mount-time fetch logic (Pitfall 10: no TBT-chasing scope creep) |
| Chunk-graph discipline | Lazy modules import shared pure helpers from `workbench-format.ts`, never back from `forecast-workbench.tsx` — a cyclic back-import would pull the eager core into the lazy chunk and erase the measured byte win (T-10-06). `page.tsx` keeps its static import of `ForecastWorkbench` |
| No charting library | Recharts is confirmed absent and must stay absent; the `dynamic-import-per-widget` fallback stays inactive (roadmap + CONTEXT) |
| Reduced motion | The fallbacks carry no animation; nothing in this phase adds motion, so `prefers-reduced-motion` is trivially respected. Any future animation must re-check it |
| Visual identity after split | Moved code renders pixel-identically to its pre-split state: the split is a bundle change, not a redesign. Any visible difference on the fixture detail page introduced by a gap-closure task is a defect |

---

## Copywriting Contract

All copy is Russian and exact. No certainty/urgency language; no betting vocabulary beyond the platform's established vocabulary.

| Element | Copy |
|---------|------|
| Primary CTA | **None new in this phase.** The page's existing primary actions («Сохранить полную неизменяемую книгу коэффициентов», «Сравнить…») are governed by earlier phases and are untouched. The phase's own "action" is CI enforcement — it has no button |
| Loading fallback — comparison panel | `Загружаем результат сравнения…` (`role="status"`, polite) — implemented in 10-02, verbatim-locked |
| Loading fallback — value outcome | `Загружаем результат value-сравнения…` (`role="status"`, polite) — implemented in 10-02, verbatim-locked |
| Empty state | **None new.** Page-level empty/degraded states («Сопоставимая пара прогнозов пока недоступна» and friends) are governed by earlier phases. Note: the audit harness preflight treats that degraded marker as a failure signal — the UI copy is a correctness instrument, and no gap-closure task may weaken or reword it without updating the harness contract |
| Error state | **None new.** A failed chunk load surfaces through Next's error boundary (existing app-level handling); the fallback string is the only copy this phase contributes. No new error copy is added for lazy-panel failure in this phase |
| Destructive confirmation | **None.** This phase has no destructive actions — budgets fail the build, they never delete or reset anything a user can see. Any future destructive surface must return here first |
| Forbidden | No urgency or certainty language anywhere on the touched surfaces (existing responsible-copy test suite still scans the owning modules: `responsible-copy.test.ts` reads `value-outcome-section.tsx` after the split) |

---

## UI Considerations

Applicable state considerations resolved: **4 covered, 2 backstop, 0 unresolved**.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| Loading | Comparison panel, value outcome section | ✅ covered | Each lazy binding renders the exact `role="status"` fallback copy above; a single body-text line, no spinner, no skeleton |
| Populated | Comparison panel, value outcome section | ✅ covered | Moved code renders verbatim — same Russian copy, same receipt fields, same tables as before the split (10-02 moved code without edits) |
| Partial | Receipt fields inside the moved panels | ✅ covered | Inherited: absent values render explicit `Нет`/omitted rows per the earlier-phase contracts — the move must not change any absent-value rendering |
| Overflow | Long snapshot hashes, fixture IDs, table content | ✅ covered | Inherited: `overflow-wrap: anywhere` and horizontal-scroll-with-caption behavior moved with the code |
| Initial-load purity | Gated metrics vs fallback mounting | 🧪 backstop | Test/evidence: the harness preflight (workbench heading present, degraded marker absent) plus unit tests asserting the fallbacks are post-interaction-only — initial-load CLS/LCP must never include fallback geometry |
| Chunk-graph acyclicity | `workbench-format.ts` import direction | 🧪 backstop | The after-receipt `scriptTransferBytes` median strictly below the before-receipt median (committed receipts in `scripts/perf/perf-receipts/`) is the durable proof; a gap-closure task that reverts bytes must re-run the harness |

---

## Scope Lock (gap replan)

| Surface | Status |
|---------|--------|
| `/fixtures/[fixtureId]` page visual design | Governed by Phases 1–6 contracts; Phase 10 changes no pixel |
| `forecast-workbench.tsx` lazy bindings + two fallback strings | The phase's only UI surface — contract pinned above |
| `forecast-comparison-panel.tsx`, `value-outcome-section.tsx`, `workbench-format.ts` | Moved-verbatim modules; their copy follows the source phases' contracts |
| CI gap closure (PERF-02 `--receipt` flag, `ci.yml` job, contract test) | Scripts/YAML only — **no UI artifacts, no copy, no tokens** |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | None | Not applicable — shadcn is not initialized (`components.json` absent repo-wide, re-verified 2026-11-18) |
| Third-party registries | None | No registry code permitted by this contract; no vetting required |

---

## Source Traceability

| Source | Decisions used |
|--------|----------------|
| `10-CONTEXT.md` | D-01 (config-driven page list — no UI), D-02 (score recorded, never gated), D-04 (mobile gate, desktop recorded), D-09 (lazy split, eager odds-entry core, no charting library) — **from CONTEXT.md** |
| `REQUIREMENTS.md` §PERF-01, §PERF-02 | Median-of-3 honest measurement with before/after metrics; CI fail on budget regression — **from REQUIREMENTS.md** |
| `ROADMAP.md` §Phase 10 | No composite-score chasing; Recharts absent — do not add; ~39 KB workbench target — **from ROADMAP.md** |
| `10-RESEARCH.md` | Pitfall 5 (degraded page = dishonest audit), Pitfall 10 (no TBT-chasing), Open Question 3 (both panels split, core eager) — **from RESEARCH.md** |
| `10-01/10-02/10-03-PLAN.md` + executed state | Budgets pinned (mobile gate values), fallback strings implemented, split modules exist; gap = missing `--receipt` in CI invocation (STATE.md, 2026-11-17) — **executed plans + STATE.md** |
| `apps/web/app/globals.css`, `fonts.ts`, `components/*` | Actual palette, `--space-*`, `--radius-*`, fonts, 18-component inventory — **existing code, re-verified 2026-11-18** |

Defaults selected under the delegated «решай все сам» authority inherited from `10-CONTEXT.md` (each marked): treating the fallback strings as verbatim-locked implemented copy — **default** (they exist in code); icon-free text fallbacks — **default** (script-byte budget); no new error copy for chunk failure — **default** (Next error boundary already handles it). No question was left unanswered; no user interaction was required.

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS
- [x] Dimension 7 Inventory Provenance: PASS

**Approval:** approved (2026-11-18, gsd-ui-checker 7/7 PASS)
