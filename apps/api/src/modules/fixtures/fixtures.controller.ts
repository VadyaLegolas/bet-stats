import { Controller, Get, Param, Query } from "@nestjs/common";

import { FixturesService, type FixtureProjection } from "./fixtures.service.js";

@Controller("fixtures")
export class FixturesController {
  constructor(private readonly fixtures: FixturesService) {}

  @Get()
  list(@Query("from") from?: string, @Query("to") to?: string, @Query("competition") competition?: string): Promise<{ items: readonly FixtureProjection[]; range: { from: string; to: string } }> {
    return this.fixtures.list({ ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }), ...(competition === undefined ? {} : { competition }) });
  }

  @Get(":fixtureId")
  detail(@Param("fixtureId") fixtureId: string): Promise<FixtureProjection> {
    return this.fixtures.detail(fixtureId);
  }
}
