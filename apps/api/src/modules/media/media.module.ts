import { Module } from "@nestjs/common";
import { OperatorGuard } from "../reconciliation/operator.guard.js";
import { ProviderLogoController } from "./provider-logo.controller.js";
import { ProviderLogoService } from "./provider-logo.service.js";
@Module({ controllers: [ProviderLogoController], providers: [OperatorGuard, ProviderLogoService], exports: [ProviderLogoService] })
export class MediaModule {}
