# Phase 06: Release Experience and Operations - Research

**Researched:** 2026-09-20
**Domain:** Accessible release UX, model-card disclosure, operator observability/recovery, privacy retention, production-boundary verification
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UX-01 | A user can use fixture, match analysis, manual odds, value, and performance workflows on mobile and desktop with keyboard-accessible controls and readable charts. | Preserve semantic controls and DOM reading order; render conclusion-first cards below the responsive breakpoint; verify keyboard, 320px reflow/200% text, chart alternatives, and mobile/desktop parity. |
| UX-02 | A user can view a versioned methodology/model-card page explaining inputs, exclusions, confidence, limitations, evaluation, and responsible-use policy. | Publish a versioned, effective-dated, progressively disclosed document whose technical layer references the same model/config/policy identities already embedded in immutable receipts. |
| OPS-01 | An operator can inspect job failures, dead-lettered work, provider health, quota consumption, data-quality errors, and correlation identifiers without exposing secrets. | Build allowlisted read models over existing health, circuit, quota, route-attempt, reconciliation, sync-run and replay-delivery facts; never return `rawPayload`, headers, environment data or arbitrary log text. |
| OPS-02 | An operator can safely retry or replay failed ingestion/evaluation work and verify that durable facts and immutable snapshots remain consistent. | Extend the existing stale-safe preview/confirm/reason workflow and PostgreSQL-owned idempotency; compare before/after counts and hashes of immutable facts rather than rewriting them. |
| OPS-03 | Release verification covers the complete fixture-to-forecast-to-manual-odds-to-settlement workflow and representative provider degradation states. | Extend the Phase 5 real-boundary harness with deterministic scenario seeding, worker/API/web execution, negative degradation cases, and database invariants; no browser route interception. |
| PRIV-01 | The system does not persist user betting-related history without explicit consent and a documented retention boundary. | Separate anonymous immutable analytical facts from personal subject-to-fact associations; default to no association, record versioned consent before association writes, and delete associations/history atomically on withdrawal. |
</phase_requirements>

## Summary

Phase 06 is a release-hardening phase, not an architectural rewrite. The repository already has the essential primitives: semantic React controls and local degraded-state notices, persistent responsible-use copy, immutable forecast/odds/value/settlement facts, PostgreSQL-owned replay identities and leases, correlation IDs, an operator guard/gateway, and production-boundary Playwright harnesses. [VERIFIED: apps/web/components/provider-state-notice.tsx:1-8; apps/api/src/modules/replay/replay.service.ts:122-169; playwright.phase05.config.ts:3-17] The plan should compose those primitives into three new projections: a responsive public shell/methodology surface, a secret-safe operator overview, and a consent/retention boundary.

The most delicate design issue is PRIV-01. `ManualOddsSnapshot` and value receipts are required immutable analytical inputs, but personal history is forbidden by default. The safe resolution is to keep the immutable fact free of account/session/view identifiers and put every durable subject association in a separate consent-gated history layer. Withdrawal deletes that layer and blocks future writes; immutable facts remain only if no reverse link to the person's action survives. [VERIFIED: packages/database/prisma/schema.prisma:603-629,652-707] This preserves ODDS-02/VALUE-04 without quietly building an account-history feature that belongs to v2.

