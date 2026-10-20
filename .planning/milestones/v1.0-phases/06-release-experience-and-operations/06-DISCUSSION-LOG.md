# Phase 6: Release Experience and Operations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-20
**Phase:** 06-release-experience-and-operations
**Areas discussed:** Release user experience, Methodology and model card, Operator center, Privacy and release verification

---

## Release user experience

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Primary navigation | Unified top navigation; fixture-first guided journey; hybrid | Unified top navigation |
| Mobile navigation | Expandable menu; bottom navigation; scrolling tabs | Expandable menu |
| Dense mobile data | Expandable cards; horizontal scrolling; reduced tables | Expandable cards |
| Partial failures | Local warnings while preserving data; whole-page failure; silent retries | Local warnings while preserving data |

**User's choice:** Selected the recommended option for all four questions.
**Notes:** Navigation includes Fixtures, Analysis, Results, and Methodology. Local failures disclose reason, freshness, and retry.

---

## Methodology and model card

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Page structure | Summary plus expandable sections; one long document; separate pages | Summary plus expandable sections |
| Versioning | Current version plus changelog; current only; full page archive | Current version plus changelog |
| Technical depth | Two layers; accessible-only; specialist-only | Two layers |
| Warning placement | Model card and result surfaces; model card only; results only | Model card and result surfaces |

**User's choice:** Selected the recommended option for all four questions.
**Notes:** Technical details include formulas, thresholds, policy versions, and receipt references.

---

## Operator center

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Landing page | Health overview with drill-down; event list; separate pages | Health overview with drill-down |
| Failure grouping | Root cause and impact; individual jobs; queue only | Root cause and impact |
| Recovery action | Preview and confirmation; one-click; CLI-only | Preview and confirmation |
| Diagnostic detail | Safe structured fields; short error only; full logs | Safe structured fields |

**User's choice:** Selected the recommended option for all four questions.
**Notes:** Raw payloads and secrets remain excluded; correlation identifiers are copyable.

---

## Privacy and release verification

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| History retention | No retention by default; consent on first use; default retention with opt-out | No retention by default |
| Consent withdrawal | Delete history; preserve old history; record selection | Delete history |
| Release journey | Production-like E2E; service integration only; mocked browser flow | Production-like E2E |
| Degradation coverage | Representative failure matrix; provider outage only; health checks only | Representative failure matrix |

**User's choice:** Selected the recommended option for all four questions.
**Notes:** The E2E path uses real PostgreSQL, Redis, API, worker, and web boundaries without network interception.

## the agent's Discretion

- Responsive breakpoints, visual tokens, chart mechanics, diagnostic grouping thresholds, and deterministic release fixtures remain implementation choices within the recorded constraints.

## Deferred Ideas

- None.
