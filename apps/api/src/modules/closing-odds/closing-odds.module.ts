import { Module } from "@nestjs/common";

import { OperatorGuard } from "../reconciliation/operator.guard.js";
import { ClosingOddsController } from "./closing-odds.controller.js";
import { ClosingOddsService } from "./closing-odds.service.js";

@Module({ controllers: [ClosingOddsController], providers: [ClosingOddsService, OperatorGuard] })
export class ClosingOddsModule {}
