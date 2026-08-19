import { expect, test } from "@playwright/test";

/**
 * The crossfade curve, rendered rather than watched.
 *
 * A live context cannot be sampled for this: in a headless browser the audio clock runs several times faster
 * than wall time, so a 1.1s ramp is over in a couple of hundred milliseconds of real time and any polling loop
 * steps straight across it. An `OfflineAudioContext` renders on its own clock, so the curve can be read exactly.
 */
test("the crossfade is a linear ramp of the stated length", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?seed=bounceworld-01");
  await page.waitForSelector('#briefing[data-render-state="ready"]', { timeout: 90_000 });
  const curve = await page.evaluate(async () => {
    // Imported at runtime from the dev server, which is the only way to reach the real `ramp` and the real
    // `MUSIC.fade` from inside the page. Typed loosely on purpose: this is a URL, not a module path the
    // compiler can resolve.
    const load = new Function("url", "return import(url)") as (url: string) => Promise<unknown>;
    const module = await load("/src/music.ts") as {
      ramp: (context: BaseAudioContext, param: AudioParam, to: number, seconds: number) => void;
      MUSIC: { fade: number };
    };
    const rate = 48000;
    const seconds = 3;
    const offline = new OfflineAudioContext(1, rate * seconds, rate);
    // A constant 1, so the rendered output *is* the gain curve.
    const constant = offline.createConstantSource();
    constant.offset.value = 1;
    const gain = offline.createGain();
    gain.gain.value = 1;
    constant.connect(gain).connect(offline.destination);
    constant.start(0);
    module.ramp(offline, gain.gain, 0, module.MUSIC.fade);
    const rendered = await offline.startRendering();
    const data = rendered.getChannelData(0);
    const at = (t: number) => Number(data[Math.floor(t * rate)].toFixed(3));
    return {
      fade: module.MUSIC.fade,
      start: at(0),
      quarter: at(module.MUSIC.fade * 0.25),
      half: at(module.MUSIC.fade * 0.5),
      threeQuarters: at(module.MUSIC.fade * 0.75),
      end: at(module.MUSIC.fade + 0.02),
      after: at(module.MUSIC.fade + 1),
    };
  });
  console.log("CURVE " + JSON.stringify(curve));
  // Linear: a quarter of the way through the fade is three quarters of the way down.
  expect(curve.start).toBeCloseTo(1, 2);
  expect(curve.quarter).toBeCloseTo(0.75, 2);
  expect(curve.half).toBeCloseTo(0.5, 2);
  expect(curve.threeQuarters).toBeCloseTo(0.25, 2);
  expect(curve.end).toBeCloseTo(0, 2);
  expect(curve.after).toBeCloseTo(0, 2);
});

/**
 * And the score actually plays, and follows the game.
 *
 * End states only. The curve is covered above, deterministically, because a live context cannot be sampled
 * finely enough here to see it.
 */
test("the score plays, and follows the game between the mine and a claim", async ({ page }) => {
  test.setTimeout(180_000);
  type Win = Window & typeof globalThis & { __OREKENOID__: any };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?seed=bounceworld-01");
  await page.waitForSelector('#briefing[data-render-state="ready"]', { timeout: 90_000 });
  await page.locator("#newButton").click();
  await page.waitForTimeout(2500);
  const read = () => page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.music.diagnostics);

  const mine = await read();
  expect(mine.playing, "the score never started").toBe(true);
  expect(mine.layer).toBe("survey");
  expect(mine.surveyGain).toBeCloseTo(1, 1);
  expect(mine.framedGain).toBeCloseTo(0, 1);

  await page.evaluate(() => {
    const hook = (window as unknown as Win).__OREKENOID__;
    const game = hook.game as any;
    for (const step of game.tutorial) step.done = true;
    game.tutorialComplete = true;
    hook.setSpawning(false);
    hook.warpTo(44, 24.5);
    game.player.heading = Math.PI / 2 + 0.18;
    game.establishArena();
  });
  await page.waitForTimeout(3000);
  const claim = await read();
  expect(claim.layer).toBe("framed");
  expect(claim.framedGain).toBeCloseTo(1, 1);
  expect(claim.surveyGain).toBeCloseTo(0, 1);
  // The two mixes are the same piece and must not have pulled apart. This is what the whole design is for.
  expect(Math.abs(claim.drift), `drifted ${claim.drift}s`).toBeLessThan(0.05);

  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.endClaimNow());
  await page.waitForTimeout(4000);
  const back = await read();
  expect(back.layer).toBe("survey");
  expect(back.surveyGain).toBeCloseTo(1, 1);
  expect(Math.abs(back.drift)).toBeLessThan(0.05);
  expect(errors).toEqual([]);
});
