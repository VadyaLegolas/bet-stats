# Phase 6: Release Experience and Operations - Pattern Map

**Mapped:** 2026-09-20
**Files analyzed:** 24 likely new/modified files
**Analogs found:** 24 / 24

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/app/layout.tsx` | component / shell | request-response | `apps/web/app/layout.tsx` | exact, modify |
| `apps/web/components/release-navigation.tsx` | component | event-driven | `apps/web/app/layout.tsx` | role-match |
| `apps/web/components/responsive-evidence.tsx` | component | transform | `apps/web/app/scorecards/scorecard-dashboard.tsx` | role/data-flow match |
| `apps/web/components/local-data-block.tsx` | component | request-response | `apps/web/components/provider-state-notice.tsx` | exact vocabulary match |
| `apps/web/app/scorecards/scorecard-dashboard.tsx` | component | transform | same file | exact, modify |
| `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` | component | event-driven / request-response | `apps/web/app/scorecards/scorecard-dashboard.tsx`; existing workbench | role-match |
| `packages/domain/src/methodology/model-card.ts` | config / model | transform | `packages/domain/src/forecast/config.ts` | role-match |
| `apps/web/app/methodology/page.tsx` | component / route | request-response | `apps/web/app/scorecards/scorecard-dashboard.tsx` | role-match |
| `apps/web/components/contextual-methodology-warning.tsx` | component | transform | `apps/web/components/risk-disclosure.tsx` | exact role-match |
| `apps/api/src/modules/operations/operations.controller.ts` | controller | request-response | `apps/api/src/modules/replay/replay.controller.ts` | exact role-match |
| `apps/api/src/modules/operations/operations.service.ts` | service | CRUD / batch projection | `apps/api/src/modules/health/health.controller.ts`; `replay.service.ts` | data-flow match |
| `apps/api/src/modules/operations/operations.module.ts` | config / module | request-response | `apps/api/src/modules/odds/odds.module.ts` | exact role-match |
| `apps/web/app/internal-api/operations/[[...path]]/route.ts` | route / proxy | request-response | `apps/web/app/internal-api/pipeline/replay/[[...path]]/route.ts` | exact |
| `apps/web/app/internal/operations/page.tsx` | component / route | request-response / event-driven | `apps/web/app/internal/pipeline/replay/page.tsx` | exact role/data-flow match |
| `apps/api/src/modules/replay/replay.service.ts` | service | event-driven / pub-sub | same file | exact, extend |
| `apps/web/app/internal/pipeline/replay/page.tsx` | component | event-driven | same file | exact, extend |
| `packages/domain/src/privacy/retention.ts` | model / policy | transform | `packages/domain/src/forecast/config.ts`; odds validation | role-match |
| `packages/database/prisma/schema.prisma` + migration | model / migration | CRUD | immutable odds/value models in same schema | exact boundary, modify |
| `apps/api/src/modules/privacy/privacy.service.ts` | service | transactional CRUD | `apps/api/src/modules/odds/odds.service.ts` | exact persistence style |
| `apps/api/src/modules/privacy/privacy.controller.ts` | controller | request-response | `apps/api/src/modules/replay/replay.controller.ts` | exact role-match |
| `apps/web/app/privacy/page.tsx` (or privacy panel component) | component / route | event-driven | replay preview/confirm page | interaction match |
| `tests/e2e/live-release-stack.ts` | test harness | batch / event-driven | `tests/e2e/live-provider-stack.ts` | exact |
| `playwright.phase06.config.ts` | test config | batch | `playwright.phase05.config.ts` | exact |
| `tests/e2e/release-*.spec.ts`, `tests/integration/{operator-overview,privacy-retention}.test.ts` | tests | request-response / event-driven | provider degradation, replay boundary, pipeline replay specs | exact scenarios |

## Pattern Assignments

### Responsive shell, navigation, and evidence components

**Primary analogs:** `apps/web/app/layout.tsx:10-28`, `apps/web/app/scorecards/scorecard-dashboard.tsx:24-46`, `apps/web/components/analytics-shell.tsx:19-42`.

Preserve the existing landmark and 1200px frame, persistent footer risk copy, and protected analytics boundary:

```tsx
<header>...<nav aria-label="Primary navigation">...</nav></header>
<main style={{ width: "100%", maxWidth: 1200, ... }}>{children}</main>
<footer>Football data and analytical information only...</footer>
```

`release-navigation.tsx` should replace the one-link navigation at `layout.tsx:15-21`, not add a second navigation. Use one ordered link model for Fixtures, Analysis, Results, Methodology and render native links in both desktop and mobile disclosures. The mobile trigger is a native button with `aria-expanded`/`aria-controls`; keep DOM order equal to visual order and add the skip link before the header.

The reusable evidence projection should follow the scorecard's typed-view-model pattern (`scorecard-dashboard.tsx:3-14`) and its evidence hierarchy (`:34-46`): conclusion and denominators first, full table/receipts second. Both desktop table and mobile card must receive the same typed projection. Reuse native `<details>` for `Complete evidence`, following the receipt disclosure at `:46`; never calculate/fetch a separate mobile model.

Keep `AnalyticsShell`'s fail-closed eligibility decision and persistent disclosure (`analytics-shell.tsx:19-42`). Do not make navigation or layout state alter eligibility, receipt identity, or analytical data.

### Local degraded-state components

**Analogs:** `provider-state-notice.tsx:1-8`, `evidence-state-notice.tsx:7-19`, `data-state-notice.tsx:1-5`, `internal/reconciliation/page.tsx:8-15`.

Copy the established closed state unions, reviewed state-to-copy map, semantic `status`/`alert`, exact timestamps, and server-controlled `retryAllowed`:

```tsx
const blocking = ["UNAVAILABLE", "LIMITED", "UNSUPPORTED"].includes(state.state);
<aside role={blocking ? "alert" : "status"}>
  <strong>{headings[state.state]}</strong>
  {state.lastValidAt && <time dateTime={state.lastValidAt}>{state.lastValidAt}</time>}
  {state.retryAllowed && <button type="button">Check provider coverage again</button>}
