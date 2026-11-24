export type CalibrationErrorCode =
  | "CALIBRATION_FIT_FAILED"
  | "INVALID_CALIBRATION_SAMPLE"
  | "INVALID_CALIBRATION_INPUT"
  | "CALIBRATOR_MODEL_MISMATCH"
  | "CALIBRATOR_MARKET_MISMATCH"
  | "CALIBRATOR_INVALID"
  | "INVALID_CALIBRATION_EVALUATION";

export type CalibrationError = Error & { readonly code: CalibrationErrorCode };

/** Coded error: callers branch on `code`; `message` starts with the code and may carry a diagnostic. */
export function calibrationError(code: CalibrationErrorCode, detail?: string): CalibrationError {
  return Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code });
}
