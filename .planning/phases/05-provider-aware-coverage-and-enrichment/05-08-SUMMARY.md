---
phase: 05-provider-aware-coverage-and-enrichment
plan: 08
subsystem: provider-enrichment
tags: [thesportsdb, reconciliation, ssrf, media-validation, playwright]
requires:
  - phase: 05-03
    provides: append-only optimistic reconciliation workflow
  - phase: 05-04
    provides: provider-aware coverage routing
  - phase: 05-07
    provides: internal review UI patterns
provides:
  - Strict review-only TheSportsDB name, alias and logo-candidate projection
  - Separate operator suggestion panel that cannot submit identity decisions
  - SSRF-resistant logo validation with opaque validated references and explicit placeholders
affects: [reconciliation-review, provider-enrichment, media-http-boundary]
actuals: {tokens: 9200, tasks: 2, commits: 5}
tech-stack:
  added: []
  patterns: [review-only provider DTO, injected fetch boundary, redirect revalidation, opaque media reference]
key-files:
  created: [packages/football-data/src/providers/thesportsdb/client.ts, apps/api/src/modules/media/provider-logo.service.ts, tests/integration/thesportsdb-boundary.test.ts]
  modified: [apps/api/src/modules/reconciliation/reconciliation.service.ts, apps/api/src/modules/reconciliation/reconciliation.controller.ts, apps/web/app/internal/reconciliation/page.tsx, tests/e2e/reconciliation-review.spec.ts, playwright.config.ts]
key-decisions:
  - "Phase 05: TheSportsDB data is projected into a structurally review-only DTO containing provenance, names, aliases and a logo candidate; match evidence cannot cross this boundary."
  - "Phase 05: Provider logos become browser-visible only as opaque validated references after HTTPS host, DNS/IP, redirect, MIME, byte-size and signature checks."
requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06, PROV-07]
duration: 34min
completed: 2026-09-13
status: complete
---

# Phase 05 Plan 08: Review-only TheSportsDB Enrichment Summary

**TheSportsDB now supplies bounded, provenance-bearing review aids without becoming production match evidence, while candidate logos cross a hardened server validation boundary and reach the browser only as opaque references.**

## Accomplishments

- Added a strict suggestion client with injected transport, timeout, bounded projection, and sanitized failures.
- Added an administrator-only suggestion endpoint and a separate UI panel with loading, empty, retry, provenance, and “Use as review input” behavior.
- Preserved append-only decisions and optimistic conflict handling: loading or copying a suggestion does not mutate case version, history, or canonical identity.
- Added logo validation for allowlisted HTTPS hosts, public DNS/IP addresses, redirect revalidation, bounded bytes, allowlisted MIME types, and file signatures.
- Returned explicit missing/rejected/broken placeholder states and opaque content-addressed references instead of arbitrary provider URLs.

## Task Commits

1. **Task 1 RED:** `c210354`
2. **Task 1 GREEN:** `3ca9d28`
3. **Task 2 RED:** `1c0c433`
4. **Task 2 GREEN:** `425afc2`
5. **Verification fix:** `b7c607a`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Increased Playwright web-server startup allowance**
- The project filesystem required more than the prior 240 seconds for cold package and Next/Nest startup.
- Raised the startup allowance without weakening test assertions.
- Files: `playwright.config.ts`
- Commit: `b7c607a`

**2. [Rule 1 - Bug] Preserved the narrow suggestions route in overlapping Playwright mocks**
- The broad reconciliation mock shadowed the suggestion response and supplied the wrong DTO.
- Routed suggestion requests to the dedicated mock before handling list and decision requests.
- File: `tests/e2e/reconciliation-review.spec.ts`
- Commit: `b7c607a`

## Threat Mitigations

- The suggestion DTO has no fixtures, results, scores, statistics, or auto-approval command.
- Provider and network errors are sanitized and cannot alter reconciliation state.
- Logo fetches reject credentials, HTTP, non-allowlisted hosts, private/link-local addresses, unsafe redirects, oversized bodies, invalid MIME, and mismatched signatures.
- The browser never renders the provider candidate URL directly.

## Known Stubs

None.

## Self-Check: PASSED

- All planned artifacts exist and commits `c210354`, `3ca9d28`, `1c0c433`, `425afc2`, and `b7c607a` exist.
- Integration boundary tests passed 7/7.
- Chromium reconciliation review tests passed 5/5.
- API and web typechecks passed under Node 24.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-13*
