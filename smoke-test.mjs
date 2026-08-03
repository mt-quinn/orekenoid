import { chromium } from "/Users/quinn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForArenaAligned() {
  await page.waitForFunction(() => {
    const state = window.__BOUNCEWORLD_DEBUG__.state;
    return state.mode === "play" && state.arena && !state.camera.transition && !state.arena.resolving;
  }, null, { timeout: 3000 });
}

async function waitForRoam() {
  await page.waitForFunction(() => {
    const state = window.__BOUNCEWORLD_DEBUG__.state;
    return state.mode === "roam" && !state.arena && !state.camera.transition && Math.abs(state.camera.rotation) < .001;
  }, null, { timeout: 3000 });
}

async function forceArenaLoss() {
  await page.evaluate(() => {
    const arena = window.__BOUNCEWORLD_DEBUG__.state.arena;
    for (const ball of arena.balls) {
      ball.served = true;
      ball.u = arena.width / 2 - .35;
      ball.v = -1;
      ball.vv = -9;
    }
  });
  await waitForRoam();
}

async function positionAtSurface(kinds, biome = null) {
  return page.evaluate(({ kinds, biome }) => {
    const debug = window.__BOUNCEWORLD_DEBUG__;
    const { state, world } = debug;
    const directions = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
    ];
    const biomeAt = (x, y) => (x > 73 + Math.sin(y * .2) * 4 && y > 34 ? "brood" : "mine");
    const width = 7;
    const depth = 8;
    for (let y = 4; y < world.length - 4; y++) {
      for (let x = 4; x < world[0].length - 4; x++) {
        const tile = world[y][x];
        if (!tile.solid || !kinds.includes(tile.kind) || (biome && biomeAt(x, y) !== biome)) continue;
        for (let direction = 0; direction < directions.length; direction++) {
          const d = directions[direction];
          const px = x - d.x;
          const py = y - d.y;
          if (world[py]?.[px]?.solid) continue;
          const side = { x: -d.y, y: d.x };
          let solid = 0;
          let total = 0;
          for (let v = 1; v <= depth; v++) {
            for (let u = -Math.floor(width / 2); u <= Math.floor(width / 2); u++) {
              const tx = Math.floor(px + .5 + side.x * u + d.x * v);
              const ty = Math.floor(py + .5 + side.y * u + d.y * v);
              total++;
              if (world[ty]?.[tx]?.solid) solid++;
            }
          }
          if (solid / total <= .42) continue;
          state.player.x = (px + .5) * 24;
          state.player.y = (py + .5) * 24;
          state.player.direction = direction;
          state.frame.width = width;
          state.frame.depth = depth;
          return { x, y, px, py, direction, kind: tile.kind, ratio: solid / total };
        }
      }
    }
    return null;
  }, { kinds, biome });
}

async function commitAtSurface(kinds, biome = null) {
  const surface = await positionAtSurface(kinds, biome);
  assert(surface, `No valid ${kinds.join("/")} surface found`);
  await page.keyboard.press("KeyF");
  await page.keyboard.press("Enter");
  await waitForArenaAligned();
  const mode = await page.evaluate(() => window.__BOUNCEWORLD_DEBUG__.state.mode);
  assert(mode === "play", `Commit failed at ${surface.kind} surface`);
  return surface;
}

await page.goto("http://127.0.0.1:8080", { waitUntil: "domcontentloaded" });
await page.screenshot({ path: "prototype-start.png", fullPage: true });
await page.click("#beginButton");

