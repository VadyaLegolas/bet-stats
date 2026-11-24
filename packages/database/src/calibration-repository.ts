import { createHash } from "node:crypto";

import {
  calibratorContentDigest,
  calibratorContentId,
  isForecastModelVersion,
  type CalibratorIdentity,
  type CalibratorMethod,
  type FittedCalibrator,
  type ScoreMarket,
} from "@bet-stats/domain";

import type { Prisma, PrismaClient } from "./client.js";

/**
 * Storage of fitted calibrators and their lifecycle event log (Phase 12, CALIB-02, CALIB-03, D-09).
 *
 * Calibrators and events are append-only. The active calibrator of one (modelVersion, configHash, market) is
 * derived by the database from the event log (`current_calibrators`), never stored, so a rollback is an appended
 * event. Every read takes the forecast's pinned identity as a QUERY parameter, not a filter applied afterwards.
 */

export const CALIBRATION_MARKETS = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const satisfies readonly ScoreMarket[];

export type CalibratorEventType = "PROMOTED" | "ROLLED_BACK" | "SUPERSEDED" | "EVALUATED";

export type CalibrationRepositoryErrorCode =
  | "CALIBRATOR_TRANSITION_REJECTED"
  | "CALIBRATOR_ROW_INVALID"
  | "CALIBRATOR_CONTENT_MISMATCH"
  | "INVALID_CALIBRATION_EVENT";

export type CalibrationRepositoryError = Error & { readonly code: CalibrationRepositoryErrorCode };

function repositoryError(code: CalibrationRepositoryErrorCode, message: string, cause?: unknown): CalibrationRepositoryError {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code, name: "CalibrationRepositoryError" }) as CalibrationRepositoryError;
}

/** The calibration config a decision was taken under; defaults to the config the calibrator itself was fitted with. */
export interface CalibrationConfigRef {
  readonly version: string;
  readonly hash: string;
}

/** Numbers behind a recorded evaluation (RECORD_EVALUATION action of the lifecycle decision). */
export type StoredCalibratorEvaluation = {
  readonly sampleSize: number;
  readonly eligible: boolean;
  readonly verdict: "BETTER" | "NEUTRAL" | "WORSE" | null;
  readonly brierRaw: number | null;
  readonly brierCalibrated: number | null;
  readonly delta: number | null;
};

/** Free-form numbers recorded with a promotion or rollback; must be a JSON object. */
export type CalibratorEventDetails = Readonly<Record<string, unknown>>;

export interface ActiveCalibratorState {
  readonly calibratorId: string;
  /** Promotion number inside (modelVersion, configHash, market); a rollback restores a calibrator with its own number. */
  readonly version: number;
  readonly calibrator: FittedCalibrator;
  /** Sequence of the event that made this calibrator active (evaluations after it belong to this activation). */
  readonly activationSeq: number;
  readonly activatedBy: "PROMOTED" | "ROLLED_BACK";
  readonly activatedAt: string;
  /** Predecessor recorded by this calibrator's PROMOTED event: where a rollback goes. `null` means raw probabilities only. */
  readonly restoreTargetId: string | null;
}

export interface CalibratorEventRecord {
  readonly id: string;
  readonly seq: number;
  readonly type: CalibratorEventType;
  readonly modelVersion: string;
  readonly configHash: string;
  readonly market: ScoreMarket;
  readonly calibratorId: string;
  readonly predecessorCalibratorId: string | null;
  readonly restoredCalibratorId: string | null;
  readonly successorCalibratorId: string | null;
  readonly reasonCode: string;
  readonly asOf: string;
  readonly evaluation: Readonly<Record<string, unknown>>;
  readonly calibrationConfigVersion: string;
  readonly calibrationConfigHash: string;
}

export interface PersistCalibratorResult {
  readonly calibratorId: string;
  readonly created: boolean;
}

export interface CalibratorEventWriteResult {
  readonly eventId: string;
  readonly created: boolean;
}

