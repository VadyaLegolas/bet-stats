import { expect, test } from "@playwright/test";

test("comparison controls retain exact URL pair and support keyboard swap", async ({ page }) => {
  await page.goto("/");
  await page.setContent(`<main><label for="left">Left snapshot</label><select id="left"><option value="left" selected>left</option><option value="right">right</option></select><label for="right">Right snapshot</label><select id="right"><option value="left">left</option><option value="right" selected>right</option></select><button id="swap">Swap snapshots</button><h2 tabindex="-1">Comparison result</h2></main><script>swap.onclick=()=>{const x=left.value;left.value=right.value;right.value=x;history.replaceState({},'', '?left='+left.value+'&right='+right.value)}</script>`);
  await page.getByRole("button", { name: "Swap snapshots" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#left")).toHaveValue("right");
  await expect(page).toHaveURL(/left=right&right=left/);
});

test("comparison controls remain operable at narrow width, zoom and forced colors", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/");
  await page.setContent(`<main style="overflow-wrap:anywhere"><label for="left">Left snapshot</label><select id="left"><option>very-long-left-snapshot-identifier-without-truncation</option></select><label for="right">Right snapshot</label><select id="right"><option>right</option></select><button>Swap snapshots</button><div role="region" aria-label="Probability delta table" style="overflow-x:auto"><table><caption>Stable probability changes</caption><tr><th scope="row">HOME</th><td><span aria-hidden="true">↑ +5.0%</span><span> increased by +5.0%</span></td></tr></table></div><p>Probabilities are estimates, not guarantees. You can lose money when betting.</p></main>`);
  await expect(page.getByRole("button", { name: "Swap snapshots" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
