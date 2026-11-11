---
phase: 09-degradation-alerting
plan: 04
subsystem: ui
tags: [nextjs, react, ssr-tests, vitest, alerts, operations-center, russian-copy]

requires:
  - phase: 09-degradation-alerting (Plan 03)
    provides: overview alerts + channelState read model (sanitized AlertView rows, POST alerts/:id/acknowledge) and the internal-api operations proxy with method-bound HMAC
  - phase: 09-degradation-alerting (Plan 02)
    provides: evaluator that produces the deduplicated OpsAlert rows and OpsAlertDelivery evidence the block renders
provides:
  - AlertsBlock client component on /internal/operations — channel-honesty line (не настроен / настроен / доставка не удалась), «Активные» then «Решённые за 7 дней» groups with severity+lastSeen ordering and fingerprint dedup, severity chips via token color-mix, dl metadata, CopyCorrelation per ID, non-destructive acknowledge (Подтвердить → Подтверждён marker, role=status/role=alert, focus on marker)
  - Page integration: «Алерты» as the first block after the page header, independent alertPage URL parameter (25 items/page, «Показано {start}–{end} из {total}»)
  - enum-labels additions: alertSeverityLabel / alertStatusLabel / alertSignalLabel with raw-code fallback for unknown codes
  - 39 SSR unit tests covering the full UI-SPEC state matrix incl. planted-secret canary and D-04 acknowledge semantics
affects: [ALRT-03, ALRT-04, phase-09-closeout]

actuals:
  tokens: 7700 # chars/4 over the realized diff (448 insertions / 1 deletion, 4 files, ~30.7k chars) — same scale as the plan's estimateTokens (38000 est)
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Sibling-block mirroring: card/button constants and a minimal CopyCorrelation co-located in alerts-block.tsx (importing page.tsx would cycle), same discipline as backup-status-block.tsx"
    - "DOM-layer redaction canary: the component renders only typed fields, so a row object with unsanitized extra props (payload/auth/stack canaries) can never leak them into markup"
    - "Client-side pagination slice over a partitioned ordered list (active severity desc/lastSeen desc, then resolved lastSeen desc) with an own URL parameter so sibling blocks never clobber each other"

key-files:
  created:
    - apps/web/app/internal/operations/alerts-block.tsx
    - apps/web/app/internal/operations/alerts-block.test.ts
  modified:
    - apps/web/app/internal/operations/page.tsx
    - apps/web/components/enum-labels.ts

key-decisions:
  - "Acknowledge interaction lives inside AlertsBlock as a row-local state machine (pending id, local ack map, per-row failure) instead of a page-level handler — the page stays a thin data owner and the whole interaction is SSR-testable"
  - "The component re-partitions defensively instead of trusting API order: active (status≠RESOLVED) sorted by severity rank CRITICAL>WARNING then lastSeen desc, resolved after — the flat API array interleaves severities across statuses"
  - "alertPage pagination slices the combined ordered list client-side (the API has no alerts pagination); 25/page matching the failures block, independent URL parameter per the UI-SPEC default"
  - "Unknown signal codes render the raw code only when the label fallback equals the code (no «CODE · CODE» duplication)"

patterns-established:
  - "Group count lines use the Russian plural helper (1 алерт / 2–4 алерта / 5+ алертов) while headers and empty-state copy stay byte-exact per the UI-SPEC contract"

requirements-completed: [ALRT-03, ALRT-04] # copied verbatim from PLAN.md frontmatter

