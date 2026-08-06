// Posed shots of the pause panel, in both of its states and on both devices.
//
// This one is judged by eye rather than by assertion, so the spec's job is to reliably reach each
// state and capture it.

import { expect, test } from "@playwright/test";

interface Win {
  __OREKENOID__: { game: any; state: any };
}

const deploy = async (page: any) => {
  await page.goto("/");
  await page.locator(".paddle-option.surveyor").click();
  await page.locator("#beginButton").click();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 20_000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.tutorialComplete = true;
    for (const step of game.tutorial) step.done = true;
  });
};

test("the pause panel, out in the mine and inside a claim", async ({ page }) => {
  await deploy(page);

  // Out in the mine: no claim, so no hazard panel.
  await page.keyboard.press("Escape");
  await expect(page.locator(".pause")).toHaveClass(/open/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "pause-survey.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // In a claim: the hazard panel appears, carrying the real cost.
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.establishArena());
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.game.camera.transition === null,
    null, { timeout: 25_000 },
  );
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "pause-claim.png" });

  // And the confirmation, which is where the toll is spelled out.
  await page.locator('button[data-act="end"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "pause-confirm.png" });
});
