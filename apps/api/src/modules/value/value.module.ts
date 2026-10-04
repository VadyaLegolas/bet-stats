import { Module } from "@nestjs/common";

import { EligibilityGuard } from "../eligibility/eligibility.guard.js";
import { ValueController } from "./value.controller.js";
import { ValueService } from "./value.service.js";

@Module({ controllers: [ValueController], providers: [EligibilityGuard, ValueService] })
export class ValueModule {}
