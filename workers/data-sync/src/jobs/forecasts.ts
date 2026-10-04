import { createHash } from "node:crypto";
import type { ForecastKind, ForecastRequestDto, ForecastResponseDto } from "@bet-stats/domain";

export interface ForecastPublicationJobData {
  readonly fixtureId: string;
  readonly kind: ForecastKind;
  readonly cutoff: string;
  readonly modelVersion: "poisson-ensemble-v1";
  readonly configHash: string;
  readonly evidenceBuildIds: readonly string[];
}

export interface ForecastPublicationJob {
  readonly name: "publish-forecast";
  readonly jobId: string;
  readonly data: ForecastPublicationJobData;
}

export function createForecastPublicationJobId(input: ForecastPublicationJobData): string {
  const evidence = [...input.evidenceBuildIds].sort().join(",");
  return createHash("sha256").update([input.fixtureId, input.kind, input.cutoff, input.modelVersion, input.configHash, evidence].join(":"), "utf8").digest("hex");
}

export function createForecastPublicationJob(input: ForecastPublicationJobData): ForecastPublicationJob {
  const data = { ...input, evidenceBuildIds: [...input.evidenceBuildIds].sort() };
  return { name: "publish-forecast", jobId: createForecastPublicationJobId(data), data };
}

export interface ForecastPublicationPlanInput {
  readonly fixtureId: string;
  readonly kickoffUtc: string;
  readonly initialEligibleCutoff: string | null;
  readonly modelVersion: "poisson-ensemble-v1";
  readonly configHash: string;
  evidenceBuildIdsAt(cutoff: string): Promise<readonly string[] | null>;
  officialLineupAt(cutoff: string): Promise<{ readonly id: string; readonly confirmedAt: string } | null>;
}

export async function planForecastPublication(input: ForecastPublicationPlanInput): Promise<readonly ForecastPublicationJob[]> {
  const kickoff = Date.parse(input.kickoffUtc);
  if (!Number.isFinite(kickoff)) throw new Error("INVALID_FIXTURE_KICKOFF");
  const planned: Array<Readonly<{ kind: ForecastKind; cutoff: string }>> = [];
  if (input.initialEligibleCutoff) planned.push({ kind: "INITIAL", cutoff: new Date(input.initialEligibleCutoff).toISOString() });
  planned.push({ kind: "PRE_MATCH", cutoff: new Date(kickoff - 6 * 60 * 60 * 1_000).toISOString() });
  const lineup = await input.officialLineupAt(input.kickoffUtc);
  if (lineup && Date.parse(lineup.confirmedAt) < kickoff) planned.push({ kind: "LINEUP_CONFIRMED", cutoff: new Date(lineup.confirmedAt).toISOString() });
  const jobs: ForecastPublicationJob[] = [];
  for (const item of planned) {
    if (Date.parse(item.cutoff) >= kickoff) continue;
    const evidenceBuildIds = await input.evidenceBuildIdsAt(item.cutoff);
    if (!evidenceBuildIds || evidenceBuildIds.length !== 2) continue;
    jobs.push(createForecastPublicationJob({ fixtureId: input.fixtureId, ...item, modelVersion: input.modelVersion, configHash: input.configHash, evidenceBuildIds }));
  }
  return jobs;
}

export interface ForecastPublisher {
  publish(request: ForecastRequestDto): Promise<ForecastResponseDto>;
}

export function runForecastPublicationJob(data: ForecastPublicationJobData, publisher: ForecastPublisher): Promise<ForecastResponseDto> {
  return publisher.publish({ fixtureId: data.fixtureId, kind: data.kind, cutoff: data.cutoff });
}
