# Docker Basic Auth Operator Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Docker-only Basic Auth ingress that protects replay routes, strips spoofed identity headers, emits the existing HMAC operator contract, and leaves public routes anonymous.

**Architecture:** A dependency-free Node gateway is the only host-published application service. It authenticates protected replay paths, signs a normalized operator identity, and streams requests to the internal Next container; Next verifies the signature and reaches the private Nest API. A production-like Compose overlay proves that neither Next nor Nest is directly host-reachable.

**Tech Stack:** Node.js 24 built-ins, TypeScript/Vitest contract tests, Docker Compose, Next.js 16, NestJS 11, PostgreSQL 18, Redis 8.

## Global Constraints

- Protect only `/internal/pipeline/replay*` and `/internal-api/pipeline/replay*`; all other Next routes remain public.
- Read `OPERATOR_BASIC_USERNAME`, `OPERATOR_BASIC_PASSWORD`, `OPERATOR_SUBJECT`, and `OPERATOR_PROXY_SIGNING_SECRET` only from server environment.
- Never commit, log, return, or bundle real credentials or secrets.
- Always remove browser-supplied `X-Operator-Subject`, `X-Operator-Timestamp`, and `X-Operator-Signature` headers.
- Use the exact HMAC payload already consumed by `apps/web/src/security/operator-proxy-authorization.ts`.
- Publish only gateway port `8080`; web, API, PostgreSQL, and Redis remain internal for the deployment smoke.
- Preserve compatibility with a later Next.js `proxy.ts` plus OIDC/Auth.js implementation on Vercel.

---

## File Structure

- `infra/operator-gateway/security.mjs` — pure Basic Auth, path classification, canonical query hashing, and HMAC header generation.
- `infra/operator-gateway/server.mjs` — streaming reverse proxy with fail-closed configuration and hop-by-hop header filtering.
- `infra/operator-gateway/Dockerfile` — minimal Node 24 runtime image.
- `tests/unit/operator-gateway.test.ts` — fast pure security contract.
- `tests/integration/operator-gateway.test.ts` — real gateway-to-fake-upstream HTTP boundary.
- `infra/Dockerfile.app` — reproducible monorepo build image used by web, API, and worker containers.
- `infra/docker-compose.operator.yml` — deployable gateway/web/API/worker/PostgreSQL/Redis topology.
- `.env.example` — names and generation guidance only.
- `tests/integration/operator-gateway-deployment.test.ts` — Compose smoke for public/protected routes, spoof resistance, durable actor, and port isolation.

### Task 1: Pure Basic Auth and HMAC Security Contract

**Files:**
- Create: `infra/operator-gateway/security.mjs`
- Create: `tests/unit/operator-gateway.test.ts`

**Interfaces:**
- Produces: `isProtectedReplayPath(pathname: string): boolean`
- Produces: `authenticateBasic(header: string | undefined, expectedUsername: string, expectedPassword: string): boolean`
- Produces: `signedOperatorHeaders(input: { subject: string; secret: string; method: string; pathname: string; search: string; timestamp: string }): Record<string, string>`
- Produces: `stripOperatorHeaders(headers: Headers): Headers`

- [ ] **Step 1: Write failing path and Basic Auth tests**

```ts
import { describe, expect, it } from "vitest";
import { authenticateBasic, isProtectedReplayPath } from "../../infra/operator-gateway/security.mjs";

describe("operator gateway security", () => {
  it.each([
    "/internal/pipeline/replay",
    "/internal/pipeline/replay/abc",
    "/internal-api/pipeline/replay/preview",
  ])("protects %s", (path) => expect(isProtectedReplayPath(path)).toBe(true));

  it.each(["/", "/fixtures", "/teams/t/evidence", "/internal/reconciliation"])(
    "leaves %s public",
    (path) => expect(isProtectedReplayPath(path)).toBe(false),
  );

  it("accepts only the exact Basic credentials", () => {
    const valid = `Basic ${Buffer.from("operator:correct horse battery staple").toString("base64")}`;
    const wrong = `Basic ${Buffer.from("operator:wrong").toString("base64")}`;
    expect(authenticateBasic(valid, "operator", "correct horse battery staple")).toBe(true);
    expect(authenticateBasic(wrong, "operator", "correct horse battery staple")).toBe(false);
    expect(authenticateBasic(undefined, "operator", "correct horse battery staple")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm test -- operator-gateway --run`

Expected: FAIL because `infra/operator-gateway/security.mjs` does not exist.

- [ ] **Step 3: Implement path classification and constant-time Basic comparison**

