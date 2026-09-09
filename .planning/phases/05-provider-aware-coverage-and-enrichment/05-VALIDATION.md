# Phase 05: Provider-Aware Coverage and Enrichment - Validation Contract

**Validated scope:** PROV-01 through PROV-07
**Default-suite rule:** all required CI evidence is deterministic and credential-free. Live provider probes are opt-in manual approval gates and are never prerequisites for `test`, `test:integration`, or `test:e2e`.

## Validation Layers

| Layer | Purpose | External credentials | CI disposition |
|-------|---------|----------------------|----------------|
| Unit contract tests | Provider-neutral schemas, route policy, comparison arithmetic/state, safe UI projections | Forbidden | Required |
| PostgreSQL integration tests | Append-only receipts, atomic admission, canonical identity, fallback/degradation and security boundaries | Forbidden; injected fetch and recorded redacted fixtures only | Required |
| Playwright acceptance | User-visible limited/stale/pending states, immutable pair selection, reconciliation boundaries and accessibility | Forbidden; deterministic Nest/Next test mode | Required |
| Credentialed provider probe | Confirm account-specific quota/reset headers and competition-season capability metadata | Required, operator supplied | Manual opt-in; never part of deterministic CI |

## Wave 0 Test Inventory

The phase plans own creation of the following missing test artifacts before or alongside their first implementation tracer. Existing files such as `tests/unit/provider-contract.test.ts`, `tests/integration/forecast-snapshots.test.ts`, and `tests/e2e/reconciliation-review.spec.ts` are extended rather than duplicated.

| File | Primary coverage | Planned in |
|------|------------------|------------|
| `tests/unit/provider-contract.test.ts` | Provider-neutral round trip, request-bound validation, provider IDs excluded from canonical authority | 05-01 |
| `tests/integration/api-football-provider.test.ts` | Strict `/leagues`, `/fixtures`, `/standings`, `/teams` envelopes; 429/5xx/malformed redaction | 05-01 |
| `tests/unit/provider-policy-probe.test.ts` | Opt-in/non-production refusal, redacted pending artifact schema, unknown/disagreement fail-closed behavior | 05-01 |
| `tests/integration/provider-routing.test.ts` | Versioned route receipts, primary/sole-source policy, admission and append-only attempts | 05-02, 05-03 |
| `tests/integration/provider-policy-approval.test.ts` | Authenticated approval boundary, exact-scope versioning, stale/mismatched/unknown rejection | 05-02 |
| `tests/integration/provider-fallback-identity.test.ts` | Exact-ref-first fallback, held-out kickoff drift, ambiguity quarantine, canonical ID stability | 05-03 |
| `tests/integration/enrichment-admission.test.ts` | Capability/circuit/budget ordering, protected headroom, official lineup and cutoff rules | 05-04 |
| `tests/integration/provider-state-api.test.ts` | Safe limited/stale/unavailable/pending provider projections | 05-05 |
| `tests/unit/provider-state-ui.test.tsx` | Written reasons, provider/time labels, retry state and accessibility semantics | 05-05 |
| `tests/e2e/provider-degradation.spec.ts` | No-fallback UEL/UECL flow and deterministic provider degradation UI | 05-05, 05-08 |
| `tests/unit/forecast-comparison.test.ts` | Exact same-fixture pair and deterministic semantic deltas | 05-06 |
| `tests/integration/forecast-comparison-api.test.ts` | Issued-state/fixture validation and explicit absent-kind reasons | 05-06 |
| `tests/unit/forecast-comparison-ui.test.tsx` | Stable URL selectors, semantic delta rendering and no implicit substitution | 05-07 |
| `tests/e2e/forecast-comparison.spec.ts` | Keyboard/accessibility/responsive exact-pair workflow | 05-07, 05-08 |
| `tests/integration/thesportsdb-boundary.test.ts` | Suggestion-only DTO, no auto-approval/evidence authority, safe logo boundary | 05-08 |
| `tests/integration/phase-05-security.test.ts` | Secret redaction, hostile payloads, SSRF, quota exhaustion and identity poisoning | 05-08 |

