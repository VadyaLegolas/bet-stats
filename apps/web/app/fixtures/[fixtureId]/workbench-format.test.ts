import { describe, expect, it } from "vitest";

import { ahLineOptions, ahMarketIdFor, firstInvalidField, formMarketId, incompleteBookMessage, oddsFieldLabel, quarterSplitNote, unfilledCount } from "./workbench-format";

describe("oddsFieldLabel", () => {
  it("keeps the three core labels unchanged", () => {
    expect(oddsFieldLabel("ONE_X_TWO", "HOME")).toBe("Десятичный коэффициент на хозяев");
    expect(oddsFieldLabel("ONE_X_TWO", "DRAW")).toBe("Десятичный коэффициент на ничью");
    expect(oddsFieldLabel("OVER_UNDER_2_5", "OVER_2_5")).toBe("Десятичный коэффициент: Тотал больше 2.5");
    expect(oddsFieldLabel("BTTS", "NO")).toBe("Десятичный коэффициент: Нет");
  });

  it("labels Asian handicap sides with the signed line and the level line without a sign", () => {
    expect(oddsFieldLabel(ahMarketIdFor("-0.75"), "HOME")).toBe("Десятичный коэффициент: Хозяева −0.75");
    expect(oddsFieldLabel(ahMarketIdFor("-0.75"), "AWAY")).toBe("Десятичный коэффициент: Гости +0.75");
    expect(oddsFieldLabel(ahMarketIdFor("0"), "HOME")).toBe("Десятичный коэффициент: Хозяева 0");
    expect(oddsFieldLabel(ahMarketIdFor("0"), "AWAY")).toBe("Десятичный коэффициент: Гости 0");
  });

  it("labels exact score outcomes and falls back to the raw code", () => {
    expect(oddsFieldLabel("EXACT_SCORE", "2-1")).toBe("Счёт 2:1");
    expect(oddsFieldLabel("EXACT_SCORE", "OTHER")).toBe("Любой другой счёт");
    expect(oddsFieldLabel("ONE_X_TWO", "MYSTERY")).toBe("MYSTERY");
  });
});

describe("ahLineOptions", () => {
  it("lists the 21 lines ascending with the home and away labels", () => {
    const options = ahLineOptions();
    expect(options).toHaveLength(21);
    expect(options[0]).toEqual({ value: "-2.5", label: "Хозяева −2.5 / Гости +2.5" });
    expect(options[10]).toEqual({ value: "0", label: "Хозяева 0 / Гости 0" });
    expect(options[20]).toEqual({ value: "+2.5", label: "Хозяева +2.5 / Гости −2.5" });
    expect(options.map(({ value }) => value)).toEqual([...options.map(({ value }) => value)].sort((a, b) => Number(a) - Number(b)));
  });

  it("marks only the main line", () => {
    const marked = ahLineOptions("-0.25").filter(({ label }) => label.endsWith(" (главная линия)"));
    expect(marked).toEqual([{ value: "-0.25", label: "Хозяева −0.25 / Гости +0.25 (главная линия)" }]);
    expect(ahLineOptions("not-a-line").some(({ label }) => label.includes("главная"))).toBe(false);
  });
});

describe("quarterSplitNote", () => {
  it("names the two adjacent lines on quarter lines only", () => {
    expect(quarterSplitNote("-0.75")).toBe("На четвертной линии ставка делится между −0.5 и −1: возможны выигрыш и проигрыш половины ставки.");
    expect(quarterSplitNote("+0.25")).toBe("На четвертной линии ставка делится между 0 и +0.5: возможны выигрыш и проигрыш половины ставки.");
    for (const token of ["0", "-1", "+1.5", "-2.5", "garbage"]) expect(quarterSplitNote(token)).toBeNull();
  });
});

describe("form market id and validation helpers", () => {
  it("builds a canonical id only for a whitelisted line", () => {
    expect(formMarketId("ASIAN_HANDICAP", "")).toBeNull();
    expect(formMarketId("ASIAN_HANDICAP", "+1.00")).toBeNull();
    expect(formMarketId("ASIAN_HANDICAP", "+0.75")).toBe("ASIAN_HANDICAP:+0.75");
    expect(formMarketId("EXACT_SCORE", "")).toBe("EXACT_SCORE");
    expect(formMarketId("BTTS", "+0.75")).toBe("BTTS");
  });

  it("counts failing fields and finds the first one in selection order", () => {
    const selections = ["0-0", "0-1", "0-2", "OTHER"];
    const errors = { "0-2": "Укажите десятичный коэффициент.", OTHER: "Укажите десятичный коэффициент." };
    expect(unfilledCount(selections, errors)).toBe(2);
    expect(firstInvalidField(selections, errors)).toBe("0-2");
    expect(unfilledCount(selections, {})).toBe(0);
    expect(firstInvalidField(selections, {})).toBeNull();
  });

  it("adds the counter only to the exact score status line", () => {
    expect(incompleteBookMessage("EXACT_SCORE", 5)).toBe("Заполните все выборы перед отправкой этой неизменяемой книги коэффициентов. Не заполнено полей: 5 из 17.");
    expect(incompleteBookMessage("ONE_X_TWO", 1)).toBe("Заполните все выборы перед отправкой этой неизменяемой книги коэффициентов.");
    expect(incompleteBookMessage("ASIAN_HANDICAP", 2)).toBe("Заполните все выборы перед отправкой этой неизменяемой книги коэффициентов.");
  });
});
