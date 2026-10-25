import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    settings: {
      next: {
        rootDir: ".",
      },
    },
  },
  globalIgnores([".next/**", ".next-gate/**", ".next-e2e/**", "out/**", "build/**", "next-env.d.ts"]),
]);
