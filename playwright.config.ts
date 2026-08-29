import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "corepack pnpm --filter @bet-stats/config build && corepack pnpm --filter @bet-stats/api build && corepack pnpm --filter @bet-stats/api dev",
      port: 3001,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        DATA_PROVIDER_MODE: "deterministic",
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
      },
    },
  ],
});
