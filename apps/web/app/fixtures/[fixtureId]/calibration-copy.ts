/**
 * Тексты панели калибровки (D-12). Чистый модуль без React: все формулировки нейтральны, без утверждений
 * об улучшении точности, превосходстве над сырым прогнозом или гарантиях.
 */

export const CALIBRATION_METHODOLOGY_HREF = "/methodology#calibration";
export const CALIBRATION_METHODOLOGY_LINK = "Как устроена калибровка";
export const CALIBRATION_ESTIMATE_NOTE = "Калиброванные вероятности — тоже оценки, а не гарантии.";
export const CALIBRATION_VALUE_NOTE = "Расчёт value по-прежнему использует сырые вероятности.";
export const CALIBRATION_RAW_ONLY = "Показаны только сырые вероятности.";

const METHOD_LABELS: Record<string, string> = { PLATT: "Platt", ISOTONIC: "изотоническая регрессия" };

export function calibrationVersionLabel(version: number): string {
  return `Калибровка v${version}`;
}

export function calibrationMethodLabel(method: string | undefined): string {
  return (method !== undefined ? METHOD_LABELS[method] : undefined) ?? "метод не указан";
}

export function calibrationSampleLine(sampleSize: number): string {
  return `Отложенная выборка: ${sampleSize} исходов`;
}

export function calibrationBrierLine(raw: number, calibrated: number): string {
  return `Brier на отложенной выборке: сырые ${raw.toFixed(3)}, калиброванные ${calibrated.toFixed(3)}`;
}

export function insufficientDataText(requiredSample: number, sampleSize: number): string {
  return `Недостаточно данных для калибровки: нужно не меньше ${requiredSample} исходов, сейчас ${sampleSize}`;
}

const UNAVAILABLE_TEXTS: Record<string, string> = {
  KIND_NOT_COVERED: "Калибровка не применяется к первичному прогнозу.",
  NO_PROMOTED_CALIBRATOR: "Калибратор для этой версии модели ещё не утверждён.",
  CALIBRATOR_MODEL_MISMATCH: "Калибратор не соответствует версии модели этого прогноза.",
  CALIBRATOR_MARKET_MISMATCH: "Калибратор не соответствует версии модели этого прогноза.",
  CALIBRATOR_INVALID: "Калибратор не соответствует версии модели этого прогноза.",
  CALIBRATION_READ_FAILED: "Калибровка временно недоступна.",
};

/** Неизвестный или отсутствующий код причины — общий текст. */
export function unavailableText(reasonCode: string | undefined): string {
  return (reasonCode !== undefined && Object.hasOwn(UNAVAILABLE_TEXTS, reasonCode) ? UNAVAILABLE_TEXTS[reasonCode] : undefined) ?? "Калибровка недоступна.";
}
