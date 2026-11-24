import type {
  ActiveCalibratorState,
  CalibrationRepository,
  CalibratorEventRecord,
  CalibratorEventType,
  LatestRollback,
} from "@bet-stats/database";
import { calibratorContentDigest, calibratorContentId, type CalibratorIdentity, type FittedCalibrator, type ScoreMarket } from "@bet-stats/domain";

/**
 * In-memory CalibrationRepository for unit tests of the daily job. It mirrors the semantics the job relies on
 * (active calibrator derived from the event log, per-market promotion numbers, deterministic event ids, a refused transition
 * is a coded CALIBRATOR_TRANSITION_REJECTED); it does not replace the PostgreSQL trigger tests.
 */

const MARKETS = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const satisfies readonly ScoreMarket[];

export function repositoryCode(code: string, message = code): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export interface MemoryCalibrationRepository extends CalibrationRepository {
  readonly calibrators: Map<string, FittedCalibrator>;
  readonly events: CalibratorEventRecord[];
  /** Appends a PROMOTED event (and the calibrator) for a first promotion, as the job would have done earlier. */
  seedPromotion(calibrator: FittedCalibrator, asOf: string, predecessorCalibratorId?: string | null): string;
  /** Appends an EVALUATED event for the active calibrator. */
  seedEvaluation(calibratorId: string, asOf: string, verdict: "BETTER" | "NEUTRAL" | "WORSE", sampleSize?: number): void;
  eventTypes(market?: ScoreMarket): CalibratorEventType[];
}

