import { SETTLEMENT_PIPELINE_POLICY_HASH, type SettlementPipelineResult } from "@bet-stats/database";
import type { SettlementJobData } from "../queues/index.js";

interface SettlementService {
  process(input: Pick<SettlementJobData, "fixtureId" | "resultVersionId" | "forecastSnapshotId" | "policyVersion" | "correlationId">): Promise<SettlementPipelineResult>;
}

function requirePayload(value: SettlementJobData): void {
  const keys = ["fixtureId", "resultVersionId", "forecastSnapshotId", "policyVersion", "policyHash", "correlationId"] as const;
  for (const key of keys) if (typeof value?.[key] !== "string" || value[key].trim() === "" || value[key].length > 256) throw Object.assign(new Error("INVALID_SETTLEMENT_PAYLOAD"), { code: "INVALID_SETTLEMENT_PAYLOAD" });
}

export function createSettlementJobHandler(input: { service: SettlementService; beforeProcess?: () => void | Promise<void> }) {
  return async (payload: SettlementJobData): Promise<SettlementPipelineResult> => {
    requirePayload(payload);
    if (payload.policyHash !== SETTLEMENT_PIPELINE_POLICY_HASH) throw Object.assign(new Error("SETTLEMENT_POLICY_HASH_MISMATCH"), { code: "SETTLEMENT_POLICY_HASH_MISMATCH" });
    await input.beforeProcess?.();
    return input.service.process(payload);
  };
}