interface EventScope {
  readonly identity: CalibratorIdentity;
  readonly market: ScoreMarket;
  readonly calibratorId: string;
  /** ISO-8601 instant of the decision; the UTC calendar day of it is part of the event id (one event of a kind per day). */
  readonly asOf: string;
  readonly reasonCode: string;
  readonly calibrationConfig?: CalibrationConfigRef;
}

export interface PromoteCalibratorInput extends EventScope {
  readonly predecessorCalibratorId: string | null;
  readonly evaluation: CalibratorEventDetails;
}

export interface PromoteCalibratorResult extends CalibratorEventWriteResult {
  /** Event id of the SUPERSEDED event written together with the promotion, or null for a first promotion. */
  readonly supersededEventId: string | null;
}

export interface RollbackCalibratorInput extends EventScope {
  /** Must equal the predecessor recorded by the calibrator's PROMOTED event; null means raw probabilities only. */
  readonly restoredCalibratorId: string | null;
  readonly evaluation: CalibratorEventDetails;
}

export interface RecordEvaluationInput extends EventScope {
  readonly evaluation: StoredCalibratorEvaluation;
}

export interface CalibrationRepository {
  persistCalibrator(fitted: FittedCalibrator): Promise<PersistCalibratorResult>;
  findCalibrator(calibratorId: string): Promise<FittedCalibrator | null>;
  findActiveCalibrator(identity: CalibratorIdentity, market: ScoreMarket): Promise<ActiveCalibratorState | null>;
  findActiveCalibrators(identity: CalibratorIdentity): Promise<Record<ScoreMarket, ActiveCalibratorState | null>>;
  /** First promotion, or a SUPERSEDED plus PROMOTED pair in one transaction when a predecessor is active. */
  promoteCalibrator(input: PromoteCalibratorInput): Promise<PromoteCalibratorResult>;
  rollbackCalibrator(input: RollbackCalibratorInput): Promise<CalibratorEventWriteResult>;
  /** State-neutral EVALUATED event for the active calibrator; one per calibrator and UTC day. */
  recordEvaluation(input: RecordEvaluationInput): Promise<CalibratorEventWriteResult>;
  /** Events whose subject is this calibrator, by ascending seq. */
  listCalibratorEvents(calibratorId: string): Promise<readonly CalibratorEventRecord[]>;
  hasBeenRolledBack(calibratorId: string): Promise<boolean>;
}

type Transaction = Prisma.TransactionClient;

interface CalibratorRow {
  readonly id: string;
  readonly modelVersion: string;
  readonly configHash: string;
  readonly market: string;
  readonly method: string;
  readonly parameters: unknown;
  readonly calibrationConfigVersion: string;
  readonly calibrationConfigHash: string;
  readonly samplesDigest: string;
  readonly fitSampleSize: number;
  readonly holdoutSampleSize: number;
  readonly fitWindowFrom: Date | string;
  readonly fitWindowTo: Date | string;
  readonly holdoutFrom: Date | string;
  readonly holdoutTo: Date | string;
  readonly fitAsOf: Date | string;
  readonly holdoutBrierRaw: number;
  readonly holdoutBrierCalibrated: number;
  readonly plattHoldoutBrier: number | null;
  readonly isotonicHoldoutBrier: number | null;
}

interface ActiveRow extends CalibratorRow {
  readonly activationSeq: bigint | number;
  readonly activatedBy: string;
  readonly activatedAt: Date | string;
  readonly version: bigint | number;
  readonly restoreTargetId: string | null;
}

function isoOf(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw repositoryError("CALIBRATOR_ROW_INVALID", "stored timestamp is not a valid date");
  return date.toISOString();
}

function safeNumber(value: bigint | number, label: string): number {
  const result = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(result)) throw repositoryError("CALIBRATOR_ROW_INVALID", `${label} is not a safe integer`);
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rebuild the domain object from a stored row with the structural minimum only: the pinned identity must be a known
 * model version and the parameters must be a JSON object. Full validation of the parameters belongs to
 * `applyCalibrator`, which turns a bad calibrator into a coded refusal instead of NaN.
 */
