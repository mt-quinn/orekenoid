import { expect, test } from "@playwright/test";

/**
 * Cavern combat, in the real renderer.
 *
 * The unit tests prove the solver and the state machine in isolation. What they cannot prove is
 * that the two are wired to the same world the player is standing in -- that a ball fired from the
 * drone's nose actually travels through the terrain the chunks drew, that it reaches a creature,
 * and that a creature reaches the hull. That is what this covers.
 */

type Win = Window & typeof globalThis & { __OREKENOID__: any };

/** Boot, take a chassis, skip the opening sequence, and stand in open ground. */
async function intoCaverns(page: import("@playwright/test").Page): Promise<{ x: number; y: number }> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 30_000 });
  await page.locator(".paddle-option").first().click();
  await page.click("#beginButton");
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.tutorialComplete = true;
    for (const step of game.tutorial) step.done = true;
  });

  // A clearing with room to the east, because the drone fires along its heading and the test wants
  // a lane rather than a wall two cells away.
  const spot = await page.evaluate(() => {
    const hook = (window as unknown as Win).__OREKENOID__;
    const world = hook.world;
    const clear = (x: number, y: number) => {
      for (let dy = -1.2; dy <= 1.2; dy += 0.4) {
        for (let dx = -1.2; dx <= 1.2; dx += 0.4) if (world.solidAt(x + dx, y + dy)) return false;
      }
      return true;
    };
    for (let y = 8; y < 130; y += 1) {
      for (let x = 8; x < 220; x += 1) {
        if (!clear(x, y)) continue;
        // Ten cells of open lane due east.
        let open = true;
        for (let step = 1; step <= 10 && open; step++) if (!clear(x + step, y)) open = false;
        if (open) return { x, y };
      }
    }
    return null;
  });
  expect(spot, "the world should contain one ten-cell open lane").not.toBeNull();

  await page.evaluate(({ x, y }) => {
    const hook = (window as unknown as Win).__OREKENOID__;
    hook.warpTo(x, y);
    // Heading is measured from the frame's forward axis, so this points the nose due east and the
    // ball leaves along +x.
    hook.game.player.heading = Math.PI / 2;
  }, spot!);
  await page.waitForTimeout(300);
  return spot!;
}

/** The creature the test placed, found by where it was put rather than by index. */
async function trackedCreature(page: import("@playwright/test").Page, near: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const creatures = (window as unknown as Win).__OREKENOID__.state.combat.creatures;
    let best: any = null;
    for (const creature of creatures) {
      const distance = Math.hypot(creature.x - x, creature.y - y);
      if (distance < 12 && (!best || distance < best.distance)) best = { ...creature, distance };
    }
    return best;
  }, near);
}

test("a ball fired into the caverns travels, and kills what it hits", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const spot = await intoCaverns(page);

  // Placed down the lane, far enough that the ball has to actually travel to reach it.
  const target = { x: spot.x + 6, y: spot.y };
  await page.evaluate((at) => (window as unknown as Win).__OREKENOID__.spawnCreature(at.x, at.y, Math.PI), target);
  expect(await trackedCreature(page, target)).not.toBeNull();

  await page.keyboard.press("Space");
  await page.waitForFunction(() => (window as unknown as Win).__OREKENOID__.state.combat.balls > 0,
    null, { timeout: 5_000 });

  // Three hits kill a Grinder. The ball rebounds off it and comes back through the lane, so this
  // usually lands without further input -- fire again whenever the emitter is free.
  await page.waitForFunction(() => {
    const hook = (window as unknown as Win).__OREKENOID__;
    const near = hook.state.combat.creatures;
    return near.length === 0 || near.every((creature: any) => creature.state === "dead");
  }, null, { timeout: 20_000 }).catch(() => undefined);

  for (let attempt = 0; attempt < 12; attempt++) {
    const creature = await trackedCreature(page, target);
    if (!creature || creature.state === "dead") break;
    await page.keyboard.press("Space");
    await page.waitForTimeout(1200);
  }

  const after = await trackedCreature(page, target);
  expect(after === null || after.state === "dead", "the Grinder should be dead").toBe(true);
  expect(errors).toEqual([]);
});

