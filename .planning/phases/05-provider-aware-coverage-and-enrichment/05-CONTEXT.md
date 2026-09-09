# Phase 5: Provider-Aware Coverage and Enrichment - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Expand the production fixture and evidence path to the configured top-five leagues, Champions League, Europa League, and Conference League; add policy-controlled provider fallback and optional pre-match enrichment; and let users compare immutable forecast revisions without weakening canonical identity, provenance, quota, or limited-data guarantees. This phase does not add paid data, automatic odds ingestion as the default path, live/in-play signals, or release-wide operations work.

</domain>

<decisions>
## Implementation Decisions

### Provider routing and canonical identity
- **D-01:** Provider roles are explicit and versioned by competition and endpoint: football-data.org is primary for the configured top-five leagues and Champions League, API-Football is eligible fallback there, and API-Football is the sole production source for Europa League and Conference League.
- **D-02:** Fallback is triggered only by a classified primary-source failure, unsupported coverage, or exhausted/unavailable policy allowance. It never changes canonical league, team, player, season, or fixture identity, and it never silently replaces an exact provider receipt.
- **D-03:** Cross-provider fixture reconciliation must resolve through existing external-reference and audited reconciliation contracts using canonical participants plus a configured kickoff window. Ambiguity blocks publication and forecasting rather than creating a duplicate. — **Reversibility:** one-way — weakening this after multi-provider facts exist would require deduplicating canonical history and repairing immutable forecast/evaluation references.

### Degradation and limited-data behavior
- **D-04:** Every provider attempt records the chosen route, reason, capability decision, budget decision, circuit state, and source receipt. The user-facing state distinguishes unavailable, limited, stale, unsupported, and pending; missing enrichment is never represented as zero.
- **D-05:** Europa League and Conference League expose an explicit no-fallback limited-data state when API-Football is unavailable. The application keeps any last valid immutable data with its timestamps, but does not present it as current or substitute another provider silently.
- **D-06:** Primary recovery does not rewrite fallback-derived facts. Later captures append provenance and may become current only through deterministic reconciliation and freshness rules.

### Optional enrichment admission
- **D-07:** Lineups, injuries, provider odds, and detailed statistics are optional-lane calls. Admission requires an exact provider/competition/season/endpoint capability record that is supported and unexpired, plus an atomic budget reservation and a permitting circuit state; unknown or stale capability fails closed.
- **D-08:** Critical fixture and result continuity always retains protected quota headroom over optional enrichment. Provider odds may be retained as provenance-bearing evidence where coverage permits, but manual odds remain the primary MVP value workflow and no automated bookmaker execution is introduced.
- **D-09:** `LINEUP_CONFIRMED` is issued only from an official confirmed-lineup observation bound to the same canonical fixture and visible source receipt. Injuries and secondary statistics may affect evidence/confidence only when captured before the forecast cutoff and must remain individually attributable.

### Forecast revision comparison
- **D-10:** The comparison experience groups immutable `INITIAL`, `PRE_MATCH`, and available `LINEUP_CONFIRMED` snapshots for one canonical fixture and keeps the user's selected pair stable; a newer snapshot never silently replaces either side.
- **D-11:** Comparison leads with what changed: cutoff and evidence sources, expected goals and bounded adjustments, confidence components, limitations, and probability deltas for each supported market. It also exposes exact snapshot IDs and receipts through progressive disclosure.
- **D-12:** An absent snapshot kind is shown with a concrete reason such as no confirmed lineup, capability denied, budget protected, provider unavailable, or insufficient evidence. It is not rendered as an empty forecast or inferred from another snapshot.

### TheSportsDB reconciliation aid
- **D-13:** TheSportsDB may contribute only names, aliases, and logo candidates to an administrator-visible reconciliation case. Suggestions include provider provenance and never auto-approve, mutate canonical identity, or enter match-statistics/evidence calculations.
- **D-14:** Administrator approve, reject, and correction actions continue to use append-only reconciliation decisions with optimistic concurrency; external image URLs remain untrusted presentation data until validated by the application boundary.

