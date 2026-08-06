// The pause panel on a phone.
//
// A different problem from the desktop panel: one column, the touch control reference rather than
// the keyboard one, no room for the stencilled ESC plate, and every target has to clear a thumb.

import { expect, test } from "@playwright/test";

interface Win {
  __OREKENOID__: { game: any; state: any };
}

test("the pause panel fills a phone and lists gestures, not keys", async ({ page }) => {
  await page.goto("/");
  await page.locator(".paddle-option.surveyor").tap();
  await page.locator("#beginButton").tap();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.tutorialComplete = true;
    for (const step of game.tutorial) step.done = true;
  });

  // Touch the canvas so the panel knows which device it is talking to.
  const box = await page.locator("canvas.game-canvas").boundingBox();
  await page.touchscreen.tap(box!.x + box!.width * 0.3, box!.y + box!.height * 0.55);
  await page.waitForTimeout(200);

  await page.locator('[data-touch="pause"]').tap();
  await expect(page.locator(".pause")).toHaveClass(/open/);
  await page.waitForTimeout(400);

  // Gestures, not keys.
  const body = await page.locator("#pauseBody").innerText();
  expect(body).toContain("DRAG");
  expect(body).not.toContain("WASD");

  // Every action clears a thumb.
  for (const selector of ['[data-act="resume"]', '[data-act="save"]', '[data-act="export"]']) {
    const target = await page.locator(selector).boundingBox();
    expect(target!.height, `${selector} is under 44px`).toBeGreaterThanOrEqual(44);
  }

  await page.screenshot({ path: "phone-pause.png" });
});