The release gate must exercise the real boundaries already established: PostgreSQL, Redis/BullMQ, worker, Nest API and Next web, with a deterministic owned stack and no request interception. It should add a mobile project and degradation scenario matrix, but remain serial because the current live stack owns shared service state. [VERIFIED: playwright.phase05.config.ts:3-17] Automated accessibility scanning is useful but incomplete; keyboard order, responsive equivalence, chart comprehension and destructive consent withdrawal require explicit behavioral assertions and manual checks. [CITED: https://playwright.dev/docs/accessibility-testing]

**Primary recommendation:** Plan Phase 06 as six vertical contracts—release shell, methodology, operator read model, safe recovery, consent retention, and a final real-boundary release gate—while preserving the current immutable ledger and signed operator boundary.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Responsive navigation and conclusion-first mobile cards | Browser / Client | Frontend Server (SSR) | Layout and disclosure are presentation concerns; server projections must remain identical across layouts. |
| Methodology/model card | Frontend Server (SSR) | API / Backend | Render a cacheable/versioned document; exact receipt links and current policy metadata come from controlled server constants/projections. |
| Operator readiness/failure/quota dashboard | API / Backend | Database / Storage | Nest owns allowlisting and authorization; PostgreSQL is the durable source for operational facts. |
| Retry/replay preview and confirmation | API / Backend | Database / Storage | Impact validation, idempotency and immutable guarantees are server/database invariants, not UI state. |
| Consent and personal-history retention | API / Backend | Database / Storage | Consent must be verified at every write and withdrawal must atomically erase associations/history. |
| Release verification | API / Backend | Browser / Client | The harness coordinates database, queue, worker, API and browser boundaries and verifies both DOM behavior and durable invariants. |

## Project Constraints (from AGENTS.md)

- Use the established pnpm/Turborepo, Next.js/React/TypeScript, NestJS, PostgreSQL/Prisma and Redis/BullMQ stack; do not introduce a parallel framework. [VERIFIED: AGENTS.md]
- MVP data sources remain free-tier plus manual odds; provider calls must remain budgeted by provider/date/endpoint. [VERIFIED: AGENTS.md]
- Canonical identities, provider external references, auditable matching and immutable snapshots are non-negotiable. [VERIFIED: AGENTS.md]
- Sync and recovery work must be idempotent, cached where appropriate, bounded/retried and circuit-protected. [VERIFIED: AGENTS.md]
- Backtests must prevent leakage and performance must be measured with probability-quality metrics, not hit rate alone. [VERIFIED: AGENTS.md]
- No automatic wagering, certainty claims or hidden risk; jurisdiction restrictions and persistent disclaimers remain required. [VERIFIED: AGENTS.md]
- Existing project conventions are not separately documented; follow patterns in the live codebase. [VERIFIED: AGENTS.md]
- No project-local skills were found. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library / Facility | Version | Purpose | Why Standard |
|--------------------|---------|---------|--------------|
| Next.js / React | `16.3.3` / `19.2.8` | Responsive shell, SSR methodology and operator UI | Already pinned in the web app; no new UI framework is needed. [VERIFIED: apps/web/package.json:14-18] |
| NestJS | `11.1.29` | Authorized operator/privacy endpoints and safe DTO projection | Existing composition root, guards and validation boundary. [VERIFIED: apps/api/package.json:11-25] |
| Prisma / PostgreSQL | Existing workspace schema / PostgreSQL 18 operator image | Consent records, operational projections and invariant checks | Existing durable source of truth and immutable receipt store. [VERIFIED: infra/docker-compose.operator.yml:104-130] |
| Redis / BullMQ | Redis `8.2.1`; BullMQ `^6.3.2` | Existing queue delivery and degradation scenarios | Queue state remains coordination; PostgreSQL remains authoritative. [VERIFIED: infra/docker-compose.operator.yml:132-145; apps/api/package.json:19-22] |
| Playwright Test | `1.62.1` | Desktop/mobile E2E and production-boundary gate | Already pinned and configured with failure traces/screenshots. [VERIFIED: package.json:20-24; playwright.phase05.config.ts:11-17] |

### Supporting

| Library / Facility | Version | Purpose | When to Use |
|--------------------|---------|---------|-------------|
| Native HTML (`nav`, `button`, `details`, `table`, forms) | Browser platform | Keyboard behavior and progressive disclosure | Default for menus, cards, filters, warnings and model-card sections; avoid custom ARIA widgets unless native semantics cannot express the interaction. [CITED: https://www.w3.org/TR/WCAG22/] |
| `@axe-core/playwright` | `4.13.0` | Automated common accessibility violations | Add to the release-gate dev dependencies, but never treat a clean scan as full accessibility proof. Playwright explicitly recommends automated plus manual/inclusive testing. [VERIFIED: npm registry] [CITED: https://playwright.dev/docs/accessibility-testing] |
| Existing health/replay/operator modules | In-repo | Readiness and recovery | Extend their safe DTOs and guard boundary instead of exposing Prisma models directly. [VERIFIED: apps/api/src/modules/health/health.controller.ts:7-29; apps/api/src/modules/reconciliation/operator.guard.ts:9-29] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS/native semantic responsive components | A component-system dependency | A design system may help later, but adds migration surface and does not replace content hierarchy/accessibility decisions. Use current primitives for this release. |
| Server-owned operator read models | Direct database browser or log viewer | Faster initially, but violates D-12 by exposing raw payloads/secrets and bypasses authorization/redaction. |
| Separate consent association | Add user fields to immutable odds/value rows | Direct linkage makes erasure conflict with immutable receipts and turns v1 into the deferred accounts feature. |
| Deterministic degradation seeds | Browser network interception | Interception is easier but fails D-15 because worker/API/provider policy boundaries are bypassed. |

**Installation:**

```bash
pnpm add -D @axe-core/playwright@4.13.0
```

No runtime dependency is required.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@axe-core/playwright` | npm | Established package; current version published 2026-08 | 3M+/week at lookup | `github.com/dequelabs/axe-core-npm` | OK | Approved; official Playwright docs use this integration. |

**Packages removed due to [SLOP] verdict:** none  
**Packages flagged as suspicious [SUS]:** none

The legitimacy seam returned `OK`, no postinstall signal, and the official Playwright accessibility guide names the package. Registry CLI lookup was blocked by the sandbox's cache-only npm configuration; the current version was cross-checked on the npm package page. [VERIFIED: npm registry] [CITED: https://playwright.dev/docs/accessibility-testing]

## Architecture Patterns

### System Architecture Diagram

```text
Public browser
  ├─ primary navigation ──> Fixtures / Analysis / Results / Methodology
  ├─ analytics workflow ──> Next server proxy ──> Nest eligibility/API
  └─ local anonymous draft (device only)
                                  │
                                  v
                         PostgreSQL immutable facts
                         forecast / odds / value / result / settlement

Operator browser
  └─ signed operator gateway ──> Next internal proxy ──> OperatorGuard
                                                        │
                                                        ├─ safe overview projection
                                                        │    health / circuits / quota /
                                                        │    failures / reconciliation
                                                        └─ preview → confirm(reason)
                                                                  │
                                                                  v
                                                        PostgreSQL replay plan/outbox
                                                                  │
                                                                  v
                                                           BullMQ → worker

Consent boundary
  anonymous fact ──X─> no subject association by default
  explicit versioned consent ──> subject-history association
  withdrawal ──> atomic delete association/history + future-write deny

Release harness
  deterministic seed → PostgreSQL/Redis → worker → Nest → Next → desktop/mobile browser
                    ↘ durable invariant checks + degradation matrix ↗
```

### Recommended Project Structure

```text
apps/web/
├── app/methodology/                 # versioned public model card
├── app/internal/operations/         # operator overview and drill-downs
├── components/release-navigation.*  # responsive primary nav
└── components/responsive-evidence.* # table/card and chart alternatives
apps/api/src/modules/
├── operations/                      # allowlisted read projections
├── replay/                          # extend existing preview/confirm/status
└── privacy/                         # consent, history association, withdrawal
packages/domain/src/
├── methodology/                     # versioned disclosure constants/contracts
└── privacy/                         # consent/retention policy and DTO validation
packages/database/prisma/
└── schema.prisma                    # consent + personal association only
tests/e2e/
├── release-journey.spec.ts
├── release-degradation.spec.ts
├── release-accessibility.spec.ts
└── live-release-stack.ts
```

### Pattern 1: Same information, responsive presentation

**What:** Build one server projection and render it as a dense desktop view or a conclusions-first mobile card, keeping all fields and actions available in both. Do not maintain separate mobile data fetches or calculations.

**When to use:** Fixture lists, forecast comparison, manual odds/value evidence, reliability buckets and candidate ledgers.

```tsx
<section aria-labelledby={`cohort-${id}`}>
  <h3 id={`cohort-${id}`}>{conclusion}</h3>
  <p>{warning}</p>
  <details>
    <summary>Complete evidence</summary>
    <EvidenceDefinitionList receipt={receipt} />
  </details>
</section>
```

At 320 CSS pixels, content must reflow without loss of information/functionality except genuinely two-dimensional content; relocating content is acceptable when it remains accessible. [CITED: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html]

### Pattern 2: Local degradation islands

**What:** Each data block owns `available/loading/degraded/unavailable` presentation and retry. Preserve successful siblings and exact identities. Reuse the established `DataStateNotice`, `EvidenceStateNotice`, and `ProviderStateNotice` vocabulary.

**When to use:** Charts, provider evidence, quota widgets, scorecard cohorts, operator groups.

**Planning consequence:** The overview API should return per-block status/freshness/reason/correlation data rather than one page-wide success boolean.

### Pattern 3: Allowlisted operator projection

**What:** Query durable facts, aggregate by explicit safe fields, and map to a DTO. Never serialize Prisma rows directly.

```ts
type FailureGroupDto = Readonly<{
  reason: string;
  impact: "BLOCKING" | "DEGRADED";
  count: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
  correlationIds: readonly string[];
  retryable: boolean;
}>;
```

The current schema already provides safe grouping inputs: `SyncRun.state` is verbatim `"PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"`; `ReplayDelivery.state` is verbatim `"PENDING" | "CLAIMED" | "RETRYABLE" | "DELIVERED"`; attempts carry `classifiedReason`; circuits are verbatim `"CLOSED" | "OPEN" | "HALF_OPEN"`. [VERIFIED: packages/database/prisma/schema.prisma:44-63,380-445] Raw source facts contain `rawPayload` and must never enter this DTO. [VERIFIED: packages/database/prisma/schema.prisma:281-304]

### Pattern 4: Preview, stale check, explicit reason, audited queue

**What:** Recovery is a command workflow, not a button directly attached to a failed row. Preview freezes logical scope and quota/policy fingerprint; confirmation rejects stale previews and requires a reason; queuing returns a correlation/plan identity.

**When to use:** Both ingestion replay and evaluation retry. If evaluation currently lacks an equivalent preview contract, factor a shared recovery command envelope rather than bypassing it.

The existing replay service locks preview and confirmation keys in PostgreSQL, rejects mismatched/expired previews, converges duplicate plans, and reports `immutableObservations: true` plus `predictionSnapshotsMutated: false`. [VERIFIED: apps/api/src/modules/replay/replay.service.ts:122-169]

### Pattern 5: Consent-gated association, not mutable receipts

**What:** Keep immutable analytical facts independent of a subject. Store versioned consent and any subject-to-receipt/view association separately. Every association write checks active consent in the same transaction. Withdrawal marks consent withdrawn and deletes all personal association/history rows atomically.

**When to use:** User-entered odds history, viewed results, saved analysis references. Local incomplete odds drafts remain device-local and non-analyzable, matching the current workflow. [VERIFIED: tests/e2e/forecast-workbench.spec.ts:120-130]

**Critical boundary:** Do not store account/session/IP/user-agent/correlation identifiers on `ManualOddsSnapshot`, `ValueReceipt`, `ForecastSnapshot`, or settlement facts. Ensure free-text `sourceLabel` is documented and validated as a bookmaker/source label, not a user label. After withdrawal, verify no join, audit detail, log field or cache can recover the user's action trail.

### Pattern 6: Versioned model card bound to receipts

**What:** A human-readable document has a model-card version, effective date and changelog. Technical sections reference the actual `modelVersion`, `modelHash`, `configVersion`, `configHash`, settlement policy, cohort policy and formula receipts used by the product.

**When to use:** Methodology page and contextual links beside forecasts/value/scorecards.

**Planning consequence:** Treat model-card content as versioned source-controlled data with tests that known receipt identities are represented; do not duplicate formulas as untested prose constants across components.

### Anti-Patterns to Avoid

- **CSS-only visual reordering:** It can make keyboard/focus order diverge from visual order. Keep meaningful DOM order intact. [CITED: https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html]
- **Chart-only evidence:** Recharts/SVG visuals need adjacent textual summary, values/denominators, limitation state and receipt disclosure.
- **Global error replacement:** A failed chart/provider block must not erase valid fixture or forecast facts.
- **Generic `/logs` UI:** Arbitrary log text is not a safe operator projection and can leak credentials, payloads or personal data.
- **Retry from client state:** Scope, quota and immutable guarantees must be recomputed server-side and bound to a preview version.
- **Consent checkbox as authorization:** Consent must be a durable, versioned server fact checked at write time; a cookie/local toggle is insufficient for durable retention.
- **Deleting immutable model facts on withdrawal:** Delete personal associations; retain only facts that are provably unlinkable to the subject and required by the immutable evidence contract.
- **Mocked release journey:** Request interception cannot satisfy the production-like gate.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Accessibility scanner | Custom DOM-rule engine | `@axe-core/playwright` plus behavioral/manual checks | Standards coverage and rules change; automated scans still do not prove full accessibility. |
| Menu keyboard model | Custom div/ARIA menu | Native button + controlled disclosure + links | Native semantics give expected focus and activation behavior. |
| Operational source of truth | Redis-only dashboard counters | PostgreSQL projections; Redis only for live queue coordination | Queue/cache state can disappear and must not redefine durable outcomes. |
| Replay idempotency | Client disable flags or random retries | Existing PostgreSQL locks, logical keys, revisions and outbox | Concurrency/crash recovery requires durable fencing. |
| Secret redaction after serialization | Regex over JSON/log strings | Field allowlisting before DTO construction | Regex misses nested/encoded/unexpected secret forms. |
| Consent lifecycle | Boolean on browser/local storage | Versioned server consent + separate associations + atomic withdrawal | Proof, race handling, withdrawal and retention audits require durable state. |
| Degradation simulation | Browser request stubbing | Deterministic database/circuit/quota seeds and real workers | Browser mocks skip the exact boundaries OPS-03 must validate. |

**Key insight:** This phase succeeds by projecting and verifying established durable contracts, not by creating new sources of truth.

## Common Pitfalls

### Pitfall 1: Mobile cards silently omit evidence
**What goes wrong:** The headline survives, but denominators, freshness, warnings or exact receipt access disappear.  
**Why it happens:** Desktop tables and mobile cards are implemented independently.  
**How to avoid:** Drive both from the same typed projection and add parity assertions for every required datum/action.  
**Warning signs:** Different fetch functions, mobile-only DTOs, or `display:none` around receipt/warning content.

### Pitfall 2: Expandable navigation traps or loses focus
**What goes wrong:** Escape/Tab behavior is unpredictable, the trigger lacks expanded state, or a sticky header obscures focus.  
**How to avoid:** Native button and links, deterministic focus order, visible focus, close on selection/Escape, and no obscured focus. WCAG 2.2 requires keyboard operation and at least partial focus visibility. [CITED: https://www.w3.org/TR/WCAG22/]

### Pitfall 3: Operator DTO leaks raw facts
**What goes wrong:** Returning route/source rows exposes `rawPayload`, free-text errors or environment-derived data.  
**How to avoid:** Select explicit columns and construct a closed DTO; add canary secrets to tests and recursively assert they never appear in API/DOM/trace attachments.  
**Warning signs:** `select: undefined`, object spreading Prisma rows, arbitrary `diagnostic` or `metadata` blobs.

### Pitfall 4: Retry mutates or duplicates historical facts
**What goes wrong:** A retry recomputes an issued forecast, overwrites a snapshot or duplicates canonical/result facts.  
**How to avoid:** Freeze exact logical identity, compare preview fingerprints at confirmation, and assert before/after immutable IDs/hashes/counts.  
**Warning signs:** update/upsert against issued snapshot payloads or queue jobs carrying mutable payloads instead of durable plan identity.

### Pitfall 5: Consent race
**What goes wrong:** A retention write commits after withdrawal because consent was checked earlier outside the transaction.  
**How to avoid:** Lock/read active consent and write the association in one transaction; withdrawal locks the subject boundary, revokes consent, deletes associations, and invalidates relevant cache.  
**Warning signs:** UI-only checks or separate uncoordinated API calls.

### Pitfall 6: “Anonymous” data remains linkable
**What goes wrong:** Correlation IDs, actor IDs, source labels, timestamps, logs or cache keys reconstruct personal activity.  
**How to avoid:** Publish an explicit data inventory and deletion matrix; forbid subject identifiers in immutable receipt tables and logging context; test erasure across database and cache.  
**Warning signs:** correlation IDs shared between user session telemetry and immutable odds/value facts.

### Pitfall 7: Green accessibility scan treated as completion
**What goes wrong:** Automated rules pass but keyboard sequence, chart meaning, responsive parity or error recovery is broken.  
**How to avoid:** Combine axe with keyboard-only journeys, 320px/200%-text overflow checks, semantic locator assertions and manual screen-reader/chart review. Playwright documents this limitation explicitly. [CITED: https://playwright.dev/docs/accessibility-testing]

### Pitfall 8: Degradation tests are dishonest
**What goes wrong:** A mocked response renders the right message while admission, circuit, quarantine or dead-letter state is broken.  
**How to avoid:** Seed real durable policy/state, invoke production services/workers, assert API and DOM, then query PostgreSQL invariants.

## Code Examples

### Closed operator projection

```ts
// Project pattern: explicit projection; never return sourceObservation.rawPayload.
const failedRuns = await database.syncRun.findMany({
  where: { state: "FAILED" },
  select: {
    id: true,
    provider: true,
    endpointFamily: true,
    correlationId: true,
    terminalAt: true,
    attempts: {
      orderBy: { attemptNumber: "desc" },
      take: 1,
      select: { classifiedReason: true },
    },
  },
});
```

The verbatim state `"FAILED"` is defined in `LedgerState`. [VERIFIED: packages/database/prisma/schema.prisma:44-50]

### Accessible asynchronous status

```tsx
// Source: WCAG status-message guidance
<p role={blocking ? "alert" : "status"} aria-live={blocking ? "assertive" : "polite"}>
  {message}
</p>
```

Status changes that do not move focus must be programmatically determinable to assistive technology. [CITED: https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html]

### Automated accessibility smoke

```ts
// Source: https://playwright.dev/docs/accessibility-testing
import AxeBuilder from "@axe-core/playwright";

const results = await new AxeBuilder({ page }).analyze();
expect(results.violations).toEqual([]);
```

### Mobile/desktop projects

```ts
// Source: https://playwright.dev/docs/emulation
projects: [
  { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
]
```

Playwright device profiles include viewport, screen size, user agent and touch behavior. [CITED: https://playwright.dev/docs/emulation]

## State of the Art

| Old / insufficient approach | Current approach | Impact for this phase |
|----------------------------|------------------|-----------------------|
| Desktop-first shrink-to-fit | Information-preserving reflow and responsive relocation | Cards may replace tables, but evidence and functionality cannot disappear. [CITED: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html] |
| Automated a11y scan as certification | Automated + keyboard/manual/inclusive assessment | Release gate needs both machine and behavioral criteria. [CITED: https://playwright.dev/docs/accessibility-testing] |
| Retry button directly requeues | Preview/fingerprint/explicit confirmation/audit | Existing replay pattern is the mandatory basis for every safe action. |
| Logs as operator UI | Structured, allowlisted, correlation-driven diagnostics | Prevents secret/raw-payload disclosure and produces stable acceptance contracts. |
| Consent inferred from use | Demonstrable explicit consent, easy withdrawal, storage limitation and erasure | Default retention must be off and withdrawal must be a tested deletion boundary. [CITED: https://eur-lex.europa.eu/eli/reg/2016/679/oj] |

**Deprecated/outdated:**
- A single desktop-only Playwright project is insufficient for UX-01; retain it but add a mobile project/scenarios.
- Page-wide fallback screens are incompatible with D-03; use block-local failure states.
- Direct rendering of raw payload/log JSON is incompatible with D-12.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | [ASSUMED] No authenticated user/account identity exists in v1, so consent may need a privacy-safe pseudonymous subject mechanism without implementing the deferred account feature. | Privacy architecture | A hidden identity mechanism may already exist outside inspected code and would change schema/API tasks. |
| A2 | [ASSUMED] A 30-second operator overview refresh is adequate; use manual refresh first if load or incident semantics are uncertain. | Operator UX | Too frequent polling can load the database; too slow can impair incident response. |
| A3 | [ASSUMED] Exact legal retention duration is not yet selected. The implementation should use a versioned policy value and fail closed, but planning must obtain product/legal approval before naming a duration. | Privacy | An invented duration would create a false compliance promise. |
| A4 | [ASSUMED] Chromium desktop plus Chromium mobile emulation is the minimum automated release matrix; additional WebKit/Firefox coverage depends on declared supported browsers. | Validation | Browser-specific issues could escape if support expectations are broader. |

## Resolved Questions

1. **RESOLVED — Consenting subject identity:** The exact subject mechanism remains intentionally unset behind the blocking D-14 checkpoint in Plan 06-06. Until an approved signed subject-provider input is supplied, durable opt-in fails closed; IP addresses, raw cookies, user agents, session/correlation IDs, source labels, and logs are never implicit identity.

2. **RESOLVED — Retention duration and policy version:** The legal duration and policy metadata remain intentionally unset behind the same D-14 checkpoint and versioned policy seam. No duration or version is invented. Missing approved duration, version, or effective date disables durable retention while ordinary anonymous analysis remains available.

3. **RESOLVED — Release browser matrix:** Phase 06 release support is desktop Chromium plus mobile Chromium emulation. Both projects are mandatory in `playwright.phase06.config.ts`; WebKit and Firefox are not release blockers unless the published support policy is expanded later.

4. **RESOLVED — Evaluation retry model:** Evaluation retry reuses the existing preview/confirm/audit recovery envelope. Its stable logical identity is `ResultVersion` + `ForecastSnapshot` + policy hash, with the same fingerprint, expiry, stale rejection, idempotency, quota-impact, and immutable-fact guarantees as ingestion replay.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | all workspace tasks | ⚠ | `25.2.1` | Install/use pinned Node 24; root engine is `>=24 <25`. [VERIFIED: package.json:6-9] |
| pnpm | workspace/test commands | ✓ | `10.34.5` | — |
| Docker CLI | production-like stack | ✓ CLI / ✗ daemon access | `29.7.2` CLI | Start/authorize Docker Desktop before release gate. |
| PostgreSQL 18 | durable release gate | Via Docker only | image `18.6-alpine` | No SQLite fallback. |
| Redis 8 | queues/degradation gate | Via Docker only | image `8.2.1-alpine` | No in-memory substitute for release gate. |

**Missing dependencies with no fallback:** Docker daemon access is currently denied; the production-like gate cannot execute until Docker Desktop/engine access is restored. Node 25 violates the repository engine constraint and must be switched to Node 24 before trusted verification.

**Missing dependencies with fallback:** none for the mandatory release gate.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.11`, Playwright `1.62.1`, real PostgreSQL/Redis harness |
| Config file | `vitest.config.ts`; extend `playwright.phase05.config.ts` or add `playwright.phase06.config.ts` |
| Quick run command | `pnpm exec vitest run --project unit --changed` (or targeted file command per task) |
| Full suite command | `pnpm test && pnpm test:integration && pnpm typecheck && pnpm build && pnpm exec playwright test -c playwright.phase06.config.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UX-01 | Four-destination nav; complete workflows at desktop/mobile; keyboard, focus, reflow, readable chart alternative | Playwright + axe + behavioral | `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/release-accessibility.spec.ts` | ❌ Wave 0 |
| UX-02 | Version/effective date/changelog; plain and technical layers; contextual warnings/receipt links | Unit + Playwright | `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/methodology.spec.ts` | ❌ Wave 0 |
| OPS-01 | Authorized safe overview; grouped failures/dead letters; readiness/provider/quota/data quality/correlation; secret canaries absent | Integration + Playwright | `pnpm exec vitest run --project integration tests/integration/operator-overview.test.ts` | ❌ Wave 0 |
| OPS-02 | Impact preview, reason, stale rejection, idempotent retry/replay, immutable before/after invariants | Integration + production E2E | `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-recovery.spec.ts` | ❌ Wave 0 (existing replay specs are a base) |
| OPS-03 | End-to-end lifecycle and all representative degradation states through real services | Production-boundary Playwright | `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/release-journey.spec.ts tests/e2e/release-degradation.spec.ts` | ❌ Wave 0 (Phase 5 live stack is a base) |
| PRIV-01 | No history without consent; proof/version on opt-in; withdrawal deletion/future deny; immutable non-personal facts unlinked | Integration + production E2E | `pnpm exec vitest run --project integration tests/integration/privacy-retention.test.ts` | ❌ Wave 0 |

### Release Degradation Matrix

| Scenario | Seed/trigger at real boundary | Required assertions |
|----------|-------------------------------|---------------------|
| Quota exhausted | Durable budget reservations/observations consume effective allowance | Provider call denied, local warning/reason shown, critical facts unchanged. |
| Circuit open | Durable `ProviderCircuitState.state = "OPEN"` with valid timing | No provider construction/call; safe circuit state shown. The value is verbatim. [VERIFIED: packages/database/prisma/schema.prisma:59-63,448-462] |
| Provider unavailable/no fallback | Execute sole-source UEL/UECL route failure | `LIMITED`/no-fallback state, last-valid timestamp retained, no zero substitution. |
| Quarantined payload | Feed a schema/identity-invalid provider envelope into production adapter | Quarantine/data-quality entry visible via safe metadata only; no canonical publication. |
| Stale/limited evidence | Seed exact old/insufficient evidence | Forecast/value/scorecard warnings remain local and honest. |
| Dead letter | Exhaust bounded real worker/replay attempts | Failed group includes classified reason/correlation/impact; no duplicate facts. |
| Safe replay | Preview then confirm reason through UI | Quota/scope/identity displayed; exact plan/correlation returned; immutable hashes/counts consistent. |

### Sampling Rate

- **Per task commit:** targeted Vitest or Playwright spec under 30 seconds where possible.
- **Per wave merge:** `pnpm test && pnpm test:integration && pnpm typecheck && pnpm build` plus the affected Phase 06 Playwright spec.
- **Phase gate:** full Phase 06 serial production-boundary suite green with both desktop and mobile projects; Docker resources owned and cleaned by exact identifiers.

### Wave 0 Gaps

- [ ] `tests/e2e/live-release-stack.ts` — owned PostgreSQL/Redis/API/worker/web lifecycle, extending Phase 5.
- [ ] `playwright.phase06.config.ts` — desktop/mobile projects, serial execution, traces and screenshots.
- [ ] `tests/e2e/release-accessibility.spec.ts` — navigation, keyboard, focus, reflow, parity and axe scans.
- [ ] `tests/e2e/release-journey.spec.ts` — fixture → forecast → odds → value → result → settlement → scorecard.
- [ ] `tests/e2e/release-degradation.spec.ts` — locked degradation matrix with real state.
- [ ] `tests/integration/operator-overview.test.ts` — grouping, authorization and recursive secret/payload absence.
- [ ] `tests/integration/privacy-retention.test.ts` — default deny, transactional consent, withdrawal and unlinkability.
- [ ] Framework install: `pnpm add -D @axe-core/playwright@4.13.0`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (operator only) | Existing signed gateway and constant-time `OperatorGuard`; do not expose internal routes directly. [VERIFIED: apps/api/src/modules/reconciliation/operator.guard.ts:9-29] |
| V3 Session Management | yes | Consent subject/session mechanism must be signed, scoped and revocable; never use correlation ID as identity. |
| V4 Access Control | yes | Deny-by-default operator guard, server-side actor validation, not-found response for unauthorized internal routes. |
| V5 Input Validation | yes | Closed DTOs, Nest whitelist/unknown-key rejection, bounded IDs/reasons, no arbitrary metadata/log query. [VERIFIED: apps/api/src/main.ts:20-28] |
| V6 Cryptography | yes | Existing HMAC/signed gateway and Node crypto; never hand-roll signatures or compare secrets as plain strings. |
| V7 Error Handling / Logging | yes | Generic external errors, structured safe reason codes, correlation IDs, no payload/token/personal-history logging. |
| V8 Data Protection | yes | Default no-retention, versioned consent, minimization, atomic erasure, cache/log deletion inventory. |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Operator route bypass | Elevation of privilege | Signed gateway + `OperatorGuard` on every internal controller; return 404 on denial. |
| Replay scope/preview tampering | Tampering | Server-normalized input, hashed preview version, expiry, PostgreSQL locks and stale rejection. |
| Secret/raw payload disclosure | Information disclosure | Closed selects/DTOs, canary-secret negative tests, no raw headers/payload/log body. |
| Correlation ID injection | Spoofing / log injection | Constrain charset and length before storage/display/copy; generate server ID otherwise. Current public middleware checks length only, so operator persistence needs stricter normalization. [VERIFIED: apps/api/src/main.ts:23-27] |
| Consent forgery or stale consent race | Spoofing / tampering | Signed subject identity and transactionally locked active consent at each history write. |
| Incomplete erasure via cache/logs | Information disclosure | Published data inventory, deletion matrix, cache invalidation and log minimization tests. |
| Resource exhaustion from overview polling | Denial of service | Pagination, bounded time window/group count, indexed queries, conservative/manual refresh. |
| Spreadsheet/HTML injection through source label/reason | Tampering / XSS | React escaping, strict length/character policies, no `dangerouslySetInnerHTML`, sanitize exported formats. |

OWASP guidance requires authorization decisions to be loggable while not logging sensitive data itself. [CITED: https://cornucopia.owasp.org/taxonomy/asvs-5.0/16-security-logging-and-error-handling/03-security-events]

## Sources

### Primary (HIGH confidence)

- `06-CONTEXT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `AGENTS.md` — locked scope and project constraints.
- `packages/database/prisma/schema.prisma` — immutable facts, replay ledger, circuit/quota/provider models and raw-payload boundary.
- `apps/api/src/modules/replay/replay.service.ts` and `apps/web/app/internal/pipeline/replay/page.tsx` — preview/confirm/stale/idempotency patterns.
- `apps/api/src/modules/health/health.controller.ts`, `apps/api/src/modules/reconciliation/operator.guard.ts`, `infra/docker-compose.operator.yml` — readiness and signed operator boundary.
- `tests/e2e/live-provider-stack.ts`, `playwright.phase05.config.ts`, existing workflow E2E specs — real production-boundary conventions.
- [WCAG 2.2 Recommendation](https://www.w3.org/TR/WCAG22/) — keyboard, focus, reflow, navigation and status requirements.
- [W3C Understanding Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) — 320 CSS pixel reflow and information/function preservation.
- [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing) — axe integration and limits of automation.
- [Playwright emulation](https://playwright.dev/docs/emulation) — device/project emulation.
- [GDPR official text on EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj) — consent proof/withdrawal, storage limitation, transparency and erasure.

### Secondary (MEDIUM confidence)

- [OWASP ASVS security logging taxonomy](https://cornucopia.owasp.org/taxonomy/asvs-5.0/16-security-logging-and-error-handling/03-security-events) — authorization logging without sensitive-data logging.
- [npm package page for `@axe-core/playwright`](https://www.npmjs.com/package/%40axe-core/playwright) — current registry version/download/source metadata, cross-checked with package-legitimacy seam.

### Tertiary (LOW confidence)

- None used as authoritative implementation guidance.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — primarily existing pinned packages; only axe is new and passed legitimacy plus official-doc confirmation.
- Architecture: HIGH — derived from locked decisions and opened source-of-truth modules/schema.
- Pitfalls: HIGH — tied to WCAG/Playwright/privacy primary sources and concrete repository boundaries.
- Privacy implementation identity/duration: MEDIUM — architecture is clear, but exact subject mechanism and retention duration require explicit product/legal decisions.

**Research date:** 2026-09-20  
**Valid until:** 2026-10-20 for codebase patterns; re-check legal/product retention decisions and package versions before execution.
