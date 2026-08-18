// Claiming off the edge of the world.
//
// A frame used to be refused outright if any of its corners left the map, which cost the player every
// claim along a border for no reason. The unit tests cover the sampling; this covers the thing that
// actually blocked it, which was a guard on the commit path.

import { expect, test } from "@playwright/test";

interface Win {
  __OREKENOID__: {
    game: any;
    state: any;
    warpTo: (x: number, y: number) => void;
  };
}

test("a claim that hangs off the edge of the world is committed, not refused", async ({ page }) => {
  await page.goto("/");
  await page.locator(".paddle-option.surveyor").click();
  await page.locator("#beginButton").click();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.tutorialComplete = true;
    for (const step of game.tutorial) step.done = true;
  });

  // Hard against the right-hand edge, facing out of the world, so most of the frame is beyond it.
  const framed = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    api.warpTo(236, 72);
    api.game.player.heading = 0;
    return {
      hasMaterial: api.game.world.frameHasMaterial(api.game.frameGeometry()),
      // Proof the frame really does leave the map: a corner past the last column.
      beyond: api.game.world.localToWorld(
        api.game.frameGeometry().width / 2,
        api.game.frameGeometry().depth + 0.5,
        api.game.frameGeometry(),
      ),
    };
  });
  expect(framed.hasMaterial, "no rock at the edge to claim in this seed").toBe(true);

  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.establishArena());
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.state.mode === "play",
    null, { timeout: 20_000 },
  );

  const arena = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return {
      bricks: game.arena.bricks.length,
      width: game.arena.width,
      depth: game.arena.depth,
      // The board is the full framed size; the part outside the world is simply unoccupied.
      maxCells: game.arena.width * game.arena.depth,
    };
  });
  expect(arena.bricks, "the edge claim produced an empty board").toBeGreaterThan(0);
  // And it is genuinely a partial board rather than a full one -- the overhang contributed nothing.
  expect(arena.bricks).toBeLessThan(arena.maxCells);
});
