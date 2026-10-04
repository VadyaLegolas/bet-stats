import { Module } from "@nestjs/common";

import { EligibilityGuard } from "../eligibility/eligibility.guard.js";
import { EvaluationController } from "./evaluation.controller.js";
import { EvaluationService } from "./evaluation.service.js";

@Module({ controllers: [EvaluationController], providers: [EligibilityGuard, EvaluationService] })
export class EvaluationModule {}
