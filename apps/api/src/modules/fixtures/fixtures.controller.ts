import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString } from "class-validator";

import { OperatorGuard } from "../reconciliation/operator.guard.js";
import { FixturesSyncService, type SyncLeagueResult } from "./fixtures-sync.service.js";
import { FixturesService, type FixtureProjection } from "./fixtures.service.js";

class SyncFixturesDto {
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(20) competitions?: string[];
  @IsOptional() @IsBoolean() force?: boolean;
}

@Controller("fixtures")
export class FixturesController {
  constructor(private readonly fixtures: FixturesService) {}

  /** Must be declared before `:fixtureId` so "leagues" is not swallowed by the param route. */
  @Get("leagues")
  leagues(): Promise<{ items: readonly string[] }> {
    return this.fixtures.leagues();
  }

  @Get()
  list(@Query("from") from?: string, @Query("to") to?: string, @Query("competition") competition?: string): Promise<{ items: readonly FixtureProjection[]; range: { from: string; to: string } }> {
    return this.fixtures.list({ ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }), ...(competition === undefined ? {} : { competition }) });
  }

  @Get(":fixtureId")
  detail(@Param("fixtureId") fixtureId: string): Promise<FixtureProjection> {
    return this.fixtures.detail(fixtureId);
  }
}

/** Fail-closed manual ingestion trigger (OperatorGuard answers 404 without the credential). */
@UseGuards(OperatorGuard)
@Controller("internal/fixtures")
export class FixturesInternalController {
  constructor(private readonly syncService: FixturesSyncService) {}

  @Post("sync")
  sync(@Body() body: SyncFixturesDto): Promise<{ results: readonly SyncLeagueResult[] }> {
    return this.syncService.sync({ ...(body?.competitions?.length ? { competitions: body.competitions } : {}), force: body?.force === true });
  }
}
