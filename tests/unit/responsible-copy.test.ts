import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DISCLOSURE = "Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.";

const PROHIBITED_CLAIMS = {
  certainty: [/\bsure\b/iu, /\bsafe\s+bet\b/iu, /\bguaranteed(?:\s+(?:win|profit))?\b/iu],
  urgency: [/\bact\s+now\b/iu, /\bmust\s+bet\b/iu, /\block\b/iu],
  riskFree: [/\brisk[-\s]?free\b/iu],
  stakeSizing: [/\bstake\s+(?:size|sizing|\d+)/iu, /\bbet\s+\d+%/iu],
  automaticWager: [/\bauto(?:matic)?(?:ally)?\s+(?:bet|wager)/iu, /\bplace\s+(?:the|a)\s+bet\b/iu],
} as const;

function scanUserFacingCopy(source: string): readonly string[] {
  const approvedDisclosures = [DISCLOSURE, "No outcome is guaranteed."];
  const scannable = approvedDisclosures.reduce((copy, approved) => copy.replaceAll(approved, ""), source);
  return Object.entries(PROHIBITED_CLAIMS)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(scannable)))
    .map(([category]) => category);
}

// Русский словарь запрещённых слов для поверхности сканера value (Phase 15, D-12, SCAN-03).
// Флаги "iu" обязательны: "i" ловит заглавную «Лучшие», "u" даёт юникодную границу слова,
// поэтому «улучшение» не срабатывает на основу «лучш».
const ruPattern = (body: string) => new RegExp(`(?<![\\p{L}])(?:${body})`, "iu");

const PROHIBITED_RU = {
  ranking: [ruPattern("лучш|топ|горяч|рейтинг|самы[ейх]\\s+выгодн|рекомендуем(?![\\p{L}])|выбор\\s+дня|фаворит")],
  certainty: [ruPattern("гарант|уверенн|верняк|точно\\s+выиграет|безрисков|беспроигрыш|надёжн(?:ая|ый|ые)\\s+ставк")],
  urgency: [ruPattern("срочно|успей|только\\s+сегодня|последний\\s+шанс|не\\s+упусти|пока\\s+не\\s+поздно")],
  advice: [ruPattern("ставьте|ставь(?![\\p{L}])|сделайте\\s+ставку|сделать\\s+ставку|советуем|рекомендуем\\s+поставить")],
  profit: [ruPattern("прибыл")],
} as const;

const APPROVED_RU = [
  "Кандидаты value — это оценка модели, а не рекомендация и не обещание прибыли.",
  DISCLOSURE,
] as const;

function scanRu(source: string): readonly string[] {
  const scannable = APPROVED_RU.reduce((copy, approved) => copy.replaceAll(approved, ""), source);
  return Object.entries(PROHIBITED_RU)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(scannable)))
    .map(([category]) => category);
}

