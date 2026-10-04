import { Module } from "@nestjs/common";

import { EligibilityGuard } from "../eligibility/eligibility.guard.js";
import { OddsController } from "./odds.controller.js";
import { OddsService } from "./odds.service.js";

@Module({ controllers: [OddsController], providers: [EligibilityGuard, OddsService], exports: [OddsService] })
export class OddsModule {}
