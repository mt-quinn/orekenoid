import { expect, test } from "@playwright/test";

type Win = Window & typeof globalThis & { __OREKENOID__: any };

/**
 * The way in.
 *
 * Three options at equal weight, each carrying its own detail, and no wait for chassis previews that no
 * longer illustrate a choice. What this guards is that the menu keeps its shape whether or not there is
 * a save, that the save describes itself inside the button that loads it, and that starting over says
 * what it costs before it charges it.
 */
test("offers three ways in, and says which is which", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?seed=bounceworld-01");
  await page.waitForSelector('#briefing[data-render-state="ready"]', { timeout: 90_000 });

  await expect(page.locator(".menu-option")).toHaveCount(3);
  // Equal weight is the point: none of them is styled as the primary, because which one the player wants
  // changes every visit.
  const widths = await page.locator(".menu-option").evaluateAll(
    (nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().width)),
  );
  expect(new Set(widths).size, `options are not equal width: ${widths.join(", ")}`).toBe(1);

  await expect(page.locator("#loadButton")).toBeDisabled();
  await expect(page.locator("#loadDetail")).toHaveText("No saved expedition");
  await expect(page.locator("#newDetail")).toHaveText("A fresh mine");
});

test("does not wait on paddle previews to become usable", async ({ page }) => {
  test.setTimeout(180_000);
  // The load gate used to await three chassis Arenas being rasterised -- measured at over two seconds --
  // behind a spinner reading INITIALIZING PADDLES, to illustrate a choice that no longer exists.
  await page.goto("/?seed=bounceworld-01");
  const started = Date.now();
  await page.waitForSelector('#briefing[data-render-state="ready"]', { timeout: 90_000 });
  const ready = Date.now() - started;
  expect(ready, `ready took ${ready}ms`).toBeLessThan(20_000);
  // Nothing built them, and nothing needed to.
  const arenas = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.deploymentPreviews.arenas.length);
  expect(arenas).toBe(0);
  await expect(page.locator("#deploymentLoader b")).not.toHaveText(/PADDLE/);
});

test("the save describes itself inside the button that loads it", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?seed=bounceworld-01");
  await page.waitForSelector('#briefing[data-render-state="ready"]', { timeout: 90_000 });
  await page.click("#newButton");
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const hook = (window as unknown as Win).__OREKENOID__;
    hook.game.economy.add("copper", 5);
    hook.game.saveNow?.();
  });
  await page.reload();
  await page.waitForSelector('#briefing[data-render-state="ready"]', { timeout: 90_000 });

  await expect(page.locator("#loadButton")).toBeEnabled();
  const detail = await page.locator("#loadDetail").textContent();
  expect(detail).toContain("BOUNCEWORLD-01");
  expect(detail).toContain("elapsed");
  expect(detail).toContain("deep");

  // And the cost of starting over is stated on the button, before it is pressed.
  await expect(page.locator("#newDetail")).toHaveText("Replaces the saved expedition");
  await expect(page.locator("#newButton")).toHaveClass(/hazard/);
});

test("cancelling the new-game warning keeps the expedition", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?seed=bounceworld-01");
  await page.waitForSelector('#briefing[data-render-state="ready"]', { timeout: 90_000 });
  await page.click("#newButton");
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const hook = (window as unknown as Win).__OREKENOID__;
    hook.game.economy.add("copper", 5);
    hook.game.saveNow?.();
  });
  await page.reload();
  await page.waitForSelector('#briefing[data-render-state="ready"]', { timeout: 90_000 });

  // Declining must leave the save alone *and* not deploy into a new expedition anyway.
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.click("#newButton");
  await page.waitForTimeout(500);
  await expect(page.locator("#briefing")).not.toHaveClass(/hidden/);
  await expect(page.locator("#loadButton")).toBeEnabled();
  await expect(page.locator("#loadDetail")).toContainText("BOUNCEWORLD-01");
});