const topology = await page.evaluate(() => {
  const { world } = window.__BOUNCEWORLD_DEBUG__;
  const start = { x: 34, y: 22 };
  const target = { x: 94, y: 58 };
  const barriers = [
    { cx: 47, cy: 30 }, { cx: 63, cy: 39 }, { cx: 74, cy: 46 },
  ];
  function reaches(withBarriersRemoved) {
    const key = (x, y) => `${x},${y}`;
    const removed = (x, y) => withBarriersRemoved && barriers.some(({ cx, cy }) => Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 5);
    const queue = [start];
    const seen = new Set([key(start.x, start.y)]);
    while (queue.length) {
      const current = queue.shift();
      if (current.x === target.x && current.y === target.y) return { reachable: true, tiles: seen.size };
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = current.x + dx;
        const y = current.y + dy;
        if (!world[y]?.[x] || (world[y][x].solid && !removed(x, y)) || seen.has(key(x, y))) continue;
        seen.add(key(x, y));
        queue.push({ x, y });
      }
    }
    return { reachable: false, tiles: seen.size };
  }
  return { initial: reaches(false), afterClaims: reaches(true) };
});
assert(!topology.initial.reachable, "The player can walk to the Brood without establishing mining claims");
assert(topology.afterClaims.reachable, "Clearing the three authored cave plugs does not connect the expedition route");

await page.keyboard.press("KeyL");
assert(await page.locator("#labPanel").getAttribute("aria-hidden") === "false", "Power Lab keyboard toggle did not open");
await page.keyboard.press("KeyL");

// Framing remains mobile: WASD translates the player/frame without resizing or
// changing the paddle's fixed relationship to the frame.
await page.evaluate(() => {
  const { state } = window.__BOUNCEWORLD_DEBUG__;
  state.player.x = 34.5 * 24;
  state.player.y = 22.5 * 24;
  state.player.direction = 1;
  state.frame.width = 11;
  state.frame.depth = 12;
});
await page.keyboard.press("KeyF");
const beforeFrameMove = await page.evaluate(() => {
  const { state } = window.__BOUNCEWORLD_DEBUG__;
  return { x: state.player.x, y: state.player.y, direction: state.player.direction, width: state.frame.width, depth: state.frame.depth };
});
await page.keyboard.down("KeyD");
await page.waitForTimeout(220);
await page.keyboard.up("KeyD");
const afterFrameMove = await page.evaluate(() => {
  const { state } = window.__BOUNCEWORLD_DEBUG__;
  return { x: state.player.x, y: state.player.y, direction: state.player.direction, width: state.frame.width, depth: state.frame.depth };
});
assert(afterFrameMove.x > beforeFrameMove.x, "WASD did not move the player/frame while framing");
assert(afterFrameMove.width === beforeFrameMove.width && afterFrameMove.depth === beforeFrameMove.depth, "Moving in frame mode resized the frame");
assert(afterFrameMove.direction === beforeFrameMove.direction, "Moving in frame mode changed the paddle's frame relationship");
await page.keyboard.press("KeyR");
const afterFrameRotate = await page.evaluate(() => {
  const { state } = window.__BOUNCEWORLD_DEBUG__;
  return { x: state.player.x, y: state.player.y, direction: state.player.direction, width: state.frame.width, depth: state.frame.depth };
});
assert(afterFrameRotate.direction === (afterFrameMove.direction + 1) % 4, "R did not rotate the frame while framing");
assert(afterFrameRotate.x === afterFrameMove.x && afterFrameRotate.y === afterFrameMove.y, "Rotating the frame moved the player anchor");
assert(afterFrameRotate.width === afterFrameMove.width && afterFrameRotate.depth === afterFrameMove.depth, "Rotating the frame changed its dimensions");
await page.keyboard.press("Escape");

// The preview exposes anonymous coordinates for buried items while preserving
// their hidden state and omitting item identity from the preview data.
const signalSurface = await positionAtSurface(["ore"], "mine");
assert(signalSurface, "No hidden-item framing surface found");
await page.keyboard.press("KeyF");
const frameSignals = await page.evaluate(() => {
  const debug = window.__BOUNCEWORLD_DEBUG__;
  const signals = debug.getFramedHiddenItems();
  return {
    count: signals.length,
    anonymous: signals.every((signal) => !("kind" in signal)),
    remainHidden: signals.every(({ x, y }) => debug.world[y][x].hidden),
  };
});
assert(frameSignals.count > 0, "Framing did not reveal any buried item locations");
assert(frameSignals.anonymous, "Framing preview exposed buried item identity");
assert(frameSignals.remainHidden, "Framing preview changed tile reveal state before commitment");
await page.screenshot({ path: "prototype-frame-signals.png", fullPage: true });
await page.keyboard.press("Escape");

