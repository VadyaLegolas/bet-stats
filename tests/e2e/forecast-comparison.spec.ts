import { expect, test } from "@playwright/test";

test("comparison controls retain exact URL pair and support keyboard swap", async ({ page }) => {
  await page.setContent(`<main><label for="left">Left snapshot</label><select id="left"><option value="left" selected>left</option><option value="right">right</option></select><label for="right">Right snapshot</label><select id="right"><option value="left">left</option><option value="right" selected>right</option></select><button id="swap">Swap snapshots</button><h2 tabindex="-1">Comparison result</h2></main><script>swap.onclick=()=>{const x=left.value;left.value=right.value;right.value=x;history.replaceState({},'', '?left='+left.value+'&right='+right.value)}</script>`);
  await page.getByRole("button", { name: "Swap snapshots" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#left")).toHaveValue("right");
  await expect(page).toHaveURL(/left=right&right=left/);
});
