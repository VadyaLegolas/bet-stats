import { assertRouteReceipt, routeReceiptContentHash, type ProviderRouteReceiptContent } from "@bet-stats/domain";

import type { PrismaClient } from "../client.js";
import type { Prisma } from "../generated/prisma/client.js";

export interface AppendRouteInput extends ProviderRouteReceiptContent { id: string; contentHash: string }

export interface ProviderAdmissionInput {
  route: AppendRouteInput;
  attempt: { id: string; attemptKey: string };
  provider: string;
  lane: "critical" | "standard" | "optional";
  configuredAllowance: number;
  criticalHeadroom: number;
  requestDate: Date;
  throttle: { windowStart: Date; windowEnd: Date; limit: number };
}

export interface QuotaObservationInput {
  id: string;
  routeAttemptId: string;
  provider: string;
  endpointFamily: string;
  observedLimit: number | null;
  observedRemaining: number | null;
  resetAt: Date | null;
  observedAt: Date;
}

export interface CapabilityApprovalInput {
  provider: string;
  leagueId: string;
  seasonId: string;
  endpoint: string;
  supported: boolean;
  verifiedAt: Date;
  expiresAt: Date | null;
}

export interface AppendAttemptInput {
  id: string;
  routeReceiptId: string;
  attemptKey: string;
  provider: string | null;
  state: "DENIED" | "ADMITTED" | "FAILED" | "SUCCEEDED" | "NO_FALLBACK";
  reason: string | null;
  observationId: string | null;
  admitted: boolean;
}