### the agent's Discretion
- Exact retry thresholds, circuit timing, capability TTLs, fallback cooldowns, and optional-call scheduling may be selected during research, provided they are versioned, configurable, quota-safe, and tested against provider degradation.
- Exact responsive layout and delta visualization may follow existing accessible tables, notices, and progressive-disclosure patterns while keeping limitation reasons and provenance prominent.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and acceptance
- `.planning/PROJECT.md` — provider roles, free-tier limits, canonical identity, reliability, and responsible-use boundaries.
- `.planning/REQUIREMENTS.md` § Provider Fallback and Enrichment — PROV-01 through PROV-07.
- `.planning/ROADMAP.md` § Phase 5 — phase goal, boundary, and observable success criteria.

### Inherited phase contracts
- `.planning/phases/04-settlement-and-evidence-scorecard/04-CONTEXT.md` — immutable evaluation identities and honest unavailable/limited cohort presentation.
- `.planning/phases/03-forecast-and-manual-value-workbench/03-CONTEXT.md` — forecast kinds, immutable revision selection, confidence, cutoff, lineup provenance, and manual-odds boundaries.
- `.planning/phases/02-historical-evidence-pipeline/02-CONTEXT.md` — chronological evidence, provider budget lanes, circuit breaking, replay, and provenance rules.

### Live implementation contracts
- `packages/domain/src/capability.ts` — fail-closed capability decision contract.
- `packages/football-data/src/provider.interface.ts` — current football-data.org normalized fixture/result/standings boundary and configured competitions.
- `packages/football-data/src/providers/football-data-org/client.ts` — current primary-provider HTTP and validation pattern.
- `packages/database/src/replay-provider-policy.ts` — shared quota, headroom, circuit-freshness, and reset-semantics policy projection.
- `packages/database/prisma/schema.prisma` — canonical external references, audited reconciliation, provider capability/circuit/reservation, lineup observation, and immutable forecast models.
- `packages/domain/src/forecast/contract.ts` — strict `INITIAL`, `PRE_MATCH`, and `LINEUP_CONFIRMED` response and provenance contract.
- `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` — stable snapshot selection, confidence/limitations, and receipt disclosure integration point.
- `apps/web/components/evidence-state-notice.tsx` — established pending, unavailable, stale, and limitation presentation pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/domain/src/capability.ts`: exact-key, expiry-aware fail-closed admission for optional endpoints.
- `packages/database/src/replay-provider-policy.ts`: provider/date/endpoint quota projection with protected headroom and circuit freshness.
- `packages/database/prisma/schema.prisma`: provider-independent canonical IDs, external refs, append-only reconciliation decisions, source observations, lineups, and immutable forecasts.
- `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx`: stable snapshot selector and detailed immutable receipt display.
- `apps/web/components/evidence-state-notice.tsx`: accessible honest-state notices that can be extended for provider degradation.

### Established Patterns
- PostgreSQL owns durable identities, reservations, provenance, and append-only decisions; Redis/BullMQ coordinates retryable work without becoming historical truth.
- Provider payloads are untrusted, validated at the adapter boundary, normalized before persistence, and never allowed to define canonical IDs.
- Analytical inputs are cutoff-aware, immutable, and source-attributable; unavailable and limited are successful explicit states rather than fabricated values.

### Integration Points
- Generalize `packages/football-data` provider types so API-Football adapters can emit the same provider-independent normalized contracts.
- Extend worker fixture/result/standings jobs with a versioned route decision and fallback orchestration before normalization/persistence.
- Connect optional enrichment to existing capability, reservation, circuit, observation, evidence-build, and forecast orchestration contracts.
- Extend the fixture API and workbench with provider-state reasons and pairwise immutable snapshot deltas.

</code_context>

<specifics>
## Specific Ideas

- Treat fallback choice itself as auditable evidence: users and operators should be able to tell which provider answered and why it was selected.
- Show forecast change as a delta between exact receipts, not as a mutable “latest forecast” timeline.
- Keep TheSportsDB visually and structurally separated from production match evidence so an enrichment hint cannot acquire statistical authority by accident.

</specifics>

<deferred>
## Deferred Ideas

- Release-wide operator dashboards, dead-letter controls, full mobile polish, methodology documentation, and end-to-end release certification remain Phase 6 work.
- Paid providers, automated bookmaker execution, live/in-play signals, and expanded markets remain outside the MVP.

</deferred>

---

*Phase: 05-provider-aware-coverage-and-enrichment*
*Context gathered: 2026-09-09*
