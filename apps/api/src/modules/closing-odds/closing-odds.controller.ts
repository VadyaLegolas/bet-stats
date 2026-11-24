import { Body, Controller, Post, Res, UseGuards } from "@nestjs/common";

import { PRIVATE_NO_STORE } from "../eligibility/eligibility.controller.js";
import { OperatorGuard } from "../reconciliation/operator.guard.js";
import { ClosingOddsService } from "./closing-odds.service.js";

type HttpResponse = { status(code: number): HttpResponse; setHeader(name: string, value: string): void; json(value: unknown): unknown };

/**
 * Operator-only write path of closing-odds observations (CLV-01). The class-level OperatorGuard fails closed with 404
 * (no distinction between a missing and a wrong credential). The controller never touches the database.
 */
@Controller("internal/closing-odds")
@UseGuards(OperatorGuard)
export class ClosingOddsController {
  constructor(private readonly closingOdds: ClosingOddsService) {}

  @Post()
  async record(@Body() body: unknown, @Res() response: HttpResponse): Promise<unknown> {
    response.setHeader("Cache-Control", PRIVATE_NO_STORE);
    const result = await this.closingOdds.record(body);
    return response.status(result.created ? 201 : 200).json(result);
  }
}