## Requirements to Evidence Map

| Requirement | Deterministic evidence | Required adversarial/held-out cases |
|-------------|------------------------|-------------------------------------|
| PROV-01 | `provider-routing.test.ts`, `provider-contract.test.ts` | Top-five/UCL select football-data.org first; an ineligible failure never falls through. |
| PROV-02 | `provider-fallback-identity.test.ts` | Existing canonical fixture/team IDs survive API-Football fallback; unknown external refs, reversed teams, zero candidates and multiple candidates publish nothing. |
| PROV-03 | `api-football-provider.test.ts`, `provider-routing.test.ts` | UEL/UECL select API-Football only from approved exact season mappings; stale/mismatched metadata is denied. |
| PROV-04 | `provider-state-api.test.ts`, `provider-degradation.spec.ts` | Sole-source 429/5xx/circuit/quota/unknown-reset outcomes show limited data; last-valid data remains timestamped and explicitly stale. |
| PROV-05 | `enrichment-admission.test.ts`, `forecast-snapshots.test.ts` | Missing/expired/mismatched capability, protected headroom, open circuit, reservation race, unconfirmed/wrong-fixture/late lineup all prevent optional I/O or snapshot issuance. |
| PROV-06 | `forecast-comparison.test.ts`, `forecast-comparison-api.test.ts`, `forecast-comparison.spec.ts` | Cross-fixture, missing and non-issued IDs fail safely; zero/one/two/three snapshot matrices retain exact selection and explicit absence reasons. |
| PROV-07 | `thesportsdb-boundary.test.ts`, `reconciliation-review.spec.ts`, `phase-05-security.test.ts` | Suggestion payload cannot carry match evidence or submit a decision; conflicts preserve append-only history; malicious logo URLs/redirects/content fail closed. |

## Held-Out Provider Degradation Matrix

At least one fixture per matrix row must be reserved for the final Phase 05 acceptance suite and must not be reused as an implementation happy-path fixture.

| Scenario | Expected route outcome | Durable/user-visible assertion |
|----------|------------------------|--------------------------------|
| football-data.org transient 5xx; API-Football exact capability and identity available | One classified fallback | Same canonical IDs; both attempts and exact receipts remain append-only. |
| football-data.org malformed/request-mismatched payload | Quarantine, no fallback | Payload cannot acquire authority; safe error and no canonical insert/update. |
| API-Football unavailable for UEL/UECL | No fallback | `limited` with provider/reason/time; last-valid data is stale, never current. |
| Optional endpoint capability absent/expired/mismatched | Denied before network I/O | Explicit capability reason and zero optional-call reservation/call count. |
| Hard/soft limit unknown, malformed, exhausted, or metadata disagrees | Provider/endpoint-local denial | Capacity is never widened; deterministic suite remains green for unrelated routes. |
| Circuit open, then concurrent half-open workers | One leased probe | Other calls are denied/deferred; no retry fan-out. |
| Fallback fixture kickoff within window with one exact participant pair | Reconciled candidate | Existing canonical fixture ID retained and new external ref/provenance appended. |
| Kickoff outside window, reversed participants, or two candidates within window | Ambiguous/unresolved | Review case created/reused; publication and forecasting blocked. |
| Primary recovery after accepted fallback | Append new primary observation | Fallback receipt/fact history unchanged; deterministic freshness selects current projection. |

## Exact Commands

Run from the repository root under the required Node 24 runtime.

### Per-task quick checks