// Every world orientation is presented in one canonical play orientation: the
// paddle below the arena and local forward pointing toward the top of screen.
const orientationViews = [];
let entryTransitionProbe = null;
for (let direction = 0; direction < 4; direction++) {
  await page.evaluate((direction) => {
    const { state } = window.__BOUNCEWORLD_DEBUG__;
    state.player.x = 34.5 * 24;
    state.player.y = 22.5 * 24;
    state.player.direction = direction;
    state.frame.width = 5;
    state.frame.depth = 6;
  }, direction);
  await page.keyboard.press("KeyF");
  await page.keyboard.press("Enter");
  if (direction === 1) {
    await page.waitForTimeout(120);
    const focus = await page.evaluate(() => {
      const { camera } = window.__BOUNCEWORLD_DEBUG__.state;
      return { phase: camera.transition?.phase, rotation: camera.rotation };
    });
    assert(focus.phase === "focus-in" && Math.abs(focus.rotation) < .001, `Entry rotated during its centering phase: ${JSON.stringify(focus)}`);
    await page.waitForFunction(() => window.__BOUNCEWORLD_DEBUG__.state.camera.transition?.phase === "rotate-in");
    const rotateStart = await page.evaluate(() => {
      const { camera } = window.__BOUNCEWORLD_DEBUG__.state;
      return { x: camera.x, y: camera.y, rotation: camera.rotation };
    });
    await page.waitForTimeout(150);
    const rotateMid = await page.evaluate(() => {
      const { camera } = window.__BOUNCEWORLD_DEBUG__.state;
      return { phase: camera.transition?.phase, x: camera.x, y: camera.y, rotation: camera.rotation };
    });
    assert(rotateMid.phase === "rotate-in" && Math.abs(rotateMid.x - rotateStart.x) < .1 && Math.abs(rotateMid.y - rotateStart.y) < .1, `Arena center moved during view rotation: ${JSON.stringify({ rotateStart, rotateMid })}`);
    assert(Math.abs(rotateMid.rotation) > .05, "Arena rotation did not progress during rotate-in");
    entryTransitionProbe = { focus, rotateStart, rotateMid };
  }
  await waitForArenaAligned();
  await page.waitForTimeout(260);
  const view = await page.evaluate(() => {
    const { state } = window.__BOUNCEWORLD_DEBUG__;
    const d = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }][state.arena.direction];
    const cos = Math.cos(state.camera.rotation);
    const sin = Math.sin(state.camera.rotation);
    return {
      direction: state.arena.direction,
      rotation: state.camera.rotation,
      screenForward: { x: d.x * cos - d.y * sin, y: d.x * sin + d.y * cos },
    };
  });
  assert(Math.abs(view.screenForward.x) < .001 && view.screenForward.y < -.999, `Arena ${direction} was not aligned upward: ${JSON.stringify(view)}`);
  orientationViews.push(view);
  if (direction === 1) await page.screenshot({ path: "prototype-east-aligned.png", fullPage: true });
  await forceArenaLoss();
}

// Baseline claim: verify the new collection model still starts with one ball.
const baseSurface = await commitAtSurface(["rock", "ore"], "mine");
const baseline = await page.evaluate(() => {
  const { state } = window.__BOUNCEWORLD_DEBUG__;
  return {
    mode: state.mode,
    balls: state.arena.balls.length,
    bricks: state.arena.bricks.length,
    served: state.arena.balls[0].served,
    objective: document.querySelector("#objectiveTitle")?.textContent,
  };
});
assert(baseline.balls === 1, "Baseline arena did not begin with exactly one ball");
assert(baseline.bricks > 0, "Baseline arena contains no bricks");
await page.keyboard.press("Space");
await page.waitForTimeout(160);
const served = await page.evaluate(() => window.__BOUNCEWORLD_DEBUG__.state.arena?.balls[0]?.served);
assert(served, "Space did not serve the baseline ball");
await page.screenshot({ path: "prototype-breakout-polish.png", fullPage: true });
await forceArenaLoss();

