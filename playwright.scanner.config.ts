import { defineConfig, devices } from "@playwright/test";

/*
 * Scanner end-to-end matrix (Phase 15): a deterministic stub API plus an isolated `next dev` (own port and own dist
 * directory). No database, no real API and no contact with a development server on port 3000.
 */

const STUB_PORT = 3251;
const WEB_PORT = 3252;
const STUB_ORIGIN = `http://127.0.0.1:${STUB_PORT}`;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;

// The specification reads this to switch scenarios; its absence means the spec runs under another config.
process.env.SCANNER_STUB_ORIGIN = STUB_ORIGIN;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "value-scanner.spec.ts",
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: WEB_ORIGIN,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], timezoneId: "Europe/Warsaw" },
    },
  ],
  webServer: [
    {
      command: "node tests/e2e/scanner-stub-api.mjs",
      url: `${STUB_ORIGIN}/__health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { SCANNER_STUB_PORT: String(STUB_PORT) },
    },
    {
      command: `corepack pnpm --filter @bet-stats/config build && corepack pnpm --filter @bet-stats/domain build && corepack pnpm --filter @bet-stats/web exec next dev --hostname 127.0.0.1 --port ${WEB_PORT}`,
      url: `${WEB_ORIGIN}/scanner`,
      reuseExistingServer: false,
      timeout: 600_000,
      env: {
        NEXT_DIST_DIR: ".next-scanner",
        API_ORIGIN: STUB_ORIGIN,
        ELIGIBILITY_REGION: "PL",
        ELIGIBILITY_AGE_ACKNOWLEDGED: "true",
        ELIGIBILITY_CHECKED_AT: new Date().toISOString(),
        DISPLAY_TIME_ZONE: "Europe/Warsaw",
      },
    },
  ],
});
