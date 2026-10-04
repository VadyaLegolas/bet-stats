import { Module } from "@nestjs/common";

import { EligibilityGuard } from "../eligibility/eligibility.guard.js";
import { ForecastsController } from "./forecasts.controller.js";
import { ForecastsService } from "./forecasts.service.js";
import { ForecastComparisonService } from "./forecast-comparison.service.js";

@Module({ controllers: [ForecastsController], providers: [EligibilityGuard, ForecastsService, ForecastComparisonService], exports: [ForecastsService, ForecastComparisonService] })
export class ForecastsModule {}
