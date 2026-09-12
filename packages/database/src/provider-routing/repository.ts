import { assertRouteReceipt, routeReceiptContentHash, type ProviderRouteReceiptContent } from "@bet-stats/domain";

import type { PrismaClient } from "../client.js";

export interface AppendRouteInput extends ProviderRouteReceiptContent { id: string; contentHash: string }

export function createProviderRoutingRepository(options: { database: PrismaClient }) {
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
          capabilitySnapshot: input.capabilitySnapshot, budgetSnapshot: input.budgetSnapshot, circuitSnapshot: input.circuitSnapshot,
          correlationId: input.correlationId,
        },
        include: { attempts: true },
      });
    },
    readRoute(id: string) {
      return options.database.providerRouteReceipt.findUnique({ where: { id }, include: { attempts: { orderBy: { createdAt: "asc" } } } });
    },
  };
}
