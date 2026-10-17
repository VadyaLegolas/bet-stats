import { afterAll, describe, expect, it, vi } from "vitest";

// Shared harness state: vi.mock factories are hoisted above module evaluation, so the
// state they close over must be created by vi.hoisted (runs before imports resolve).
const harness = vi.hoisted(() => ({
  db: null as unknown,
  fetchImpl: null as unknown as ((window: unknown, options?: unknown) => Promise<unknown>) | null,
  fetchCalls: [] as Array<{ window: unknown; options: unknown }>,
  order: [] as string[],
  maxObservedRows: [] as Array<{ observedAt: Date | null }>,
  statements: [] as Array<{ kind: "execute" | "query"; sql: string; params: unknown[] }>,
  leagues: [] as Array<Record<string, unknown>>,
  seasons: [] as Array<Record<string, unknown>>,
  capability: null as Record<string, unknown> | null,
  seasonRefs: [] as Array<Record<string, unknown>>,
  teamRefs: [] as Array<Record<string, unknown>>,
  fixtureRefs: [] as Array<Record<string, unknown>>,
  fixtures: [] as Array<Record<string, unknown>>,
  receipts: [] as Array<Record<string, unknown>>,
  attempts: [] as Array<Record<string, unknown>>,
  observations: [] as Array<Record<string, unknown>>,
}));

// The service graph resolves @bet-stats/* through apps/api/node_modules to the built
// package dist (the vitest source alias only applies to test-file imports), so the mock
// keys must target the dist entry points the service actually imports.
vi.mock("../../packages/database/dist/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bet-stats/database")>();
  return { ...actual, createPrismaClient: () => harness.db };
});

vi.mock("../../packages/football-data/dist/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bet-stats/football-data")>();
  class FakeFootballDataOrgClient {
    constructor(_config: unknown) {}
    async fetchCompetitionFixtures(window: unknown, options?: unknown) {
      harness.fetchCalls.push({ window, options });
      harness.order.push("fetch");
      if (!harness.fetchImpl) throw new Error("fetchImpl is not configured for this test");
      return harness.fetchImpl(window, options);
    }
  }
  return { ...actual, FootballDataOrgClient: FakeFootballDataOrgClient as unknown as typeof actual.FootballDataOrgClient };
});

import { FixturesSyncService } from "../../apps/api/src/modules/fixtures/fixtures-sync.service.js";
import { projectProviderState } from "../../apps/api/src/modules/fixtures/fixtures.service.js";

// Env pins must be in place before `new FixturesSyncService()` reads readServerConfig()
// in the class field initializer; originals are restored in afterAll.
const originalEnv = {
  DATA_PROVIDER_MODE: process.env.DATA_PROVIDER_MODE,
  DATABASE_URL: process.env.DATABASE_URL,
  FOOTBALL_DATA_API_TOKEN: process.env.FOOTBALL_DATA_API_TOKEN,
};
process.env.DATA_PROVIDER_MODE = "live";
process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/betstats-test";
process.env.FOOTBALL_DATA_API_TOKEN = "test-token";

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const LEAGUE_ROW = {
  id: "league-pl",
  name: "Premier League",
  countryCode: "EN",
  externalRefs: [{ provider: "football-data.org", externalId: "PL" }],
};
const SEASON_ROW = {
  id: "season-2026",
  leagueId: "league-pl",
  label: "2026/27",
  startsOn: new Date("2026-07-01T00:00:00.000Z"),
  endsOn: new Date("2027-06-30T23:59:59.000Z"),
  externalRefs: [{ provider: "football-data.org", externalId: "2026" }],
};
const CAPABILITY_ROW = {
  provider: "football-data.org",
  leagueId: "league-pl",
  seasonId: "season-2026",
  endpoint: "FIXTURES",
  supported: true,
  verifiedAt: new Date("2026-10-01T00:00:00.000Z"),
  expiresAt: null,
};
const SEASON_REF_ROW = { id: "season-ref-pl-2026", provider: "football-data.org", leagueId: "league-pl", seasonId: "season-2026", externalId: "2026" };
const TEAM_REF_HOME = { id: "team-ref-arsenal", provider: "football-data.org", externalId: "team-10", teamId: "team-arsenal" };
const TEAM_REF_AWAY = { id: "team-ref-chelsea", provider: "football-data.org", externalId: "team-11", teamId: "team-chelsea" };

