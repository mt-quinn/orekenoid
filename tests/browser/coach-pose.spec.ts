// Posed shots of the opening sequence's prompt, one per subject it can point at.
//
// The prompt is drawn in the world rather than in the DOM, so there is nothing to assert about it
// with a CSS selector and no way to eyeball it except to put the game in each state and look. This
// walks the sequence to each rung and captures it, and asserts the one thing that a screenshot
// cannot: that the tag is anchored on the right object.

import { expect, test } from "@playwright/test";

import { CELL } from "../../src/config";

interface Win {
  __OREKENOID__: {
    game: any;
    state: any;
  };
}

const start = async (page: any) => {
  await page.goto("/");
  await page.locator(".paddle-option.surveyor").click();
  await page.locator("#beginButton").click();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 15_000 });
  await page.waitForTimeout(600);
};

const prompt = (page: any) => page.evaluate(() => {
  const game = (window as unknown as Win).__OREKENOID__.game;
  const shown = game.coach.prompt;
  return shown && { goal: shown.goal, why: shown.why, keys: shown.keys, x: shown.x, y: shown.y, ring: shown.ring };
});

test("the opening prompt points at the thing it is talking about", async ({ page }) => {
  await start(page);

  // Rung one: the drone. The tag rides the machine, which is the whole reason it is drawn in the
  // world instead of pinned to the edge of the screen.
  const flying = await prompt(page);
  expect(flying.goal).toBe("FLY THE DRONE");
  const drone = await page.evaluate(() => {
    const player = (window as unknown as Win).__OREKENOID__.game.player;
    return { x: player.x, y: player.y };
  });
  expect(Math.hypot(flying.x - drone.x, flying.y - drone.y)).toBeLessThan(1);
  await page.screenshot({ path: "coach-fly.png" });

  // Move, turn, and read the Atlas to reach the commit rung. The Atlas is taught out here rather
  // than mid-claim, so the sequence never asks the player to leave a live board.
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(420);
  await page.keyboard.up("KeyD");
  await page.keyboard.down("KeyE");
  await page.waitForTimeout(360);
  await page.keyboard.up("KeyE");
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.game.coach.prompt?.goal === "OPEN THE ATLAS",
    null, { timeout: 6_000 },
  );
  await page.keyboard.press("KeyM");
  await page.waitForTimeout(300);
  await page.keyboard.press("KeyM");
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.game.coach.prompt?.goal === "COMMIT THE CLAIM",
    null, { timeout: 6_000 },
  );

  // Rung three points at the framed rock rather than at the machine: "commit the claim" is about
  // the rectangle out in front, and the drone is the wrong noun for it.
  const committing = await prompt(page);
  const droneNow = await page.evaluate(() => {
    const player = (window as unknown as Win).__OREKENOID__.game.player;
    return { x: player.x, y: player.y };
  });
  expect(Math.hypot(committing.x - droneNow.x, committing.y - droneNow.y)).toBeGreaterThan(20);
  expect(committing.ring).toBe(true);
  await page.screenshot({ path: "coach-commit.png" });

  // Into the claim. The paddle is taught before the serve, so the player is holding the thing they
  // control before anything is launched with it.
  await page.keyboard.press("KeyF");
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.state.mode === "play",
    null, { timeout: 20_000 },
  );
  await page.waitForTimeout(900);
  const paddling = await prompt(page);
  expect(paddling.goal).toBe("MOVE THE PADDLE");
  const paddle = await page.evaluate((cell) => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const point = game.world.localToWorld(game.arena.paddle.u, 0, game.arena);
    return { x: point.x * cell, y: point.y * cell };
  }, CELL);
  // Anchored on the paddle exactly. Pointing at the wrong object would miss by cells, not pixels.
  expect(Math.hypot(paddling.x - paddle.x, paddling.y - paddle.y)).toBeLessThan(2);
  await page.screenshot({ path: "coach-paddle.png" });
});