function fittedFromRow(row: CalibratorRow): FittedCalibrator {
  if (!isForecastModelVersion(row.modelVersion)) throw repositoryError("CALIBRATOR_ROW_INVALID", "stored calibrator has an unknown model version");
  if (!(CALIBRATION_MARKETS as readonly string[]).includes(row.market)) throw repositoryError("CALIBRATOR_ROW_INVALID", "stored calibrator has an unknown market");
  if (row.method !== "PLATT" && row.method !== "ISOTONIC") throw repositoryError("CALIBRATOR_ROW_INVALID", "stored calibrator has an unknown method");
  if (!isPlainObject(row.parameters)) throw repositoryError("CALIBRATOR_ROW_INVALID", "stored calibrator parameters are not an object");

  const base = {
    identity: { modelVersion: row.modelVersion, configHash: row.configHash },
    market: row.market as ScoreMarket,
    fitSampleSize: row.fitSampleSize,
    holdoutSampleSize: row.holdoutSampleSize,
    fitFrom: isoOf(row.fitWindowFrom),
    fitTo: isoOf(row.fitWindowTo),
    holdoutFrom: isoOf(row.holdoutFrom),
    holdoutTo: isoOf(row.holdoutTo),
    holdoutBrierRaw: row.holdoutBrierRaw,
    holdoutBrierCalibrated: row.holdoutBrierCalibrated,
    ...(row.plattHoldoutBrier === null ? {} : { plattHoldoutBrier: row.plattHoldoutBrier }),
    ...(row.isotonicHoldoutBrier === null ? {} : { isotonicHoldoutBrier: row.isotonicHoldoutBrier }),
    samplesDigest: row.samplesDigest,
    calibrationConfigVersion: row.calibrationConfigVersion,
    calibrationConfigHash: row.calibrationConfigHash,
    fittedAsOf: isoOf(row.fitAsOf),
  };
  const method: CalibratorMethod = row.method;
  return { ...base, method, parameters: row.parameters } as unknown as FittedCalibrator;
}

function activeFromRow(row: ActiveRow): ActiveCalibratorState {
  if (row.activatedBy !== "PROMOTED" && row.activatedBy !== "ROLLED_BACK") throw repositoryError("CALIBRATOR_ROW_INVALID", "unknown activation event type");
  return {
    calibratorId: row.id,
    version: safeNumber(row.version, "version"),
    calibrator: fittedFromRow(row),
    activationSeq: safeNumber(row.activationSeq, "activationSeq"),
    activatedBy: row.activatedBy,
    activatedAt: isoOf(row.activatedAt),
    restoreTargetId: row.restoreTargetId,
  };
}

function lockKey(identity: CalibratorIdentity, market: ScoreMarket): string {
  return `${identity.modelVersion}:${identity.configHash}:${market}`;
}

/** Deterministic event id: type, calibrator, UTC day of `asOf` and the related calibrator (predecessor, restored or successor). */
function eventIdOf(type: CalibratorEventType, calibratorId: string, asOf: string, related: string | null): string {
  const day = new Date(asOf).toISOString().slice(0, 10);
  const digest = createHash("sha256").update(JSON.stringify([type, calibratorId, day, related])).digest("hex");
  return `calibrator_event_${digest}`;
}

function assertAsOf(asOf: string): Date {
  const date = new Date(asOf);
  if (typeof asOf !== "string" || !Number.isFinite(date.getTime())) throw repositoryError("INVALID_CALIBRATION_EVENT", "asOf must be an ISO-8601 instant");
  return date;
}

/** JSON-safe copy of the evaluation object; non-finite numbers are refused instead of silently becoming null. */
function jsonObject(value: CalibratorEventDetails): Prisma.InputJsonObject {
  if (!isPlainObject(value)) throw repositoryError("INVALID_CALIBRATION_EVENT", "evaluation must be a JSON object");
  const text = JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry === "number" && !Number.isFinite(entry)) throw repositoryError("INVALID_CALIBRATION_EVENT", "evaluation contains a non-finite number");
    return entry;
  });
  return JSON.parse(text) as Prisma.InputJsonObject;
}