export function createProviderRoutingRepository(options: { database: PrismaClient; now?: () => Date }) {
  const now = options.now ?? (() => new Date());
  return {
    async appendRoute(input: AppendRouteInput) {
      assertRouteReceipt(input);
      const { id, contentHash, ...content } = input;
      if (routeReceiptContentHash(content) !== contentHash) throw new Error("ROUTE_CONTENT_HASH_MISMATCH");
      const existing = await options.database.providerRouteReceipt.findUnique({ where: { id: input.id }, include: { attempts: true } });
      if (existing) {
        if (existing.contentHash !== input.contentHash) throw new Error("ROUTE_IDENTITY_COLLISION");
        return existing;
      }
      return options.database.providerRouteReceipt.create({
        data: {
          id: input.id, contentHash: input.contentHash, policyVersion: input.policyVersion, policyHash: input.policyHash,
          competitionId: input.competitionId, seasonId: input.seasonId, endpointFamily: input.endpointFamily,
          candidates: [...input.candidates], selectedProvider: input.selectedProvider, trigger: input.trigger, outcome: input.outcome,
          capabilitySnapshot: jsonInput(input.capabilitySnapshot), budgetSnapshot: jsonInput(input.budgetSnapshot), circuitSnapshot: jsonInput(input.circuitSnapshot),
          correlationId: input.correlationId,
        },
        include: { attempts: true },
      });
    },
    readRoute(id: string) {
      return options.database.providerRouteReceipt.findUnique({ where: { id }, include: { attempts: { orderBy: { createdAt: "asc" } } } });
    },
    async appendAttempt(input: AppendAttemptInput) {
      validateAttempt(input);
      const existing = await options.database.providerRouteAttempt.findUnique({ where: { attemptKey: input.attemptKey } });
      if (existing) {
        if (!sameAttempt(existing, input)) throw new Error("ATTEMPT_IDENTITY_COLLISION");
        return existing;
      }
      if (input.observationId) {
        const observation = await options.database.sourceObservation.findUnique({ where: { id: input.observationId }, select: { provider: true } });
        if (!observation || observation.provider !== input.provider) throw new Error("ATTEMPT_OBSERVATION_MISMATCH");
      }
      return options.database.providerRouteAttempt.create({ data: input });
    },
    async admitAttempt(input: ProviderAdmissionInput) {
      validateAdmission(input);
      return retrySerializable(() => options.database.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${admissionLockKey(input)}, 0))`;
        const existing = await transaction.providerRouteAttempt.findUnique({ where: { attemptKey: input.attempt.attemptKey } });
        if (existing) return { admitted: existing.admitted, reused: true, reason: existing.reason };

        const capability = await transaction.providerCapability.findUnique({
          where: { provider_leagueId_seasonId_endpoint: { provider: input.provider, leagueId: input.route.competitionId, seasonId: input.route.seasonId, endpoint: input.route.endpointFamily } },
        });
        let reason: string | null = null;
        if (!capability) reason = "UNKNOWN_CAPABILITY";
        else if (!capability.supported) reason = "UNSUPPORTED_CAPABILITY";
        else if (capability.expiresAt && capability.expiresAt <= now()) reason = "EXPIRED_CAPABILITY";

        const circuit = reason ? null : await transaction.providerCircuitState.findUnique({ where: { provider_endpointFamily: { provider: input.provider, endpointFamily: input.route.endpointFamily } } });
        if (!reason && (!circuit || circuit.state !== "CLOSED")) reason = "CIRCUIT_OPEN";

        let reservationId: string | null = null;
        if (!reason) {
          const [reserved, throttleReserved, quota] = await Promise.all([
            transaction.providerThrottleReservation.count({ where: { provider: input.provider, endpointFamily: input.route.endpointFamily, routeAttempt: { createdAt: { gte: startOfUtcDay(input.requestDate), lt: endOfUtcDay(input.requestDate) } } } }),
            transaction.providerThrottleReservation.count({ where: { provider: input.provider, endpointFamily: input.route.endpointFamily, windowStart: input.throttle.windowStart, windowEnd: input.throttle.windowEnd } }),
            transaction.providerQuotaObservation.aggregate({ where: { provider: input.provider, endpointFamily: input.route.endpointFamily }, _min: { observedLimit: true, observedRemaining: true } }),
          ]);
          const observedLimit = quota._min.observedLimit ?? input.configuredAllowance;
          const remainingCeiling = quota._min.observedRemaining === null ? input.configuredAllowance : reserved + quota._min.observedRemaining;
          const allowance = Math.min(input.configuredAllowance, observedLimit, remainingCeiling);
          const laneAllowance = input.lane === "critical" ? allowance : Math.max(0, allowance - input.criticalHeadroom);
          if (reserved >= laneAllowance) reason = input.lane === "critical" ? "ALLOWANCE_EXHAUSTED" : "CRITICAL_HEADROOM";
          else if (throttleReserved >= input.throttle.limit) reason = "THROTTLE_EXHAUSTED";
          else reservationId = `${input.attempt.id}:throttle`;
        }

        await createRoute(transaction, input.route);
        const attempt = await transaction.providerRouteAttempt.create({ data: { id: input.attempt.id, routeReceiptId: input.route.id, attemptKey: input.attempt.attemptKey, provider: input.provider, state: reason ? "DENIED" : "ADMITTED", reason, observationId: null, admitted: reason === null } });
        if (reservationId) await transaction.providerThrottleReservation.create({ data: { id: reservationId, routeAttemptId: attempt.id, provider: input.provider, endpointFamily: input.route.endpointFamily, reservationKey: input.attempt.attemptKey, windowStart: input.throttle.windowStart, windowEnd: input.throttle.windowEnd } });
        return { admitted: reason === null, reused: false, reason };
      }, { isolationLevel: "Serializable", timeout: 15_000 }), 4);
    },
    appendQuotaObservation(input: QuotaObservationInput) {
      validateQuotaObservation(input);
      return options.database.providerQuotaObservation.create({ data: input });
    },
    approveCapability(input: CapabilityApprovalInput) {
      return options.database.$transaction((transaction) => transaction.providerCapability.upsert({
        where: { provider_leagueId_seasonId_endpoint: { provider: input.provider, leagueId: input.leagueId, seasonId: input.seasonId, endpoint: input.endpoint } },
        create: input,
        update: { supported: input.supported, verifiedAt: input.verifiedAt, expiresAt: input.expiresAt },
      }));
    },
  };
}

async function createRoute(database: Prisma.TransactionClient, input: AppendRouteInput) {
  assertRouteReceipt(input);
  const { id, contentHash, ...content } = input;
  if (routeReceiptContentHash(content) !== contentHash) throw new Error("ROUTE_CONTENT_HASH_MISMATCH");
  const existing = await database.providerRouteReceipt.findUnique({ where: { id } });
  if (existing) {
    if (existing.contentHash !== contentHash) throw new Error("ROUTE_IDENTITY_COLLISION");
    return existing;
  }
  return database.providerRouteReceipt.create({ data: { id, contentHash, policyVersion: content.policyVersion, policyHash: content.policyHash, competitionId: content.competitionId, seasonId: content.seasonId, endpointFamily: content.endpointFamily, candidates: [...content.candidates], selectedProvider: content.selectedProvider, trigger: content.trigger, outcome: content.outcome, capabilitySnapshot: jsonInput(content.capabilitySnapshot), budgetSnapshot: jsonInput(content.budgetSnapshot), circuitSnapshot: jsonInput(content.circuitSnapshot), correlationId: content.correlationId } });
}

function validateAdmission(input: ProviderAdmissionInput): void {
  if (!Number.isSafeInteger(input.configuredAllowance) || input.configuredAllowance < 0 || !Number.isSafeInteger(input.criticalHeadroom) || input.criticalHeadroom < 0 || input.criticalHeadroom > input.configuredAllowance) throw new Error("INVALID_ADMISSION_POLICY");
  if (!Number.isSafeInteger(input.throttle.limit) || input.throttle.limit <= 0 || input.throttle.windowEnd <= input.throttle.windowStart) throw new Error("INVALID_THROTTLE_POLICY");
  if (input.provider.length === 0 || input.attempt.id.length === 0 || input.attempt.attemptKey.length === 0) throw new Error("INVALID_ADMISSION_IDENTITY");
}

function validateQuotaObservation(input: QuotaObservationInput): void {
  for (const value of [input.observedLimit, input.observedRemaining]) if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error("INVALID_QUOTA_OBSERVATION");
  if (input.observedLimit !== null && input.observedRemaining !== null && input.observedRemaining > input.observedLimit) throw new Error("INVALID_QUOTA_OBSERVATION");
}

function validateAttempt(input: AppendAttemptInput): void {
  if (input.state === "SUCCEEDED" && (!input.admitted || !input.provider || !input.observationId)) throw new Error("SUCCESS_ATTEMPT_REQUIRES_OBSERVATION");
  if (input.state !== "SUCCEEDED" && input.observationId !== null) throw new Error("NON_SUCCESS_ATTEMPT_HAS_OBSERVATION");
  if (!input.admitted && input.state === "SUCCEEDED") throw new Error("DENIED_ATTEMPT_CANNOT_SUCCEED");
}

function sameAttempt(existing: { id: string; routeReceiptId: string; attemptKey: string; provider: string | null; state: string; reason: string | null; observationId: string | null; admitted: boolean }, input: AppendAttemptInput): boolean {
  return existing.id === input.id && existing.routeReceiptId === input.routeReceiptId && existing.attemptKey === input.attemptKey && existing.provider === input.provider && existing.state === input.state && existing.reason === input.reason && existing.observationId === input.observationId && existing.admitted === input.admitted;
}

function admissionLockKey(input: ProviderAdmissionInput): string { return `${input.provider}:${input.route.endpointFamily}:${input.requestDate.toISOString().slice(0, 10)}`; }
function startOfUtcDay(value: Date): Date { return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`); }
function endOfUtcDay(value: Date): Date { return new Date(startOfUtcDay(value).getTime() + 86_400_000); }

async function retrySerializable<T>(operation: () => Promise<T>, attempts: number): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= attempts || !isRetryableTransactionError(error)) throw error;
    }
  }
}

function isRetryableTransactionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2034";
}

function jsonInput(value: Readonly<Record<string, unknown>>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}
