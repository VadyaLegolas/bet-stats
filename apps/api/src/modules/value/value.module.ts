import { Module } from "@nestjs/common";

import { EligibilityGuard } from "../eligibility/eligibility.guard.js";
import { ScannerController } from "./scanner.controller.js";
import { ScannerService } from "./scanner.service.js";
import { ValueController } from "./value.controller.js";
import { ValueService } from "./value.service.js";

@Module({ controllers: [ValueController, ScannerController], providers: [EligibilityGuard, ValueService, ScannerService] })
export class ValueModule {}
