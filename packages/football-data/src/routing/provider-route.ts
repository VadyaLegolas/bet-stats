export const PROVIDER_ROUTE_MATRIX_VERSION = "provider-route-v1" as const;

export type RoutedEndpoint = "FIXTURES" | "RESULTS" | "STANDINGS";
export type RouteProvider = "football-data.org" | "api-football";

export interface ProviderRoute {
  readonly version: typeof PROVIDER_ROUTE_MATRIX_VERSION;
  readonly competition: string;
  readonly season: string;
  readonly endpoint: RoutedEndpoint;
  readonly candidates: readonly RouteProvider[];
  readonly soleSource: boolean;
}

const API_FOOTBALL_ONLY = new Set(["EL", "UEL", "UECL", "ECL"]);

export function createProviderRoute(input: { competition: string; season: string; endpoint: RoutedEndpoint }): ProviderRoute {
  if (!input.competition.trim() || !input.season.trim()) throw new Error("INVALID_PROVIDER_ROUTE_SCOPE");
  const soleSource = API_FOOTBALL_ONLY.has(input.competition.toUpperCase());
  return {
    version: PROVIDER_ROUTE_MATRIX_VERSION,
    competition: input.competition,
    season: input.season,
    endpoint: input.endpoint,
    candidates: soleSource ? ["api-football"] : ["football-data.org", "api-football"],
    soleSource,
  };
}

export function providerRouteJobId(route: ProviderRoute): string {
  return `${route.version}:${route.competition}:${route.season}:${route.endpoint}`;
}

export type ProviderFailureTrigger = "UPSTREAM_UNAVAILABLE" | "RATE_LIMITED" | "PRIMARY_DATA_ABSENT";

export function classifyProviderFailure(error: unknown): { eligible: true; trigger: ProviderFailureTrigger } | { eligible: false; reason: string } {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
  if (["UPSTREAM_5XX", "TIMEOUT", "NETWORK_ERROR", "TRANSPORT_FAILURE", "PROVIDER_UNAVAILABLE", "CIRCUIT_OPEN"].includes(code)) return { eligible: true, trigger: "UPSTREAM_UNAVAILABLE" };
  if (["RATE_LIMITED", "ALLOWANCE_EXHAUSTED"].includes(code)) return { eligible: true, trigger: "RATE_LIMITED" };
  if (code === "PRIMARY_DATA_ABSENT") return { eligible: true, trigger: "PRIMARY_DATA_ABSENT" };
  return { eligible: false, reason: code };
}

export function nextFallbackProvider(route: ProviderRoute, attempted: RouteProvider, error: unknown): RouteProvider | null {
  const failure = classifyProviderFailure(error);
  if (!failure.eligible) return null;
  const position = route.candidates.indexOf(attempted);
  return position >= 0 ? route.candidates[position + 1] ?? null : null;
}