// Arena selection is the player's wager. Open space, sparse rock, and poor board
// composition must never be rejected as long as the rectangle stays in the world.
await page.evaluate(() => {
  const { state } = window.__BOUNCEWORLD_DEBUG__;
  state.player.x = 34.5 * 24;
  state.player.y = 22.5 * 24;
  state.player.direction = 1;
  state.frame.width = 5;
  state.frame.depth = 6;
});
await page.keyboard.press("KeyF");
await page.keyboard.press("Enter");
await waitForArenaAligned();
const arbitraryClaim = await page.evaluate(() => {
  const { state } = window.__BOUNCEWORLD_DEBUG__;
  return {
    mode: state.mode,
    bricks: state.arena?.bricks.length ?? -1,
    totalCells: (state.arena?.width ?? 0) * (state.arena?.depth ?? 0),
  };
});
assert(arbitraryClaim.mode === "play", `A technically valid player-chosen field was rejected: ${JSON.stringify(arbitraryClaim)}`);
await page.keyboard.press("Space");
await page.waitForTimeout(80);
if (await page.evaluate(() => window.__BOUNCEWORLD_DEBUG__.state.mode === "play")) {
  await forceArenaLoss();
}

// Persistent landmark contract: an unbroken heart may not be consumed on loss.
const heartSurface = await commitAtSurface(["heart"], "brood");
const heartInArena = await page.evaluate(() => {
  const bricks = window.__BOUNCEWORLD_DEBUG__.state.arena.bricks;
  const heart = bricks.find((candidate) => candidate.kind === "heart");
  const divider = bricks.find((candidate) => candidate.kind === "divider" && candidate.persistent);
  return heart ? { heart: { x: heart.x, y: heart.y }, divider: divider ? { x: divider.x, y: divider.y } : null } : null;
});
assert(heartInArena, "Heart surface claim did not include a heart node");
assert(heartInArena.divider, "Heart surface claim did not include a regenerative division cell");
await page.keyboard.press("Space");
await forceArenaLoss();
const landmarkPersisted = await page.evaluate(({ heart, divider }) => ({
  heart: window.__BOUNCEWORLD_DEBUG__.world[heart.y][heart.x].solid,
  divider: window.__BOUNCEWORLD_DEBUG__.world[divider.y][divider.x].solid,
}), heartInArena);
const heartPersisted = landmarkPersisted.heart;
assert(heartPersisted, "A failed claim consumed an unbroken progression heart");
assert(landmarkPersisted.divider, "A failed claim consumed the heart's required division mechanism");

