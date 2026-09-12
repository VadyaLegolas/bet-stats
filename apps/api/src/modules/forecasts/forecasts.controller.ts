import { BadRequestException, Body, Controller, Get, Header, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { ForecastRequestDto, ForecastResponseDto } from "@bet-stats/domain";

import { EligibilityGuard } from "../eligibility/eligibility.guard.js";
import { ForecastsService } from "./forecasts.service.js";
import { ForecastComparisonService } from "./forecast-comparison.service.js";

@Controller("fixtures/:fixtureId/forecasts")
@UseGuards(EligibilityGuard)
export class ForecastsController {
  constructor(private readonly forecasts: ForecastsService, private readonly comparisonService?: ForecastComparisonService) {}

  @Get("compare")
  @Header("Cache-Control", "private, no-store, max-age=0")
  compare(@Param("fixtureId") fixtureId: string, @Query() query: Record<string, string | undefined>) {
    if (Object.keys(query).length !== 2 || !query.leftId || !query.rightId) throw new BadRequestException({ code: "INVALID_FORECAST_COMPARISON_QUERY" });
    return this.comparisonService!.compare(fixtureId, query);
  }

  @Get("availability")
  @Header("Cache-Control", "private, no-store, max-age=0")
  availability(@Param("fixtureId") fixtureId: string) { return this.comparisonService!.availability(fixtureId); }

  @Post()
  @Header("Cache-Control", "private, no-store, max-age=0")
  generate(@Param("fixtureId") fixtureId: string, @Body() body: Omit<ForecastRequestDto, "fixtureId">): Promise<ForecastResponseDto> {
    return this.forecasts.generate({ ...body, fixtureId });
  }

  @Get()
  @Header("Cache-Control", "private, no-store, max-age=0")
  get(@Param("fixtureId") fixtureId: string, @Query() query: Record<string, string | undefined>): Promise<ForecastResponseDto | readonly ForecastResponseDto[]> {
    const keys = Object.keys(query);
    if (keys.length === 0) return this.forecasts.list(fixtureId);
    if (keys.length !== 2 || !keys.includes("kind") || !keys.includes("cutoff")) {
      throw new BadRequestException({ code: "INVALID_FORECAST_QUERY" });
    }
    return this.forecasts.get(fixtureId, query.kind, query.cutoff);
  }
}
