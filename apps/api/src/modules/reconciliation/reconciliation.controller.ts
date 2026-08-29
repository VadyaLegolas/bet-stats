import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "./operator.guard.js";
import { ReconciliationService } from "./reconciliation.service.js";

@Controller("internal/reconciliation")
@UseGuards(OperatorGuard)
export class ReconciliationController {
  constructor(private readonly reviews: ReconciliationService) {}
  @Get() list(@Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.reviews.listOpen({ ...(cursor ? { cursor } : {}), ...(limit ? { limit: Number(limit) } : {}) }); }
  @Get(":caseId") get(@Param("caseId") caseId: string) { return this.reviews.get(caseId); }
  @Post(":caseId/:kind") decide(@Param("caseId") caseId: string, @Param("kind") kind: "approve" | "manual-link" | "reject-create" | "correction", @Body() body: Record<string, unknown>, @Req() request: { operator?: { actor: string } }) { return this.reviews.decide(kind, { ...body, caseId } as never, request.operator?.actor ?? "operator"); }
}
