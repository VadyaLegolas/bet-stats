import { MARKET_SELECTIONS, type MarketCalibrationView, type OddsMarket } from "@bet-stats/domain";
import Link from "next/link";

import { MARKET_LABELS, SELECTION_LABELS } from "../../../components/enum-labels";
import { ResponsiveEvidence, type EvidenceColumn } from "../../../components/responsive-evidence";
import {
  CALIBRATION_ESTIMATE_NOTE,
  CALIBRATION_METHODOLOGY_HREF,
  CALIBRATION_METHODOLOGY_LINK,
  CALIBRATION_RAW_ONLY,
  CALIBRATION_VALUE_NOTE,
  calibrationBrierLine,
  calibrationMethodLabel,
  calibrationSampleLine,
  calibrationVersionLabel,
  insufficientDataText,
  unavailableText,
} from "./calibration-copy";
import { percent } from "./workbench-format";

type CalibrationRow = { readonly selection: string; readonly raw: number; readonly calibrated: number };

const columns: readonly EvidenceColumn<CalibrationRow>[] = [
  { key: "selection", label: "Выбор", value: (row) => SELECTION_LABELS[row.selection as keyof typeof SELECTION_LABELS] ?? row.selection },
  { key: "raw", label: "Сырая вероятность", value: (row) => percent(row.raw) },
  { key: "calibrated", label: "Калиброванная вероятность", value: (row) => percent(row.calibrated) },
];

function isProbabilityList(value: unknown, length: number): value is readonly number[] {
  return Array.isArray(value) && value.length === length && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

/**
 * Панель калибровки одного рынка (D-11, D-12). Читает только закрытые поля ответа API; ответ без записи, неполный
 * блок CALIBRATED и неизвестный код причины показываются как недоступная калибровка, а не как «откалибровано».
 */
export function CalibrationPanel({ market, view }: { market: OddsMarket; view: MarketCalibrationView | undefined }) {
  const calibration = view?.calibration;
  const selections = MARKET_SELECTIONS[market];
  const link = <p><Link href={CALIBRATION_METHODOLOGY_HREF}>{CALIBRATION_METHODOLOGY_LINK}</Link></p>;

  if (view && calibration?.state === "CALIBRATED") {
    const raw = view.rawProbabilities;
    const calibrated = calibration.calibratedProbabilities;
    if (isProbabilityList(raw, selections.length) && isProbabilityList(calibrated, selections.length) && Number.isInteger(calibration.calibratorVersion) && Number.isInteger(calibration.sampleSize)) {
      const rows: CalibrationRow[] = selections.map((selection, index) => ({ selection, raw: raw[index]!, calibrated: calibrated[index]! }));
      const marketLabel = MARKET_LABELS[market];
      return (
        <div data-calibration-state="CALIBRATED">
          <h5>{calibrationVersionLabel(calibration.calibratorVersion!)}</h5>
          <p>Метод: {calibrationMethodLabel(calibration.method)}</p>
          <p>{calibrationSampleLine(calibration.sampleSize!)}</p>
          <ResponsiveEvidence
            projectionId={`calibration-${market.toLowerCase().replaceAll("_", "-")}`}
            label={`${marketLabel} — калибровка вероятностей`}
            tableLabel={`${marketLabel} — сырые и калиброванные вероятности`}
            caption="Сырые вероятности замороженного прогноза и калиброванные вероятности"
            rows={rows}
            columns={columns}
            rowKey={(row) => row.selection}
            conclusion={(row) => SELECTION_LABELS[row.selection as keyof typeof SELECTION_LABELS] ?? row.selection}
            denominator={(row) => `${percent(row.raw)} сырая, ${percent(row.calibrated)} калиброванная`}
          />
          {Number.isFinite(calibration.holdoutBrierRaw) && Number.isFinite(calibration.holdoutBrierCalibrated) && <p>{calibrationBrierLine(calibration.holdoutBrierRaw!, calibration.holdoutBrierCalibrated!)}</p>}
          <p>{CALIBRATION_ESTIMATE_NOTE}</p>
          <p>{CALIBRATION_VALUE_NOTE}</p>
          {link}
        </div>
      );
    }
  }

  if (calibration?.state === "INSUFFICIENT_DATA" && Number.isInteger(calibration.requiredSample) && Number.isInteger(calibration.sampleSize)) {
    return (
      <div data-calibration-state="INSUFFICIENT_DATA">
        <h5>Калибровка</h5>
        <p>{insufficientDataText(calibration.requiredSample!, calibration.sampleSize!)}</p>
        <p>{CALIBRATION_RAW_ONLY}</p>
        <p>{CALIBRATION_VALUE_NOTE}</p>
        {link}
      </div>
    );
  }

  return (
    <div data-calibration-state="UNAVAILABLE">
      <h5>Калибровка</h5>
      <p>{unavailableText(calibration?.state === "UNAVAILABLE" ? calibration.reasonCode : undefined)}</p>
      <p>{CALIBRATION_RAW_ONLY}</p>
      <p>{CALIBRATION_VALUE_NOTE}</p>
      {link}
    </div>
  );
}
