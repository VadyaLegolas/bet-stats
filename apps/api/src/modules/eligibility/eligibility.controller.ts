import { Body, Controller, Optional, Post, Res } from "@nestjs/common";
import {
  evaluateEligibility,
  failedEligibilityDecision,
  parseRegionAllowlist,
  type EligibilityDecision,
  type EligibilityInput,
} from "@bet-stats/domain";

const MAX_DECISION_AGE_MS = 60 * 60 * 1000;
const PRIVATE_NO_STORE = "private, no-store, max-age=0";

type ResponseHeaders = { header(name: string, value: string): unknown };

@Controller("eligibility")
export class EligibilityController {
  constructor(
    @Optional() private readonly allowedRegions = parseRegionAllowlist(process.env.ELIGIBILITY_ALLOWED_REGIONS),
    @Optional() private readonly now: () => Date = () => new Date(),
  ) {}

  @Post("check")
  check(
    @Body() input: EligibilityInput | undefined,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ): EligibilityDecision {
    response.header("Cache-Control", PRIVATE_NO_STORE);
    const checkedAt = this.now();
    if (input === undefined || input === null || typeof input !== "object") {
      return failedEligibilityDecision(checkedAt);
    }

    return evaluateEligibility(
      { ...input, checkedAt: checkedAt.toISOString() },
      { allowedRegions: this.allowedRegions, now: checkedAt, maxDecisionAgeMs: MAX_DECISION_AGE_MS },
    );
  }
}

export { PRIVATE_NO_STORE };