```js
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const protectedPrefixes = ["/internal/pipeline/replay", "/internal-api/pipeline/replay"];
const operatorHeaders = new Set(["x-operator-subject", "x-operator-timestamp", "x-operator-signature"]);

export function isProtectedReplayPath(pathname) {
  return protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function equalText(left, right) {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function authenticateBasic(header, expectedUsername, expectedPassword) {
  if (!header?.startsWith("Basic ") || !expectedUsername || !expectedPassword) return false;
  let decoded;
  try { decoded = Buffer.from(header.slice(6), "base64").toString("utf8"); } catch { return false; }
  const separator = decoded.indexOf(":");
  if (separator < 1) return false;
  return equalText(decoded.slice(0, separator), expectedUsername)
    && equalText(decoded.slice(separator + 1), expectedPassword);
}

export function stripOperatorHeaders(input) {
  const output = new Headers(input);
  for (const name of operatorHeaders) output.delete(name);
  return output;
}

export function signedOperatorHeaders({ subject, secret, method, pathname, search, timestamp }) {
  const pairs = [...new URLSearchParams(search).entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  const queryDigest = createHash("sha256").update(new URLSearchParams(pairs).toString(), "utf8").digest("base64url");
  const payload = `${subject}\n${timestamp}\n${method.toUpperCase()}\n${pathname}\n${queryDigest}`;
  return {
    "x-operator-subject": subject,
    "x-operator-timestamp": timestamp,
    "x-operator-signature": createHmac("sha256", secret).update(payload, "utf8").digest("base64url"),
  };
}
```

- [ ] **Step 4: Add exact signature and spoof stripping tests**

```ts
import { createHash, createHmac } from "node:crypto";
import { signedOperatorHeaders, stripOperatorHeaders } from "../../infra/operator-gateway/security.mjs";

it("strips spoofed identity and emits the exact Next verifier signature", () => {
  const stripped = stripOperatorHeaders(new Headers({ "x-operator-subject": "attacker", accept: "application/json" }));
  expect(stripped.get("x-operator-subject")).toBeNull();
  expect(stripped.get("accept")).toBe("application/json");
  const timestamp = "2026-08-31T12:00:00.000Z";
  const query = new URLSearchParams([["a", "1"], ["z", "2"]]).toString();
  const digest = createHash("sha256").update(query).digest("base64url");
  const payload = `local-test-operator\n${timestamp}\nPOST\n/internal-api/pipeline/replay/preview\n${digest}`;
  expect(signedOperatorHeaders({ subject: "local-test-operator", secret: "x".repeat(32), method: "POST", pathname: "/internal-api/pipeline/replay/preview", search: "?z=2&a=1", timestamp })).toEqual({
    "x-operator-subject": "local-test-operator",
    "x-operator-timestamp": timestamp,
    "x-operator-signature": createHmac("sha256", "x".repeat(32)).update(payload).digest("base64url"),
  });
});
```

- [ ] **Step 5: Run GREEN and commit**

Run: `pnpm test -- operator-gateway --run`

Expected: all operator gateway unit tests PASS.

```bash
git add infra/operator-gateway/security.mjs tests/unit/operator-gateway.test.ts
git commit -m "feat(02-19): define operator gateway security contract"
```

### Task 2: Streaming Gateway HTTP Boundary

**Files:**
- Create: `infra/operator-gateway/server.mjs`
- Create: `infra/operator-gateway/Dockerfile`
- Create: `tests/integration/operator-gateway.test.ts`

**Interfaces:**
- Consumes: Task 1 security exports.
- Produces: HTTP server configured by `GATEWAY_PORT`, `WEB_ORIGIN`, `OPERATOR_BASIC_USERNAME`, `OPERATOR_BASIC_PASSWORD`, `OPERATOR_SUBJECT`, and `OPERATOR_PROXY_SIGNING_SECRET`.

- [ ] **Step 1: Write a failing real HTTP boundary test**

Create a test that starts a fake upstream on an ephemeral port, starts the gateway as a child process with process-only test secrets, and asserts:

```ts
expect((await fetch(`${gateway}/fixtures`)).status).toBe(200);
expect((await fetch(`${gateway}/internal-api/pipeline/replay/preview`)).status).toBe(401);
const response = await fetch(`${gateway}/internal-api/pipeline/replay/preview`, {
  method: "POST",
  headers: {
    authorization: `Basic ${Buffer.from("operator:test-password").toString("base64")}`,
    "x-operator-subject": "attacker",
    "content-type": "application/json",
  },
  body: "{}",
});
expect(response.status).toBe(200);
expect(upstreamRequest.headers["x-operator-subject"]).toBe("local-test-operator");
expect(upstreamRequest.headers["x-operator-signature"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm test:integration -- operator-gateway --run`

Expected: FAIL because the gateway server does not exist.

