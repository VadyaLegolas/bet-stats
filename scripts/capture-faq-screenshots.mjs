// Captures the five real screenshots used by /faq against the already-running dev stack.
// Usage: node scripts/capture-faq-screenshots.mjs   (run from repo root; stack must be live on :3000)
// Console output is ASCII-only on purpose - the Windows PowerShell console mangles Cyrillic.
import { mkdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "apps", "web", "public", "images", "faq");
const BASE = process.env.FAQ_CAPTURE_BASE ?? "http://127.0.0.1:3000";
const FIXTURE_ID = process.env.FAQ_CAPTURE_FIXTURE ?? "e1ef6104-9515-41bb-9bbc-8412a8c4fb24";
const MIN_BYTES = 10 * 1024;

const SHOTS = [
  { name: "home.png", url: "/", wait: "#home-heading" },
  { name: "fixtures.png", url: "/fixtures", wait: "Обновить матчи" },
  { name: "workbench.png", url: `/fixtures/${FIXTURE_ID}`, wait: "#odds-heading", fullPage: true },
  { name: "odds.png", url: `/fixtures/${FIXTURE_ID}`, wait: "#odds-heading", oddsFill: true },
  { name: "scorecards.png", url: "/scorecards", wait: "h1" },
];

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
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  let oddsOutcome = "not-attempted";

  try {
    for (const shot of SHOTS) {
      const file = path.join(OUT_DIR, shot.name);
      console.log(`shot ${shot.name} <- ${shot.url}`);
      if (shot.oddsFill) {
        // The earlier workbench shot wrote an empty local draft; clear storage so the
        // odds form screenshots as a first-time visitor sees it (no restore banner).
        await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
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
    }
  } finally {
    await browser.close();
  }

  console.log(`odds form outcome: ${oddsOutcome}`);
  let failed = false;
  for (const shot of SHOTS) {
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
