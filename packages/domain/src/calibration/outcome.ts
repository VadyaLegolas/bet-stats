import { SCORE_CLASS_ORDER, type ScoreMarket } from "../evaluation/scoring.js";

import { calibrationError } from "./errors.js";

/**
 * Index of the realised class inside `SCORE_CLASS_ORDER[market]` (D-03).
 *
 * This is the single source of outcome rules for calibration: 1X2 compares goals,
 * Over/Under 2.5 is "over" at three or more total goals, BTTS needs both teams to score.
 */
export function calibrationOutcomeIndex(market: ScoreMarket, homeGoals: number, awayGoals: number): number {
  if (!SCORE_CLASS_ORDER[market]) throw calibrationError("INVALID_CALIBRATION_SAMPLE", "unknown market");
  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals) || homeGoals < 0 || awayGoals < 0) {
    throw calibrationError("INVALID_CALIBRATION_SAMPLE", "goals must be non-negative integers");
  }
  switch (market) {
    case "ONE_X_TWO":
      return homeGoals > awayGoals ? 0 : homeGoals === awayGoals ? 1 : 2;
    case "OVER_UNDER_2_5":
      return homeGoals + awayGoals >= 3 ? 0 : 1;
    case "BTTS":
      return homeGoals > 0 && awayGoals > 0 ? 0 : 1;
  }
}
