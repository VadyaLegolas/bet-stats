import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 240_000,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
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
      command: "corepack pnpm --filter @bet-stats/config build && corepack pnpm --filter @bet-stats/domain build && corepack pnpm --filter @bet-stats/api build && corepack pnpm --filter @bet-stats/api dev",
      port: 3001,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        DATA_PROVIDER_MODE: "deterministic",
        ELIGIBILITY_ALLOWED_REGIONS: "PL",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
      },
    },
    {
      command: "corepack pnpm --filter @bet-stats/web dev:e2e",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_ORIGIN: "http://127.0.0.1:3001",
        DISPLAY_TIME_ZONE: "Europe/Warsaw",
        ELIGIBILITY_REGION: "PL",
        ELIGIBILITY_AGE_ACKNOWLEDGED: "true",
        ELIGIBILITY_CHECKED_AT: new Date().toISOString(),
      },
    },
  ],
});
