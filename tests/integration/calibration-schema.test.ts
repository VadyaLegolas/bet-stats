import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaCalibrationRepository, createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { calibratorContentId } from "@bet-stats/domain";

import {
  makeFitted,
  migrateDeploy,
  OTHER_CONFIG_IDENTITY,
  OTHER_MODEL_IDENTITY,
  startPostgres,
  TEST_IDENTITY,
  type TestPostgres,
} from "../helpers/calibration-db.js";

let server: TestPostgres;
let client: PrismaClient;

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

/** Direct-SQL insert of a Calibrator row; `overrides` replaces whole column values (already SQL literals). */
function calibratorInsert(id: string, overrides: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    id: `'${id}'`,
    modelVersion: "'dixon-coles-ensemble-v1'",
    configHash: `'${sha("a")}'`,
    market: "'OVER_UNDER_2_5'",
    method: "'PLATT'",
    parameters: `'{"epsilon":0.000001,"scalers":[]}'::jsonb`,
    calibrationConfigVersion: "'calibration-config-v1'",
    calibrationConfigHash: `'${sha("c")}'`,
    samplesDigest: `'${sha("d")}'`,
    fitSampleSize: "320",
    holdoutSampleSize: "80",
    fitWindowFrom: "'2026-01-01T00:00:00Z'",
    fitWindowTo: "'2026-06-01T00:00:00Z'",
    holdoutFrom: "'2026-06-02T00:00:00Z'",
    holdoutTo: "'2026-08-01T00:00:00Z'",
    fitAsOf: "'2026-08-02T00:00:00Z'",
    holdoutBrierRaw: "0.5",
    holdoutBrierCalibrated: "0.45",
    ...overrides,
  };
  const columns = Object.keys(values).map((name) => `"${name}"`).join(",");
  return `INSERT INTO "Calibrator" (${columns}) VALUES (${Object.values(values).join(",")});`;
}

const calibratorId = (character: string): string => `calibrator_${character.repeat(64)}`;
const eventId = (character: string): string => `calibrator_event_${character.repeat(64)}`;

function eventInsert(id: string, overrides: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    id: `'${id}'`,
    type: "'PROMOTED'",
    modelVersion: "'dixon-coles-ensemble-v1'",
    configHash: `'${sha("a")}'`,
    market: "'OVER_UNDER_2_5'",
    calibratorId: `'${calibratorId("1")}'`,
    reasonCode: "'FIRST_PROMOTION'",
    asOf: "'2026-08-03T00:00:00Z'",
    evaluation: "'{}'::jsonb",
    calibrationConfigVersion: "'calibration-config-v1'",
    calibrationConfigHash: `'${sha("c")}'`,
    ...overrides,
  };
  const columns = Object.keys(values).map((name) => `"${name}"`).join(",");
  return `INSERT INTO "CalibratorEvent" (${columns}) VALUES (${Object.values(values).join(",")});`;
}

/**
 * The structural tests below insert raw events that are not valid lifecycle transitions. The transition guard is
 * proved in calibration-transitions.test.ts; here it is switched off around the statement under test so that the
 * constraint being examined (foreign key, CHECK, append-only trigger) is the one that answers.
 */
function withoutTransitionGuard(run: () => void): void {
  server.psql('ALTER TABLE "CalibratorEvent" DISABLE TRIGGER "CalibratorEvent_guarded_transition";');
  try {
    run();
  } finally {
    server.psql('ALTER TABLE "CalibratorEvent" ENABLE TRIGGER "CalibratorEvent_guarded_transition";');
  }
}

