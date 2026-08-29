import type { EligibilityDecision } from "@bet-stats/domain";
import type { ReactNode } from "react";

import { RiskDisclosure } from "./risk-disclosure";

const DENIAL_COPY = {
  REGION_UNKNOWN: "Betting-related analytics are unavailable until your region can be verified.",
  REGION_NOT_ALLOWED: "Betting-related analytics are not available in your selected region.",
  AGE_NOT_ACKNOWLEDGED: "Confirm that you are 18 or older to continue.",
  DECISION_STALE: "Betting-related analytics are unavailable until your eligibility is checked again.",
  ELIGIBILITY_CHECK_FAILED: "Betting-related analytics are unavailable because eligibility could not be checked.",
} as const;

type AnalyticsShellProps = Readonly<{
  decision: EligibilityDecision;
  children: ReactNode;
}>;

export function AnalyticsShell({ decision, children }: AnalyticsShellProps) {
  if (!decision.allowed || decision.reason !== "ELIGIBLE") {
    const reason = decision.reason === "ELIGIBLE" ? "ELIGIBILITY_CHECK_FAILED" : decision.reason;
    return (
      <section aria-labelledby="eligibility-heading">
        <h1 id="eligibility-heading">Eligibility required</h1>
        <p role="alert">{DENIAL_COPY[reason]}</p>
        <form>
          <label htmlFor="eligibility-region">Region</label>
          <select id="eligibility-region" name="region" defaultValue="">
            <option value="" disabled>Select your region</option>
          </select>
          <label><input type="checkbox" name="ageAcknowledged" /> I confirm that I am 18 or older.</label>
          <button type="submit">Check eligibility</button>
        </form>
      </section>
    );
  }

  return (
    <section data-protected-analytics="true">
      <RiskDisclosure />
      {children}
    </section>
  );
}
