import { MODEL_CARD } from "@bet-stats/domain";
import Link from "next/link";
import type { ReactNode } from "react";

import { RiskDisclosure } from "../../components/risk-disclosure";

const panel = { border: "1px solid #CBD5E1", borderRadius: 10, padding: 20, marginBlock: 18 } as const;
const technical = { marginBlockStart: 16, padding: 16, background: "#F8FAFC", borderRadius: 8 } as const;

function TechnicalDetails({ id, children }: { id: string; children: ReactNode }) {
  return <details id={id} style={technical}><summary>Technical details</summary>{children}</details>;
}

export default function MethodologyPage() {
  const card = MODEL_CARD;
  const minimums = card.forecast.minimumSamples;
  return <article>
    <h1>How forecasts work</h1>
    <p>We estimate football match-event probabilities from historical goal rates and bounded evidence about team strength, recent form, venue, rest and optional head-to-head results. The output is a probability estimate with an immutable evidence receipt, not a prediction of certainty.</p>
    <p>Manual bookmaker odds can be compared with the exact frozen forecast selected by the user. A result is called a value candidate only when identity, timing, data quality, confidence, edge and expected-value gates all pass.</p>

    <dl aria-label="Current model card metadata" style={panel}>
      <dt>Model card version</dt><dd><strong>{card.version}</strong></dd>
      <dt>Effective date</dt><dd><time dateTime={card.effectiveDate}>{card.effectiveDate}</time></dd>
      <dt>Current model/config</dt><dd>{card.currentModel.modelVersion} / {card.currentModel.configVersion}</dd>
      <dt>Current config hash</dt><dd><code>{card.currentModel.configHash}</code></dd>
    </dl>
    <RiskDisclosure />

    <section id="inputs" style={panel}>
      <h2>Inputs</h2>
      <p>The model uses time-bounded team goal rates, Elo strength, recent form, venue form and rest-day evidence. Head-to-head evidence is optional and tightly bounded. Every source must have been observed no later than the forecast cutoff.</p>
      <TechnicalDetails id="inputs-technical">
        <p>{card.forecast.scoreGrid}</p>
        <p><strong>Expected goals:</strong> {card.forecast.expectedGoals}</p>
        <p>Minimum samples: goal rates {minimums.goalRates}; Elo {minimums.elo}; recent form {minimums.form5}; venue {minimums.venue}; rest days {minimums.restDays}; optional head-to-head {minimums.h2h}.</p>
        <p><Link href="/fixtures#forecast-receipts">Forecast receipt details</Link> show exact cutoff, evidence build IDs and source observations.</p>
      </TechnicalDetails>
    </section>

    <section id="what-is-excluded" style={panel}>
      <h2>What is excluded</h2>
      <p>The model does not use paid bookmaker feeds, automatic wagering, live/in-play signals, personalized staking, unofficial future information or evidence observed after the forecast cutoff.</p>
      <TechnicalDetails id="what-is-excluded-technical">
        <p>Leakage prevention requires every evidence source timestamp and evidence receipt boundary to be at or before the exact cutoff. Rolling-origin backtests keep training windows before forecast cutoffs and result knowledge at a later, separate evaluation time.</p>
        <p>Backtest policy: <code>{card.policies.backtest}</code>.</p>
      </TechnicalDetails>
    </section>

    <section id="confidence" style={panel}>
      <h2>Confidence</h2>
      <p>Confidence describes evidence completeness and quality. It is not the probability that a betting decision will win. Missing, stale or mismatched evidence makes the system abstain rather than fill gaps with invented values.</p>
      <TechnicalDetails id="confidence-technical">
        <p>Goal rates require a minimum 5 matches; form and venue require {minimums.form5} and {minimums.venue}. The value gate requires confidence ≥ {card.forecast.valueThresholds.minimumConfidence}, edge ≥ {card.forecast.valueThresholds.minimumEdge}, and expected value ≥ {card.forecast.valueThresholds.minimumExpectedValue}.</p>
        <p>Value policy: <code>{card.policies.value}</code>. Score-grid tail mass above {card.forecast.tailWarningThreshold} is disclosed.</p>
      </TechnicalDetails>
    </section>

    <section id="limitations" style={panel}>
      <h2>Limitations</h2>
      <p>Football outcomes are uncertain. Small samples, stale evidence, injuries or lineups not represented before cutoff, provider outages, model misspecification and changing team behavior can all make estimates less reliable. A positive expected value remains an estimate, not a promise of profit.</p>
      <TechnicalDetails id="limitations-technical">
        <p>Known failure modes fail closed as insufficient evidence, unavailable provider data, cutoff mismatch, unresolved canonical identity or limited cohort evidence. Missing values are never treated as zero.</p>
        <p>{card.forecast.valueFormulas.join("; ")}.</p>
      </TechnicalDetails>
    </section>

    <section id="evaluation" style={panel}>
      <h2>Evaluation</h2>
      <p>Completed matches are scored against frozen pre-match probabilities. Proper scores, reliability buckets and exact denominators show probability quality; flat-one-unit and closing-line evidence are secondary descriptive views.</p>
      <TechnicalDetails id="evaluation-technical">
        <div role="region" aria-label="Proper score formulas" style={{ overflowWrap: "anywhere" }}>
          <p><code>{card.evaluation.brier}</code></p>
          <p><code>{card.evaluation.logLoss}</code></p>
        </div>
        <p>Formula: <code>{card.policies.scoreFormula}</code> · <code>{card.policies.scoreFormulaHash}</code></p>
        <p>Settlement: <code>{card.policies.settlement}</code>. Reliability: <code>{card.policies.reliability}</code>. Cohort health: <code>{card.policies.cohortHealth}</code>.</p>
        <p>Qualified evidence needs at least {card.evaluation.cohortMinimums.fixtures} fixtures and {card.evaluation.cohortMinimums.populatedBucketEvents} events in every populated bucket. Empty buckets remain visible as insufficient.</p>
        <p><Link href="/scorecards#formula-policy-receipts">Scorecard formula and policy receipts</Link> expose the exact cohort and formula identities.</p>
      </TechnicalDetails>
    </section>

    <section id="responsible-use" style={panel}>
      <h2>Responsible use</h2>
      <p>Use these estimates as transparent analytical evidence only. Do not treat them as guaranteed tips, stake more than you can afford to lose, or bet where it is unlawful or inappropriate for your age.</p>
      <TechnicalDetails id="responsible-use-technical">
        <p>No automatic wagering or personalized staking is supported. Financial evidence uses <code>{card.policies.financial}</code> and defines ROI/Yield as <code>{card.evaluation.financialRate}</code>. Closing-line comparison uses <code>{card.policies.clv}</code>.</p>
      </TechnicalDetails>
    </section>

    <section id="change-history" style={panel}>
      <h2>Change history</h2>
      {card.changeHistory.map((change) => <article key={change.version} style={{ borderBlockStart: "1px solid #CBD5E1", paddingBlock: 14 }}>
        <h3>{change.version}</h3>
        <p><strong>Effective:</strong> <time dateTime={change.effectiveDate}>{change.effectiveDate}</time></p>
        <p>{change.summary}</p>
        <p><strong>Affected policies/models:</strong> {change.affected}</p>
        <p><strong>Migration/interpretation:</strong> {change.interpretation}</p>
      </article>)}
    </section>
  </article>;
}
