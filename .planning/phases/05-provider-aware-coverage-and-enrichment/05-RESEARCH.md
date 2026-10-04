# Phase 05: Provider-Aware Coverage and Enrichment - Research

**Researched:** 2026-09-09
**Domain:** Multi-provider football-data routing, quota-safe enrichment, canonical reconciliation, and immutable forecast comparison
**Confidence:** HIGH for in-repository architecture; MEDIUM for public provider semantics pending credentialed probes

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)
- Release-wide operator dashboards, dead-letter controls, full mobile polish, methodology documentation, and end-to-end release certification remain Phase 6 work.
- Paid providers, automated bookmaker execution, live/in-play signals, and expanded markets remain outside the MVP.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROV-01 | The system uses football-data.org as primary for configured top-five leagues and Champions League fixtures and standings. | Versioned route matrix; football-data.org coverage and throttle semantics; provider-neutral adapter contract. |
| PROV-02 | The system can route eligible top-five/UCL requests to API-Football fallback without changing canonical fixture or team identity. | Route receipt plus exact external-ref-first reconciliation and quarantine on ambiguity. |
| PROV-03 | The system can use API-Football as the primary source for configured Europa League and Conference League data. | API-Football seasonal coverage discovery and sole-source route policy. |
| PROV-04 | A user sees a limited-data state for Europa League or Conference League when API-Football is unavailable because no production fallback exists. | Explicit terminal route outcome and stale-last-valid presentation contract. |
| PROV-05 | The system calls lineup, injury, odds, or detailed-statistics endpoints only when the provider capability record confirms coverage and budget policy permits the call. | Exact capability key, TTL, circuit and atomic-reservation admission sequence. |
| PROV-06 | A user can compare INITIAL, PRE_MATCH, and available LINEUP_CONFIRMED snapshots and see which evidence changed the forecast. | Server-produced pairwise comparison DTO, stable URL selection, delta and missing-reason rules. |
| PROV-07 | TheSportsDB can suggest names and logos for reconciliation review but cannot supply production match statistics or silently approve ambiguous matches. | Dedicated suggestion-only adapter and schema boundary, append-only manual review. |
</phase_requirements>

## Summary

Phase 05 should add a routing layer before the existing provider adapters, not embed fallback inside either HTTP client. The route policy must be a versioned, durable decision over `(competition, season, endpoint family)`, and every attempt must produce an append-only receipt even when no call is admitted. Normalization must become provider-neutral while canonical IDs continue to be resolved only through existing external references and audited reconciliation. [VERIFIED: packages/football-data/src/provider.interface.ts:3-100] The current normalized DTOs hard-code `provider: "football-data.org"`, so generalization is a prerequisite, not an optional cleanup.

