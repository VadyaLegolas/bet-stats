// Performance audit harness (Phase 10, PERF-01).
// Owned stack (pattern: tests/e2e/live-evaluation-stack.ts) → median-of-3 Lighthouse audits
// → closed-field receipt → fail-closed budget assertions (gate discipline pattern:
// scripts/verify-release-integration.mjs). Zero live provider calls; the developer's
// dev server and .next build are never touched (NEXT_DIST_DIR=.next-e2e for both
// build and start — 07-02 precedent).
//
// Modes:
//   --record  --receipt <path>                 measure + write receipt, skip budget assertions
//   --assert-only --receipt <path>             load an existing receipt, run assertions only (no stack)
//   (default)     --receipt <path>             measure + write receipt + assert against the budget
//   --budget <path>                            budget config (default scripts/perf/perf-budget.json)
//   --html-dir <path>                          keep raw Lighthouse HTML/JSON artifacts there
//                                              (otherwise a throwaway OS temp dir, never the repo)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const databaseDist = resolve(databaseRoot, "dist/index.js");
const defaultBudgetPath = resolve(scriptDir, "perf/perf-budget.json");

// Ports deliberately differ from the dev stack (3000/3001) and the evaluation stack (3220/3221).
const AUDIT_WEB_ORIGIN = "http://127.0.0.1:3230";
const AUDIT_API_ORIGIN = "http://127.0.0.1:3231";
// Config-driven page list (D-01): until scripts/perf/perf-budget.json exists, --record mode
// uses this single built-in page path — it is the seed of the budget file's page list,
// never a second list.
const BUILT_IN_PAGE_PATH = "/fixtures/perf-audit-fixture";
const RUN_COUNT = 3;
const AUDIT_NEXT_DIST_DIR = ".next-e2e";

// The gated metric set (D-02): exactly these four. The Lighthouse Performance score is
// recorded in the receipt but NEVER asserted; the desktop block (D-04) is recorded-only
// and lives outside this set by construction — assertMetricsWithinBudgets never reads it.
export const GATED_METRICS = ["lcp", "tbt", "cls", "scriptTransferBytes"];

// Fail-closed error names, e.g. UNMEASURABLE_SCRIPT_TRANSFER_BYTES.
const METRIC_ERROR_NAMES = { lcp: "LCP", tbt: "TBT", cls: "CLS", scriptTransferBytes: "SCRIPT_TRANSFER_BYTES" };

const state = { container: "", url: "", apiPid: undefined, webPid: undefined, htmlDir: "", ownsHtmlDir: false };

