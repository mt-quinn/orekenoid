// Knowing there is a home, and that ore has to get there.
//
// Both facts were previously only discoverable by doing the wrong thing: pressing the forge key in
// the wrong place got you an arrow, and nothing at all explained why banked and carried ore were
// different pools. These are the channels that now say so before the mistake.

import { expect, test } from "@playwright/test";

interface Win {
  __OREKENOID__: { game: any; state: any };
}

const deploy = async (page: any) => {
  await page.goto("/");
  await page.locator("#beginButton").click();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.tutorialComplete = true;
    for (const step of game.tutorial) step.done = true;
  });
};

/** Away from the bay, holding a haul: the state the player is in when they get confused. */
const carryAway = async (page: any) => {
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.player.x += 40 * 42;
    game.economy.add("copper", 6);
    game.updateUI();
  });
  await page.waitForTimeout(250);
};

test("carrying a haul says what to do with it, where, and how far", async ({ page }) => {
  await deploy(page);

  // Docked and empty-handed, the objective is about mining rather than about banking.
  await expect(page.locator("#objectiveTitle")).not.toHaveText("BANK THE HAUL");

  await carryAway(page);

  // The one line whose job is "what now" now knows about the hold, names the place, and gives a
  // distance -- none of which it could do when it read the economy alone.
  await expect(page.locator("#objectiveTitle")).toHaveText("BANK THE HAUL");
  const detail = await page.locator("#objectiveDetail").innerText();
  expect(detail).toContain("Refit Bay");
  expect(detail).toMatch(/\d+m/);
  expect(detail.toLowerCase()).toContain("cannot be spent");

  // The bearing is simply present while the hold is full, rather than appearing only in answer to a
  // mistake -- and it points at the bay specifically, since only the bay banks.
  await expect(page.locator("#forgeCompass")).toHaveClass(/show/);
  await expect(page.locator("#forgeCompassRange")).toContainText("REFIT BAY");

  // And the strip says the pile is not banked, which is what makes "banked" a concept at all. The
  // caption is a `::before` on the strip rather than an element, so it is read off the computed style.
  const caption = await page.evaluate(
    () => getComputedStyle(document.querySelector("#cargo")!, "::before").content,
  );
  expect(caption).toContain("UNBANKED");
});

test("the compass retires once the haul is home", async ({ page }) => {
  await deploy(page);
  await carryAway(page);
  await expect(page.locator("#forgeCompass")).toHaveClass(/show/);

  // Fly home. Banking is automatic on arrival, so the hold empties and the prompt should let go.
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    // The bank, not the spawn point. They used to be three cells apart; the hand-drawn Berth puts the
    // chest on the west wall and wakes the drone in the middle of the room, which is a short flight.
    game.player.x = game.anchors.find((anchor: any) => anchor.id === "refitBay").x * 42;
    game.player.y = game.anchors.find((anchor: any) => anchor.id === "refitBay").y * 42;
  });
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.game.economy.carriedTotal === 0,
    null, { timeout: 8_000 },
  );
  await page.waitForTimeout(400);
  await expect(page.locator("#forgeCompass")).not.toHaveClass(/show/);
  await expect(page.locator("#cargo")).not.toHaveClass(/at-risk/);
});

test("the opening sequence teaches the first haul home", async ({ page }) => {
  await page.goto("/");
  await page.locator("#beginButton").click();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.waitForTimeout(600);

  // Walk the sequence to its last rung without banking anything.
  const step = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    for (const entry of game.tutorial) if (entry.id !== "bank") entry.done = true;
    game.player.x += 40 * 42;
    game.economy.add("copper", 4);
    game.renderTutorial();
    return game.coach.prompt?.goal ?? null;
  });
  expect(step, "the sequence never asks for the first haul to be banked").toBe("BANK THE HAUL");

  // With an empty hold it must not ask: a sequential tutorial that demands the impossible stops
  // being a sequence.
  const empty = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.economy.deposit();
    game.renderTutorial();
    return game.coach.prompt?.goal ?? null;
  });
  expect(empty, "the sequence asked for a haul the player does not have").not.toBe("BANK THE HAUL");
});
