import { Module } from "@nestjs/common";
import { OperatorGuard } from "../reconciliation/operator.guard.js";
import { ProviderPolicyController } from "./provider-policy.controller.js";
import { ProviderPolicyService } from "./provider-policy.service.js";

@Module({ controllers: [ProviderPolicyController], providers: [OperatorGuard, ProviderPolicyService], exports: [ProviderPolicyService] })
export class ProvidersModule {}
