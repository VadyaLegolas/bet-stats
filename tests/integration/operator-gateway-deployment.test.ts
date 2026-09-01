import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const composeFile = "infra/docker-compose.operator.yml";

type ComposeService = {
  environment?: Record<string, string>;
  healthcheck?: { test?: string[] };
  networks?: Record<string, unknown>;
  ports?: Array<{ published: string; target: number }>;
  volumes?: Array<{ source: string; target: string }>;
};

type ComposeConfiguration = {
  services: Record<string, ComposeService>;
  networks: Record<string, { internal?: boolean }>;
};

function loadComposeConfiguration(): ComposeConfiguration {
  const rendered = execFileSync(
    "docker",
    ["compose", "-f", composeFile, "config", "--format", "json"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        FOOTBALL_DATA_API_TOKEN: "contract-test-provider-token",
        OPERATOR_BASIC_PASSWORD: "contract-test-basic-password",
        OPERATOR_BASIC_USERNAME: "operator",
        OPERATOR_CREDENTIAL: "contract-test-api-credential",
        OPERATOR_PROXY_SIGNING_SECRET: "contract-test-signing-secret-long-enough",
        OPERATOR_SUBJECT: "contract-test-operator",
        POSTGRES_PASSWORD: "contract-test-postgres-password",
      },
    },
  );

  return JSON.parse(rendered) as ComposeConfiguration;
}

describe("operator gateway deployment topology", () => {
  it("publishes only the gateway and keeps application dependencies private", () => {
    const compose = loadComposeConfiguration();
    const publishedPorts = compose.services["operator-gateway"]?.ports?.map(
      ({ published, target }) => `${published}:${target}`,
    );

    expect(publishedPorts).toEqual(["8080:8080"]);
    expect(compose.services.web?.ports).toBeUndefined();
    expect(compose.services.api?.ports).toBeUndefined();
    expect(compose.services.postgres?.ports).toBeUndefined();
    expect(compose.services.redis?.ports).toBeUndefined();
    expect(compose.networks.internal?.internal).toBe(true);
  });

  it("gives only the gateway an edge network for host ingress", () => {
    const compose = loadComposeConfiguration();

    expect(Object.keys(compose.services["operator-gateway"]?.networks ?? {}).sort()).toEqual([
      "edge",
      "internal",
    ]);
    for (const serviceName of ["web", "api", "worker", "migrate", "postgres", "redis"]) {
      expect(Object.keys(compose.services[serviceName]?.networks ?? {})).toEqual(["internal"]);
    }
    expect(compose.networks.edge?.internal).not.toBe(true);
  });

  it("marks the gateway healthy only when the public upstream response succeeds", () => {
    const compose = loadComposeConfiguration();
    const healthcheck = compose.services["operator-gateway"]?.healthcheck?.test?.join(" ") ?? "";

    expect(healthcheck).toContain("if(!r.ok)");
    expect(healthcheck).not.toContain("r.status===401");
  });

  it("provides the production provider configuration required by API and worker startup", () => {
    const compose = loadComposeConfiguration();

    for (const serviceName of ["api", "worker"]) {
      expect(compose.services[serviceName]?.environment).toMatchObject({
        DATA_PROVIDER_MODE: "live",
        FOOTBALL_DATA_API_TOKEN: "contract-test-provider-token",
      });
    }
  });

  it("mounts PostgreSQL 18 data at its version-aware parent directory", () => {
    const compose = loadComposeConfiguration();

    expect(compose.services.postgres?.volumes).toEqual([
      expect.objectContaining({
        source: "operator_postgres_data",
        target: "/var/lib/postgresql",
      }),
    ]);
  });

  it("shares the prepared Corepack cache with the non-root runtime user", () => {
    const dockerfile = readFileSync(`${repositoryRoot}/infra/Dockerfile.app`, "utf8");

    expect(dockerfile).toMatch(/^ENV COREPACK_HOME=\S+$/m);
    expect(dockerfile).toMatch(/corepack prepare pnpm@10\.34\.5 --activate/);
    expect(dockerfile).toMatch(/^USER node$/m);
  });

  it("allows the non-root migration process to finalize Prisma engines", () => {
    const dockerfile = readFileSync(`${repositoryRoot}/infra/Dockerfile.app`, "utf8");

    expect(dockerfile).toMatch(
      /DATABASE_URL=postgresql:\/\/localhost:5432\/unused pnpm --filter @bet-stats\/database prisma version/,
    );
    expect(dockerfile).toMatch(
      /chown -R node:node \/app\/node_modules\/\.pnpm\/@prisma\+engines@\*\/node_modules\/@prisma\/engines/,
    );
  });
});