- [ ] **Step 3: Implement the minimal streaming proxy**

`server.mjs` must validate all required configuration at startup, use `http.request`/`https.request` to stream the body, discard hop-by-hop headers, authenticate protected paths before opening the upstream request, strip operator headers on every path, and attach fresh signed headers only on protected paths. The exact fail-closed response is:

```js
response.writeHead(401, {
  "content-type": "application/json",
  "cache-control": "private, no-store, max-age=0",
  "www-authenticate": 'Basic realm="Bet Stats Operator", charset="UTF-8"',
});
response.end(JSON.stringify({ message: "Authentication required" }));
```

The upstream target must be constructed exclusively from `WEB_ORIGIN` plus the incoming path/query; never accept an absolute-form client target or alternate host.

- [ ] **Step 4: Add failure and cleanup coverage**

Assert missing configuration exits non-zero, an unavailable upstream returns classified `502`, public paths receive no operator identity, malformed Basic input returns `401`, and client disconnects destroy the upstream request.

- [ ] **Step 5: Add the minimal runtime image**

```dockerfile
FROM node:24.11.1-alpine
WORKDIR /app
COPY security.mjs server.mjs ./
ENV NODE_ENV=production GATEWAY_PORT=8080 WEB_ORIGIN=http://web:3000
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
```

- [ ] **Step 6: Run GREEN, lint boundary, and commit**

Run: `pnpm test -- operator-gateway --run && pnpm test:integration -- operator-gateway --run`

Expected: unit and integration gateway suites PASS with no secret text in output.

```bash
git add infra/operator-gateway tests/integration/operator-gateway.test.ts
git commit -m "feat(02-19): add docker operator ingress"
```

### Task 3: Private Docker Topology and Deployment Smoke

**Files:**
- Create: `infra/Dockerfile.app`
- Create: `infra/docker-compose.operator.yml`
- Create: `.env.example`
- Modify: `apps/web/package.json`
- Create: `tests/integration/operator-gateway-deployment.test.ts`
- Modify: `.planning/phases/02-historical-evidence-pipeline/02-19-SUMMARY.md` only after the human deployment checkpoint passes.

**Interfaces:**
- Consumes: gateway image from Task 2 and existing web/API/worker runtime entry points.
- Produces: `docker compose -f infra/docker-compose.operator.yml up --build` deployment with gateway-only application ingress.

- [ ] **Step 1: Add a failing Compose contract test**

The fast portion parses `docker-compose.operator.yml` and asserts:

```ts
expect(compose.services["operator-gateway"].ports).toEqual(["8080:8080"]);
expect(compose.services.web.ports).toBeUndefined();
expect(compose.services.api.ports).toBeUndefined();
expect(compose.services.postgres.ports).toBeUndefined();
expect(compose.services.redis.ports).toBeUndefined();
expect(compose.networks.internal.internal).toBe(true);
```

- [ ] **Step 2: Create the app image and Compose topology**

`Dockerfile.app` uses Node 24, Corepack, `pnpm install --frozen-lockfile`, and `pnpm build`. Add `"start": "next start --hostname 0.0.0.0 --port 3000"` to `apps/web/package.json`. Compose uses one cached app image with service commands:

```yaml
operator-gateway:
  build: ./operator-gateway
  ports: ["8080:8080"]
  environment:
    WEB_ORIGIN: http://web:3000
    OPERATOR_BASIC_USERNAME: ${OPERATOR_BASIC_USERNAME}
    OPERATOR_BASIC_PASSWORD: ${OPERATOR_BASIC_PASSWORD}
    OPERATOR_SUBJECT: ${OPERATOR_SUBJECT}
    OPERATOR_PROXY_SIGNING_SECRET: ${OPERATOR_PROXY_SIGNING_SECRET}
  depends_on: [web]
  networks: [internal]

web:
  build:
    context: ..
    dockerfile: infra/Dockerfile.app
  command: ["pnpm", "--filter", "@bet-stats/web", "start"]
  expose: ["3000"]
  environment:
    API_ORIGIN: http://api:3001
    OPERATOR_PROXY_SIGNING_SECRET: ${OPERATOR_PROXY_SIGNING_SECRET}
    OPERATOR_AUTHORIZED_SUBJECTS: ${OPERATOR_SUBJECT}
    OPERATOR_CREDENTIAL: ${OPERATOR_CREDENTIAL}
  networks: [internal]

api:
  command: ["node", "apps/api/dist/main.js"]
  expose: ["3001"]
  environment:
    API_HOST: 0.0.0.0
    API_PORT: 3001
    DATABASE_URL: postgresql://football_prediction:${POSTGRES_PASSWORD}@postgres:5432/football_prediction
    REDIS_URL: redis://redis:6379
    OPERATOR_CREDENTIAL: ${OPERATOR_CREDENTIAL}
  networks: [internal]
```

