// The Refit Bay on a phone.
//
// The gantry is a diagram laid out against a 16:9 field, with six small absolute-positioned hit
// areas on it. Scaled onto a 390px screen it is neither readable nor hittable, so touch gets the same
// six stations as a list. The desktop path is untouched -- that is asserted here too, because the
// easiest way to get this wrong is to replace the gantry instead of adding a second view of it.

import { expect, test } from "@playwright/test";

interface Win {
  __OREKENOID__: { game: any; state: any; bayModel: () => any };
}

const dock = async (page: any) => {
  await page.goto("/");
  await page.locator(".paddle-option.surveyor").tap();
  await page.locator("#beginButton").tap();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.tutorialComplete = true;
    for (const step of game.tutorial) step.done = true;
    // Enough banked to actually afford something, so the fit path is exercised rather than only
    // the refusal path.
    game.economy.add("copper", 40);
    game.economy.add("coal", 30);
    game.economy.deposit();
  });
  // Touch the world so the interface knows which device it is talking to -- as a *drag*, not a tap.
  // Out in the survey a tap commits a claim, which would put the game in a mode where the forge
  // button does nothing and make this look like the bay failing to open.
  const box = await page.locator("canvas.game-canvas").boundingBox();
  await page.evaluate(({ x, y }: { x: number; y: number }) => {
    const canvas = document.querySelector("canvas.game-canvas")!;
    const send = (type: string, cx: number, cy: number) => canvas.dispatchEvent(
      new PointerEvent(type, { pointerId: 21, pointerType: "touch", clientX: cx, clientY: cy, bubbles: true }),
    );
    send("pointerdown", x, y);
    for (let step = 1; step <= 4; step++) send("pointermove", x + step * 9, y);
    send("pointerup", x + 36, y);
  }, { x: box!.x + box!.width * 0.3, y: box!.y + box!.height * 0.55 });
  await page.waitForTimeout(250);
};

test("the bay is a list on a phone, and every station is reachable", async ({ page }) => {
  await dock(page);

  await page.locator('[data-touch="forge"]').tap();
  await expect(page.locator("#bay")).toBeVisible();
  // The drawn gantry must not also be up: it dims the world behind it, and a list over a blacked-out
  // mine is the worst of both.
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.bayModel().open)).toBe(false);

  // All six stations present, not a scrollable subset of them.
  await expect(page.locator(".bay-card")).toHaveCount(6);

  // Every control clears a thumb.
  for (const selector of ["#bayClose", ".bay-card button"]) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box!.height, `${selector} is under 44px`).toBeGreaterThanOrEqual(44);
  }

  await page.screenshot({ path: "phone-bay.png" });
});

test("fitting from the list actually upgrades the machine", async ({ page }) => {
  await dock(page);
  await page.locator('[data-touch="forge"]').tap();
  await expect(page.locator("#bay")).toBeVisible();

  const before = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return { armor: game.soakCapacity, grades: JSON.stringify(game.economy.stationGrades(game.chassis.id)) };
  });

  // The first station the player can actually afford.
  const affordable = page.locator(".bay-card button:not([disabled])").first();
  await expect(affordable).toBeVisible();
  await affordable.tap();
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return { grades: JSON.stringify(game.economy.stationGrades(game.chassis.id)) };
  });
  expect(after.grades, "fitting from the list changed nothing").not.toBe(before.grades);
});

test("the bay closes without a keyboard", async ({ page }) => {
  await dock(page);
  await page.locator('[data-touch="forge"]').tap();
  await expect(page.locator("#bay")).toBeVisible();

  await page.locator("#bayClose").tap();
  await expect(page.locator("#bay")).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.craftingOpen)).toBe(false);
});