```powershell
corepack pnpm exec vitest run tests/unit/provider-contract.test.ts --project unit
corepack pnpm exec vitest run tests/integration/api-football-provider.test.ts --project integration
corepack pnpm exec vitest run tests/unit/provider-policy-probe.test.ts --project unit
corepack pnpm exec vitest run tests/integration/provider-policy-approval.test.ts --project integration
corepack pnpm exec vitest run tests/integration/provider-routing.test.ts tests/integration/provider-fallback-identity.test.ts --project integration
corepack pnpm exec vitest run tests/integration/enrichment-admission.test.ts tests/integration/forecast-snapshots.test.ts --project integration
corepack pnpm exec vitest run tests/unit/provider-state-ui.test.tsx --project unit
corepack pnpm exec vitest run tests/unit/forecast-comparison.test.ts tests/unit/forecast-comparison-ui.test.tsx --project unit
corepack pnpm exec vitest run tests/integration/provider-state-api.test.ts tests/integration/forecast-comparison-api.test.ts --project integration
corepack pnpm exec vitest run tests/integration/thesportsdb-boundary.test.ts tests/integration/phase-05-security.test.ts --project integration
```

### Wave and phase gates

```powershell
corepack pnpm test
corepack pnpm test:integration
corepack pnpm test:e2e -- tests/e2e/provider-degradation.spec.ts tests/e2e/forecast-comparison.spec.ts tests/e2e/reconciliation-review.spec.ts --project=chromium
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

The root scripts above are the source of truth: `test` selects the Vitest `unit` project, `test:integration` selects `integration`, and `test:e2e` invokes Playwright. Do not place the live probe inside any of these scripts.

## Credentialed Probe and Approval Artifact

The implementation must expose a separate operator command (exact script name to be added by the implementing plan) that requires both an explicit opt-in flag and provider credentials. It must refuse production mode and must never print or persist keys, authorization headers, raw provider payloads, account identifiers, or non-allowlisted response headers.

The probe writes a local, redacted candidate artifact at:

`artifacts/provider-probes/phase-05-provider-policy.candidate.json`

The directory must be gitignored. The artifact is not configuration and has no runtime authority until reviewed and transformed by an authenticated operator into versioned capability/route-policy records through the normal application boundary.

Minimum artifact shape (field names are a planning contract; values shown are placeholders, not provider facts):

```json
{
  "schemaVersion": 1,
  "environment": "non-production",
  "capturedAt": "<UTC instant>",
  "provider": "<closed provider code>",
  "endpoint": "<closed endpoint family>",
  "requestFingerprint": "<non-secret hash>",
  "quota": {
    "limit": null,
    "remaining": null,
    "resetAt": null,
    "status": "unknown"
  },
  "coverage": [],
  "disagreements": [],
  "redaction": {
    "credentialsPersisted": false,
    "rawHeadersPersisted": false,
    "rawPayloadPersisted": false
  },
  "approval": {
    "status": "pending",
    "approvedBy": null,
    "approvedAt": null,
    "policyVersion": null
  }
}
```

Approval rules:

- Missing credentials produce no network call and no approved artifact.
- Unknown reset semantics keep `quota.status` as `unknown`; they must not be converted to midnight UTC or any guessed reset.
- Provider metadata that disagrees with configured competition, season, endpoint, account allowance, or request identity is listed in `disagreements` and blocks approval for that exact provider/endpoint scope.
- Numeric competition IDs, quotas, coverage flags and reset instants may enter versioned policy only when present in a request-bound probe receipt and explicitly approved; none are copied into tests as universal deployment facts.
- Probe failure is reported as a manual gate failure, not as a deterministic CI failure. Runtime admission still fails closed for the affected scope while unrelated deterministic routes remain testable.

## Completion Gate

Phase 05 validation is complete only when:

1. Every PROV-01…PROV-07 row has deterministic automated evidence.
2. The held-out degradation and canonical-identity matrix passes without external credentials.
3. The three Playwright flows run against the production Nest/Next boundaries in deterministic mode.
4. Security tests prove secret/header redaction, SSRF defenses, suggestion non-authority and exact snapshot identity.
5. Any deployment that enables a live provider has a separately approved, redacted probe artifact; deployments without that approval keep only the affected provider/endpoint disabled or limited.
