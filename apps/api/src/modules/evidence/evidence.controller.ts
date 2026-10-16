import { Controller, Get, Header, Param, Query } from "@nestjs/common";

import { EvidenceService, type EvidenceResponse } from "./evidence.service.js";

@Controller("teams")
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get(":teamId/evidence")
  @Header("Cache-Control", "no-store")
  get(@Param("teamId") teamId: string, @Query("asOf") asOf?: string, @Query("fixtureId") fixtureId?: string): Promise<EvidenceResponse> {
    return this.evidence.get(teamId, asOf, fixtureId?.trim() || undefined);
  }
}
