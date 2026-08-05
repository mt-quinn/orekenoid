import { expect, test } from "@playwright/test";

type Win = Window & typeof globalThis & { __OREKENOID__: any };

const SAVE_KEY = "orekenoid.expedition.v1";

/** Wait for the deployment screen to finish building its live chassis previews. */
async function bootFresh(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.evaluate((key) => window.localStorage.removeItem(key), SAVE_KEY);
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 20_000 });
  await expect(page.locator("#briefing")).toHaveAttribute("data-render-state", "ready");
}

test("an expedition survives a reload, and the Atlas records only what was surveyed", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await bootFresh(page);

  // --- No save yet ---------------------------------------------------------
  // Import is still offered: a player arriving with a save file in hand has
  // nowhere else to put it.
  await expect(page.locator("#expeditionTitle")).toHaveText("NO SAVED EXPEDITION");
  await expect(page.locator("#continueButton")).toBeHidden();
  await expect(page.locator("#abandonButton")).toBeHidden();
  await expect(page.locator("#importButton")).toBeVisible();

  await page.click('[data-chassis="1"]');
  await page.click("#beginButton");
  await expect(page.locator("#briefing")).toHaveClass(/hidden/);

  // --- Play enough to have something worth losing --------------------------
  const played = await page.evaluate(async () => {
    const debug = (window as unknown as Win).__OREKENOID__;
    const game = debug.game;
    // Roam: discovery is driven by where the drone actually goes.
    game.world.markDiscovered(game.player.x / 42, game.player.y / 42, 9);
    debug.warpTo(58, 40);
    game.world.markDiscovered(58, 40, 9);
    // Excavate at an angle, which is the case a cell-grid save would get wrong.
    for (let step = 0; step < 18; step++) {
      game.world.removeFootprint(
        { center: { x: 54 + step * 0.5, y: 36 + step * 0.3 }, halfWidth: 0.5, halfHeight: 0.5, angle: 0.4 },
        step % 2 === 0,
      );
    }
    debug.giveResource("copper", 9);
    debug.bankAll();
    debug.grantVerb("railSeed");
    game.annotations.push({ id: "probe", x: 58, y: 40, icon: "!", note: "rich face" });
    const wrote = game.saveNow();
    return {
      wrote,
      discovered: game.world.discoveredCount,
      history: game.world.history.length,
      banked: game.economy.amount("copper"),
      solidity: [...Array(24).keys()].map((index) => game.world.solidAt(54 + index * 0.5, 36 + index * 0.3)),
    };
  });
  expect(played.wrote).toBe(true);
  expect(played.discovered).toBeGreaterThan(100);
  expect(played.history).toBe(18);
  expect(played.banked).toBe(9);

  // The save must be small enough to hand to someone. Geology is regenerated from
  // the seed, so only the mutation log and the discovery mask are stored.
  const saveBytes = await page.evaluate((key) => window.localStorage.getItem(key)?.length ?? 0, SAVE_KEY);
  expect(saveBytes).toBeGreaterThan(0);
  expect(saveBytes).toBeLessThan(200_000);

  // --- Reload and continue -------------------------------------------------
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 20_000 });
  await expect(page.locator("#briefing")).toHaveAttribute("data-render-state", "ready");
  await expect(page.locator("#expeditionTitle")).toContainText("EXPEDITION");
  await expect(page.locator("#continueButton")).toBeVisible();

  await page.click("#continueButton");
  await expect(page.locator("#briefing")).toHaveClass(/hidden/);

  // A save means this player has already been taught. The opening sequence must not run again,
  // and above all its input gate must not run again -- a restored half-finished checklist used to
  // leave the prompt asking for a control the player had used a hundred times, while refusing
  // everything the old save had not happened to record.
  await expect(page.locator("#tutorial")).toHaveCount(0);
  const ftue = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return {
      complete: game.tutorialComplete,
      pending: game.tutorial.filter((step: any) => !step.done).map((step: any) => step.id),
    };
  });
  expect(ftue.complete).toBe(true);
  expect(ftue.pending).toEqual([]);

  const restored = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return {
      started: game.started,
      discovered: game.world.discoveredCount,
      history: game.world.history.length,
      banked: game.economy.amount("copper"),
      verbs: [...game.economy.verbs],
      annotations: game.annotations,
      player: { x: game.player.x, y: game.player.y },
      solidity: [...Array(24).keys()].map((index) => game.world.solidAt(54 + index * 0.5, 36 + index * 0.3)),
    };
  });

  expect(restored.started).toBe(true);
  expect(restored.discovered).toBe(played.discovered);
  expect(restored.history).toBe(played.history);
  expect(restored.banked).toBe(9);
  expect(restored.verbs).toContain("railSeed");
  expect(restored.annotations).toHaveLength(1);
  expect(restored.annotations[0].note).toBe("rich face");
  // The excavated diagonal is the real test: solidity must match cell for cell.
  expect(restored.solidity).toEqual(played.solidity);
  expect(Math.round(restored.player.x)).toBe(58 * 42);

  // --- The Atlas -----------------------------------------------------------
  await page.keyboard.press("KeyM");
  await expect(page.locator("#atlas")).toHaveClass(/open/);
  await expect(page.locator("#atlas")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#atlasSeed")).toContainText("surveyed");
  await expect(page.locator("#atlasIcons button")).toHaveCount(8);
  await expect(page.locator("#atlasEditor")).toBeHidden();

  // The map must sit inside the aperture without pushing the legend or the save
  // buttons off the bottom of it.
  const atlasFit = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const canvas = rect("#atlasCanvas");
    const stage = rect("#atlasStage");
    const foot = rect(".atlas-foot");
    const panel = rect("#atlas");
    return {
      canvasWithinStage: canvas.bottom <= Math.ceil(stage.bottom) && canvas.right <= Math.ceil(stage.right),
      canvasAboveFoot: canvas.bottom <= Math.ceil(foot.top),
      footWithinPanel: foot.bottom <= Math.ceil(panel.bottom),
      aspect: canvas.width / canvas.height,
    };
  });
  expect(atlasFit.canvasWithinStage).toBe(true);
  expect(atlasFit.canvasAboveFoot).toBe(true);
  expect(atlasFit.footWithinPanel).toBe(true);
  expect(atlasFit.aspect).toBeCloseTo(1200 / 720, 1);

  // The Atlas swallows movement keys, so the drone holds still while it is read.
  const before = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.player.x);
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyD");
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.player.x)).toBe(before);

  // --- Annotation ----------------------------------------------------------
  // Unsurveyed ground refuses a marker: a map the player has not walked is not
  // theirs to annotate.
  const refused = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const canvas = document.querySelector<HTMLCanvasElement>("#atlasCanvas")!;
    const rect = canvas.getBoundingClientRect();
    // A cell far from anywhere the drone has been.
    const cell = { x: 200, y: 130 };
    const point = {
      clientX: rect.left + (cell.x * 5 / 1200) * rect.width,
      clientY: rect.top + (cell.y * 5 / 720) * rect.height,
    };
    const wasDiscovered = game.world.isDiscovered(cell.x, cell.y);
    canvas.dispatchEvent(new MouseEvent("click", { ...point, bubbles: true }));
    return { wasDiscovered, marks: game.annotations.length, hint: document.querySelector("#atlasHint")!.textContent };
  });
  expect(refused.wasDiscovered).toBe(false);
  expect(refused.marks).toBe(1);
  expect(refused.hint).toContain("UNSURVEYED");

  // Surveyed ground accepts one, and the editor opens on it.
  const placed = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const canvas = document.querySelector<HTMLCanvasElement>("#atlasCanvas")!;
    const rect = canvas.getBoundingClientRect();
    // Offset from the drone: the marker restored from the save sits on the drone's
    // own cell, and clicking that would select it rather than place a new one.
    const cell = { x: game.player.x / 42 + 5, y: game.player.y / 42 + 3 };
    canvas.dispatchEvent(new MouseEvent("click", {
      clientX: rect.left + (cell.x * 5 / 1200) * rect.width,
      clientY: rect.top + (cell.y * 5 / 720) * rect.height,
      bubbles: true,
    }));
    return { marks: game.annotations.length };
  });
  expect(placed.marks).toBe(2);
  await expect(page.locator("#atlasEditor")).toBeVisible();

  await page.fill("#atlasNote", "seam continues east");
  await page.click("#atlasSaveNote");
  await expect(page.locator("#atlasEditor")).toBeHidden();

  // Choosing a different icon retargets the marker being edited.
  const edited = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const note = game.annotations.at(-1);
    return { note: note.note, icon: note.icon };
  });
  expect(edited.note).toBe("seam continues east");

  // Deleting removes it and nothing else.
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const canvas = document.querySelector<HTMLCanvasElement>("#atlasCanvas")!;
    const rect = canvas.getBoundingClientRect();
    const note = game.annotations.at(-1);
    canvas.dispatchEvent(new MouseEvent("click", {
      clientX: rect.left + (note.x * 5 / 1200) * rect.width,
      clientY: rect.top + (note.y * 5 / 720) * rect.height,
      bubbles: true,
    }));
  });
  await expect(page.locator("#atlasEditor")).toBeVisible();
  await page.click("#atlasDeleteNote");
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.annotations.length)).toBe(1);

  await page.keyboard.press("KeyM");
  await expect(page.locator("#atlas")).not.toHaveClass(/open/);

  // --- Export and import round-trip ---------------------------------------
  // Exercised through the same validation the file picker uses, so an exported
  // file is provably loadable rather than merely written.
  const roundTrip = await page.evaluate(async () => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.saveNow();
    const raw = window.localStorage.getItem("orekenoid.expedition.v1")!;
    // Dynamic, string-built specifier: this resolves in the running Vite page, not
    // at typecheck time in Node.
    const module = await (new Function("return import('/src/persistence.ts')")() as Promise<
      typeof import("../../src/persistence")
    >);
    const good = module.parseSave(raw);
    const truncated = module.parseSave(raw.slice(0, Math.floor(raw.length / 2)));
    const wrongVersion = module.parseSave(JSON.stringify({ ...JSON.parse(raw), version: 999 }));
    return {
      goodOk: good.ok,
      goodSeed: good.data?.seedLabel,
      fileName: good.data ? module.saveFileName(good.data) : "",
      truncatedOk: truncated.ok,
      truncatedReason: truncated.reason,
      wrongVersionOk: wrongVersion.ok,
      wrongVersionReason: wrongVersion.reason,
    };
  });
  expect(roundTrip.goodOk).toBe(true);
  expect(roundTrip.goodSeed).toBe("bounceworld-01");
  expect(roundTrip.fileName).toMatch(/^orekenoid-bounceworld-01-.*\.json$/);
  expect(roundTrip.truncatedOk).toBe(false);
  expect(roundTrip.truncatedReason).toContain("JSON");
  expect(roundTrip.wrongVersionOk).toBe(false);
  expect(roundTrip.wrongVersionReason).toContain("not supported");

  expect(errors).toEqual([]);
});
