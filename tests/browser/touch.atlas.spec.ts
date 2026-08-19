// Getting out of the Atlas.
//
// The map is drawn above the touch controls, so the button that opens it is unreachable while it is
// open -- and the hint said "M closes" to a player holding a phone. Opening the Atlas was a one-way
// door on mobile.

import { expect, test } from "@playwright/test";

interface Win {
  __OREKENOID__: { game: any; state: any; view: any };
}

test("the Atlas can be opened and closed with a thumb", async ({ page }) => {
  await page.goto("/");
  await page.locator("#beginButton").tap();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.tutorialComplete = true;
    for (const step of game.tutorial) step.done = true;
  });

  // Touch the world so the interface knows which device it is talking to.
  const box = await page.locator("canvas.game-canvas").boundingBox();
  await page.touchscreen.tap(box!.x + box!.width * 0.3, box!.y + box!.height * 0.55);
  await page.waitForTimeout(200);

  await page.locator('[data-touch="atlas"]').tap();
  await expect(page.locator("#atlas")).toHaveClass(/open/);

  // The hint must not name a key on a device that has none.
  const hint = await page.locator("#atlasHint").innerText();
  expect(hint).not.toContain("M closes");

  // And there is a way out that does not need a keyboard.
  await page.locator("#atlasClose").tap();
  await expect(page.locator("#atlas")).not.toHaveClass(/open/);
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.atlasOpen)).toBe(false);

  await page.screenshot({ path: "phone-atlas.png" });
});

test("a notch pushes both the interface and the drawn layer clear of it", async ({ page }) => {
  await page.goto("/");
  await page.locator("#beginButton").tap();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.waitForTimeout(500);

  // Headless has no insets of its own, so the Dynamic Island is simulated by overriding the same
  // custom properties `env()` feeds. That is the whole reason the insets are read through CSS rather
  // than from `env()` in script: one source, and one place to fake it.
  const before = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    void game;
    // The objective, not `.hud-top` itself. The header is `inset: 0 0 auto`, so its safe-area padding
    // moves its children and leaves its own box at zero -- measuring the container proves nothing.
    const top = document.querySelector("#objectiveTitle")!.getBoundingClientRect().top;
    return { hudTop: top };
  });

  await page.evaluate(() => {
    // 59px is roughly what an iPhone with a Dynamic Island reports in portrait.
    document.documentElement.style.setProperty("--safe-top", "59px");
    // Nudge the layout so the game re-measures.
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    const top = document.querySelector("#objectiveTitle")!.getBoundingClientRect().top;
    return { safeTop: api.view.safe.top, hudTop: top };
  });

  // The interface moves down out of the island.
  expect(after.hudTop, "the HUD did not move clear of the notch").toBeGreaterThan(before.hudTop + 40);
  // And the drawn layer knows about it too, which is what keeps the board and the controls clear.
  expect(after.safeTop, "the drawn layer never saw the inset").toBeGreaterThanOrEqual(59);
});
