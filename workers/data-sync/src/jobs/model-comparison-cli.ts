import { parseArgs } from "node:util";

import type { PrismaClient } from "@bet-stats/database";

import { PRE_MATCH_CUTOFF_LEAD_HOURS } from "./forecasts.js";
import {
  COMPARISON_MARKETS,
  buildComparisonPlanPair,
  cohortBlockReason,
  computeModelComparison,
  describeCohort,
  describeComparison,
  jobCanStillRun,
  listComparisonFixtures,
  planComparisonCohort,
  readPlanProgress,
  resolveComparisonParams,
  submitComparisonPair,
  waitForPlans,
  type ComparisonMarket,
  type ComparisonQueue,
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
  --cutoff-hours <n>          прогноз за n часов до матча (по умолчанию ${PRE_MATCH_CUTOFF_LEAD_HOURS}, как у production PRE_MATCH)
  --training-lag-hours <n>    граница обучения (там фитится ρ) раньше прогноза на n часов (по умолчанию 24)
  --evaluation-lag-hours <n>  знание результата через n часов после матча (по умолчанию 48)
  --allow-small-cohort        разрешить когорту меньше минимума политики (вердикт будет INCONCLUSIVE по построению)
  --dry-run                   только показать отчёт когорты и пару планов, ничего не записывать (код 1, если подача невозможна)
  --timeout-minutes <n>       для run: сколько ждать воркера (по умолчанию 30)
  --json                      печатать только JSON

Окна строятся только по матчам с результатом и опубликованными доказательствами обеих команд на ТОЧНУЮ отсечку;
на один момент отсечки остаётся матч с наименьшим id, остальные считаются пропущенными (отчёт «Когорта» показывает причины).
Если пригодных окон меньше минимума политики, подача останавливается до записи (обход: --allow-small-cohort).

Нужны запущенный воркер data-sync (он исполняет планы), DATABASE_URL и REDIS_URL.
Квитанция информационная: модель не продвигается автоматически, при выборке меньше минимума вердикт INCONCLUSIVE.`;

export interface ModelComparisonCliDeps {
  readonly database: PrismaClient;
  readonly receipts: Parameters<typeof submitComparisonPair>[1]["receipts"];
  readonly queue: ComparisonQueue;
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
    ...(values["allow-small-cohort"] === true ? { allowSmallCohort: true } : {}),
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
      left: { type: "string" }, right: { type: "string" }, "timeout-minutes": { type: "string" }, "dry-run": { type: "boolean" }, "allow-small-cohort": { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean" },
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
  const fixtures = await listComparisonFixtures(deps.database, resolved);
  const { report } = planComparisonCohort(fixtures, resolved);
  const blocked = cohortBlockReason(report, resolved.allowSmallCohort);
  const cohortText = describeCohort(report);
  if (blocked) {
    const advice = blocked === "COMPARISON_NO_ELIGIBLE_FIXTURES"
      ? "Пригодных окон нет. Расширьте диапазон или лиги: окну нужны результат и опубликованные доказательства обеих команд на отсечку."
      : `Пригодных окон ${report.usable} меньше минимума ${report.minimumRequired}. Расширьте диапазон или лиги, либо укажите --allow-small-cohort (вердикт будет INCONCLUSIVE по построению).`;
    if (values["dry-run"]) emit({ dryRun: true, runnable: false, reason: blocked, cohort: report, params: resolved }, `Пробный запуск, ничего не записано. Подача невозможна.\n${cohortText}\n${advice}`);
    else emit({ submitted: false, runnable: false, reason: blocked, cohort: report }, `Подача остановлена, ничего не записано.\n${cohortText}\n${advice}`);
    return 1;
  }
  const pair = buildComparisonPlanPair(params, fixtures);
  const smallWarning = report.usable < report.minimumRequired ? "\nВнимание: выборка меньше минимума политики: вердикт будет INCONCLUSIVE по построению." : "";
  const summary = { pairId: pair.pairId, leftPlanId: pair.left.id, rightPlanId: pair.right.id, leftModel: pair.left.modelVersion, rightModel: pair.right.modelVersion, windows: pair.windowCount, cohort: pair.cohort, params: pair.params };
  if (values["dry-run"]) { emit({ dryRun: true, runnable: true, ...summary }, `Пробный запуск, ничего не записано.\n${cohortText}\nОкон: ${pair.windowCount}\nV1: ${pair.left.id}\nDC: ${pair.right.id}${smallWarning}`); return 0; }
  await submitComparisonPair(pair, { receipts: deps.receipts, queue: deps.queue });
  emit({ submitted: true, runnable: true, ...summary }, `${cohortText}${smallWarning}\nПара планов подана (повтор с теми же параметрами дубликатов не создаёт). Окон: ${pair.windowCount}\nV1: ${pair.left.id}\nDC: ${pair.right.id}`);
  if (command === "submit") return 0;

  const timeoutMinutes = numberOption(typeof values["timeout-minutes"] === "string" ? values["timeout-minutes"] : undefined, "INVALID_TIMEOUT") ?? 30;
  const waited = await waitForPlans({
    planIds: [pair.left.id, pair.right.id],
    read: (id) => readPlanProgress(deps.database, id),
    // A FAILED window is a failed attempt while BullMQ still retries (WR-08); only a job that cannot run any more is a final failure.
    ...(deps.queue.inspect ? { canStillRun: async (planId: string) => jobCanStillRun(await deps.queue.inspect!({ planId, planHash: planId === pair.left.id ? pair.left.planHash : pair.right.planHash })) } : {}),
    timeoutMs: timeoutMinutes * 60_000,
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    onProgress: (progress) => { if (!json) deps.out(`Ожидание: ${progress.map((item) => `${item.modelVersion ?? item.planId}=${item.state}${JSON.stringify(item.windows)}`).join("; ")}`); },
  });
  if (waited.outcome === "TIMEOUT") { emit({ outcome: "TIMEOUT", progress: waited.progress }, `Время ожидания вышло. Проверьте, что воркер data-sync запущен, затем: status --left ${pair.left.id} --right ${pair.right.id}`); return 2; }
  if (waited.outcome === "FAILED") { emit({ outcome: "FAILED", progress: waited.progress }, "Один из планов завершился ошибкой после исчерпания повторов очереди (см. окна FAILED). Квитанция не строится."); return 1; }
  const result = await computeModelComparison(deps.database, { leftPlanId: pair.left.id, rightPlanId: pair.right.id, market: pair.params.market, from: pair.params.from, to: pair.params.to }, deps.now);
  emit(result, `${describeComparison(result)}\n${JSON.stringify(result, null, 2)}`);
  return result.available ? 0 : 1;
}