describe("calibrator storage: append-only tables, pinned identity, event-derived active calibrator", () => {
  beforeAll(() => {
    server = startPostgres(`bet-stats-calibration-schema-${process.pid}`);
    migrateDeploy(server.url());
    client = createPrismaClient(server.url());
  }, 240_000);

  afterAll(async () => {
    await client?.$disconnect();
    server?.remove();
  });

  it("creates the tables and both views on an empty database", () => {
    expect(server.lines(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('Calibrator','CalibratorEvent') ORDER BY 1;`)).toEqual(["Calibrator", "CalibratorEvent"]);
    expect(server.lines(`SELECT viewname FROM pg_views WHERE schemaname='public' AND viewname IN ('current_calibrators','calibrator_versions') ORDER BY 1;`)).toEqual(["calibrator_versions", "current_calibrators"]);
    expect(server.lines(`SELECT trigger_name FROM information_schema.triggers WHERE event_object_schema='public' AND event_object_table IN ('Calibrator','CalibratorEvent') GROUP BY trigger_name ORDER BY 1;`))
      .toEqual(expect.arrayContaining(["Calibrator_append_only", "CalibratorEvent_append_only"]));
  });

  it("has the composite identity key and the four composite foreign keys with ON DELETE RESTRICT", () => {
    expect(server.lines(`SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.relname='Calibrator' AND i.indisunique ORDER BY 1;`).join("\n"))
      .toMatch(/\(id, "modelVersion", "configHash", market\)/);
    const keys = server.lines(`SELECT conname || '|' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='"CalibratorEvent"'::regclass AND contype='f' ORDER BY conname;`);
    expect(keys).toHaveLength(4);
    for (const definition of keys) {
      expect(definition).toContain('REFERENCES "Calibrator"(id, "modelVersion", "configHash", market)');
      expect(definition).toContain("ON DELETE RESTRICT");
    }
    expect(server.lines(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='CalibratorEvent' ORDER BY 1;`).join("\n")).toMatch(/seq/);
  });

  it("persists a fitted calibrator idempotently and reads it back unchanged", async () => {
    const repository = createPrismaCalibrationRepository(client);
    const fitted = makeFitted({ seed: 101 });
    const first = await repository.persistCalibrator(fitted);
    expect(first).toEqual({ calibratorId: calibratorContentId(fitted), created: true });
    const second = await repository.persistCalibrator(fitted);
    expect(second).toEqual({ calibratorId: calibratorContentId(fitted), created: false });
    expect(server.lines(`SELECT count(*) FROM "Calibrator" WHERE id='${first.calibratorId}';`)).toEqual(["1"]);
    expect(await repository.findCalibrator(first.calibratorId)).toEqual(fitted);
    expect(await repository.findCalibrator(calibratorId("9"))).toBeNull();
  });

  it("derives the active calibrator from a PROMOTED event and pins identity and market", async () => {
    const repository = createPrismaCalibrationRepository(client);
    const fitted = makeFitted({ seed: 102 });
    const { calibratorId: id } = await repository.persistCalibrator(fitted);
    expect(await repository.findActiveCalibrator(TEST_IDENTITY, "OVER_UNDER_2_5")).toBeNull();

    const promoted = await repository.promoteCalibrator({
      identity: TEST_IDENTITY, market: "OVER_UNDER_2_5", calibratorId: id, predecessorCalibratorId: null,
      asOf: "2027-03-02T00:00:00.000Z", reasonCode: "FIRST_PROMOTION", evaluation: { holdoutBrierRaw: fitted.holdoutBrierRaw },
    });
    expect(promoted.created).toBe(true);

    const active = await repository.findActiveCalibrator(TEST_IDENTITY, "OVER_UNDER_2_5");
    expect(active).not.toBeNull();
    expect(active!.calibratorId).toBe(id);
    expect(active!.version).toBe(1);
    expect(active!.activationSeq).toBeGreaterThan(0);
    expect(active!.calibrator).toEqual(fitted);

    // Another configuration hash, another model version or another market never sees this calibrator.
    expect(await repository.findActiveCalibrator(OTHER_CONFIG_IDENTITY, "OVER_UNDER_2_5")).toBeNull();
    expect(await repository.findActiveCalibrator(OTHER_MODEL_IDENTITY, "OVER_UNDER_2_5")).toBeNull();
    expect(await repository.findActiveCalibrator(TEST_IDENTITY, "BTTS")).toBeNull();
    expect(await repository.findActiveCalibrator(TEST_IDENTITY, "ONE_X_TWO")).toBeNull();
    const all = await repository.findActiveCalibrators(TEST_IDENTITY);
    expect(all.OVER_UNDER_2_5?.calibratorId).toBe(id);
    expect(all.BTTS).toBeNull();
    expect(all.ONE_X_TWO).toBeNull();
    const foreign = await repository.findActiveCalibrators(OTHER_CONFIG_IDENTITY);
    expect(Object.values(foreign).every((entry) => entry === null)).toBe(true);

    // Repeating the same promotion on the same day adds nothing.
    const repeated = await repository.promoteCalibrator({
      identity: TEST_IDENTITY, market: "OVER_UNDER_2_5", calibratorId: id, predecessorCalibratorId: null,
      asOf: "2027-03-02T10:00:00.000Z", reasonCode: "FIRST_PROMOTION", evaluation: {},
    });
    expect(repeated.created).toBe(false);
    expect(server.lines(`SELECT count(*) FROM "CalibratorEvent" WHERE "calibratorId"='${id}';`)).toEqual(["1"]);
  });

  it("rejects UPDATE and DELETE on both tables", () => {
    withoutTransitionGuard(() => {
      server.psql(calibratorInsert(calibratorId("1")));
      server.psql(eventInsert(eventId("1")));
      expect(() => server.psql(`UPDATE "Calibrator" SET "holdoutBrierRaw"=0.1 WHERE id='${calibratorId("1")}';`)).toThrow(/Calibrator is immutable/);
      expect(() => server.psql(`DELETE FROM "Calibrator" WHERE id='${calibratorId("1")}';`)).toThrow(/Calibrator is immutable/);
      expect(() => server.psql(`UPDATE "CalibratorEvent" SET "reasonCode"='OTHER' WHERE id='${eventId("1")}';`)).toThrow(/CalibratorEvent is immutable/);
      expect(() => server.psql(`DELETE FROM "CalibratorEvent" WHERE id='${eventId("1")}';`)).toThrow(/CalibratorEvent is immutable/);
      expect(server.lines(`SELECT "holdoutBrierRaw" FROM "Calibrator" WHERE id='${calibratorId("1")}';`)).toEqual(["0.5"]);
    });
  });

  it("rejects an event bound to a calibrator of another model version, config hash or market", () => {
    withoutTransitionGuard(() => {
      server.psql(calibratorInsert(calibratorId("2")));
      const base = { calibratorId: `'${calibratorId("2")}'` };
      expect(() => server.psql(eventInsert(eventId("2"), { ...base, modelVersion: "'poisson-ensemble-v1'" }))).toThrow(/foreign key/i);
      expect(() => server.psql(eventInsert(eventId("3"), { ...base, configHash: `'${sha("b")}'` }))).toThrow(/foreign key/i);
      expect(() => server.psql(eventInsert(eventId("4"), { ...base, market: "'BTTS'" }))).toThrow(/foreign key/i);
      // The same event with the pinned identity is accepted.
      server.psql(eventInsert(eventId("5"), base));
      expect(server.lines(`SELECT count(*) FROM "CalibratorEvent" WHERE id IN ('${eventId("2")}','${eventId("3")}','${eventId("4")}');`)).toEqual(["0"]);
    });
  });

  it("rejects optional calibrator links that belong to another identity", () => {
    withoutTransitionGuard(() => {
      server.psql(calibratorInsert(calibratorId("3"), { configHash: `'${sha("b")}'` }));
      server.psql(calibratorInsert(calibratorId("4")));
      // PROMOTED of calibrator 4 whose predecessor was fitted for another config hash.
      expect(() => server.psql(eventInsert(eventId("6"), { calibratorId: `'${calibratorId("4")}'`, predecessorCalibratorId: `'${calibratorId("3")}'` }))).toThrow(/foreign key/i);
      expect(() => server.psql(eventInsert(eventId("7"), { type: "'ROLLED_BACK'", calibratorId: `'${calibratorId("4")}'`, restoredCalibratorId: `'${calibratorId("3")}'` }))).toThrow(/foreign key/i);
      expect(() => server.psql(eventInsert(eventId("8"), { type: "'SUPERSEDED'", calibratorId: `'${calibratorId("4")}'`, successorCalibratorId: `'${calibratorId("3")}'` }))).toThrow(/foreign key/i);
    });
  });

  it("rejects a calibrator whose windows are not chronological", () => {
    expect(() => server.psql(calibratorInsert(calibratorId("5"), { fitWindowTo: "'2026-06-03T00:00:00Z'" }))).toThrow(/check constraint/i);
    expect(() => server.psql(calibratorInsert(calibratorId("5"), { holdoutTo: "'2026-08-03T00:00:00Z'" }))).toThrow(/check constraint/i);
    expect(() => server.psql(calibratorInsert(calibratorId("5"), { fitWindowFrom: "'2026-06-02T00:00:00Z'", fitWindowTo: "'2026-06-01T00:00:00Z'" }))).toThrow(/check constraint/i);
    expect(() => server.psql(calibratorInsert(calibratorId("5"), { holdoutFrom: "'2026-08-02T00:00:00Z'", holdoutTo: "'2026-08-01T00:00:00Z'" }))).toThrow(/check constraint/i);
    // Touching windows (fit ends exactly when the holdout begins; holdout ends at fitAsOf) are allowed.
    server.psql(calibratorInsert(calibratorId("5"), { holdoutFrom: "'2026-06-01T00:00:00Z'", fitAsOf: "'2026-08-01T00:00:00Z'" }));
    expect(server.lines(`SELECT count(*) FROM "Calibrator" WHERE id='${calibratorId("5")}';`)).toEqual(["1"]);
  });

  it("rejects malformed identity, market, method, event type and shape", () => {
    withoutTransitionGuard(() => {
      const bad: Array<[string, Record<string, string>]> = [
        ["config hash", { configHash: "'sha256:xyz'" }],
        ["config hash (no prefix)", { configHash: `'${"a".repeat(64)}'` }],
        ["market", { market: "'CORRECT_SCORE'" }],
        ["method", { method: "'NEURAL'" }],
        ["id format", { id: "'calibrator_short'" }],
        ["parameters type", { parameters: "'[]'::jsonb" }],
        ["calibration config hash", { calibrationConfigHash: "'sha256:short'" }],
        ["fit sample size", { fitSampleSize: "0" }],
        ["holdout sample size", { holdoutSampleSize: "0" }],
        ["empty model version", { modelVersion: "''" }],
      ];
      for (const [label, overrides] of bad) {
        expect(() => server.psql(calibratorInsert(calibratorId("6"), overrides)), label).toThrow(/check constraint|violates/i);
      }
      server.psql(calibratorInsert(calibratorId("6")));
      const badEvents: Array<[string, Record<string, string>]> = [
        ["type", { type: "'REVERTED'" }],
        ["id format", { id: "'event-1'" }],
        ["reason code", { reasonCode: "'lower case'" }],
        ["evaluation type", { evaluation: "'[]'::jsonb" }],
        ["market", { market: "'ASIAN'" }],
        ["PROMOTED with restored", { calibratorId: `'${calibratorId("6")}'`, restoredCalibratorId: `'${calibratorId("6")}'` }],
        ["PROMOTED with successor", { calibratorId: `'${calibratorId("6")}'`, successorCalibratorId: `'${calibratorId("6")}'` }],
        ["ROLLED_BACK with predecessor", { type: "'ROLLED_BACK'", calibratorId: `'${calibratorId("6")}'`, predecessorCalibratorId: `'${calibratorId("6")}'` }],
        ["SUPERSEDED without successor", { type: "'SUPERSEDED'", calibratorId: `'${calibratorId("6")}'` }],
        ["EVALUATED with predecessor", { type: "'EVALUATED'", calibratorId: `'${calibratorId("6")}'`, predecessorCalibratorId: `'${calibratorId("6")}'` }],
      ];
      for (const [label, overrides] of badEvents) {
        expect(() => server.psql(eventInsert(eventId("9"), { calibratorId: `'${calibratorId("6")}'`, ...overrides })), label).toThrow(/check constraint|violates/i);
      }
    });
  });
});
