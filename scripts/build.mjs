import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Decide where `next build` may write. Pure by construction so
// tests/unit/build-distdir-guard.test.ts can cover every branch without ever
// spawning a child process.
//
// Fail-safe direction: a dev lock's EXISTENCE — never its readability — triggers
// isolation. A stale lock merely redirects output to .next-gate (harmless), while
// a missed live lock lets `next build` rewrite the shared apps/web/.next and break
// the running dev server — the 2026-10-24 incident this wrapper exists to prevent.
// Therefore: envValue non-empty wins (caller knows better), else lock present ->
// .next-gate, else undefined (plain default behaviour: CI, fresh clone, launcher
// start while stopped).
export function resolveNextDistDir({ envValue, devLockExists }) {
  if (envValue) return envValue; // non-empty passthrough; "" counts as unset
  if (devLockExists) return ".next-gate";
  return undefined;
}

function resolveTurboInvocation() {
  // Proven repo pattern (scripts/verify-release-integration.mjs, package.json
  // verify:release:schema): under `pnpm run` npm_execpath points at the pnpm CLI
  // and `pnpm exec turbo run build` resolves the workspace-local turbo binary.
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli) {
    return { command: process.execPath, args: [pnpmCli, "exec", "turbo", "run", "build"], shell: false };
  }

  // Fallback for a bare `node scripts/build.mjs`: run the workspace-local turbo
  // shim directly. The win32 `.CMD` shim needs a shell (node refuses to spawn
  // .CMD files without one), the POSIX shim is an executable script.
  const binName = process.platform === "win32" ? "turbo.CMD" : "turbo";
  const localBin = resolve(repoRoot, "node_modules", ".bin", binName);
  if (existsSync(localBin)) {
    return { command: localBin, args: ["run", "build"], shell: process.platform === "win32" };
  }

  throw new Error(
    "BUILD_TURBO_UNAVAILABLE: npm_execpath is missing (run via `pnpm build`) and node_modules/.bin/turbo is missing (run `pnpm install`)",
  );
}

function main() {
  // Resolved from the repo root (import.meta.url), never from process.cwd():
  // the guard must mean the same thing regardless of where it was invoked from.
  const devLockExists = existsSync(resolve(repoRoot, "apps/web/.next/dev/lock"));
  const nextDistDir = resolveNextDistDir({ envValue: process.env.NEXT_DIST_DIR, devLockExists });

  const env = { ...process.env };
  if (nextDistDir) {
    env.NEXT_DIST_DIR = nextDistDir;
    if (!process.env.NEXT_DIST_DIR) {
      process.stderr.write("[build] dev lock detected -> NEXT_DIST_DIR=.next-gate\n");
    }
  }

  let invocation;
  try {
    invocation = resolveTurboInvocation();
  } catch (error) {
    process.stderr.write(`[build] ${error.message}\n`);
    process.exit(1);
  }

  const child = spawn(invocation.command, invocation.args, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    shell: invocation.shell,
  });
  child.once("error", (error) => {
    process.stderr.write(`[build] failed to start turbo: ${error.message}\n`);
    process.exit(1);
  });
  child.once("exit", (code, signal) => {
    process.exit(signal ? 1 : code ?? 1);
  });
}

// Import guard: importing this module (tests do) must never spawn anything.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
