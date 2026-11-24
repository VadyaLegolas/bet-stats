import { describe, expect, it } from "vitest";

import type { CalibrationFitData, CalibrationRepository, PrismaClient } from "@bet-stats/database";
import { forecastConfigHashFor, type CalibrationSample, type CalibratorIdentity, type FittedCalibrator, type ScoreMarket } from "@bet-stats/domain";

import { runCalibrationJob, type CalibrationJobReceipt } from "../../workers/data-sync/src/jobs/calibration.js";
import { makeFitted } from "../helpers/calibration-db.js";
import { createMemoryCalibrationRepository, repositoryCode, type MemoryCalibrationRepository } from "../helpers/calibration-memory-repository.js";
import { makeCalibrationSamples } from "../helpers/calibration-samples.js";

/**
 * The daily job against an in-memory repository and synthetic fit data (no database): what must hold when a step of one
 * market fails (WR-02) and how the evaluation and the rollback are written (WR-03).
 */

const DC: CalibratorIdentity = { modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1") };
const MARKETS = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const satisfies readonly ScoreMarket[];
const silent = (): void => undefined;
const DATABASE = {} as PrismaClient;
const JOB_AS_OF = "2027-06-01T00:00:00.000Z";

/** Training samples of an over-confident process; the calibrators below are fitted on exactly these (fittedAsOf 2027-03-01). */
const training = (market: ScoreMarket, count = 400): CalibrationSample[] => makeCalibrationSamples({ market, count, seed: 5, trueSlope: 0.5, trueIntercept: 0.3 });
/** A window of outcomes that arrived after the fit, from a process where the raw forecast is already calibrated: a softener loses. */
const calibratedWindow = (market: ScoreMarket, count = 60): CalibrationSample[] =>
  makeCalibrationSamples({ market, count, seed: 91, trueSlope: 1, trueIntercept: 0, indexOffset: 430 });

function fitData(samples: Partial<Record<ScoreMarket, CalibrationSample[]>>): (database: PrismaClient, input: { asOf: string }) => Promise<CalibrationFitData> {
  return async (_database, input) => ({
    identity: DC,
    asOf: input.asOf,
    samples: { ONE_X_TWO: samples.ONE_X_TWO ?? [], OVER_UNDER_2_5: samples.OVER_UNDER_2_5 ?? [], BTTS: samples.BTTS ?? [] },
    skippedMalformedProbabilities: 0,
    skippedUnusableResults: 0,
  });
}

function run(repository: CalibrationRepository, samples: Partial<Record<ScoreMarket, CalibrationSample[]>>, asOf = JOB_AS_OF): Promise<CalibrationJobReceipt> {
  return runCalibrationJob({ database: DATABASE, ...DC, asOf, log: silent, dependencies: { repository, readFitData: fitData(samples) } });
}

/** The job's failure: a coded error that carries the full receipt. */
async function failedRun(repository: CalibrationRepository, samples: Partial<Record<ScoreMarket, CalibrationSample[]>>): Promise<{ error: Error & { code: string; receipt: CalibrationJobReceipt } }> {
  const error = await run(repository, samples).then(
    () => { throw new Error("the job was expected to fail"); },
    (caught: unknown) => caught as Error & { code: string; receipt: CalibrationJobReceipt },
  );
  return { error };
}

/** ONE_X_TWO has an active calibrator that already collected two eligible WORSE windows; the next window makes the third. */
function worldAtThirdBadWindow(): { repository: MemoryCalibrationRepository; active: string; samples: Record<ScoreMarket, CalibrationSample[]> } {
  const repository = createMemoryCalibrationRepository();
  const calibrator = makeFitted({ market: "ONE_X_TWO", identity: DC, seed: 5 });
  const active = repository.seedPromotion(calibrator, calibrator.fittedAsOf);
  repository.seedEvaluation(active, "2027-03-02T00:00:00.000Z", "WORSE");
  repository.seedEvaluation(active, "2027-03-03T00:00:00.000Z", "WORSE");
  return {
    repository,
    active,
    samples: {
      ONE_X_TWO: [...training("ONE_X_TWO"), ...calibratedWindow("ONE_X_TWO")],
      OVER_UNDER_2_5: training("OVER_UNDER_2_5"),
      BTTS: training("BTTS"),
    },
  };
}

describe("daily calibration job: the fixture itself", () => {
  it("a clean run has no failures, writes the first promotions and does not throw", async () => {
    const repository = createMemoryCalibrationRepository();
    const receipt = await run(repository, { ONE_X_TWO: training("ONE_X_TWO"), OVER_UNDER_2_5: training("OVER_UNDER_2_5"), BTTS: training("BTTS") });
    for (const market of MARKETS) {
      expect(receipt.markets[market].failures).toEqual([]);
      expect(receipt.markets[market].actions.map((action) => [action.type, action.reasonCode])).toEqual([["PROMOTE", "FIRST_PROMOTION"]]);
    }
  });

  it("the third window of the fixture is eligible and WORSE, so a rollback is due", async () => {
    const { repository, active, samples } = worldAtThirdBadWindow();
    const receipt = await run(repository, samples);
    expect(receipt.markets.ONE_X_TWO.evaluation).toMatchObject({ windowSize: 60, eligible: true, verdict: "WORSE" });
    expect(receipt.markets.ONE_X_TWO.actions.map((action) => action.type)).toContain("ROLL_BACK");
    expect(await repository.findActiveCalibrator(DC, "ONE_X_TWO")).toBeNull();
    expect(await repository.hasBeenRolledBack(active)).toBe(true);
  });
});

describe("WR-02: a failing candidate fit or persist does not cancel the rollback of the active calibrator", () => {
  it("rolls back although persisting the candidate throws; the failure is in the receipt and the job fails afterwards", async () => {
    const { repository, active, samples } = worldAtThirdBadWindow();
    const failing: CalibrationRepository = { ...repository, persistCalibrator: async () => { throw repositoryCode("CANDIDATE_STORE_DOWN"); } };

    const { error } = await failedRun(failing, samples);

    expect(error.code).toBe("CALIBRATION_MARKET_FAILED");
    const market = error.receipt.markets.ONE_X_TWO;
    expect(market.failures).toEqual([{ stage: "CANDIDATE", code: "CANDIDATE_STORE_DOWN" }]);
    expect(market.actions.map((action) => [action.type, action.result])).toEqual([["RECORD_EVALUATION", "WRITTEN"], ["ROLL_BACK", "WRITTEN"]]);
    expect(repository.eventTypes("ONE_X_TWO").at(-1)).toBe("ROLLED_BACK");
    expect(await repository.findActiveCalibrator(DC, "ONE_X_TWO")).toBeNull();
    expect(await repository.hasBeenRolledBack(active)).toBe(true);
  });

  it("rolls back although the candidate fit itself throws (a damaged sample set)", async () => {
    const { repository, samples } = worldAtThirdBadWindow();
    // A sample whose probabilities do not sum to 1 is refused by the fit with INVALID_CALIBRATION_SAMPLE, not by the evaluation.
    const damaged = { ...samples.ONE_X_TWO[0]!, sampleId: "damaged", probabilities: [0.9, 0.9, 0.9] };
    const { error } = await failedRun(repository, { ...samples, ONE_X_TWO: [damaged, ...samples.ONE_X_TWO] });
    expect(error.receipt.markets.ONE_X_TWO.failures).toEqual([{ stage: "CANDIDATE", code: "INVALID_CALIBRATION_SAMPLE" }]);
    expect(repository.eventTypes("ONE_X_TWO").at(-1)).toBe("ROLLED_BACK");
  });

  it("without a failure the same fixture ends the same way (no throw is needed for the rollback)", async () => {
    const { repository, samples } = worldAtThirdBadWindow();
    await run(repository, samples);
    expect(repository.eventTypes("ONE_X_TWO").at(-1)).toBe("ROLLED_BACK");
  });
});

describe("WR-02: one failing market does not stop the others", () => {
  it("a market that cannot read its state is recorded and the other two markets still promote", async () => {
    const repository = createMemoryCalibrationRepository();
    const failing: CalibrationRepository = {
      ...repository,
      findActiveCalibrator: async (identity, market) => {
        if (market === "ONE_X_TWO") throw repositoryCode("STATE_READ_DOWN", "connection to postgresql://user:hunter2@db:5432 refused");
        return repository.findActiveCalibrator(identity, market);
      },
    };
    const { error } = await failedRun(failing, { ONE_X_TWO: training("ONE_X_TWO"), OVER_UNDER_2_5: training("OVER_UNDER_2_5"), BTTS: training("BTTS") });

    expect(error.code).toBe("CALIBRATION_MARKET_FAILED");
    expect(error.receipt.markets.ONE_X_TWO.failures).toEqual([{ stage: "MARKET", code: "STATE_READ_DOWN" }]);
    for (const market of ["OVER_UNDER_2_5", "BTTS"] as const) {
      expect(error.receipt.markets[market].failures).toEqual([]);
      expect(error.receipt.markets[market].actions.map((action) => [action.type, action.reasonCode, action.result])).toEqual([["PROMOTE", "FIRST_PROMOTION", "WRITTEN"]]);
      expect((await repository.findActiveCalibrator(DC, market))?.version).toBe(1);
    }
    // The receipt and the error text carry codes only: never the driver message with its connection string.
    expect(JSON.stringify(error.receipt)).not.toMatch(/hunter2|postgresql:\/\//);
    expect(error.message).not.toMatch(/hunter2|postgresql:\/\//);
  });

  it("a structurally broken active calibrator is a recorded EVALUATION failure; the candidate step and the other markets go on", async () => {
    const repository = createMemoryCalibrationRepository();
    const good = makeFitted({ market: "ONE_X_TWO", identity: DC, seed: 5 });
    const broken = { ...good, parameters: { epsilon: good.parameters.epsilon, scalers: [{ slope: Number.NaN, intercept: 0 }] } } as unknown as FittedCalibrator;
    const brokenId = repository.seedPromotion(broken, broken.fittedAsOf);

    const { error } = await failedRun(repository, {
      ONE_X_TWO: [...training("ONE_X_TWO"), ...calibratedWindow("ONE_X_TWO")],
      OVER_UNDER_2_5: training("OVER_UNDER_2_5"),
      BTTS: training("BTTS"),
    });

    const market = error.receipt.markets.ONE_X_TWO;
    expect(market.failures).toEqual([{ stage: "EVALUATION", code: "CALIBRATOR_INVALID" }]);
    // The candidate was still fitted and stored; nothing replaces an active calibrator that cannot be compared with it.
    expect(market.candidateId).not.toBeNull();
    expect(market.actions.map((action) => action.type)).toEqual(["NO_CHANGE"]);
    expect((await repository.findActiveCalibrator(DC, "ONE_X_TWO"))?.calibratorId).toBe(brokenId);
    for (const other of ["OVER_UNDER_2_5", "BTTS"] as const) expect(error.receipt.markets[other].actions.map((action) => action.type)).toEqual(["PROMOTE"]);
  });
});

describe("WR-03: the evaluation that completes the series and the rollback are one write", () => {
  /** Counts the repository calls that write events. */
  function counting(repository: CalibrationRepository): { repository: CalibrationRepository; calls: string[] } {
    const calls: string[] = [];
    const wrap = <K extends "recordEvaluation" | "rollbackCalibrator" | "rollbackWithEvaluation">(name: K): CalibrationRepository[K] =>
      ((input: never) => { calls.push(name); return (repository[name] as (input: never) => unknown)(input); }) as CalibrationRepository[K];
    return { calls, repository: { ...repository, recordEvaluation: wrap("recordEvaluation"), rollbackCalibrator: wrap("rollbackCalibrator"), rollbackWithEvaluation: wrap("rollbackWithEvaluation") } };
  }

  it("uses a single repository call for the third WORSE evaluation and its rollback", async () => {
    const { repository, samples } = worldAtThirdBadWindow();
    const spy = counting(repository);
    const receipt = await run(spy.repository, samples);
    expect(spy.calls).toEqual(["rollbackWithEvaluation"]);
    // The receipt still reports two actions, in the order of the decision.
    expect(receipt.markets.ONE_X_TWO.actions.map((action) => [action.type, action.result])).toEqual([["RECORD_EVALUATION", "WRITTEN"], ["ROLL_BACK", "WRITTEN"]]);
    expect(repository.eventTypes("ONE_X_TWO")).toEqual(["PROMOTED", "EVALUATED", "EVALUATED", "EVALUATED", "ROLLED_BACK"]);
  });

  it("an evaluation without a rollback keeps its own single write", async () => {
    const repository = createMemoryCalibrationRepository();
    const calibrator = makeFitted({ market: "ONE_X_TWO", identity: DC, seed: 5 });
    repository.seedPromotion(calibrator, calibrator.fittedAsOf);
    const spy = counting(repository);
    await run(spy.repository, { ONE_X_TWO: [...training("ONE_X_TWO"), ...calibratedWindow("ONE_X_TWO")] });
    expect(spy.calls).toEqual(["recordEvaluation"]);
  });

  it("a crash while writing the rollback loses neither the evaluation window nor the rollback: the retry still rolls back", async () => {
    const { repository, active, samples } = worldAtThirdBadWindow();
    let broken = true;
    const crash = async (): Promise<never> => { throw repositoryCode("PROCESS_KILLED"); };
    const flaky: CalibrationRepository = {
      ...repository,
      rollbackCalibrator: (input) => (broken ? crash() : repository.rollbackCalibrator(input)),
      rollbackWithEvaluation: (input) => (broken ? crash() : repository.rollbackWithEvaluation(input)),
    };

    const { error } = await failedRun(flaky, samples);
    expect(error.receipt.markets.ONE_X_TWO.failures).toEqual([{ stage: "MARKET", code: "PROCESS_KILLED" }]);
    // The evaluation that would have moved the window boundary was not committed on its own.
    expect(repository.eventTypes("ONE_X_TWO")).toEqual(["PROMOTED", "EVALUATED", "EVALUATED"]);

    broken = false;
    const receipt = await run(flaky, samples);
    expect(receipt.markets.ONE_X_TWO.evaluation).toMatchObject({ windowSize: 60, eligible: true, verdict: "WORSE" });
    expect(repository.eventTypes("ONE_X_TWO")).toEqual(["PROMOTED", "EVALUATED", "EVALUATED", "EVALUATED", "ROLLED_BACK"]);
    expect(await repository.hasBeenRolledBack(active)).toBe(true);
  });
});
