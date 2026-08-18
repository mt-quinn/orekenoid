// Being interrupted.
//
// On a phone this is not an edge case. A call arrives, the player switches apps, the browser
// suspends the audio context, somebody turns the device sideways. Every one of those has to stop the
// game *before* the player looks back, because the alternative is returning to a claim that carried
// on without them.

import { expect, test } from "@playwright/test";

interface Win {
  __OREKENOID__: { game: any; state: any };
}

const deploy = async (page: any) => {
  await page.goto("/");
  await page.locator(".paddle-option.surveyor").tap();
  await page.locator("#beginButton").tap();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  await page.waitForTimeout(600);
};

test("losing the window holds the game, and one tap brings it back", async ({ page }) => {
  await deploy(page);

  const plate = page.locator("#resumePlate");
  await expect(plate).toBeHidden();

  // Backgrounding. `visibilitychange` is the signal that fires reliably on mobile; `blur` does not
  // when an app is sent to the background, which is why the game listens for both.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(plate).toBeVisible();

  const heldState = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return { paused: game.paused, holding: game.holds.holding };
  });
  // Genuinely stopped, not just covered.
  expect(heldState.paused).toBe(true);
  expect(heldState.holding).toBe(true);

  // Returning to the tab is deliberately NOT consent to resume: coming back to a live ball with no
  // warning is the thing the plate exists to prevent.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(plate).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.paused)).toBe(true);

  await page.locator("#resumeButton").tap();
  await expect(plate).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.paused)).toBe(false);
});

test("a suspended audio context says so rather than resuming silently muted", async ({ page }) => {
  await deploy(page);
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.holds.audioLost());

  await expect(page.locator("#resumePlate")).toBeVisible();
  // The plate names the actual cause. A browser that suspends audio has pulled the sound out from
  // under the game, and saying "audio cut" is more use than a generic pause.
  await expect(page.locator("#resumeButton b")).toHaveText("AUDIO CUT");
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.paused)).toBe(true);
});

test("landscape gates the game rather than playing on sideways", async ({ page }) => {
  await deploy(page);
  await expect(page.locator("#rotateGate")).toBeHidden();

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);

  await expect(page.locator("#rotateGate")).toBeVisible();
  // Held behind the gate, not running under it.
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.paused)).toBe(true);
  await page.screenshot({ path: "phone-rotate-gate.png" });

  // Turning back restores the expedition rather than restarting it.
  const seedBefore = await page.evaluate(
    () => (window as unknown as Win).__OREKENOID__.game.world.seedLabel,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await expect(page.locator("#rotateGate")).toBeHidden();
  expect(await page.evaluate(
    () => (window as unknown as Win).__OREKENOID__.game.world.seedLabel,
  )).toBe(seedBefore);
});

test("the app declares itself installable and portrait", async ({ page }) => {
  await page.goto("/");
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBeTruthy();

  const manifest = await page.evaluate(async (href) => {
    const response = await fetch(href!);
    return response.json();
  }, manifestHref);

  expect(manifest.display).toBe("standalone");
  expect(manifest.orientation).toBe("portrait");
  expect(manifest.icons.length).toBeGreaterThan(0);
  // A maskable icon is what stops Android cropping the mark into a square badge.
  expect(manifest.icons.some((icon: any) => icon.purpose === "maskable")).toBe(true);

  // `viewport-fit=cover` is what makes the safe-area insets non-zero; without it the browser
  // letterboxes the page inside the safe area and every inset reads as 0.
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).toContain("viewport-fit=cover");
});
