import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { evaluateEligibility, parseRegionAllowlist } from "@bet-stats/domain";

import { PRIVATE_NO_STORE } from "./eligibility.controller.js";

const MAX_DECISION_AGE_MS = 60 * 60 * 1000;

type HeaderValue = string | readonly string[] | undefined;
type EligibilityRequest = { headers: Record<string, HeaderValue> };
type EligibilityResponse = { header(name: string, value: string): unknown };

function firstHeader(value: HeaderValue): string | undefined {
  if (typeof value === "string" || value === undefined) return value;
  return value[0];
}

@Injectable()
export class EligibilityGuard implements CanActivate {
  constructor(
    @Optional() private readonly allowedRegions = parseRegionAllowlist(process.env.ELIGIBILITY_ALLOWED_REGIONS),
    @Optional() private readonly now: () => Date = () => new Date(),
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<EligibilityRequest>();
    http.getResponse<EligibilityResponse>().header("Cache-Control", PRIVATE_NO_STORE);
    const checkedAt = this.now();
    const decision = evaluateEligibility(
      {
        explicitRegion: firstHeader(request.headers["x-eligibility-region"]),
        ageAcknowledged: firstHeader(request.headers["x-age-acknowledged"]) === "true",
        checkedAt: firstHeader(request.headers["x-eligibility-checked-at"]),
      },
      { allowedRegions: this.allowedRegions, now: checkedAt, maxDecisionAgeMs: MAX_DECISION_AGE_MS },
    );

    if (!decision.allowed) throw new ForbiddenException(decision.reason);
    return true;
  }
}