coverage:
  - id: D1
    description: "AlertsBlock renders all UI-SPEC states: channel honesty (unconfigured warning non-green / configured success / delivery-failed danger with bounded status), empty-active + empty-resolved exact copy, CRITICAL-before-WARNING + lastSeen desc + resolved-after-active ordering, one row per fingerprint, Russian labels beside English codes, unknown code raw, «Нет» for missing IDs/scope, Решён row only on resolved, severity chips via token color-mix with text labels"
    requirement: ALRT-03
    verification:
      - kind: unit
        ref: "apps/web/app/internal/operations/alerts-block.test.ts — 39/39 passed (empty states, ordering/dedup, labels, partial data, channel honesty, canary, acknowledge semantics, plural, pagination)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit (apps/web) — exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Acknowledge semantics at the view layer (D-04): Подтвердить renders on OPEN unacknowledged rows only with the Russian accessible name; an acknowledged row keeps its row, stays «Активен», keeps count, shows the «Подтверждён · {time}» marker without a button; resolved rows carry no action"
    requirement: ALRT-04
    verification:
      - kind: unit
        ref: "apps/web/app/internal/operations/alerts-block.test.ts — acknowledge-semantics cases (marker renders, button absent, row count unchanged)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Page integration: «Алерты» is the first block after the header before «Готовность системы», Overview type extended with alerts+channelState from the Plan 03 API response, independent alertPage query state, acknowledge POST goes through the existing /internal-api/operations catch-all proxy (method-bound HMAC, no new auth surface)"
    requirement: ALRT-03
    verification:
      - kind: other
        ref: "npx tsc --noEmit (apps/web) — exit 0; full web vitest project 121/121 passed"
        status: pass
    human_judgment: false
  - id: D4
    description: "Visual adequacy of the «Алерты» block on the live operations page: rendered look in light/dark themes, 320px reflow, 200% zoom, keyboard-only acknowledge with focus on the marker, and the live acknowledge round-trip behind OperatorGuard+gateway/HMAC — not exercised: observing the running stack requires the user's dev servers, which the operating rules forbid disturbing"
    verification: []
    human_judgment: true
    rationale: "All render-level behavior is proven by 39 SSR tests; visual/interaction adequacy on the live page needs the user's running stack (never kill/restart it) — verify at the next natural stack open"

duration: 6min
completed: 2026-11-11
status: complete
---

# Phase 9 Plan 04: Operations Alert Block Summary

**«Алерты» block on /internal/operations wired to the Plan 03 read model: channel-honesty line, active-then-resolved severity-sorted rows with correlation copy buttons, non-destructive acknowledge, independent pagination — plus the alert label vocabulary and 39 SSR tests proving the full UI-SPEC state matrix. Phase complete, ready for next step.**

## Performance
- **Duration:** 6min
- **Started:** 2026-11-11T06:56Z
- **Completed:** 2026-11-11T07:02Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- The operator's view half of ALRT-03: active and recent alerts with correlation context, severity chips (Критично/Предупреждение, text-first), Russian lifecycle labels, per-row metadata and copyable correlation IDs — secrets, raw payloads and headers cannot reach the DOM (typed-field rendering + canary test)
- Channel honesty (D-01, view half of ALRT-04): «не настроен» renders as non-green warning copy, «настроен» as success, a failed last delivery as danger with the bounded HTTP status
- Acknowledge is non-destructive (D-04): the marker replaces the button, the row stays «Активен», count/lastSeen untouched; failure is row-local role=alert and changes no state
- «Алерты» sits first after the page header; alerts paginate via their own `alertPage` parameter without disturbing the failures `page`
- 39 SSR unit tests (121/121 across the whole web project) + clean `tsc --noEmit`

## Task Commits
1. **Task 1 (tracer): «Алерты» block + page integration + enum labels** - `49d4064` (feat)
2. **Task 2: SSR state tests for the AlertsBlock (39 cases)** - `a32e0cc` (test)

## Files Created/Modified
- `apps/web/app/internal/operations/alerts-block.tsx` - AlertsBlock + AlertsBlockFact/AlertRow types, channel line, grouping/ordering/dedup, acknowledge state machine, alertPlural helper, mirrored card/button/CopyCorrelation
- `apps/web/app/internal/operations/page.tsx` - Overview extended with alerts+channelState, alertPage query state, «Алерты» Block rendered first, alertPage appended to the overview fetch
- `apps/web/components/enum-labels.ts` - exported ALERT_SEVERITY/STATUS/SIGNAL_LABELS maps + three label functions with `?? raw` fallback
- `apps/web/app/internal/operations/alerts-block.test.ts` - 39 SSR cases over the UI-SPEC state matrix (renderToStaticMarkup pattern of backup-status-block.test.ts)

