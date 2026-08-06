import { expect, test } from "@playwright/test";

type Win = Window & typeof globalThis & { __OREKENOID__: any };

test("deployment previews, generated world, province rules, and the crafting chain", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 20_000 });
  await expect(page.locator("#briefing")).toHaveAttribute("data-render-state", "ready");
  await expect(page.locator("#briefing")).not.toHaveClass(/loading|failed/);
  await expect(page.locator(".game-canvas")).toBeVisible();
  await expect(page.locator("#beginButton")).toBeDisabled();
  await expect(page.locator(".paddle-option")).toHaveCount(3);

  // --- Deployment previews -------------------------------------------------
  // These run the production Arena, terrain raster, brick, paddle, ball and
  // collision code. They must never regress to a stub or a second renderer.
  await expect(page.locator(".field-window")).toHaveCount(3);
  await expect(page.locator(".deployment-preview-canvas")).toHaveCount(3);
  await page.waitForFunction(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const arenas = game.deploymentPreviews.arenas;
    return arenas.length === 3
      && arenas.every((arena: any) => arena.bricks.length > 0 && arena.balls.length === 1);
  });

  // Holding brick data is not the same as drawing it, and this is the gap a real regression walked
  // through: the crumble wavefront gave every board a mask, previews never run the loop that opens
  // one, and all three cards rendered bare terrain with a paddle on it. The brick assertion above
  // passed, and so did the readiness check, because terrain is perfectly good visible pixels.
  const previewDrawn = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return game.deploymentPreviews.arenas.map((arena: any) => ({
      masked: Boolean(arena.board.mask),
      drawn: arena.board.children.length,
    }));
  });
  for (const preview of previewDrawn) {
    expect(preview.masked, "a preview board is behind a mask nothing will ever open").toBe(false);
    expect(preview.drawn, "a preview board has nothing in it").toBeGreaterThan(3);
  }
  const previewAlignment = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return [...document.querySelectorAll<HTMLElement>(".field-window")].map((element, index) => {
      const rect = element.getBoundingClientRect();
      const preview = game.deploymentPreviews.arenas[index];
      const bounds = game.deploymentPreviews.contents[index].getBounds();
      const contentRect = {
        left: rect.left + bounds.x,
        top: rect.top + bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
      return {
        centerError: Math.abs(contentRect.left + contentRect.width / 2 - (rect.left + rect.width / 2)),
        bottomGap: rect.bottom - (contentRect.top + contentRect.height),
        widthCoverage: contentRect.width / rect.width,
        heightCoverage: contentRect.height / rect.height,
        contained: contentRect.left >= rect.left - 1 && contentRect.top >= rect.top - 1
          && contentRect.left + contentRect.width <= rect.right + 1
          && contentRect.top + contentRect.height <= rect.bottom + 1,
        hasTerrainAndArena: preview.container.children.length >= 2,
        bricks: preview.bricks.length,
        // The preview must show real material variety from the real Landing.
        kinds: [...new Set(preview.bricks.map((brick: any) => brick.kind))].sort(),
      };
    });
  });
  for (const alignment of previewAlignment) {
    expect(alignment.centerError).toBeLessThan(2);
    expect(alignment.bottomGap).toBeGreaterThan(5);
    expect(alignment.bottomGap).toBeLessThan(20);
    expect(Math.max(alignment.widthCoverage, alignment.heightCoverage)).toBeGreaterThan(0.9);
    expect(alignment.contained).toBe(true);
    expect(alignment.hasTerrainAndArena).toBe(true);
    expect(alignment.bricks).toBeGreaterThan(20);
    // Chalk crossed by slate is the Landing's teaching board; both must appear.
    expect(alignment.kinds).toContain("chalk");
    expect(alignment.kinds).toContain("slate");
  }

  const viewportFit = await page.locator("#gameHost").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, innerWidth, innerHeight };
  });
  expect(viewportFit.width).toBeLessThanOrEqual(viewportFit.innerWidth);
  expect(viewportFit.height).toBeLessThanOrEqual(viewportFit.innerHeight);
  expect(viewportFit.width / viewportFit.height).toBeCloseTo(16 / 9, 2);

  await expect(page.locator(".option-name b")).toHaveText(["Needle", "Surveyor", "Bastion"]);
  await expect(page.locator("#beginLabel")).toHaveText("CHOOSE");
  await page.click('[data-chassis="0"]');
  await expect(page.locator('[data-chassis="0"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#beginLabel")).toHaveText("DEPLOY");
  await page.screenshot({ path: "webgl-opening.png", fullPage: true });

  await page.click('[data-chassis="1"]');
  await page.click("#beginButton");
  await expect(page.locator("#briefing")).toHaveClass(/hidden/);

  // --- Tutorial controls ---------------------------------------------------
  // One rung at a time, taught by doing, then removed from the DOM for good. It used to be a
  // six-row checklist with every control already live; now the sequence asks for one thing and
  // refuses everything it has not offered yet.
  await expect(page.locator("#tutorial")).toBeVisible();
  await expect(page.locator("#tutorialList .ftue-now")).toHaveCount(1);
  await expect(page.locator("#tutorialList .ftue-now")).toContainText("MOVE");
  // Progress is a row of pips, none of them lit on the first frame.
  await expect(page.locator("#tutorialList .ftue-pip")).toHaveCount(8);
  await expect(page.locator("#tutorialList .ftue-pip.on")).toHaveCount(0);

  // Exclusive: a control the sequence has not reached yet does nothing. Committing a claim is
  // three rungs away, so F must not frame one.
  const gated = await page.evaluate(async () => {
    const api = (window as unknown as Win).__OREKENOID__;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { arena: api.state.arena, mode: api.state.mode };
  });
  expect(gated.arena, "F framed a claim before the sequence taught it").toBeNull();
  expect(gated.mode).toBe("survey");

  // --- Generated world -----------------------------------------------------
  const report = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.report);
  expect(report.missingLandingFeatures).toEqual([]);
  expect(report.unreachableRequiredNodes).toEqual([]);
  // Contract 1: essentially all open space is one connected system.
  expect(report.networkCells / report.openCells).toBeGreaterThan(0.95);
  expect(report.ecotoneReagents.brightFault).toBeGreaterThan(0);
  expect(report.ecotoneReagents.chalkWarren).toBeGreaterThan(0);
  expect(report.ecotoneReagents.bloomShelf).toBeGreaterThan(0);
  expect(report.bandDensity[2]).toBeGreaterThan(report.bandDensity[1]);
  expect(report.bandDensity[4]).toBeGreaterThan(report.bandDensity[3]);

  await expect(page.locator("#biomeLabel")).toHaveText("SURVEYOR'S KARST");
  await expect(page.locator("#bandLabel")).toHaveText("B1");
  // The HUD is mode-driven: surveying shows world-reading data, not board stakes.
  await expect(page.locator(".viewport")).toHaveAttribute("data-mode", "survey");
  await expect(page.locator("#loadStat")).toBeHidden();
  await expect(page.locator("#damageStat")).toBeHidden();
  // Objectives are mechanical: an imperative in caps plus a number.
  const objective = await page.locator("#objectiveTitle").innerText();
  expect(objective).toBe(objective.toUpperCase());
  expect(objective.split(" ").length).toBeLessThanOrEqual(4);

  const surveyBefore = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return { mode: game.mode, x: game.player.x, y: game.player.y, heading: game.player.heading, chassis: game.chassis, hasMutableFrame: "frame" in game };
  });
  expect(surveyBefore.mode).toBe("survey");
  expect(surveyBefore.hasMutableFrame).toBe(false);
  expect(surveyBefore.chassis.frame).toEqual({ width: 11, depth: 11, shape: "rectangle" });

  // Chassis is locked after deployment.
  await page.keyboard.press("Digit2");
  const locked = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return { name: game.chassis.name, frame: game.chassis.frame, paddleWidth: game.chassis.paddleWidth };
  });
  expect(locked.name).toBe("SURVEYOR");
  expect(locked.frame).toEqual({ width: 11, depth: 11, shape: "rectangle" });
  expect(locked.paddleWidth).toBe(surveyBefore.chassis.paddleWidth);

  await page.keyboard.down("KeyS");
  await page.keyboard.down("KeyE");
  await page.waitForTimeout(600);
  await page.keyboard.up("KeyS");
  await page.keyboard.up("KeyE");
  // Moving and aiming light their pips and hand the sequence on to the next rung.
  await expect(page.locator("#tutorialList .ftue-pip.on")).toHaveCount(2);
  await expect(page.locator("#tutorialList .ftue-now")).toContainText("COMMIT THE CLAIM");
  const surveyAfter = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.player.heading);
  expect(Math.abs(surveyAfter - surveyBefore.heading)).toBeGreaterThan(0.15);
  expect(Math.abs(surveyAfter / (Math.PI / 2) - Math.round(surveyAfter / (Math.PI / 2)))).toBeGreaterThan(0.05);
  await page.screenshot({ path: "webgl-framing.png", fullPage: true });

  // --- A Karst claim, at a non-cardinal heading ----------------------------
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.player.x = 24 * 42;
    game.player.y = 14 * 42;
    game.player.heading = Math.PI / 2 + 0.18;
  });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const state = (window as unknown as Win).__OREKENOID__.state;
    return state.mode === "play" && state.arena && !state.cameraTransition;
  });
  const claim = await page.evaluate(() => {
    const state = (window as unknown as Win).__OREKENOID__.state;
    const bricks = state.arena.bricks;
    return {
      province: state.arena.province,
      band: state.arena.band,
      total: bricks.length,
      liable: bricks.filter((brick: any) => brick.liable).length,
      slate: bricks.filter((brick: any) => brick.kind === "slate").length,
      slateLiable: bricks.filter((brick: any) => brick.kind === "slate" && brick.liable).length,
      slateWithIron: bricks.filter((brick: any) => brick.kind === "slate" && brick.resource === "iron").length,
      angle: state.arena.angle,
      projected: state.projectedDamage,
    };
  });
  expect(claim.province).toBe("karst");
  expect(claim.band).toBe(1);
  expect(claim.total).toBeGreaterThan(20);
  // The single most important rule in the early game: slate is durable, it is
  // free to leave standing, and it is where the iron is.
  expect(claim.slate).toBeGreaterThan(0);
  expect(claim.slateLiable).toBe(0);
  expect(claim.slateWithIron).toBe(claim.slate);
  expect(claim.liable).toBeLessThan(claim.total);
  expect(Math.abs(claim.angle % (Math.PI / 2))).toBeGreaterThan(0.05);

  // --- Excavation HUD ------------------------------------------------------
  await expect(page.locator(".viewport")).toHaveAttribute("data-mode", "play");
  await expect(page.locator("#loadStat")).toBeVisible();
  // Load is stated in exactly one place. The telemetry line that used to sit on
  // top of the board's load bar is gone during play.
  await expect(page.locator("#telemetry")).toBeHidden();
  const hud = await page.evaluate(() => ({
    load: document.querySelector("#claimValue")?.textContent,
    loadSub: document.querySelector("#claimDetail")?.textContent,
    armor: document.querySelector("#soakValue")?.textContent,
    healthMax: document.querySelector("#healthMax")?.textContent,
    damage: document.querySelector("#damageValue")?.textContent,
    damageActive: document.querySelector("#damageStat")?.classList.contains("active"),
    pips: document.querySelectorAll("#ballPips i").length,
    spares: document.querySelectorAll("#ballPips i.spare").length,
    arenaBalls: (window as unknown as Win).__OREKENOID__.game.arenaBalls,
    integrityState: (document.querySelector("#integrityStat") as HTMLElement)?.dataset.state,
  }));
  expect(Number(hud.load)).toBe(claim.liable);
  expect(hud.loadSub).toBe("REMAINING");
  // Armor is stated exactly once, in the health block where the chassis lives.
  expect(hud.armor).toContain("ARMOR");
  expect(hud.healthMax).toContain("/");
  expect(Number(hud.damage)).toBe(claim.projected);
  // Damage is an alarm: present only when there is damage to warn about.
  expect(hud.damageActive).toBe(claim.projected > 0);
  // Two balls by default: one live plus one spare. The Twin Engine makes it three.
  expect(hud.pips).toBe(2);
  expect(hud.spares).toBe(1);
  expect(hud.integrityState).toBeTruthy();
  expect(hud.arenaBalls).toBe(2);
  await page.screenshot({ path: "webgl-karst-claim.png", fullPage: true });

  // Aiming the serve comes first in the sequence, because it is the only steering the player has
  // and it stops working the instant the ball is live. Serving is refused until it is taught.
  const aimGate = await page.evaluate(async () => {
    const api = (window as unknown as Win).__OREKENOID__;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    return api.state.arena.balls.some((ball: any) => ball.served);
  });
  expect(aimGate, "served before the sequence taught aiming").toBe(false);

  const aimedBefore = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.arena.serveAim);
  await page.keyboard.down("KeyE");
  await page.waitForTimeout(320);
  await page.keyboard.up("KeyE");
  const aimedAfter = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.arena.serveAim);
  expect(Math.abs(aimedAfter - aimedBefore), "Q/E did not steer the serve").toBeGreaterThan(0.05);

  // Serve, then the serve hint retires itself.
  await page.keyboard.press("Space");
  await page.waitForTimeout(250);
  const hintsAfterServe = await page.locator("#instructions").innerText();
  expect(hintsAfterServe).not.toContain("serve");

  // Move the paddle and read the Atlas to finish the checklist, then the panel
  // retires permanently. The Atlas is readable mid-arena by design.
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyD");

  // The sequence still owes two rungs before the Atlas: aiming a serve, which only happens
  // pre-serve, and the optional speed controls, which dismiss themselves once the claim is over.
  await page.waitForFunction(() => {
    const done = (window as unknown as Win).__OREKENOID__.game.tutorial
      .filter((step: any) => step.done).map((step: any) => step.id);
    return done.includes("paddle");
  }, null, { timeout: 10_000 });
  // Then wait for the sequence to reach the Atlas rung. The optional speed step gets there either
  // by being demonstrated or by dismissing itself when the claim ends.
  await page.waitForFunction(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return game.tutorial.find((step: any) => !step.done)?.id === "atlas";
  }, null, { timeout: 25_000 });

  await page.keyboard.press("KeyM");
  await expect(page.locator("#atlas")).toHaveClass(/open/);
  await page.keyboard.press("KeyM");
  await expect(page.locator("#atlas")).not.toHaveClass(/open/);
  const checklist = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return { done: game.tutorial.filter((step: any) => step.done).length, total: game.tutorial.length };
  });
  expect(checklist.done).toBe(checklist.total);
  await expect(page.locator("#tutorial")).toHaveCount(0, { timeout: 10_000 });

  // Resolution charges load only for liable material, and landmarks survive.
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.forceLoss());
  await page.waitForFunction(() => (window as unknown as Win).__OREKENOID__.state.mode === "survey", null, { timeout: 30_000 });
  const afterLoss = await page.evaluate(() => {
    const state = (window as unknown as Win).__OREKENOID__.state;
    const cells = (window as unknown as Win).__OREKENOID__.world.generated.cells.flat();
    return {
      integrity: state.integrity,
      maxIntegrity: state.maxIntegrity,
      persistentStillSolid: cells.filter((cell: any) => cell.persistent && cell.solid).length,
    };
  });
  expect(afterLoss.integrity).toBeLessThan(afterLoss.maxIntegrity);
  // Generator contract 7: claim resolution never exhausts a landmark.
  expect(afterLoss.persistentStillSolid).toBeGreaterThan(0);

  // --- Mirrorreef: orientation is the decision ----------------------------
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.warpTo(170, 40));
  await expect(page.locator("#biomeLabel")).toHaveText(/MIRRORREEF|BRIGHT FAULT/);
  const reef = await page.evaluate(() => {
    const world = (window as unknown as Win).__OREKENOID__.world;
    let facets = 0;
    let charged = 0;
    for (const cell of world.generated.cells.flat()) {
      if (!cell.solid) continue;
      if (cell.kind === "facet") facets++;
      if (cell.kind === "chargedFacet") charged++;
    }
    return { facets, charged, region: world.readRegion(170, 40).regionName };
  });
  expect(reef.facets).toBeGreaterThan(100);
  expect(reef.charged).toBeGreaterThan(0);
  await page.screenshot({ path: "webgl-mirrorreef.png", fullPage: true });

  // --- Rootwarren ---------------------------------------------------------
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.warpTo(150, 120));
  const root = await page.evaluate(() => {
    const world = (window as unknown as Win).__OREKENOID__.world;
    const reading = world.readRegion(150, 120);
    let living = 0;
    let spores = 0;
    let sulfur = 0;
    for (const cell of world.generated.cells.flat()) {
      if (!cell.solid) continue;
      if (cell.kind === "living") living++;
      if (cell.kind === "sporeBulb") spores++;
      if (cell.resource === "sulfur") sulfur++;
    }
    return { band: reading.band, dials: reading.dials, living, spores, sulfur };
  });
  expect(root.band).toBe(4);
  expect(root.living).toBeGreaterThan(50);
  expect(root.spores).toBeGreaterThan(0);
  expect(root.sulfur).toBeGreaterThan(0);
  // Deep claims are denser and more volatile than shallow ones.
  expect(root.dials.density).toBeGreaterThan(0.6);
  await page.screenshot({ path: "webgl-rootwarren.png", fullPage: true });

  // --- Cargo, banking and death -------------------------------------------
  // Away from the bank, cargo stays in hand and is flagged as at risk.
  await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    api.warpTo(60, 30);
    api.giveResource("copper", 40);
    api.giveResource("coal", 40);
    api.giveResource("iron", 40);
  });
  await expect(page.locator("#cargo .cargo-item")).toHaveCount(3);
  await expect(page.locator("#cargo")).toHaveClass(/at-risk/);
  const unbanked = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    // Cargo cannot be spent: recipes are priced against the bank.
    return { carried: api.game.economy.carriedTotal, banked: api.game.economy.amount("copper") };
  });
  expect(unbanked.carried).toBe(120);
  expect(unbanked.banked).toBe(0);

  // Dying away from the bank costs the whole hold.
  const death = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    api.kill();
    return {
      carried: api.game.economy.carriedTotal,
      deaths: api.game.deaths,
      health: api.state.integrity,
      maxHealth: api.state.maxIntegrity,
      atLanding: Math.hypot(api.game.player.x / 42 - api.world.start.x, api.game.player.y / 42 - api.world.start.y) < 1,
    };
  });
  expect(death.carried).toBe(0);
  expect(death.deaths).toBe(1);
  // Respawn is at the Landing, at full health.
  expect(death.atLanding).toBe(true);
  expect(death.health).toBe(death.maxHealth);

  // Reaching the bank deposits automatically, which is what makes it spendable.
  const banked = await page.evaluate(async () => {
    const api = (window as unknown as Win).__OREKENOID__;
    api.warpTo(60, 30);
    api.giveResource("copper", 40);
    api.giveResource("coal", 40);
    api.giveResource("iron", 40);
    api.warpTo(21, 15);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { carried: api.game.economy.carriedTotal, copper: api.game.economy.amount("copper") };
  });
  expect(banked.carried).toBe(0);
  expect(banked.copper).toBe(40);
  await expect(page.locator("#cargo")).not.toHaveClass(/at-risk/);

  // Arriving at the bank with a haul opens the bay by itself. That is the moment the player is
  // asking what the haul bought, and answering it unprompted is the difference between a menu you
  // have to remember to visit and a beat in the loop.
  await expect(page.locator(".viewport")).toHaveAttribute("data-mode", "forge");
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.bayModel().open)).toBe(true);

  // --- The Refit Bay -------------------------------------------------------
  // The bay is drawn inside the canvas as a picture of the drone, not as a DOM panel, so this
  // asserts the model the view is handed plus the fact that the HUD gets out of the way.
  const bay = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.bayModel());
  expect(bay.open).toBe(true);
  // Six places on the machine and three hulls in the berth. Not a catalogue of recipes.
  expect(bay.stations).toHaveLength(6);
  expect(bay.hulls).toHaveLength(3);
  // Opening always points at something: a bay that opens on nothing is the failure the old
  // panel committed every time.
  expect(bay.selected).not.toBeNull();
  for (const station of bay.stations) {
    expect(station.name, "a station with no name").toBeTruthy();
    // Every station says where to look on the machine, which is what the leader line draws to.
    expect(station.mount, `${station.id} has no mount`).toBeTruthy();
    expect(station.ladder, `${station.id} has no ladder`).toBeGreaterThan(0);
    if (station.next) {
      expect(station.next.cost.length, `${station.id} costs nothing`).toBeGreaterThan(0);
      // Costs carry both sides, so a shortfall can be a number rather than a colour.
      for (const cost of station.next.cost) expect(typeof cost.have).toBe("number");
    }
  }
  expect(bay.stations.filter((station: any) => station.affordable).length).toBeGreaterThan(0);
  expect(bay.bank.length).toBeGreaterThan(0);

  // Selecting a station previews its next grade on the machine.
  const previewed = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    api.selectStation("plating");
    return api.bayModel().selected;
  });
  expect(previewed).toBe("plating");

  // The HUD must not sit on top of the bay now that the bay lives in the canvas.
  const hudHidden = await page.evaluate(() => {
    const hidden = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return true;
      const style = getComputedStyle(element);
      return style.visibility === "hidden" || Number(style.opacity) === 0;
    };
    return { top: hidden(".hud-top"), bottom: hidden(".hud-bottom"), tutorial: hidden(".tutorial") };
  });
  expect(hudHidden).toEqual({ top: true, bottom: true, tutorial: true });

  await page.screenshot({ path: "webgl-forge.png", fullPage: true });

  // A digit fits that station. The upgrade lands in state immediately and the fitting sequence
  // is a reading of it afterwards, so the armour is up before the arm has finished moving --
  // which is deliberate: the animation must never be the thing that owns whether a part is on.
  const armorBefore = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.soakCapacity);
  await page.keyboard.press("Digit1");
  const armorAfter = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.soakCapacity);
  expect(armorAfter).toBeGreaterThan(armorBefore);

  // Upgrading may sharpen a verb but never grant one.
  const verbsAfterForging = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.verbs);
  expect(verbsAfterForging).toEqual([]);

  // Let the fit finish: while it runs, any key lands the sequence rather than doing its usual
  // job, so Escape would skip rather than close.
  await page.waitForFunction(() => !(window as unknown as Win).__OREKENOID__.game.gantry.fitting,
    null, { timeout: 5_000 });
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as unknown as Win).__OREKENOID__.bayModel().open)).toBe(false);
  await expect(page.locator(".viewport")).toHaveAttribute("data-mode", "survey");

  // --- Trajectory line, ore pull, and the forge compass --------------------
  const gameplay = await page.evaluate(async () => {
    const api = (window as unknown as Win).__OREKENOID__;
    const game = api.game;
    // Out of range, the forge key raises an edge compass rather than only a refusal.
    api.warpTo(60, 30);
    await new Promise((resolve) => setTimeout(resolve, 120));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyC", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const compass = document.querySelector("#forgeCompass");
    return {
      compassShown: compass?.classList.contains("show") ?? false,
      compassText: document.querySelector("#forgeCompassRange")?.textContent ?? "",
      forgeClosed: !(window as unknown as Win).__OREKENOID__.bayModel().open,
      baseSalvageTax: game.salvageTax,
      baseBounces: game.predictedBounces,
    };
  });
  // Pressing the forge key out of range must not open the forge.
  expect(gameplay.forgeClosed).toBe(true);
  expect(gameplay.compassShown).toBe(true);
  expect(gameplay.compassText).toMatch(/\d+m/);
  // The drone always pulls a little, and predicts only the current leg by default.
  // A bare machine has no salvage drone and no predicted rebounds: both are things you fit.
  expect(gameplay.baseSalvageTax).toBe(0);
  expect(gameplay.baseBounces).toBe(0);

  const optics = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    const before = { tax: api.game.salvageTax, bounces: api.game.predictedBounces };
    api.giveResource("cobalt", 60);
    api.giveResource("emerald", 30);
    api.giveResource("coal", 60);
    api.giveResource("copper", 40);
    api.bankAll();
    // The mast reaches optics at grade two, and the salvage drone appears at grade one.
    api.game.economy.upgrade(api.game.chassis.id, "mast");
    api.game.economy.upgrade(api.game.chassis.id, "mast");
    api.game.economy.upgrade(api.game.chassis.id, "salvage");
    return { before, tax: api.game.salvageTax, bounces: api.game.predictedBounces };
  });
  expect(optics.bounces).toBeGreaterThan(optics.before.bounces);
  // No drone means no tax; fitting one means it takes a cut, which is the whole trade.
  expect(optics.before.tax).toBe(0);
  expect(optics.tax).toBeGreaterThan(0);

  // --- A cornerstone verb turns on Survey Resonance ------------------------
  await expect(page.locator("#resonance")).not.toHaveClass(/open/);
  // The Twin Engine's verb adds a third ball on top of the default two.
  const ballGrant = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    const before = api.game.arenaBalls;
    api.grantVerb("sequentialBall");
    return { before, after: api.game.arenaBalls };
  });
  expect(ballGrant.before).toBe(2);
  expect(ballGrant.after).toBe(3);

  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.grantVerb("surveyResonance"));
  await expect(page.locator("#resonance")).toHaveClass(/open/);
  await expect(page.locator("#resonance")).toContainText("DENSITY");
  await expect(page.locator("#resonance")).toContainText("VOLATILITY");
  await expect(page.locator("#resonance")).toContainText("YIELD");
  // Resonance reports grades, never contents.
  const resonanceText = await page.locator("#resonance").innerText();
  expect(resonanceText).not.toMatch(/copper|iron|coal|slate/i);
  await page.screenshot({ path: "webgl-resonance.png", fullPage: true });

  expect(errors).toEqual([]);
});
