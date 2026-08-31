import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, OnModuleDestroy, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { Queue } from "bullmq";

const PROVIDERS = new Set(["football-data.org"]);
const COMPETITIONS = new Set(["PL", "PD", "BL1", "SA", "FL1", "CL", "EL"]);
const ENDPOINTS = new Set(["FIXTURES", "RESULTS", "STANDINGS"]);
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export type ReplayInput = { provider: string; competitionId: string; seasonId: string; endpointFamily: string; from: string; to: string };
export type ReplayUnit = { logicalId: string; from: string; to: string };
type PreviewRow = { id: string; logicalKey: string; version: number; previewVersion: string; normalizedInput: ReplayInput; unitManifest: ReplayUnit[]; impact: { calls: number; builds: number }; providerPolicyFingerprint: string; expiresAt: Date; consumedAt: Date | null; actor: string };
export interface ReplayEnqueuer { enqueue(run: { syncRunId: string; replayPlanId: string; logicalId: string; revision: number; input: ReplayInput; unit: ReplayUnit }): Promise<void> }

export function createBullReplayEnqueuer(redisUrl: string, database: PrismaClient, prefix = "bet-stats"): ReplayEnqueuer & { close(): Promise<void> } {
  const queue = new Queue(`${prefix}-sync-standard`, { connection: { url: redisUrl, maxRetriesPerRequest: null } });
  return {
    async enqueue(run) {
      try {
        await queue.add(run.input.endpointFamily.toLowerCase(), run, {
          attempts: 3,
          backoff: { type: "exponential", delay: 1_000, jitter: 0.25 },
          jobId: `${run.logicalId}-${run.revision}`,
          removeOnComplete: { age: 86_400, count: 1_000 },
          removeOnFail: { age: 604_800, count: 5_000 },
        });
      } catch (error) {
        await database.$executeRawUnsafe(`UPDATE "SyncRun" SET "completionManifest"=jsonb_set("completionManifest",'{delivery}',to_jsonb('RETRYABLE'::text),true) WHERE id=$1 AND state='PENDING'`, run.syncRunId);
        throw Object.assign(new Error("QUEUE_DELIVERY_FAILED"), { code: "QUEUE_DELIVERY_FAILED", cause: error });
      }
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
function publicPreview(row: PreviewRow) { return { previewId: row.id, previewVersion: row.previewVersion, dryRun: true as const, bounded: true as const, calls: row.impact.calls, builds: row.impact.builds, lane: "standard" as const, effects: { immutableObservations: true as const, predictionSnapshotsMutated: false as const }, input: row.normalizedInput, logicalJobIds: row.unitManifest.map((unit) => unit.logicalId) }; }

export function createReplayService(options: { database: PrismaClient; enqueuer?: ReplayEnqueuer; availableCalls?: number; circuit?: "CLOSED" | "OPEN"; actor?: string; now?: () => Date }) {
  const database = options.database; const availableCalls = options.availableCalls ?? 100; const circuit = options.circuit ?? "CLOSED"; const actor = options.actor ?? "operator"; const now = options.now ?? (() => new Date());
  return {
    async preview(raw: Record<string, unknown>) {
      const input = normalize(raw); const units = buildUnits(input);
      if (availableCalls < units.length || circuit === "OPEN") throw replayError("NO_HEADROOM", 409);
      const logicalKey = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const policy = createHash("sha256").update(JSON.stringify({ availableCalls, circuit })).digest("hex");
      const row = await database.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `replay-preview:${logicalKey}`);
        const prior = await tx.$queryRawUnsafe<PreviewRow[]>(`SELECT id,"logicalKey",version,"previewVersion","normalizedInput","unitManifest",impact,"providerPolicyFingerprint","expiresAt","consumedAt",actor FROM "ReplayPreview" WHERE "logicalKey"=$1 AND "consumedAt" IS NULL AND "expiresAt">$2 ORDER BY version DESC LIMIT 1`, logicalKey, now());
        if (prior[0]) return prior[0];
        const versions = await tx.$queryRawUnsafe<Array<{ version: number }>>(`SELECT COALESCE(MAX(version),0)::int AS version FROM "ReplayPreview" WHERE "logicalKey"=$1`, logicalKey);
        const version = (versions[0]?.version ?? 0) + 1; const previewVersion = createHash("sha256").update(JSON.stringify({ logicalKey, version, input, units, policy })).digest("hex");
        const inserted = await tx.$queryRawUnsafe<PreviewRow[]>(`INSERT INTO "ReplayPreview" (id,"logicalKey",version,"previewVersion","normalizedInput","unitManifest",impact,"providerPolicyFingerprint","expiresAt",actor) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10) RETURNING id,"logicalKey",version,"previewVersion","normalizedInput","unitManifest",impact,"providerPolicyFingerprint","expiresAt","consumedAt",actor`, randomUUID(), logicalKey, version, previewVersion, JSON.stringify(input), JSON.stringify(units), JSON.stringify({ calls: units.length, builds: units.length }), policy, new Date(now().getTime() + 900_000), actor);
        return inserted[0]!;
      });
      return { ...publicPreview(row), headroom: { available: true as const, remainingCalls: availableCalls - row.impact.calls } };
    },
    async queue(raw: Record<string, unknown>) {
      const previewId = String(raw.previewId ?? ""); const previewVersion = String(raw.previewVersion ?? "");
      if (raw.newRevision === true && String(raw.reason ?? "").trim().length < 3) throw replayError("REVISION_REASON_REQUIRED");
      const committed = await database.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `replay-confirm:${previewId}`);
        const rows = await tx.$queryRawUnsafe<PreviewRow[]>(`SELECT id,"logicalKey",version,"previewVersion","normalizedInput","unitManifest",impact,"providerPolicyFingerprint","expiresAt","consumedAt",actor FROM "ReplayPreview" WHERE id=$1`, previewId); const preview = rows[0];
        if (!preview || preview.previewVersion !== previewVersion || preview.expiresAt <= now()) throw replayError("STALE_PREVIEW", 409);
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
      if (!committed.duplicate && options.enqueuer) for (const run of committed.runs) await options.enqueuer.enqueue({ ...run, replayPlanId: committed.replayPlanId });
      return { replayPlanId: committed.replayPlanId, queued: !committed.duplicate, duplicate: committed.duplicate, revision: committed.revision, reason: raw.newRevision === true ? String(raw.reason).trim() : null, effects: { immutableObservations: true as const, predictionSnapshotsMutated: false as const } };
    },
    async status(replayPlanId: string) {
      const plans = await database.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "ReplayPlan" WHERE id=$1`, replayPlanId); if (!plans[0]) throw replayError("REPLAY_NOT_FOUND", 404);
      const runs = await database.$queryRawUnsafe<Array<{ id: string; state: string; correlationId: string; lane: string }>>(`SELECT id,state,"correlationId",lane FROM "SyncRun" WHERE "replayPlanId"=$1 ORDER BY "createdAt"`, replayPlanId);
      const attempts = await database.$queryRawUnsafe<Array<{ syncRunId: string; attemptNumber: number; state: string; classifiedReason: string | null }>>(`SELECT a."syncRunId",a."attemptNumber",a.state,a."classifiedReason" FROM "SyncAttempt" a JOIN "SyncRun" r ON r.id=a."syncRunId" WHERE r."replayPlanId"=$1 ORDER BY a."syncRunId",a."attemptNumber"`, replayPlanId);
      const states = runs.map((run) => run.state); const state = states.every((value) => value === "SUCCEEDED") ? "SUCCEEDED" : states.some((value) => value === "RUNNING") ? "RUNNING" : states.some((value) => value === "FAILED") ? "FAILED" : "QUEUED";
      return { replayPlanId, state, outcome: state === "SUCCEEDED" ? "COMPLETED" : state === "FAILED" ? "DEAD_LETTER" : "PENDING", provider: { circuit, quota: availableCalls > 0 ? "AVAILABLE" : "EXHAUSTED" }, lane: "standard", runs, attempts };
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
  async onModuleDestroy() { await this.queueClient?.close(); }
}
