// Teaching a thumb.
//
// The opening sequence used to say `WASD / ARROWS` to everybody. On a phone that is worse than
// silence: it advertises hardware the player does not have and says nothing about the one control
// they do. So the prompt swaps to the gesture the moment a finger is used, and mimes each distinct
// gesture once -- because "drag on the left half" is a description and a thumb visibly doing it is
// an instruction.

import { expect, test } from "@playwright/test";

interface Win {
  __OREKENOID__: { game: any; state: any };
}

test("the opening prompt teaches gestures once a finger is used", async ({ page }) => {
  await page.goto("/");
  await page.locator(".paddle-option.surveyor").tap();
  await page.locator("#beginButton").tap();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.waitForTimeout(700);

  // Nothing has been touched on the canvas yet, so the prompt is still talking about keys: a
  // tablet with a keyboard should not be told to drag until somebody drags.
  const beforeTouch = await page.evaluate(
    () => (window as unknown as Win).__OREKENOID__.game.coach.prompt,
  );
  expect(beforeTouch?.gesture ?? null).toBeNull();
  expect(beforeTouch?.keys).toBe("WASD / ARROWS");

  // Touch the world. From here the player is holding a phone and the prompt should say so.
  const box = await page.locator("canvas.game-canvas").boundingBox();
  await page.touchscreen.tap(box!.x + box!.width * 0.3, box!.y + box!.height * 0.6);
  await page.waitForTimeout(300);

  const afterTouch = await page.evaluate(
    () => (window as unknown as Win).__OREKENOID__.game.coach.prompt,
  );
  expect(afterTouch?.gesture, "the prompt still names keys after a touch").toBe("DRAG · LEFT HALF");
  // And the first drag is demonstrated rather than only described.
  expect(afterTouch?.demo).toBe("stick");

  await page.screenshot({ path: "phone-coach-gesture.png" });

  // The demonstration runs for a few loops and then retires. It must survive being re-shown while
  // it is running -- `renderTutorial` is called every frame, and treating each call as a fresh
  // "have we shown this?" question is what made it flash for a single frame the first time.
  const midway = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.coach.hide();
    game.renderTutorial();
    return game.coach.prompt;
  });
  expect(midway?.demo, "the demonstration did not survive a re-show").toBe("stick");

  // Once it has run its course the gesture is trusted and never mimed again, for this rung or any
  // other rung that uses the same gesture.
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.game.coach.prompt?.demo === undefined,
    null, { timeout: 15_000 },
  );
  const settled = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.coach.hide();
    game.renderTutorial();
    return game.coach.prompt;
  });
  expect(settled?.gesture, "the gesture text should outlive the demonstration").toBe("DRAG · LEFT HALF");
  expect(settled?.demo ?? null, "the same gesture was demonstrated twice").toBeNull();
});