export function createMemoryCalibrationRepository(): MemoryCalibrationRepository {
  const calibrators = new Map<string, FittedCalibrator>();
  const events: CalibratorEventRecord[] = [];
  let seq = 0;

  const day = (asOf: string): string => new Date(asOf).toISOString().slice(0, 10);

  function activeOf(identity: CalibratorIdentity, market: ScoreMarket): ActiveCalibratorState | null {
    const scoped = events.filter((event) => event.modelVersion === identity.modelVersion && event.configHash === identity.configHash && event.market === market);
    const latest = [...scoped].reverse().find((event) => event.type === "PROMOTED" || event.type === "ROLLED_BACK");
    if (!latest) return null;
    const calibratorId = latest.type === "PROMOTED" ? latest.calibratorId : latest.restoredCalibratorId;
    if (calibratorId === null) return null;
    const promotions = scoped.filter((event) => event.type === "PROMOTED");
    const promotedIndex = promotions.findIndex((event) => event.calibratorId === calibratorId);
    const calibrator = calibrators.get(calibratorId);
    if (promotedIndex < 0 || !calibrator) throw repositoryCode("CALIBRATOR_ROW_INVALID");
    return {
      calibratorId,
      version: promotedIndex + 1,
      calibrator,
      activationSeq: latest.seq,
      activatedBy: latest.type === "PROMOTED" ? "PROMOTED" : "ROLLED_BACK",
      activatedAt: latest.asOf,
      restoreTargetId: promotions[promotedIndex]!.predecessorCalibratorId,
    };
  }

  function append(
    type: CalibratorEventType,
    scope: { identity: CalibratorIdentity; market: ScoreMarket; calibratorId: string; asOf: string; reasonCode: string },
    links: { predecessor?: string | null; restored?: string | null; successor?: string | null },
    evaluation: Readonly<Record<string, unknown>>,
  ): { eventId: string; created: boolean } {
    const related = type === "PROMOTED" ? links.predecessor ?? null : type === "ROLLED_BACK" ? links.restored ?? null : type === "SUPERSEDED" ? links.successor ?? null : null;
    const id = JSON.stringify([type, scope.calibratorId, day(scope.asOf), related]);
    if (events.some((event) => event.id === id)) return { eventId: id, created: false };
    const active = activeOf(scope.identity, scope.market);
    if (type !== "PROMOTED" && active?.calibratorId !== scope.calibratorId) throw repositoryCode("CALIBRATOR_TRANSITION_REJECTED", "not the active calibrator");
    if (type === "PROMOTED" && (links.predecessor ?? null) !== (active?.calibratorId ?? null)) throw repositoryCode("CALIBRATOR_TRANSITION_REJECTED", "predecessor mismatch");
    if (type === "ROLLED_BACK" && (links.restored ?? null) !== active!.restoreTargetId) throw repositoryCode("CALIBRATOR_TRANSITION_REJECTED", "restore target mismatch");
    seq += 1;
    events.push({
      id,
      seq,
      type,
      modelVersion: scope.identity.modelVersion,
      configHash: scope.identity.configHash,
      market: scope.market,
      calibratorId: scope.calibratorId,
      predecessorCalibratorId: links.predecessor ?? null,
      restoredCalibratorId: links.restored ?? null,
      successorCalibratorId: links.successor ?? null,
      reasonCode: scope.reasonCode,
      asOf: new Date(scope.asOf).toISOString(),
      evaluation,
      calibrationConfigVersion: "calibration-config-v1",
      calibrationConfigHash: "sha256:memory",
    });
    return { eventId: id, created: true };
  }

  const repository: MemoryCalibrationRepository = {
    calibrators,
    events,

    seedPromotion(calibrator, asOf, predecessorCalibratorId = null) {
      const calibratorId = calibratorContentId(calibrator);
      calibrators.set(calibratorId, calibrator);
      append("PROMOTED", { identity: calibrator.identity, market: calibrator.market, calibratorId, asOf, reasonCode: "FIRST_PROMOTION" }, { predecessor: predecessorCalibratorId }, {});
      return calibratorId;
    },

    seedEvaluation(calibratorId, asOf, verdict, sampleSize = 60) {
      const calibrator = calibrators.get(calibratorId)!;
      const delta = verdict === "WORSE" ? 0.01 : verdict === "BETTER" ? -0.01 : 0;
      append(
        "EVALUATED",
        { identity: calibrator.identity, market: calibrator.market, calibratorId, asOf, reasonCode: "WINDOW_EVALUATION" },
        {},
        { sampleSize, eligible: true, verdict, brierRaw: 0.5, brierCalibrated: 0.5 + delta, delta },
      );
    },

    eventTypes: (market) => events.filter((event) => market === undefined || event.market === market).map((event) => event.type),

    async persistCalibrator(fitted) {
      const calibratorId = calibratorContentId(fitted);
      const existing = calibrators.get(calibratorId);
      if (existing) {
        if (calibratorContentDigest(existing) !== calibratorContentDigest(fitted)) throw repositoryCode("CALIBRATOR_CONTENT_MISMATCH");
        return { calibratorId, created: false };
      }
      calibrators.set(calibratorId, fitted);
      return { calibratorId, created: true };
    },

    async findCalibrator(calibratorId) {
      return calibrators.get(calibratorId) ?? null;
    },

    async findActiveCalibrator(identity, market) {
      return activeOf(identity, market);
    },

    async findActiveCalibrators(identity) {
      return Object.fromEntries(MARKETS.map((market) => [market, activeOf(identity, market)])) as Record<ScoreMarket, ActiveCalibratorState | null>;
    },

    async promoteCalibrator(input) {
      let supersededEventId: string | null = null;
      if (input.predecessorCalibratorId !== null) {
        supersededEventId = append("SUPERSEDED", { ...input, calibratorId: input.predecessorCalibratorId }, { successor: input.calibratorId }, input.evaluation).eventId;
      }
      return { ...append("PROMOTED", input, { predecessor: input.predecessorCalibratorId }, input.evaluation), supersededEventId };
    },

    async rollbackCalibrator(input) {
      return append("ROLLED_BACK", input, { restored: input.restoredCalibratorId }, input.evaluation);
    },

    async recordEvaluation(input) {
      return append("EVALUATED", input, {}, input.evaluation);
    },

    async listCalibratorEvents(calibratorId) {
      return events.filter((event) => event.calibratorId === calibratorId);
    },

    async hasBeenRolledBack(calibratorId) {
      return events.some((event) => event.calibratorId === calibratorId && event.type === "ROLLED_BACK");
    },

    async findLatestRollback(identity, market): Promise<LatestRollback | null> {
      const latest = [...events].reverse().find(
        (event) => event.type === "ROLLED_BACK" && event.modelVersion === identity.modelVersion && event.configHash === identity.configHash && event.market === market,
      );
      return latest ? { calibratorId: latest.calibratorId, seq: latest.seq, asOf: latest.asOf } : null;
    },
  };
  return repository;
}
