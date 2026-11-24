// Операторская точка входа: запись набора закрывающих коэффициентов одного рынка одного матча (CLV-01).
// Вызывает тот же репозиторий, что и POST internal/closing-odds: запись append-only, одной транзакцией,
// до начала матча и до расчёта; повтор того же набора ничего не добавляет.
// Требуется собранный проект (pnpm build) и DATABASE_URL в окружении (файл .env не читается).
//
// Usage:
//   node scripts/closing-odds.mjs record --fixture ID --market ONE_X_TWO --source LABEL \
//     --observed-at 2026-11-30T11:00:00.000Z --odds HOME=2.10,DRAW=3.40,AWAY=3.60
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

export const CLOSING_ODDS_USAGE = `Использование: node scripts/closing-odds.mjs record [параметры]

Параметры (все обязательны):
  --fixture <id>         идентификатор матча
  --market <рынок>       ONE_X_TWO | OVER_UNDER_2_5 | BTTS
  --source <метка>       источник (должен совпадать с источником ручных коэффициентов)
  --observed-at <ISO>    момент наблюдения в UTC с миллисекундами, например 2026-11-30T11:00:00.000Z
  --odds <ВЫБОР=К,...>   полный набор выборов рынка, например HOME=2.10,DRAW=3.40,AWAY=3.60

Набор записывается целиком одной транзакцией и только до начала матча и до расчёта.
Повтор того же набора ничего не добавляет; тот же момент с другим коэффициентом отклоняется.
Исправление записывается новым наблюдением с более поздним моментом. Нужна переменная DATABASE_URL.`;

/** Объяснения кодов отказа по-русски; коды совпадают с телом ответа POST internal/closing-odds. */
export const CLOSING_ODDS_REJECTION_COPY = Object.freeze({
  INCOMPLETE_MARKET_SET: "набор неполный: нужны все выборы рынка, ровно по одному разу",
  DUPLICATE_SELECTION: "один и тот же выбор указан дважды",
  UNSUPPORTED_MARKET: "рынок не поддерживается (ONE_X_TWO, OVER_UNDER_2_5, BTTS)",
  INVALID_OBSERVED_AT: "момент наблюдения должен быть в формате UTC с миллисекундами, например 2026-11-30T11:00:00.000Z",
  OBSERVED_AT_NOT_PRE_KICKOFF: "момент наблюдения не раньше начала матча",
  OBSERVED_AT_IN_FUTURE: "момент наблюдения в будущем относительно часов сервера",
  RECORDED_AFTER_KICKOFF: "матч уже начался: запись закрывающих коэффициентов закрыта",
  FIXTURE_ALREADY_SETTLED: "по матчу уже есть расчётная квитанция: запись закрыта",
  INVALID_ODDS: "коэффициент должен быть десятичным числом строго больше 1",
  INVALID_SOURCE_CONVENTION: "источник не указан",
  FIXTURE_NOT_FOUND: "матч не найден",
  UNKNOWN_SOURCE_CONVENTION: "источник не совпадает ни с одним источником ручных коэффициентов",
  CLOSING_OBSERVATION_CONFLICT: "для этого матча, рынка, источника и момента уже записан другой коэффициент; исправление записывайте с более поздним --observed-at",
});

const REQUIRED_OPTIONS = ["fixture", "market", "source", "observed-at", "odds"];

function usageError(code, message) {
  return { ok: false, code, message };
}

/**
 * Разбор аргументов команды record. Только синтаксис: допустимость рынка, выборов и коэффициентов решает доменная валидация.
 * Возвращает { ok: true, input } либо { ok: false, code, message } (сообщение по-русски).
 */
export function parseRecordArguments(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        fixture: { type: "string" },
        market: { type: "string" },
        source: { type: "string" },
        "observed-at": { type: "string" },
        odds: { type: "string" },
      },
    });
  } catch (error) {
    return usageError("INVALID_ARGUMENTS", `Неверные параметры: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "record") {
    return usageError("UNKNOWN_COMMAND", "Неизвестная команда: поддерживается только record.");
  }
  const values = parsed.values;
  for (const name of REQUIRED_OPTIONS) {
    if (typeof values[name] !== "string" || values[name].trim() === "") return usageError("MISSING_ARGUMENT", `Не указан обязательный параметр --${name}.`);
  }
  const selections = [];
  for (const pair of values.odds.split(",")) {
    const parts = pair.split("=");
    const selection = parts[0]?.trim() ?? "";
    const decimalOdds = parts[1]?.trim() ?? "";
    if (parts.length !== 2 || selection === "" || decimalOdds === "") {
      return usageError("INVALID_ODDS_ARGUMENT", `Неверный формат --odds: «${pair}». Ожидается ВЫБОР=КОЭФФИЦИЕНТ, например HOME=2.10.`);
    }
    selections.push({ selection, decimalOdds });
  }
  return {
    ok: true,
    input: {
      fixtureId: values.fixture.trim(),
      market: values.market.trim(),
      sourceConvention: values.source,
      observedAt: values["observed-at"].trim(),
      selections,
    },
  };
}

function describeRows(result) {
  return result.observations.map((row) => `  ${row.selection} ${row.decimalOdds}`);
}

/**
 * Выполняет команду через репозиторий закрывающих коэффициентов. Возвращает код выхода:
 * 0 записано или уже было записано, 1 отказ сервера или конфликт, 2 ошибка в параметрах.
 */
export async function runClosingOddsCommand(argv, { repository, out }) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    out(CLOSING_ODDS_USAGE);
    return argv.length === 0 ? 2 : 0;
  }
  const parsed = parseRecordArguments(argv);
  if (!parsed.ok) {
    out(`Ошибка: ${parsed.message}`);
    out("Справка: node scripts/closing-odds.mjs --help");
    return 2;
  }
  try {
    const result = await repository.recordClosingOddsBook(parsed.input);
    const head = `матч ${parsed.input.fixtureId}, рынок ${parsed.input.market}, источник ${parsed.input.sourceConvention}, момент ${parsed.input.observedAt}`;
    if (result.created) {
      out(`Записано: ${result.observations.length} наблюдений (${head}).`);
    } else {
      out(`Уже записано: набор совпадает с существующим, новых строк нет (${head}).`);
    }
    for (const line of describeRows(result)) out(line);
    return 0;
  } catch (error) {
    const code = error?.code;
    if (typeof code === "string" && Object.hasOwn(CLOSING_ODDS_REJECTION_COPY, code)) {
      out(`Отказ ${code}: ${CLOSING_ODDS_REJECTION_COPY[code]}. Ничего не записано.`);
      return 1;
    }
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const out = (line) => process.stdout.write(`${line}\n`);
  // Справка и ошибки в параметрах не требуют базы данных.
  if (args.length === 0 || args.includes("--help") || args.includes("-h") || !parseRecordArguments(args).ok) {
    return runClosingOddsCommand(args, { repository: null, out });
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Нужна переменная окружения DATABASE_URL.");
    return 1;
  }
  const { createPrismaClient, createPrismaClosingOddsRepository } = await import("../packages/database/dist/index.js");
  const database = createPrismaClient(databaseUrl);
  try {
    return await runClosingOddsCommand(args, { repository: createPrismaClosingOddsRepository({ database }), out });
  } catch (error) {
    console.error(`Ошибка: ${error?.code ?? error?.message ?? error}`);
    return 1;
  } finally {
    await database.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // exitCode вместо process.exit: вывод в канал успевает сброситься до завершения процесса.
  process.exitCode = await main();
}
