---
phase: 06-release-experience-and-operations
threats_open: 0
assessed: 2026-10-03T00:00:00Z
assessor: gsd-ship
---

# Phase 6: Release Experience and Operations — Security Assessment

**Phase Goal:** As a football analytics user or operator, I want to safely understand and verify the fixture-to-evaluation experience on supported devices and through failure states, so that I can trust results and operate the MVP responsibly.

## Threat Summary

All security threats identified during Phase 6 have been resolved. The phase introduces:

- Public user workflows (fixture discovery, analysis, manual odds, value comparison, performance scorecards)
- Operator workflows (readiness, provider health, failure inspection, replay, recovery)
- Privacy controls (consent, retention, withdrawal, data deletion)
- Methodology disclosure (model card, contextual warnings)

All boundaries are enforced through:
- `OperatorGuard` protecting operations endpoints
- HMAC-signed subject-provider assertions for privacy ingress
- Closed Prisma selects and scalar DTO constructors preventing secret leakage
- Fixed fragment-only methodology URLs preventing analytical state leakage
- Bounded recovery reasons (10-500 chars) with preview-confirm flow

No open threats remain.

## Resolved Threats

| Threat ID | Description | Resolution | Plan |
|-----------|-------------|------------|------|
| PRIV-01 | Retained personal history without consent boundary | One-way D-14 deletion boundary approved; retention purge scheduler with bounded timers; migration quarantine erased | 06-06 through 06-11 |
| OPS-01 | Secret leakage in operations UI | Closed scalar DTO constructors with explicit Prisma selects; HMAC-signed ingress | 06-02, 06-04 |
| UX-01 | Analytical state in methodology links | Fixed fragment-only URLs; no activity state in navigation | 06-03 |

All resolved threats have corresponding test coverage in integration and E2E suites.
