import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { createPrismaClient } from "../../packages/database/src/index";
import { buildCoreValueReceipt, insertScannerReceipt, padDecimal, seedScannerFixture, seedScannerOdds } from "../helpers/scanner-seed";

/*
 * Phase 15, plan 15-05: the real-stack proof of D-04 (the stored strings are equal in the database, the API JSON, the
 * rendered row and the receipt JSON), D-05 (source, time and links) and D-08 (stale placement). PostgreSQL, Nest and Next
 * without request interception, through playwright.config.ts (API on 3001, web on 3000).
 *
 * Every row is a new INSERT with run-unique ids, and nothing is ever updated or deleted (receipts and snapshots are
 * append-only). A shared database may therefore hold rows of earlier runs on the same page: the test locates only its own
 * rows by `#receipt-{id}` and never relies on a global count.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const API_ORIGIN = "http://127.0.0.1:3001";
const HOUR = 3_600_000;
const run = `${process.pid}-${Date.now()}`;
const freshPrefix = `live-scanner-fresh-${run}`;
const stalePrefix = `live-scanner-stale-${run}`;
const freshSource = `Live Scanner Bookmaker ${run}`;
const CORE_BOOK = [["HOME", "2.4"], ["DRAW", "3.3"], ["AWAY", "3.1"]] as const;

interface StoredValues { readonly edge: string; readonly expectedValue: string }

let freshId = "";
let noValueId = "";
let staleId = "";
let freshStored: StoredValues;
let staleStored: StoredValues;

function eligibilityHeaders() {
  return {
    "x-eligibility-region": "PL",
    "x-age-acknowledged": "true",
    "x-eligibility-checked-at": new Date().toISOString(),
  };
}

test.beforeAll(async () => {
  const prisma = createPrismaClient(databaseUrl!);
  try {
    const seedMatch = async (prefix: string, kickoffHours: number, submittedHoursAgo: number, source: string) => {
      const seed = await seedScannerFixture(prisma, {
        prefix,
        kickoff: new Date(Date.now() + kickoffHours * HOUR),
        leagueName: `Live Scanner League ${prefix}`,
        homeName: `Home ${prefix}`,
        awayName: `Away ${prefix}`,
      });
      const submittedAt = new Date(Date.now() - submittedHoursAgo * HOUR);
      const odds = await seedScannerOdds(prisma, seed, { market: "ONE_X_TWO", selections: CORE_BOOK, tag: "main", submittedAt, source, capturedAt: submittedAt.toISOString() });
      const row = buildCoreValueReceipt(seed, odds, "ONE_X_TWO", "HOME");
      // Padded strings: any numeric round trip on the way to the page would shorten them.
      const id = await insertScannerReceipt(prisma, seed, row, { edge: padDecimal(row.edge), expectedValue: padDecimal(row.expectedValue) });
      return { seed, odds, id, padded: { edge: padDecimal(row.edge), expectedValue: padDecimal(row.expectedValue) } };
    };
    const columns = async (id: string): Promise<StoredValues> => {
      const rows = await prisma.$queryRawUnsafe<StoredValues[]>(`SELECT edge, "expectedValue" FROM "ValueReceipt" WHERE id = $1`, id);
      expect(rows).toHaveLength(1);
      return rows[0]!;
    };

    const fresh = await seedMatch(freshPrefix, 48, 2, freshSource);
    freshId = fresh.id;
    noValueId = await insertScannerReceipt(prisma, fresh.seed, buildCoreValueReceipt(fresh.seed, fresh.odds, "ONE_X_TWO", "DRAW", { outcome: "NO_VALUE" }));
    const stale = await seedMatch(stalePrefix, 72, 30, `Live Scanner Old Bookmaker ${run}`);
    staleId = stale.id;

    freshStored = await columns(freshId);
    staleStored = await columns(staleId);
    expect(freshStored).toEqual(fresh.padded);
    expect(staleStored).toEqual(stale.padded);
  } finally {
    await prisma.$disconnect();
  }
});

async function openScanner(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/scanner");
  await expect(page.getByRole("heading", { level: 1, name: "Сканер value" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Кандидаты value на ближайшие 7 суток" })).toBeVisible();
}

const keyValues = (page: Page, id: string) => page.locator(`[id="receipt-${id}"] dd.scanner-key`);

test("the stored strings reach the page: the fresh row in the list, the stale row in the closed block, no NO_VALUE row", async ({ page }) => {
  await openScanner(page);

  const fresh = page.locator(`[id="receipt-${freshId}"]`);
  await expect(fresh).toBeVisible();
  await expect(fresh).toHaveAttribute("data-freshness", "FRESH");
  await expect(fresh.getByText(`Источник: ${freshSource}`, { exact: true })).toBeVisible();
  await expect(fresh.getByRole("link", { name: /^Страница матча/ })).toHaveAttribute("href", `/fixtures/${freshPrefix}-fixture`);
  await expect(fresh.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  expect(await keyValues(page, freshId).allTextContents()).toEqual([freshStored.edge, freshStored.expectedValue]);

  const block = page.locator("details.scanner-stale");
  const stale = block.locator(`[id="receipt-${staleId}"]`);
  await expect(stale).toHaveCount(1);
  await expect(block.locator(`[id="receipt-${freshId}"]`)).toHaveCount(0);
  await expect(stale).toHaveAttribute("data-freshness", "STALE");
  await expect(block).not.toHaveAttribute("open", "");
  await expect(stale).toBeHidden();
  await block.locator(":scope > summary").click();
  await expect(block).toHaveAttribute("open", "");
  await expect(stale).toBeVisible();
  expect(await keyValues(page, staleId).allTextContents()).toEqual([staleStored.edge, staleStored.expectedValue]);

  await expect(page.locator(`[id="receipt-${noValueId}"]`)).toHaveCount(0);
  expect(await page.content()).not.toContain(noValueId);
});

test("database, API JSON, rendered row and receipt JSON agree on the stored strings", async ({ page, request }) => {
  const response = await request.get(`${API_ORIGIN}/value/scanner`, { headers: eligibilityHeaders() });
  expect(response.status()).toBe(200);
  const body = await response.json() as { items: Array<{ receiptId: string; edge: string; expectedValue: string; freshness: string; oddsSource: string }> };
  await openScanner(page);

  for (const [id, stored, freshness] of [[freshId, freshStored, "FRESH"], [staleId, staleStored, "STALE"]] as const) {
    const item = body.items.find((entry) => entry.receiptId === id);
    expect(item, `the API lists receipt ${id}`).toBeDefined();
    expect(item!.freshness).toBe(freshness);
    expect(item!.edge).toBe(stored.edge);
    expect(item!.expectedValue).toBe(stored.expectedValue);
    expect(await keyValues(page, id).allTextContents()).toEqual([stored.edge, stored.expectedValue]);

    const link = page.locator(`[id="receipt-${id}"]`).locator(".scanner-links a", { hasText: "Квитанция (JSON)" });
    await expect(link).toHaveAttribute("href", `/internal-api/value/${id}`);
    const receipt = await page.request.get((await link.getAttribute("href"))!);
    expect(receipt.status()).toBe(200);
    const json = await receipt.json() as { id: string; edge: string; expectedValue: string };
    expect(json.id).toBe(id);
    expect(json.edge).toBe(stored.edge);
    expect(json.expectedValue).toBe(stored.expectedValue);
  }
  expect(body.items.some((entry) => entry.receiptId === noValueId)).toBe(false);
});

test("the real page offers nothing to rank with and has no axe violation in the light theme", async ({ page }) => {
  await openScanner(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("main :is(th, [aria-sort], button, select, input)")).toHaveCount(0);
  const axe = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect((await axe()).violations).toEqual([]);
  await page.locator("main details").evaluateAll((elements) => { for (const element of elements) (element as HTMLDetailsElement).open = true; });
  expect((await axe()).violations).toEqual([]);
});
