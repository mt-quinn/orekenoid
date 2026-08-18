import { expect, test } from "@playwright/test";

/**
 * Cavern combat, in the real renderer.
 *
 * The unit tests prove the crawl, the exchange and the contact test in isolation. What they cannot
 * prove is that any of it is wired to the world the player is standing in -- that a Bounder walks the
 * terrain the chunks drew, that the paddle the player is turning is the paddle contact is measured
 * against, and that ore reaching the hold reaches the actual cargo.
 */

type Win = Window & typeof globalThis & { __OREKENOID__: any };

/** Boot, take a chassis, skip the opening sequence, and stand somewhere with rock to hand. */
async function intoCaverns(page: import("@playwright/test").Page): Promise<{ x: number; y: number }> {
  await page.goto("/");
  // Generous: a headless run is software-rendered, and with the whole suite in flight a boot has been
  // seen to take most of half a minute. Every test in the file goes through here, so a tight bound
  // fails an arbitrary one of them rather than the one with a problem.
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.locator(".paddle-option").first().click();
  await page.click("#beginButton");
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.tutorialComplete = true;
    for (const step of game.tutorial) step.done = true;
  });

  // Open ground with an eight-cell lane east and rock within a few cells: a Bounder needs a surface,
  // and the tests need room in front of the paddle.
  const spot = await page.evaluate(() => {
    const world = (window as unknown as Win).__OREKENOID__.world;
    const clear = (x: number, y: number) => {
      for (let dy = -1.4; dy <= 1.4; dy += 0.35) {
        for (let dx = -1.4; dx <= 1.4; dx += 0.35) if (world.solidAt(x + dx, y + dy)) return false;
      }
      return true;
    };
    // Well inside the map, with a clear lane on *both* sides. Only requiring one meant the scan
    // settled at the top-left corner of the world, where there is nothing to the west to light and
    // every test about turning round failed on the fixture rather than on the game.
    for (let y = 24; y < 120; y++) {
      for (let x = 24; x < 210; x++) {
        if (!clear(x, y)) continue;
        let lane = true;
        for (let step = 1; step <= 8 && lane; step++) {
          if (!clear(x + step, y) || !clear(x - step, y)) lane = false;
        }
        if (!lane) continue;
        for (let radius = 2; radius <= 5; radius += 0.5) {
          for (let index = 0; index < 16; index++) {
            const angle = (index / 16) * Math.PI * 2;
            if (world.solidAt(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)) return { x, y };
          }
        }
      }
    }
    return null;
  });
  expect(spot, "the world should have open ground beside rock").not.toBeNull();

  await page.evaluate(({ x, y }) => {
    const hook = (window as unknown as Win).__OREKENOID__;
    hook.warpTo(x, y);
    // Heading is measured from the frame's forward axis, so this points the paddle's face due east.
    hook.game.player.heading = Math.PI / 2;
  }, spot!);
  await page.waitForTimeout(400);
  return spot!;
}

/** Put a Bounder in the air aimed at a point, without waiting out its coil. */
async function hurlAt(
  page: import("@playwright/test").Page,
  from: { x: number; y: number },
  at: { x: number; y: number },
): Promise<void> {
  await page.evaluate(({ from: origin, at: target }) => {
    const hook = (window as unknown as Win).__OREKENOID__;
    const creature = hook.spawnCreature(origin.x, origin.y);
    creature.state = "hurl";
    creature.timer = 3;
    creature.deflected = false;
    const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
    creature.vx = Math.cos(angle) * 8.6;
    creature.vy = Math.sin(angle) * 8.6;
  }, { from, at });
}

test("the drone has no ball to fire out here", async ({ page }) => {
  test.setTimeout(120_000);
  await intoCaverns(page);
  // Space and R used to launch and recall one. The paddle is purely defensive now, and pressing them
  // must do nothing rather than something invisible.
  await page.keyboard.press("Space");
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => "balls" in (window as unknown as Win).__OREKENOID__.state.combat)).toBe(false);
  await expect(page.locator("#emitterStat")).toHaveCount(0);
});

