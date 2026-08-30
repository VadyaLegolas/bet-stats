import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Injectable } from "@nestjs/common";

const PROVIDERS = new Set(["football-data.org"]);
const COMPETITIONS = new Set(["PL", "PD", "BL1", "SA", "FL1", "CL", "EL"]);
const ENDPOINTS = new Set(["FIXTURES", "RESULTS", "STANDINGS"]);
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_WINDOW_DAYS = 31;

type ReplayInput = { provider: string; competitionId: string; seasonId: string; endpointFamily: string; from: string; to: string };
type PreviewRecord = { previewId: string; previewVersion: string; input: ReplayInput; calls: number; logicalJobIds: readonly string[]; queuedPlanId: string | null };
type StatusRecord = { replayPlanId: string; state: "QUEUED"; outcome: "PENDING"; provider: { circuit: "CLOSED" | "OPEN"; quota: "AVAILABLE" | "EXHAUSTED" }; lane: "standard" };

function apiError(code: string, status = 400): Error & { code: string; status: number } {
  return Object.assign(new Error(code), { code, status });
}

function normalize(input: Record<string, unknown>): ReplayInput {
  const provider = String(input.provider ?? "");
  const competitionId = String(input.competitionId ?? "");
  const seasonId = String(input.seasonId ?? "").trim();
  const endpointFamily = String(input.endpointFamily ?? "");
  const rawFrom = String(input.from ?? "");
  const rawTo = String(input.to ?? "");
  if (!PROVIDERS.has(provider) || !COMPETITIONS.has(competitionId) || !ENDPOINTS.has(endpointFamily)) throw apiError("NOT_ALLOWED");
  if (!seasonId || !UTC_INSTANT.test(rawFrom) || !UTC_INSTANT.test(rawTo)) throw apiError("INVALID_WINDOW");
  const from = Date.parse(rawFrom);
  const to = Date.parse(rawTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw apiError("INVALID_WINDOW");
  const days = Math.floor((to - from) / 86_400_000) + 1;
  if (days > MAX_WINDOW_DAYS) throw apiError("WINDOW_TOO_LARGE");
  return { provider, competitionId, seasonId, endpointFamily, from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export function createReplayService(options: { availableCalls?: number; circuit?: "CLOSED" | "OPEN" } = {}) {
  const availableCalls = options.availableCalls ?? 100;
  const circuit = options.circuit ?? "CLOSED";
  const previews = new Map<string, PreviewRecord>();
  const statuses = new Map<string, StatusRecord>();
  return {
    async preview(raw: Record<string, unknown>) {
      const input = normalize(raw);
      const calls = Math.floor((Date.parse(input.to) - Date.parse(input.from)) / 86_400_000) + 1;
      if (calls === 0 || availableCalls < calls || circuit === "OPEN") throw apiError("NO_HEADROOM", 409);
      const logicalJobIds = Array.from({ length: calls }, (_, offset) => createHash("sha256").update(JSON.stringify({ ...input, day: new Date(Date.parse(input.from) + offset * 86_400_000).toISOString() })).digest("hex"));
      const previewVersion = createHash("sha256").update(JSON.stringify({ input, logicalJobIds, availableCalls, circuit })).digest("hex");
      const previewId = randomUUID();
      previews.set(previewId, { previewId, previewVersion, input, calls, logicalJobIds, queuedPlanId: null });
      return { previewId, previewVersion, dryRun: true as const, bounded: true as const, calls, builds: calls, lane: "standard" as const, headroom: { available: true as const, remainingCalls: availableCalls - calls }, effects: { immutableObservations: true as const, predictionSnapshotsMutated: false as const }, input };
    },
    async queue(raw: Record<string, unknown>) {
      const previewId = String(raw.previewId ?? "");
      const preview = previews.get(previewId);
      if (!preview || raw.previewVersion !== preview.previewVersion) throw apiError("STALE_PREVIEW", 409);
      if (raw.newRevision === true && String(raw.reason ?? "").trim().length < 3) throw apiError("REVISION_REASON_REQUIRED");
      if (preview.queuedPlanId) return { replayPlanId: preview.queuedPlanId, queued: false as const, duplicate: true as const };
      const replayPlanId = randomUUID();
      preview.queuedPlanId = replayPlanId;
      statuses.set(replayPlanId, { replayPlanId, state: "QUEUED", outcome: "PENDING", provider: { circuit, quota: availableCalls > preview.calls ? "AVAILABLE" : "EXHAUSTED" }, lane: "standard" });
      return { replayPlanId, queued: true as const, duplicate: false as const, revision: raw.newRevision === true ? 2 : 1, reason: raw.newRevision === true ? String(raw.reason).trim() : null, effects: { immutableObservations: true as const, predictionSnapshotsMutated: false as const } };
    },
    async status(replayPlanId: string) {
      const status = statuses.get(replayPlanId);
      if (!status) throw apiError("REPLAY_NOT_FOUND", 404);
      return status;
    },
  };
}

@Injectable()
export class ReplayService {
  private readonly engine = createReplayService();
  preview(input: Record<string, unknown>) { return this.engine.preview(input); }
  async queue(input: Record<string, unknown>) {
    try { return await this.engine.queue(input); }
    catch (error) { if ((error as { code?: string }).code === "STALE_PREVIEW") throw new ConflictException({ code: "STALE_PREVIEW" }); throw error; }
  }
  status(id: string) { return this.engine.status(id); }
}
