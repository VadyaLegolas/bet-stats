// Captures the real screenshots used by /faq against the already-running dev stack.
// Usage: node scripts/capture-faq-screenshots.mjs   (run from repo root; stack must be live on :3000)
//        node scripts/capture-faq-screenshots.mjs scorecards   (recapture one shot by file name)
// Console output is ASCII-only on purpose - the Windows PowerShell console mangles Cyrillic.
import { createHash, createHmac } from "node:crypto";
import { mkdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "apps", "web", "public", "images", "faq");
const BASE = process.env.FAQ_CAPTURE_BASE ?? "http://127.0.0.1:3000";
// Running example: Juventus FC - SS Lazio (Serie A). Evidence URLs are exact
// (teamId + asOf kickoff + fixtureId); overriding FIXTURE requires a matching
// TEAM and AS_OF or the evidence page will have nothing published.
const FIXTURE_ID = process.env.FAQ_CAPTURE_FIXTURE ?? "6ac69f78-0f7d-401e-8653-404268252782";
const TEAM_ID = process.env.FAQ_CAPTURE_TEAM ?? "cmv9oe2yk0021sogjbith744v";
const EVIDENCE_AS_OF = process.env.FAQ_CAPTURE_AS_OF ?? "2026-10-18T18:45:00.000Z";
// The operations overview proxy is HMAC-signed like the operator gateway does it:
// the browser never holds the signing secret, so this capture signs in-process.
const OPERATIONS_QUERY = "?page=1&pageSize=25&windowHours=24";
const MIN_BYTES = 10 * 1024;

const SHOTS = [
  { name: "home.png", url: "/", wait: "#home-heading" },
  { name: "fixtures.png", url: "/fixtures", wait: "Обновить матчи" },
  { name: "workbench.png", url: `/fixtures/${FIXTURE_ID}`, wait: "#odds-heading", fullPage: true },
  { name: "odds.png", url: `/fixtures/${FIXTURE_ID}`, wait: "#odds-heading", oddsFill: true },
  { name: "scorecards.png", url: "/scorecards", wait: "h1" },
  { name: "evidence.png", url: `/teams/${encodeURIComponent(TEAM_ID)}/evidence?asOf=${encodeURIComponent(EVIDENCE_AS_OF)}&fixtureId=${encodeURIComponent(FIXTURE_ID)}`, wait: "Трассировка подходящих матчей", fullPage: true },
  { name: "operations.png", url: `/internal/operations${OPERATIONS_QUERY}`, wait: "Последняя проверка", fullPage: true, operatorSigned: true },
];

