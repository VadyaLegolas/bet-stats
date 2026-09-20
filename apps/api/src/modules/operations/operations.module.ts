import { Module } from "@nestjs/common";

import { OperatorGuard } from "../reconciliation/operator.guard.js";
import { OperationsController } from "./operations.controller.js";
import { OperationsService } from "./operations.service.js";

@Module({ controllers: [OperationsController], providers: [OperationsService, OperatorGuard] })
export class OperationsModule {}
