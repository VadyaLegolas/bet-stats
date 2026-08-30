import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";

import { OperatorGuard } from "../reconciliation/operator.guard.js";
import { ReplayService } from "./replay.service.js";

@Controller("internal/pipeline/replay")
@UseGuards(OperatorGuard)
export class ReplayController {
  constructor(private readonly replay: ReplayService) {}

  @Post("preview")
  preview(@Body() input: Record<string, unknown>) { return this.replay.preview(input); }

  @Post("queue")
  queue(@Body() input: Record<string, unknown>) { return this.replay.queue(input); }

  @Get(":id")
  status(@Param("id") id: string) { return this.replay.status(id); }
}
