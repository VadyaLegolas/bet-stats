import { Body, Controller, Get, Header, Param, Post, UseGuards } from "@nestjs/common";

import { EligibilityGuard } from "../eligibility/eligibility.guard.js";
import { OddsService, type ManualOddsSnapshotDto } from "./odds.service.js";

@Controller("fixtures/:fixtureId/odds")
@UseGuards(EligibilityGuard)
export class OddsController {
  constructor(private readonly odds: OddsService) {}

  @Post()
  @Header("Cache-Control", "private, no-store, max-age=0")
  submit(@Param("fixtureId") fixtureId: string, @Body() body: Record<string, unknown>): Promise<ManualOddsSnapshotDto> {
    return this.odds.submit({ ...body, fixtureId });
  }

  @Get(":oddsSnapshotId")
  @Header("Cache-Control", "private, no-store, max-age=0")
  get(@Param("oddsSnapshotId") oddsSnapshotId: string): Promise<ManualOddsSnapshotDto> { return this.odds.get(oddsSnapshotId); }
}