/** Поверхность сканера: все .ts/.tsx (не тесты) в apps/web/app/scanner и запись навигации. Не весь apps/web: законные основы встречаются в метках перечислений и методологии. */
function scannerSurfaceSources(): readonly string[] {
  const directory = "apps/web/app/scanner";
  const files = readdirSync(resolve(directory), { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".tsx") || (file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts")))
    .map((file) => `${directory}/${file.replaceAll("\\", "/")}`);
  return [...files, "apps/web/components/release-navigation.tsx"];
}

function userFacingSources(): readonly string[] {
  return ["apps/web/app", "apps/web/components"].flatMap((directory) =>
    readdirSync(resolve(directory), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".tsx") || (file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts")))
      .map((file) => `${directory}/${file.replaceAll("\\", "/")}`),
  );
}

describe("responsible user-facing copy", () => {
  it.each([
    ["This is a sure result.", "certainty"],
    ["Our safe bet is a guaranteed win.", "certainty"],
    ["Act now: this is the lock of the week.", "urgency"],
    ["You must bet before kickoff.", "urgency"],
    ["A risk-free guaranteed profit.", "riskFree"],
    ["Stake size 5 units.", "stakeSizing"],
    ["Automatically place the bet.", "automaticWager"],
  ])("names the prohibited category for %s", (copy, category) => {
    expect(scanUserFacingCopy(copy)).toContain(category);
  });

  it("does not invalidate the required disclosure or neutral fixture copy", () => {
    expect(scanUserFacingCopy(DISCLOSURE)).toEqual([]);
    expect(scanUserFacingCopy("Upcoming fixtures. No outcome is guaranteed.")).toEqual([]);
  });

  it("keeps the exact disclosure persistent in every protected analytics shell", () => {
    const shell = readFileSync(resolve("apps/web/components/analytics-shell.tsx"), "utf8");
    const disclosure = readFileSync(resolve("apps/web/components/risk-disclosure.tsx"), "utf8");
    expect(shell).toContain("<RiskDisclosure />");
    expect(disclosure).toContain(DISCLOSURE);
  });

  it("scans the .ts modules that carry user-facing copy as well as the .tsx components", () => {
    const sources = userFacingSources();
    expect(sources).toContain("apps/web/components/enum-labels.ts");
    expect(sources.some((file) => file.endsWith(".tsx"))).toBe(true);
    expect(sources.some((file) => file.endsWith(".test.ts"))).toBe(false);
  });

  it("keeps fixture discovery neutral and passes the repository copy gate", () => {
    const userFacingFiles = userFacingSources();
    const findings = userFacingFiles.flatMap((file) =>
      scanUserFacingCopy(readFileSync(resolve(file), "utf8")).map((category) => ({ file, category })),
    );

    expect(findings).toEqual([]);
    expect(readFileSync(resolve("apps/web/app/fixtures/page.tsx"), "utf8")).not.toContain("RiskDisclosure");
  });

  describe("Russian prohibited vocabulary on the scanner surface", () => {
    it.each([
      ["Лучшие ставки дня", "ranking"],
      ["Топ value", "ranking"],
      ["Горячие кандидаты", "ranking"],
      ["Гарантированный value", "certainty"],
      ["Ставьте сейчас", "advice"],
      ["Успей поставить", "urgency"],
    ])("flags %s under the %s category", (copy, category) => {
      expect(scanRu(copy)).toContain(category);
    });

    it.each(["кандидат", "оценка модели", "преимущество", "ожидаемое value", "источник коэффициентов", "улучшение"])(
      "does not flag %s",
      (copy) => {
        expect(scanRu(copy)).toEqual([]);
      },
    );

    it("allows the two approved sentences", () => {
      for (const approved of APPROVED_RU) expect(scanRu(approved)).toEqual([]);
    });

    it("still flags forbidden words that sit next to an approved sentence", () => {
      expect(scanRu(`${APPROVED_RU[0]} Срочно ставьте.`)).toEqual(expect.arrayContaining(["urgency", "advice"]));
    });

    it("scans the scanner directory and the navigation entry, and finds nothing", () => {
      const sources = scannerSurfaceSources();
      expect(sources).toContain("apps/web/app/scanner/scanner-labels.ts");
      expect(sources).toContain("apps/web/app/scanner/page.tsx");
      expect(sources).toContain("apps/web/components/release-navigation.tsx");
      expect(sources.some((file) => file.endsWith(".test.ts") || file.endsWith(".test.tsx"))).toBe(false);
      const findings = sources.flatMap((file) =>
        scanRu(readFileSync(resolve(file), "utf8")).map((category) => ({ file, category })),
      );
      expect(findings).toEqual([]);
    });
  });

  it("uses the exact API receipt for readable, copied, and downloaded output", () => {
    /* После D-09-разбиения строки квитанции живут в двух модулях: жадное ядро
       держит канонический JSON и копирование, ленивая секция — скачивание и
       разделы точной квитанции. Сканируем оба источника-владельца. */
    const workbench = readFileSync(resolve("apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx"), "utf8");
    expect(workbench).toContain("JSON.stringify(result, null, 2)");
    expect(workbench).toContain("navigator.clipboard.writeText(canonicalReceipt)");
    const outcome = readFileSync(resolve("apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx"), "utf8");
    expect(outcome).toContain("?download=true");
    expect(outcome).toContain("ID и версии квитанции");
    expect(outcome).toContain("Результаты проверок и пороги");
  });
});
