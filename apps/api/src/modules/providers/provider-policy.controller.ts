import { Body, Controller, Header, Post, Req, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../reconciliation/operator.guard.js";
import { ProviderPolicyService } from "./provider-policy.service.js";

@Controller("internal/providers/policy")
@UseGuards(OperatorGuard)
export class ProviderPolicyController {
  constructor(private readonly policies: ProviderPolicyService) {}
  @Post("approve")
  @Header("Cache-Control", "private, no-store, max-age=0")
  approve(@Body() body: unknown, @Req() request: { operator?: { actor: string } }) { return this.policies.approve(body, request.operator?.actor ?? "operator"); }
}
