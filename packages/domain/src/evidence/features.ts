import type { EvidenceComponent, EvidenceMatch, EvidenceReceipt } from "./contract.js";
import { toSourceRef } from "./contract.js";
import { foldElo } from "./elo.js";
import { selectEligibleEvidence } from "./eligibility.js";
import { calculateWeightedForm } from "./form.js";

export interface TeamEvidenceInput {
  readonly teamId: string;
  readonly opponentId?: string;
  readonly asOf: string;
  readonly matches: readonly EvidenceMatch[];
  readonly historyTruncated?: boolean;
}

type Rate = Readonly<{ for: number; against: number }>;
type H2H = Readonly<{ pointsPerMatch: number; weight: number }>;

function component<T>(matches: readonly EvidenceMatch[], value: T | null): EvidenceComponent<T> {
  return { value, sampleSize: matches.length, windowStart: matches[0]?.effectiveAt ?? null, windowEnd: matches.at(-1)?.effectiveAt ?? null, sourceRefs: matches.map(toSourceRef), limitation: matches.length === 0 || value === null ? "NO_ELIGIBLE_HISTORY" : null };
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildTeamEvidence(input: TeamEvidenceInput) {
  const resolvedAsOf = new Date(input.asOf).toISOString();
  const eligible = selectEligibleEvidence({ asOf: resolvedAsOf, matches: input.matches });
  const home = eligible.filter((match) => match.venue === "HOME");
  const away = eligible.filter((match) => match.venue === "AWAY");
  const scored = eligible.filter((match) => match.goalsFor !== undefined && match.goalsAgainst !== undefined);
  const h2hMatches = input.opponentId === undefined ? [] : eligible.filter((match) => match.opponentId === input.opponentId).slice(-10);
  const lastKickoff = eligible.at(-1)?.kickoffUtc;
  const restDays = lastKickoff === undefined ? null : Math.max(0, (Date.parse(resolvedAsOf) - Date.parse(lastKickoff)) / 86_400_000);
  const rate = scored.length === 0 ? null : { for: average(scored.map((match) => match.goalsFor as number)) as number, against: average(scored.map((match) => match.goalsAgainst as number)) as number };
  const h2hPoints = average(h2hMatches.map((match) => match.points ?? 0));
  const receipt: EvidenceReceipt = {
    requestedAsOf: input.asOf,
    resolvedAsOf,
    configVersion: "evidence-v1",
    sourceWindow: { requestedFrom: null, requestedTo: resolvedAsOf, returnedFrom: eligible[0]?.effectiveAt ?? null, returnedTo: eligible.at(-1)?.effectiveAt ?? null },
    inputs: eligible.map(toSourceRef),
  };
  return {
    teamId: input.teamId,
    state: eligible.length === 0 ? "EMPTY" as const : input.historyTruncated === true ? "LIMITED" as const : "COMPLETE" as const,
    receipt,
    form5: calculateWeightedForm({ asOf: input.asOf, windowSize: 5, matches: input.matches, ...(input.historyTruncated === undefined ? {} : { historyTruncated: input.historyTruncated }) }),
    form10: calculateWeightedForm({ asOf: input.asOf, windowSize: 10, matches: input.matches, ...(input.historyTruncated === undefined ? {} : { historyTruncated: input.historyTruncated }) }),
    elo: foldElo(eligible),
    homeStrength: component(home, average(home.map((match) => match.points ?? 0))),
    awayStrength: component(away, average(away.map((match) => match.points ?? 0))),
    goalRates: component<Rate>(scored, rate),
    restDays: component(eligible.slice(-1), restDays),
    h2h: component<H2H>(h2hMatches, h2hPoints === null ? null : { pointsPerMatch: h2hPoints, weight: Math.min(0.05, h2hMatches.length * 0.005) }),
  };
}
