import type { RouteExecutionCandidate } from "./runner.js";

type Terminal = { state: "FAILED" | "SUCCEEDED" | "NO_FALLBACK"; observationId: string | null; provider: string };
type Admission = { admitted: boolean; reused: boolean; reason?: string | null; terminal: Terminal | null };

export type DurableRouteExecutionResult<T> =
  | { status: "completed"; provider: string; value: T; observationId: string }
  | { status: "replayed"; provider: string; observationId: string | null }
  | { status: "limited"; reason: "NO_FALLBACK"; lastValidAt: string | null; lastValidValue: T | null };

export async function executeProviderRoute<TProvider, TValue>(input: {
  routeId: string;
  attemptKey: string;
  candidates: readonly RouteExecutionCandidate<TProvider>[];
  appendRoute: () => Promise<unknown>;
  admitAttempt: (attempt: { routeId: string; attemptKey: string; attemptId: string; provider: string; ordinal: number }) => Promise<Admission>;
  completeAttempt: (attempt: { attemptKey: string; provider: string; state: Terminal["state"]; reason: string | null; observationId: string | null }) => Promise<unknown>;
  call: (provider: TProvider) => Promise<TValue>;
  classifyFailure: (error: unknown) => { eligible: boolean; trigger?: string };
  persistObservation: (observation: { provider: string; value: TValue; attemptKey: string }) => Promise<{ id: string; observedAt: string }>;
  findLastValid: () => Promise<{ at: string; value: TValue } | null>;
}): Promise<DurableRouteExecutionResult<TValue>> {
  if (input.candidates.length === 0 || input.candidates.length > 2) throw new Error("INVALID_PROVIDER_CANDIDATE_LIST");
  await input.appendRoute();
  for (let ordinal = 0; ordinal < input.candidates.length; ordinal += 1) {
    const candidate = input.candidates[ordinal]!;
    const attemptKey = `${input.attemptKey}:${ordinal}`;
    const admission = await input.admitAttempt({ routeId: input.routeId, attemptKey, attemptId: `${input.routeId}:attempt:${ordinal}`, provider: candidate.provider, ordinal });
    if (admission.reused && admission.terminal) return { status: "replayed", provider: admission.terminal.provider, observationId: admission.terminal.observationId };
    if (!admission.admitted) continue;
    try {
      const value = await input.call(candidate.factory());
      const observation = await input.persistObservation({ provider: candidate.provider, value, attemptKey });
      await input.completeAttempt({ attemptKey, provider: candidate.provider, state: "SUCCEEDED", reason: null, observationId: observation.id });
      return { status: "completed", provider: candidate.provider, value, observationId: observation.id };
    } catch (error) {
      const failure = input.classifyFailure(error);
      const mayFallback = failure.eligible && ordinal + 1 < input.candidates.length;
      await input.completeAttempt({ attemptKey, provider: candidate.provider, state: mayFallback ? "FAILED" : "NO_FALLBACK", reason: failure.trigger ?? "PROVIDER_FAILURE", observationId: null });
      if (!mayFallback) break;
    }
  }
  const lastValid = await input.findLastValid();
  return { status: "limited", reason: "NO_FALLBACK", lastValidAt: lastValid?.at ?? null, lastValidValue: lastValid?.value ?? null };
}
