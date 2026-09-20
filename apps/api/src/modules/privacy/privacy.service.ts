import { randomUUID } from "node:crypto";

import { BadRequestException, Injectable, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common";
import { readPrivacyRetentionConfig } from "@bet-stats/config";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { resolveRetentionPolicy, type RetentionPolicyResolution } from "@bet-stats/domain";
import { Redis } from "ioredis";

export type ConsentPolicy = Readonly<{ version: string; effectiveAt: string; durationDays: number }>;
export type RetentionSubjectInput = Readonly<{ subjectId: string; subjectKey: string }>;
export type RetentionCache = { invalidate(subjectId: string): Promise<void> };
export type PrivacySubjectProvider = { resolve(request: unknown): Promise<RetentionSubjectInput | null> };

const noApprovedSubjectProvider: PrivacySubjectProvider = { resolve: async () => null };
const noCache: RetentionCache = { invalidate: async () => undefined };

function coded(code: string, correlationId = randomUUID()): Error & { code: string; correlationId: string } {
  return Object.assign(new Error(code), { code, correlationId });
}

async function lockSubject(tx: PrismaClient, subjectId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; retentionBlockedAt: Date | null }>>`
    SELECT id, "retentionBlockedAt" FROM "RetentionSubject" WHERE id = ${subjectId} FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function grantRetentionConsent(
  database: PrismaClient,
  input: RetentionSubjectInput & { policy: ConsentPolicy; now?: Date },
) {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.policy.durationDays * 86_400_000);
  return database.$transaction(async (tx) => {
    await tx.retentionSubject.upsert({
      where: { id: input.subjectId },
      create: { id: input.subjectId, providerMode: "SIGNED", subjectKey: input.subjectKey, approvedAt: now },
      update: {},
    });
    const subject = await lockSubject(tx as PrismaClient, input.subjectId);
    if (!subject || subject.retentionBlockedAt) throw coded("RETENTION_DENIED");
    await tx.retentionConsent.updateMany({ where: { subjectId: input.subjectId, revokedAt: null }, data: { revokedAt: now } });
    const consent = await tx.retentionConsent.create({ data: {
      id: randomUUID(), subjectId: input.subjectId, policyVersion: input.policy.version,
      policyEffectiveAt: new Date(input.policy.effectiveAt), durationDays: input.policy.durationDays,
      grantedAt: now, expiresAt,
    } });
    return { status: "ON" as const, policyVersion: consent.policyVersion, effectiveAt: consent.policyEffectiveAt.toISOString(), expiresAt: consent.expiresAt.toISOString() };
  }, { isolationLevel: "Serializable" });
}

export async function retainViewedResult(
  database: PrismaClient,
  input: { subjectId: string; resourceType: string; resourceId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  return database.$transaction(async (tx) => {
    const subject = await lockSubject(tx as PrismaClient, input.subjectId);
    if (!subject || subject.retentionBlockedAt) throw coded("RETENTION_DENIED");
    const consent = await tx.retentionConsent.findFirst({
      where: { subjectId: input.subjectId, revokedAt: null, grantedAt: { lte: now }, expiresAt: { gt: now } },
      orderBy: { grantedAt: "desc" },
    });
    if (!consent) throw coded("RETENTION_DENIED");
    return tx.retainedViewHistory.create({ data: {
      id: randomUUID(), subjectId: input.subjectId, consentId: consent.id,
      resourceType: input.resourceType, resourceId: input.resourceId, viewedAt: now, expiresAt: consent.expiresAt,
    } });
  }, { isolationLevel: "Serializable" }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "RETENTION_DENIED") throw error;
    throw coded("RETENTION_DENIED");
  });
}

export async function withdrawRetentionConsent(
  database: PrismaClient,
  subjectId: string,
  cache: RetentionCache = noCache,
  now = new Date(),
) {
  const correlationId = randomUUID();
  try {
    return await database.$transaction(async (tx) => {
      const subject = await lockSubject(tx as PrismaClient, subjectId);
      if (!subject) throw coded("SUBJECT_NOT_FOUND", correlationId);
      await tx.retentionSubject.update({ where: { id: subjectId }, data: { retentionBlockedAt: subject.retentionBlockedAt ?? now } });
      await tx.retentionConsent.updateMany({ where: { subjectId, revokedAt: null }, data: { revokedAt: now } });
      await tx.retainedOddsHistory.deleteMany({ where: { subjectId } });
      await tx.retainedViewHistory.deleteMany({ where: { subjectId } });
      await cache.invalidate(subjectId);
      return { status: "OFF" as const, withdrawnAt: now.toISOString() };
    }, { isolationLevel: "Serializable" });
  } catch {
    throw coded("WITHDRAWAL_FAILED", correlationId);
  }
}

function policyFromEnvironment(): RetentionPolicyResolution {
  return resolveRetentionPolicy(readPrivacyRetentionConfig(process.env));
}

@Injectable()
export class PrivacyService implements OnModuleDestroy {
  private readonly database = process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null;
  private readonly redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
  private readonly cache: RetentionCache = this.redis ? { invalidate: async (subjectId) => { if (this.redis!.status === "wait") await this.redis!.connect(); await this.redis!.del(`privacy:history:${subjectId}`); } } : noCache;

  constructor(private readonly subjects: PrivacySubjectProvider = noApprovedSubjectProvider) {}

  policy() { return policyFromEnvironment(); }

  async status(request: unknown) {
    const policy = this.policy();
    if (!policy.available) return { status: "UNAVAILABLE" as const, reason: policy.reason, missing: policy.missing, categories: ["MANUAL_ODDS", "VIEWED_RESULT"] };
    const subject = await this.subjects.resolve(request);
    if (!subject || !this.database) return { status: "UNAVAILABLE" as const, reason: "SUBJECT_IDENTITY_UNAVAILABLE", policyVersion: policy.version, effectiveAt: policy.effectiveAt, categories: policy.coveredCategories };
    const active = await this.database.retentionConsent.findFirst({ where: { subjectId: subject.subjectId, revokedAt: null, expiresAt: { gt: new Date() }, subject: { retentionBlockedAt: null } }, orderBy: { grantedAt: "desc" } });
    return { status: active ? "ON" as const : "OFF" as const, policyVersion: policy.version, effectiveAt: policy.effectiveAt, categories: policy.coveredCategories };
  }

  async consent(request: unknown) {
    const policy = this.policy();
    if (!policy.available) throw new ServiceUnavailableException({ code: policy.reason });
    const subject = await this.subjects.resolve(request);
    if (!subject) throw new BadRequestException({ code: "SUBJECT_IDENTITY_UNAVAILABLE" });
    if (!this.database) throw new ServiceUnavailableException({ code: "DATABASE_UNAVAILABLE" });
    return grantRetentionConsent(this.database, { ...subject, policy });
  }

  async withdraw(request: unknown) {
    const subject = await this.subjects.resolve(request);
    if (!subject) throw new BadRequestException({ code: "SUBJECT_IDENTITY_UNAVAILABLE" });
    if (!this.database) throw new ServiceUnavailableException({ code: "DATABASE_UNAVAILABLE" });
    try { return await withdrawRetentionConsent(this.database, subject.subjectId, this.cache); }
    catch (error) { const failure = error as { correlationId?: string }; throw new ServiceUnavailableException({ code: "WITHDRAWAL_FAILED", correlationId: failure.correlationId }); }
  }

  async onModuleDestroy() { await Promise.all([this.database?.$disconnect(), this.redis?.quit()]); }
}
