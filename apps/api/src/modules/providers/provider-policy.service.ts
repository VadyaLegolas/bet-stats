import { BadRequestException, Injectable, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, createProviderRoutingRepository, type PrismaClient } from "@bet-stats/database";
import { PROVIDER_ROUTE_POLICY_VERSION, routeReceiptContentHash } from "@bet-stats/domain";

export interface ProviderPolicyScope { provider: string; competitionId: string; seasonId: string; endpoint: string }
export interface ProviderPolicyArtifact { schemaVersion: number; artifactId: string; environment: string; capturedAt: string; provider: string; endpoint: string; requestFingerprint: string; scope: ProviderPolicyScope; quota: { limit: number | null; remaining: number | null; resetAt: string | null; status: string }; coverage: readonly { competitionId: string; seasonId: string; endpoint: string; supported: boolean }[]; disagreements: readonly unknown[]; redaction: { credentialsPersisted: boolean; rawHeadersPersisted: boolean; rawPayloadPersisted: boolean }; approval: { status: string; approvedBy: null; approvedAt: null; policyVersion: null } }
export interface ProviderPolicyApprovalCommand { idempotencyKey: string; expectedPolicyVersion: string; scope: ProviderPolicyScope; artifact: ProviderPolicyArtifact }

@Injectable()
export class ProviderPolicyService implements OnModuleDestroy {
  private readonly database: PrismaClient | null;
  constructor() { this.database = process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null; }

  async approve(raw: unknown, actor: string) {
    if (!this.database) throw new ServiceUnavailableException({ code: "DATABASE_UNAVAILABLE" });
    const command = parseCommand(raw);
    const repository = createProviderRoutingRepository({ database: this.database });
    const receiptContent = { policyVersion: command.expectedPolicyVersion, policyHash: command.artifact.requestFingerprint, competitionId: command.scope.competitionId, seasonId: command.scope.seasonId, endpointFamily: command.scope.endpoint, candidates: [command.scope.provider], selectedProvider: command.scope.provider, trigger: "PRIMARY" as const, outcome: "ADMITTED" as const, capabilitySnapshot: { artifactId: command.artifact.artifactId, supported: true }, budgetSnapshot: command.artifact.quota, circuitSnapshot: { state: "POLICY_APPROVAL" }, correlationId: command.idempotencyKey };
    const routeId = `provider-policy:${command.idempotencyKey}`;
    await repository.appendRoute({ id: routeId, contentHash: routeReceiptContentHash(receiptContent), ...receiptContent });
    await repository.approveCapability({ provider: command.scope.provider, leagueId: command.scope.competitionId, seasonId: command.scope.seasonId, endpoint: command.scope.endpoint, supported: true, verifiedAt: new Date(command.artifact.capturedAt), expiresAt: command.artifact.quota.resetAt ? new Date(command.artifact.quota.resetAt) : null });
    await repository.appendAttempt({ id: `${routeId}:decision`, routeReceiptId: routeId, attemptKey: command.idempotencyKey, provider: command.scope.provider, state: "ADMITTED", reason: null, observationId: null, admitted: true });
    return { decisionId: command.idempotencyKey, status: "approved" as const, actor, scope: command.scope, policyVersion: command.expectedPolicyVersion, artifactId: command.artifact.artifactId };
  }

  async onModuleDestroy() { await this.database?.$disconnect(); }
}

function parseCommand(raw: unknown): ProviderPolicyApprovalCommand {
  const command = object(raw, "INVALID_PROVIDER_POLICY_COMMAND");
  exact(command, ["idempotencyKey", "expectedPolicyVersion", "scope", "artifact"], "UNKNOWN_PROVIDER_POLICY_COMMAND_KEY");
  string(command.idempotencyKey, "INVALID_IDEMPOTENCY_KEY");
  if (command.expectedPolicyVersion !== PROVIDER_ROUTE_POLICY_VERSION) fail("POLICY_VERSION_CONFLICT");
  const scope = parseScope(command.scope);
  const artifact = parseArtifact(command.artifact);
  if (JSON.stringify(scope) !== JSON.stringify(artifact.scope) || artifact.provider !== scope.provider || artifact.endpoint !== scope.endpoint) fail("ARTIFACT_SCOPE_MISMATCH");
  if (artifact.environment !== "non-production" || artifact.approval.status !== "pending") fail("ARTIFACT_NOT_PENDING");
  if (Date.now() - Date.parse(artifact.capturedAt) > 86_400_000 || Date.parse(artifact.capturedAt) > Date.now() + 60_000) fail("ARTIFACT_STALE");
  if (artifact.disagreements.length > 0) fail("ARTIFACT_DISAGREEMENT");
  if (artifact.quota.status !== "known" || artifact.quota.limit === null || artifact.quota.remaining === null || artifact.quota.resetAt === null) fail("UNKNOWN_QUOTA_POLICY");
  const coverage = artifact.coverage.find((entry) => entry.competitionId === scope.competitionId && entry.seasonId === scope.seasonId && entry.endpoint === scope.endpoint);
  if (!coverage?.supported) fail("CAPABILITY_NOT_APPROVED");
  return { idempotencyKey: command.idempotencyKey as string, expectedPolicyVersion: command.expectedPolicyVersion as string, scope, artifact };
}

function parseScope(raw: unknown): ProviderPolicyScope { const value = object(raw, "INVALID_PROVIDER_POLICY_SCOPE"); exact(value, ["provider", "competitionId", "seasonId", "endpoint"], "UNKNOWN_PROVIDER_POLICY_SCOPE_KEY"); for (const key of ["provider", "competitionId", "seasonId", "endpoint"] as const) string(value[key], "INVALID_PROVIDER_POLICY_SCOPE"); return value as unknown as ProviderPolicyScope; }
function parseArtifact(raw: unknown): ProviderPolicyArtifact { const value = object(raw, "INVALID_PROVIDER_POLICY_ARTIFACT"); exact(value, ["schemaVersion", "artifactId", "environment", "capturedAt", "provider", "endpoint", "requestFingerprint", "scope", "quota", "coverage", "disagreements", "redaction", "approval"], "UNKNOWN_PROVIDER_POLICY_ARTIFACT_KEY"); if (value.schemaVersion !== 1) fail("ARTIFACT_SCHEMA_MISMATCH"); for (const key of ["artifactId", "environment", "capturedAt", "provider", "endpoint", "requestFingerprint"] as const) string(value[key], "INVALID_PROVIDER_POLICY_ARTIFACT"); if (!Array.isArray(value.coverage) || !Array.isArray(value.disagreements)) fail("INVALID_PROVIDER_POLICY_ARTIFACT"); const redaction = object(value.redaction, "INVALID_REDACTION_PROOF"); if (redaction.credentialsPersisted !== false || redaction.rawHeadersPersisted !== false || redaction.rawPayloadPersisted !== false) fail("INVALID_REDACTION_PROOF"); return value as unknown as ProviderPolicyArtifact; }
function object(value: unknown, code: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail(code); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: readonly string[], code: string) { const allowed = new Set(keys); if (Object.keys(value).some((key) => !allowed.has(key)) || keys.some((key) => !(key in value))) fail(code); }
function string(value: unknown, code: string): asserts value is string { if (typeof value !== "string" || value.trim() === "") fail(code); }
function fail(code: string): never { throw new BadRequestException({ code }); }
