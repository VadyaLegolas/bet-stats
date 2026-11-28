import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// A fresh clone has no dist/ directories, and the seed script imports the built
// database package, so every launcher must run the workspace build before it.
describe("launcher step order on a fresh clone", () => {
  it("seed script still depends on the built database package", () => {
    expect(read("scripts/seed-configured-leagues.mjs")).toContain('from "../packages/database/dist/');
  });

  it.each(["scripts/app-lifecycle.ps1", "scripts/dev-full.ps1"])("%s builds before seeding the league catalogue", (script) => {
    const commands = read(script)
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("#"));
    const build = commands.findIndex((line) => /^\s*corepack pnpm build\b/.test(line));
    const seed = commands.findIndex((line) => /^\s*node scripts[\\/]seed-configured-leagues\.mjs\b/.test(line));

    expect(build).toBeGreaterThanOrEqual(0);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(build).toBeLessThan(seed);
  });
});
