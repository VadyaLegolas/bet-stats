# Docker Basic Auth Operator Gateway

## Purpose

Provide a deployable authenticated ingress for the internal replay workspace while the application runs in Docker. Public fixture and evidence pages remain anonymous. The design supplies the real topology required by Phase 2 Plan 02-19 without storing operator credentials or signing secrets in the browser or repository.

## Scope

The gateway protects only these path families:

- `/internal/pipeline/replay*`
- `/internal-api/pipeline/replay*`

All other Next.js routes remain public. This is a local and Docker deployment mechanism, not the final Vercel identity solution.

## Architecture

```text
browser -> operator-gateway:8080 -> web:3000 -> api:3001
                                      |
                                      +-> PostgreSQL / Redis / BullMQ worker
```

Only `operator-gateway` publishes a host port. `web` and `api` use Docker `expose` on an internal network. The API remains unreachable from the browser and receives replay requests only from the Next.js server proxy.

The gateway is a small Node.js service using platform HTTP and crypto APIs. It avoids an additional proxy configuration language and implements the exact HMAC contract already verified by `apps/web/src/security/operator-proxy-authorization.ts`.

## Configuration

Runtime values come from an ignored `.env` file:

- `OPERATOR_BASIC_USERNAME`
- `OPERATOR_BASIC_PASSWORD`
- `OPERATOR_SUBJECT`
- `OPERATOR_PROXY_SIGNING_SECRET`
- `OPERATOR_AUTHORIZED_SUBJECTS`
- `OPERATOR_CREDENTIAL`

The repository may include `.env.example` entries with descriptions, but never real values. The signing secret must contain at least 32 characters. `OPERATOR_SUBJECT` must also appear in `OPERATOR_AUTHORIZED_SUBJECTS`.

## Request Flow

For public paths, the gateway removes all inbound `X-Operator-*` headers and forwards the request to Next without adding identity.

For protected replay paths, the gateway:

1. Requires valid HTTP Basic credentials using constant-time credential comparison.
2. Returns a generic `401` with `WWW-Authenticate` when authentication is absent or invalid.
3. Removes all browser-provided operator subject, timestamp, and signature headers.
4. Builds a fresh ISO timestamp and the existing canonical query digest.
5. Signs `subject + "\n" + timestamp + "\n" + method + "\n" + pathname + "\n" + queryDigest` with HMAC-SHA256.
6. Adds the signed `X-Operator-Subject`, `X-Operator-Timestamp`, and `X-Operator-Signature` headers.
7. Proxies the request to the internal Next service.

Next validates the signature and allowlist before reading its server-held `OPERATOR_CREDENTIAL`. It forwards only the verified subject and server credential to the private Nest API. Nest persists the subject as `ReplayPreview.actor` and `ReplayPlan.actor`.

## Security and Failure Behavior

- Browser-supplied identity/signature headers are always overwritten or removed.
- Secrets are never returned in responses, included in client bundles, or written to logs.
- Missing configuration fails closed; protected routes are unavailable.
- Basic authentication is acceptable only behind HTTPS outside localhost.
- Request and response bodies are streamed with bounded proxy behavior; hop-by-hop headers are not forwarded.
- Public routes cannot acquire operator identity accidentally.
- Next and Nest host ports are not published by Docker Compose.

## Verification

Fast tests cover Basic parsing, constant-time comparison behavior, path classification, header stripping, canonical signing, missing configuration, and public-route behavior.

The deployment smoke test proves:

- public fixture/evidence routes work without Basic Auth;
- protected replay routes return `401` without valid Basic Auth;
- spoofed operator headers cannot reach Next as trusted identity;
- an authenticated operator can preview and queue replay work;
- PostgreSQL stores `ReplayPreview.actor` and `ReplayPlan.actor` as `OPERATOR_SUBJECT`;
- Next and Nest ports are not reachable from the host;
- credentials and signing secrets are absent from browser storage, bundles, response bodies, and logs.

## Vercel Migration

When the web application moves to Vercel, replace the Docker gateway with authenticated Next.js `proxy.ts` using OIDC/Auth.js. The middleware strips inbound operator headers and emits the same signed request contract, so the existing replay route, Nest guard, actor audit, and tests remain applicable. PostgreSQL, Redis, Nest, and the BullMQ worker remain on infrastructure suitable for persistent services.
