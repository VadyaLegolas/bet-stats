import { classifyProviderError } from "./errors.js";

export function evaluateProviderCache(input: { expiresAt: string; now: string }) {
  return { hit: new Date(input.expiresAt).getTime() > new Date(input.now).getTime(), requiresReservation: false, authoritative: false };
}

export async function executeProviderCall(input: {
  provider: string;
  endpointFamily: string;
  circuitState?: "CLOSED" | "OPEN" | "HALF_OPEN";
  reserve?: () => Promise<unknown>;
  call: () => Promise<unknown>;
  attemptsMade?: number;
  maxAttempts?: number;
  correlationId: string;
}) {
  const circuit = { provider: input.provider, endpointFamily: input.endpointFamily };
  if (input.circuitState === "OPEN") return { status: "blocked", reason: "CIRCUIT_OPEN", circuit } as const;
  await input.reserve?.();
  const attempt = (input.attemptsMade ?? 0) + 1;
  try {
    const value = await input.call();
    return { status: "completed", attempts: attempt, value, correlationId: input.correlationId, circuit } as const;
  } catch (error) {
    const classification = classifyProviderError(error);
    const history = [{ attempt, reason: classification.reason }];
    if (!classification.retryable) return { status: "failed", attempts: attempt, reason: classification.reason, correlationId: input.correlationId, history, circuit } as const;
    if (attempt >= (input.maxAttempts ?? 3)) return { status: "dead-letter", attempts: attempt, reason: classification.reason, correlationId: input.correlationId, history, circuit } as const;
    return { status: "retry", attempts: attempt, reason: classification.reason, correlationId: input.correlationId, history, circuit } as const;
  }
}