Add worker, PostgreSQL, and Redis on the same internal network with healthchecks and no host ports. Use named volumes. Do not put secret defaults in Compose.

- [ ] **Step 3: Add safe environment documentation**

`.env.example` contains only:

```dotenv
POSTGRES_PASSWORD=generate-a-local-value
OPERATOR_BASIC_USERNAME=operator
OPERATOR_BASIC_PASSWORD=generate-a-local-value
OPERATOR_SUBJECT=local-test-operator
OPERATOR_PROXY_SIGNING_SECRET=generate-at-least-32-random-characters
OPERATOR_AUTHORIZED_SUBJECTS=local-test-operator
OPERATOR_CREDENTIAL=generate-a-separate-local-value
FOOTBALL_DATA_API_TOKEN=provide-only-for-live-provider-smoke
```

Include PowerShell generation guidance in comments. `.env` remains ignored.

- [ ] **Step 4: Run the fast Compose contract**

Run: `pnpm test:integration -- operator-gateway-deployment --run`

Expected: Compose structure assertions PASS before starting containers.

- [ ] **Step 5: Run the real deployment smoke with process-only secrets**

Create an ignored `.env`, then run:

```powershell
docker compose --env-file .env -f infra/docker-compose.operator.yml up --build -d
docker compose --env-file .env -f infra/docker-compose.operator.yml ps
```

Verify:

```powershell
Invoke-WebRequest http://localhost:8080/fixtures -UseBasicParsing
Invoke-WebRequest http://localhost:8080/internal-api/pipeline/replay/preview -Method Post -ContentType application/json -Body '{}' -SkipHttpErrorCheck
```

Expected: public route is not `401`; replay route is `401` without Basic Auth. Repeat with `-Authentication Basic -Credential` and a valid replay body; expect the request to pass gateway/Next authentication and reach Nest validation.

- [ ] **Step 6: Verify durable actor and isolation**

After a valid preview/queue flow, run inside PostgreSQL:

```sql
SELECT id, actor FROM "ReplayPreview" ORDER BY "createdAt" DESC LIMIT 1;
SELECT id, actor FROM "ReplayPlan" ORDER BY "createdAt" DESC LIMIT 1;
```

Expected: both actors equal `OPERATOR_SUBJECT`.

Confirm `http://localhost:3000` and `http://localhost:3001` are unreachable from the host, spoofed `X-Operator-*` headers cannot change the actor, and Compose/browser output contains no configured secret values.

- [ ] **Step 7: Tear down safely and commit**

Run: `docker compose --env-file .env -f infra/docker-compose.operator.yml down`

Do not use `-v`; retain database/Redis volumes unless the user explicitly requests deletion.

```bash
git add infra/Dockerfile.app infra/docker-compose.operator.yml .env.example apps/web/package.json tests/integration/operator-gateway-deployment.test.ts pnpm-lock.yaml
git commit -m "feat(02-19): deploy private operator gateway topology"
```

### Task 4: Phase Checkpoint Completion

**Files:**
- Create: `.planning/phases/02-historical-evidence-pipeline/02-19-SUMMARY.md`

**Interfaces:**
- Consumes: successful Task 3 deployment evidence.
- Produces: auditable completion record allowing Phase 2 gap execution to continue to 02-21 and 02-22.

- [ ] **Step 1: Record the human verification evidence**

Document the exact Compose command, public/protected status outcomes, durable actor query result, port-isolation result, and confirmation that secrets were absent. Do not record secret values.

- [ ] **Step 2: Run final targeted verification**

Run:

```powershell
pnpm test -- operator-gateway evidence-browser-contract --run
pnpm test:integration -- operator-gateway replay-boundary operator-gateway-deployment --run
pnpm --filter @bet-stats/web typecheck
pnpm --filter @bet-stats/api typecheck
```

Expected: all targeted suites and typechecks PASS.

- [ ] **Step 3: Commit the summary**

```bash
git add .planning/phases/02-historical-evidence-pipeline/02-19-SUMMARY.md
git commit -m "docs(02-19): verify docker operator ingress"
```

## Self-Review

- Spec coverage: protected/public routing, Basic Auth, spoof stripping, HMAC compatibility, secret handling, private topology, durable actor, Docker smoke, and Vercel migration seam are all mapped to tasks.
- Placeholder scan: no deferred implementation markers are present; example environment values are explicitly non-secret generation prompts.
- Type consistency: Task 2 consumes exactly the four exports defined in Task 1; Compose environment names match the approved design and existing Next verifier.