function docker(...args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// The Windows/POSIX dual spawn via cmd.exe /d /s /c corepack is load-bearing — do not
// simplify to bare corepack (runs on the local Windows machine and the ubuntu CI runner).
function corepack(args, extraEnv = {}) {
  execFileSync(
    process.platform === "win32" ? "cmd.exe" : "corepack",
    process.platform === "win32" ? ["/d", "/s", "/c", "corepack", ...args] : args,
    { cwd: root, stdio: "pipe", env: { ...process.env, ...extraEnv } },
  );
}

function start(args, env) {
  return spawn(
    process.platform === "win32" ? "cmd.exe" : "corepack",
    process.platform === "win32" ? ["/d", "/s", "/c", "corepack", ...args] : args,
    { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
}

function stop(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGTERM");
  } catch { /* already stopped */ }
}

function cleanup() {
  stop(state.webPid);
  stop(state.apiPid);
  try { if (state.container) docker("rm", "--force", state.container); } catch { /* owned container absent */ }
  if (state.ownsHtmlDir && state.htmlDir) rmSync(state.htmlDir, { recursive: true, force: true });
}

async function wait(url) {
  let cause;
  for (let i = 0; i < 120; i += 1) {
    try { const response = await fetch(url); if (response.ok) return; cause = response.status; }
    catch (error) { cause = error; }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`SERVICE_NOT_READY: ${String(cause)}`);
}

// ---------------------------------------------------------------------------
// Pure helpers (imported by tests/unit/perf-audit.test.ts — this module must
// import cleanly without lighthouse/chrome-launcher/@playwright/test loaded;
// those are lazy-imported inside the runner only).
// ---------------------------------------------------------------------------

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("UNMEASURABLE_MEDIAN_EMPTY");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Fail-closed extraction (Pitfall 8): absent audit id, non-numeric value or missing
// resource-summary script item throws UNMEASURABLE_<METRIC> — no ?? 0, no Number(undefined).
export function extractMetrics(lhr) {
  const audits = lhr?.audits;
  const scriptItems = audits?.["resource-summary"]?.details?.items;
  const scriptItem = Array.isArray(scriptItems)
    ? scriptItems.find((item) => item?.resourceType === "script")
    : undefined;
  const metrics = {
    lcp: audits?.["largest-contentful-paint"]?.numericValue,
    tbt: audits?.["total-blocking-time"]?.numericValue,
    cls: audits?.["cumulative-layout-shift"]?.numericValue,
    scriptTransferBytes: scriptItem?.transferSize,
  };
  for (const metric of GATED_METRICS) {
    const value = metrics[metric];
    if (typeof value !== "number" || Number.isNaN(value)) throw new Error(`UNMEASURABLE_${METRIC_ERROR_NAMES[metric]}`);
  }
  return metrics;
}

// Median-of-3 per metric across the runs (Pitfall 9) — never the best or worst single run.
export function metricBlock(lhrs) {
  const runs = { lcp: [], tbt: [], cls: [], scriptTransferBytes: [] };
  for (const lhr of lhrs) {
    const extracted = extractMetrics(lhr);
    for (const metric of GATED_METRICS) runs[metric].push(extracted[metric]);
  }
  const metrics = {};
  for (const metric of GATED_METRICS) metrics[metric] = { median: median(runs[metric]), runs: runs[metric] };
  return metrics;
}

// D-02/D-04: asserts ONLY pages[].metrics against the budget values. The desktop block
// is never read here, so a desktop value can never change the exit code.
export function assertMetricsWithinBudgets(metrics, budgets) {
  if (!budgets || typeof budgets !== "object") throw new Error("BUDGET_CONFIG_INVALID");
  for (const metric of GATED_METRICS) {
    const medianValue = metrics?.[metric]?.median;
    const budget = budgets[metric];
    if (typeof medianValue !== "number" || Number.isNaN(medianValue)) throw new Error(`UNMEASURABLE_${METRIC_ERROR_NAMES[metric]}`);
    if (typeof budget !== "number" || Number.isNaN(budget)) throw new Error(`${metric}: missing budget value`);
    if (medianValue > budget) throw new Error(`${metric}: ${medianValue} > budget ${budget}`);
  }
}

function profileFromLhr(lhr) {
  const settings = lhr?.configSettings;
  if (!settings?.throttling || !settings?.screenEmulation) throw new Error("UNMEASURABLE_PROFILE");
  return {
    throttlingMethod: settings.throttlingMethod,
    throttling: { ...settings.throttling },
    screenEmulation: { ...settings.screenEmulation },
    formFactor: settings.formFactor,
  };
}

// Closed-field receipt built field-by-field — never a spread of process.env or the raw
// LHR (Phase-8 D-15 discipline, T-10-01).
export function buildReceipt({ gitSha, mobileLhrs, desktopLhrs }) {
  const mobileScores = mobileLhrs.map((lhr) => lhr.categories?.performance?.score);
  const desktopScores = desktopLhrs.map((lhr) => lhr.categories?.performance?.score);
  return {
    schemaVersion: "perf-receipt-v1",
    date: new Date().toISOString(),
    gitSha,
    lighthouseVersion: mobileLhrs[0]?.environment?.lighthouseVersion,
    profile: profileFromLhr(mobileLhrs[0]),
    pages: [{
      url: mobileLhrs[0]?.finalDisplayedUrl,
      metrics: metricBlock(mobileLhrs),
      performanceScore: median(mobileScores),
    }],
    desktop: {
      profile: profileFromLhr(desktopLhrs[0]),
      metrics: metricBlock(desktopLhrs),
      performanceScore: median(desktopScores),
      recordedOnly: true,
    },
  };
}

// Closed-field receipt validation (T-10-01): unknown top-level keys, secret-shaped
// values anywhere in the receipt, and missing gated-metric blocks all fail loudly.
const RECEIPT_FIELDS = ["schemaVersion", "date", "gitSha", "lighthouseVersion", "profile", "pages", "desktop"];

const SECRET_SHAPED = [
  /postgres(ql)?:\/\/[^\s/]*:[^\s/]*@/i, // connection string with credentials
  /\bbearer\s+[A-Za-z0-9._\-+/=]{8,}/i, // bearer-style token
];

function assertSecretFree(value, path) {
  if (typeof value === "string") {
    for (const pattern of SECRET_SHAPED) {
      if (pattern.test(value)) throw new Error(`RECEIPT_SECRET_SHAPED_VALUE: ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertSecretFree(item, `${path}.${key}`);
  }
}

export function validateReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("INVALID_RECEIPT");
  for (const key of Object.keys(receipt)) {
    if (!RECEIPT_FIELDS.includes(key)) throw new Error(`UNKNOWN_RECEIPT_KEY: ${key}`);
  }
  for (const field of RECEIPT_FIELDS) {
    if (!(field in receipt)) throw new Error(`INVALID_RECEIPT: missing ${field}`);
  }
  assertSecretFree(receipt, "receipt");
  const pages = receipt.pages;
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("INVALID_RECEIPT: missing pages");
  for (const page of pages) {
    const metrics = page?.metrics;
    if (!metrics || typeof metrics !== "object") throw new Error("INVALID_RECEIPT: missing page metrics");
    for (const metric of GATED_METRICS) {
      if (!metrics[metric]) throw new Error(`RECEIPT_MISSING_GATED_METRIC: ${metric}`);
    }
  }
}
export function assertProfileMatch(receiptProfile, budgetProfile) {
  if (JSON.stringify(receiptProfile) !== JSON.stringify(budgetProfile)) {
    throw new Error("PROFILE_DRIFT: receipt profile does not match the budget's pinned profile");
  }
}

// ---------------------------------------------------------------------------
// Lighthouse runner (browser stack is lazy-imported so pure-helper imports stay light).
// ---------------------------------------------------------------------------

function writeRawReports(runnerResult, htmlDir, label) {
  const reports = Array.isArray(runnerResult.report) ? runnerResult.report : [runnerResult.report];
  const extensions = ["html", "json"];
  reports.forEach((content, index) => {
    writeFileSync(join(htmlDir, `lighthouse-${label}.${extensions[index] ?? "txt"}`), content);
  });
}

async function runSingleAudit(url, config, chromePath, htmlDir, label) {
  const { launch } = await import("chrome-launcher");
  const { default: lighthouse } = await import("lighthouse");
  // Same flags locally and CI for parity (Pitfall 7).
  const chrome = await launch({ chromePath, chromeFlags: ["--headless=new"] });
  try {
    const runnerResult = await lighthouse(url, { port: chrome.port, output: ["html", "json"] }, config);
    if (!runnerResult?.lhr) throw new Error(`UNMEASURABLE_${label.toUpperCase()}`);
    writeRawReports(runnerResult, htmlDir, label);
    return runnerResult.lhr;
  } finally {
    await chrome.kill();
  }
}

function mobilePinnedConfig(profile) {
  return {
    extends: "lighthouse:default",
    settings: {
      onlyCategories: ["performance"],
      throttlingMethod: "simulate",
      throttling: profile.throttling,
      screenEmulation: profile.screenEmulation,
      maxWaitForLoad: 45_000,
    },
  };
}

function desktopPinnedConfig(profile) {
  return {
    extends: "lighthouse:default",
    settings: {
      onlyCategories: ["performance"],
      throttlingMethod: "simulate",
      formFactor: "desktop",
      throttling: profile.throttling,
      screenEmulation: profile.screenEmulation,
      maxWaitForLoad: 45_000,
    },
  };
}

function mobileFirstRunConfig() {
  return {
    extends: "lighthouse:default",
    settings: { onlyCategories: ["performance"], throttlingMethod: "simulate", maxWaitForLoad: 45_000 },
  };
}

function desktopFirstRunConfig() {
  return {
    extends: "lighthouse:default",
    settings: {
      onlyCategories: ["performance"],
      formFactor: "desktop",
      screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1 },
      maxWaitForLoad: 45_000,
    },
  };
}

// ---------------------------------------------------------------------------
// Owned stack (pattern: tests/e2e/live-evaluation-stack.ts).
// ---------------------------------------------------------------------------

// Full ForecastResponseDto stored in the snapshot's receipt column — listIssued parses
// it fail-closed (exact keys, modelVersion "poisson-ensemble-v1", all three markets),
// so a partial receipt object would 500 the /forecasts route and degrade the page.
function snapshotResponse({ id, fixtureId, kind, cutoff, issuedAt }) {
  const evidenceBuildIds = [`evidence-build-${kind.toLowerCase()}-home`, `evidence-build-${kind.toLowerCase()}-away`];
  return {
    id,
    fixtureId,
    kind,
    officialLineupObservationId: null,
    revision: 1,
    cutoff: cutoff.toISOString(),
    modelVersion: "poisson-ensemble-v1",
    modelHash: "model-hash",
    configVersion: "forecast-config-v1",
    configHash: "config-hash",
    inputHash: `input-${kind.toLowerCase()}`,
    evidenceFingerprint: `evidence-${kind.toLowerCase()}`,
    evidenceBuildIds,
    probabilities: {
      ONE_X_TWO: [
        { selection: "HOME", probability: 0.5, fairOdds: null },
        { selection: "DRAW", probability: 0.3, fairOdds: null },
        { selection: "AWAY", probability: 0.2, fairOdds: null },
      ],
      OVER_UNDER_2_5: [
        { selection: "OVER_2_5", probability: 0.55, fairOdds: null },
        { selection: "UNDER_2_5", probability: 0.45, fairOdds: null },
      ],
      BTTS: [
        { selection: "YES", probability: 0.5, fairOdds: null },
        { selection: "NO", probability: 0.5, fairOdds: null },
      ],
    },
    confidence: { version: "confidence-v1", score: 0.6, components: { completeness: 0.6, lineupAvailability: 0.5, freshness: 0.7, sourceReliability: 0.6, modelStability: 0.6 } },
    limitations: [],
    tail: { retainedMass: 0.02, tailMass: 0.98, warning: false, normalizationVersion: "retained-mass-v1" },
    assumptions: [],
    receipt: { forecastSnapshotId: id, officialLineupObservationId: null, evidenceBuildIds, sourceRefs: [], expectedGoals: {}, adjustments: [] },
    issuedAt: issuedAt.toISOString(),
  };
}

async function seedAuditFixture(prisma) {
  // Kickoff in the future so the page renders the upcoming-fixture workbench.
  const kickoff = new Date(Date.now() + 3 * 24 * 3_600_000);
  await prisma.league.create({ data: { id: "perf-audit-league", name: "Perf Audit League", countryCode: "PL" } });
  await prisma.season.create({ data: { id: "perf-audit-season", leagueId: "perf-audit-league", label: "2026", startsOn: new Date("2026-01-01"), endsOn: new Date("2026-12-31") } });
  await prisma.team.createMany({ data: [
    { id: "perf-audit-home", name: "Audit Home", normalizedName: "audit home", countryCode: "PL" },
    { id: "perf-audit-away", name: "Audit Away", normalizedName: "audit away", countryCode: "PL" },
  ] });
  await prisma.fixture.create({ data: { id: "perf-audit-fixture", leagueId: "perf-audit-league", seasonId: "perf-audit-season", homeTeamId: "perf-audit-home", awayTeamId: "perf-audit-away", kickoffUtc: kickoff, status: "SCHEDULED" } });
  // >=2 ISSUED snapshots (INITIAL + PRE_MATCH) so the workbench renders a comparable pair.
  const kinds = [
    ["INITIAL", new Date(kickoff.getTime() - 14 * 86_400_000)],
    ["PRE_MATCH", new Date(kickoff.getTime() - 6 * 3_600_000)],
  ];
  for (const [kind, cutoff] of kinds) {
    const response = snapshotResponse({ id: `perf-audit-forecast-${kind.toLowerCase()}`, fixtureId: "perf-audit-fixture", kind, cutoff, issuedAt: new Date(cutoff.getTime() + 1000) });
    await prisma.forecastSnapshot.create({ data: {
      id: response.id,
      fixtureId: "perf-audit-fixture",
      kind,
      state: "ISSUED",
      revision: 1,
      cutoff,
      modelVersion: response.modelVersion,
      modelHash: response.modelHash,
      configVersion: response.configVersion,
      configHash: response.configHash,
      inputHash: response.inputHash,
      evidenceFingerprint: response.evidenceFingerprint,
      sourceRefs: [],
      probabilities: response.probabilities,
      confidence: response.confidence,
      assumptions: [],
      receipt: response,
      issuedAt: new Date(cutoff.getTime() + 1000),
      markets: { create: { id: `perf-audit-market-${kind.toLowerCase()}`, market: "ONE_X_TWO", probabilities: [
        { selection: "HOME", probability: 0.5 },
        { selection: "DRAW", probability: 0.3 },
        { selection: "AWAY", probability: 0.2 },
      ] } },
    } });
  }
}

async function bootOwnedStack() {
  state.container = `bet-stats-perf-audit-${process.pid}-${Date.now()}`;
  docker("run", "--detach", "--name", state.container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
  for (let i = 0; i < 60; i += 1) {
    try { docker("exec", state.container, "pg_isready", "-U", "postgres", "-d", "bet_stats"); break; }
    catch (error) { if (i === 59) throw error; await new Promise((done) => setTimeout(done, 500)); }
  }
  const pgPort = docker("port", state.container, "5432/tcp").split(":").at(-1);
  if (!pgPort) throw new Error("POSTGRES_PORT_MISSING");
  state.url = `postgresql://postgres:postgres@127.0.0.1:${pgPort}/bet_stats`;
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: state.url }, stdio: "pipe" });

  corepack(["pnpm", "--filter", "@bet-stats/config", "build"]);
  corepack(["pnpm", "--filter", "@bet-stats/domain", "build"]);
  corepack(["pnpm", "--filter", "@bet-stats/database", "build"]);
  const { createPrismaClient } = await import(pathToFileURL(databaseDist).href);
  const prisma = createPrismaClient(state.url);
  try { await seedAuditFixture(prisma); } finally { await prisma.$disconnect(); }
  corepack(["pnpm", "--filter", "@bet-stats/api", "build"]);

  // REDIS_READY=true is fine: the app degrades gracefully without a live Redis and no
  // external Redis is started. Zero live provider calls anywhere in the run.
  state.apiPid = start(["pnpm", "--filter", "@bet-stats/api", "dev"], {
    DATABASE_URL: state.url,
    API_HOST: "127.0.0.1",
    API_PORT: "3231",
    POSTGRES_READY: "true",
    REDIS_READY: "true",
    NODE_ENV: "test",
    ELIGIBILITY_ALLOWED_REGIONS: "PL",
  }).pid;
  await wait(`${AUDIT_API_ORIGIN}/health/ready`);

  // Production web build + start with distDir isolation; NEXT_DIST_DIR is set for BOTH
  // build and start (Pitfall 6). ELIGIBILITY_CHECKED_AT is deliberately NOT set — the
  // proxies stamp per request so long audits never serve a stale-denied page (Pitfall 5).
  corepack(["pnpm", "--filter", "@bet-stats/web", "build"], { NEXT_DIST_DIR: AUDIT_NEXT_DIST_DIR });
  state.webPid = start(["pnpm", "--filter", "@bet-stats/web", "exec", "next", "start", "--hostname", "127.0.0.1", "--port", "3230"], {
    API_ORIGIN: AUDIT_API_ORIGIN,
    DISPLAY_TIME_ZONE: "Europe/Warsaw",
    NODE_ENV: "production",
    ELIGIBILITY_REGION: "PL",
    ELIGIBILITY_AGE_ACKNOWLEDGED: "true",
    NEXT_DIST_DIR: AUDIT_NEXT_DIST_DIR,
  }).pid;
  await wait(AUDIT_WEB_ORIGIN);
}

// Honest-audit preflight: the page must render the full workbench, never the degraded state.
async function preflight(pageUrl) {
  let html = "";
  let cause;
  for (let i = 0; i < 20; i += 1) {
    try { const response = await fetch(pageUrl); if (response.ok) { html = await response.text(); break; } cause = response.status; }
    catch (error) { cause = error; }
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!html.includes("Прогнозы и ручной поиск value")) {
    throw new Error(`AUDIT_PREFLIGHT_FAILED: workbench heading missing from ${pageUrl} (${String(cause)})`);
  }
  if (html.includes("Сопоставимая пара прогнозов пока недоступна")) {
    throw new Error(`AUDIT_PREFLIGHT_FAILED: degraded workbench state on ${pageUrl}`);
  }
}

// ---------------------------------------------------------------------------
// Budget config + receipt I/O.
// ---------------------------------------------------------------------------

function budgetFileExists(budgetPath) {
  try { readFileSync(budgetPath); return true; } catch { return false; }
}

function loadBudget(budgetPath) {
  return JSON.parse(readFileSync(budgetPath, "utf8"));
}

function writeReceipt(receiptPath, receipt) {
  mkdirSync(dirname(resolve(receiptPath)), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

function gitSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

async function measureAndAssert({ receiptPath, budgetPath, record }) {
  const budget = budgetFileExists(budgetPath) ? loadBudget(budgetPath) : null;
  const pagePath = budget?.pages?.[0]?.path ?? BUILT_IN_PAGE_PATH;
  const pageUrl = `${AUDIT_WEB_ORIGIN}${pagePath}`;

  await bootOwnedStack();
  await preflight(pageUrl);

  state.htmlDir = state.htmlDir || mkdtempSync(join(tmpdir(), "bet-stats-perf-audit-"));
  state.ownsHtmlDir = true;

  const { chromium } = await import("@playwright/test");
  const chromePath = chromium.executablePath();

  // Mobile runs (gated): pin from the budget profile when it exists, otherwise from the
  // FIRST run's lhr.configSettings (Pattern 2's self-verifying pin).
  const mobileLhrs = [];
  let mobileProfile = budget?.profile ?? null;
  for (let index = 0; index < RUN_COUNT; index += 1) {
    const config = mobileProfile ? mobilePinnedConfig(mobileProfile) : mobileFirstRunConfig();
    const lhr = await runSingleAudit(pageUrl, config, chromePath, state.htmlDir, `mobile-${index + 1}`);
    if (!mobileProfile) mobileProfile = profileFromLhr(lhr);
    mobileLhrs.push(lhr);
  }

  // Desktop runs (D-04: recorded, never gated) — same seeded URL, pinned desktop profile.
  const desktopLhrs = [];
  let desktopProfile = budget?.desktopProfile ?? null;
  for (let index = 0; index < RUN_COUNT; index += 1) {
    const config = desktopProfile ? desktopPinnedConfig(desktopProfile) : desktopFirstRunConfig();
    const lhr = await runSingleAudit(pageUrl, config, chromePath, state.htmlDir, `desktop-${index + 1}`);
    if (!desktopProfile) desktopProfile = profileFromLhr(lhr);
    desktopLhrs.push(lhr);
  }

  const receipt = buildReceipt({ gitSha: gitSha(), mobileLhrs, desktopLhrs });
  validateReceipt(receipt);
  writeReceipt(receiptPath, receipt);
  console.log(`RECEIPT_WRITTEN: ${resolve(receiptPath)}`);
  const page = receipt.pages[0];
  for (const metric of GATED_METRICS) console.log(`${metric}: median ${page.metrics[metric].median} (${page.metrics[metric].runs.join(", ")})`);
  console.log(`desktop (recorded only): ${GATED_METRICS.map((metric) => `${metric} ${receipt.desktop.metrics[metric].median}`).join(", ")}`);

  if (record) {
    console.log("RECORD_ONLY: budget assertions skipped (--record)");
    return 0;
  }
  if (!budget) throw new Error(`BUDGET_FILE_MISSING: ${resolve(budgetPath)}`);
  assertProfileMatch(receipt.profile, budget.profile);
  assertMetricsWithinBudgets(page.metrics, budget.budgets);
  console.log("BUDGETS_OK: all gated medians within budget");
  return 0;
}

function assertExistingReceipt({ receiptPath, budgetPath }) {
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const budget = loadBudget(budgetPath);
  validateReceipt(receipt);
  assertProfileMatch(receipt.profile, budget.profile);
  const page = receipt.pages?.[0];
  if (!page) throw new Error("RECEIPT_PAGES_MISSING");
  assertMetricsWithinBudgets(page.metrics, budget.budgets);
  console.log("BUDGETS_OK: all gated medians within budget");
  return 0;
}

function parseFlags(argv) {
  const flags = { record: false, assertOnly: false, budget: defaultBudgetPath, receipt: "", htmlDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--record") flags.record = true;
    else if (arg === "--assert-only") flags.assertOnly = true;
    else if (arg === "--budget") flags.budget = resolve(argv[++index] ?? "");
    else if (arg === "--receipt") flags.receipt = resolve(argv[++index] ?? "");
    else if (arg === "--html-dir") { flags.htmlDir = resolve(argv[++index] ?? ""); state.htmlDir = flags.htmlDir; state.ownsHtmlDir = false; }
    else throw new Error(`UNKNOWN_ARGUMENT: ${arg}`);
  }
  // Fail-closed: no silent default receipt path, in any mode.
  if (!flags.receipt) throw new Error("RECEIPT_PATH_REQUIRED");
  return flags;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.assertOnly) return assertExistingReceipt({ receiptPath: flags.receipt, budgetPath: flags.budget });
  return measureAndAssert({ receiptPath: flags.receipt, budgetPath: flags.budget, record: flags.record });
}

// Main-entry guard: importing this module for unit tests never runs the harness.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}
