import { z } from "zod";

export {
  DEFAULT_FRESHNESS_THRESHOLDS_MS,
  FreshnessConfigValidationError,
  readFreshnessThresholds,
} from "./freshness.js";
export type { FreshnessDataType, FreshnessThresholds } from "./freshness.js";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATA_PROVIDER_MODE: z.enum(["live", "deterministic"]).default("deterministic"),
  DATABASE_URL: z.string().startsWith("postgresql://").optional(),
  REDIS_URL: z.string().startsWith("redis://").optional(),
  FOOTBALL_DATA_API_TOKEN: z.string().min(1).optional(),
  API_FOOTBALL_API_KEY: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== "production") return;

  if (value.DATA_PROVIDER_MODE !== "live") {
    context.addIssue({ code: "custom", path: ["DATA_PROVIDER_MODE"], message: "must be live in production" });
  }
  for (const key of ["DATABASE_URL", "REDIS_URL", "FOOTBALL_DATA_API_TOKEN", "API_FOOTBALL_API_KEY"] as const) {
    if (!value[key]) {
      context.addIssue({ code: "custom", path: [key], message: "is required in production" });
    }
  }
});

export type ServerConfig = z.infer<typeof environmentSchema>;

export class ConfigValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid server configuration: ${issues.join("; ")}`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

export function readServerConfig(input: Record<string, string | undefined>): ServerConfig {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`);
    throw new ConfigValidationError(issues);
  }
  return result.data;
}

const sensitiveKey = /(?:token|password|secret|api.?key|authorization|database.?url)/i;

export function redactSecrets(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactSecrets(entryValue, entryKey)]));
  }
  return value;
}

export type DependencyReadiness = {
  ready: boolean;
  dependencies: {
    postgres: "ready" | "unavailable";
    redis: "ready" | "unavailable";
  };
};

export function dependencyReadiness(state: { postgres: boolean; redis: boolean }): DependencyReadiness {
  return {
    ready: state.postgres && state.redis,
    dependencies: {
      postgres: state.postgres ? "ready" : "unavailable",
      redis: state.redis ? "ready" : "unavailable",
    },
  };
}

export type PrivacyRetentionConfig = {
  subjectProviderMode?: "signed" | undefined;
  durationDays?: number | undefined;
  version?: string | undefined;
  effectiveAt?: string | undefined;
};

/**
 * Reads only explicit policy inputs. Invalid or absent inputs remain absent so
 * callers deterministically fail closed instead of guessing legal policy.
 */
export function readPrivacyRetentionConfig(input: Record<string, string | undefined>): PrivacyRetentionConfig {
  const duration = input.PRIVACY_RETENTION_DURATION_DAYS;
  const parsedDuration = duration === undefined ? undefined : Number(duration);
  const version = input.PRIVACY_RETENTION_POLICY_VERSION?.trim();
  const effectiveAt = input.PRIVACY_RETENTION_EFFECTIVE_AT?.trim();

  return {
    subjectProviderMode: input.PRIVACY_SUBJECT_PROVIDER_MODE === "signed" ? "signed" : undefined,
    durationDays: Number.isSafeInteger(parsedDuration) && (parsedDuration ?? 0) > 0 ? parsedDuration : undefined,
    version: version ? version : undefined,
    effectiveAt: effectiveAt ? effectiveAt : undefined,
  };
}