// One unchanged provider payload: capturedAt is the fetch instant (the confirmation time
// under test), sourceUpdatedAt is the provider's own older record-change time.
const UNCHANGED_FIXTURE = {
  provider: "football-data.org",
  externalId: "fixture-1000",
  competitionExternalId: "PL",
  seasonExternalId: "2026",
  homeTeamExternalId: "team-10",
  homeTeamName: "Arsenal",
  awayTeamExternalId: "team-11",
  awayTeamName: "Chelsea",
  kickoffUtc: "2026-10-18T15:00:00.000Z",
  status: "SCHEDULED",
  capturedAt: "2026-10-16T06:00:00.000Z",
  sourceUpdatedAt: "2026-10-14T09:00:00.000Z",
  raw: { id: 1000, utcDate: "2026-10-18T15:00:00.000Z", status: "SCHEDULED", lastUpdated: "2026-10-14T09:00:00Z" },
};

function createFakeDb() {
  const capture = (kind: "execute" | "query", sql: string, params: unknown[]): void => {
    harness.statements.push({ kind, sql, params });
  };
  const db = {
    league: { findMany: async () => harness.leagues },
    season: { findMany: async () => harness.seasons },
    providerCapability: { findUnique: async () => harness.capability },
    seasonExternalRef: {
      findFirst: async ({ where }: { where: Record<string, string | undefined> }) =>
        harness.seasonRefs.find((row) =>
          (!where.provider || row.provider === where.provider)
          && (!where.leagueId || row.leagueId === where.leagueId)
          && (!where.seasonId || row.seasonId === where.seasonId)
          && (!where.externalId || row.externalId === where.externalId)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `season-ref-${harness.seasonRefs.length}`, ...data };
        harness.seasonRefs.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = harness.seasonRefs.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error("SEASON_REF_NOT_FOUND");
        Object.assign(row, data);
        return row;
      },
    },
    teamExternalRef: {
      findUnique: async ({ where }: { where: { provider_externalId: { provider: string; externalId: string } } }) =>
        harness.teamRefs.find((row) => row.provider === where.provider_externalId.provider && row.externalId === where.provider_externalId.externalId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `team-ref-${harness.teamRefs.length}`, ...data };
        harness.teamRefs.push(row);
        return row;
      },
    },
    team: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: `team-${harness.teamRefs.length}`, ...data }),
    },
    fixtureExternalRef: {
      findUnique: async ({ where }: { where: { provider_externalId: { provider: string; externalId: string } } }) =>
        harness.fixtureRefs.find((row) => row.provider === where.provider_externalId.provider && row.externalId === where.provider_externalId.externalId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data };
        harness.fixtureRefs.push(row);
        return row;
      },
    },
    fixture: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, updatedAt: new Date() };
        harness.fixtures.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = harness.fixtures.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error("FIXTURE_NOT_FOUND");
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    sourceObservation: {
      findFirst: async ({ where }: { where: { provider: string; endpointFamily: string; payloadHash: string } }) =>
        harness.observations.find((row) => row.provider === where.provider && row.endpointFamily === where.endpointFamily && row.payloadHash === where.payloadHash) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => harness.observations.find((row) => row.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { createdAt: new Date(), ...data };
        harness.observations.push(row);
        return row;
      },
    },
    providerRouteReceipt: {
      findUnique: async ({ where, include }: { where: { id: string }; include?: { attempts?: boolean } }) => {
        const row = harness.receipts.find((candidate) => candidate.id === where.id);
        if (!row) return null;
        return include?.attempts ? { ...row, attempts: harness.attempts.filter((attempt) => attempt.routeReceiptId === row.id) } : row;
      },
      create: async ({ data, include }: { data: Record<string, unknown>; include?: { attempts?: boolean } }) => {
        const row = { createdAt: new Date(), ...data };
        harness.receipts.push(row);
        return include?.attempts ? { ...row, attempts: [] } : row;
      },
    },
    providerRouteAttempt: {
      findUnique: async ({ where }: { where: { attemptKey: string } }) => harness.attempts.find((row) => row.attemptKey === where.attemptKey) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { createdAt: new Date(), ...data };
        harness.attempts.push(row);
        return row;
      },
    },
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      capture("query", sql, params);
      if (sql.includes('MAX(p."observedAt")')) {
        harness.order.push("skip-query");
        return harness.maxObservedRows;
      }
      if (sql.includes("EXISTS")) return [{ exists: false }];
      if (sql.includes("count(*)")) return [{ count: 0n }];
      return [];
    },
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
      capture("execute", sql, params);
      return 1;
    },
    $transaction: async <T,>(arg: T[] | ((transaction: typeof db) => Promise<unknown>)): Promise<unknown> =>
      Array.isArray(arg) ? Promise.all(arg) : arg(db),
    $disconnect: async () => undefined,
  };
  return db;
}

