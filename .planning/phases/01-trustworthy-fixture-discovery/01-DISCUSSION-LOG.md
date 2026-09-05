# Phase 1: Trustworthy Fixture Discovery - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-27
**Phase:** 1-Trustworthy Fixture Discovery
**Areas discussed:** Initial competition and fixture browsing, Access policy, Canonical fixture identity, Data quality states, Ambiguity review

---

## Initial Competition and Fixture Browsing

| Option | Description | Selected |
|--------|-------------|----------|
| Premier League vertical slice | Verify one football-data.org competition end to end with dashboard and detail | ✓ |
| All top-five leagues immediately | Configure and validate several competitions in the first slice | |
| Champions League first | Start with a UEFA competition rather than a domestic league | |

**User's choice:** Auto-selected Premier League vertical slice.
**Notes:** Recommended because it minimizes provider and identity variables while proving the complete canonical fixture path.

---

## Access Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Deny by default with explicit region allowlist | Server grants betting analytics only to configured regions after 18+ acknowledgement | ✓ |
| Infer from browser locale | Locale grants access unless blocked | |
| Show disclaimer only | No server-side eligibility gate | |

**User's choice:** Auto-selected deny-by-default allowlist.
**Notes:** Locale/IP may inform the decision but cannot silently grant access; no behavioral history is stored in Phase 1.

---

## Canonical Fixture Identity

| Option | Description | Selected |
|--------|-------------|----------|
| Conservative candidate-and-review flow | Exact refs resolve; fuzzy/date rules propose candidates and quarantine ambiguity | ✓ |
| Auto-merge above fuzzy threshold | Automatically attach any candidate above one similarity threshold | |
| Provider-specific entities only | Defer canonical identity until fallback providers are added | |

**User's choice:** Auto-selected conservative candidate-and-review flow.
**Notes:** The ±36-hour window generates candidates and is not a uniqueness constraint. Proven provider lineage preserves identity through postponements.

---

## Data Quality States

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit typed states with provenance | AVAILABLE/LIMITED/STALE/UNSUPPORTED/UNRESOLVED plus source and time | ✓ |
| Single warning banner | Collapse all degradation into one generic message | |
| Hide unavailable fields | Omit missing information without explaining why | |

**User's choice:** Auto-selected explicit typed states.
**Notes:** Missing values remain absent, never zero; unresolved identity blocks forecasting.

---

## Ambiguity Review

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal protected review queue with append-only audit | Internal candidate review with approve/reject/correct actions | ✓ |
| Database-only manual fixes | Operators edit records directly without a review workflow | |
| Full user/role management | Build authentication and RBAC in Phase 1 | |

**User's choice:** Auto-selected minimal protected review queue.
**Notes:** A server-side operator credential is a temporary access mechanism until accounts/RBAC are deliberately scoped.

## the agent's Discretion

- Visual styling within accessibility constraints.
- Exact configurable fuzzy thresholds and health/error response shapes.
- Package-level implementation details consistent with the locked stack.
- Development seed and provider-stub details.

## Deferred Ideas

- Forecasting and value analysis remain Phase 3.
- Historical features and resilience pipeline remain Phase 2.
- Multi-provider fallback and enrichment remain Phase 5.
- Full accounts/RBAC and saved user history remain v2.

