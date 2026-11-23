import { parseArgs } from "node:util";

import type { PrismaClient } from "@bet-stats/database";

import {
  COMPARISON_MARKETS,
  buildComparisonPlanPair,
  computeModelComparison,
  describeComparison,
  listComparisonFixtures,
  readPlanProgress,
  resolveComparisonParams,
  submitComparisonPair,
  waitForPlans,
  type ComparisonMarket,
  type ComparisonParams,
} from "./model-comparison.js";

export const MODEL_COMPARISON_USAGE = `Использование: node scripts/model-comparison.mjs <команда> [параметры]

Команды:
  run      подать пару планов (V1 и DC на одних окнах), дождаться завершения, напечатать квитанцию
  submit   только подать пару планов (идемпотентно) и напечатать их идентификаторы
  status   показать состояние планов: --left <planId> --right <planId>
  compare  построить квитанцию по уже завершённым планам: --left --right --from --to [--market]

Параметры подачи (run, submit):
  --from <ISO UTC>            начало диапазона по времени матча (включительно), обязательно
  --to <ISO UTC>              конец диапазона (исключительно), обязательно; не больше 365 суток
  --league <id[,id...]>       ограничить лигами (по умолчанию все)
  --market ONE_X_TWO|OVER_UNDER_2_5|BTTS   рынок для квитанции (по умолчанию ONE_X_TWO)
  --concurrency <1..4>        параллелизм плана (по умолчанию 1)
  --cutoff-hours <n>          прогноз за n часов до матча (по умолчанию 1)
  --training-lag-hours <n>    граница обучения (там фитится ρ) раньше прогноза на n часов (по умолчанию 24)
  --evaluation-lag-hours <n>  знание результата через n часов после матча (по умолчанию 48)
  --dry-run                   только показать пару планов и число окон, ничего не записывать
  --timeout-minutes <n>       для run: сколько ждать воркера (по умолчанию 30)
  --json                      печатать только JSON

Нужны запущенный воркер data-sync (он исполняет планы), DATABASE_URL и REDIS_URL.
Квитанция информационная: модель не продвигается автоматически, при выборке меньше минимума вердикт INCONCLUSIVE.`;

export interface ModelComparisonCliDeps {
  readonly database: PrismaClient;
  readonly receipts: Parameters<typeof submitComparisonPair>[1]["receipts"];
  readonly queue: Parameters<typeof submitComparisonPair>[1]["queue"];
  readonly out: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
}

function coded(code: string): Error & { code: string } { return Object.assign(new Error(code), { code }); }

function numberOption(value: string | undefined, code: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw coded(code);
  return parsed;
}

