import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, Optional, ServiceUnavailableException } from "@nestjs/common";
import {
  createPrismaClient,
  createReplayProviderPolicyRepository,
  DEFAULT_REPLAY_PROVIDER_POLICIES,
  type PrismaClient,
  type ReplayProviderPolicyRepository,
} from "@bet-stats/database";
import {
  evaluateReplayProviderPolicy,
  fingerprintReplayProviderPolicy,
  verifyPersistedReplayProviderPolicyFingerprint,
  type ReplayProviderPolicySnapshot,
} from "@bet-stats/domain";
import { Queue } from "bullmq";
import { createReplayDeliveryDispatcher } from "./replay-delivery.service.js";

const PROVIDERS = new Set(["football-data.org"]);
const COMPETITIONS = new Set(["PL", "PD", "BL1", "SA", "FL1", "CL", "EL"]);
const ENDPOINTS = new Set(["FIXTURES", "RESULTS", "STANDINGS"]);
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export type ReplayInput = { recoveryType: "INGESTION"; reason: string; provider: string; competitionId: string; seasonId: string; endpointFamily: string; from: string; to: string };
type EvaluationRecoveryInput = { recoveryType: "EVALUATION"; reason: string; resultVersionId: string; forecastSnapshotId: string; policyHash: string };
type RecoveryInput = ReplayInput | EvaluationRecoveryInput;
export type ReplayUnit = { logicalId: string; from: string; to: string };
type PreviewImpact = { calls: number; builds: number; providerPolicy?: unknown };
type PreviewRow = { id: string; logicalKey: string; version: number; previewVersion: string; normalizedInput: RecoveryInput; unitManifest: ReplayUnit[]; impact: PreviewImpact; providerPolicyFingerprint: string; expiresAt: Date; consumedAt: Date | null; actor: string };
export interface ReplayEnqueuer { enqueue(run: { syncRunId: string; replayPlanId: string; logicalId: string; revision: number; input: RecoveryInput; unit: ReplayUnit }): Promise<void> }

export function createBullReplayEnqueuer(redisUrl: string, database: PrismaClient, prefix = "bet-stats"): ReplayEnqueuer & { close(): Promise<void> } {
  void database;
  const queue = new Queue(`${prefix}-sync-standard`, { connection: { url: redisUrl, maxRetriesPerRequest: null } });
  return {
    async enqueue(run) {
      await queue.add(run.input.recoveryType === "EVALUATION" ? "settlement" : run.input.endpointFamily.toLowerCase(), run, {
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000, jitter: 0.25 },
        jobId: `${run.logicalId}-${run.revision}`,
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800, count: 5_000 },
      });
    },
    close: () => queue.close(),
  };
}