The biggest planning trap is quota semantics. football-data.org publicly documents a free limit of 10 requests **per minute**, while the current repository policy uses `configuredAllowance: 10` with `resetTimezone: "UTC"` and counts reservations by date. [CITED: https://docs.football-data.org/general/v4/policies.html] [VERIFIED: packages/database/src/replay-provider-policy.ts:23-27] Do not reinterpret the current daily ledger as the provider's minute throttle. Preserve a project-configured daily soft budget if desired, but add a distinct provider throttle window/header observation contract. API-Football publishes daily and per-minute remaining headers, but exact daily reset behavior and actual competition-season coverage must be probed with the configured key before locked values are planned. [CITED: https://www.api-football.com/news/post/how-ratelimit-works]

**Primary recommendation:** Build one provider-neutral route/admission/reconciliation pipeline with durable route receipts, separate hard provider throttles from project soft budgets, and make comparison a deterministic projection of exact immutable snapshots.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Route selection and failure classification | API / Backend | Database / Storage | Domain policy decides; PostgreSQL persists version and receipt. |
| Provider HTTP, validation, coverage discovery | API / Backend adapter | — | Untrusted payload and response headers terminate at adapter boundary. |
| Budget/circuit admission | Database / Storage | Worker | Atomic reservation is durable; worker orchestrates without owning truth. |
| Cross-provider canonical resolution | Database / Storage | API / Backend | External refs and append-only reconciliation protect identity. |
| Optional enrichment scheduling | Worker | Database / Storage | BullMQ coordinates time-based work; PostgreSQL owns admission and evidence. |
| Forecast comparison | API / Backend | Browser / Client | Server validates same-fixture pair and computes canonical deltas; client owns stable selection/display. |
| TheSportsDB suggestions | API / Backend adapter | Database / Storage | Adapter emits only suggestion fields; review case persists provenance. |

## Project Constraints (from AGENTS.md)

- Use pnpm workspaces/Turborepo with Next.js, React, TypeScript, Tailwind, TanStack Query, Recharts, NestJS, PostgreSQL/Prisma, Redis/BullMQ.
- MVP uses free tiers and manual odds; track provider/date/endpoint requests and protect critical API-Football allowance.
- Preserve canonical entities, provider external references, auditable matching, and immutable snapshots.
- Sync must be idempotent, cached, retried with backoff, and circuit-protected.
- Backtests must prevent leakage and evaluate probability quality.
- No automatic wagering or certainty claims; preserve region restrictions and persistent disclaimers.
- No project skills exist; conventions are not yet established, so follow implemented patterns.
- Repository changes must occur through a GSD workflow; this research is part of `$gsd-plan-phase`.

## Standard Stack

### Core

| Library / facility | Version | Purpose | Why Standard |
|--------------------|---------|---------|--------------|
| Node built-in `fetch` | Node `>=24.0.0 <25` | Provider HTTP, abort timeout, headers | Already used; avoids a second HTTP stack. [VERIFIED: package.json:7-9] |
| Zod | Existing workspace dependency | Strict API-Football/TheSportsDB payload schemas | Existing football-data boundary pattern; reject malformed and unknown authority. |
| Prisma/PostgreSQL | Existing workspace | Route receipts, capability TTL, reservations, provenance, reconciliation | Existing durable source of truth. |
| BullMQ | Existing workspace | Delayed pre-match/lineup polling and retries | Existing queue conventions already use deterministic IDs and exponential backoff. |
| Vitest 4.1.11 / Playwright 1.62.1 | `4.1.11` / `1.62.1` | Unit/integration and browser acceptance | Exact installed project versions. [VERIFIED: package.json:20-24] |

### Supporting

| Facility | Purpose | When to Use |
|----------|---------|-------------|
| Existing capability evaluator | Fail closed on absent, mismatched, unsupported, or expired coverage. Its reasons are exactly `"UNKNOWN_CAPABILITY"`, `"UNSUPPORTED_CAPABILITY"`, `"EXPIRED_CAPABILITY"`, `"CAPABILITY_MISMATCH"`. [VERIFIED: packages/domain/src/capability.ts:14-24] | Before every optional provider call. |
| Existing provider circuit model | Durable `"CLOSED"`, `"OPEN"`, `"HALF_OPEN"` state. [VERIFIED: packages/database/prisma/schema.prisma:59-63] | Before reservation/call and after classified response. |
| Existing forecast contract | Snapshot kinds are exactly `"INITIAL"`, `"PRE_MATCH"`, `"LINEUP_CONFIRMED"`. [VERIFIED: packages/domain/src/forecast/contract.ts:3-4] | Comparison and lineup issuance. |

No new external package is required; therefore no installation or Package Legitimacy Audit is needed.

## Architecture Patterns

### System Architecture Diagram

```text
BullMQ schedule / API request
          |
          v
Versioned route matrix --> capability check --> circuit check --> atomic budget/throttle reservation
          |                       | denied                    | denied
          |                       +-------------> explicit route outcome receipt
          v
Primary adapter --> classified result ----retryable/unsupported/budget----> eligible fallback adapter
          | success                                                     | success
          +--------------------------+-----------------------------------+
                                     v
                   strict provider-neutral normalized observation
                                     v
 external-ref exact lookup --> conservative participant+kickoff match --> ambiguity?
          | exact                       | unique                    | yes
          +-----------------------------+---------------------------+--> reconciliation case; block publication
                                     v
                append provenance + canonical fact (never rewrite)
                                     v
              cutoff-safe evidence build --> immutable forecast snapshot
                                     v
              same-fixture pair comparison API --> stable client selection + deltas
```

### Recommended Project Structure

```text
packages/football-data/src/
├── contracts/                 # provider-neutral normalized DTOs and strict schemas
├── routing/                   # versioned route matrix, classifier, route receipts
└── providers/
    ├── football-data-org/     # existing adapter
    ├── api-football/          # fixtures/results/standings + optional endpoints
    └── thesportsdb/           # suggestion-only names/aliases/logo candidates
packages/database/src/
├── provider-routing/          # durable decisions, attempts, header observations
└── reconciliation/           # external-ref and audited candidate resolution
workers/data-sync/src/jobs/    # route-aware sync and pre-match enrichment scheduling
apps/api/src/                  # comparison and provider-state projections
apps/web/app/fixtures/[fixtureId]/ # stable pair selection and delta UI
```

### Pattern 1: Route receipt before provider call

Create a route decision containing policy version/hash, competition/season/endpoint, ordered candidates, selected provider, trigger/reason, capability decision, budget decision, circuit snapshot, correlation ID, and timestamps. Persist attempts independently from normalized facts. A denied/no-fallback decision is a successful explicit orchestration result, not a fabricated provider response.

### Pattern 2: Coverage is seasonal evidence, not a permanent feature flag

API-Football's `/leagues` response exposes a per-season `coverage` object for events, lineups, fixture/player statistics, standings, players, injuries, predictions and odds. The official guidance warns that flags can be false before a season starts and that `true` does not guarantee every fixture has data. [CITED: https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage] Store exact provider/league/season/endpoint records with `verifiedAt`, TTL and raw receipt; refresh them, and still represent a fixture-level empty result as unavailable/pending rather than zero.

Recommended configurable defaults [ASSUMED]: coverage TTL 24 hours for active seasons, 6 hours within seven days of season start, and 7 days for completed seasons. These are scheduling policy defaults, not provider guarantees.

### Pattern 3: Identity resolution is external-ref first

Resolve provider external IDs first. If no ref exists, find canonical home/away participant refs and candidates inside a configured kickoff tolerance; accept only one conservative match, otherwise open a reconciliation case. Existing uniqueness is per `(provider, externalId)`, while canonical fixture IDs remain independent. [VERIFIED: packages/database/prisma/schema.prisma:839-868] Never include provider identity in a canonical-ID derivation.

Recommended kickoff tolerance [ASSUMED]: ±15 minutes for cross-provider reconciliation, configurable and versioned; reschedules outside it require review or an explicit existing fixture link.

### Pattern 4: Separate three limits

Keep (1) provider hard daily quota, (2) provider short-window throttle, and (3) application soft budget/headroom as distinct values. Record response header observations after every attempt and reconcile conservatively with reservations; never increase available capacity merely because a header is absent or malformed. football-data.org documents 10 calls/minute on free accounts. [CITED: https://docs.football-data.org/general/v4/policies.html] API-Football documents daily and per-minute limit/remaining headers. [CITED: https://www.api-football.com/news/post/how-ratelimit-works]

### Pattern 5: Server-authoritative pair comparison

Accept exact left/right snapshot IDs, load both, verify same canonical fixture and `ISSUED` state, then return deltas in stable market/selection order plus cutoff, source additions/removals, expected-goal and adjustment changes, confidence component changes, limitations and receipt IDs. The schema already makes issued forecasts immutable and revisions fixture/kind unique. [VERIFIED: packages/database/prisma/schema.prisma:507-541] Keep pair IDs in URL/search state so background refetch cannot replace a side.

### Anti-Patterns to Avoid

- Catch-all fallback on validation/identity errors: malformed payloads and ambiguous identity must quarantine, not silently switch providers.
- One generic `available` boolean: it loses unsupported/stale/pending/limited and fixture-level absence.
- Budget reservation after HTTP: concurrency can overspend; reserve atomically first.
- Treating API-Football coverage `true` as guaranteed data for every fixture.
- Updating fallback rows when primary recovers: append new provenance and select current deterministically.
- Feeding TheSportsDB event/stat fields into evidence: enforce a compile-time suggestion-only DTO.
- Client-side subtraction of arbitrary receipts: same-fixture and issued-state checks belong on the server.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Canonical identity | Provider-prefixed canonical IDs | Existing external-ref tables and reconciliation cases | Immutable downstream references already depend on canonical IDs. |
| Optional coverage | Static competition booleans | Existing expiry-aware capability records populated from provider-season coverage | Coverage changes by season and can be incomplete by fixture. |
| Concurrency-safe quota | In-memory counters | PostgreSQL atomic reservations plus provider header observations | Multiple workers and crashes make local counters unsafe. |
| Retry scheduling | Timers inside adapters | Existing BullMQ job options and classified retry policy | Queue owns delay/retry; adapter owns one call. |
| Forecast comparison | Mutable “latest” timeline | Exact immutable pair projection | Prevents silent side replacement and audit drift. |
| Logo trust | Direct remote `<img>` from candidate URL | Application image proxy/allowlist, content-type/size validation and safe fallback | URLs are untrusted presentation input. |

## Common Pitfalls

### Pitfall 1: Daily ledger models a minute throttle
**What goes wrong:** The system either blocks after ten calls all day or bursts through the provider minute limit.
**Why it happens:** Existing policy counts by `requestDate`, but football-data.org's public free-plan limit is per minute.
**How to avoid:** Add explicit throttle-window semantics and tests spanning minute boundaries; keep any daily soft cap separately.
**Warning signs:** `resetTimezone` is used as the only reset field for football-data.org.

### Pitfall 2: Fallback duplicates a fixture
**What goes wrong:** API-Football's ID creates a second canonical row and splits forecast/history.
**How to avoid:** exact external ref → resolved participant refs → unique kickoff-window candidate → quarantine.
**Warning signs:** inserts happen before both team identities resolve.

### Pitfall 3: Optional lane consumes continuity headroom
**What goes wrong:** lineup/odds polling prevents fixture/result calls.
**How to avoid:** reserve against provider-wide effective capacity, with critical headroom protected across endpoint families rather than isolated counters.
**Warning signs:** each optional endpoint believes the same remaining quota is independently available.

### Pitfall 4: Lineup “available” is mistaken for “confirmed”
**What goes wrong:** a predicted/incomplete lineup issues `LINEUP_CONFIRMED`.
**How to avoid:** require explicit official confirmation observation and same canonical fixture. The current parser enforces equivalence between `LINEUP_CONFIRMED` and non-null lineup observation ID. [VERIFIED: packages/domain/src/forecast/contract.ts:114-124]
**Warning signs:** forecast kind derives from endpoint success alone.

### Pitfall 5: Empty upstream arrays become zeros
**What goes wrong:** injuries/statistics absence reduces a feature as though observed zero.
**How to avoid:** persist observed-empty separately from unsupported, unavailable, stale and pending; evidence components remain nullable with limitation/source times. [VERIFIED: packages/database/prisma/schema.prisma:479-489]

## Code Examples

### Provider-neutral normalized boundary

```typescript
type ProviderId = "football-data.org" | "api-football";

interface NormalizedFixtureObservation {
  provider: ProviderId;
  externalId: string;
  competitionExternalId: string;
  seasonExternalId: string;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  kickoffUtc: string;
  capturedAt: string;
  raw: Readonly<Record<string, unknown>>;
}
```

The provider values above are locked decisions but the new union is not yet present in source, so this skeleton remains [ASSUMED] until the planner defines the canonical provider registry.

### Fail-closed optional admission order

```typescript
const capabilityDecision = evaluateCapability(capability, expected, now);
if (!capabilityDecision.allowed) return denied(capabilityDecision.reason);
if (!circuit.permitsRequest) return denied(circuit.reason);
const reservation = await reserveAtomically(route, lane, jobKey);
if (!reservation.allowed) return denied(reservation.reason);
return adapter.fetch(request);
```

This preserves the existing exact-key capability behavior; new circuit/reservation result shapes are [ASSUMED] and must be specified in the plan.

## State of the Art

| Old/current approach | Required Phase 05 approach | Impact |
|----------------------|----------------------------|--------|
| Normalized DTO hard-codes football-data.org | Provider-neutral normalized observation | Enables fallback without changing canonical persistence. |
| Static configured code list includes `"PL", "PD", "BL1", "SA", "FL1", "CL", "EL"` [VERIFIED: packages/football-data/src/provider.interface.ts:19-20] | Versioned per-provider competition/endpoint route matrix | Stops a competition code from implying the wrong provider. |
| Date-count allowance for all policy semantics | Separate provider throttles, hard quota and soft headroom | Correctly models minute and daily constraints. |
| Single snapshot workbench | Exact pair comparison with absent-kind reasons | Meets PROV-06 without mutable “latest” behavior. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Coverage TTL defaults: 24h active, 6h near season start, 7d completed. | Architecture Pattern 2 | Stale capability or wasted quota; keep configurable. |
| A2 | Cross-provider kickoff tolerance defaults to ±15 minutes. | Architecture Pattern 3 | False match or excessive review; validate on captured provider samples. |
| A3 | Proposed provider registry and new circuit/reservation DTO shapes. | Code Examples | Compile/schema mismatch; define before implementation. |
| A4 | Retry default: 3 attempts, exponential 1s base with jitter, circuit opens after 5 retryable failures for 5 minutes. | Open Questions | Provider SLA and quota impact; credentialed degradation tests must tune. |

## Open Questions (RESOLVED)

1. **Credential-specific quota and reset semantics**
   - Resolution: public documentation supplies only documented defaults; deployment facts are admitted only from an explicit, non-production credentialed probe. The probe is opt-in, operator-approved, redacts credentials and non-allowlisted headers, and emits a review artifact rather than mutating route policy automatically. [CITED: https://docs.football-data.org/general/v4/policies.html] [CITED: https://www.api-football.com/news/post/how-ratelimit-works]
   - Fail-closed rule: missing credentials, absent/malformed limit headers, an unknown reset instant, or disagreement between configured policy and observed metadata denies that provider/endpoint admission until an operator approves a versioned policy update. This denial is provider/endpoint-local and must not fail the deterministic CI suite or disable unrelated providers/endpoints.
   - No numeric daily allowance, reset instant, league ID, or proxy-header behavior is asserted without a probe-confirmed receipt. The documented football-data.org free-plan minute throttle remains a documented default, not proof of the active account's deployment allowance.
2. **API-Football competition/season IDs and coverage**
   - Resolution: do not seed guessed IDs. A credentialed `/leagues` probe must return a request-bound, redacted receipt; an operator then approves the exact `(provider, competition, season, endpoint)` mapping and coverage flags as versioned capability records. [CITED: https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage]
   - Fail-closed rule: missing, stale, contradictory, or season-mismatched metadata yields `unknown/unsupported` admission for only that provider/competition/season/endpoint. UEL/UECL therefore surface the locked no-fallback limited-data state; top-five/UCL may use only an independently eligible, exact route.
3. **Cross-provider kickoff drift**
   - Resolution: use a configurable, versioned ±15-minute reconciliation candidate window as the documented planning default [ASSUMED], but never as sufficient identity proof. Acceptance still requires canonical home/away participants and exactly one candidate; zero or multiple candidates create/reuse an audited reconciliation case and block publication.
   - Before promoting the default beyond shadow mode, run a held-out recorded corpus containing exact matches, drift within/outside the window, reschedules, reversed participants, and collisions. Changing the window requires a new policy version and regression evidence; no credential-derived fixture IDs are committed as universal constants.
4. **Retry and circuit defaults**
   - Resolution: use configurable defaults of at most three total attempts, exponential backoff from 1 second with bounded jitter, and a circuit that opens after five consecutive retryable failures for five minutes with one leased half-open probe [ASSUMED]. A valid provider `Retry-After`/reset observation may lengthen the delay but may never widen capacity.
   - Retries apply only to classified transient transport, 429, and 5xx failures. Validation errors, identity ambiguity, unsupported/stale capability, protected-budget denial, unknown reset semantics, and provider metadata disagreement fail closed without retry storms. Deterministic tests use injected clocks/randomness and recorded responses; the credentialed probe is a separate manual gate.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | all services | ✓ | 25.2.1 installed; project requires `<25` | Use project-managed Node 24 before execution. |
| pnpm | workspace | ✓ | 10.34.5 | — |
| Docker | PostgreSQL/Redis integration | ✓ | 29.7.2 | — |
| API-Football credential | live coverage/quota probe | Unknown | — | Fixture recordings for deterministic tests; credential probe remains release gate. |
| football-data.org credential | live header/coverage probe | Unknown | — | Existing fixtures/mocks; live semantics remain a gate. |
| TheSportsDB credential | suggestion probe | Free v1 key publicly documented | v1 | Disable suggestions without affecting production evidence. |

**Missing dependencies with no fallback:** Node 24 runtime for compliant execution; live provider credentials for final coverage/quota verification.
**Missing dependencies with fallback:** TheSportsDB suggestions can be disabled; deterministic adapter tests use recordings.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11; Playwright 1.62.1 |
| Config file | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `pnpm test -- --run tests/unit/provider-routing.test.ts` |
| Full suite command | `pnpm test && pnpm test:integration && pnpm test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROV-01 | football-data primary route for top-five/UCL fixtures and standings | integration | `pnpm test:integration -- tests/integration/provider-routing.test.ts` | ❌ Wave 0 |
| PROV-02 | classified fallback retains canonical fixture/team IDs | integration | `pnpm test:integration -- tests/integration/provider-fallback-identity.test.ts` | ❌ Wave 0 |
| PROV-03 | API-Football sole primary route for UEL/UECL | integration | `pnpm test:integration -- tests/integration/api-football-provider.test.ts` | ❌ Wave 0 |
| PROV-04 | no-fallback limited-data state | e2e | `pnpm test:e2e -- provider-degradation.spec.ts` | ❌ Wave 0 |
| PROV-05 | capability + circuit + atomic budget gate optional calls | integration | `pnpm test:integration -- tests/integration/enrichment-admission.test.ts` | ❌ Wave 0 |
| PROV-06 | stable exact-pair forecast deltas and absent reasons | unit/e2e | `pnpm test -- --run tests/unit/forecast-comparison.test.ts` | ❌ Wave 0 |
| PROV-07 | TheSportsDB fields cannot enter evidence or auto-approve | integration/security | `pnpm test:integration -- tests/integration/thesportsdb-boundary.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted unit or integration file under 30 seconds.
- **Per wave merge:** `pnpm test && pnpm test:integration`.
- **Phase gate:** full suite and provider-degradation Playwright flow green under Node 24.

### Wave 0 Gaps
- Add the seven test files above plus redacted provider fixtures covering success, 429, 5xx, malformed payload, coverage false/expired, confirmed/unconfirmed lineup and ambiguous cross-provider mapping.
- Add a credentialed opt-in contract probe excluded from default CI; it records no keys or raw headers that may contain identifiers.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Provider secrets remain server-only; admin reconciliation uses existing protected gateway. |
| V3 Session Management | yes | Reuse existing administrator session/authorization boundary. |
| V4 Access Control | yes | Only admins can decide reconciliation; users can read sanitized route/receipt projections. |
| V5 Input Validation | yes | Strict schemas at provider, query, image and comparison-ID boundaries. |
| V6 Cryptography | yes | Platform TLS and existing secret/config facilities; never log or return API keys. |

### Known Threat Patterns for the stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Provider payload/HTML injection | Tampering | Treat payload as data, strict schema, escape UI output, never execute embedded URLs/content. |
| SSRF via logo URL | Tampering / Information Disclosure | Do not server-fetch arbitrary URLs; allowlist HTTPS image hosts or proxy through validated host/type/size policy. |
| Secret/header leakage | Information Disclosure | Allowlist response metadata; redact auth and unexpected headers/errors. |
| Quota exhaustion | Denial of Service | Atomic reservation, short-window limiter, critical headroom, circuit and idempotent job IDs. |
| Unauthorized reconciliation | Elevation of Privilege | Admin authorization, optimistic concurrency, append-only decision evidence. |
| Receipt substitution | Tampering | Same-fixture validation and exact immutable snapshot IDs; policy/version hashes. |

## Sources

### Primary / official documentation (MEDIUM confidence from the configured websearch seam)
- https://docs.football-data.org/general/v4/policies.html — registered free-plan 10 requests/minute policy.
- https://www.football-data.org/coverage — current free competition coverage, including top-five leagues and Champions League.
- https://www.football-data.org/pricing — free fixtures/schedules/league tables and plan limits.
- https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage — `/leagues` seasonal coverage object and non-guarantee caveats.
- https://www.api-football.com/news/post/how-ratelimit-works — daily and per-minute response header names and per-user/IP behavior.
- https://www.api-football.com/coverage — live detailed coverage page; explicitly varies by season/fixture.
- https://www.thesportsdb.com/documentation — team search/lookup, badges, free limits and 429 behavior.

### Repository source-of-truth (HIGH confidence)
- `packages/domain/src/capability.ts`
- `packages/football-data/src/provider.interface.ts`
- `packages/database/src/replay-provider-policy.ts`
- `packages/database/prisma/schema.prisma`
- `packages/domain/src/forecast/contract.ts`
- `package.json`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; exact workspace versions inspected.
- Architecture: HIGH — constrained by locked decisions and existing source contracts.
- Provider coverage/quota: MEDIUM — official public docs checked, but credential-specific reset and seasonal coverage require live probes.
- Scheduling defaults: LOW — explicitly logged as assumptions and configurable.

**Research date:** 2026-09-09
**Valid until:** 2026-09-16 for provider coverage/quota facts; 2026-10-09 for repository architecture.
