import { Controller, Get, Header, Param, Query } from "@nestjs/common";

import { EvidenceService, type EvidenceProjection } from "./evidence.service.js";

@Controller("teams")
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get(":teamId/evidence")
  @Header("Cache-Control", "no-store")
  get(@Param("teamId") teamId: string, @Query("asOf") asOf?: string): Promise<EvidenceProjection> {
    return this.evidence.get(teamId, asOf);
  }
}