function replayError(code: string, status = 400): Error & { code: string; status: number } {
  const exception = status === 409
    ? new ConflictException({ code })
    : status === 404
      ? new NotFoundException({ code })
      : status === 503
        ? new ServiceUnavailableException({ code })
        : new BadRequestException({ code });
  return Object.assign(exception, { code, status });
}
function normalize(input: Record<string, unknown>): ReplayInput {
  const reason = String(input.reason ?? input.purpose ?? "").trim();
  if (reason.length < 10 || reason.length > 500) throw replayError("RECOVERY_REASON_INVALID");
  const recoveryType = String(input.recoveryType ?? "INGESTION");
  if (recoveryType !== "INGESTION") throw replayError("RECOVERY_TYPE_NOT_ALLOWED");
  const value = { recoveryType, reason, provider: String(input.provider ?? ""), competitionId: String(input.competitionId ?? ""), seasonId: String(input.seasonId ?? "").trim(), endpointFamily: String(input.endpointFamily ?? ""), from: String(input.from ?? ""), to: String(input.to ?? "") } as const;
  if (!PROVIDERS.has(value.provider) || !COMPETITIONS.has(value.competitionId) || !ENDPOINTS.has(value.endpointFamily)) throw replayError("NOT_ALLOWED");
  if (!value.seasonId || !UTC_INSTANT.test(value.from) || !UTC_INSTANT.test(value.to)) throw replayError("INVALID_WINDOW");
  const from = Date.parse(value.from); const to = Date.parse(value.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw replayError("INVALID_WINDOW");
  if (Math.floor((to - from) / 86_400_000) + 1 > 31) throw replayError("WINDOW_TOO_LARGE");
  return { ...value, from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}
function normalizeEvaluation(input: Record<string, unknown>, reason: string): EvaluationRecoveryInput {
  const resultVersionId = String(input.resultVersionId ?? "").trim();
  const forecastSnapshotId = String(input.forecastSnapshotId ?? "").trim();
  const policyHash = String(input.policyHash ?? "").trim();
  if (!resultVersionId || !forecastSnapshotId || policyHash.length < 8 || policyHash.length > 256) throw replayError("EVALUATION_SCOPE_INVALID");
  return { recoveryType: "EVALUATION", reason, resultVersionId, forecastSnapshotId, policyHash };
}
function recoveryScope(input: RecoveryInput) {
  return input.recoveryType === "EVALUATION"
    ? { resultVersionId: input.resultVersionId, forecastSnapshotId: input.forecastSnapshotId, policyHash: input.policyHash }
    : { provider: input.provider, competitionId: input.competitionId, seasonId: input.seasonId, endpointFamily: input.endpointFamily, from: input.from, to: input.to };
}
function buildUnits(input: ReplayInput): ReplayUnit[] {
  const count = Math.floor((Date.parse(input.to) - Date.parse(input.from)) / 86_400_000) + 1;
  return Array.from({ length: count }, (_, offset) => {
    const from = new Date(Date.parse(input.from) + offset * 86_400_000).toISOString();
    const to = new Date(Math.min(Date.parse(input.to), Date.parse(from) + 86_399_999)).toISOString();
    return { logicalId: createHash("sha256").update(JSON.stringify({ ...recoveryScope(input), from, to, purpose: "recovery" })).digest("hex"), from, to };
  });
}
function publicPolicy(snapshot: ReplayProviderPolicySnapshot) {
  return { fingerprint: fingerprintReplayProviderPolicy(snapshot), snapshot };
}

function snapshotFromImpact(value: unknown): ReplayProviderPolicySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<ReplayProviderPolicySnapshot>;
  if (snapshot.version !== "replay-provider-policy/v1" || typeof snapshot.provider !== "string" || typeof snapshot.endpointFamily !== "string") return null;
  return snapshot as ReplayProviderPolicySnapshot;
}

function publicPreview(row: PreviewRow) {
  if (row.normalizedInput.recoveryType === "EVALUATION") {
    const immutableGuarantees = { observations: "UNCHANGED" as const, issuedForecasts: "UNCHANGED" as const, valueReceipts: "UNCHANGED" as const, results: "UNCHANGED" as const, settlements: "UNCHANGED" as const };
    return { previewId: row.id, previewVersion: row.previewVersion, fingerprint: row.previewVersion, dryRun: true as const, bounded: true as const,
      recoveryType: row.normalizedInput.recoveryType, reason: row.normalizedInput.reason, logicalIdentity: row.logicalKey, expiresAt: row.expiresAt.toISOString(),
      scope: recoveryScope(row.normalizedInput), quotaEffect: { reservations: 0, remainingCalls: null }, immutableGuarantees,
      calls: 0, builds: 1, lane: "evaluation", effects: { immutableObservations: true as const, predictionSnapshotsMutated: false as const },
      input: row.normalizedInput, logicalJobIds: row.unitManifest.map((unit) => unit.logicalId) };
  }
  const providerPolicy = snapshotFromImpact(row.impact.providerPolicy);
  if (!providerPolicy) throw replayError("MALFORMED_POLICY", 409);
  const immutableGuarantees = { observations: "UNCHANGED" as const, issuedForecasts: "UNCHANGED" as const, valueReceipts: "UNCHANGED" as const, results: "UNCHANGED" as const, settlements: "UNCHANGED" as const };
  return {
    previewId: row.id, previewVersion: row.previewVersion, dryRun: true as const, bounded: true as const,
    fingerprint: row.previewVersion, recoveryType: row.normalizedInput.recoveryType, reason: row.normalizedInput.reason,
    logicalIdentity: row.logicalKey, expiresAt: row.expiresAt.toISOString(),
    scope: recoveryScope(row.normalizedInput), quotaEffect: { reservations: row.impact.calls }, immutableGuarantees,
    calls: row.impact.calls, builds: row.impact.builds, lane: providerPolicy.lane,
    effects: { immutableObservations: true as const, predictionSnapshotsMutated: false as const },
    input: row.normalizedInput, logicalJobIds: row.unitManifest.map((unit) => unit.logicalId),
    providerPolicy: publicPolicy(providerPolicy),
  };
}

export function createReplayService(options: { database: PrismaClient; enqueuer?: ReplayEnqueuer; providerPolicyRepository?: ReplayProviderPolicyRepository; now?: () => Date }) {
  const database = options.database; const now = options.now ?? (() => new Date());
  const providerPolicyRepository = options.providerPolicyRepository ?? createReplayProviderPolicyRepository({ database, policies: DEFAULT_REPLAY_PROVIDER_POLICIES, now });
  const dispatcher = options.enqueuer ? createReplayDeliveryDispatcher({ database, enqueuer: options.enqueuer, now }) : null;
  return {
    async preview(raw: Record<string, unknown>, actor: string) {
      const reason = String(raw.reason ?? raw.purpose ?? "").trim();
      if (reason.length < 10 || reason.length > 500) throw replayError("RECOVERY_REASON_INVALID");
      if (String(raw.recoveryType ?? "INGESTION") === "EVALUATION") {
        const input = normalizeEvaluation(raw, reason);
        const [result, forecast] = await Promise.all([
          database.resultVersion.findUnique({ where: { id: input.resultVersionId }, select: { fixtureId: true, observedAt: true } }),
          database.forecastSnapshot.findUnique({ where: { id: input.forecastSnapshotId }, select: { fixtureId: true, cutoff: true, state: true } }),
        ]);
        if (!result || !forecast || result.fixtureId !== forecast.fixtureId || forecast.state !== "ISSUED") throw replayError("EVALUATION_SCOPE_INVALID");
        const logicalKey = createHash("sha256").update(JSON.stringify({ recoveryType: input.recoveryType, scope: recoveryScope(input) })).digest("hex");
        const unit = { logicalId: logicalKey, from: forecast.cutoff.toISOString(), to: result.observedAt.toISOString() };
        const policy = createHash("sha256").update(input.policyHash).digest("hex");
        const row = await database.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `replay-preview:${logicalKey}`);
          const prior = await tx.$queryRawUnsafe<PreviewRow[]>(`SELECT id,"logicalKey",version,"previewVersion","normalizedInput","unitManifest",impact,"providerPolicyFingerprint","expiresAt","consumedAt",actor FROM "ReplayPreview" WHERE "logicalKey"=$1 AND "consumedAt" IS NULL AND "expiresAt">$2 ORDER BY version DESC LIMIT 1`, logicalKey, now());
          if (prior[0]) return prior[0];
          const versions = await tx.$queryRawUnsafe<Array<{ version: number }>>(`SELECT COALESCE(MAX(version),0)::int AS version FROM "ReplayPreview" WHERE "logicalKey"=$1`, logicalKey);
          const version = (versions[0]?.version ?? 0) + 1;
          const previewVersion = createHash("sha256").update(JSON.stringify({ logicalKey, version, input, unit, policy })).digest("hex");
          const inserted = await tx.$queryRawUnsafe<PreviewRow[]>(`INSERT INTO "ReplayPreview" (id,"logicalKey",version,"previewVersion","normalizedInput","unitManifest",impact,"providerPolicyFingerprint","expiresAt",actor) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10) RETURNING id,"logicalKey",version,"previewVersion","normalizedInput","unitManifest",impact,"providerPolicyFingerprint","expiresAt","consumedAt",actor`, randomUUID(), logicalKey, version, previewVersion, JSON.stringify(input), JSON.stringify([unit]), JSON.stringify({ calls: 0, builds: 1 }), policy, new Date(now().getTime() + 900_000), actor);
          return inserted[0]!;
        });
        return publicPreview(row);
      }
      const input = normalize(raw); const units = buildUnits(input);
      let providerPolicy: ReplayProviderPolicySnapshot;
      try { providerPolicy = await providerPolicyRepository.read(input.provider, input.endpointFamily); }
      catch { throw replayError("MALFORMED_POLICY", 409); }
      const decision = evaluateReplayProviderPolicy(providerPolicy, units.length, now());
      if (!decision.allowed) throw replayError(decision.reason, 409);
      const logicalKey = createHash("sha256").update(JSON.stringify({ recoveryType: input.recoveryType, scope: recoveryScope(input) })).digest("hex");
      const policy = fingerprintReplayProviderPolicy(providerPolicy);
      const row = await database.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `replay-preview:${logicalKey}`);
        const prior = await tx.$queryRawUnsafe<PreviewRow[]>(`SELECT id,"logicalKey",version,"previewVersion","normalizedInput","unitManifest",impact,"providerPolicyFingerprint","expiresAt","consumedAt",actor FROM "ReplayPreview" WHERE "logicalKey"=$1 AND "consumedAt" IS NULL AND "expiresAt">$2 ORDER BY version DESC LIMIT 1`, logicalKey, now());
        if (prior[0]) return prior[0];
        const versions = await tx.$queryRawUnsafe<Array<{ version: number }>>(`SELECT COALESCE(MAX(version),0)::int AS version FROM "ReplayPreview" WHERE "logicalKey"=$1`, logicalKey);
        const version = (versions[0]?.version ?? 0) + 1; const previewVersion = createHash("sha256").update(JSON.stringify({ logicalKey, version, input, units, policy })).digest("hex");
        const inserted = await tx.$queryRawUnsafe<PreviewRow[]>(`INSERT INTO "ReplayPreview" (id,"logicalKey",version,"previewVersion","normalizedInput","unitManifest",impact,"providerPolicyFingerprint","expiresAt",actor) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10) RETURNING id,"logicalKey",version,"previewVersion","normalizedInput","unitManifest",impact,"providerPolicyFingerprint","expiresAt","consumedAt",actor`, randomUUID(), logicalKey, version, previewVersion, JSON.stringify(input), JSON.stringify(units), JSON.stringify({ calls: units.length, builds: units.length, providerPolicy }), policy, new Date(now().getTime() + 900_000), actor);
        return inserted[0]!;
      });
      return { ...publicPreview(row), headroom: { available: true as const, remainingCalls: decision.remainingAfter } };
    },
    async queue(raw: Record<string, unknown>) {
      const previewId = String(raw.previewId ?? ""); const previewVersion = String(raw.previewVersion ?? "");
      if (raw.fingerprint !== undefined && String(raw.fingerprint) !== previewVersion) throw replayError("STALE_PREVIEW", 409);
      if (raw.newRevision === true && String(raw.reason ?? "").trim().length < 3) throw replayError("REVISION_REASON_REQUIRED");
      const committed = await database.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `replay-confirm:${previewId}`);
        const rows = await tx.$queryRawUnsafe<PreviewRow[]>(`SELECT id,"logicalKey",version,"previewVersion","normalizedInput","unitManifest",impact,"providerPolicyFingerprint","expiresAt","consumedAt",actor FROM "ReplayPreview" WHERE id=$1`, previewId); const preview = rows[0];
        if (!preview || preview.previewVersion !== previewVersion || preview.expiresAt <= now()) throw replayError("STALE_PREVIEW", 409);
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `replay-confirm-logical:${preview.logicalKey}`);
        const evaluation = preview.normalizedInput.recoveryType === "EVALUATION";
        const approvedPolicy = snapshotFromImpact(preview.impact.providerPolicy);
        if (evaluation) {
          const evaluationInput = preview.normalizedInput as EvaluationRecoveryInput;
          const [result, forecast] = await Promise.all([
            tx.resultVersion.findUnique({ where: { id: evaluationInput.resultVersionId }, select: { fixtureId: true } }),
            tx.forecastSnapshot.findUnique({ where: { id: evaluationInput.forecastSnapshotId }, select: { fixtureId: true, state: true } }),
          ]);
          if (!result || !forecast || result.fixtureId !== forecast.fixtureId || forecast.state !== "ISSUED" || createHash("sha256").update(evaluationInput.policyHash).digest("hex") !== preview.providerPolicyFingerprint) throw replayError("STALE_PREVIEW", 409);
        }
        const approvedIdentity = approvedPolicy && verifyPersistedReplayProviderPolicyFingerprint(approvedPolicy, preview.providerPolicyFingerprint);
        if (!evaluation && (!approvedPolicy || !approvedIdentity)) throw replayError("STALE_PREVIEW", 409);
        let currentPolicy: ReplayProviderPolicySnapshot | null = null;
        if (preview.normalizedInput.recoveryType === "INGESTION") {
          try { currentPolicy = await providerPolicyRepository.read(preview.normalizedInput.provider, preview.normalizedInput.endpointFamily); }
          catch { throw replayError("STALE_PREVIEW", 409); }
        }
        if (!evaluation && (!currentPolicy || approvedIdentity !== fingerprintReplayProviderPolicy(currentPolicy))) throw replayError("STALE_PREVIEW", 409);
        const currentDecision = evaluation ? { allowed: true as const } : evaluateReplayProviderPolicy(currentPolicy!, preview.impact.calls, now());
        if (!currentDecision.allowed) throw replayError(currentDecision.reason, 409);
        const duplicate = await tx.$queryRawUnsafe<Array<{ id: string; revision: number }>>(`SELECT id,revision FROM "ReplayPlan" WHERE "previewId"=$1`, previewId);
        if (duplicate[0]) return { replayPlanId: duplicate[0].id, revision: duplicate[0].revision, duplicate: true, runs: [] as QueuedRun[] };
        const logicalPlans = await tx.$queryRawUnsafe<Array<{ id: string; revision: number }>>(
          `SELECT id,revision FROM "ReplayPlan" WHERE "logicalKey"=$1 ORDER BY revision DESC LIMIT 1`,
          preview.logicalKey,
        );
        if (raw.newRevision !== true && logicalPlans[0]) {
          await tx.$executeRawUnsafe(`UPDATE "ReplayPreview" SET "consumedAt"=$2 WHERE id=$1 AND "consumedAt" IS NULL`, preview.id, now());
          return { replayPlanId: logicalPlans[0].id, revision: logicalPlans[0].revision, duplicate: true, runs: [] as QueuedRun[] };
        }
        if (preview.consumedAt) throw replayError("STALE_PREVIEW", 409);
        const revisions = await tx.$queryRawUnsafe<Array<{ revision: number }>>(`SELECT COALESCE(MAX(revision),0)::int AS revision FROM "ReplayPlan" WHERE "logicalKey"=$1`, preview.logicalKey);
        const revision = raw.newRevision === true ? (revisions[0]?.revision ?? 0) + 1 : 1; const replayPlanId = randomUUID();
        const planInput = preview.normalizedInput.recoveryType === "EVALUATION" ? { provider: "evaluation", competitionId: "evaluation", endpointFamily: "SETTLEMENT", from: preview.unitManifest[0]!.from, to: preview.unitManifest[0]!.to } : preview.normalizedInput;
        await tx.$executeRawUnsafe(`INSERT INTO "ReplayPlan" (id,"logicalKey",revision,provider,"competitionId","endpointFamily","windowFrom","windowTo","previewVersion",reason,actor,"previewId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, replayPlanId, preview.logicalKey, revision, planInput.provider, planInput.competitionId, planInput.endpointFamily, planInput.from, planInput.to, preview.previewVersion, preview.normalizedInput.reason, preview.actor, preview.id);
        const runs: QueuedRun[] = [];
        for (const unit of preview.unitManifest) {
          const syncRunId = randomUUID();
          const runProvider = preview.normalizedInput.recoveryType === "EVALUATION" ? "evaluation" : preview.normalizedInput.provider;
          const runEndpoint = preview.normalizedInput.recoveryType === "EVALUATION" ? "SETTLEMENT" : preview.normalizedInput.endpointFamily;
          const runLane = preview.normalizedInput.recoveryType === "EVALUATION" ? "evaluation" : approvedPolicy!.lane;
          await tx.$executeRawUnsafe(`INSERT INTO "SyncRun" (id,"logicalKey",revision,provider,"endpointFamily",lane,"windowFrom","windowTo",state,"correlationId","replayPlanId","expectedUnits","expectedCaptures","completionManifest") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$10,1,1,$11::jsonb)`, syncRunId, `${unit.logicalId}:replay`, revision, runProvider, runEndpoint, runLane, unit.from, unit.to, randomUUID(), replayPlanId, JSON.stringify({ expectedUnits: [unit.logicalId], completedUnits: [], expectedCaptures: [unit.logicalId], completedCaptures: [] }));
          await tx.$executeRawUnsafe(
            `INSERT INTO "ReplayDelivery" (id,"syncRunId","jobId") VALUES ($1,$2,$3)`,
            randomUUID(),
            syncRunId,
            `${unit.logicalId}-${revision}`,
          );
          runs.push({ syncRunId, logicalId: unit.logicalId, revision, input: preview.normalizedInput, unit });
        }
        await tx.$executeRawUnsafe(`UPDATE "ReplayPreview" SET "consumedAt"=$2 WHERE id=$1 AND "consumedAt" IS NULL`, preview.id, now());
        return { replayPlanId, revision, duplicate: false, runs };
      });
      if (dispatcher) await dispatcher.dispatch(committed.replayPlanId);
      const run = await database.syncRun.findFirst({ where: { replayPlanId: committed.replayPlanId }, orderBy: { createdAt: "asc" }, select: { correlationId: true, lane: true } });
      const immutableGuarantees = { observations: "UNCHANGED" as const, issuedForecasts: "UNCHANGED" as const, valueReceipts: "UNCHANGED" as const, results: "UNCHANGED" as const, settlements: "UNCHANGED" as const };
      return { replayPlanId: committed.replayPlanId, correlationId: run?.correlationId ?? null, lane: run?.lane ?? null, queued: !committed.duplicate, duplicate: committed.duplicate, revision: committed.revision, reason: raw.newRevision === true ? String(raw.reason).trim() : null, immutableGuarantees, effects: { immutableObservations: true as const, predictionSnapshotsMutated: false as const } };
    },
    async dispatchDeliveries(replayPlanId?: string) {
      return dispatcher?.dispatch(replayPlanId) ?? { claimed: 0, delivered: 0 };
    },
    async status(replayPlanId: string) {
      const plans = await database.$queryRawUnsafe<Array<{ id: string; provider: string; endpointFamily: string; impact: PreviewImpact; providerPolicyFingerprint: string }>>(
        `SELECT p.id,p.provider,p."endpointFamily",v.impact,v."providerPolicyFingerprint" FROM "ReplayPlan" p JOIN "ReplayPreview" v ON v.id=p."previewId" WHERE p.id=$1`,
        replayPlanId,
      );
      const plan = plans[0]; if (!plan) throw replayError("REPLAY_NOT_FOUND", 404);
      const approvedSnapshot = snapshotFromImpact(plan.impact.providerPolicy);
      let currentSnapshot: ReplayProviderPolicySnapshot | null = null;
      try { currentSnapshot = await providerPolicyRepository.read(plan.provider, plan.endpointFamily); } catch { /* status remains safely unavailable */ }
      const approved = approvedSnapshot && verifyPersistedReplayProviderPolicyFingerprint(approvedSnapshot, plan.providerPolicyFingerprint)
        ? publicPolicy(approvedSnapshot)
        : null;
      const current = currentSnapshot ? publicPolicy(currentSnapshot) : null;
      const classification = !approved || !current ? "UNAVAILABLE" : approved.fingerprint === current.fingerprint ? "UNCHANGED" : "CHANGED";
      const runs = await database.$queryRawUnsafe<Array<{ id: string; state: string; correlationId: string; lane: string }>>(`SELECT id,state,"correlationId",lane FROM "SyncRun" WHERE "replayPlanId"=$1 ORDER BY "createdAt"`, replayPlanId);
      const attempts = await database.$queryRawUnsafe<Array<{ syncRunId: string; attemptNumber: number; state: string; classifiedReason: string | null }>>(`SELECT a."syncRunId",a."attemptNumber",a.state,a."classifiedReason" FROM "SyncAttempt" a JOIN "SyncRun" r ON r.id=a."syncRunId" WHERE r."replayPlanId"=$1 ORDER BY a."syncRunId",a."attemptNumber"`, replayPlanId);
      const deliveries = await database.$queryRawUnsafe<Array<{ syncRunId: string; state: string; attemptCount: number; classifiedReason: string | null; leaseExpiresAt: Date | null; deliveredAt: Date | null }>>(
        `SELECT d."syncRunId",d.state,d."attemptCount",d."classifiedReason",d."leaseExpiresAt",d."deliveredAt"
         FROM "ReplayDelivery" d JOIN "SyncRun" r ON r.id=d."syncRunId"
         WHERE r."replayPlanId"=$1 ORDER BY d."createdAt",d.id`,
        replayPlanId,
      );
      const states = runs.map((run) => run.state);
      const executionState = states.every((value) => value === "SUCCEEDED") ? "SUCCEEDED" : states.some((value) => value === "RUNNING") ? "RUNNING" : states.some((value) => value === "FAILED") ? "FAILED" : "PENDING";
      const outcome = executionState === "SUCCEEDED" ? "COMPLETED" : executionState === "FAILED" ? "DEAD_LETTER" : "PENDING";
      const delivered = deliveries.filter((delivery) => delivery.state === "DELIVERED").length;
      const retrying = deliveries.filter((delivery) => delivery.state === "RETRYABLE").length;
      const pending = deliveries.length - delivered - retrying;
      const deliveryState = delivered === deliveries.length ? "DELIVERED" : retrying > 0 ? "RETRYING" : "PENDING";
      const publicRuns = runs.map((run) => ({ ...run, delivery: deliveries.find((delivery) => delivery.syncRunId === run.id) }));
      const state = executionState === "PENDING" ? "QUEUED" : executionState;
      return {
        replayPlanId,
        state,
        outcome,
        delivery: { state: deliveryState, delivered, retrying, pending, records: deliveries },
        execution: { state: executionState, outcome },
        providerPolicy: { classification, approved, current },
        lane: approvedSnapshot?.lane ?? null,
        runs: publicRuns,
        attempts,
      };
    },
  };
}
type QueuedRun = { syncRunId: string; logicalId: string; revision: number; input: RecoveryInput; unit: ReplayUnit };

@Injectable()
export class ReplayService implements OnModuleDestroy {
  private readonly engine: ReturnType<typeof createReplayService> | null;
  private readonly queueClient: (ReplayEnqueuer & { close(): Promise<void> }) | null;
  constructor(@Optional() database?: PrismaClient) {
    const resolved = database ?? (process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null);
    this.queueClient = resolved && process.env.REDIS_URL ? createBullReplayEnqueuer(process.env.REDIS_URL, resolved, process.env.QUEUE_PREFIX) : null;
    this.engine = resolved ? createReplayService({ database: resolved, ...(this.queueClient ? { enqueuer: this.queueClient } : {}) }) : null;
  }
  private requireEngine() { if (!this.engine) throw new NotFoundException("Not found"); return this.engine; }
  preview(input: Record<string, unknown>, actor: string) { return this.requireEngine().preview(input, actor); }
  async queue(input: Record<string, unknown>) {
    try { return await this.requireEngine().queue(input); }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "STALE_PREVIEW") throw new ConflictException({ code });
      if (code === "QUEUE_DELIVERY_FAILED") throw new ServiceUnavailableException({ code });
      throw error;
    }
  }
  status(id: string) { return this.requireEngine().status(id); }
  dispatchDeliveries(id?: string) { return this.requireEngine().dispatchDeliveries(id); }
  async onModuleDestroy() { await this.queueClient?.close(); }
}