// A genuine heart assault: divide environmentally, then land three swarm hits.
await commitAtSurface(["heart"], "brood");
await page.keyboard.press("Space");
const heartAssaultSetup = await page.evaluate(() => {
  const arena = window.__BOUNCEWORLD_DEBUG__.state.arena;
  const heart = arena.bricks.find((brick) => brick.kind === "heart" && brick.alive);
  const divider = arena.bricks.find((brick) => brick.kind === "divider" && brick.alive);
  if (!divider || !heart) return null;
  const blocker = arena.bricks.find((brick) => brick.alive && Math.abs(brick.u - divider.u) < .01 && Math.abs(brick.v - (divider.v - 1)) < .01);
  if (blocker) blocker.alive = false;
  const ball = arena.balls[0];
  ball.u = divider.u; ball.v = divider.v - .77; ball.vu = 0; ball.vv = 9;
  return { heart: { x: heart.x, y: heart.y } };
});
assert(heartAssaultSetup, "The retry heart arena lacked its regenerated division mechanism");
await page.waitForTimeout(180);
assert(await page.evaluate(() => window.__BOUNCEWORLD_DEBUG__.state.arena.balls.length >= 2), "Heart assault did not create a swarm");
for (let hit = 0; hit < 3; hit++) {
  await page.evaluate(() => {
    const arena = window.__BOUNCEWORLD_DEBUG__.state.arena;
    const heart = arena.bricks.find((brick) => brick.kind === "heart" && brick.alive);
    if (!heart) return;
    const blocker = arena.bricks.find((brick) => brick.alive && Math.abs(brick.u - heart.u) < .01 && Math.abs(brick.v - (heart.v - 1)) < .01);
    if (blocker) blocker.alive = false;
    const ball = arena.balls[0];
    ball.u = heart.u; ball.v = heart.v - .77; ball.vu = 0; ball.vv = 9;
  });
  await page.waitForTimeout(140);
}
const heartAssault = await page.evaluate(({ heart }) => ({
  destroyed: !window.__BOUNCEWORLD_DEBUG__.world[heart.y][heart.x].solid,
  progress: window.__BOUNCEWORLD_DEBUG__.state.heartDestroyed,
}), heartAssaultSetup);
assert(heartAssault.destroyed && heartAssault.progress >= 1, `Swarm hits did not rupture the heart: ${JSON.stringify(heartAssault)}`);
await forceArenaLoss();

// Environmental multiball: striking a division cell should add a second ball.
const dividerSurface = await commitAtSurface(["divider"], "brood");
await page.keyboard.press("Space");
const dividerPresent = await page.evaluate(() => {
  const arena = window.__BOUNCEWORLD_DEBUG__.state.arena;
  const divider = arena.bricks.find((brick) => brick.kind === "divider" && brick.alive);
  if (!divider) return false;
  const blocker = arena.bricks.find((brick) => brick.alive && Math.abs(brick.u - divider.u) < .01 && Math.abs(brick.v - (divider.v - 1)) < .01);
  if (blocker) blocker.alive = false;
  const ball = arena.balls[0];
  ball.u = divider.u;
  ball.v = divider.v - .77;
  ball.vu = 0;
  ball.vv = 9;
  return true;
});
assert(dividerPresent, `Divider surface ${JSON.stringify(dividerSurface)} did not enter the arena`);
await page.waitForTimeout(180);
const environmentalSplit = await page.evaluate(() => window.__BOUNCEWORLD_DEBUG__.state.arena?.balls.length ?? 0);
assert(environmentalSplit >= 2, "Breaking a division cell did not create environmental multiball");
await page.screenshot({ path: "prototype-brood.png", fullPage: true });
await forceArenaLoss();

// Upgrade and return proof: permanent split arms on Shift and fires on paddle contact.
await page.evaluate(() => window.__BOUNCEWORLD_DEBUG__.unlockBrood());
const unlocked = await page.evaluate(() => ({
  multiball: window.__BOUNCEWORLD_DEBUG__.state.upgrades.multiball,
  phase: window.__BOUNCEWORLD_DEBUG__.state.objectivePhase,
}));
assert(unlocked.multiball && unlocked.phase === "return", "Brood completion did not grant permanent multiball and the return objective");

