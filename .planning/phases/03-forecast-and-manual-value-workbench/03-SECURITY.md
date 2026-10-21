---
phase: 03
slug: forecast-and-manual-value-workbench
status: verified
threats_open: 0
asvs_level: 1
block_on: high
created: 2026-09-08
---

# Phase 03 — Security

## Trust Boundaries

| Boundary | Control |
|---|---|
| Browser → internal Next routes | Server-owned eligibility headers, strict payload allowlists, no-store responses |
| Next routes → Nest API | Eligibility guards on forecast, odds, value, and receipt endpoints |
| Untrusted odds/provenance → domain | Exact-key contracts, bounded canonical decimal and UTC parsing |
| Domain services → PostgreSQL | Immutable relations, advisory-lock serialization, source-derived receipt trigger |
| PostgreSQL receipts → browser/export | Exact snapshot IDs and canonical server JSON across DOM, clipboard, and download |

## Threat Register

| Threat ID | Category | Severity | Disposition | Mitigation evidence | Status |
|---|---|---:|---|---|---|
| T-03-01-01 | Tampering | high | mitigate | Strict odds/value contracts and pair checks | closed |
| T-03-01-02 | Tampering | high | mitigate | Single normalized score matrix and canonical hashes | closed |
| T-03-01-03 | Repudiation | medium | mitigate | Versioned receipt inputs, formulas, thresholds, gates | closed |
| T-03-SC | Tampering | low | mitigate | `decimal.js` pinned to 10.6.0 in manifest and lockfile | closed |
| T-03-02-01 | Tampering | high | mitigate | Ordered all-of gate evaluation with truth-table tests | closed |
| T-03-02-02 | Tampering | medium | mitigate | Decimal arithmetic and canonical serialization | closed |
| T-03-02-03 | Repudiation | medium | mitigate | Persisted policy/config versions and hashes | closed |
| T-03-03-01 | Tampering | high | mitigate | Immutable update/delete triggers and restricted relations | closed |
| T-03-03-02 | Tampering | high | mitigate | Required FKs and source-derived receipt guard | closed |
| T-03-03-03 | Repudiation | medium | mitigate | Immutable supersession/replacement links | closed |
| T-03-03-04 | Denial of Service | medium | mitigate | Compound identities, transaction lock, convergence | closed |
| T-03-04-01 | Elevation of Privilege | high | mitigate | EligibilityGuard on forecast controller | closed |
| T-03-04-02 | Tampering | high | mitigate | Exact UTC cutoff and source-time enforcement | closed |
| T-03-04-03 | Tampering | high | mitigate | Official lineup provenance and database validation | closed |
| T-03-04-04 | Denial of Service | medium | mitigate | Deterministic job IDs and database uniqueness | closed |
| T-03-05-01 | Elevation of Privilege | high | mitigate | EligibilityGuard on odds/value controllers | closed |
| T-03-05-02 | Tampering | high | mitigate | Server-derived normalization, edge, and EV | closed |
| T-03-05-03 | Tampering | high | mitigate | Fixture/market/selection snapshot equality | closed |
| T-03-05-04 | Information Disclosure | medium | mitigate | Fixed receipt filename and JSON content type | closed |
| T-03-06-01 | Information Disclosure | high | mitigate | Server-only eligibility and constrained proxy requests | closed |
| T-03-06-02 | Tampering | high | mitigate | Authoritative receipt parity in production E2E | closed |
| T-03-06-03 | Spoofing | high | mitigate | Issued exact-ID listing and explicit stable selection | closed |
| T-03-06-04 | Information Disclosure | medium | mitigate | React escaping and server-generated filenames | closed |
| T-03-07-01 | Elevation of Privilege | high | mitigate | Unauthorized production request returns 403 | closed |
| T-03-07-02 | Tampering | high | mitigate | PostgreSQL adversarial matrix 13/13 | closed |
| T-03-07-03 | Repudiation | medium | mitigate | Requirement/finding witness map in VALIDATION | closed |
| T-03-07-04 | Information Disclosure | medium | mitigate | Chromium parity and authorization scenarios 3/3 | closed |
| T-03-08-01 | Tampering | high | mitigate | Official observation bound to hash, ID, receipt, DB key | closed |
| T-03-08-02 | Denial of Service | medium | mitigate | Safe transaction advisory lock and concurrency witness | closed |
| T-03-09-01 | Denial of Service | high | mitigate | Length/grammar/scale bounds before Decimal parsing | closed |
| T-03-09-02 | Tampering | high | mitigate | Full canonical odds provenance identity | closed |
| T-03-09-03 | Information Disclosure | medium | mitigate | Fixture-scoped odds lookup | closed |
| T-03-10-01 | Tampering | critical | mitigate | Market/selection in receipt lookup, hash, and unique key | closed |
| T-03-10-02 | Tampering | high | mitigate | Nested/flat-compatible PostgreSQL receipt guard | closed |
| T-03-11-01 | Information Disclosure | medium | mitigate | Fixture/ISSUED-scoped guarded no-store listing | closed |
| T-03-11-02 | Tampering | high | mitigate | Server-returned immutable IDs and stable selection | closed |
| T-03-12-01 | Tampering | high | mitigate | Server/DOM/clipboard/download canonical parity | closed |
| T-03-12-02 | Repudiation | medium | mitigate | Named CR-01..06 and WR-01..03 witnesses | closed |

## Accepted Risks Log

No accepted risks.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|---|---:|---:|---:|---|
| 2026-09-08 | 38 | 38 | 0 | gsd-security-auditor |

## Runtime Evidence

- Disposable PostgreSQL migrations applied successfully.
- `phase-03-security.test.ts`: 13/13 passed.
- Production Chromium workbench: 3/3 passed.
- UAT: 4/4 passed; Nyquist: 13/13 requirements covered.

## Sign-Off

- [x] All threats have a disposition.
- [x] No accepted risks require documentation.
- [x] `threats_open: 0` confirmed.
- [x] `status: verified` set.

**Approval:** verified 2026-09-08
