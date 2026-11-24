import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaCalibrationRepository, createPrismaClient, readStoredCalibratorEvaluation, type CalibrationRepository, type PrismaClient } from "@bet-stats/database";
import type { CalibratorIdentity, ScoreMarket } from "@bet-stats/domain";

import { makeFitted, migrateDeploy, startPostgres, type TestPostgres } from "../helpers/calibration-db.js";

const execFileAsync = promisify(execFile);

let server: TestPostgres;
let client: PrismaClient;
let repository: CalibrationRepository;

/** Every `it` works on its own (identity, market) so tests never interact through the active-calibrator state. */
let scopeCounter = 0;
interface Scope {
  readonly identity: CalibratorIdentity;
  readonly market: ScoreMarket;
}
function nextScope(market: ScoreMarket = "OVER_UNDER_2_5"): Scope {
  scopeCounter += 1;
  const configHash = `sha256:${scopeCounter.toString(16).padStart(2, "0").repeat(32)}`;
  return { identity: { modelVersion: "dixon-coles-ensemble-v1", configHash }, market };
}

let seedCounter = 1000;
/** Persist a fresh calibrator (distinct sample digest) for the scope and return its id. */
async function fresh(scope: Scope): Promise<string> {
  seedCounter += 1;
  const { calibratorId } = await repository.persistCalibrator(makeFitted({ identity: scope.identity, market: scope.market, seed: seedCounter }));
  return calibratorId;
}

let day = 0;
function nextAsOf(): string {
  day += 1;
  return new Date(Date.UTC(2027, 2, 1) + day * 86_400_000).toISOString();
}

const hex = (label: string): string => createHash("sha256").update(label).digest("hex");

type Links = { predecessor?: string; restored?: string; successor?: string };

/** A raw INSERT of an event, bypassing the repository entirely. */
function sqlEvent(type: string, scope: Scope, calibratorId: string, links: Links = {}, label = `${type}-${calibratorId}-${Math.random()}`): string {
  const nullable = (value: string | undefined): string => (value === undefined ? "NULL" : `'${value}'`);
  return `INSERT INTO "CalibratorEvent" (id,type,"modelVersion","configHash",market,"calibratorId","predecessorCalibratorId","restoredCalibratorId","successorCalibratorId","reasonCode","asOf",evaluation,"calibrationConfigVersion","calibrationConfigHash")
    VALUES ('calibrator_event_${hex(label)}','${type}','${scope.identity.modelVersion}','${scope.identity.configHash}','${scope.market}','${calibratorId}',${nullable(links.predecessor)},${nullable(links.restored)},${nullable(links.successor)},'TEST','2027-04-01T00:00:00Z','{}'::jsonb,'calibration-config-v1','sha256:${"c".repeat(64)}');`;
}

const promote = (scope: Scope, calibratorId: string, predecessor: string | null, asOf = nextAsOf()) =>
  repository.promoteCalibrator({ ...scope, calibratorId, predecessorCalibratorId: predecessor, asOf, reasonCode: predecessor === null ? "FIRST_PROMOTION" : "SUPERSEDES_ACTIVE", evaluation: { holdout: true } });

const rollback = (scope: Scope, calibratorId: string, restored: string | null, asOf = nextAsOf()) =>
  repository.rollbackCalibrator({ ...scope, calibratorId, restoredCalibratorId: restored, asOf, reasonCode: "HOLDOUT_REGRESSION", evaluation: { consecutiveWorse: 3 } });

const activeId = async (scope: Scope): Promise<string | null> => (await repository.findActiveCalibrator(scope.identity, scope.market))?.calibratorId ?? null;

const REJECTED = { code: "CALIBRATOR_TRANSITION_REJECTED" };

