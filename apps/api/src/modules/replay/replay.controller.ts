import { Body, Controller, Get, Header, Param, Post, Req, UseGuards } from "@nestjs/common";

import { OperatorGuard } from "../reconciliation/operator.guard.js";
import { ReplayService } from "./replay.service.js";

@Controller("internal/pipeline/replay")
@UseGuards(OperatorGuard)
export class ReplayController {
  constructor(private readonly replay: ReplayService) {}

  @Post("preview")
  @Header("Cache-Control", "private, no-store")
  preview(@Body() input: Record<string, unknown>, @Req() request: { operator: { actor: string } }) { return this.replay.preview(input, request.operator.actor); }

  @Post("queue")
  @Header("Cache-Control", "private, no-store")
  queue(@Body() input: Record<string, unknown>) { return this.replay.queue(input); }

  @Get(":id")
  @Header("Cache-Control", "private, no-store")
  status(@Param("id") id: string) { return this.replay.status(id); }
}
