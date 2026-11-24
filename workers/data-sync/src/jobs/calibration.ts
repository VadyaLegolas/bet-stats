import {
  CALIBRATION_CONFIG,
  CALIBRATION_CONFIG_HASH,
  assessCalibrationData,
  decideCalibrationLifecycle,
  evaluateCalibrator,
  fitMarketCalibrator,
  forecastConfigHashFor,
  isForecastModelVersion,
  isPromotable,
  type CalibratorEvaluation,
  type CalibratorIdentity,
  type LifecycleAction,
  type LifecycleActive,
  type LifecycleCandidate,
  type PriorEvaluation,
  type ScoreMarket,
} from "@bet-stats/domain";
import {
  createPrismaCalibrationRepository,
  readCalibrationFitData,
  readStoredCalibratorEvaluation,
  type ActiveCalibratorState,
  type CalibrationRepository,
  type PrismaClient,
} from "@bet-stats/database";

/**
 * Daily calibration job (Phase 12, CALIB-02, CALIB-03, D-10). The only writer of calibrators and calibrator events.
 *
 * For one forecast identity (modelVersion, configHash) and an `asOf` instant it reads the leakage-safe fit data at `asOf`,
 * evaluates the active calibrator of each market on data that arrived after it was fitted, fits and stores a candidate, asks
 * the pure policy (`decideCalibrationLifecycle`) what to do and executes exactly those actions through the repository.
 * It makes no provider call, uses no network and never writes to the frozen forecast, settlement, score or value tables.
 * Every write is idempotent: calibrators and events have deterministic ids, so a rerun of the same day adds nothing.
 */

export const CALIBRATION_JOB_RECEIPT_VERSION = "calibration-job-receipt-v1" as const;

/** Label of an EVALUATED event; the numbers and the verdict travel in the event's evaluation object. */
const EVALUATION_REASON_CODE = "WINDOW_EVALUATION";

export type CalibrationJobLog = (event: Readonly<Record<string, unknown>>) => void;

export interface CalibrationJobInput {
  readonly database: PrismaClient;
  readonly modelVersion: string;
  readonly configHash: string;
  /** ISO-8601 instant of the run; the UTC day of it identifies the run. */
  readonly asOf: string;
  readonly log?: CalibrationJobLog;
}

export type ActionResult = "WRITTEN" | "ALREADY_RECORDED";

export interface ReceiptAction {
  readonly type: LifecycleAction["type"];
  readonly reasonCode: string | null;
  readonly calibratorId: string | null;
  /** NO_CHANGE actions write nothing. */
  readonly result: ActionResult | "NONE";
}

export interface MarketReceipt {
  /** Settled, leakage-safe outcomes available at `asOf`. */
  readonly eligibleSampleSize: number;
  readonly requiredSample: number;
  readonly data: Readonly<{ state: "READY"; sampleSize: number }> | Readonly<{ state: "INSUFFICIENT_DATA"; required: number; current: number }>;
  /** Evaluation of the active calibrator on its new window; null when there was no active calibrator or no new data. */
  readonly evaluation: Readonly<{ windowSize: number; eligible: boolean; verdict: string | null; delta: number | null }> | null;
  readonly candidateId: string | null;
  readonly actions: readonly ReceiptAction[];
  /** A concurrent run won a transition; the state was re-read and nothing further was attempted for this market. */
  readonly concurrentTransition: boolean;
  readonly active: Readonly<{ calibratorId: string; version: number }> | null;
}

export interface CalibrationJobReceipt {
  readonly version: typeof CALIBRATION_JOB_RECEIPT_VERSION;
  readonly identity: CalibratorIdentity;
  readonly asOf: string;
  readonly calibrationConfigVersion: string;
  readonly skippedMalformedProbabilities: number;
  readonly skippedUnusableResults: number;
  readonly markets: Readonly<Record<ScoreMarket, MarketReceipt>>;
}

function coded(code: string, detail?: string): Error & { code: string } {
  return Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code });
}

/** A job may only run for a model version and config hash that the forecast stack itself issues (CALIB-02, T-12-16). */
export function assertCalibrationIdentity(modelVersion: unknown, configHash: unknown): CalibratorIdentity {
  if (!isForecastModelVersion(modelVersion) || typeof configHash !== "string" || configHash !== forecastConfigHashFor(modelVersion)) {
    throw coded("CALIBRATION_IDENTITY_INVALID");
  }
  return { modelVersion, configHash };
}

function normalisedAsOf(asOf: unknown): string {
  const date = typeof asOf === "string" ? new Date(asOf) : new Date(Number.NaN);
  if (!Number.isFinite(date.getTime())) throw coded("INVALID_CALIBRATION_JOB", "asOf is not a date");
  return date.toISOString();
}

