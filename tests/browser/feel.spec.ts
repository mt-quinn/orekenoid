// Feedback that exists, and does not run away with itself.
//
// The two failure modes this pass is guarding against are both invisible to a screenshot: an effect
// that never fires, and an effect that fires every frame. So this drives the game into each state and
// counts what comes out of the effects layer.

import { expect, test } from "@playwright/test";

interface Win {
  __OREKENOID__: { game: any; state: any };
}

const deploy = async (page: any) => {
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
};

test("being refused produces a reaction, and grinding does not hammer", async ({ page }) => {
  await deploy(page);

  // Driven through `reportContact` directly rather than by flying the drone at generated rock.
  //
  // Two earlier versions of this test did it the scenic way and both measured the wrong thing: the
  // drone travels about 55px a second, so a wall found three hundred pixels away is simply not
  // reachable inside a test window, and the run reported "no reaction" when the truth was "never
  // arrived". The wiring from `hullFits` to here is three lines and visible in review; what is worth
  // pinning down is the behaviour that actually regressed once before -- that a sustained refusal is
  // a texture and not one impact per frame.
  const result = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const before = game.effects.count;
    // Arrive at the wall, then lean on it for a second of frames.
    game.reportContact(1 / 60, 1, 0, false, 0);
    const afterFirst = game.effects.count;
    for (let frame = 0; frame < 60; frame++) game.reportContact(1 / 60, 1, 0, false, 0);
    const afterGrind = game.effects.count;
    // Let go, then touch it again: a fresh arrival must read as an arrival.
    game.reportContact(1 / 60, 0, 0, false, 0);
    const clear = game.contactHeld;
    game.reportContact(1 / 60, 1, 0, false, 0);
    return {
      first: afterFirst - before,
      grind: afterGrind - afterFirst,
      clear,
      held: game.contactHeld,
      secondArrival: game.effects.count - afterGrind,
    };
  });

  // First contact is an event: a silent refusal is indistinguishable from dropped input.
  expect(result.first, "being refused produced no feedback at all").toBeGreaterThan(0);
  // A second of leaning on it is a texture. Ungated this would be sixty bursts of three particles;
  // at a 0.16s gate it is about six bursts of two.
  expect(result.grind, "grinding a wall is firing an impact every frame").toBeLessThan(30);
  expect(result.grind, "grinding a wall produced nothing at all").toBeGreaterThan(0);
  // Coming off the rock re-arms, so the next touch is a knock rather than more grinding.
  expect(result.clear, "letting go did not clear the contact").toBe(0);
  expect(result.secondArrival, "a fresh arrival did not read as an arrival").toBeGreaterThan(0);
});

test("catching ore shows something, and a run escalates without running away", async ({ page }) => {
  await deploy(page);
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.establishArena());
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.game.camera.transition === null,
    null, { timeout: 25_000 },
  );

  // Serve first. Drops do not move until a ball is live -- `stepArena` returns before the drop loop
  // while the ball is still docked -- so an unserved claim would hold the ore in mid-air forever.
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.serve());
  await page.waitForTimeout(200);

  // Break a resource brick through the game's own contact path rather than hand-building a drop: a
  // fake one would not exercise the display the catch effects read from.
  const dropped = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const arena = game.arena;
    const ore = arena.bricks.find((brick: any) => brick.alive && brick.resource);
    if (!ore) return 0;
    arena.paddle.u = ore.u;
    for (let blow = 0; blow < 8 && ore.alive; blow++) game.hitBrick(ore, arena.balls[0]);
    // Brought down to the paddle's row: the fall is not what this test is about, and ore shed from
    // the top of a deep board would outlast the timeout.
    for (const drop of arena.drops) { drop.u = arena.paddle.u; drop.v = 0.6; drop.vv = -0.3; }
    return arena.drops.length;
  });
  expect(dropped, "no resource brick was available to break").toBeGreaterThan(0);

  // The catch used to be one sound and no picture at all. Asserted through the pulse rather than a
  // particle count, because settled debris is swept when a claim is framed -- `effects.count` is not
  // monotonic, so differencing it across a window proves nothing.
  await page.waitForFunction(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return (game.arena?.collected ?? 0) > 0;
  }, null, { timeout: 8_000 });

  const after = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return { collected: game.arena.collected, pulse: game.cargoPulse.value };
  });
  expect(after.collected).toBeGreaterThan(0);
  expect(after.pulse, "catching ore produced no reaction").toBeGreaterThan(0);
});

test("the cargo readout answers a catch, and the health bar answers being nearly dead", async ({ page }) => {
  await deploy(page);

  // The readout punches on a catch rather than quietly incrementing in a corner.
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.cargoPulse.hit(1);
    game.updateUI();
  });
  await expect(page.locator("#cargo")).toHaveClass(/caught/);

  // And it lets go again, rather than latching lit.
  await page.waitForTimeout(700);
  await expect(page.locator("#cargo")).not.toHaveClass(/caught/);

  // Low health reads on the bar the player is already looking at, not as a screen vignette.
  //
  // The drone has to be moved off the Refit Bay first: docking services the machine every frame it
  // is in range, so wounding it while parked at home is undone before the next render. That is
  // correct behaviour and a trap for any test that wants a damaged hull.
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.player.x += 60 * 42;
    game.integrity = Math.max(1, Math.round(game.maxIntegrity * 0.15));
    game.updateUI();
  });
  await expect(page.locator("#integrityStat")).toHaveAttribute("data-state", "critical");
});

test("a cleared board waits for ore still in the air", async ({ page }) => {
  await deploy(page);
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.establishArena());
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.game.camera.transition === null,
    null, { timeout: 25_000 },
  );
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.serve());
  await page.waitForTimeout(200);

  // Clear the board but leave one piece of ore high above the paddle. Resolving here would take the
  // player's payout away mid-fall, which reads as the game snatching back what it just gave.
  const staged = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const arena = game.arena;
    const ore = arena.bricks.find((brick: any) => brick.alive && brick.resource);
    if (!ore) return { ok: false, drops: 0 };
    arena.paddle.u = ore.u;
    for (let blow = 0; blow < 8 && ore.alive; blow++) game.hitBrick(ore, arena.balls[0]);
    // Everything else gone, and the drop parked high with no downward speed yet.
    for (const brick of arena.bricks) {
      if (brick.alive && !brick.persistent) { brick.alive = false; brick.display?.destroy({ children: true }); }
    }
    for (const drop of arena.drops) { drop.u = arena.paddle.u; drop.v = 7; drop.vv = 0; }
    return { ok: true, drops: arena.drops.length };
  });
  expect(staged.ok, "no resource brick to stage the fall with").toBe(true);
  expect(staged.drops).toBeGreaterThan(0);

  // Still in the claim a beat later, with the ore still falling.
  await page.waitForTimeout(500);
  const midFall = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    return { mode: api.state.mode, drops: api.game.arena?.drops.length ?? 0 };
  });
  expect(midFall.mode, "the claim resolved while ore was still in the air").toBe("play");
  expect(midFall.drops).toBeGreaterThan(0);

  // And once it lands, the claim finishes on its own.
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.state.mode === "survey",
    null, { timeout: 25_000 },
  );
});
