import type { EvidenceComponent, EvidenceMatch } from "./contract.js";
import { toSourceRef } from "./contract.js";

export const ELO_CONFIG = Object.freeze({ version: "elo-1500-k20-home65-v1", start: 1500, kFactor: 20, homeAdjustment: 65 });

export function foldElo(matches: readonly EvidenceMatch[]): EvidenceComponent<number> {
  let rating = ELO_CONFIG.start;
  for (const match of matches) {
    const adjusted = rating + (match.venue === "HOME" ? ELO_CONFIG.homeAdjustment : 0);
    const expected = 1 / (1 + 10 ** ((ELO_CONFIG.start - adjusted) / 400));
    const actual = match.points === 3 ? 1 : match.points === 1 ? 0.5 : 0;
    rating += ELO_CONFIG.kFactor * (actual - expected);
  }
  return {
    value: rating,
    sampleSize: matches.length,
    windowStart: matches[0]?.effectiveAt ?? null,
    windowEnd: matches.at(-1)?.effectiveAt ?? null,
    sourceRefs: matches.map(toSourceRef),
    limitation: matches.length === 0 ? "NO_ELIGIBLE_HISTORY" : null,
  };
}