function isTransitionRejection(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "CALIBRATOR_TRANSITION_REJECTED";
}

/** Evaluation window of the active calibrator: only outcomes that became known after the fit and after its last eligible evaluation. */
async function evaluationInputs(
  repository: CalibrationRepository,
  active: ActiveCalibratorState,
): Promise<{ lifecycleActive: LifecycleActive; boundaryMs: number }> {
  const events = (await repository.listCalibratorEvents(active.calibratorId)).filter((event) => event.type === "EVALUATED");
  const priorEvaluations: PriorEvaluation[] = [];
  let boundaryMs = Date.parse(active.calibrator.fittedAsOf);
  for (const event of events) {
    const stored = readStoredCalibratorEvaluation(event.evaluation);
    // An unreadable stored evaluation can never count toward a rollback; it also moves no window boundary.
    if (event.seq > active.activationSeq) priorEvaluations.push(stored === null ? { eligible: false, verdict: null } : { eligible: stored.eligible, verdict: stored.verdict });
    if (stored?.eligible) boundaryMs = Math.max(boundaryMs, Date.parse(event.asOf));
  }
  return { lifecycleActive: { calibratorId: active.calibratorId, restoreTargetId: active.restoreTargetId, priorEvaluations }, boundaryMs };
}

async function runMarket(input: {
  repository: CalibrationRepository;
  identity: CalibratorIdentity;
  market: ScoreMarket;
  asOf: string;
  samples: Parameters<typeof assessCalibrationData>[0];
}): Promise<MarketReceipt> {
  const { repository, identity, market, asOf, samples } = input;
  const config = CALIBRATION_CONFIG;
  const calibrationConfig = { version: config.version, hash: CALIBRATION_CONFIG_HASH } as const;

  let active = await repository.findActiveCalibrator(identity, market);
  let lifecycleActive: LifecycleActive | null = null;
  let evaluation: CalibratorEvaluation | null = null;
  if (active) {
    const inputs = await evaluationInputs(repository, active);
    lifecycleActive = inputs.lifecycleActive;
    const window = samples.filter((sample) => Date.parse(sample.knownAt) > inputs.boundaryMs);
    if (window.length > 0) evaluation = evaluateCalibrator({ calibrator: active.calibrator, market, samples: window, config });
  }

  const assessment = assessCalibrationData(samples, config);
  let candidate: LifecycleCandidate | null = null;
  let candidateId: string | null = null;
  let promotionDetails: Record<string, number | null> = {};
  if (assessment.state === "READY") {
    const fitted = fitMarketCalibrator({ identity, market, samples, asOf, config });
    if (fitted.state === "FITTED") {
      const stored = await repository.persistCalibrator(fitted.calibrator);
      candidateId = stored.calibratorId;
      const holdoutBrierActive =
        active && active.calibratorId !== candidateId
          ? evaluateCalibrator({ calibrator: active.calibrator, market, samples: assessment.holdout, config }).brierCalibrated
          : null;
      candidate = {
        calibratorId: stored.calibratorId,
        promotion: isPromotable(fitted.calibrator, config),
        everRolledBack: await repository.hasBeenRolledBack(stored.calibratorId),
        holdoutBrierCandidate: fitted.calibrator.holdoutBrierCalibrated,
        holdoutBrierActive,
      };
      promotionDetails = {
        holdoutSampleSize: fitted.calibrator.holdoutSampleSize,
        holdoutBrierRaw: fitted.calibrator.holdoutBrierRaw,
        holdoutBrierCalibrated: fitted.calibrator.holdoutBrierCalibrated,
        holdoutBrierActive,
      };
    }
  }

  const decision = decideCalibrationLifecycle({ config, active: lifecycleActive, evaluation, candidate });

  const actions: ReceiptAction[] = [];
  let concurrentTransition = false;
  for (const action of decision.actions) {
    try {
      actions.push(await executeAction({ repository, identity, market, asOf, calibrationConfig, action, evaluation, promotionDetails }));
    } catch (error) {
      // A concurrent run won this transition. That is not a job failure: re-read the state and stop for this market.
      if (!isTransitionRejection(error)) throw error;
      concurrentTransition = true;
      break;
    }
  }

  active = await repository.findActiveCalibrator(identity, market);
  return {
    eligibleSampleSize: samples.length,
    requiredSample: config.minimumSamples.platt,
    data: assessment.state === "READY"
      ? { state: "READY", sampleSize: assessment.sampleSize }
      : { state: "INSUFFICIENT_DATA", required: assessment.required, current: assessment.current },
    evaluation: evaluation === null ? null : { windowSize: evaluation.sampleSize, eligible: evaluation.eligible, verdict: evaluation.verdict, delta: evaluation.delta },
    candidateId,
    actions,
    concurrentTransition,
    active: active === null ? null : { calibratorId: active.calibratorId, version: active.version },
  };
}

