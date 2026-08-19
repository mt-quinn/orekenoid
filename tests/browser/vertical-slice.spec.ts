import { expect, test } from "@playwright/test";

type Win = Window & typeof globalThis & { __OREKENOID__: any };

test("deployment previews, generated world, province rules, and the crafting chain", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as Win).__OREKENOID__), null, { timeout: 90_000 });
  // The caverns are inhabited now, and this walkthrough is about the world, the economy and the
  // crafting chain rather than about combat. Left running, a Bounder can reach the drone mid-tour and
  // kill it -- which loses the cargo the banking rung needs, and fails the tour on something it is not
  // testing. Combat has its own spec.
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.setSpawning(false));
  await expect(page.locator("#briefing")).toHaveAttribute("data-render-state", "ready");
  await expect(page.locator("#briefing")).not.toHaveClass(/loading|failed/);
  await expect(page.locator(".game-canvas")).toBeVisible();
  // Armed from the first frame: there is no chassis to choose any more, so there is nothing to wait for.
  await expect(page.locator("#beginButton")).toBeEnabled();

  // --- Deployment previews -------------------------------------------------
  // These run the production Arena, terrain raster, brick, paddle, ball and
  // collision code. They must never regress to a stub or a second renderer.
  //
  // The start screen no longer shows them -- there is no chassis choice to illustrate -- but the code is
  // kept and so is this coverage, which is the whole reason the previews exist as a test surface. The
  // hosts the previews attach to are supplied here instead of by the briefing markup, sized explicitly
  // because a zero-height host renders a zero-pixel board and would pass every assertion below.
  // Detached from the start screen, still built and still drawn.
  //
  // There is no chassis choice at deployment any more, so there are no cards and no canvases to check
  // the layout of. What this section is actually for survives that: the previews still construct three
  // real Arenas through the production terrain raster, brick, paddle and ball code, and the assertions
  // below are the ones that would catch it regressing to a stub.
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
  // Material variety, read off the arenas rather than off the cards. The sampled frame is the Berth
  // and the Seal, which are chalk by design -- the slate in the hand-drawn Landing is out on the
  // Gallery's island, past the door, and not in view of the drone's starting position.
  const previewKinds = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return game.deploymentPreviews.arenas.map((arena: any) => ({
      bricks: arena.bricks.length,
      hasTerrainAndArena: arena.container.children.length >= 2,
      kinds: [...new Set(arena.bricks.map((brick: any) => brick.kind))].sort(),
    }));
  });
  expect(previewKinds).toHaveLength(3);
  for (const preview of previewKinds) {
    expect(preview.bricks).toBeGreaterThan(20);
    expect(preview.hasTerrainAndArena).toBe(true);
    expect(preview.kinds).toContain("chalk");
  }

  const viewportFit = await page.locator("#gameHost").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, innerWidth, innerHeight };
  });
  expect(viewportFit.width).toBeLessThanOrEqual(viewportFit.innerWidth);
  expect(viewportFit.height).toBeLessThanOrEqual(viewportFit.innerHeight);
  expect(viewportFit.width / viewportFit.height).toBeCloseTo(16 / 9, 2);

  await expect(page.locator("#beginLabel")).toHaveText("DEPLOY");
  await page.screenshot({ path: "webgl-opening.png", fullPage: true });

  await page.click("#beginButton");
  await expect(page.locator("#briefing")).toHaveClass(/hidden/);

  // --- The opening sequence --------------------------------------------------
  // One rung at a time, taught by doing. There is no DOM panel any more: the prompt is drawn in
  // the world on the thing it is talking about, so what is asserted is where it is pointing and
  // what it is asking for, not a box in a corner.
  await expect(page.locator("#tutorial")).toHaveCount(0);
  const firstPrompt = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const prompt = game.coach.prompt;
    return prompt && { goal: prompt.goal, keys: prompt.keys, x: prompt.x, y: prompt.y };
  });
  expect(firstPrompt?.goal).toBe("FLY THE DRONE");
  // Anchored on the drone itself, which is the whole point of the rewrite.
  const dronePos = await page.evaluate(() => {
    const player = (window as unknown as Win).__OREKENOID__.game.player;
    return { x: player.x, y: player.y };
  });
  expect(Math.hypot((firstPrompt?.x ?? 0) - dronePos.x, (firstPrompt?.y ?? 0) - dronePos.y)).toBeLessThan(1);

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
  // Moving hands the sequence straight to the door. Turning the frame and committing it are one rung,
  // and the Atlas is taught after the Seal is cut, where there is more world than the player can see.
  await page.waitForFunction(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return game.coach.prompt?.goal === "FIT THE FRAME TO THE SEAL";
  }, null, { timeout: 5_000 });

  // The first claim is the door, so the frame has to be on the door. Fly into reach -- from the Berth's
  // middle the Seal's far edge is past the frame's depth -- and turn until it is covered.
  await page.evaluate(() => {
    const hook = (window as unknown as { __OREKENOID__: any }).__OREKENOID__;
    const game = hook.game;
    hook.warpTo(30, 14.5);
    for (let index = 0; index < 720; index++) {
      game.player.heading = (index / 720) * Math.PI * 2;
      if (game.frameCoversSeal(game.frameGeometry())) return;
    }
  });
  await page.waitForTimeout(250);
  const commitAnchor = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const prompt = game.coach.prompt;
    return {
      distance: Math.hypot((prompt?.x ?? 0) - game.player.x, (prompt?.y ?? 0) - game.player.y),
      ring: prompt?.ring === true,
    };
  });
  expect(commitAnchor.distance).toBeGreaterThan(20);
  expect(commitAnchor.ring).toBe(true);
  const surveyAfter = await page.evaluate(() => (window as unknown as Win).__OREKENOID__.game.player.heading);
  expect(Math.abs(surveyAfter - surveyBefore.heading)).toBeGreaterThan(0.15);
  expect(Math.abs(surveyAfter / (Math.PI / 2) - Math.round(surveyAfter / (Math.PI / 2)))).toBeGreaterThan(0.05);
  await page.screenshot({ path: "webgl-framing.png", fullPage: true });

  // --- A Karst claim, at a non-cardinal heading ----------------------------
  // Past the opening for the rest of the tour.
  //
  // The Seal-only rule on the first claim is the opening's business, and the opening has already been
  // walked above. Everything from here is about geology, the economy and the crafting chain, and it
  // stakes claims wherever it needs to.
  // Only the commit rung, not the whole sequence. Marking everything done would also hand over the
  // serve, and the gate that refuses a serve before the paddle has been taught is asserted further
  // down -- this needs the Seal rule lifted and nothing else.
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    const commit = game.tutorial.find((step: any) => step.id === "commit");
    if (commit) commit.done = true;
  });

  // The Gallery's ore island, framed from its west face at a heading no axis shares.
  //
  // This used to claim the Berth, which was a speckle of chalk and slate before the Landing was drawn
  // by hand. The Berth is deliberately plain chalk now -- it is a room, not a teaching face -- so the
  // slate this section is about lives on the island past the Seal.
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.player.x = 44 * 42;
    game.player.y = 24.5 * 42;
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

  // Moving the paddle comes first inside a claim: the player holds the thing they control before
  // anything is launched with it. Serving first meant discovering the paddle while a ball was
  // already falling, which is a bad first ten seconds of a new mode.
  const serveGate = await page.evaluate(async () => {
    const api = (window as unknown as Win).__OREKENOID__;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    return api.state.arena.balls.some((ball: any) => ball.served);
  });
  expect(serveGate, "served before the sequence taught the paddle").toBe(false);

  await page.keyboard.down("KeyD");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyD");
  await page.waitForFunction(() => {
    const done = (window as unknown as Win).__OREKENOID__.game.tutorial
      .filter((step: any) => step.done).map((step: any) => step.id);
    return done.includes("paddle");
  }, null, { timeout: 10_000 });

  // Aiming then comes before the serve, because it is the only steering the player has and it
  // stops working the instant the ball is live.
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

  // Resolution charges load only for liable material, and landmarks survive.
  await page.evaluate(() => (window as unknown as Win).__OREKENOID__.forceLoss());
  await page.waitForFunction(() => (window as unknown as Win).__OREKENOID__.state.mode === "survey", null, { timeout: 30_000 });

  const afterLoss = await page.evaluate(() => {
    const state = (window as unknown as Win).__OREKENOID__.state;
    const cells = (window as unknown as Win).__OREKENOID__.world.generated.cells.flat();
    return {
      integrity: state.integrity,
      maxIntegrity: state.maxIntegrity,
      persistentCells: cells.filter((cell: any) => cell.persistent).length,
    };
  });
  expect(afterLoss.integrity).toBeLessThan(afterLoss.maxIntegrity);
  // Generator contract 7 used to be "claim resolution never exhausts a landmark", enforced by making
  // authored structure indestructible. That was withdrawn: a wall the player can neither see through,
  // break, nor walk past is an obstruction rather than a landmark, and the Refit Bay's own lander was
  // sealing off most of the bay. Nothing in the world is persistent now, and the contract is the
  // absence of it.
  expect(afterLoss.persistentCells).toBe(0);

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
    // The chest, on the Berth's west wall. It sat three cells from the spawn point before the Landing
    // was drawn by hand; it is a short flight across the room now.
    api.warpTo(14, 16);
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
    return { top: hidden(".hud-top"), bottom: hidden(".hud-bottom") };
  });
  expect(hudHidden).toEqual({ top: true, bottom: true });

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

  // Last, because banking moves ore into the banked stock and an earlier assertion in this
  // walkthrough checks that nothing has been banked yet -- better to run the rung at the end than to
  // reach into the economy afterwards and hide the side effect.
  //
  // The last rung of the sequence is taking a haul home, and it completes by *banking* rather than
  // by a keypress -- it teaches a place, not a control -- so the walkthrough has to fly there. Done
  // here rather than mid-claim because banking only happens out in the survey, and the only way out
  // of a claim that keeps the hold is to finish it. Ore is added explicitly so the rung is reachable
  // whatever the board happened to drop.
  await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    game.economy.add("copper", 3);
    // Every rung but the last is settled here rather than played out.
    //
    // What this section is for is the *final* rung and what happens when the sequence ends: banking
    // completes it without a keypress, and the prompt then goes away for good. The rungs before it --
    // meeting a Bounder on the paddle's face, reading the liability number off an overloaded board,
    // holding to speed up a long tail -- are the opening's subject and are covered in their own specs,
    // and playing all of them out here would make this a second tutorial test with a world tour
    // attached.
    for (const step of game.tutorial) {
      if (step.id !== "bank") step.done = true;
    }
    // The chest on the Berth's west wall.
    game.player.x = 14 * 42;
    game.player.y = 16 * 42;
  });
  await page.waitForFunction(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return game.tutorial.every((step: any) => step.done);
  }, null, { timeout: 25_000 });
  const checklist = await page.evaluate(() => {
    const game = (window as unknown as Win).__OREKENOID__.game;
    return { done: game.tutorial.filter((step: any) => step.done).length, total: game.tutorial.length };
  });
  expect(checklist.done).toBe(checklist.total);
  // Finished means gone: the prompt fades out and stops claiming a subject.
  await page.waitForFunction(
    () => (window as unknown as Win).__OREKENOID__.game.coach.prompt === null,
    null, { timeout: 10_000 },
  );




  expect(errors).toEqual([]);
});
