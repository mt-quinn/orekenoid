import { expect, test } from "@playwright/test";

/**
 * Pausing, ending a claim, and the salvage drone.
 *
 * The pause has to be a real one -- the simulation stopped, not the interface hidden -- so this
 * asserts that the ball has not moved across it, which is the only thing that actually proves it.
 */

type Win = Window & typeof globalThis & { __OREKENOID__: any };

async function intoClaim(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.locator(".paddle-option").first().click();
  await page.click("#beginButton");
  await page.waitForTimeout(900);
  // Straight past the opening sequence: it has its own coverage, and every control being gated
  // would otherwise have to be walked through here as well.
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.tutorialComplete = true;
    for (const step of game.tutorial) step.done = true;
  });
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.warpTo(16, 16));
  await page.waitForTimeout(400);
  await page.keyboard.press("KeyF");
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__.state.arena),
    null, { timeout: 10_000 });
  // Committing flies the camera into the claim, and keys other than pause are ignored while it
  // does. Waiting for it is the difference between serving and silently dropping the keypress.
  await page.waitForFunction(() => !(window as unknown as Win).__OREKENOID__.state.cameraTransition,
    null, { timeout: 15_000 });
  await page.keyboard.press("Space");
  await page.waitForFunction(() => (window as unknown as Win).__OREKENOID__.state.arena
    .balls.some((ball: any) => ball.served), null, { timeout: 10_000 });
  await page.waitForTimeout(200);
}

test("pause stops the simulation, and resuming counts back in", async ({ page }) => {
  test.setTimeout(160_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await intoClaim(page);

  await page.keyboard.press("Escape");
  await expect(page.locator("#pause")).toHaveClass(/open/);
  const paused = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.paused);
  expect(paused).toBe(true);

  // The proof: a live ball does not move while paused. Hiding the UI would pass a screenshot test
  // and fail this one.
  const before = await page.evaluate(() => {
    const ball = (window as unknown as Win).__OREKENOID__.state.arena.balls[0];
    return { u: ball.u, v: ball.v };
  });
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => {
    const ball = (window as unknown as Win).__OREKENOID__.state.arena.balls[0];
    return { u: ball.u, v: ball.v };
  });
  expect(after).toEqual(before);

  // The menu is a controls reference and a set of session actions.
  await expect(page.locator("#pauseBody .pause-group")).toHaveCount(3);
  await expect(page.locator('#pauseBody button[data-act="save"]')).toBeVisible();
  await expect(page.locator('#pauseBody button[data-act="export"]')).toBeVisible();
  await expect(page.locator('#pauseBody button[data-act="import"]')).toBeVisible();

  // Resuming runs a countdown rather than dropping the player onto a live ball.
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause")).not.toHaveClass(/open/);
  const counting = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.resumeCountdown);
  expect(counting).toBeGreaterThan(0);
  // And nothing steps during it.
  const held = await page.evaluate(() => {
    const ball = (window as unknown as Win).__OREKENOID__.state.arena.balls[0];
    return { u: ball.u, v: ball.v };
  });
  expect(held).toEqual(before);
  await expect(page.locator("#countdown")).toHaveClass(/show/);

  // Then it does resume.
  await page.waitForFunction(() => (window as unknown as Win).__OREKENOID__.game.resumeCountdown === 0,
    null, { timeout: 10_000 });
  await page.waitForTimeout(300);
  const moving = await page.evaluate(() => {
    const ball = (window as unknown as Win).__OREKENOID__.state.arena.balls[0];
    return { u: ball.u, v: ball.v };
  });
  expect(moving).not.toEqual(before);
  expect(errors).toEqual([]);
});

test("ending a claim states the cost first, and declining keeps the claim", async ({ page }) => {
  test.setTimeout(160_000);
  await intoClaim(page);
  await page.keyboard.press("Escape");

  // The offer names the price rather than asking "are you sure?".
  const end = page.locator('#pauseBody button[data-act="end"]');
  await expect(end).toBeVisible();
  await expect(end).toContainText(/DAMAGE|FREE/);
  await end.click();

  // Confirming is a second, informed press, and the exact figure is on screen.
  await expect(page.locator("#pauseBody .pause-confirm")).toBeVisible();
  await expect(page.locator('#pauseBody button[data-act="endConfirm"]')).toBeVisible();

  // Declining returns the claim, through the same countdown.
  await page.locator('#pauseBody button[data-act="endCancel"]').click();
  await expect(page.locator("#pauseBody .pause-confirm")).toHaveCount(0);
  // A boolean, not the arena: the object graph reaches back into the renderer and cannot cross the
  // evaluate boundary.
  expect(await page.evaluate(() =>
    Boolean((window as unknown as Win).__OREKENOID__.state.arena))).toBe(true);

  // Now actually end it. It resolves exactly as a loss does, so standing material loads the hull.
  await page.locator('#pauseBody button[data-act="end"]').click();
  const cost = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    return { before: api.state.integrity, projected: api.state.projectedDamage };
  });
  await page.locator('#pauseBody button[data-act="endConfirm"]').click();
  await page.waitForTimeout(500);
  const ended = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    return { integrity: api.state.integrity, resolving: api.state.arena?.resolving ?? true, paused: api.game.paused };
  });
  expect(ended.paused).toBe(false);
  expect(ended.resolving).toBe(true);
  if (cost.projected > 0) expect(ended.integrity).toBeLessThan(cost.before);
});

test("the salvage drone rescues what the paddle misses, and keeps its share", async ({ page }) => {
  test.setTimeout(160_000);
  await intoClaim(page);
  const result = await page.evaluate(async () => {
    const api = (window as unknown as Win).__OREKENOID__;
    const game = api.game;
    // Fit the drone, then hand it drops the paddle cannot reach and count what survives.
    for (const resource of ["copper", "coal"]) api.giveResource(resource, 90);
    api.bankAll();
    api.fitStation("salvage", 1);
    const arena = game.arena;
    const before = game.economy.carriedTotal;
    const pieces = 20;
    for (let index = 0; index < pieces; index++) {
      arena.drops.push({
        u: arena.paddle.u + (index % 2 ? 40 : -40), v: 0.4, vv: -1,
        spin: 0, resource: "copper",
        display: { destroy() {}, position: { set() {} }, rotation: 0 },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    return { tax: game.salvageTax, gained: game.economy.carriedTotal - before, pieces };
  });
  // A grade-one drone keeps half, so half the pieces the paddle missed still arrive.
  expect(result.tax).toBe(0.5);
  expect(result.gained).toBe(result.pieces / 2);
});
