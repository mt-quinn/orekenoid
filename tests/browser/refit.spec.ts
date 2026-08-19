import { expect, test } from "@playwright/test";

/**
 * The fitting moment.
 *
 * Posed rather than watched. A screenshot takes longer than the sequence lasts, so sampling it
 * against the wall clock photographs the aftermath and calls it the middle -- the first version
 * of this test did exactly that and "verified" a finished machine three times. `poseFit` stops
 * the ticker and steps the animation by hand, which is the only way to actually inspect frame
 * 0.14.
 *
 * What this asserts is what a screenshot cannot: that the arm *arrives*. Whether the timing
 * feels good is a play judgement and deliberately not tested; the constants it would be tuned
 * with are gathered in `FIT` in `view/gantry.ts` for exactly that reason.
 */

type Win = Window & typeof globalThis & { __OREKENOID__: any };

const REACH = 0.34;
const HOLD = 0.07;
const RETRACT = 0.46;

async function boot(page: import("@playwright/test").Page): Promise<void> {
  // This test boots twice, and the first boot writes a save on its way out of the page. NEW GAME now asks
  // before replacing a save, and Playwright dismisses an unhandled dialog -- which left the second boot
  // sitting on the menu with nothing deployed, and the pose reading a machine that was never there.
  page.once("dialog", (dialog) => void dialog.accept().catch(() => {}));
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.click("#newButton");
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    for (const resource of ["copper", "iron", "cobalt", "coal", "emerald", "sapphire", "mithril", "ruby"]) {
      api.giveResource(resource, 90);
    }
    api.bankAll();
  });
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(250);
}

const pose = (page: import("@playwright/test").Page, at: number) =>
  page.evaluate(([station, seconds]) =>
    (window as unknown as Win).__OREKENOID__.poseFit(station, seconds), ["salvage", at] as const);

test("the arm carries the part in, seats it, and lets go", async ({ page }) => {
  test.setTimeout(200_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  // Early in the reach: the arm has left its post but is nowhere near the machine, and it is
  // holding the part.
  await boot(page);
  const early = await pose(page, 0.04);
  expect(early.seated).toBe(false);
  expect(early.arm.carrying).toBe(true);
  expect(early.arm.travel).toBeLessThan(0.35);
  const startGap = Math.hypot(early.arm.tip.x - early.arm.mount.x, early.arm.tip.y - early.arm.mount.y);
  expect(startGap, "the arm starts at the mount rather than travelling to it").toBeGreaterThan(120);

  // At the seat: the tip is *on* the mount, not near it, and the part has been handed over.
  await boot(page);
  const seated = await pose(page, REACH + 0.01);
  expect(seated.seated).toBe(true);
  expect(seated.arm.carrying, "the arm still has the part after seating it").toBe(false);
  const landing = Math.hypot(seated.arm.tip.x - seated.arm.mount.x, seated.arm.tip.y - seated.arm.mount.y);
  expect(landing, `the arm stopped ${landing.toFixed(1)}px short of the mount`).toBeLessThan(2);
  // Debris, thrown at the moment of impact.
  expect(seated.sparks).toBeGreaterThan(10);

  // The hold is a real freeze: the arm does not creep across it.
  await boot(page);
  const holdStart = await pose(page, REACH + 0.005);
  const holdEnd = await pose(page, HOLD - 0.015);
  expect(Math.abs(holdEnd.arm.travel - holdStart.arm.travel), "the arm moved during the hold")
    .toBeLessThan(0.001);

  // Retracting: the arm is on its way back and the kick has not yet settled.
  await boot(page);
  const back = await pose(page, REACH + HOLD + RETRACT * 0.4);
  expect(back.fitting).toBe(true);
  expect(back.arm.travel).toBeLessThan(0.9);
  expect(Math.hypot(back.kick.x, back.kick.y), "no kick during the retract").toBeGreaterThan(0.05);

  // Done: sequence over, kick returned to exactly zero, debris settled on the floor and still
  // there. Permanence -- the bay shows that something was fitted here.
  await boot(page);
  const done = await pose(page, REACH + HOLD + RETRACT + 0.05);
  expect(done.fitting).toBe(false);
  expect(done.arm).toBeNull();
  expect(done.kick).toEqual({ x: 0, y: 0 });
  expect(done.sparks).toBeGreaterThan(10);
  expect(done.settled, "sparks never landed").toBe(done.sparks);

  // And the part is on the machine, in the economy and in the game's own numbers.
  const after = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    return {
      level: api.bayModel().stations.find((station: any) => station.id === "salvage").level,
      tax: api.game.salvageTax,
    };
  });
  expect(after.level).toBe(1);
  expect(after.tax).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test("a fit can be skipped, and lands rather than being cancelled", async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  // Mid-reach, before the part is anywhere near the machine.
  const mid = await pose(page, 0.1);
  expect(mid.seated).toBe(false);
  const skipped = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    api.game.gantry.skipFit();
    return {
      fitting: api.game.gantry.fitting,
      level: api.bayModel().stations.find((station: any) => station.id === "salvage").level,
    };
  });
  // Skipping must not cost the player the upgrade they paid for.
  expect(skipped.fitting).toBe(false);
  expect(skipped.level).toBe(1);
});
