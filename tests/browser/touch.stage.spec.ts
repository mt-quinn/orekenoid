// The stage takes the shape of the phone.
//
// Runs under the `phone` project, which is an iPhone 13 profile with `hasTouch` and `isMobile` --
// so the coarse-pointer media query the layout classifier keys off is genuinely true, rather than
// a desktop browser pretending at a small window size.
//
// This is the floor the rest of the mobile work stands on: before any of it matters, the game has
// to occupy the screen. It used to occupy roughly a ninth of it.

import { expect, test } from "@playwright/test";

interface Win {
  __OREKENOID__: { game: any; state: any };
}

test("the stage fills a portrait phone rather than letterboxing into a strip", async ({ page }) => {
  await page.goto("/");

  const shell = page.locator(".shell");
  await expect(shell).toHaveAttribute("data-layout", "phone");
  await expect(shell).toHaveAttribute("data-orientation", "portrait");

  const screen = page.viewportSize();
  expect(screen).not.toBeNull();

  const stage = await page.locator(".viewport").boundingBox();
  expect(stage).not.toBeNull();

  // The old 16:9 lock resolved to about 378x213 on a 390-wide phone -- 11% of the screen. The
  // stage must now cover essentially all of it.
  const coverage = (stage!.width * stage!.height) / (screen!.width * screen!.height);
  expect(coverage, "the stage does not fill the phone screen").toBeGreaterThan(0.95);

  // And it must be genuinely portrait, not a wide stage cropped.
  expect(stage!.height).toBeGreaterThan(stage!.width);

  await page.screenshot({ path: "phone-deployment.png" });
});

test("the renderer is sized to the stage, not to a constant", async ({ page }) => {
  await page.goto("/");
  await page.locator(".paddle-option.surveyor").click();
  await page.locator("#beginButton").click();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.waitForTimeout(800);

  const sizes = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const box = document.querySelector(".viewport")!.getBoundingClientRect();
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.game-canvas")!;
    return {
      // Pixi v8 reports the renderer in CSS pixels; the canvas's own width attribute is the
      // device-pixel backing store, which is where the resolution shows up.
      stage: { width: game.app.renderer.width, height: game.app.renderer.height },
      backing: { width: canvas.width, height: canvas.height },
      resolution: game.app.renderer.resolution,
      css: { width: Math.round(box.width), height: Math.round(box.height) },
    };
  });

  // The stage is the shape of the phone. Pinned to 1280x720, both of these would be wildly off.
  expect(sizes.stage.width).toBeCloseTo(sizes.css.width, -1);
  expect(sizes.stage.height).toBeCloseTo(sizes.css.height, -1);
  expect(sizes.stage.height).toBeGreaterThan(sizes.stage.width);

  // Capped at 2: this profile is a 3x display, and rendering a full-screen WebGL scene at 3x costs
  // nine times the fill rate of 1x for a difference nobody sees on a 6" panel.
  expect(sizes.resolution).toBe(2);
  expect(sizes.backing.width).toBeCloseTo(sizes.css.width * 2, -1);

  await page.screenshot({ path: "phone-survey.png" });
});
