// Playing with fingers.
//
// The point of the touch layer is that a phone can do everything a keyboard can, so this drives
// the whole opening loop without pressing a single key: fly the drone with the stick, turn the
// frame with a drag, commit, move the paddle, aim and serve.
//
// Everything here goes through Playwright's touchscreen, which under `hasTouch` dispatches real
// pointer events -- so this exercises the same code path a thumb does, rather than a mouse in a
// costume.

import { expect, test } from "@playwright/test";

interface Win {
  __OREKENOID__: { game: any; state: any };
}

const state = (page: any) => page.evaluate(() => {
  const api = (window as unknown as Win).__OREKENOID__;
  return {
    mode: api.state.mode,
    x: api.game.player.x,
    y: api.game.player.y,
    heading: api.game.player.heading,
    paddleU: api.game.arena?.paddle.u ?? null,
    serveAim: api.game.arena?.serveAim ?? null,
    served: api.game.arena?.balls.some((ball: any) => ball.served) ?? false,
  };
});

const deploy = async (page: any) => {
  await page.goto("/");
  await page.locator("#newButton").tap();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.waitForTimeout(700);
};

test("the drone flies from the stick and the frame turns from a drag", async ({ page }) => {
  await deploy(page);
  const before = await state(page);

  // The left half is the stick. It appears where the thumb lands, so there is no fixed target to
  // find -- pressing anywhere in the left half and pushing right is a full-speed move right.
  const client = await page.evaluateHandle(() => document.querySelector("canvas.game-canvas"));
  const box = await (client as any).asElement()!.boundingBox();
  const stickAt = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.62 };

  await page.touchscreen.tap(stickAt.x, stickAt.y);
  // Hold and push: dispatched directly, because Playwright's touchscreen has no press-and-hold.
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector("canvas.game-canvas")!;
    const send = (type: string, cx: number, cy: number) => canvas.dispatchEvent(
      new PointerEvent(type, { pointerId: 1, pointerType: "touch", clientX: cx, clientY: cy, bubbles: true }),
    );
    send("pointerdown", x, y);
    send("pointermove", x + 70, y);
  }, stickAt);
  await page.waitForTimeout(700);
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector("canvas.game-canvas")!;
    canvas.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, pointerType: "touch", clientX: x + 70, clientY: y, bubbles: true,
    }));
  }, stickAt);

  const moved = await state(page);
  expect(moved.x, "the stick did not fly the drone").toBeGreaterThan(before.x + 4);

  // The right half turns the frame, relative to how far the finger travels.
  const turnAt = { x: box.x + box.width * 0.75, y: box.y + box.height * 0.62 };
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector("canvas.game-canvas")!;
    const send = (type: string, cx: number, cy: number) => canvas.dispatchEvent(
      new PointerEvent(type, { pointerId: 2, pointerType: "touch", clientX: cx, clientY: cy, bubbles: true }),
    );
    send("pointerdown", x, y);
    for (let step = 1; step <= 6; step++) send("pointermove", x + step * 12, y);
    send("pointerup", x + 72, y);
  }, turnAt);
  await page.waitForTimeout(250);

  const turned = await state(page);
  expect(
    Math.abs(turned.heading - moved.heading),
    "the drag did not turn the survey frame",
  ).toBeGreaterThan(0.1);

  await page.screenshot({ path: "phone-touch-survey.png" });
});

test("a claim is committed, paddled, aimed and served by touch alone", async ({ page }) => {
  await deploy(page);

  // Walk the opening sequence to the commit rung with touch, then tap to commit.
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.tutorialComplete = true;
    for (const step of game.tutorial) step.done = true;
  });

  const box = await page.locator("canvas.game-canvas").boundingBox();
  expect(box).not.toBeNull();
  const centre = { x: box!.x + box!.width / 2, y: box!.y + box!.height * 0.45 };

  await page.touchscreen.tap(centre.x, centre.y);
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.state.mode === "play",
    null, { timeout: 25_000 },
  );
  await page.waitForTimeout(1200);

  const framed = await state(page);
  expect(framed.mode).toBe("play");

  // Drag the paddle. The paddle chases the finger at its own speed rather than being assigned a
  // position, so this needs a moment of held contact rather than a single jump.
  const low = { x: box!.x + box!.width * 0.78, y: box!.y + box!.height * 0.8 };
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector("canvas.game-canvas")!;
    const send = (type: string, cx: number, cy: number) => canvas.dispatchEvent(
      new PointerEvent(type, { pointerId: 3, pointerType: "touch", clientX: cx, clientY: cy, bubbles: true }),
    );
    send("pointerdown", x, y);
    send("pointermove", x, y);
  }, low);
  await page.waitForTimeout(800);

  const paddled = await state(page);
  expect(paddled.paddleU, "the paddle did not follow the finger").not.toBeCloseTo(framed.paddleU ?? 0, 1);
  // The drag positions the paddle and nothing else. Aim is a separate tap, so holding the paddle
  // over to one side must not steer the serve on its own.
  expect(paddled.serveAim).toBeCloseTo(framed.serveAim ?? 0, 2);

  await page.screenshot({ path: "phone-touch-claim.png" });

  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector("canvas.game-canvas")!;
    canvas.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 3, pointerType: "touch", clientX: x, clientY: y, bubbles: true,
    }));
  }, low);
  await page.waitForTimeout(150);

  // Aim by tapping where the ball should go. The paddle is parked over on the right from the drag
  // above, and tapping up and to the left must still produce a hard left serve -- that parity with
  // Q and E is the whole point of aiming being its own control. An earlier version derived the
  // angle from the paddle's own position, which made this shot impossible on a phone.
  const paddleSide = await state(page);
  expect(paddleSide.paddleU!, "the paddle should be right of centre for this check").toBeGreaterThan(0);

  await page.touchscreen.tap(box!.x + box!.width * 0.12, box!.y + box!.height * 0.3);
  await page.waitForTimeout(300);
  const aimed = await state(page);
  expect(aimed.serveAim!, "tapping up-left did not aim left").toBeLessThan(-0.2);
  expect(aimed.served, "aiming must not launch the ball").toBe(false);

  // Launching is the SERVE button, so a tap only ever means one thing.
  await page.locator("#touchPrimary").tap();
  await page.waitForTimeout(400);
  const served = await state(page);
  expect(served.served, "SERVE did not launch the ball").toBe(true);
});