describe("calibrator event log: permitted transitions are enforced by the database", () => {
  beforeAll(() => {
    server = startPostgres(`bet-stats-calibration-transitions-${process.pid}`);
    migrateDeploy(server.url());
    client = createPrismaClient(server.url());
    repository = createPrismaCalibrationRepository(client);
  }, 240_000);

  afterAll(async () => {
    await client?.$disconnect();
    server?.remove();
  });

  it("accepts a first promotion and rejects a promotion naming a predecessor when nothing is active", async () => {
    const scope = nextScope();
    const [a, b] = [await fresh(scope), await fresh(scope)];
    await expect(promote(scope, a, b)).rejects.toMatchObject(REJECTED);
    expect(() => server.psql(sqlEvent("PROMOTED", scope, a, { predecessor: b }))).toThrow(/CalibratorEvent transition rejected/);
    expect(await activeId(scope)).toBeNull();
    expect((await promote(scope, a, null)).created).toBe(true);
    expect(await activeId(scope)).toBe(a);
  });

  it("rejects a promotion whose predecessor is not the active calibrator, or is NULL while one is active", async () => {
    const scope = nextScope();
    const [a, b, c] = [await fresh(scope), await fresh(scope), await fresh(scope)];
    await promote(scope, a, null);
    await expect(promote(scope, b, c)).rejects.toMatchObject(REJECTED);
    await expect(promote(scope, b, null)).rejects.toMatchObject(REJECTED);
    expect(() => server.psql(sqlEvent("PROMOTED", scope, b, { predecessor: c }))).toThrow(/predecessor/);
    expect(() => server.psql(sqlEvent("PROMOTED", scope, b))).toThrow(/predecessor/);
    // A named predecessor without a SUPERSEDED event is not enough either.
    expect(() => server.psql(sqlEvent("PROMOTED", scope, b, { predecessor: a }))).toThrow(/SUPERSEDED/);
    expect(await activeId(scope)).toBe(a);
  });

  it("supersedes through a SUPERSEDED plus PROMOTED pair and numbers the promotions", async () => {
    const scope = nextScope();
    const [a, b] = [await fresh(scope), await fresh(scope)];
    await promote(scope, a, null);
    const supersedeDay = nextAsOf();
    const result = await promote(scope, b, a, supersedeDay);
    expect(result.created).toBe(true);
    expect(result.supersededEventId).not.toBeNull();
    const active = await repository.findActiveCalibrator(scope.identity, scope.market);
    expect(active).toMatchObject({ calibratorId: b, version: 2, restoreTargetId: a, activatedBy: "PROMOTED" });
    expect((await repository.listCalibratorEvents(a)).map((event) => event.type)).toEqual(["PROMOTED", "SUPERSEDED"]);
    expect((await repository.listCalibratorEvents(b)).map((event) => event.type)).toEqual(["PROMOTED"]);
    // Repeating the same supersession on the same day is a no-op.
    const again = await promote(scope, b, a, supersedeDay);
    expect(again.created).toBe(false);
    expect(again.supersededEventId).toBe(result.supersededEventId);
  });

  it("rejects promoting a calibrator that was already promoted, superseded or rolled back", async () => {
    const scope = nextScope();
    const [a, b, c] = [await fresh(scope), await fresh(scope), await fresh(scope)];
    await promote(scope, a, null);
    await promote(scope, b, a);
    await rollback(scope, b, a);
    // b was rolled back, a was superseded earlier: neither may be promoted again.
    await expect(promote(scope, b, a)).rejects.toMatchObject(REJECTED);
    await expect(promote(scope, a, a)).rejects.toMatchObject(REJECTED);
    expect(() => server.psql(sqlEvent("PROMOTED", scope, b, { predecessor: a }))).toThrow(/already/);
    expect(() => server.psql(sqlEvent("PROMOTED", scope, a))).toThrow(/already/);
    expect(await activeId(scope)).toBe(a);
    // A different candidate can still replace the restored calibrator.
    await promote(scope, c, a);
    expect(await activeId(scope)).toBe(c);
  });

  it("rejects a rollback of a calibrator that is not active", async () => {
    const scope = nextScope();
    const [a, b] = [await fresh(scope), await fresh(scope)];
    await expect(rollback(scope, a, null)).rejects.toMatchObject(REJECTED);
    await promote(scope, a, null);
    await expect(rollback(scope, b, null)).rejects.toMatchObject(REJECTED);
    expect(() => server.psql(sqlEvent("ROLLED_BACK", scope, b, {}))).toThrow(/not the active/);
    await promote(scope, b, a);
    await expect(rollback(scope, a, null)).rejects.toMatchObject(REJECTED);
    expect(() => server.psql(sqlEvent("ROLLED_BACK", scope, a, {}))).toThrow(/not the active/);
    expect(await activeId(scope)).toBe(b);
  });

  it("requires the restored calibrator to equal the predecessor recorded by the PROMOTED event", async () => {
    const scope = nextScope();
    const [a, b, c] = [await fresh(scope), await fresh(scope), await fresh(scope)];
    await promote(scope, a, null);
    await promote(scope, b, a);
    // Wrong target: raw probabilities, or an unrelated calibrator.
    await expect(rollback(scope, b, null)).rejects.toMatchObject(REJECTED);
    await expect(rollback(scope, b, c)).rejects.toMatchObject(REJECTED);
    expect(() => server.psql(sqlEvent("ROLLED_BACK", scope, b, {}))).toThrow(/restore target/);
    expect(() => server.psql(sqlEvent("ROLLED_BACK", scope, b, { restored: c }))).toThrow(/restore target/);
    // The first promotion has no predecessor: its only valid target is "no calibrator".
    await rollback(scope, b, a);
    await expect(rollback(scope, a, a)).rejects.toMatchObject(REJECTED);
    expect(await activeId(scope)).toBe(a);
  });

  it("restores the predecessor with its own version number, or raw probabilities when there is none", async () => {
    const scope = nextScope("BTTS");
    const [a, b] = [await fresh(scope), await fresh(scope)];
    await promote(scope, a, null);
    await promote(scope, b, a);
    expect(await repository.hasBeenRolledBack(b)).toBe(false);
    expect((await rollback(scope, b, a)).created).toBe(true);
    const restored = await repository.findActiveCalibrator(scope.identity, scope.market);
    expect(restored).toMatchObject({ calibratorId: a, version: 1, activatedBy: "ROLLED_BACK", restoreTargetId: null });
    expect(await repository.hasBeenRolledBack(b)).toBe(true);
    expect(await repository.hasBeenRolledBack(a)).toBe(false);
    // Rolling the first calibrator back leaves no active calibrator: raw probabilities only.
    await rollback(scope, a, null);
    expect(await repository.findActiveCalibrator(scope.identity, scope.market)).toBeNull();
    expect(await repository.hasBeenRolledBack(a)).toBe(true);
    // With nothing active a new first promotion is allowed again.
    const c = await fresh(scope);
    await promote(scope, c, null);
    expect(await repository.findActiveCalibrator(scope.identity, scope.market)).toMatchObject({ calibratorId: c, version: 3 });
  });

  it("records evaluations of the active calibrator only, without changing it, once per day", async () => {
    const scope = nextScope("ONE_X_TWO");
    const [a, b] = [await fresh(scope), await fresh(scope)];
    const evaluation = { sampleSize: 42, eligible: true, verdict: "WORSE" as const, brierRaw: 0.5, brierCalibrated: 0.51, delta: 0.01 };
    const input = (calibratorId: string, asOf: string) => ({ ...scope, calibratorId, asOf, reasonCode: "EVALUATION", evaluation });
    await expect(repository.recordEvaluation(input(a, nextAsOf()))).rejects.toMatchObject(REJECTED);
    await promote(scope, a, null);
    await expect(repository.recordEvaluation(input(b, nextAsOf()))).rejects.toMatchObject(REJECTED);
    expect(() => server.psql(sqlEvent("EVALUATED", scope, b))).toThrow(/not the active/);

    const asOf = nextAsOf();
    const first = await repository.recordEvaluation(input(a, asOf));
    expect(first.created).toBe(true);
    expect((await repository.recordEvaluation(input(a, asOf))).created).toBe(false);
    expect((await repository.recordEvaluation(input(a, nextAsOf()))).created).toBe(true);
    const active = await repository.findActiveCalibrator(scope.identity, scope.market);
    expect(active).toMatchObject({ calibratorId: a, version: 1 });

    const evaluated = (await repository.listCalibratorEvents(a)).filter((event) => event.type === "EVALUATED");
    expect(evaluated).toHaveLength(2);
    expect(evaluated.every((event) => event.seq > active!.activationSeq)).toBe(true);
    expect(readStoredCalibratorEvaluation(evaluated[0]!.evaluation)).toEqual(evaluation);
    expect(readStoredCalibratorEvaluation({ sampleSize: 1 })).toBeNull();
    expect(readStoredCalibratorEvaluation({ ...evaluation, verdict: "AWFUL" })).toBeNull();
  });

  it("allows a SUPERSEDED event only for the active calibrator and a fresh distinct successor", async () => {
    const scope = nextScope();
    const [a, b, c] = [await fresh(scope), await fresh(scope), await fresh(scope)];
    expect(() => server.psql(sqlEvent("SUPERSEDED", scope, a, { successor: b }))).toThrow(/not the active/);
    await promote(scope, a, null);
    expect(() => server.psql(sqlEvent("SUPERSEDED", scope, b, { successor: c }))).toThrow(/not the active/);
    expect(() => server.psql(sqlEvent("SUPERSEDED", scope, a, { successor: a }))).toThrow(/successor|check constraint/);
    await promote(scope, b, a);
    // c already has events? Not yet; but a successor that was promoted before is refused.
    expect(() => server.psql(sqlEvent("SUPERSEDED", scope, b, { successor: a }))).toThrow(/successor/);
    expect(await activeId(scope)).toBe(b);
  });

  it("never lets two concurrent promotions through the repository both succeed", async () => {
    for (let round = 0; round < 3; round += 1) {
      const scope = nextScope();
      const [a, b] = [await fresh(scope), await fresh(scope)];
      const settled = await Promise.allSettled([promote(scope, a, null), promote(scope, b, null)]);
      expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
      const rejected = settled.find((entry) => entry.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject(REJECTED);
      expect(server.lines(`SELECT count(*) FROM current_calibrators WHERE "configHash"='${scope.identity.configHash}';`)).toEqual(["1"]);
      expect([a, b]).toContain(await activeId(scope));
    }
  });

  it("never lets two concurrent supersessions of the same active calibrator both succeed", async () => {
    const scope = nextScope();
    const [a, b, c] = [await fresh(scope), await fresh(scope), await fresh(scope)];
    await promote(scope, a, null);
    const settled = await Promise.allSettled([promote(scope, b, a), promote(scope, c, a)]);
    expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect((settled.find((entry) => entry.status === "rejected") as PromiseRejectedResult).reason).toMatchObject(REJECTED);
    expect([b, c]).toContain(await activeId(scope));
    expect(server.lines(`SELECT count(*) FROM "CalibratorEvent" WHERE type='SUPERSEDED' AND "calibratorId"='${a}';`)).toEqual(["1"]);
  });

  it("serialises concurrent raw-SQL promotions through the trigger's own lock", async () => {
    const scope = nextScope();
    const [a, b] = [await fresh(scope), await fresh(scope)];
    const run = (statement: string) => execFileAsync("docker", ["exec", "-i", server.container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "bet_stats", "-At", "-c", statement]);
    const settled = await Promise.allSettled([run(sqlEvent("PROMOTED", scope, a)), run(sqlEvent("PROMOTED", scope, b))]);
    expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(String((settled.find((entry) => entry.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/CalibratorEvent transition rejected/);
    expect(server.lines(`SELECT count(*) FROM current_calibrators WHERE "configHash"='${scope.identity.configHash}';`)).toEqual(["1"]);
  });

  it("re-draws the event order after the lock is held, so seq follows the admission order", async () => {
    const scope = nextScope();
    const a = await fresh(scope);
    // The identity default draws first (1000001); the trigger draws again once it holds the lock (1000002).
    server.psql(`SELECT setval(pg_get_serial_sequence('"CalibratorEvent"', 'seq'), 1000000);`);
    server.psql(sqlEvent("PROMOTED", scope, a));
    expect(server.lines(`SELECT seq FROM "CalibratorEvent" WHERE "calibratorId"='${a}';`)).toEqual(["1000002"]);
  });

  it("walks the full series: promote, supersede, roll back, roll back again, with every event kept in order", async () => {
    const scope = nextScope("OVER_UNDER_2_5");
    const [a, b] = [await fresh(scope), await fresh(scope)];
    await promote(scope, a, null);
    await promote(scope, b, a);
    await rollback(scope, b, a);
    expect(await repository.findActiveCalibrator(scope.identity, scope.market)).toMatchObject({ calibratorId: a, version: 1 });
    await rollback(scope, a, null);
    expect(await repository.findActiveCalibrator(scope.identity, scope.market)).toBeNull();

    const log = server.lines(`SELECT seq || ':' || type || ':' || "calibratorId" FROM "CalibratorEvent" WHERE "configHash"='${scope.identity.configHash}' ORDER BY seq;`);
    const sequence = log.map((line) => line.split(":")[1]);
    expect(sequence).toEqual(["PROMOTED", "SUPERSEDED", "PROMOTED", "ROLLED_BACK", "ROLLED_BACK"]);
    const seqs = log.map((line) => Number(line.split(":")[0]));
    expect([...seqs].sort((left, right) => left - right)).toEqual(seqs);
    // Nothing was updated or deleted along the way.
    expect(server.lines(`SELECT count(*) FROM "CalibratorEvent" WHERE "configHash"='${scope.identity.configHash}';`)).toEqual(["5"]);
    const events = await repository.listCalibratorEvents(b);
    expect(events.map((event) => `${event.type}:${event.reasonCode}`)).toEqual(["PROMOTED:SUPERSEDES_ACTIVE", "ROLLED_BACK:HOLDOUT_REGRESSION"]);
    expect(events[1]!.evaluation).toEqual({ consecutiveWorse: 3 });
    expect(events[1]!.restoredCalibratorId).toBe(a);
  });

  it("keeps a repository transition rejection coded and preserves the original database message as the cause", async () => {
    const scope = nextScope();
    const a = await fresh(scope);
    const error = await rollback(scope, a, null).catch((caught: unknown) => caught as Error & { code?: string });
    expect(error).toMatchObject(REJECTED);
    expect(String((error as Error).cause)).toMatch(/CalibratorEvent transition rejected/);
  });
});