function resetHarness(options: { maxObservedRows?: Array<{ observedAt: Date | null }> } = {}): void {
  harness.db = createFakeDb();
  harness.fetchImpl = null;
  harness.fetchCalls = [];
  harness.order = [];
  harness.maxObservedRows = options.maxObservedRows ?? [{ observedAt: null }];
  harness.statements = [];
  harness.leagues = [{ ...LEAGUE_ROW, externalRefs: LEAGUE_ROW.externalRefs.map((ref) => ({ ...ref })) }];
  harness.seasons = [{ ...SEASON_ROW, startsOn: new Date(SEASON_ROW.startsOn), endsOn: new Date(SEASON_ROW.endsOn) }];
  harness.capability = { ...CAPABILITY_ROW, verifiedAt: new Date(CAPABILITY_ROW.verifiedAt), expiresAt: null };
  harness.seasonRefs = [{ ...SEASON_REF_ROW }];
  harness.teamRefs = [{ ...TEAM_REF_HOME }, { ...TEAM_REF_AWAY }];
  harness.fixtureRefs = [];
  harness.fixtures = [];
  harness.receipts = [];
  harness.attempts = [];
  harness.observations = [];
}

function provenanceStatements(): Array<{ kind: string; sql: string; params: unknown[] }> {
  return harness.statements.filter((statement) => statement.sql.includes('INSERT INTO "FixtureProvenance"'));
}

