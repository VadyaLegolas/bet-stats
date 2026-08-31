import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, OnModuleDestroy, Optional, ServiceUnavailableException } from "@nestjs/common";
import {
  createPrismaClient,
  createReplayProviderPolicyRepository,
  type PrismaClient,
  type ReplayProviderPolicyRepository,
} from "@bet-stats/database";
import {
  evaluateReplayProviderPolicy,
  fingerprintReplayProviderPolicy,
  type ReplayProviderPolicySnapshot,
} from "@bet-stats/domain";
import { Queue } from "bullmq";
import { createReplayDeliveryDispatcher } from "./replay-delivery.service.js";

const PROVIDERS = new Set(["football-data.org"]);
const COMPETITIONS = new Set(["PL", "PD", "BL1", "SA", "FL1", "CL", "EL"]);
const ENDPOINTS = new Set(["FIXTURES", "RESULTS", "STANDINGS"]);
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export type ReplayInput = { provider: string; competitionId: string; seasonId: string; endpointFamily: string; from: string; to: string };
export type ReplayUnit = { logicalId: string; from: string; to: string };
type PreviewImpact = { calls: number; builds: number; providerPolicy?: unknown };
type PreviewRow = { id: string; logicalKey: string; version: number; previewVersion: string; normalizedInput: ReplayInput; unitManifest: ReplayUnit[]; impact: PreviewImpact; providerPolicyFingerprint: string; expiresAt: Date; consumedAt: Date | null; actor: string };
export interface ReplayEnqueuer { enqueue(run: { syncRunId: string; replayPlanId: string; logicalId: string; revision: number; input: ReplayInput; unit: ReplayUnit }): Promise<void> }

const DEFAULT_REPLAY_PROVIDER_POLICIES = ["FIXTURES", "RESULTS", "STANDINGS"].map((endpointFamily) => ({
  provider: "football-data.org",
  endpointFamily,
  lane: "standard" as const,
  configuredAllowance: 10,
  criticalHeadroom: 3,
  resetTimezone: "UTC",
}));

