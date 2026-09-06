import { Module } from "@nestjs/common";

import { EligibilityGuard } from "../eligibility/eligibility.guard.js";
import { ForecastsController } from "./forecasts.controller.js";
import { ForecastsService } from "./forecasts.service.js";

@Module({ controllers: [ForecastsController], providers: [EligibilityGuard, ForecastsService], exports: [ForecastsService] })
export class ForecastsModule {}
