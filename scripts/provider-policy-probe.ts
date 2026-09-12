import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ProbeScope { provider: string; competitionId: string; seasonId: string; endpoint: string }
export interface ProbeOptions { environment: string; optIn: boolean; credential: string; scope: ProbeScope; fetcher?: typeof fetch; now?: () => Date; persist?: boolean; outputPath?: string }

export async function runProviderPolicyProbe(options: ProbeOptions) {
  if (options.environment.toLowerCase() === "production") throw new Error("PROBE_REFUSES_PRODUCTION");
  if (!options.optIn) throw new Error("PROBE_OPT_IN_REQUIRED");
  if (!options.credential) throw new Error("PROBE_CREDENTIAL_REQUIRED");
  validateScope(options.scope);
  const now = options.now ?? (() => new Date());
  const request = { provider: options.scope.provider, competitionId: options.scope.competitionId, seasonId: options.scope.seasonId, endpoint: options.scope.endpoint };
  const requestFingerprint = `sha256:${createHash("sha256").update(JSON.stringify(request)).digest("hex")}`;
  const response = await (options.fetcher ?? fetch)(probeUrl(options.scope), { headers: credentialHeader(options.scope.provider, options.credential), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`PROBE_HTTP_${response.status}`);
  const payload: unknown = await response.json();
  const disagreements: string[] = [];
  const coverage = parseCoverage(payload, options.scope, disagreements);
  const limit = integerHeader(response.headers, ["x-ratelimit-requests-limit", "x-requests-limit"]);
  const remaining = integerHeader(response.headers, ["x-ratelimit-requests-remaining", "x-requests-available"]);
  const resetAt = instantHeader(response.headers, ["x-ratelimit-requests-reset", "x-requestcounter-reset"]);
  const artifact = {
    schemaVersion: 1, artifactId: requestFingerprint, environment: "non-production", capturedAt: now().toISOString(), provider: options.scope.provider, endpoint: options.scope.endpoint, requestFingerprint, scope: options.scope,
    quota: { limit, remaining, resetAt, status: limit === null && remaining === null && resetAt === null ? "unknown" : "known" }, coverage, disagreements,
    redaction: { credentialsPersisted: false, rawHeadersPersisted: false, rawPayloadPersisted: false }, approval: { status: "pending", approvedBy: null, approvedAt: null, policyVersion: null },
  } as const;
  if (options.persist !== false) {
    const path = options.outputPath ?? resolve("artifacts/provider-probes/phase-05-provider-policy.candidate.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "w" });
  }
  return artifact;
}

function validateScope(scope: ProbeScope) { for (const value of Object.values(scope)) if (!value || !/^[A-Za-z0-9._:-]+$/.test(value)) throw new Error("INVALID_PROBE_SCOPE"); }
function probeUrl(scope: ProbeScope): string { const query = new URLSearchParams({ competition: scope.competitionId, season: scope.seasonId, endpoint: scope.endpoint }); return scope.provider === "api-football" ? `https://v3.football.api-sports.io/leagues?${query}` : `https://api.football-data.org/v4/competitions/${encodeURIComponent(scope.competitionId)}?${query}`; }
function credentialHeader(provider: string, credential: string): HeadersInit { return provider === "api-football" ? { "x-apisports-key": credential } : { "X-Auth-Token": credential }; }
function integerHeader(headers: Headers, names: readonly string[]): number | null { for (const name of names) { const raw = headers.get(name); if (raw !== null && /^\d+$/.test(raw)) { const value = Number(raw); if (Number.isSafeInteger(value)) return value; } } return null; }
function instantHeader(headers: Headers, names: readonly string[]): string | null { for (const name of names) { const raw = headers.get(name); if (raw && Number.isFinite(Date.parse(raw))) return new Date(raw).toISOString(); } return null; }
function parseCoverage(payload: unknown, scope: ProbeScope, disagreements: string[]) { if (!payload || typeof payload !== "object" || Array.isArray(payload)) { disagreements.push("MALFORMED_COVERAGE"); return []; } const value = payload as Record<string, unknown>; if (value.competitionId !== scope.competitionId) disagreements.push("COMPETITION_MISMATCH"); if (value.seasonId !== scope.seasonId) disagreements.push("SEASON_MISMATCH"); if (value.endpoint !== scope.endpoint) disagreements.push("ENDPOINT_MISMATCH"); if (disagreements.length > 0 || typeof value.supported !== "boolean") return []; return [{ competitionId: scope.competitionId, seasonId: scope.seasonId, endpoint: scope.endpoint, supported: value.supported }]; }

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const scope = { provider: process.env.PROVIDER_CODE ?? "", competitionId: process.env.COMPETITION_ID ?? "", seasonId: process.env.SEASON_ID ?? "", endpoint: process.env.ENDPOINT_FAMILY ?? "" };
  await runProviderPolicyProbe({ environment: process.env.NODE_ENV ?? "development", optIn: process.argv.includes("--allow-live-probe"), credential: process.env.PROVIDER_CREDENTIAL ?? "", scope });
  process.stdout.write("Pending redacted provider-policy candidate written.\n");
}