export function createBullReplayEnqueuer(redisUrl: string, database: PrismaClient, prefix = "bet-stats"): ReplayEnqueuer & { close(): Promise<void> } {
  void database;
  const queue = new Queue(`${prefix}-sync-standard`, { connection: { url: redisUrl, maxRetriesPerRequest: null } });
  return {
    async enqueue(run) {
      await queue.add(run.input.endpointFamily.toLowerCase(), run, {
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

function replayError(code: string, status = 400): Error & { code: string; status: number } { return Object.assign(new Error(code), { code, status }); }
function normalize(input: Record<string, unknown>): ReplayInput {
  const value = { provider: String(input.provider ?? ""), competitionId: String(input.competitionId ?? ""), seasonId: String(input.seasonId ?? "").trim(), endpointFamily: String(input.endpointFamily ?? ""), from: String(input.from ?? ""), to: String(input.to ?? "") };
  if (!PROVIDERS.has(value.provider) || !COMPETITIONS.has(value.competitionId) || !ENDPOINTS.has(value.endpointFamily)) throw replayError("NOT_ALLOWED");
  if (!value.seasonId || !UTC_INSTANT.test(value.from) || !UTC_INSTANT.test(value.to)) throw replayError("INVALID_WINDOW");
  const from = Date.parse(value.from); const to = Date.parse(value.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw replayError("INVALID_WINDOW");
  if (Math.floor((to - from) / 86_400_000) + 1 > 31) throw replayError("WINDOW_TOO_LARGE");
  return { ...value, from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}
function buildUnits(input: ReplayInput): ReplayUnit[] {
  const count = Math.floor((Date.parse(input.to) - Date.parse(input.from)) / 86_400_000) + 1;
  return Array.from({ length: count }, (_, offset) => {
    const from = new Date(Date.parse(input.from) + offset * 86_400_000).toISOString();
    const to = new Date(Math.min(Date.parse(input.to), Date.parse(from) + 86_399_999)).toISOString();
    return { logicalId: createHash("sha256").update(JSON.stringify({ ...input, from, to, purpose: "replay" })).digest("hex"), from, to };
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
  const providerPolicy = snapshotFromImpact(row.impact.providerPolicy);
  if (!providerPolicy) throw replayError("MALFORMED_POLICY", 409);
  return {
    previewId: row.id, previewVersion: row.previewVersion, dryRun: true as const, bounded: true as const,
    calls: row.impact.calls, builds: row.impact.builds, lane: providerPolicy.lane,
    effects: { immutableObservations: true as const, predictionSnapshotsMutated: false as const },
    input: row.normalizedInput, logicalJobIds: row.unitManifest.map((unit) => unit.logicalId),
    providerPolicy: publicPolicy(providerPolicy),
  };
}

export function createReplayService(options: { database: PrismaClient; enqueuer?: ReplayEnqueuer; providerPolicyRepository?: ReplayProviderPolicyRepository; actor?: string; now?: () => Date }) {
  const database = options.database; const actor = options.actor ?? "operator"; const now = options.now ?? (() => new Date());
  const providerPolicyRepository = options.providerPolicyRepository ?? createReplayProviderPolicyRepository({ database, policies: DEFAULT_REPLAY_PROVIDER_POLICIES, now });
  const dispatcher = options.enqueuer ? createReplayDeliveryDispatcher({ database, enqueuer: options.enqueuer, now }) : null;
  return {
    async preview(raw: Record<string, unknown>) {
      const input = normalize(raw); const units = buildUnits(input);
      let providerPolicy: ReplayProviderPolicySnapshot;
      try { providerPolicy = await providerPolicyRepository.read(input.provider, input.endpointFamily); }
      catch { throw replayError("MALFORMED_POLICY", 409); }
      const decision = evaluateReplayProviderPolicy(providerPolicy, units.length, now());
      if (!decision.allowed) throw replayError(decision.reason, 409);
      const logicalKey = createHash("sha256").update(JSON.stringify(input)).digest("hex");
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
      if (raw.newRevision === true && String(raw.reason ?? "").trim().length < 3) throw replayError("REVISION_REASON_REQUIRED");
      const committed = await database.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `replay-confirm:${previewId}`);
        const rows = await tx.$queryRawUnsafe<PreviewRow[]>(`SELECT id,"logicalKey",version,"previewVersion","normalizedInput","unitManifest",impact,"providerPolicyFingerprint","expiresAt","consumedAt",actor FROM "ReplayPreview" WHERE id=$1`, previewId); const preview = rows[0];
        if (!preview || preview.previewVersion !== previewVersion || preview.expiresAt <= now()) throw replayError("STALE_PREVIEW", 409);
        const approvedPolicy = snapshotFromImpact(preview.impact.providerPolicy);
        if (!approvedPolicy || preview.providerPolicyFingerprint !== fingerprintReplayProviderPolicy(approvedPolicy)) throw replayError("STALE_PREVIEW", 409);
        let currentPolicy: ReplayProviderPolicySnapshot;
        try { currentPolicy = await providerPolicyRepository.read(preview.normalizedInput.provider, preview.normalizedInput.endpointFamily); }
        catch { throw replayError("STALE_PREVIEW", 409); }
        if (preview.providerPolicyFingerprint !== fingerprintReplayProviderPolicy(currentPolicy)) throw replayError("STALE_PREVIEW", 409);
        const currentDecision = evaluateReplayProviderPolicy(currentPolicy, preview.impact.calls, now());
        if (!currentDecision.allowed) throw replayError(currentDecision.reason, 409);
        const duplicate = await tx.$queryRawUnsafe<Array<{ id: string; revision: number }>>(`SELECT id,revision FROM "ReplayPlan" WHERE "previewId"=$1`, previewId);
        if (duplicate[0]) return { replayPlanId: duplicate[0].id, revision: duplicate[0].revision, duplicate: true, runs: [] as QueuedRun[] };
        if (preview.consumedAt) throw replayError("STALE_PREVIEW", 409);
        const revisions = await tx.$queryRawUnsafe<Array<{ revision: number }>>(`SELECT COALESCE(MAX(revision),0)::int AS revision FROM "ReplayPlan" WHERE "logicalKey"=$1`, preview.logicalKey);
        const revision = raw.newRevision === true ? (revisions[0]?.revision ?? 0) + 1 : 1; const replayPlanId = randomUUID();
        await tx.$executeRawUnsafe(`INSERT INTO "ReplayPlan" (id,"logicalKey",revision,provider,"competitionId","endpointFamily","windowFrom","windowTo","previewVersion",reason,actor,"previewId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, replayPlanId, preview.logicalKey, revision, preview.normalizedInput.provider, preview.normalizedInput.competitionId, preview.normalizedInput.endpointFamily, preview.normalizedInput.from, preview.normalizedInput.to, preview.previewVersion, raw.newRevision === true ? String(raw.reason).trim() : null, preview.actor, preview.id);
        const runs: QueuedRun[] = [];
        for (const unit of preview.unitManifest) {
          const syncRunId = randomUUID();
          await tx.$executeRawUnsafe(`INSERT INTO "SyncRun" (id,"logicalKey",revision,provider,"endpointFamily",lane,"windowFrom","windowTo",state,"correlationId","replayPlanId","expectedUnits","expectedCaptures","completionManifest") VALUES ($1,$2,$3,$4,$5,'standard',$6,$7,'PENDING',$8,$9,1,1,$10::jsonb)`, syncRunId, `${unit.logicalId}:replay`, revision, preview.normalizedInput.provider, preview.normalizedInput.endpointFamily, unit.from, unit.to, randomUUID(), replayPlanId, JSON.stringify({ expectedUnits: [unit.logicalId], completedUnits: [], expectedCaptures: [unit.logicalId], completedCaptures: [] }));
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
      return { replayPlanId: committed.replayPlanId, queued: !committed.duplicate, duplicate: committed.duplicate, revision: committed.revision, reason: raw.newRevision === true ? String(raw.reason).trim() : null, effects: { immutableObservations: true as const, predictionSnapshotsMutated: false as const } };
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
      const approved = approvedSnapshot && plan.providerPolicyFingerprint === fingerprintReplayProviderPolicy(approvedSnapshot)
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
type QueuedRun = { syncRunId: string; logicalId: string; revision: number; input: ReplayInput; unit: ReplayUnit };

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
  preview(input: Record<string, unknown>) { return this.requireEngine().preview(input); }
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