await page.evaluate(() => {
  const { state } = window.__BOUNCEWORLD_DEBUG__;
  state.player.x = 28.5 * 24;
  state.player.y = 22.5 * 24;
  state.player.direction = 3;
  state.frame.width = 7;
  state.frame.depth = 8;
});
await page.keyboard.press("KeyF");
await page.keyboard.press("Enter");
await waitForArenaAligned();
assert(await page.evaluate(() => window.__BOUNCEWORLD_DEBUG__.state.mode === "play"), "Could not establish the Old Mine return claim");
await page.keyboard.press("Space");
await page.keyboard.press("ShiftLeft");
await page.evaluate(() => {
  const arena = window.__BOUNCEWORLD_DEBUG__.state.arena;
  const ball = arena.balls[0];
  ball.u = arena.paddle.u;
  ball.v = .64;
  ball.vu = 0;
  ball.vv = -9;
});
await page.waitForTimeout(100);
const coreSplit = await page.evaluate(() => {
  const arena = window.__BOUNCEWORLD_DEBUG__.state.arena;
  return { balls: arena?.balls.length ?? 0, splitUsed: arena?.splitUsed, splitArmed: arena?.splitArmed };
});
assert(coreSplit.balls === 3 && coreSplit.splitUsed && !coreSplit.splitArmed, `Permanent split failed: ${JSON.stringify(coreSplit)}`);
await page.screenshot({ path: "prototype-core-split.png", fullPage: true });

// Continuous rounded-rectangle collision: a true corner must reflect across a
// radial normal, and a centered seam hit must resolve symmetrically against both
// bricks rather than selecting whichever happens to appear first in the array.
await page.evaluate(() => {
  const { state } = window.__BOUNCEWORLD_DEBUG__;
  const arena = state.arena;
  const ball = arena.balls[0];
  arena.balls = [ball];
  arena.bricks = [
    { u: 0, v: 3, x: 10, y: 10, hp: 2, maxHp: 2, kind: "rock", alive: true, pulse: 0, persistent: false },
    { u: 3, v: 7, x: 11, y: 10, hp: 99, maxHp: 99, kind: "rock", alive: true, pulse: 0, persistent: false },
  ];
  ball.served = true; ball.u = -1; ball.v = 2; ball.vu = Math.SQRT1_2 * 9; ball.vv = Math.SQRT1_2 * 9;
});
await page.waitForTimeout(115);
const cornerCollision = await page.evaluate(() => {
  const arena = window.__BOUNCEWORLD_DEBUG__.state.arena;
  return { vu: arena.balls[0].vu, vv: arena.balls[0].vv, hp: arena.bricks[0].hp };
});
assert(cornerCollision.vu < -1 && cornerCollision.vv < -1 && cornerCollision.hp === 1, `Rounded corner response was not radial: ${JSON.stringify(cornerCollision)}`);

await page.evaluate(() => {
  const arena = window.__BOUNCEWORLD_DEBUG__.state.arena;
  const ball = arena.balls[0];
  arena.bricks = [
    { u: -.5, v: 3, x: 12, y: 10, hp: 2, maxHp: 2, kind: "rock", alive: true, pulse: 0, persistent: false },
    { u: .5, v: 3, x: 13, y: 10, hp: 2, maxHp: 2, kind: "rock", alive: true, pulse: 0, persistent: false },
    { u: 3, v: 7, x: 14, y: 10, hp: 99, maxHp: 99, kind: "rock", alive: true, pulse: 0, persistent: false },
  ];
  ball.u = 0; ball.v = 2; ball.vu = 0; ball.vv = 9; ball.trail = [];
});
await page.waitForTimeout(105);
const seamCollision = await page.evaluate(() => {
  const arena = window.__BOUNCEWORLD_DEBUG__.state.arena;
  return { vu: arena.balls[0].vu, vv: arena.balls[0].vv, hp: arena.bricks.slice(0, 2).map((brick) => brick.hp) };
});
assert(Math.abs(seamCollision.vu) < .2 && seamCollision.vv < -8 && seamCollision.hp.every((hp) => hp === 1), `Simultaneous seam response was asymmetric: ${JSON.stringify(seamCollision)}`);
await forceArenaLoss();

const result = { topology, beforeFrameMove, afterFrameMove, afterFrameRotate, frameSignals, entryTransitionProbe, orientationViews, baseSurface, baseline, arbitraryClaim, heartSurface, landmarkPersisted, heartAssault, dividerSurface, environmentalSplit, unlocked, coreSplit, cornerCollision, seamCollision, consoleErrors };
assert(consoleErrors.length === 0, `Browser errors: ${consoleErrors.join("; ")}`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