test("a Grinder that reaches the drone costs it health", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const spot = await intoCaverns(page);
  const before = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.integrity);

  // Placed in the lane and left to it: the drone does not move, which is precisely what a Grinder
  // exists to punish.
  await page.evaluate((at) => (window as unknown as Win).__OREKENOID__.spawnCreature(at.x, at.y, Math.PI),
    { x: spot.x + 5, y: spot.y });

  await page.waitForFunction((was) => (window as unknown as Win).__OREKENOID__.state.integrity < was,
    before, { timeout: 20_000 });
  const after = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.integrity);
  expect(after).toBeLessThan(before);
  expect(errors).toEqual([]);
});

test("the emitter takes its ball back when a claim begins", async ({ page }) => {
  test.setTimeout(120_000);
  await intoCaverns(page);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => (window as unknown as Win).__OREKENOID__.state.combat.balls > 0,
    null, { timeout: 5_000 });
  await page.keyboard.press("KeyF");
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__.state.arena),
    null, { timeout: 10_000 });
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.combat.balls)).toBe(0);
});

test("the emitter reads out fire, recall and recharge", async ({ page }) => {
  test.setTimeout(120_000);
  await intoCaverns(page);
  const readout = page.locator("#emitterStat");
  await expect(readout).toHaveAttribute("data-state", "ready");

  await page.keyboard.press("Space");
  await page.waitForFunction(() => (window as unknown as Win).__OREKENOID__.state.combat.balls > 0,
    null, { timeout: 5_000 });
  await expect(readout).toHaveAttribute("data-state", "out");

  // Recall takes the ball back and pays the full recharge for it, which is what makes taking a
  // wasted shot back a decision rather than a free undo.
  await page.keyboard.press("KeyR");
  await page.waitForFunction(() => (window as unknown as Win).__OREKENOID__.state.combat.balls === 0,
    null, { timeout: 5_000 });
  await expect(readout).toHaveAttribute("data-state", "charging");
  // Firing during the recharge is refused rather than queued.
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.combat.balls)).toBe(0);

  await expect(readout).toHaveAttribute("data-state", "ready", { timeout: 10_000 });
  await page.keyboard.press("Space");
  await page.waitForFunction(() => (window as unknown as Win).__OREKENOID__.state.combat.balls > 0,
    null, { timeout: 5_000 });
});

test("the emitter readout is a caverns-only instrument", async ({ page }) => {
  test.setTimeout(120_000);
  await intoCaverns(page);
  await expect(page.locator("#emitterStat")).toBeVisible();
  await page.keyboard.press("KeyF");
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__.state.arena),
    null, { timeout: 10_000 });
  // Inside a claim the ball belongs to the claim, and the BALLS pips already say how many are left.
  await expect(page.locator("#emitterStat")).toBeHidden();
});

