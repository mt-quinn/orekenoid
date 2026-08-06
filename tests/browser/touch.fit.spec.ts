// The board fits on the screen.
//
// Sounds obvious; was not true. There was no camera zoom at all before the mobile work, so a board
// was drawn at CELL = 42 whatever the stage was -- which overflowed a 720px desktop stage for deep
// frames and overflows a phone for every frame. This is the assertion that keeps it fixed, and it
// is written against the *rendered bounds* rather than against the zoom arithmetic, because the
// arithmetic agreeing with itself is exactly the failure mode.

import { expect, test } from "@playwright/test";

interface Win {
  __OREKENOID__: { game: any; state: any };
}

test("a committed board sits inside the stage with room for the thumbs", async ({ page }) => {
  await page.goto("/");
  await page.locator(".paddle-option.surveyor").tap();
  await page.locator("#beginButton").tap();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 20_000 });
  await page.waitForTimeout(700);

  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.tutorialComplete = true;
    for (const step of game.tutorial) step.done = true;
    game.establishArena();
  });
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.state.mode === "play",
    null, { timeout: 25_000 },
  );
  // Wait for the transition to actually end rather than for a duration. The commit move carries
  // the zoom, and sampling part-way through measures a board that is still being framed.
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.game.camera.transition === null,
    null, { timeout: 20_000 },
  );
  await page.waitForTimeout(300);

  const fit = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const arena = game.arena;
    // `getBounds()` reports the board in its own world units, *not* in stage pixels -- it does not
    // carry the camera's scale. Converting here rather than trusting the raw numbers: reading them
    // as screen pixels is what made a board that fits look like a board that overflowed.
    const bounds = arena.board.getBounds();
    // The unarguable measure: where the outermost bricks actually land on the stage. Container
    // bounds proved misleading -- they are reported in the board's own units and do not carry the
    // camera scale, so reading them as screen pixels flatters a board that overflows.
    let left = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const brick of arena.bricks) {
      if (!brick.display) continue;
      const at = brick.display.getGlobalPosition();
      left = Math.min(left, at.x);
      right = Math.max(right, at.x);
      bottom = Math.max(bottom, at.y);
    }
    return {
      zoom: game.camera.zoom,
      cells: { width: arena.width, depth: arena.depth },
      board: { left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height },
      stage: { width: game.app.renderer.width, height: game.app.renderer.height },
      angle: arena.angle,
      bricks: { left, right, bottom },
    };
  });

  // Half a cell of slack, since the measurement is to brick centres.
  const halfCell = 21 * fit.zoom;

  expect(
    fit.bricks.left - halfCell,
    `bricks run off the left edge (zoom ${fit.zoom.toFixed(3)})`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    fit.bricks.right + halfCell,
    `bricks run off the right edge (zoom ${fit.zoom.toFixed(3)}, ${fit.cells.width} cells)`,
  ).toBeLessThanOrEqual(fit.stage.width);

  // Room left below the board for the paddle and the hand holding it. This is the whole reason the
  // fit margins are asymmetric -- a board drawn to the bottom of the screen puts the contact point
  // under the player's own thumb.
  expect(
    fit.stage.height - fit.bricks.bottom,
    "no room left below the board for the paddle and the thumb",
  ).toBeGreaterThan(200);

  // And not so far out that the claim becomes a postage stamp.
  expect(
    (fit.bricks.right - fit.bricks.left) / fit.stage.width,
    "the board is shrunk further than it needs to be",
  ).toBeGreaterThan(0.55);
});