</aside>
```

Extend this vocabulary to `loading | available | limited | stale | unavailable | retrying`, retaining prior valid content during refresh. The reconciliation page demonstrates block-local retry: its failed suggestion block keeps the rest of the review workspace usable (`internal/reconciliation/page.tsx:15`). Do not copy that page's raw snapshot rendering into operations; Phase 06 operator DTOs explicitly forbid it.

### Methodology content and versioning

**Analogs:** `packages/domain/src/forecast/config.ts:3-18`, `packages/database/prisma/schema.prisma:603-635`, `scorecard-dashboard.tsx:38-46`, `risk-disclosure.tsx:1-12`.

Define methodology as a frozen, source-controlled domain object, matching the versioned config convention:

```ts
export const MODEL_CARD = Object.freeze({
  version: "model-card-v1" as const,
  effectiveDate: "...",
  sections: Object.freeze(...),
  changes: Object.freeze(...),
});
```

Technical details must bind to the actual receipt identifiers already persisted on `ForecastSnapshot`—`modelVersion`, `modelHash`, `configVersion`, `configHash`, `inputHash`, `evidenceFingerprint` (`schema.prisma:603-623`)—and to scorecard formula/policy IDs (`scorecard-dashboard.tsx:46`). Render the fixed section order with a visible primary explanation and nested native `<details><summary>Technical details</summary>`. Reuse `RiskDisclosure`'s accessible aside pattern and link contextual forecast/value/scorecard warnings to stable methodology fragments without personal query parameters.

### Operator overview API and UI

**Analogs:** `health.controller.ts:7-29`, `operator.guard.ts:8-30`, `replay.controller.ts:6-21`, replay internal proxy `route.ts:5-21`.

Controllers must stay behind `@UseGuards(OperatorGuard)`, return `private, no-store`, and use the not-found denial boundary:

```ts
@Controller("internal/operations")
@UseGuards(OperatorGuard)
export class OperationsController {
  @Get("overview")
  @Header("Cache-Control", "private, no-store")
  overview() { return this.operations.overview(); }
}
```

Follow `projectHealth` (`health.controller.ts:7-13`): explicitly construct a closed DTO rather than serialize Prisma rows. Every database query should use `select` with only safe scalar fields. Group failures by reviewed `classifiedReason` and impact, and expose bounded correlation IDs, timestamps, counts, retryability, provider/circuit/quota state, and logical identities only. Never project `rawPayload`, headers, arbitrary evidence/metadata, stack traces, environment values, or free-form logs.

The Next proxy should copy the replay proxy exactly: verify a signed ingress request, inject server-held operator credential and normalized actor, use `cache: "no-store"`, and return 404 when disabled/unauthorized (`route.ts:7-21`). Generalize the verifier carefully; retain its NFKC subject normalization, strict allowlist, timestamp window, HMAC canonical path/query, and timing-safe comparison (`operator-proxy-authorization.ts:8-49`).

The operator page should follow the replay page's typed client state and no-store fetch (`replay/page.tsx:34-49`), but render independent local blocks in the required order. Use the scorecard's exact-denominator and receipt disclosure patterns for quota and failure groups. Pagination URLs should be canonical `URLSearchParams`, as in `scorecard-dashboard.tsx:16-20`.

### Safe failure retry/replay

**Analogs:** `apps/api/src/modules/replay/replay.service.ts:57-169`, `apps/web/app/internal/pipeline/replay/page.tsx:51-88`.

Use the existing command envelope rather than a direct retry button:

1. Normalize and allowlist scope (`replay.service.ts:57-64`).
2. Build deterministic logical IDs (`:66-72`).
3. Persist a preview under a PostgreSQL advisory lock and fingerprint normalized input/policy (`:102-120`).
4. On confirmation, re-lock, compare preview version/expiry/current policy, and reject stale previews (`:122-149`).
5. Converge duplicates and create durable plan/run/delivery rows transactionally (`:139-166`).
6. Dispatch after commit and report immutable guarantees (`:168-169`).

The UI analog already preserves input, moves focus back to preview on stale 409, blocks double submission, shows quota/headroom and immutable effects, confirms explicitly, and reports durable plan/correlation identity (`replay/page.tsx:51-88`). Strengthen it to the UI contract: reason 10–500 chars for every recovery, real modal focus trap/restore, preview expiry, exact logical identity, and copy buttons. Evaluation retry may share the envelope, but its frozen identity must be `ResultVersion + ForecastSnapshot + policy hash`.

### Consent, withdrawal, and persistence boundary

**Analogs:** immutable schema at `schema.prisma:651-706`; validation/idempotent append at `odds.service.ts:29-67,81-113`.

Do not add subject/session/correlation fields to `ManualOddsSnapshot`, `ValueReceipt`, `ForecastSnapshot`, settlement, or model receipt rows. Those are immutable analytical facts. Add separate versioned consent and subject-to-history association models; association rows may reference immutable fact IDs but must be deletable without updating those facts.

Copy the odds service's boundary discipline: reject unknown keys (`odds.service.ts:29-37`), normalize before hashing (`:44-67`), use explicit DTOs rather than Prisma models (`:10-20,70-78`), and transact durable writes (`:92-112`). A history association write must lock/read active consent and insert in the same transaction. Withdrawal must lock the same subject boundary, record withdrawal, delete all personal association/history rows, and invalidate related cache atomically; partial deletion is an error, never success.

Fail closed when approved subject identity, retention duration, policy version, or effective date is absent. Browser/local storage may hold incomplete drafts but is not proof of durable consent. Validate that bookmaker `sourceLabel` cannot be repurposed as a personal identifier, and do not use IP, user agent, session/correlation ID, or logs as an implicit association.

### Production-like release gates

**Analogs:** `playwright.phase05.config.ts:3-17`, `tests/e2e/live-provider-stack.ts:21-45,48-124`, `provider-degradation.spec.ts:4-36`, replay boundary integration tests around production proxy/worker at `tests/integration/replay-boundary.test.ts:348-400,524-568`.

Extend the owned-stack harness pattern:

```ts
const suffix = `${process.pid}-${Date.now()}`;
docker("run", "-d", "--name", pg, ... "postgres:18-alpine");
docker("run", "-d", "--name", redis, ... "redis:8-alpine");
// migrate, seed deterministic facts, start real worker, Nest API, built Next app
```

Retain unique owned container names, dynamic host ports, Prisma migrations, deterministic data, real BullMQ worker, real Nest/Next processes, readiness polling, redacted child output, and exact cleanup (`live-provider-stack.ts:21-45,122-124`). Do not use `page.route` in Phase 06 release-gate specs.

Copy Phase 5's serial settings (`fullyParallel: false`, `workers: 1`, failure trace/screenshot), then add desktop and mobile projects:

```ts
projects: [
  { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
]
```

`release-journey.spec.ts` should drive fixture → forecast → manual odds → value → result → settlement → scorecard through browser/API/worker/database boundaries and compare immutable IDs/hashes/counts. `release-degradation.spec.ts` should seed real quota, circuit, provider, quarantine, stale/limited, and dead-letter state; Phase 5 already demonstrates narrow 320px/forced-colors checks (`provider-degradation.spec.ts:30-36`) and durable policy seeding before provider construction (`replay-boundary.test.ts:524-568`). `release-accessibility.spec.ts` adds axe plus explicit keyboard/focus/menu/dialog/reflow/chart-alternative checks; axe alone is not the gate.

## Shared Patterns

### Authorization and secret safety

**Source:** `operator.guard.ts:13-29`, operator proxy authorization `:32-49`.

Apply the signed gateway + constant-time guard to every internal operations/recovery endpoint. Unauthorized routes return the established 404. Validate actor/correlation identifiers against a strict bounded character set. Test recursive absence of seeded canary credentials, raw payloads, URLs, headers and exception strings in API JSON, DOM, traces and screenshots.

### Immutable identities and PostgreSQL ownership

**Source:** `replay.service.ts:109-169`, `schema.prisma:603-706`, `odds.service.ts:92-112`.

PostgreSQL owns previews, plans, consent, associations, immutable receipts, and idempotency. Redis/BullMQ coordinates delivery only. New recovery and privacy mutations require one transaction, stable logical keys, explicit conflict/stale outcomes, and append/delete-boundary semantics rather than rewriting issued snapshots.

### Error and asynchronous state

**Source:** `evidence-state-notice.tsx:7-19`, `replay/page.tsx:61-75,85-88`.

Use reviewed error codes server-side and plain English UI mapping. Nonblocking progress/success uses `role="status"`; blocking failures use `role="alert"`. Preserve prior valid content, disable only the local pending action, and restore/move focus only when the user's next action would otherwise be unclear.

### Validation

**Source:** `odds.service.ts:29-67`, `replay.service.ts:57-64`.

Use closed request keys, strict enum/identity allowlists, normalized strings, explicit UTC instants, bounded windows/reasons and server recomputation. Do not accept generic metadata, raw diagnostic queries, or client-asserted immutable/quota effects.

## No Analog Found

No likely Phase 06 file is without a usable in-repository analog. The consent schema itself is new domain behavior, but its separation from immutable facts, transactional persistence, strict DTO validation, and idempotency all have strong local precedents. Use `06-RESEARCH.md` and `06-UI-SPEC.md` for the still-unresolved legal/product inputs (subject mechanism and retention duration); implementation must fail closed rather than invent them.

## Metadata

**Analog search scope:** `apps/web`, `apps/api`, `packages/domain`, `packages/database`, `tests/e2e`, `tests/integration`, `infra`
**Strong analogs read:** responsive shell/scorecard/state notices; replay UI/controller/service/proxy/guard; immutable odds/value schema and service; Phase 5 live stack/config/degradation tests
**Pattern extraction date:** 2026-09-20