interface EventRow {
  readonly id: string;
  readonly seq: bigint | number;
  readonly type: string;
  readonly modelVersion: string;
  readonly configHash: string;
  readonly market: string;
  readonly calibratorId: string;
  readonly predecessorCalibratorId: string | null;
  readonly restoredCalibratorId: string | null;
  readonly successorCalibratorId: string | null;
  readonly reasonCode: string;
  readonly asOf: Date | string;
  readonly evaluation: unknown;
  readonly calibrationConfigVersion: string;
  readonly calibrationConfigHash: string;
}

function eventFromRow(row: EventRow): CalibratorEventRecord {
  if (!["PROMOTED", "ROLLED_BACK", "SUPERSEDED", "EVALUATED"].includes(row.type)) throw repositoryError("CALIBRATOR_ROW_INVALID", "unknown event type");
  if (!(CALIBRATION_MARKETS as readonly string[]).includes(row.market)) throw repositoryError("CALIBRATOR_ROW_INVALID", "stored event has an unknown market");
  if (!isPlainObject(row.evaluation)) throw repositoryError("CALIBRATOR_ROW_INVALID", "stored event evaluation is not an object");
  return {
    id: row.id,
    seq: safeNumber(row.seq, "seq"),
    type: row.type as CalibratorEventType,
    modelVersion: row.modelVersion,
    configHash: row.configHash,
    market: row.market as ScoreMarket,
    calibratorId: row.calibratorId,
    predecessorCalibratorId: row.predecessorCalibratorId,
    restoredCalibratorId: row.restoredCalibratorId,
    successorCalibratorId: row.successorCalibratorId,
    reasonCode: row.reasonCode,
    asOf: isoOf(row.asOf),
    evaluation: row.evaluation,
    calibrationConfigVersion: row.calibrationConfigVersion,
    calibrationConfigHash: row.calibrationConfigHash,
  };
}

const EVALUATION_KEYS = ["brierCalibrated", "brierRaw", "delta", "eligible", "sampleSize", "verdict"] as const;

/**
 * Strict reader of the evaluation numbers stored with an EVALUATED event. Anything that is not exactly the stored
 * shape yields null, so a caller building lifecycle input can fail closed instead of guessing.
 */
export function readStoredCalibratorEvaluation(value: unknown): StoredCalibratorEvaluation | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== EVALUATION_KEYS.length || keys.some((key, index) => key !== EVALUATION_KEYS[index])) return null;
  const nullableNumber = (entry: unknown): entry is number | null => entry === null || (typeof entry === "number" && Number.isFinite(entry));
  const { sampleSize, eligible, verdict, brierRaw, brierCalibrated, delta } = value;
  if (typeof sampleSize !== "number" || !Number.isInteger(sampleSize) || sampleSize < 0) return null;
  if (typeof eligible !== "boolean") return null;
  if (verdict !== null && verdict !== "BETTER" && verdict !== "NEUTRAL" && verdict !== "WORSE") return null;
  if (!nullableNumber(brierRaw) || !nullableNumber(brierCalibrated) || !nullableNumber(delta)) return null;
  return { sampleSize, eligible, verdict, brierRaw, brierCalibrated, delta };
}

const TRANSITION_REJECTION = "CalibratorEvent transition rejected";

function messageChain(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages;
}

/** Run a write; a refusal raised by the database transition trigger becomes a coded error with the original as `cause`. */
async function transition<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const rejected = messageChain(error).find((message) => message.includes(TRANSITION_REJECTION));
    if (rejected === undefined) throw error;
    const start = rejected.indexOf(TRANSITION_REJECTION);
    throw repositoryError("CALIBRATOR_TRANSITION_REJECTED", rejected.slice(start).split(/\r?\n/)[0] ?? TRANSITION_REJECTION, error);
  }
}

