# Phase 6: Release Experience and Operations - Context

**Gathered:** 2026-09-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the complete fixture-to-evaluation product understandable and usable on mobile and desktop, publish a versioned methodology/model card, give operators a safe diagnostic and recovery surface, enforce consent-based retention boundaries, and establish production-like release verification. This phase does not add new betting markets, paid providers, automatic wagering, live/in-play signals, or personalized staking features.

</domain>

<decisions>
## Implementation Decisions

### Release user experience
- **D-01:** Use one primary top navigation with Fixtures, Analysis, Results, and Methodology. On mobile it collapses into a compact expandable menu that retains all four destinations.
- **D-02:** Dense tables and charts become mobile cards that lead with the key conclusion and expose the complete evidence through progressive disclosure; desktop may retain denser comparative layouts.
- **D-03:** Partial failures remain local to the affected block. Preserve valid data and show the failure reason, freshness, and a retry action beside the unavailable or degraded content instead of replacing the whole page.
- **D-04:** All complete fixture, analysis, manual-odds, value, and performance paths must remain keyboard accessible, readable, and functionally equivalent across supported mobile and desktop layouts.

### Methodology and model card
- **D-05:** The methodology page starts with a concise plain-language summary, followed by progressively disclosed sections for inputs, exclusions, confidence, limitations, evaluation, and responsible use.
- **D-06:** Show the current model-card version and effective date prominently and maintain a human-readable changelog of material changes.
- **D-07:** Use two levels of explanation: an accessible primary layer and an expandable technical layer containing formulas, thresholds, policy versions, and links to exact receipts.
- **D-08:** Keep the complete limitation policy in the model card and repeat the relevant contextual warnings beside forecasts, value results, and scorecards.

### Operator center
- **D-09:** The operator landing page begins with system readiness, provider health, and quota consumption, then drills into failed work, data-quality errors, and recent incidents.
- **D-10:** Group failures and dead-lettered work by root cause and impact while preserving access to affected jobs, first and last occurrence, correlation identifiers, and safe actions.
- **D-11:** Retry and replay require an impact preview followed by explicit confirmation with a reason. The preview shows scope, quota effect, logical identity, and immutable-data guarantees before work is queued.
- **D-12:** Operator diagnostics expose only structured safe metadata and copyable correlation IDs. Raw payloads, credentials, tokens, and unrestricted logs must never be rendered in the UI.

### Privacy and release verification
- **D-13:** Personal betting-related history, including user-entered odds and viewed-result history, is not retained by default. Durable personal history requires separate explicit consent. — **Reversibility:** costly — changing the default after release would require a data migration, revised consent records, and a new retention policy.
- **D-14:** Withdrawing consent deletes personal betting-related history and stops future retention. Non-personal system facts and immutable model receipts may remain only when they cannot be linked back to the user's actions. — **Reversibility:** one-way — deleted personal history cannot be reconstructed, and the deletion boundary is a published privacy contract.
- **D-15:** A mandatory production-like release gate runs the complete fixture → forecast → manual odds → value → result → settlement → scorecard journey through real PostgreSQL, Redis, API, worker, and web boundaries without network interception.
- **D-16:** Release verification also exercises quota exhaustion, an open circuit breaker, provider unavailability, quarantined payloads, stale or limited evidence, dead letters, and safe retry/replay. Incorrect or dishonest behavior in any representative state blocks release.

### the agent's Discretion
- Exact responsive breakpoints, visual tokens, chart implementation, focus styling, and menu mechanics may follow accessible project conventions while preserving the locked information hierarchy and functional parity.
- Exact dashboard grouping thresholds, refresh intervals, and release-test fixture data may be selected during research and planning, provided they remain deterministic, auditable, secret-safe, and representative of the locked scenarios.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and acceptance
- `.planning/PROJECT.md` — core value, stack constraints, responsible-gambling boundary, reliability, and immutable snapshot rules.
- `.planning/REQUIREMENTS.md` § Release Experience and Operations — UX-01, UX-02, OPS-01, OPS-02, OPS-03, and PRIV-01.
- `.planning/ROADMAP.md` § Phase 6 — phase goal and observable success criteria.

### Inherited contracts
- `.planning/phases/05-provider-aware-coverage-and-enrichment/05-CONTEXT.md` — provider degradation, quota admission, immutable forecast comparison, and operator-visible provenance.
- `.planning/phases/04-settlement-and-evidence-scorecard/04-CONTEXT.md` — cohort health, scorecards, settlement identity, and honest unavailable/limited presentation.
- `.planning/phases/03-forecast-and-manual-value-workbench/03-CONTEXT.md` — manual-odds workflow, immutable receipts, confidence, warnings, and value outcomes.

### Live implementation contracts
- `apps/web/app/layout.tsx` — current global shell, navigation, responsive container, and persistent responsible-use footer.
- `apps/web/components/analytics-shell.tsx` — eligibility boundary and protected analytics shell.
- `apps/web/app/scorecards/scorecard-dashboard.tsx` — current dense scorecard, reliability table, cohort warnings, and receipt disclosure.
- `apps/web/app/internal/pipeline/replay/page.tsx` — existing preview-confirm replay flow, quota context, immutable-data copy, and correlation ID display.
- `apps/api/src/modules/health/health.controller.ts` — current liveness/readiness and correlation-ID projection.
- `infra/docker-compose.operator.yml` — existing operator gateway and production-like service topology.
- `playwright.phase05.config.ts` — current production-boundary Playwright acceptance configuration to extend.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/components/analytics-shell.tsx` and `apps/web/components/risk-disclosure.tsx`: reuse the protected analytics and persistent risk-copy boundary across release surfaces.
- `apps/web/components/data-state-notice.tsx`, `evidence-state-notice.tsx`, and `provider-state-notice.tsx`: extend the established local degraded-state patterns instead of inventing page-wide failure states.
- `apps/web/app/internal/pipeline/replay/page.tsx`: reuse preview, stale-preview rejection, explicit confirmation, revision reason, quota disclosure, and correlation-ID patterns.
- `apps/web/app/scorecards/scorecard-dashboard.tsx`: source for performance evidence, denominators, exact cohort identity, progressive receipts, and mobile transformation work.

### Established Patterns
- Server-owned, no-store analytical projections are rendered with explicit evidence states and never silently broaden, replace, or mutate exact identities.
- Operator routes sit behind the existing signed gateway/guard boundary; PostgreSQL owns durable facts while Redis/BullMQ coordinates retryable work.
- Acceptance flows use real production Nest/Next boundaries and owned PostgreSQL/Redis resources rather than intercepted responses.

### Integration Points
- Expand `apps/web/app/layout.tsx` into the agreed responsive primary navigation and add the methodology destination.
- Add release-wide responsive/accessibility behavior to fixtures, forecast workbench, odds/value results, and scorecards.
- Extend health, provider-attempt, quota, queue, data-quality, and replay projections into an operator overview without exposing raw provider payloads or secrets.
- Add privacy consent/withdrawal boundaries at the web/API/persistence seams and extend Playwright/Testcontainers release gates across the entire immutable lifecycle.

</code_context>

<specifics>
## Specific Ideas

- Mobile analytical views should read as conclusions-first cards, with exact receipts and dense evidence still available on demand.
- The model card should serve both ordinary users and technical reviewers without forcing either audience through the other's level of detail.
- Recovery actions should feel deliberately safe: preview consequences first, then confirm with a reason, then return an auditable correlation ID.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-release-experience-and-operations*
*Context gathered: 2026-09-20*
