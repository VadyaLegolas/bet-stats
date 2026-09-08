import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";

import { PRIVATE_NO_STORE } from "../eligibility/eligibility.controller.js";
import { EligibilityGuard } from "../eligibility/eligibility.guard.js";
import { EvaluationService, type ScorecardCohort } from "./evaluation.service.js";

export type EvaluationHttpResponse<T> = { statusCode: number; headers: Record<string, string>; body: T };
type HttpResponse = { status(code: number): HttpResponse; setHeader(name: string, value: string): void; json(value: unknown): unknown; end(): unknown };

@Controller("evaluation")
@UseGuards(EligibilityGuard)
export class EvaluationController {
  constructor(private readonly evaluation: EvaluationService) {}

  async scorecard(query: Record<string, unknown>): Promise<EvaluationHttpResponse<ScorecardCohort | null>> {
    const resolved = await this.evaluation.scorecard(query);
    return resolved.redirect
      ? { statusCode: 308, headers: { "Cache-Control": PRIVATE_NO_STORE, Location: resolved.redirect }, body: null }
      : { statusCode: 200, headers: { "Cache-Control": PRIVATE_NO_STORE }, body: resolved.result! };
  }

  @Get("scorecard")
  async getScorecard(@Query() query: Record<string, unknown>, @Res() response: HttpResponse): Promise<unknown> {
    const result = await this.scorecard(query);
    for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
    return result.statusCode === 308 ? response.status(308).end() : response.status(200).json(result.body);
  }
}
