import { Module } from "@nestjs/common";

import { EvidenceController } from "./modules/evidence/evidence.controller.js";
import { EvidenceService } from "./modules/evidence/evidence.service.js";
import { FixturesController } from "./modules/fixtures/fixtures.controller.js";
import { FixturesService } from "./modules/fixtures/fixtures.service.js";
import { ForecastsModule } from "./modules/forecasts/forecasts.module.js";
import { OddsModule } from "./modules/odds/odds.module.js";
import { EligibilityController } from "./modules/eligibility/eligibility.controller.js";
import { EligibilityGuard } from "./modules/eligibility/eligibility.guard.js";
import { HealthController } from "./modules/health/health.controller.js";
import { OperatorGuard } from "./modules/reconciliation/operator.guard.js";
import { ReconciliationController } from "./modules/reconciliation/reconciliation.controller.js";
import { ReconciliationService } from "./modules/reconciliation/reconciliation.service.js";
import { ReplayController } from "./modules/replay/replay.controller.js";
import { ReplayService } from "./modules/replay/replay.service.js";

@Module({
  imports: [ForecastsModule, OddsModule],
  controllers: [EligibilityController, EvidenceController, FixturesController, HealthController, ReconciliationController, ReplayController],
  providers: [EligibilityGuard, EvidenceService, FixturesService, OperatorGuard, ReconciliationService, ReplayService],
})
export class AppModule {}
