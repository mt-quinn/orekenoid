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
    return game.deploymentPreviews.length === 3
      && game.deploymentPreviews.every((arena: any) => arena.bricks.length > 0 && arena.balls.length === 1);
  });
  const previewAlignment = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return [...document.querySelectorAll<HTMLElement>(".field-window")].map((element, index) => {
      const rect = element.getBoundingClientRect();
      const preview = game.deploymentPreviews[index];
      const bounds = game.deploymentPreviewContent[index].getBounds();
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
  // Large, checked off by doing, then removed from the DOM for good.
  await expect(page.locator("#tutorial")).toBeVisible();
  await expect(page.locator("#tutorialList li")).toHaveCount(5);
  await expect(page.locator("#tutorialList li.done")).toHaveCount(0);

  // --- Generated world -----------------------------------------------------
  const report = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.report);
  expect(report.missingLandingFeatures).toEqual([]);
  expect(report.unreachableRequiredNodes).toEqual([]);
  // Contract 1: essentially all open space is one connected system.
  expect(report.reachableCells / report.openCells).toBeGreaterThan(0.9);
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
  // Moving and aiming tick their own steps off the checklist.
  await expect(page.locator("#tutorialList li.done")).toHaveCount(2);
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

  // Serve, then the serve hint retires itself.
  await page.keyboard.press("Space");
  await page.waitForTimeout(250);
  const hintsAfterServe = await page.locator("#instructions").innerText();
  expect(hintsAfterServe).not.toContain("serve");

  // Move the paddle to finish the checklist, then the panel retires permanently.
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyD");
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

  await page.keyboard.press("KeyC");
  await expect(page.locator("#crafting")).toHaveClass(/open/);
  await expect(page.locator(".viewport")).toHaveAttribute("data-mode", "forge");
  const forge = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#craftingList .craft-card")];
    return {
      cards: cards.length,
      affordable: cards.filter((card) => card.classList.contains("affordable")).length,
      tiers: document.querySelectorAll("#craftingList .forge-tier").length,
      // Every card must lead with its payoff and list its cost.
      allHaveGain: cards.every((card) => !!card.querySelector(".craft-gain b")?.textContent?.trim()),
      allHaveCost: cards.every((card) => card.querySelectorAll(".craft-cost .chip").length > 0),
      bankShown: !!document.querySelector("#forgeBank .bank-item"),
      statsShown: document.querySelectorAll("#forgeStats span").length,
      shortfallMarked: document.querySelectorAll("#craftingList .chip.short").length,
    };
  });
  // The whole tree is visible, not just what the current bank can afford.
  expect(forge.cards).toBeGreaterThanOrEqual(18);
  expect(forge.affordable).toBeGreaterThan(0);
  expect(forge.tiers).toBeGreaterThan(1);
  expect(forge.allHaveGain).toBe(true);
  expect(forge.allHaveCost).toBe(true);
  expect(forge.bankShown).toBe(true);
  expect(forge.statsShown).toBe(3);
  // Unaffordable cards name the material that is short, not just dim themselves.
  expect(forge.shortfallMarked).toBeGreaterThan(0);

  // Every tier is present even with a thin bank.
  expect(forge.tiers).toBe(3);

  // Cards are clickable, not keyboard-only.
  const clickCraft = await page.evaluate(() => {
    const before = (window as unknown as Win).__OREKENOID__.state.soakCapacity;
    const card = document.querySelector<HTMLButtonElement>("#craftingList .craft-card.affordable");
    card?.click();
    return { before, after: (window as unknown as Win).__OREKENOID__.state.soakCapacity };
  });
  expect(clickCraft.after).toBeGreaterThan(clickCraft.before);
  await page.screenshot({ path: "webgl-forge.png", fullPage: true });

  const armorBefore = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.soakCapacity);
  await page.keyboard.press("Digit1");
  const armorAfter = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.soakCapacity);
  expect(armorAfter).toBeGreaterThan(armorBefore);

  // Crafting may sharpen a verb but never grant one.
  const verbsAfterForging = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.state.verbs);
  expect(verbsAfterForging).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#crafting")).not.toHaveClass(/open/);
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
      forgeClosed: !document.querySelector("#crafting")?.classList.contains("open"),
      baseVacuum: game.vacuumRadius,
      baseBounces: game.predictedBounces,
    };
  });
  // Pressing the forge key out of range must not open the forge.
  expect(gameplay.forgeClosed).toBe(true);
  expect(gameplay.compassShown).toBe(true);
  expect(gameplay.compassText).toMatch(/\d+m/);
  // The drone always pulls a little, and predicts only the current leg by default.
  expect(gameplay.baseVacuum).toBeGreaterThan(0);
  expect(gameplay.baseBounces).toBe(0);

  const optics = await page.evaluate(() => {
    const api = (window as unknown as Win).__OREKENOID__;
    const before = { vacuum: api.game.vacuumRadius, bounces: api.game.predictedBounces };
    api.giveResource("cobalt", 60);
    api.giveResource("emerald", 30);
    api.giveResource("coal", 60);
    api.giveResource("copper", 40);
    api.bankAll();
    api.game.economy.craft(api.game.chassis.id, "trajectoryOptics");
    api.game.economy.craft(api.game.chassis.id, "collectorCoil");
    return { before, vacuum: api.game.vacuumRadius, bounces: api.game.predictedBounces };
  });
  expect(optics.bounces).toBeGreaterThan(optics.before.bounces);
  expect(optics.vacuum).toBeGreaterThan(optics.before.vacuum);

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
