# Phase 1: Trustworthy Fixture Discovery - Context

**Gathered:** 2026-08-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a runnable pnpm/Turborepo system in which an eligible user can browse upcoming fixtures for one supported competition, inspect a canonical fixture with source freshness and limitations, and in which an operator can safely resolve ambiguous provider identities. This phase establishes identity, provenance, data-state, configuration, health, and responsible-access contracts; prediction, historical features, value analysis, and provider fallback remain later-phase work.

</domain>

<decisions>
## Implementation Decisions

### Initial Competition and Fixture Browsing
- **D-01:** Prove the first production data path with the Premier League through football-data.org; additional competitions remain configuration-ready but are not required to work in this phase.
- **D-02:** The fixture dashboard groups fixtures by the user's local calendar date and provides explicit date and competition filters; default view covers today plus the next 48 hours.
- **D-03:** The fixture detail page is read-only in this phase and shows canonical teams, competition/season, kickoff, status, provider provenance, freshness, and data-quality state. Prediction and odds controls must not appear as placeholders.

### Jurisdiction, Age, and Claims Policy
- **D-04:** Betting-related analytics use a server-side explicit region allowlist and deny access by default when the region is unknown or not enabled. — **Reversibility:** costly — changing from deny-by-default later affects API authorization, caching, and every protected route contract.
- **D-05:** Require an 18+ acknowledgement before protected analytics are exposed; Phase 1 does not introduce accounts or persist betting-related behavioral history.
- **D-06:** Risk disclosure is persistent on forecast/value-capable shells, while fixture discovery remains available with neutral analytical language. Copy tests reject certainty, guaranteed-win/profit, and urgency phrasing.
- **D-07:** Geographic detection is advisory only; browser locale or IP inference cannot silently grant access. An explicit server-evaluated region code is authoritative.

### Canonical Entity and Fixture Identity
- **D-08:** Canonical League, Season, Team, Player, and Fixture IDs are provider-independent; provider identifiers live only in external-reference records. — **Reversibility:** one-way — reversing this after data ingestion would require migrating every relation and could split historical identity.
- **D-09:** Exact `(provider, externalId)` references auto-resolve. Normalized name/country matches and fixture team-pair/kickoff matches generate candidates; they auto-resolve only when exactly one candidate passes conservative thresholds, otherwise they enter review.
- **D-10:** Fixture identity includes canonical league/season, canonical home/away teams, and a scheduled kickoff candidate window. The ±36-hour window is candidate generation, not a database uniqueness rule and not sufficient by itself to merge.
- **D-11:** A postponement updates the same canonical Fixture when an existing external reference proves continuity. Without that lineage, a changed kickoff is quarantined for review rather than automatically merged.
- **D-12:** Every automatic or manual match records method, evidence, confidence when applicable, actor/source, timestamp, and supersession/reversal history. Destructive merge history is not overwritten.

### Data Quality and Capability States
- **D-13:** Use explicit `AVAILABLE`, `LIMITED`, `STALE`, `UNSUPPORTED`, and `UNRESOLVED` states in domain/API contracts. Missing numeric or categorical data remains null/absent and is never converted to zero.
- **D-14:** Fixture surfaces show source and capture/update time alongside non-available states. `UNRESOLVED` identity blocks forecast entry points; `LIMITED` and `STALE` remain viewable with prominent explanation.
- **D-15:** Provider capabilities are recorded per provider, competition, season, and endpoint with verification time. Unknown capability is treated as unsupported for conditional endpoints until probed or configured.
- **D-16:** Freshness thresholds are configuration values by data type; the phase ships sensible defaults but does not hardcode product policy inside UI components.

### Ambiguity Review
- **D-17:** Provide a minimal internal review queue listing the incoming provider record, canonical candidates, normalized evidence, confidence, and raw provider references.
- **D-18:** Review actions are approve candidate, reject all/create canonical, and correct/link manually; every action appends an audit decision and supports a later superseding correction.
- **D-19:** Until full accounts and roles exist, the review API and UI are protected by a server-side operator credential, disabled when that credential is absent, excluded from public navigation, and never authorized by a client-only flag. — **Reversibility:** costly — later replacement with RBAC changes authentication middleware and audit actor identity but preserves review semantics.