test("a Bounder walks the rock and gets mad when it sees the drone", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const spot = await intoCaverns(page);

  const placed = await page.evaluate((at) => {
    const hook = (window as unknown as Win).__OREKENOID__;
    const world = hook.world;
    for (let radius = 2.5; radius <= 8; radius += 0.5) {
      for (let index = 0; index < 32; index++) {
        const angle = (index / 32) * Math.PI * 2;
        const x = at.x + Math.cos(angle) * radius;
        const y = at.y + Math.sin(angle) * radius;
        if (world.solidAt(x, y)) continue;
        for (let probe = 0; probe < 16; probe++) {
          const surface = (probe / 16) * Math.PI * 2;
          if (!world.solidAt(x + Math.cos(surface) * 0.84, y + Math.sin(surface) * 0.84)) continue;
          hook.spawnCreature(x, y, surface);
          return { x, y };
        }
      }
    }
    return null;
  }, spot);
  expect(placed, "there should be a surface near the drone to place one on").not.toBeNull();

  await page.waitForFunction(() => {
    const roster = (window as unknown as Win).__OREKENOID__.state.combat.creatures;
    return roster.some((creature: any) => creature.state !== "idle" && creature.state !== "dead");
  }, null, { timeout: 25_000 });
  // And it never lost its grip on the rock while doing it.
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.combat.creatures
    .every((creature: any) => !creature.adrift))).toBe(true);
  expect(errors).toEqual([]);
});

test("meeting one with the back of the paddle costs the hull", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const spot = await intoCaverns(page);
  const before = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.integrity);

  // The face points east, so this arrives from the west: into the back of the machine.
  await hurlAt(page, { x: spot.x - 4, y: spot.y }, { x: spot.x, y: spot.y });
  await page.waitForFunction((was) => (window as unknown as Win).__OREKENOID__.state.integrity < was,
    before, { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("meeting one with the face costs nothing at all", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const spot = await intoCaverns(page);
  // The room to ourselves: the mine keeps sending its own, and one of those arriving from behind would
  // make this a test about the whole world instead of about the face.
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.setSpawning(false));
  const before = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.integrity);
  const strikesBefore = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.combat.strikes);

  // One throw, square into the front of the face from the east, and the measurement stops at the
  // moment of contact. Letting it run on would be a different claim and a false one: a returned
  // Bounder is still live, still bouncing, and perfectly entitled to come back round at the hull.
  await hurlAt(page, { x: spot.x + 4, y: spot.y }, { x: spot.x, y: spot.y });
  await page.waitForFunction((was) => (window as unknown as Win).__OREKENOID__.state.combat.returns > was,
    0, { timeout: 15_000 });
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.combat.strikes))
    .toBe(strikesBefore);
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.integrity)).toBe(before);
  expect(errors).toEqual([]);
});

test("a kill pays out into cargo, and standing near it collects it", async ({ page }) => {
  test.setTimeout(120_000);
  const spot = await intoCaverns(page);
  const before = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.economy.carriedTotal);

  // Killed on the spot, so the test is about the payout rather than about winning a fight: one point
  // of health left, already returned, so its next contact with rock finishes it.
  await page.evaluate((at) => {
    const hook = (window as unknown as Win).__OREKENOID__;
    const creature = hook.spawnCreature(at.x + 1.2, at.y + 0.4);
    creature.ores = ["iron"];
    creature.hp = 1;
    creature.state = "hurl";
    creature.deflected = true;
    creature.timer = 3;
    // Aimed at the nearest rock, because a returned Bounder is killed by landing and a stationary one
    // never lands. Whichever way that is, the ore ends up within a couple of cells of the drone.
    let best = { angle: 0, distance: Infinity };
    for (let index = 0; index < 32; index++) {
      const angle = (index / 32) * Math.PI * 2;
      for (let radius = 0.6; radius < 6; radius += 0.2) {
        if (!hook.world.solidAt(creature.x + Math.cos(angle) * radius, creature.y + Math.sin(angle) * radius)) continue;
        if (radius < best.distance) best = { angle, distance: radius };
        break;
      }
    }
    creature.vx = Math.cos(best.angle) * 8.6;
    creature.vy = Math.sin(best.angle) * 8.6;
  }, spot);
  await page.waitForFunction((was) => (window as unknown as Win).__OREKENOID__.economy.carriedTotal > was,
    before, { timeout: 25_000 });
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.economy.carried("iron")))
    .toBeGreaterThan(0);
});