## Decisions Made
- Acknowledge interaction lives inside AlertsBlock (row-local pending/ack/failure state) rather than a page-level handler — page stays a thin data owner; the whole interaction is unit-testable without a server
- Component re-partitions defensively: the API returns one severity-sorted flat array (a resolved CRITICAL would rank above an open WARNING), so the block partitions by status first — active (severity desc, lastSeen desc) then resolved (lastSeen desc) — and dedups by signal\0scope fingerprint
- alertPage pagination slices the combined ordered list client-side; the API carries no alerts pagination, 25/page matches the failures block, and the group empty-copies are computed from the full lists so page 2 never hides an empty state
- Unknown signal codes render the raw code alone (label fallback equals the code → no «CODE · CODE» duplication)

## Deviations from Plan

None - plan executed exactly as written. (The plan action mentioned a page-level acknowledge handler; the handler was implemented inside the component instead — the same fetch POST to /internal-api/operations/alerts/:id/acknowledge, same states, recorded above as a key decision. Every acceptance criterion unchanged and verified.)

## Issues Encountered
- First vitest run: 37/39 — the 2 failures were bugs in my own new test expectations (asserting the alert `id` renders in markup; the UI-SPEC field list deliberately omits the row id). Fixed the assertions to check row content (scope/dd occurrences) instead; the component's behavior was never wrong. Second run: 39/39.
- vitest in this non-TTY shell needs `CI=true` + null stdin (known from 09-01/09-02); used via `cmd /c ... < NUL`.

## TDD Gate Compliance
- RED: absent in the canonical order. The plan is tracer-first: Task 1 committed the full AlertsBlock implementation (`feat(09-04)` `49d4064`) before Task 2's tests existed, so a genuine assertion-level RED would require destructively reverting Task 1 — an import-failure RED would be INVALID_RED under #3770. Same situation as 09-01/09-02/09-03; flagged honestly per fail-fast rule 3 rather than fabricating evidence.
- GREEN: 39/39 SSR tests passed after fixing the two test-expectation bugs noted above (the component behavior itself was never wrong); full web project 121/121; tsc exit 0.
- REFACTOR: no changes needed.
- Commit order check: `test(09-04)` `a32e0cc` follows `feat(09-04)` `49d4064` — the inverted pattern documented here.

## User Setup Required
None - no external service configuration required. (Optional alerting activation — ALERTS_ENABLED / ALERT_WEBHOOK_URL — remains a deliberate operator decision; without the webhook the block honestly shows «Канал доставки: не настроен…».)

## Next Phase Readiness
- Phase 09 complete: OpsAlert models (09-01), evaluator + webhook dispatch + delivery probe (09-02), read model + acknowledge endpoint (09-03), and the operator view (this plan) now cover ALRT-01…04 end to end; ALRT-03/ALRT-04 flip to Complete under the shared-ID gate with this SUMMARY
- Deferred per CONTEXT.md and untouched here: dedicated alerts history sub-page and threshold-configuration UI
- Live-page visual check (D4, human judgment) is the one open verification — natural next step when the user next opens /internal/operations

---
*Phase: 09-degradation-alerting*
*Completed: 2026-11-11*

## Self-Check: PASSED

- SUMMARY file exists at `.planning/phases/09-degradation-alerting/09-04-SUMMARY.md`
- All 4 commits verified as ancestors of HEAD: `49d4064` (feat), `a32e0cc` (test), `4788c62` (docs SUMMARY), `255141b` (docs state/roadmap/requirements)
- Commits measured from ledger `gsd-plan-head-before-09-04` (cbbf2ff): 2 task commits + 3 docs commits
- User's unrelated working-tree changes (faq, fixtures, api fixtures, e2e, etc.) untouched and uncommitted
