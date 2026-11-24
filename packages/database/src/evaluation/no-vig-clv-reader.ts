import { NO_VIG_CLV_POLICY_VERSION, type NoVigClvUnavailableReason } from "@bet-stats/domain";

import type { PrismaClient } from "../client.js";

export type NoVigClvReading =
  | Readonly<{ status: "UNAVAILABLE"; policyVersion: typeof NO_VIG_CLV_POLICY_VERSION; reason: NoVigClvUnavailableReason; source?: string }>
  | Readonly<{
      status: "AVAILABLE";
      policyVersion: typeof NO_VIG_CLV_POLICY_VERSION;
      value: string;
      pCandidateFair: string;
      pCloseFair: string;
      closingObservedAt: string;
      source: string;
    }>;

export interface NoVigClvCandidate {
  readonly key: string;
  readonly fixtureId: string;
  readonly market: string;
  readonly selection: string;
  readonly oddsSnapshotId: string;
  readonly kickoffUtc: Date;
}

export type NoVigClvReaderClient = Pick<PrismaClient, "manualOddsSnapshot" | "closingOddsObservation">;

/** RED stub: replaced by the real reader in the GREEN commit. */
export async function readNoVigClvForCandidates(_client: NoVigClvReaderClient, candidates: readonly NoVigClvCandidate[]): Promise<ReadonlyMap<string, NoVigClvReading>> {
  return new Map(candidates.map((candidate) => [candidate.key, { status: "UNAVAILABLE", policyVersion: NO_VIG_CLV_POLICY_VERSION, reason: "CLOSING_SET_MISSING" } as NoVigClvReading]));
}