### the agent's Discretion
- Exact component styling, spacing, and badge palette within accessible contrast requirements.
- Exact conservative fuzzy-match thresholds, provided ambiguous cases never auto-merge and thresholds are configurable/tested.
- Health endpoint response shape, structured error envelope, package boundaries, and implementation mechanics consistent with the locked stack.
- Seed fixture data and development-only provider stubs used to make the vertical slice runnable without secrets.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Scope and Acceptance
- `.planning/ROADMAP.md` — Phase 1 boundary, requirements, dependencies, and observable success criteria.
- `.planning/REQUIREMENTS.md` — FOUND-01 through FOUND-06 and DATA-01 through DATA-08 are the authoritative Phase 1 requirements.
- `.planning/PROJECT.md` — core value, constraints, exclusions, and project-level locked decisions.
- `SPEC.md` §§1–5, 13–17 — product goal, supported competitions, source roles, responsible-gambling constraints, API budget, entity matching, REST surface, and MVP definition.

### Architecture and Data Contracts
- `ARCHITECTURE.md` §§1–6 — target component boundaries, provider roles, entity reconciliation flow, cache guidance, and reliability requirements.
- `MONOREPO_STRUCTURE.md` — intended apps/workers/packages layout and environment variables.
- `schema.prisma` — draft relational model; it is input for modernization, not an immutable schema contract.
- `.planning/research/ARCHITECTURE.md` — researched modular-monolith boundaries, temporal/audit gaps, and build-order implications.

### Stack and Research Findings
- `.planning/research/STACK.md` — current version lines, Prisma 7 modernization, testing stack, and compatibility constraints.
- `.planning/research/SUMMARY.md` — cross-domain conclusions, Phase 1 rationale, critical pitfalls, and unresolved launch questions.
- `.planning/research/PITFALLS.md` — leakage, reconciliation, coverage, quota, claims, and jurisdiction failure modes that Phase 1 contracts must anticipate.
- `.planning/research/FEATURES.md` — table-stakes fixture discovery, evidence, freshness, limitation, and responsible-use behaviors.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `schema.prisma`: substantial draft canonical/external-reference model to modernize for Prisma 7 and extend with auditable review/capability semantics.
- `ARCHITECTURE.md`: explicit provider ports, reconciliation algorithm, and data flow that can be translated into package boundaries.
- `MONOREPO_STRUCTURE.md`: proposed workspace tree provides the starting scaffold for `apps/web`, `apps/api`, `workers/data-sync`, and shared packages.

### Established Patterns
- No application code exists yet; patterns are contractual rather than implemented.
- PostgreSQL is authoritative; Redis/BullMQ are disposable coordination layers.
- Provider objects must be validated and normalized behind ports before reaching domain or API contracts.
- Canonical entities and immutable/audited decisions take precedence over convenient provider-ID coupling.

### Integration Points
- `apps/web`: fixture dashboard, fixture detail, access gate, data-state presentation, and internal reconciliation review screen.
- `apps/api`: health/config, fixture queries, eligibility policy, provider capability queries, and protected reconciliation commands.
- `workers/data-sync`: initial football-data.org fixture sync and normalization path.
- `packages/database`: Prisma 7 schema/config/client, migrations, constraints, and seed data.
- `packages/domain` and `packages/football-data`: provider-independent entities, typed data states, provider ports, and normalized DTOs.

</code_context>

<specifics>
## Specific Ideas

- The first user-visible proof is intentionally narrow: Premier League upcoming fixtures, not a superficially configured list of leagues that cannot be verified end to end.
- Trust signals should be visible beside the data they qualify, not buried in a generic footer or methodology page.
- An honest empty/limited state is a product feature: unsupported or unresolved data must not look like a zero-valued statistic.

</specifics>

<deferred>
## Deferred Ideas

- Predictions, confidence calculation, manual odds, and value analysis — Phase 3.
- Historical form, Elo, provider budgeting execution, retries, and replay — Phase 2.
- API-Football fallback, Europa/Conference League coverage, lineups, injuries, and TheSportsDB-assisted enrichment — Phase 5.
- Full user accounts, RBAC, saved history, consent preferences, and personalization — v2 unless separately promoted.

</deferred>

---

*Phase: 1-Trustworthy Fixture Discovery*
*Context gathered: 2026-08-27*
