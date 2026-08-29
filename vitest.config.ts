import { fileURLToPath } from "node:url";
import { defineConfig, defineProject } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@bet-stats/config": fileURLToPath(new URL("./packages/config/src/index.ts", import.meta.url)),
      "@bet-stats/database": fileURLToPath(new URL("./packages/database/src/index.ts", import.meta.url)),
      "@bet-stats/domain": fileURLToPath(new URL("./packages/domain/src/index.ts", import.meta.url)),
      "@bet-stats/football-data": fileURLToPath(new URL("./packages/football-data/src/index.ts", import.meta.url)),
    },
  },
  test: {
    projects: [
      defineProject({
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/**/*.test.ts", "tests/unit/**/*.test.ts"],
          sequence: { concurrent: false },
        },
      }),
      defineProject({
        resolve: {
          alias: {
            "@bet-stats/config": fileURLToPath(new URL("./packages/config/src/index.ts", import.meta.url)),
            "@bet-stats/database": fileURLToPath(new URL("./packages/database/src/index.ts", import.meta.url)),
            "@bet-stats/domain": fileURLToPath(new URL("./packages/domain/src/index.ts", import.meta.url)),
            "@bet-stats/football-data": fileURLToPath(new URL("./packages/football-data/src/index.ts", import.meta.url)),
          },
        },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          fileParallelism: false,
          sequence: { concurrent: false },
        },
      }),
    ],
  },
});
