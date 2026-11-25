import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Домен подключается из исходников: пакет отдаёт dist только после сборки, а тесты модели читают его во время выполнения.
export default defineConfig({
  resolve: { alias: { "@bet-stats/domain": fileURLToPath(new URL("../../packages/domain/src/index.ts", import.meta.url)) } },
  test: { environment: "node", include: ["app/**/*.test.ts", "components/**/*.test.ts"] },
});
