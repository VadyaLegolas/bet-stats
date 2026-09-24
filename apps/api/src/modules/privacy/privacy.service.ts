import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common";
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
  input: { subjectId: string; resourceType: string; resourceId: string; policy: ConsentPolicy; now?: Date },
) {
  const now = input.now ?? new Date();
  return database.$transaction(async (tx) => {
    const subject = await lockSubject(tx as PrismaClient, input.subjectId);
    if (!subject || subject.retentionBlockedAt) throw coded("RETENTION_DENIED");
    const consent = await tx.retentionConsent.findFirst({
      where: {
        subjectId: input.subjectId,
        revokedAt: null,
        grantedAt: { lte: now },
        expiresAt: { gt: now },
        policyVersion: input.policy.version,
        policyEffectiveAt: new Date(input.policy.effectiveAt),
        durationDays: input.policy.durationDays,
      },
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
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
    } catch (error) {
      const retryable = error && typeof error === "object" && ("code" in error && error.code === "P2034" || "message" in error && /serializ|deadlock/i.test(String(error.message)));
      if (!retryable || attempt === 2) throw coded("WITHDRAWAL_FAILED", correlationId);
    }
  }
  throw coded("WITHDRAWAL_FAILED", correlationId);
}

function policyFromEnvironment(): RetentionPolicyResolution {
  return resolveRetentionPolicy(readPrivacyRetentionConfig(process.env));
}

function signedEnvironmentSubjectProvider(): PrivacySubjectProvider {
  return { resolve: async (request) => {
    const secret = process.env.PRIVACY_SUBJECT_SIGNING_SECRET;
    if (!secret || secret.length < 32 || !request || typeof request !== "object" || !("headers" in request)) return null;
    const headers = (request as { headers?: Record<string, unknown> }).headers ?? {};
    const subjectId = headers["x-privacy-subject"];
    const timestamp = headers["x-privacy-timestamp"];
    const signature = headers["x-privacy-signature"];
    if (typeof subjectId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(subjectId) || typeof timestamp !== "string" || typeof signature !== "string") return null;
    const instant = Date.parse(timestamp);
    if (!Number.isFinite(instant) || Math.abs(Date.now() - instant) > 5 * 60_000) return null;
    const expected = Buffer.from(createHmac("sha256", secret).update(`${subjectId}\n${timestamp}`).digest("base64url"));
    const presented = Buffer.from(signature);
    if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return null;
    return { subjectId, subjectKey: createHmac("sha256", secret).update(`subject-key\n${subjectId}`).digest("base64url") };
  } };
}

@Injectable()
export class PrivacyService implements OnModuleDestroy {
  private readonly database = process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null;
  private readonly redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
  private readonly cache: RetentionCache = this.redis ? { invalidate: async (subjectId) => { if (this.redis!.status === "wait") await this.redis!.connect(); await this.redis!.del(`privacy:history:${subjectId}`); } } : noCache;
  private readonly subjects: PrivacySubjectProvider = process.env.PRIVACY_SUBJECT_SIGNING_SECRET ? signedEnvironmentSubjectProvider() : noApprovedSubjectProvider;

  policy() { return policyFromEnvironment(); }

  async status(request: unknown) {
    const policy = this.policy();
    if (!policy.available) return { status: "UNAVAILABLE" as const, reason: policy.reason, missing: policy.missing, categories: ["MANUAL_ODDS", "VIEWED_RESULT"] };
    const subject = await this.subjects.resolve(request);
    if (!subject || !this.database) return { status: "UNAVAILABLE" as const, reason: "SUBJECT_IDENTITY_UNAVAILABLE", policyVersion: policy.version, effectiveAt: policy.effectiveAt, categories: policy.coveredCategories };
    const active = await this.database.retentionConsent.findFirst({ where: {
      subjectId: subject.subjectId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      policyVersion: policy.version,
      policyEffectiveAt: new Date(policy.effectiveAt),
      durationDays: policy.durationDays,
      subject: { retentionBlockedAt: null },
    }, orderBy: { grantedAt: "desc" } });
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

  async retainView(request: unknown, input: unknown) {
    const policy = this.policy();
    if (!policy.available) throw new ServiceUnavailableException({ code: policy.reason });
    const subject = await this.subjects.resolve(request);
    if (!subject) throw new BadRequestException({ code: "SUBJECT_IDENTITY_UNAVAILABLE" });
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException({ code: "INVALID_RETAINED_VIEW" });
    const candidate = input as Record<string, unknown>;
    if (Object.keys(candidate).sort().join(",") !== "resourceId,resourceType" || typeof candidate.resourceType !== "string" || typeof candidate.resourceId !== "string" || !candidate.resourceType || !candidate.resourceId) throw new BadRequestException({ code: "INVALID_RETAINED_VIEW" });
    if (!this.database) throw new ServiceUnavailableException({ code: "DATABASE_UNAVAILABLE" });
    try { await retainViewedResult(this.database, { subjectId: subject.subjectId, resourceType: candidate.resourceType, resourceId: candidate.resourceId, policy }); return { retained: true }; }
    catch { throw new ConflictException({ code: "RETENTION_DENIED" }); }
  }

  async onModuleDestroy() { await Promise.all([this.database?.$disconnect(), this.redis?.quit()]); }
}
