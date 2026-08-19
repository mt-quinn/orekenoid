import { expect, test } from "@playwright/test";

type Win = Window & typeof globalThis & { __OREKENOID__: any };

async function deploy(page: import("@playwright/test").Page) {
  await page.goto("/?seed=bounceworld-01");
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.click("#newButton");
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const hook = (window as unknown as Win).__OREKENOID__;
    hook.setSpawning(false);
    hook.game.tutorialComplete = true;
    for (const step of hook.game.tutorial) step.done = true;
  });
}

test("a rebound key moves the drone and the old one stops", async ({ page }) => {
  test.setTimeout(180_000);
  await deploy(page);
  // Fly right on the default binding.
  const before = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.player.x);
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(350);
  await page.keyboard.up("KeyD");
  const onDefault = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.player.x);
  expect(onDefault, "the default binding did not move the drone").toBeGreaterThan(before + 5);

  // Move "fly right" onto L.
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.bindings.bind("moveRight", "KeyL"));

  // The old key is now inert.
  const atRebind = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.player.x);
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(350);
  await page.keyboard.up("KeyD");
  const afterOldKey = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.player.x);
  expect(Math.abs(afterOldKey - atRebind), "the old key still moved the drone").toBeLessThan(3);

  // And the new one works.
  await page.keyboard.down("KeyL");
  await page.waitForTimeout(350);
  await page.keyboard.up("KeyL");
  const afterNewKey = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.player.x);
  expect(afterNewKey, "the rebound key did not move the drone").toBeGreaterThan(afterOldKey + 5);
});

test("the prompt teaches whatever the key is bound to now", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?seed=bounceworld-01");
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.click("#newButton");
  await page.waitForTimeout(1500);
  // The opening rung teaches flight, so its hint has to name the flight keys.
  const before = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.coach.prompt?.keys ?? "");
  expect(before).toContain("W");

  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.bindings.bind("moveUp", "KeyI");
    game.renderTutorial?.();
  });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.coach.prompt?.keys ?? "");
  // Two lists of the same facts is one too many: the prompt is composed from the bindings, so it moved.
  expect(after, "the prompt still names the old key").toContain("I");
});

test("a rebind survives a reload", async ({ page }) => {
  test.setTimeout(180_000);
  await deploy(page);
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.bindings.bind("atlas", "KeyN"));
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  const codes = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.bindings.codesFor("atlas"));
  expect(codes).toEqual(["KeyN"]);
});

test("Escape cannot be bound away from backing out", async ({ page }) => {
  test.setTimeout(180_000);
  await deploy(page);
  const result = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.bindings.bind("serve", "Escape"));
  expect(result.ok).toBe(false);
  const codes = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.bindings.codesFor("serve"));
  expect(codes).toEqual(["Space"]);
});

test("the pause panel lists the keys and rebinds one from a click", async ({ page }) => {
  test.setTimeout(180_000);
  await deploy(page);
  // Escape is the pause path the panel itself advertises, and is deliberately not bindable.
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause")).toHaveClass(/open/);
  const row = page.locator('.pause-rebind button[data-bind="atlas"]');
  await expect(row).toHaveText(/M/);
  await row.click();
  await expect(row).toHaveText(/PRESS A KEY/);
  await page.keyboard.press("KeyJ");
  await expect(page.locator('.pause-rebind button[data-bind="atlas"]')).toHaveText(/J/);
  const codes = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.bindings.codesFor("atlas"));
  expect(codes).toEqual(["KeyJ"]);
});