test("a Spitter holds its range and its globs cost the hull", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const spot = await intoCaverns(page);
  const before = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.integrity);
  await page.evaluate((at) => (window as unknown as Win).__OREKENOID__.spawnCreature(at.x, at.y, Math.PI, "spitter"),
    { x: spot.x + 8, y: spot.y });

  await page.waitForFunction((was) => (window as unknown as Win).__OREKENOID__.state.integrity < was,
    before, { timeout: 25_000 });
  // It never closed to contact: the damage came from a glob crossing the room, not from a ram.
  const creature = await trackedCreature(page, { x: spot.x + 8, y: spot.y });
  expect(creature).not.toBeNull();
  expect(Math.hypot(creature.x - spot.x, creature.y - spot.y)).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test("a Douser puts the lamp out, and the ball gives it back", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const spot = await intoCaverns(page);
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.combat.lamp)).toBe(1);

  await page.evaluate((at) => (window as unknown as Win).__OREKENOID__.spawnCreature(at.x, at.y, Math.PI, "douser"),
    { x: spot.x + 5, y: spot.y });
  // The lamp goes down while it is on the hull. This is the whole creature.
  await page.waitForFunction(() => (window as unknown as Win).__OREKENOID__.state.combat.lamp < 0.5,
    null, { timeout: 25_000 });

  // Shake it off. It is sitting on the drone, so this is the ball coming back into the machine.
  await page.evaluate(() => {
    for (const creature of (window as unknown as Win).__OREKENOID__.game.combat.roster) {
      if (creature.kind === "douser") creature.hp = 0, creature.state = "dead";
    }
  });
  await page.waitForFunction(() => (window as unknown as Win).__OREKENOID__.state.combat.lamp > 0.9,
    null, { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("a creature is drawn if and only if the drone can see it", async ({ page }) => {
  test.setTimeout(120_000);
  await intoCaverns(page);

  // Somewhere robustly out of sight: the whole disc around it, not just its centre, so a creature
  // that shuffles a cell while settling does not wander over the shadow boundary and make the test
  // about the boundary instead of about the rule.
  const hidden = await page.evaluate(() => {
    const hook = (window as unknown as Win).__OREKENOID__;
    const world = hook.world;
    const drone = { x: hook.game.player.x / 42, y: hook.game.player.y / 42 };
    const sees = (x: number, y: number) => {
      for (let t = 0; t <= 1; t += 0.01) {
        if (world.solidAt(drone.x + (x - drone.x) * t, drone.y + (y - drone.y) * t)) return false;
      }
      return true;
    };
    for (let radius = 5; radius < 24; radius += 0.5) {
      for (let step = 0; step < 96; step++) {
        const angle = (step / 96) * Math.PI * 2;
        const x = drone.x + Math.cos(angle) * radius;
        const y = drone.y + Math.sin(angle) * radius;
        if (world.solidAt(x, y)) continue;
        let clearOfSight = true;
        for (let s = 0; s < 8 && clearOfSight; s++) {
          const a = (s / 8) * Math.PI * 2;
          if (sees(x + Math.cos(a) * 1.5, y + Math.sin(a) * 1.5)) clearOfSight = false;
        }
        if (clearOfSight && !sees(x, y)) return { x, y };
      }
    }
    return null;
  });
  expect(hidden, "the world should have somewhere robustly out of sight").not.toBeNull();

  await page.evaluate((at) => (window as unknown as Win).__OREKENOID__.spawnCreature(at.x, at.y, 0, "grinder"), hidden!);
  await page.waitForTimeout(400);

  // The rule, checked against wherever each creature actually is: terrain shows dimly through
  // shadow, creatures do not, because one at a third brightness is one you can still see.
  const rows = await page.evaluate(() => {
    const hook = (window as unknown as Win).__OREKENOID__;
    const game = hook.game;
    const drone = { x: game.player.x / 42, y: game.player.y / 42 };
    return (game.combat as any).creatures.map((entry: any) => {
      let seen = true;
      for (let t = 0; t <= 1; t += 0.01) {
        if (hook.world.solidAt(
          drone.x + (entry.creature.x - drone.x) * t,
          drone.y + (entry.creature.y - drone.y) * t,
        )) { seen = false; break; }
      }
      return { visible: entry.display.container.visible, seen, kind: entry.creature.kind };
    });
  });
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect(row.visible, `${row.kind} visible=${row.visible} seen=${row.seen}`).toBe(row.seen);
  // And the placed one really was hidden, so the test proves something.
  expect(rows.some((row: any) => !row.visible)).toBe(true);
});

test("a smothered lamp blinds the drone to what it could plainly see", async ({ page }) => {
  test.setTimeout(120_000);
  const spot = await intoCaverns(page);

  // Down the open lane, in clear line of sight and well inside ordinary reach.
  const target = { x: spot.x + 9, y: spot.y };
  await page.evaluate((at) => (window as unknown as Win).__OREKENOID__.spawnCreature(at.x, at.y, Math.PI, "spitter"), target);
  await page.waitForTimeout(400);
  const seenAt = (page: any, near: { x: number; y: number }) => page.evaluate((at: any) => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const entry = (game.combat as any).creatures.find((e: any) => Math.hypot(e.creature.x - at.x, e.creature.y - at.y) < 4);
    return entry ? entry.display.container.visible : null;
  }, near);
  expect(await seenAt(page, target), "visible with the lamp intact").toBe(true);

  // Now take the lamp. Sight collapses to a few cells, so the same creature at the same distance,
  // with nothing whatsoever in the way, goes dark -- which is the entire creature.
  await page.evaluate((at) => (window as unknown as Win).__OREKENOID__.spawnCreature(at.x, at.y, Math.PI, "douser"),
    { x: spot.x + 2, y: spot.y });
  await page.waitForFunction(() => (window as unknown as Win).__OREKENOID__.state.combat.lamp <= 0.23,
    null, { timeout: 25_000 });
  await page.waitForTimeout(200);
  expect(await seenAt(page, target), "hidden while the lamp is smothered").toBe(false);
});
