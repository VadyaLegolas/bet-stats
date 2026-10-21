---
phase: 01
slug: trustworthy-fixture-discovery
status: verified
threats_open: 0
asvs_level: 1
created: 2026-08-29
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| environment → processes | Server configuration and secrets enter API and worker runtimes | credentials, endpoints, runtime mode |
| browser → public API | Untrusted filters and fixture identifiers enter read projections | query parameters, route identifiers |
| browser claims → eligibility guard | User-controlled region and age claims affect protected content access | authorization claims |
| operator browser → review API | Privileged reconciliation commands cross authorization | credential, evidence, decisions |
| provider → canonical storage | Untrusted provider payloads become durable canonical data | external JSON, references, provenance |
| capability and budget storage → provider caller | Durable policy authorizes external requests | coverage, allowance, idempotency key |
| database → web projection | Canonical records and provider text are rendered to users | fixture data, evidence, freshness |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Information Disclosure | Compose/env | high | mitigate | Environment-only secrets, validated configuration, and frozen configuration tests | closed |
| T-01-02 | Information Disclosure | API bootstrap | high | mitigate | Safe errors and correlation-only metadata, covered by health integration tests | closed |
| T-01-03 | Information Disclosure | config/logs | high | mitigate | Central redaction with negative secret-leakage tests | closed |
| T-01-04 | Tampering | identity transaction | high | mitigate | Unique external references and atomic reconciliation transactions | closed |
| T-01-05 | Repudiation | audit history | high | mitigate | Append-only evidence, versions, and supersession history | closed |
| T-01-08 | Elevation of Privilege | eligibility guard | high | mitigate | Explicit allowlist and affirmative age requirement; missing, stale, or failed checks deny | closed |
| T-01-09 | Information Disclosure | SSR/cache | high | mitigate | Protected subtree is withheld server-side before authorization with safe cache behavior | closed |
| T-01-11 | Repudiation | responsible claims | medium | mitigate | Repository copy scanner rejects certainty, urgency, and risk-free claims | closed |
| T-01-12 | Spoofing/Elevation | operator guard | high | mitigate | Constant-time server credential comparison; feature disabled when credential is absent | closed |
| T-01-13 | Tampering | concurrent commands | high | mitigate | Optimistic version checks and atomic append; conflict tests prevent overwrite | closed |
| T-01-14 | Information Disclosure | evidence/UI | high | mitigate | Provider text escaping and exclusion of credentials from client bundles | closed |
| T-01-15 | Denial of Service | fixture ranges | medium | mitigate | Bounded and validated list ranges | closed |
| T-01-16 | Repudiation | reconciliation decisions | high | mitigate | Complete actor, evidence, target, version, and supersession audit | closed |
| T-01-CAP-01 | Tampering | provider capability | high | mitigate | Canonical keys, verification timestamps, expiry, and fail-closed mismatch handling | closed |
| T-01-CAP-02 | Tampering | provider payload | high | mitigate | Zod validation and exhaustive normalization before persistence | closed |
| T-01-CAP-03 | Information Disclosure | provider client | high | mitigate | Token redaction in errors and serialized output | closed |
| T-01-CAP-04 | Denial of Service | request allowance | high | mitigate | Atomic pre-call reservation, deterministic job keys, and concurrency tests | closed |
| T-01-DS-01 | Tampering | data-state projection | medium | mitigate | Closed data-state union and fail-closed handling of unknown states | closed |
| T-01-FINAL | S/T/R/I/D/E | integrated phase | high | mitigate | Held-out Phase 01 security suite plus complete frozen validation matrix | closed |
| T-01-FX-01 | Tampering | fixture projection | medium | mitigate | Canonical database DTOs and explicit state tests | closed |
| T-01-SC | Tampering | installed packages | high | mitigate | Registry legitimacy gate, pinned dependencies, and frozen lockfile installation | closed |
| T-01-TR-01 | Tampering | adapter selection | high | mitigate | Production configuration rejects deterministic adapters | closed |
| T-01-TR-02 | Information Disclosure | health endpoint | high | mitigate | Health responses are redacted and omit secrets and stack traces | closed |

*Status: open · closed · open — below high threshold (non-blocking)*

---

## Accepted Risks Log

No accepted risks.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-29 | 23 | 23 | 0 | Codex (GSD ASVS L1) |

The register was authored during planning. ASVS L1 evidence was verified against plan summaries, focused negative tests, the held-out `phase-01-security` suite, and the completed full validation matrix recorded in `01-VALIDATION.md`.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-29