// .env is loaded here (never printed) because the signing secret and the
// authorized subject live only in the operator contour's environment.
async function loadDotEnv() {
  try {
    const text = await readFile(path.join(ROOT, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim();
    }
  } catch { /* no .env: the signed shot degrades to the honest unavailable state */ }
}

// Canonical string and digest mirror apps/web/app/internal-api/operations/[[...path]]/route.ts.
function operatorSignedHeaders(pathname, search) {
  const secret = process.env.OPERATOR_PROXY_SIGNING_SECRET;
  const subject = (process.env.OPERATOR_AUTHORIZED_SUBJECTS ?? "").split(",")[0]?.trim();
  if (!secret || secret.length < 32 || !subject) return null;
  const timestamp = new Date().toISOString();
  const pairs = [...new URLSearchParams(search).entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  const digest = createHash("sha256").update(new URLSearchParams(pairs).toString(), "utf8").digest("base64url");
  const signature = createHmac("sha256", secret).update(`${subject}\n${timestamp}\nGET\n${pathname}\n${digest}`, "utf8").digest("base64url");
  return { "x-operator-subject": subject, "x-operator-timestamp": timestamp, "x-operator-signature": signature };
}

async function removeDevOverlay(page) {
  // The Next dev overlay renders in a shadow-rooted <nextjs-portal>; drop it before every shot.
  await page.evaluate(() => document.querySelector("nextjs-portal")?.remove());
}

async function waitForContent(page, selectorOrText) {
  try {
    if (selectorOrText.startsWith("#") || selectorOrText.startsWith("h1")) {
      await page.locator(selectorOrText).first().waitFor({ state: "attached", timeout: 30000 });
    } else {
      await page.getByText(selectorOrText, { exact: false }).first().waitFor({ state: "attached", timeout: 30000 });
    }
  } catch {
    // ASCII-only log: the marker itself may be Cyrillic and PowerShell mangles it.
    console.log("  note: content marker not seen within timeout; continuing");
  }
}

// FILL ONLY - never click the save/submit button: submitting would create a real odds observation.
async function fillOddsForm(page) {
  try {
    await page.locator("#source-label").waitFor({ state: "attached", timeout: 30000 });
    await page.locator("#source-label").fill("Букмекер (пример)");
    await page.locator("#odds-HOME").fill("2.1");
    await page.locator("#odds-DRAW").fill("3.4");
    await page.locator("#odds-AWAY").fill("3.2");
    return "filled";
  } catch {
    return "empty-form";
  }
}

async function pngDimensions(file) {
  const buffer = await readFile(file);
  // PNG IHDR: width/height are big-endian uint32 at byte offsets 16 and 20.
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function main() {
  await loadDotEnv();
  await mkdir(OUT_DIR, { recursive: true });
  const only = process.argv[2];
  const shots = only ? SHOTS.filter((shot) => shot.name === only || shot.name === `${only}.png`) : SHOTS;
  if (only && shots.length === 0) {
    console.log(`unknown shot "${only}"; known: ${SHOTS.map((shot) => shot.name).join(", ")}`);
    process.exit(1);
  }
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  let oddsOutcome = "not-attempted";

  try {
    for (const shot of shots) {
      const file = path.join(OUT_DIR, shot.name);
      console.log(`shot ${shot.name} <- ${shot.url}`);
      if (shot.oddsFill) {
        // The earlier workbench shot wrote an empty local draft; clear storage so the
        // odds form screenshots as a first-time visitor sees it (no restore banner).
        await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      }
      const operatorSigned = shot.operatorSigned ? operatorSignedHeaders("/internal-api/operations/overview", OPERATIONS_QUERY) : null;
      if (shot.operatorSigned) {
        if (operatorSigned) await context.setExtraHTTPHeaders(operatorSigned);
        else console.log("  note: operator signing env missing; overview blocks will show their unavailable state");
      }
      await page.goto(`${BASE}${shot.url}`, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(4000);
      await waitForContent(page, shot.wait);
      if (shot.oddsFill) oddsOutcome = await fillOddsForm(page);
      await removeDevOverlay(page);
      const options = shot.fullPage ? { fullPage: true } : {};
      if (shot.oddsFill) {
        const section = page.locator("section:has(> h3#odds-heading)").first();
        try {
          // Neutralize sticky/fixed chrome so it cannot be stitched over the captured section.
          await page.addStyleTag({
            content: "header, nav { position: static !important; }",
          });
          await section.scrollIntoViewIfNeeded({ timeout: 5000 });
          await page.waitForTimeout(500);
          await section.screenshot({ path: file, timeout: 10000 });
        } catch {
          await page.screenshot({ path: file, ...options });
        }
      } else {
        await page.screenshot({ path: file, ...options });
      }
      // Never leak the operator signature into the following shots.
      if (operatorSigned) await context.setExtraHTTPHeaders({});
    }
  } finally {
    await browser.close();
  }

  console.log(`odds form outcome: ${oddsOutcome}`);
  let failed = false;
  for (const shot of shots) {
    const file = path.join(OUT_DIR, shot.name);
    try {
      const info = await stat(file);
      const { width, height } = await pngDimensions(file);
      const ok = info.size >= MIN_BYTES;
      if (!ok) failed = true;
      console.log(`${ok ? "OK  " : "FAIL"} ${path.relative(ROOT, file).replaceAll("\\", "/")} bytes=${info.size} px=${width}x${height}`);
    } catch {
      failed = true;
      console.log(`FAIL ${shot.name} missing`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`capture failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