describe("fixtures live sync (emulated db)", () => {
  it("re-confirms an unchanged payload by upserting provenance observedAt", async () => {
    resetHarness();
    harness.fetchImpl = async () => [UNCHANGED_FIXTURE];
    const service = new FixturesSyncService();

    const result = await service.sync({});

    // League gates resolve: capability granted, skip gate open (no recent observation), one chunk fetched.
    expect(result.results).toEqual([{ league: "Premier League", status: "synced", fixtures: 1 }]);

    const provenance = provenanceStatements();
    expect(provenance).toHaveLength(1);
    const statement = provenance[0]!;
    expect(statement.sql).toContain('ON CONFLICT ("provider", "payloadHash") DO UPDATE SET');
    expect(statement.sql).toContain('"observedAt" = EXCLUDED."observedAt"');
    expect(statement.sql).toContain('"sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt"');
    // Only the confirmation time moves: payload identity and raw evidence stay immutable.
    expect(statement.sql).not.toContain('EXCLUDED."rawPayload"');
    expect(statement.sql).not.toContain('EXCLUDED."payloadHash"');
    expect(statement.sql).not.toContain('EXCLUDED."id"');
    expect(statement.params[3]).toBe(UNCHANGED_FIXTURE.capturedAt);

    const reservation = harness.statements.find((entry) => entry.sql.includes('INSERT INTO "ProviderRequestReservation"'));
    expect(reservation).toBeDefined();
    expect(String(reservation!.params[3])).toMatch(/^manual-fixtures-sync:/);

    // The non-force skip gate runs before any provider fetch.
    expect(harness.order.indexOf("skip-query")).toBeGreaterThanOrEqual(0);
    expect(harness.order.indexOf("skip-query")).toBeLessThan(harness.order.indexOf("fetch"));
    expect(harness.fetchCalls).toHaveLength(1);
    expect((harness.fetchCalls[0]!.window as { competitionCode: string }).competitionCode).toBe("PL");
  }, 30_000);

  it("records a route receipt, a SUCCEEDED attempt and a linked observation on a synced league", async () => {
    resetHarness();
    harness.fetchImpl = async () => [UNCHANGED_FIXTURE];
    const service = new FixturesSyncService();

    const startedAt = Date.now();
    const result = await service.sync({});
    const finishedAt = Date.now();

    expect(result.results).toEqual([{ league: "Premier League", status: "synced", fixtures: 1 }]);

    // Exactly one FIXTURES observation, identified by the run correlation id.
    expect(harness.observations).toHaveLength(1);
    const observation = harness.observations[0]!;
    expect(harness.receipts).toHaveLength(1);
    const receipt = harness.receipts[0]!;

    expect(observation.provider).toBe("football-data.org");
    expect(observation.endpointFamily).toBe("FIXTURES");
    expect(observation.externalIdentity).toBe(receipt.correlationId);
    const observedAt = observation.observedAt as Date;
    expect(observedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(observedAt.getTime()).toBeLessThanOrEqual(finishedAt);
    const rawPayload = observation.rawPayload as { correlationId: string; competitionCode: string; dateFrom: string; dateTo: string; matches: Array<unknown> };
    expect(rawPayload.matches).toEqual([UNCHANGED_FIXTURE.raw]);
    expect(rawPayload.correlationId).toBe(receipt.correlationId);
    expect(rawPayload.competitionCode).toBe("PL");
    expect(rawPayload.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rawPayload.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(observation.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(observation.payloadBytes).toBe(Buffer.byteLength(JSON.stringify(rawPayload)));

    // Receipt mirrors the worker's durable end-state for this league/season scope.
    expect(receipt.competitionId).toBe("league-pl");
    expect(receipt.seasonId).toBe("season-2026");
    expect(receipt.endpointFamily).toBe("FIXTURES");
    expect(receipt.selectedProvider).toBe("football-data.org");
    expect(receipt.trigger).toBe("PRIMARY");
    expect(receipt.outcome).toBe("ADMITTED");
    expect(receipt.policyVersion).toBe("provider-route-policy/v1");
    expect(receipt.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.correlationId).toMatch(/^manual-fixtures-sync:/);
    expect(receipt.candidates).toEqual(["football-data.org", "api-football"]);

    expect(harness.attempts).toHaveLength(1);
    const attempt = harness.attempts[0]!;
    expect(attempt.state).toBe("SUCCEEDED");
    expect(attempt.admitted).toBe(true);
    expect(attempt.provider).toBe("football-data.org");
    expect(attempt.reason).toBeNull();
    expect(attempt.observationId).toBe(observation.id);
    expect(attempt.routeReceiptId).toBe(receipt.id);
    expect(String(attempt.attemptKey).length).toBeGreaterThan(0);
  }, 30_000);

  it("projects the recorded receipt as PRIMARY with the observation capture time", () => {
    // Reuses the rows recorded by the previous test (sequential execution in this file).
    expect(harness.receipts).toHaveLength(1);
    const receipt = harness.receipts[0]!;
    const attempt = harness.attempts[0]!;
    const observation = harness.observations[0]!;
    const fetchesBefore = harness.fetchCalls.length;

    const projection = projectProviderState({
      id: receipt.id as string,
      policyVersion: receipt.policyVersion as string,
      selectedProvider: receipt.selectedProvider as string,
      candidates: receipt.candidates,
      trigger: receipt.trigger as string,
      outcome: receipt.outcome as string,
      createdAt: receipt.createdAt as Date,
      attempts: [{ state: attempt.state as string, provider: attempt.provider as string | null, reason: attempt.reason as string | null, createdAt: attempt.createdAt as Date, observation: { observedAt: observation.observedAt as Date } }],
    });

    expect(projection.state).toBe("PRIMARY");
    expect(projection.receipt?.outcome).toBe("SUCCEEDED");
    expect(projection.capturedAt).toBe((observation.observedAt as Date).toISOString());
    expect(harness.fetchCalls).toHaveLength(fetchesBefore);
  });

  it("records nothing when a recent observation skips the league", async () => {
    resetHarness({ maxObservedRows: [{ observedAt: new Date(Date.now() - 30 * 60_000) }] });
    const service = new FixturesSyncService();

    const result = await service.sync({});

    expect(result.results).toEqual([{ league: "Premier League", status: "skipped", fixtures: 0, reason: "RECENTLY_SYNCED" }]);
    expect(harness.fetchCalls).toHaveLength(0);
    expect(harness.receipts).toHaveLength(0);
    expect(harness.attempts).toHaveLength(0);
    expect(harness.observations).toHaveLength(0);
  });

  it("records nothing when the provider call fails with 403", async () => {
    resetHarness();
    harness.fetchImpl = async () => {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    };
    const service = new FixturesSyncService();

    const result = await service.sync({});

    expect(result.results).toEqual([{ league: "Premier League", status: "failed", fixtures: 0, reason: "PROVIDER_ACCESS_RESTRICTED" }]);
    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.receipts).toHaveLength(0);
    expect(harness.attempts).toHaveLength(0);
    expect(harness.observations).toHaveLength(0);
  }, 30_000);
});
