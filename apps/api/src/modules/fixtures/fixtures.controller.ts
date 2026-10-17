import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, Matches } from "class-validator";

import { OperatorGuard } from "../reconciliation/operator.guard.js";
import { FixturesSyncService, type SyncLeagueResult } from "./fixtures-sync.service.js";
import { ResultsSyncService, type ResultsLeagueResult } from "./results-sync.service.js";
import { FixturesService, type FixtureListProjection, type FixtureProjection, type SyncQuota } from "./fixtures.service.js";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

class SyncFixturesDto {
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(20) competitions?: string[];
  @IsOptional() @IsBoolean() force?: boolean;
  @IsOptional() @IsString() @Matches(DATE_ONLY, { message: "dateFrom must be a YYYY-MM-DD UTC date" }) dateFrom?: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY, { message: "dateTo must be a YYYY-MM-DD UTC date" }) dateTo?: string;
}

class ResultsSyncDto {
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(20) competitions?: string[];
  @IsOptional() @IsBoolean() force?: boolean;
  @IsOptional() @IsString() @Matches(DATE_ONLY, { message: "dateFrom must be a YYYY-MM-DD UTC date" }) dateFrom?: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY, { message: "dateTo must be a YYYY-MM-DD UTC date" }) dateTo?: string;
}

@Controller("fixtures")
export class FixturesController {
  constructor(private readonly fixtures: FixturesService) {}

  /** Must be declared before `:fixtureId` so "leagues" is not swallowed by the param route. */
  @Get("leagues")
  leagues(): Promise<{ items: readonly string[] }> {
    return this.fixtures.leagues();
  }

  /** Must also be declared before `:fixtureId` — same param-swallowing concern as "leagues". */
  @Get("quota")
  quota(): Promise<SyncQuota> {
    return this.fixtures.syncQuota();
  }

  @Get()
  list(@Query("from") from?: string, @Query("to") to?: string, @Query("competition") competition?: string): Promise<{ items: readonly FixtureListProjection[]; range: { from: string; to: string } }> {
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
  constructor(private readonly syncService: FixturesSyncService, private readonly resultsSyncService: ResultsSyncService) {}

  @Post("sync")
  sync(@Body() body: SyncFixturesDto): Promise<{ results: readonly SyncLeagueResult[] }> {
    return this.syncService.sync({
      ...(body?.competitions?.length ? { competitions: body.competitions } : {}),
      force: body?.force === true,
      ...(body?.dateFrom ? { dateFrom: body.dateFrom } : {}),
      ...(body?.dateTo ? { dateTo: body.dateTo } : {}),
    });
  }

  @Post("results-sync")
  resultsSync(@Body() body: ResultsSyncDto): Promise<{ results: readonly ResultsLeagueResult[] }> {
    return this.resultsSyncService.sync({
      ...(body?.competitions?.length ? { competitions: body.competitions } : {}),
      force: body?.force === true,
      ...(body?.dateFrom ? { dateFrom: body.dateFrom } : {}),
      ...(body?.dateTo ? { dateTo: body.dateTo } : {}),
    });
  }
}
