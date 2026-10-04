import { createHash } from "node:crypto";

export interface PipelineLogicalUnit {
  provider: string;
  competitionId: string;
  seasonId: string;
  endpoint: string;
  from: string;
  to: string;
  purpose: string;
  revision?: number;
}

export function createPipelineJobId(input: PipelineLogicalUnit): string {
  const identity = [input.provider, input.competitionId, input.seasonId, input.endpoint, input.from, input.to, input.purpose, input.revision ?? 1].join(":");
  return createHash("sha256").update(identity).digest("hex");
}

export function createPipelineQueueName(prefix: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error("Queue prefix contains unsupported characters");
  return `${prefix}-historical-pipeline`;
}

export function createForecastQueueName(prefix: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error("Queue prefix contains unsupported characters");
  return `${prefix}-forecast-publication`;
}
