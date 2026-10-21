---
phase: 05-provider-aware-coverage-and-enrichment
plan: 10
subsystem: media-security
tags: [nestjs, ssrf, signed-reference, image-validation, playwright]
requires:
  - phase: 05-08
    provides: review-only suggestions and logo validation service
  - phase: 05-09
    provides: production AppModule operator-guard patterns
provides:
  - Registered operator-guarded provider-logo HTTP route
  - Signed opaque candidate references and application-controlled binary proxy
  - Held-out HTTP, authority and browser acceptance evidence for Phase 05
affects: [reconciliation-review, media-boundary, phase-05-verification]
actuals: {tokens: 10400, tasks: 2, commits: 6}
tech-stack:
  added: []
  patterns: [HMAC opaque reference, guarded binary controller, restrictive image headers, app-controlled web proxy]
key-files:
  created: [apps/api/src/modules/media/provider-logo.controller.ts, apps/api/src/modules/media/media.module.ts, apps/web/app/internal-api/provider-logo/[reference]/route.ts, tests/integration/provider-logo-http.test.ts, tests/integration/phase-05-security.test.ts]
  modified: [apps/api/src/modules/media/provider-logo.service.ts, apps/api/src/app.module.ts, apps/api/src/modules/reconciliation/reconciliation.service.ts, apps/web/app/internal/reconciliation/page.tsx, tests/unit/odds-draft-ui.test.tsx]
key-decisions:
  - "Phase 05: Browsers receive only HMAC-authenticated opaque logo references and fetch bytes through application-controlled routes."
  - "Phase 05: Media responses are operator-guarded, signature-validated, byte-bounded and served with nosniff, restrictive CSP/referrer policy and private caching."
requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06, PROV-07]
duration: 18min
completed: 2026-09-13
status: complete
---

# Phase 05 Plan 10: Guarded Provider Logo HTTP Boundary Summary

**Validated provider logos now cross a registered, operator-guarded Nest route via signed opaque references and an application-controlled Next proxy, with hostile media and full Phase 05 browser acceptance proven.**

## Accomplishments

- Registered `MediaModule` in the production `AppModule` and protected the binary route with `OperatorGuard`.
- Added HMAC-authenticated opaque candidate references so browsers cannot supply arbitrary fetch URLs.
- Served only validated PNG/JPEG/WebP bytes with fixed length, `nosniff`, restrictive CSP/referrer policy and conservative private caching.
- Routed reconciliation images through the internal Next boundary; provider candidate URLs never enter browser markup.
- Proved unauthorized, forged-reference, private/link-local/CGNAT, active-content and oversized-body rejection.
- Passed all provider degradation, immutable comparison and reconciliation Chromium flows.

## Task Commits

1. **Task 1 RED:** `37a4104`
2. **Task 1 GREEN:** `709d0e1`
3. **Task 2 RED:** `a3bb8f6`
4. **Task 2 GREEN:** `545d1cc`
5. **Root lint compatibility:** `98b7571`
6. **Root unit witness alignment:** `0c58f93`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added an application-controlled Next binary proxy**
- The browser needed a same-origin route that forwards only the signed reference and server-held operator credential.
- File: `apps/web/app/internal-api/provider-logo/[reference]/route.ts`
- Commit: `709d0e1`

**2. [Rule 1 - Security Bug] Rejected CGNAT shared-address destinations**
- Held-out tests showed `100.64.0.0/10` was not classified as non-public.
- File: `apps/api/src/modules/media/provider-logo.service.ts`
- Commit: `545d1cc`

**3. [Rule 3 - Blocking] Made optional logo options explicit to Nest DI**
- Production bootstrap treated the structural options parameter as a required `Object` provider.
- File: `apps/api/src/modules/media/provider-logo.service.ts`
- Commit: `545d1cc`

**4. [Rule 3 - Blocking] Aligned a stale root unit witness with the completed comparison contract**
- The earlier test expected obsolete empty-state copy replaced by Plan 05-07.
- File: `tests/unit/odds-draft-ui.test.tsx`
- Commit: `0c58f93`

## Threat Mitigations

- Authentication is checked before any reference resolution or network fetch.
- Candidate URLs are signed server-side and never accepted directly from browser input.
- DNS and IP policy is re-applied at every redirect hop; private, link-local and shared address space is rejected.
- MIME, magic bytes, declared and actual size, redirect count and timeout are bounded.
- Errors return a generic 404 and never include fetch, DNS, URL or credential detail.

## Known Stubs

None.

## Self-Check: PASSED

- Planned controllers, module, proxy and both integration suites exist.
- Commits `37a4104`, `709d0e1`, `a3bb8f6`, `545d1cc`, `98b7571`, and `0c58f93` exist.
- HTTP/security integration passed 13/13; Chromium acceptance passed 9/9.
- Root typecheck passed 7/7 packages, lint passed, and unit tests passed 223/223.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-13*
