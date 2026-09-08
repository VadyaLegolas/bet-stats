import {
  validateRollingOriginWindow,
  type BacktestOriginResult,
  type ForecastOrchestrator,
  type ForecastOrchestratorRepository,
  type RollingOriginWindow,
} from "@bet-stats/domain";

export interface RunBacktestOriginInput {
  readonly orchestrator: ForecastOrchestrator;
  readonly repository: ForecastOrchestratorRepository;
  readonly window: RollingOriginWindow;
  readonly modelVersion: "poisson-ensemble-v1";
  readonly configHash: string;
  readonly correlationId: string;
  readonly planId?: string;
}

export async function runBacktestOrigin(input: RunBacktestOriginInput): Promise<BacktestOriginResult> {
  const window = validateRollingOriginWindow(input.window);
  const forecast = await input.orchestrator.run({
    fixtureId: window.fixtureId,
    asOf: window.forecastCutoff,
    kind: "PRE_MATCH",
    modelVersion: input.modelVersion,
    configHash: input.configHash,
    initiator: { type: "backtest", correlationId: input.correlationId, windowId: window.id, ...(input.planId ? { planId: input.planId } : {}) },
  }, input.repository);
  return { window, forecast };
}
