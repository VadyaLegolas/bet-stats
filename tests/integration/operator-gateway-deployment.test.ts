import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const optionalKeys = [
  "API_FOOTBALL_API_KEY",
  "ELIGIBILITY_ALLOWED_REGIONS",
  "ELIGIBILITY_REGION",
  "ELIGIBILITY_AGE_ACKNOWLEDGED",
] as const;

function loadComposeConfiguration(overrides: Record<string, string> = {}): ComposeConfiguration {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FOOTBALL_DATA_API_TOKEN: "contract-test-provider-token",
    OPERATOR_BASIC_PASSWORD: "contract-test-basic-password",
    OPERATOR_BASIC_USERNAME: "operator",
    OPERATOR_CREDENTIAL: "contract-test-api-credential",
    OPERATOR_PROXY_SIGNING_SECRET: "contract-test-signing-secret-long-enough",
    OPERATOR_SUBJECT: "contract-test-operator",
    POSTGRES_PASSWORD: "contract-test-postgres-password",
  };
  for (const key of optionalKeys) delete env[key];

  // An empty env file keeps a developer's local infra/.env out of the contract.
  const directory = mkdtempSync(join(tmpdir(), "operator-compose-"));
  const emptyEnvFile = join(directory, "empty.env");
  writeFileSync(emptyEnvFile, "");

  try {
    const rendered = execFileSync(
      "docker",
      ["compose", "-f", composeFile, "--env-file", emptyEnvFile, "config", "--format", "json"],
      { cwd: repositoryRoot, encoding: "utf8", env: { ...env, ...overrides } },
    );

    return JSON.parse(rendered) as ComposeConfiguration;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("operator gateway deployment topology", () => {
  it("publishes only the gateway and keeps application dependencies private", () => {
    const compose = loadComposeConfiguration();
    const publishedPorts = compose.services["operator-gateway"]?.ports?.map(
      ({ published, target }) => `${published}:${target}`,
    );

    expect(publishedPorts).toEqual(["8080:8080"]);
    for (const serviceName of ["web", "api", "worker", "migrate", "postgres", "redis"]) {
      expect(compose.services[serviceName]?.ports).toBeUndefined();
      expect(compose.services[serviceName]).not.toHaveProperty("network_mode");
    }
    expect(compose.networks.internal?.internal).toBe(true);
  });

  it("gives only the gateway an edge network for host ingress", () => {
    const compose = loadComposeConfiguration();

    expect(Object.keys(compose.services["operator-gateway"]?.networks ?? {}).sort()).toEqual([
      "edge",
      "internal",
    ]);
    for (const serviceName of ["web", "migrate", "postgres", "redis"]) {
      expect(Object.keys(compose.services[serviceName]?.networks ?? {})).toEqual(["internal"]);
    }
    expect(compose.networks.edge?.internal).not.toBe(true);
  });

  it("gives only the provider clients a separate outbound network", () => {
    const compose = loadComposeConfiguration();
    const egressMembers = Object.entries(compose.services)
      .filter(([, service]) => "egress" in (service.networks ?? {}))
      .map(([serviceName]) => serviceName)
      .sort();

    expect(egressMembers).toEqual(["api", "worker"]);
    for (const serviceName of egressMembers) {
      expect(Object.keys(compose.services[serviceName]?.networks ?? {}).sort()).toEqual([
        "egress",
        "internal",
      ]);
    }
    expect(compose.networks.egress).toBeDefined();
    expect(compose.networks.egress?.internal).not.toBe(true);
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

  it("passes the API-Football key and the eligibility inputs to the services that read them", () => {
    const compose = loadComposeConfiguration({
      API_FOOTBALL_API_KEY: "contract-test-api-football-key",
      ELIGIBILITY_ALLOWED_REGIONS: "PL,DE",
      ELIGIBILITY_REGION: "PL",
      ELIGIBILITY_AGE_ACKNOWLEDGED: "true",
    });

    for (const serviceName of ["api", "worker"]) {
      expect(compose.services[serviceName]?.environment).toMatchObject({
        API_FOOTBALL_API_KEY: "contract-test-api-football-key",
      });
    }
    expect(compose.services.api?.environment).toMatchObject({ ELIGIBILITY_ALLOWED_REGIONS: "PL,DE" });
    expect(compose.services.web?.environment).toMatchObject({
      ELIGIBILITY_REGION: "PL",
      ELIGIBILITY_AGE_ACKNOWLEDGED: "true",
    });
    expect(compose.services.web?.environment).not.toHaveProperty("API_FOOTBALL_API_KEY");
  });

  it("stays closed when the API-Football key and the eligibility inputs are absent", () => {
    const compose = loadComposeConfiguration();

    for (const serviceName of ["api", "worker"]) {
      expect(compose.services[serviceName]?.environment).toMatchObject({ API_FOOTBALL_API_KEY: "" });
    }
    expect(compose.services.api?.environment).toMatchObject({ ELIGIBILITY_ALLOWED_REGIONS: "" });
    expect(compose.services.web?.environment).toMatchObject({
      ELIGIBILITY_REGION: "",
      ELIGIBILITY_AGE_ACKNOWLEDGED: "false",
    });
  });

  it("documents the same variables in .env.example with access closed by default", () => {
    const example = readFileSync(`${repositoryRoot}/.env.example`, "utf8");

    expect(example).toMatch(/^DATABASE_URL=postgresql:\/\//m);
    // Commented out: an empty value fails readServerConfig even outside production.
    expect(example).toMatch(/^# API_FOOTBALL_API_KEY=\r?$/m);
    expect(example).toMatch(/^ELIGIBILITY_ALLOWED_REGIONS=\r?$/m);
    expect(example).toMatch(/^ELIGIBILITY_REGION=\r?$/m);
    expect(example).toMatch(/^ELIGIBILITY_AGE_ACKNOWLEDGED=false\r?$/m);
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

  it("copies the root build script into the image before running the build", () => {
    const dockerfile = readFileSync(`${repositoryRoot}/infra/Dockerfile.app`, "utf8");
    const copyIndex = dockerfile.search(/^COPY scripts\/build\.mjs \.\/scripts\/build\.mjs\r?$/m);

    expect(copyIndex).toBeGreaterThan(-1);
    expect(copyIndex).toBeLessThan(dockerfile.search(/^RUN pnpm build\r?$/m));
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
