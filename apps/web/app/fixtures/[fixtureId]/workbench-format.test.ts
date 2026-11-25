import { describe, expect, it } from "vitest";

import { ahLineOptions, ahMarketIdFor, firstInvalidField, formMarketId, formatSigned, formatSignedPercent, incompleteBookMessage, oddsFieldLabel, quarterSplitNote, readAhBreakdownReceipt, unfilledCount } from "./workbench-format";

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

describe("signed formatting", () => {
  it("uses U+2212 for negatives, a plus for positives and a bare zero", () => {
    expect(formatSigned("0.93")).toBe("+0.930");
    expect(formatSigned("-0.5")).toBe("−0.500");
    expect(formatSigned("0")).toBe("0.000");
    expect(formatSigned("-0.0001")).toBe("0.000");
    expect(formatSigned("not-a-number")).toBe("not-a-number");
    expect(formatSignedPercent("0.0432")).toBe("+4.32%");
    expect(formatSignedPercent("-0.015")).toBe("−1.50%");
    expect(formatSignedPercent("0")).toBe("0.00%");
    expect(formatSignedPercent("1e-7")).toBe("0.00%");
  });
});

describe("readAhBreakdownReceipt", () => {
  const outcomes = [
    { result: "WIN", probability: "0.3", returnPerUnit: "0.93", contribution: "0.279" },
    { result: "HALF_WIN", probability: "0.1", returnPerUnit: "0.465", contribution: "0.0465" },
    { result: "PUSH", probability: "0.2", returnPerUnit: "0", contribution: "0" },
    { result: "HALF_LOSS", probability: "0.1", returnPerUnit: "-0.5", contribution: "-0.05" },
    { result: "LOSS", probability: "0.3", returnPerUnit: "-1", contribution: "-0.3" },
  ];
  const receipt = (extended: unknown) => ({ extended });

  it("reads the recorded five outcomes in the fixed order", () => {
    const read = readAhBreakdownReceipt(receipt({ kind: "ASIAN_HANDICAP", evPolicyVersion: "push-aware-ev-v1", evOutcomes: outcomes }));
    expect(read?.policyVersion).toBe("push-aware-ev-v1");
    expect(read?.rows.map((row) => row.result)).toEqual(["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"]);
    expect(read?.rows[0]).toEqual(outcomes[0]);
  });

  it("accepts exponent notation that Decimal.toString produces for tiny values", () => {
    const tiny = outcomes.map((row, index) => (index === 2 ? { ...row, probability: "1.2e-7", contribution: "0" } : row));
    expect(readAhBreakdownReceipt(receipt({ kind: "ASIAN_HANDICAP", evPolicyVersion: "push-aware-ev-v1", evOutcomes: tiny }))).not.toBeNull();
  });

  it("returns null instead of back-filling when anything is missing or malformed", () => {
    const base = { kind: "ASIAN_HANDICAP", evPolicyVersion: "push-aware-ev-v1", evOutcomes: outcomes };
    expect(readAhBreakdownReceipt(undefined)).toBeNull();
    expect(readAhBreakdownReceipt({})).toBeNull();
    expect(readAhBreakdownReceipt(receipt(null))).toBeNull();
    expect(readAhBreakdownReceipt(receipt({ ...base, kind: "EXACT_SCORE" }))).toBeNull();
    expect(readAhBreakdownReceipt(receipt({ ...base, evPolicyVersion: "push-aware-ev-v2" }))).toBeNull();
    expect(readAhBreakdownReceipt(receipt({ kind: "ASIAN_HANDICAP", evOutcomes: outcomes }))).toBeNull();
    expect(readAhBreakdownReceipt(receipt({ ...base, evOutcomes: outcomes.slice(0, 4) }))).toBeNull();
    expect(readAhBreakdownReceipt(receipt({ ...base, evOutcomes: [...outcomes].reverse() }))).toBeNull();
    expect(readAhBreakdownReceipt(receipt({ ...base, evOutcomes: outcomes.map((row, index) => (index === 1 ? { ...row, contribution: "NaN" } : row)) }))).toBeNull();
    expect(readAhBreakdownReceipt(receipt({ ...base, evOutcomes: outcomes.map((row, index) => (index === 3 ? { ...row, probability: 0.1 } : row)) }))).toBeNull();
  });
});
