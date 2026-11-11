---
phase: "09"
slug: "degradation-alerting"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-11"
---

# Phase 09 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Created (State B) from the four PLAN threat-model blocks after execution; every mitigation verified against implementation + test evidence at ASVS L1 grep depth.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Worker → PostgreSQL alert state | The evaluator tick is the only writer of OpsAlert/OpsAlertTransition/OpsAlertDelivery rows; database triggers enforce immutability below the application layer | Alert lifecycle rows (signal, scope, severity, correlations — no secrets) |
| API read model → Web UI | `alerts()` projection crosses the internal-API boundary (OperatorGuard + method-bound HMAC proxy) into the operations page | Typed sanitized AlertView fields only; redactSecrets pass upstream |
| Evaluator → Webhook (external) | Optional outbound ALERT_WEBHOOK_URL delivery; the URL is never logged; payloads are allowlisted | Typed allowlist DTO (T-09-04); per-attempt delivery evidence retained |
| Redis buckets | Disposable per-minute 5xx/total counters with TTL 120s | Numeric counters keyed by minute index only — no provider tokens, URLs, or request data (T-09-07) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-09-01 | Tampering | OpsAlertTransition table | high | mitigate | Append-only trigger rejects UPDATE/DELETE at database level (migration.sql, 4 RAISE EXCEPTION guards); proven by `tests/integration/alerts.test.ts` cases 1–5 | closed |
| T-09-02 | Tampering | OpsAlert dedupFingerprint/identity | high | mitigate | Guarded transition trigger rejects changes to id/dedupFingerprint/firstSeen/createdAt; integration-tested on real PostgreSQL | closed |
| T-09-03 | Repudiation | OpsAlertDelivery | medium | mitigate | Every dispatch attempt recorded (timestamp/status/attempt) before marking FAILED; append-only trigger on the table | closed |
| T-09-04 | Information Disclosure | Webhook payload | medium | mitigate | Typed allowlist DTO + redactSecrets pass; planted-secret canary test in `tests/unit/alerts-dispatch.test.ts` (8/8) | closed |
| T-09-05 | Denial of Service | Evaluator tick | medium | mitigate | onError catch-all in the self-closing interval chain; one failing tick never crashes the worker; closed state prevents timer leaks (dispatch/probe unit suites) | closed |
| T-09-06 | Repudiation | OpsAlertDelivery | medium | mitigate | Per-attempt delivery evidence in OpsAlertDelivery before backoff; failed delivery never loses the alert (D-02) | closed |
| T-09-07 | Information Disclosure | 5xx bucket keys | low | mitigate | Bucket keys contain only minute index (`bet-stats:http5xx:<minuteIndex>`); key/TTL asserted in `tests/unit/alerts-5xx-filter.test.ts` (8/8) | closed |
| T-09-08 | Tampering | Acknowledge endpoint | medium | mitigate | OperatorGuard + HMAC-signed proxy; path-only POST; idempotent guarded updateMany; uniform 404; integration-tested | closed |
| T-09-09 | Information Disclosure | alerts() read model output | medium | mitigate | Typed safe fields + redactSecrets pass; planted-secret canary test in `tests/integration/operator-overview.test.ts` (25/25) | closed |
| T-09-10 | Information Disclosure | Rendered alert DOM | medium | mitigate | `AlertRow` typed closed shape renders only API-safe fields; planted-secret canary SSR case in `alerts-block.test.ts` (39/39) proves no secrets in markup | closed |
| T-09-11 | Tampering | Acknowledge action (view layer) | medium | mitigate | OperatorGuard + HMAC proxy upstream; path-only POST; idempotent; button state reflects server result (SSR acknowledge-semantics cases) | closed |
| T-09-12 | Denial of Service | Block render | low | accept | Block loads with page overview; error state shows prior content unchanged; no new attack surface — documented accepted risk | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-09-01 | T-09-12 | Degraded block render shows prior content unchanged; the alerts block adds no new attack surface (read-only projection + one guarded POST) | Plan 09-04 threat model (disposition: accept) | 2026-11-11 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-11 | 12 | 12 | 0 | gsd-execute-phase verify_phase_goal (orchestrator, ASVS L1) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-11