export function createPrismaCalibrationRepository(client: PrismaClient): CalibrationRepository {
  async function lock(tx: Transaction, identity: CalibratorIdentity, market: ScoreMarket): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(identity, market)}, 0))`;
  }

  async function configOf(tx: Transaction, scope: EventScope): Promise<CalibrationConfigRef> {
    if (scope.calibrationConfig) return scope.calibrationConfig;
    const row = await tx.calibrator.findUnique({ where: { id: scope.calibratorId }, select: { calibrationConfigVersion: true, calibrationConfigHash: true } });
    if (!row) throw repositoryError("INVALID_CALIBRATION_EVENT", "calibrator does not exist");
    return { version: row.calibrationConfigVersion, hash: row.calibrationConfigHash };
  }

  /** Insert one event unless an event with the same deterministic id already exists. Must run inside a locked transaction. */
  async function appendEvent(
    tx: Transaction,
    type: CalibratorEventType,
    scope: EventScope,
    links: { predecessor?: string | null; restored?: string | null; successor?: string | null },
    evaluation: CalibratorEventDetails,
  ): Promise<CalibratorEventWriteResult> {
    const asOf = assertAsOf(scope.asOf);
    const related = type === "PROMOTED" ? (links.predecessor ?? null) : type === "ROLLED_BACK" ? (links.restored ?? null) : type === "SUPERSEDED" ? (links.successor ?? null) : null;
    const eventId = eventIdOf(type, scope.calibratorId, scope.asOf, related);
    const existing = await tx.calibratorEvent.findUnique({ where: { id: eventId }, select: { id: true } });
    if (existing) return { eventId, created: false };
    const config = await configOf(tx, scope);
    await tx.calibratorEvent.create({
      data: {
        id: eventId,
        type,
        modelVersion: scope.identity.modelVersion,
        configHash: scope.identity.configHash,
        market: scope.market,
        calibratorId: scope.calibratorId,
        predecessorCalibratorId: links.predecessor ?? null,
        restoredCalibratorId: links.restored ?? null,
        successorCalibratorId: links.successor ?? null,
        reasonCode: scope.reasonCode,
        asOf,
        evaluation: jsonObject(evaluation),
        calibrationConfigVersion: config.version,
        calibrationConfigHash: config.hash,
      },
    });
    return { eventId, created: true };
  }

  async function activeRows(identity: CalibratorIdentity): Promise<ActiveRow[]> {
    return client.$queryRaw<ActiveRow[]>`
      SELECT c.*, cc."activationSeq", cc."activatedBy", cc."activatedAt", v."version", v."restoreTargetId"
      FROM current_calibrators cc
      JOIN "Calibrator" c
        ON c."id" = cc."calibratorId"
       AND c."modelVersion" = cc."modelVersion" AND c."configHash" = cc."configHash" AND c."market" = cc."market"
      JOIN calibrator_versions v ON v."calibratorId" = c."id"
      WHERE cc."modelVersion" = ${identity.modelVersion} AND cc."configHash" = ${identity.configHash}`;
  }

  async function findActiveCalibrators(identity: CalibratorIdentity): Promise<Record<ScoreMarket, ActiveCalibratorState | null>> {
    const result: Record<ScoreMarket, ActiveCalibratorState | null> = { ONE_X_TWO: null, OVER_UNDER_2_5: null, BTTS: null };
    for (const row of await activeRows(identity)) {
      if (!(CALIBRATION_MARKETS as readonly string[]).includes(row.market)) throw repositoryError("CALIBRATOR_ROW_INVALID", "stored calibrator has an unknown market");
      result[row.market as ScoreMarket] = activeFromRow(row);
    }
    return result;
  }

  return {
    async persistCalibrator(fitted) {
      const calibratorId = calibratorContentId(fitted);
      const created = await client.calibrator.createMany({
        data: [
          {
            id: calibratorId,
            modelVersion: fitted.identity.modelVersion,
            configHash: fitted.identity.configHash,
            market: fitted.market,
            method: fitted.method,
            parameters: fitted.parameters as unknown as Prisma.InputJsonObject,
            calibrationConfigVersion: fitted.calibrationConfigVersion,
            calibrationConfigHash: fitted.calibrationConfigHash,
            samplesDigest: fitted.samplesDigest,
            fitSampleSize: fitted.fitSampleSize,
            holdoutSampleSize: fitted.holdoutSampleSize,
            fitWindowFrom: new Date(fitted.fitFrom),
            fitWindowTo: new Date(fitted.fitTo),
            holdoutFrom: new Date(fitted.holdoutFrom),
            holdoutTo: new Date(fitted.holdoutTo),
            fitAsOf: new Date(fitted.fittedAsOf),
            holdoutBrierRaw: fitted.holdoutBrierRaw,
            holdoutBrierCalibrated: fitted.holdoutBrierCalibrated,
            plattHoldoutBrier: fitted.plattHoldoutBrier ?? null,
            isotonicHoldoutBrier: fitted.isotonicHoldoutBrier ?? null,
          },
        ],
        skipDuplicates: true,
      });
      if (created.count === 1) return { calibratorId, created: true };
      // `skipDuplicates` kept an existing row. The content id covers the inputs of a fit, not its outputs, so the stored
      // row must be proven equal to this fit; otherwise the decision (taken on the fresh metrics) would be about a
      // calibrator other than the one that is served (WR-05). A mismatch is loud and writes nothing.
      const stored = await client.calibrator.findUnique({ where: { id: calibratorId } });
      if (!stored) throw repositoryError("CALIBRATOR_ROW_INVALID", "calibrator row disappeared after a duplicate-id insert");
      if (calibratorContentDigest(fittedFromRow(stored as unknown as CalibratorRow)) !== calibratorContentDigest(fitted)) {
        throw repositoryError("CALIBRATOR_CONTENT_MISMATCH", `stored calibrator ${calibratorId} differs from a fresh fit with the same content id`);
      }
      return { calibratorId, created: false };
    },

    async findCalibrator(calibratorId) {
      const row = await client.calibrator.findUnique({ where: { id: calibratorId } });
      return row ? fittedFromRow(row as unknown as CalibratorRow) : null;
    },

    async findActiveCalibrator(identity, market) {
      return (await findActiveCalibrators(identity))[market];
    },

    findActiveCalibrators,

    async promoteCalibrator(input) {
      return transition(() =>
        client.$transaction(async (tx) => {
          await lock(tx, input.identity, input.market);
          let supersededEventId: string | null = null;
          if (input.predecessorCalibratorId !== null) {
            // The database requires this pair, written in one transaction: the active calibrator is superseded by
            // the candidate, and only then is the candidate promoted with that predecessor.
            const superseded = await appendEvent(
              tx,
              "SUPERSEDED",
              { ...input, calibratorId: input.predecessorCalibratorId },
              { successor: input.calibratorId },
              input.evaluation,
            );
            supersededEventId = superseded.eventId;
          }
          const promoted = await appendEvent(tx, "PROMOTED", input, { predecessor: input.predecessorCalibratorId }, input.evaluation);
          return { ...promoted, supersededEventId };
        }),
      );
    },

    async rollbackCalibrator(input) {
      return transition(() =>
        client.$transaction(async (tx) => {
          await lock(tx, input.identity, input.market);
          return appendEvent(tx, "ROLLED_BACK", input, { restored: input.restoredCalibratorId }, input.evaluation);
        }),
      );
    },

    async recordEvaluation(input) {
      return transition(() =>
        client.$transaction(async (tx) => {
          await lock(tx, input.identity, input.market);
          return appendEvent(tx, "EVALUATED", input, {}, input.evaluation);
        }),
      );
    },

    async listCalibratorEvents(calibratorId) {
      const rows = await client.calibratorEvent.findMany({ where: { calibratorId }, orderBy: { seq: "asc" } });
      return rows.map((row) => eventFromRow(row as unknown as EventRow));
    },

    async hasBeenRolledBack(calibratorId) {
      const row = await client.calibratorEvent.findFirst({ where: { calibratorId, type: "ROLLED_BACK" }, select: { id: true } });
      return row !== null;
    },
  };
}