async function executeAction(input: {
  repository: CalibrationRepository;
  identity: CalibratorIdentity;
  market: ScoreMarket;
  asOf: string;
  calibrationConfig: { version: string; hash: string };
  action: LifecycleAction;
  evaluation: CalibratorEvaluation | null;
  promotionDetails: Record<string, number | null>;
}): Promise<ReceiptAction> {
  const { repository, identity, market, asOf, calibrationConfig, action } = input;
  const scope = { identity, market, asOf, calibrationConfig } as const;
  switch (action.type) {
    case "RECORD_EVALUATION": {
      const written = await repository.recordEvaluation({
        ...scope,
        calibratorId: action.calibratorId,
        reasonCode: EVALUATION_REASON_CODE,
        evaluation: {
          sampleSize: action.sampleSize,
          eligible: action.eligible,
          verdict: action.verdict,
          brierRaw: action.brierRaw,
          brierCalibrated: action.brierCalibrated,
          delta: action.delta,
        },
      });
      return { type: action.type, reasonCode: null, calibratorId: action.calibratorId, result: written.created ? "WRITTEN" : "ALREADY_RECORDED" };
    }
    case "ROLL_BACK": {
      const written = await repository.rollbackCalibrator({
        ...scope,
        calibratorId: action.calibratorId,
        restoredCalibratorId: action.restoreCalibratorId,
        reasonCode: action.reasonCode,
        evaluation: {
          consecutiveWorse: action.consecutiveWorse,
          sampleSize: input.evaluation?.sampleSize ?? 0,
          brierRaw: input.evaluation?.brierRaw ?? null,
          brierCalibrated: input.evaluation?.brierCalibrated ?? null,
          delta: input.evaluation?.delta ?? null,
        },
      });
      return { type: action.type, reasonCode: action.reasonCode, calibratorId: action.calibratorId, result: written.created ? "WRITTEN" : "ALREADY_RECORDED" };
    }
    case "PROMOTE": {
      const written = await repository.promoteCalibrator({
        ...scope,
        calibratorId: action.calibratorId,
        predecessorCalibratorId: action.predecessorCalibratorId,
        reasonCode: action.reasonCode,
        evaluation: input.promotionDetails,
      });
      return { type: action.type, reasonCode: action.reasonCode, calibratorId: action.calibratorId, result: written.created ? "WRITTEN" : "ALREADY_RECORDED" };
    }
    case "NO_CHANGE":
      return { type: action.type, reasonCode: action.reasonCode, calibratorId: null, result: "NONE" };
  }
}

/**
 * One run for one identity at `asOf`. Throws `CALIBRATION_IDENTITY_INVALID` before touching the database when the pair is not
 * one the forecast stack issues. Markets run sequentially; the result is a closed JSON receipt without secrets.
 */
export async function runCalibrationJob(input: CalibrationJobInput): Promise<CalibrationJobReceipt> {
  const identity = assertCalibrationIdentity(input.modelVersion, input.configHash);
  const asOf = normalisedAsOf(input.asOf);
  const log = input.log ?? ((event: Readonly<Record<string, unknown>>) => console.info(JSON.stringify(event)));
  const repository = createPrismaCalibrationRepository(input.database);

  const data = await readCalibrationFitData(input.database, { ...identity, asOf });
  const markets = {} as Record<ScoreMarket, MarketReceipt>;
  for (const market of CALIBRATION_CONFIG.markets) {
    markets[market] = await runMarket({ repository, identity, market, asOf, samples: data.samples[market] });
  }

  const receipt: CalibrationJobReceipt = {
    version: CALIBRATION_JOB_RECEIPT_VERSION,
    identity,
    asOf,
    calibrationConfigVersion: CALIBRATION_CONFIG.version,
    skippedMalformedProbabilities: data.skippedMalformedProbabilities,
    skippedUnusableResults: data.skippedUnusableResults,
    markets,
  };
  log({
    event: "calibration.job.completed",
    modelVersion: identity.modelVersion,
    asOf,
    markets: Object.fromEntries(CALIBRATION_CONFIG.markets.map((market) => [market, { eligible: markets[market].eligibleSampleSize, actions: markets[market].actions.map((action) => action.type), active: markets[market].active?.calibratorId ?? null }])),
  });
  return receipt;
}