test("the paddle lights only what is in front of it", async ({ page }) => {
  test.setTimeout(120_000);
  const spot = await intoCaverns(page);

  // One either side, both in clear line of sight and both well inside reach. The face points east, so
  // only the eastern one may be drawn.
  await page.evaluate((at) => {
    const hook = (window as unknown as Win).__OREKENOID__;
    hook.spawnCreature(at.x + 4, at.y);
    hook.spawnCreature(at.x - 4, at.y);
  }, spot);
  await page.waitForTimeout(500);

  // Matched by where they were put, not by index or by side: the ambient spawner is running too, and
  // picking "the first eastern one" can pick its work instead of this test's.
  const sides = () => page.evaluate((at) => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const nearest = (x: number, y: number) => (game.combat as any).creatures
      .map((entry: any) => ({
        gap: Math.hypot(entry.creature.x - x, entry.creature.y - y),
        visible: entry.display.container.visible,
      }))
      .sort((a: any, b: any) => a.gap - b.gap)[0];
    return { east: nearest(at.x + 4, at.y), west: nearest(at.x - 4, at.y) };
  }, spot);

  const facingEast = await sides();
  expect(facingEast.east.gap).toBeLessThan(2);
  expect(facingEast.west.gap).toBeLessThan(2);
  expect(facingEast.east.visible, "in front of the face").toBe(true);
  expect(facingEast.west.visible, "behind the paddle").toBe(false);

  // Turn the machine around. Nothing has moved but the heading, and the answer inverts -- which is
  // what makes turning the act of looking.
  await page.evaluate(() => { (window as unknown as Win).__OREKENOID__.game.player.heading = -Math.PI / 2; });
  await page.waitForTimeout(400);
  const facingWest = await sides();
  expect(facingWest.east.visible, "now behind the paddle").toBe(false);
  expect(facingWest.west.visible, "now in front of the face").toBe(true);
});

test("the drawn world behind the paddle is dark", async ({ page }) => {
  test.setTimeout(120_000);
  await intoCaverns(page);
  // Read off the composited shadow mask itself rather than off the model, so this is about what was
  // drawn. Sampling the visible canvas would be the more direct test and cannot work: reading a WebGL
  // canvas back needs `preserveDrawingBuffer`, which the production app rightly does not set, so it
  // measures a blank buffer instead of the frame.
  const facingEast = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.shadowMask());
  expect(facingEast.right, "in front of the face").toBeGreaterThan(facingEast.left + 60);

  await page.evaluate(() => { (window as unknown as Win).__OREKENOID__.game.player.heading = -Math.PI / 2; });
  await page.waitForTimeout(500);
  const facingWest = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.shadowMask());
  expect(facingWest.left, "in front of the face once turned").toBeGreaterThan(facingWest.right + 60);
});

test("a claim is lit, and the cavern around it is not", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await intoCaverns(page);
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.setSpawning(false));

  await page.keyboard.press("KeyF");
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__.state.arena),
    null, { timeout: 15_000 });
  await page.waitForFunction(() => !(window as unknown as Win).__OREKENOID__.state.cameraTransition,
    null, { timeout: 25_000 });
  await page.waitForTimeout(500);

  // The regression this exists for: committing a claim used to switch the dark off entirely, which
  // lit the whole mine and was the most jarring transition in the game.
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.shadowsVisible)).toBe(true);

  const mask = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.shadowMask());
  // Both states present: the board and whatever it opens onto are lit, and the rock around it is not.
  // Either extreme means the mask has stopped meaning anything -- all lit is the old bug, all dark
  // would have taken the board with it.
  expect(mask.lit, "some of the world is lit").toBeGreaterThan(0);
  expect(mask.dark, "some of the world is not").toBeGreaterThan(0);
  expect(mask.dark / (mask.lit + mask.dark), "a real share of it is dark").toBeGreaterThan(0.1);
  expect(errors).toEqual([]);
});

test("the dark covers the screen corners through a rotated view", async ({ page }) => {
  test.setTimeout(180_000);
  await intoCaverns(page);
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.setSpawning(false));
  await page.keyboard.press("KeyF");
  await page.waitForFunction(() => !(window as unknown as Win).__OREKENOID__.state.cameraTransition,
    null, { timeout: 25_000 });

  // Held at 45 degrees, the worst case: the mask is a world-space rect, so a region sized off the
  // viewport's width and height rather than its diagonal leaves the corners of a turned view
  // unmasked and the dark visibly clips to a box.
  await page.evaluate(() => {
    const hook = (window as unknown as Win).__OREKENOID__;
    const pin = () => { hook.game.camera.rotation = Math.PI / 4; requestAnimationFrame(pin); };
    pin();
  });
  await page.waitForTimeout(700);
  const mask = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.shadowMask());
  expect(mask.lit).toBeGreaterThan(0);
  expect(mask.dark).toBeGreaterThan(0);
});
