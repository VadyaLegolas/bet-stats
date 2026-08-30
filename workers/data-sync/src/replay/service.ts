import { createHash, randomUUID } from "node:crypto";

import { createPipelineJobId } from "../jobs/pipeline.js";

const PROVIDERS = new Set(["football-data.org"]);
const COMPETITIONS = new Set(["PL", "PD", "BL1", "SA", "FL1", "CL", "EL"]);
const ENDPOINTS = new Set(["FIXTURES", "RESULTS", "STANDINGS"]);
const MAX_WINDOW_DAYS = 31;

export interface ReplayPreview {
  previewId: string;
  previewVersion: string;
  dryRun: true;
  queued: false;
  bounded: true;
  calls: number;
  builds: number;
  logicalJobIds: string[];
  input: { provider: string; competitionId: string; seasonId: string; endpointFamily: string; from: string; to: string };
}

export async function previewReplay(input: Record<string, unknown>): Promise<ReplayPreview> {
  const normalized = validateInput(input);
  const days = Math.floor((Date.parse(normalized.to) - Date.parse(normalized.from)) / 86_400_000) + 1;
  const logicalJobIds = Array.from({ length: days }, (_, offset) => {
    const from = new Date(Date.parse(normalized.from) + offset * 86_400_000).toISOString();
    const to = new Date(Math.min(Date.parse(normalized.to), Date.parse(from) + 86_399_999)).toISOString();
    return createPipelineJobId({ provider: normalized.provider, competitionId: normalized.competitionId, seasonId: normalized.seasonId, endpoint: normalized.endpointFamily, from, to, purpose: "replay" });
  });
  const previewId = randomUUID();
  const previewVersion = createHash("sha256").update(JSON.stringify({ normalized, logicalJobIds })).digest("hex");
  const preview: ReplayPreview = { previewId, previewVersion, dryRun: true, queued: false, bounded: true, calls: days, builds: days, logicalJobIds, input: normalized };
  return preview;
}

export async function queueReplay(input: Record<string, unknown>) {
  void input;
  throw replayError("DURABLE_REPOSITORY_REQUIRED");
}

function validateInput(input: Record<string, unknown>): ReplayPreview["input"] {
  const provider = String(input.provider ?? "");
  const competitionId = String(input.competitionId ?? "");
  const seasonId = String(input.seasonId ?? "");
  const endpointFamily = String(input.endpointFamily ?? "");
  const from = new Date(String(input.from ?? ""));
  const to = new Date(String(input.to ?? ""));
  if (!PROVIDERS.has(provider) || !COMPETITIONS.has(competitionId) || !ENDPOINTS.has(endpointFamily)) throw replayError("NOT_ALLOWED");
  if (!seasonId || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) throw replayError("INVALID_WINDOW");
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > MAX_WINDOW_DAYS) throw replayError("WINDOW_TOO_LARGE");
  return { provider, competitionId, seasonId, endpointFamily, from: from.toISOString(), to: to.toISOString() };
}

function replayError(code: string): Error & { code: string } { return Object.assign(new Error(code), { code }); }
