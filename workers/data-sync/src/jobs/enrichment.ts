export type EnrichmentEndpoint = "LINEUPS" | "INJURIES" | "ODDS" | "STATISTICS";

type EnrichmentObservation = { state: "observed" | "observed-empty"; capturedAt?: string; payload: unknown };
type Capability = { supported: boolean; expiresAt: string | null };

export type EnrichmentJobResult =
  | { status: "denied"; reason: "UNKNOWN_CAPABILITY" | "UNSUPPORTED_CAPABILITY" | "STALE_CAPABILITY" | "CIRCUIT_OPEN" | "BUDGET_PROTECTED" }
  | { status: "completed"; evidenceState: "OBSERVED_EMPTY"; observationId: null; forecastId: null }
  | { status: "completed"; evidenceState: "OBSERVED"; observationId: string; receiptHash: string; forecastId: string | null };

export async function runEnrichmentJob(input: {
  fixtureId: string;
  endpoint: EnrichmentEndpoint;
  cutoff: string;
  readCapability: () => Promise<Capability | null>;
  readCircuit: () => Promise<"CLOSED" | "OPEN" | "HALF_OPEN">;
  reserve: () => Promise<{ reserved: boolean; reused?: boolean; reason?: string }>;
  providerFactory: () => { fetch: () => Promise<EnrichmentObservation> };
  persist: (observation: EnrichmentObservation) => Promise<{ observationId: string; receiptHash: string }>;
  issueLineupForecast?: (input: { fixtureId: string; cutoff: string; officialLineupObservationId: string; receiptHash: string }) => Promise<string>;
  now?: Date;
}): Promise<EnrichmentJobResult> {
  const now = input.now ?? new Date();
  const capability = await input.readCapability();
  if (!capability) return { status: "denied", reason: "UNKNOWN_CAPABILITY" };
  if (!capability.supported) return { status: "denied", reason: "UNSUPPORTED_CAPABILITY" };
  if (capability.expiresAt && new Date(capability.expiresAt) <= now) return { status: "denied", reason: "STALE_CAPABILITY" };
  if (await input.readCircuit() !== "CLOSED") return { status: "denied", reason: "CIRCUIT_OPEN" };
  if (!(await input.reserve()).reserved) return { status: "denied", reason: "BUDGET_PROTECTED" };

  const observation = await input.providerFactory().fetch();
  if (observation.state === "observed-empty") return { status: "completed", evidenceState: "OBSERVED_EMPTY", observationId: null, forecastId: null };
  const stored = await input.persist(observation);
  let forecastId: string | null = null;
  if (input.endpoint === "LINEUPS" && officialSameFixtureBeforeCutoff(observation, input.fixtureId, input.cutoff) && input.issueLineupForecast) {
    forecastId = await input.issueLineupForecast({ fixtureId: input.fixtureId, cutoff: input.cutoff, officialLineupObservationId: stored.observationId, receiptHash: stored.receiptHash });
  }
  return { status: "completed", evidenceState: "OBSERVED", ...stored, forecastId };
}

function officialSameFixtureBeforeCutoff(observation: EnrichmentObservation, fixtureId: string, cutoff: string): boolean {
  if (!observation.capturedAt || new Date(observation.capturedAt) > new Date(cutoff) || typeof observation.payload !== "object" || observation.payload === null) return false;
  const payload = observation.payload as { fixtureId?: unknown; status?: unknown; players?: unknown };
  return payload.fixtureId === fixtureId && payload.status === "OFFICIAL_CONFIRMED" && Array.isArray(payload.players) && payload.players.length > 0;
}