function parseParams(values: Record<string, string | boolean | undefined>): ComparisonParams {
  const str = (key: string) => (typeof values[key] === "string" ? (values[key] as string) : undefined);
  const market = str("market");
  if (market !== undefined && !COMPARISON_MARKETS.includes(market as ComparisonMarket)) throw coded("INVALID_MARKET");
  const from = str("from"); const to = str("to");
  if (!from || !to) throw coded("COMPARISON_RANGE_REQUIRED");
  const concurrency = numberOption(str("concurrency"), "BACKTEST_LIMIT_EXCEEDED");
  const cutoff = numberOption(str("cutoff-hours"), "INVALID_CUTOFF_HOURS");
  const training = numberOption(str("training-lag-hours"), "INVALID_TRAINING_LAG_HOURS");
  const evaluation = numberOption(str("evaluation-lag-hours"), "INVALID_EVALUATION_LAG_HOURS");
  return {
    from,
    to,
    ...(str("league") ? { leagueIds: str("league")!.split(",").map((item) => item.trim()).filter(Boolean) } : {}),
    ...(market ? { market: market as ComparisonMarket } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(cutoff !== undefined ? { cutoffHoursBeforeKickoff: cutoff } : {}),
    ...(training !== undefined ? { trainingLagHours: training } : {}),
    ...(evaluation !== undefined ? { evaluationLagHours: evaluation } : {}),
  };
}

/** Returns the process exit code: 0 = done, 1 = failed/not available, 2 = waiting timed out. */
export async function runModelComparisonCommand(argv: readonly string[], deps: ModelComparisonCliDeps): Promise<number> {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      from: { type: "string" }, to: { type: "string" }, league: { type: "string" }, market: { type: "string" }, concurrency: { type: "string" },
      "cutoff-hours": { type: "string" }, "training-lag-hours": { type: "string" }, "evaluation-lag-hours": { type: "string" },
      left: { type: "string" }, right: { type: "string" }, "timeout-minutes": { type: "string" }, "dry-run": { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean" },
    },
  });
  const command = positionals[0];
  if (values.help || !command || !["run", "submit", "status", "compare"].includes(command)) { deps.out(MODEL_COMPARISON_USAGE); return command ? 1 : 0; }
  const json = values.json === true;
  const emit = (payload: unknown, text: string) => deps.out(json ? JSON.stringify(payload, null, 2) : text);

  if (command === "status") {
    if (!values.left || !values.right) throw coded("COMPARISON_PLAN_IDS_REQUIRED");
    const progress = await Promise.all([values.left, values.right].map((id) => readPlanProgress(deps.database, id)));
    emit(progress, progress.map((item) => item.found ? `${item.planId} [${item.modelVersion}]: план ${item.state}, доставка ${item.deliveryState}, окна ${JSON.stringify(item.windows)}` : `${item.planId}: не найден`).join("\n"));
    return progress.every((item) => item.state === "SUCCEEDED") ? 0 : 1;
  }

  const params = parseParams(values);
  if (command === "compare") {
    if (!values.left || !values.right) throw coded("COMPARISON_PLAN_IDS_REQUIRED");
    const resolved = resolveComparisonParams(params);
    const result = await computeModelComparison(deps.database, { leftPlanId: values.left, rightPlanId: values.right, market: resolved.market, from: resolved.from, to: resolved.to }, deps.now);
    emit(result, `${describeComparison(result)}\n${JSON.stringify(result, null, 2)}`);
    return result.available ? 0 : 1;
  }

  const resolved = resolveComparisonParams(params);
  const pair = buildComparisonPlanPair(params, await listComparisonFixtures(deps.database, resolved));
  const summary = { pairId: pair.pairId, leftPlanId: pair.left.id, rightPlanId: pair.right.id, leftModel: pair.left.modelVersion, rightModel: pair.right.modelVersion, windows: pair.windowCount, params: pair.params };
  if (values["dry-run"]) { emit({ dryRun: true, ...summary }, `Пробный запуск, ничего не записано.\nОкон: ${pair.windowCount}\nV1: ${pair.left.id}\nDC: ${pair.right.id}`); return 0; }
  await submitComparisonPair(pair, { receipts: deps.receipts, queue: deps.queue });
  emit({ submitted: true, ...summary }, `Пара планов подана (повтор с теми же параметрами дубликатов не создаёт). Окон: ${pair.windowCount}\nV1: ${pair.left.id}\nDC: ${pair.right.id}`);
  if (command === "submit") return 0;

  const timeoutMinutes = numberOption(typeof values["timeout-minutes"] === "string" ? values["timeout-minutes"] : undefined, "INVALID_TIMEOUT") ?? 30;
  const waited = await waitForPlans({
    planIds: [pair.left.id, pair.right.id],
    read: (id) => readPlanProgress(deps.database, id),
    timeoutMs: timeoutMinutes * 60_000,
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    onProgress: (progress) => { if (!json) deps.out(`Ожидание: ${progress.map((item) => `${item.modelVersion ?? item.planId}=${item.state}${JSON.stringify(item.windows)}`).join("; ")}`); },
  });
  if (waited.outcome === "TIMEOUT") { emit({ outcome: "TIMEOUT", progress: waited.progress }, `Время ожидания вышло. Проверьте, что воркер data-sync запущен, затем: status --left ${pair.left.id} --right ${pair.right.id}`); return 2; }
  if (waited.outcome === "FAILED") { emit({ outcome: "FAILED", progress: waited.progress }, "Один из планов завершился ошибкой (см. окна FAILED). Квитанция не строится."); return 1; }
  const result = await computeModelComparison(deps.database, { leftPlanId: pair.left.id, rightPlanId: pair.right.id, market: pair.params.market, from: pair.params.from, to: pair.params.to }, deps.now);
  emit(result, `${describeComparison(result)}\n${JSON.stringify(result, null, 2)}`);
  return result.available ? 0 : 1;
}
