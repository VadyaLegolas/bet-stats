import { defineConfig, devices } from "@playwright/test";

import { liveEvidenceGlobalSetup, liveEvidenceGlobalTeardown, LIVE_API_ORIGIN, LIVE_WEB_ORIGIN } from "./tests/e2e/live-evidence-stack";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  globalSetup: liveEvidenceGlobalSetup,
  globalTeardown: liveEvidenceGlobalTeardown,
  use: { baseURL: LIVE_WEB_ORIGIN, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], timezoneId: "Europe/Warsaw" } }],
});
