(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const modeLabel = document.getElementById("modeLabel");
  const biomeLabel = document.getElementById("biomeLabel");
  const depthLabel = document.getElementById("depthLabel");
  const oreCount = document.getElementById("oreCount");
  const claimValue = document.getElementById("claimValue");
  const claimUnit = document.getElementById("claimUnit");
  const instructions = document.getElementById("instructions");
  const briefing = document.getElementById("briefing");
  const beginButton = document.getElementById("beginButton");
  const toast = document.getElementById("toast");
  const objectivePanel = document.getElementById("objectivePanel");
  const objectiveKicker = document.getElementById("objectiveKicker");
  const objectiveTitle = document.getElementById("objectiveTitle");
  const objectiveDetail = document.getElementById("objectiveDetail");
  const arenaReadout = document.getElementById("arenaReadout");
  const ballCount = document.getElementById("ballCount");
  const comboCount = document.getElementById("comboCount");
  const splitState = document.getElementById("splitState");
  const labPanel = document.getElementById("labPanel");
  const labToggle = document.getElementById("labToggle");
  const closeLab = document.getElementById("closeLab");
  const labMultiball = document.getElementById("labMultiball");
  const labBallCap = document.getElementById("labBallCap");
  const labSpeed = document.getElementById("labSpeed");
  const labWarp = document.getElementById("labWarp");
  const labReset = document.getElementById("labReset");

  const TILE = 24;
  const BRICK_HALF = .42;
  const BRICK_RADIUS = .13;
  const PHYSICS_STEP = 1 / 120;
  const COLLISION_EPSILON = .0008;
  const MAX_CONTACTS_PER_STEP = 8;
  const WORLD_W = 132;
  const WORLD_H = 88;
  const START = { x: 34.5, y: 22.5 };
  const BROOD_HEART = { x: 94.5, y: 58.5 };
  const OLD_VAULT = { x: 25.5, y: 22.5 };
  const DIRECTIONS = [
    { x: 0, y: -1, name: "NORTH" },
    { x: 1, y: 0, name: "EAST" },
    { x: 0, y: 1, name: "SOUTH" },
    { x: -1, y: 0, name: "WEST" },
  ];
  const COLORS = {
    void: "#0b0d0c",
    voidBrood: "#0d100b",
    rock: "#4a463c",
    rockDeep: "#302f2a",
    seam: "#80745d",
    ore: "#e56f3f",
    armor: "#a49a82",
    tissue: "#515b36",
    tissueLight: "#829054",
    divider: "#d9e47a",
    shell: "#a8ad71",
    heart: "#e86b59",
    rail: "#e8dec5",
    paddle: "#ed6a3d",
    paddleHot: "#ff9a54",
    ball: "#f6edd8",
    brood: "#d9e47a",
    survey: "#b7ad95",
  };
  const HIDDEN_ITEM_KINDS = new Set(["ore"]);

  let seed = 518924;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const world = Array.from({ length: WORLD_H }, (_, y) =>
    Array.from({ length: WORLD_W }, (_, x) => ({
      solid: true,
      kind: "rock",
      hidden: true,
      hp: 1,
      maxHp: 1,
      scar: rand(),
      pulse: rand() * Math.PI * 2,
      persistent: false,
      x,
      y,
    })),
  );

  const state = {
    mode: "roam",
    started: false,
    keys: new Set(),
    player: { x: START.x * TILE, y: START.y * TILE, direction: 0, speed: 235 },
    camera: { x: 0, y: 0, rotation: 0, transition: null },
    frame: { width: 11, depth: 12 },
    arena: null,
    recovered: 0,
    particles: [],
    rings: [],
    messageTimer: 0,
    shake: 0,
    freeze: 0,
    flash: 0,
    time: 0,
    discoveredBrood: false,
    objectivePhase: "find",
    heartTotal: 3,
    heartDestroyed: 0,
    vaultComplete: false,
    upgrades: { multiball: false },
    lab: { maxBalls: 3, ballSpeed: 9 },
    physicsAccumulator: 0,
    audio: null,
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const easeSmoother = (t) => {
    const p = clamp(t, 0, 1);
    return p * p * p * (p * (p * 6 - 15) + 10);
  };

  function arenaViewRotation(direction) {
    return [0, -Math.PI / 2, Math.PI, Math.PI / 2][direction] ?? 0;
  }

  function cameraTargetForWorldPoint(wx, wy) {
    return { x: wx * TILE - canvas.width / 2, y: wy * TILE - canvas.height / 2 };
  }

  function beginCameraSegment(phase, duration, targetX, targetY, targetRotation, finishReason = null) {
    state.camera.transition = {
      phase,
      duration,
      elapsed: 0,
      startX: state.camera.x,
      startY: state.camera.y,
      startRotation: state.camera.rotation,
      targetX,
      targetY,
      targetRotation,
      finishReason,
    };
    updateUI();
  }

  function beginArenaEntry(arena) {
    const center = localToWorld(0, arena.depth / 2, arena);
    const target = cameraTargetForWorldPoint(center.x, center.y);
    beginCameraSegment("focus-in", .34, target.x, target.y, 0);
  }

  function beginArenaExit(reason) {
    const arena = state.arena;
    if (!arena || arena.resolving) return;
    arena.resolving = true;
    arena.resolveReason = reason;
    const center = localToWorld(0, arena.depth / 2, arena);
    const target = cameraTargetForWorldPoint(center.x, center.y);
    if (Math.abs(state.camera.rotation) < .001) {
      const playerTarget = cameraTargetForWorldPoint(state.player.x / TILE, state.player.y / TILE);
      beginCameraSegment("focus-out", .36, playerTarget.x, playerTarget.y, 0, reason);
    } else {
      const duration = .5 + Math.abs(state.camera.rotation) / Math.PI * .3;
      beginCameraSegment("rotate-out", duration, target.x, target.y, 0, reason);
    }
  }

  function completeArenaExit(reason) {
    state.arena = null;
    state.mode = "roam";
    state.camera.rotation = 0;
    state.camera.transition = null;
    state.shake = reason === "clear" ? 4 : 6;
    updateUI();
    checkProgress();
  }

  function updateCameraTransition(dt) {
    const transition = state.camera.transition;
    if (!transition) return false;
    transition.elapsed += dt;
    const progress = clamp(transition.elapsed / transition.duration, 0, 1);
    const eased = easeSmoother(progress);
    state.camera.x = transition.startX + (transition.targetX - transition.startX) * eased;
    state.camera.y = transition.startY + (transition.targetY - transition.startY) * eased;
    state.camera.rotation = transition.startRotation + (transition.targetRotation - transition.startRotation) * eased;
    state.shake = 0;
    if (progress < 1) return true;

    const arena = state.arena;
    if (transition.phase === "focus-in" && arena) {
      const targetRotation = arenaViewRotation(arena.direction);
      if (Math.abs(targetRotation) < .001) {
        state.camera.transition = null;
        updateUI();
        showToast("Arena aligned · serve when ready", 1000, arena.biome === "brood");
      } else {
        const duration = .5 + Math.abs(targetRotation) / Math.PI * .3;
        beginCameraSegment("rotate-in", duration, transition.targetX, transition.targetY, targetRotation);
      }
    } else if (transition.phase === "rotate-in") {
      state.camera.transition = null;
      updateUI();
      showToast("Arena aligned · serve when ready", 1000, arena?.biome === "brood");
    } else if (transition.phase === "rotate-out") {
      const target = cameraTargetForWorldPoint(state.player.x / TILE, state.player.y / TILE);
      beginCameraSegment("focus-out", .36, target.x, target.y, 0, transition.finishReason);
    } else if (transition.phase === "focus-out") {
      completeArenaExit(transition.finishReason);
    }
    return true;
  }

  function biomeAt(x, y) {
    const boundary = 73 + Math.sin(y * .2) * 4;
    return x > boundary && y > 34 ? "brood" : "mine";
  }

  function carveCircle(cx, cy, radius, roughness = .2) {
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
        if (x < 2 || y < 2 || x >= WORLD_W - 2 || y >= WORLD_H - 2) continue;
        const wobble = 1 + (world[y][x].scar - .5) * roughness;
        if (Math.hypot(x - cx, y - cy) <= radius * wobble) {
          world[y][x].solid = false;
          world[y][x].hidden = false;
        }
      }
    }
  }

  function carveTube(points, radius) {
    for (let p = 0; p < points.length - 1; p++) {
      const a = points[p];
      const b = points[p + 1];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.ceil(distance * 2);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        carveCircle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius + Math.sin(t * Math.PI) * .7, .3);
      }
    }
  }

  function setTile(x, y, kind, hp = 1, persistent = false) {
    const tile = world[y]?.[x];
    if (!tile) return;
    tile.solid = true;
    tile.hidden = false;
    tile.kind = kind;
    tile.hp = hp;
    tile.maxHp = hp;
    tile.persistent = persistent;
  }

  function fillBarrier(cx, cy, length, thickness, kindForTile) {
    for (let y = cy - Math.floor(length / 2); y <= cy + Math.floor(length / 2); y++) {
      for (let x = cx - Math.floor(thickness / 2); x <= cx + Math.floor(thickness / 2); x++) {
        const kind = kindForTile(x, y);
        setTile(x, y, kind, kind === "armor" || kind === "shell" ? 2 : 1);
        world[y][x].hidden = true;
      }
    }
  }

  function generateWorld() {
    carveCircle(START.x, START.y, 7.5);
    carveTube([
      { x: 34, y: 23 }, { x: 43, y: 27 }, { x: 51, y: 32 }, { x: 59, y: 37 },
      { x: 68, y: 42 }, { x: 76, y: 47 }, { x: 83, y: 53 }, { x: 88, y: 57 },
    ], 2.6);
    carveTube([{ x: 37, y: 21 }, { x: 48, y: 17 }, { x: 58, y: 20 }], 2.1);
    carveTube([{ x: 38, y: 25 }, { x: 35, y: 36 }, { x: 42, y: 45 }], 2.3);
    carveCircle(52, 33, 6);
    carveCircle(66, 43, 5);
    carveCircle(82, 52, 6.5);

    // The Brood is authored at macro scale: a chain of round chambers terminating
    // in one unmistakable heart cavity. Tile details remain seeded.
    carveCircle(88, 57, 7.2, .35);
    carveTube([{ x: 88, y: 57 }, { x: 91, y: 48 }, { x: 99, y: 44 }], 2.4);
    carveTube([{ x: 89, y: 59 }, { x: 83, y: 67 }, { x: 88, y: 74 }], 2.5);
    carveCircle(BROOD_HEART.x, BROOD_HEART.y, 8.8, .18);
    carveCircle(107, 60, 6.3, .3);

    for (let y = 0; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        const tile = world[y][x];
        if (!tile.solid) continue;
        const biome = biomeAt(x, y);
        const roll = rand();
        if (biome === "brood") {
          tile.kind = "tissue";
          if (roll < .09) tile.kind = "divider";
          else if (roll < .22) tile.kind = "shell";
          else if (roll > .91) tile.kind = "ore";
          tile.hp = tile.kind === "shell" ? 2 : 1;
          tile.maxHp = tile.hp;
        } else {
          const seam = Math.abs(Math.sin(x * .15 + y * .08) + Math.sin(y * .23) * .52);
          if (y > 13 && seam < .22 && roll < .46) tile.kind = "ore";
          else if (roll < .045) tile.kind = "armor";
          else tile.kind = "rock";
          tile.hp = tile.kind === "armor" ? 2 : 1;
          tile.maxHp = tile.hp;
        }
      }
    }

    // Three complete cave plugs force the expedition to alternate travel and
    // claims. Each one previews a little more of the coming mechanical language.
    fillBarrier(47, 30, 11, 3, (x, y) => ((x + y) % 9 === 0 ? "ore" : "rock"));
    fillBarrier(63, 39, 11, 3, (x, y) => ((x * 3 + y) % 11 === 0 ? "armor" : ((x + y) % 8 === 0 ? "ore" : "rock")));
    fillBarrier(74, 46, 11, 3, (x, y) => ((x + y) % 7 === 0 ? "divider" : ((x * 2 + y) % 9 === 0 ? "shell" : "tissue")));

    // A memorable Old Mine vault: visible immediately, impractical until the
    // player returns with a swarm. It cannot be exhausted before it is broken.
    for (let y = 19; y <= 25; y++) {
      for (let x = 24; x <= 27; x++) {
        const edge = x === 27 || y === 19 || y === 25;
        setTile(x, y, edge ? "shell" : "ore", edge ? 2 : 1, true);
      }
    }

    const heartNodes = [
      { x: 92, y: 49 },
      { x: 103, y: 58 },
      { x: 94, y: 68 },
    ];
    for (const node of heartNodes) setTile(node.x, node.y, "heart", 3, true);

    // Curated splitter clusters ensure the Brood teaches multiplication in its
    // first few claims instead of relying on chance.
    [[78, 47], [82, 49], [86, 51], [91, 50], [101, 55], [96, 67]].forEach(([x, y]) => setTile(x, y, "divider", 1, true));
  }

  function worldToLocal(wx, wy, arena) {
    const d = DIRECTIONS[arena.direction];
    const side = { x: -d.y, y: d.x };
    const relX = wx - arena.origin.x;
    const relY = wy - arena.origin.y;
    return { u: relX * side.x + relY * side.y, v: relX * d.x + relY * d.y };
  }

  function localToWorld(u, v, arenaLike) {
    const d = DIRECTIONS[arenaLike.direction];
    const side = { x: -d.y, y: d.x };
    return {
      x: arenaLike.origin.x + side.x * u + d.x * v,
      y: arenaLike.origin.y + side.y * u + d.y * v,
    };
  }

  function frameGeometry() {
    const d = DIRECTIONS[state.player.direction];
    return {
      origin: { x: state.player.x / TILE, y: state.player.y / TILE },
      direction: state.player.direction,
      width: state.frame.width,
      depth: state.frame.depth,
      d,
    };
  }

  function tileAtWorldPoint(x, y) {
    return world[Math.floor(y / TILE)]?.[Math.floor(x / TILE)] ?? null;
  }

  function isOpenAt(x, y, radius = 8) {
    return [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]].every(([ox, oy]) => {
      const tile = tileAtWorldPoint(x + ox, y + oy);
      return Boolean(tile && !tile.solid);
    });
  }

  function isFrameWithinWorld(frame = frameGeometry()) {
    const half = frame.width / 2;
    return [
      localToWorld(-half, 0, frame),
      localToWorld(half, 0, frame),
      localToWorld(-half, frame.depth + .5, frame),
      localToWorld(half, frame.depth + .5, frame),
    ].every((point) => point.x >= 0 && point.y >= 0 && point.x < WORLD_W && point.y < WORLD_H);
  }

  function getFramedHiddenItems(frame = frameGeometry()) {
    const items = [];
    const seen = new Set();
    for (let v = 1; v <= frame.depth; v++) {
      for (let u = -Math.floor(frame.width / 2); u <= Math.floor(frame.width / 2); u++) {
        const point = localToWorld(u, v, frame);
        const x = Math.floor(point.x);
        const y = Math.floor(point.y);
        const tile = world[y]?.[x];
        const key = `${x},${y}`;
        if (!tile?.solid || !tile.hidden || !HIDDEN_ITEM_KINDS.has(tile.kind) || seen.has(key)) continue;
        seen.add(key);
        items.push({ x, y });
      }
    }
    return items;
  }

  function createBall(u = 0, v = .82, vu = 0, vv = 0, served = false) {
    return {
      id: Math.floor(rand() * 1e9), u, v, vu, vv, served,
      radius: .27, trail: [], glow: 0, age: 0,
    };
  }

  function establishArena() {
    const frame = frameGeometry();
    if (!isFrameWithinWorld(frame)) {
      showToast("Claim crosses the survey boundary");
      state.shake = 7;
      sound("deny");
      return;
    }
    const bricks = [];
    let resourceCount = 0;
    let broodBricks = 0;
    for (let v = 1; v <= frame.depth; v++) {
      for (let u = -Math.floor(frame.width / 2); u <= Math.floor(frame.width / 2); u++) {
        const p = localToWorld(u, v, frame);
        const x = Math.floor(p.x);
        const y = Math.floor(p.y);
        const tile = world[y]?.[x];
        if (!tile?.solid) continue;
        tile.hidden = false;
        if (tile.kind === "ore") resourceCount++;
        if (["tissue", "divider", "shell", "heart"].includes(tile.kind)) broodBricks++;
        bricks.push({
          u: u + .5, v: v - .5, x, y, hp: tile.hp, maxHp: tile.maxHp,
          kind: tile.kind, alive: true, pulse: tile.pulse, persistent: tile.persistent,
        });
      }
    }
    state.arena = {
      ...frame,
      biome: broodBricks > bricks.length * .35 ? "brood" : "mine",
      bricks,
      paddle: { u: 0, velocity: 0, width: Math.max(3.15, frame.width * .27), flash: 0, impact: 0 },
      balls: [createBall()],
      drops: [],
      resourceCount,
      collected: 0,
      combo: 0,
      bestCombo: 0,
      splitArmed: false,
      splitUsed: false,
      serveAim: .08,
      lost: false,
      resolving: false,
    };
    state.physicsAccumulator = 0;
    state.mode = "play";
    state.flash = .14;
    updateUI();
    sound("commit");
    showToast(`${resourceCount} value exposed · ${broodBricks ? "living material detected" : "claim live"}`);
    beginArenaEntry(state.arena);
  }

  function finishArena(reason) {
    const arena = state.arena;
    if (!arena) return;
    // Landmark division cells regenerate between failed heart assaults. Ordinary
    // divider cells are expendable; these authored ones can never soft-lock progress.
    for (const brick of arena.bricks) {
      if (brick.kind !== "divider" || !brick.persistent || state.upgrades.multiball) continue;
      const tile = world[brick.y][brick.x];
      tile.solid = true;
      tile.hidden = false;
      tile.kind = "divider";
      tile.hp = 1;
      tile.maxHp = 1;
    }
    for (let v = 1; v <= arena.depth; v++) {
      for (let u = -Math.floor(arena.width / 2); u <= Math.floor(arena.width / 2); u++) {
        const point = localToWorld(u, v, arena);
        const tile = world[Math.floor(point.y)]?.[Math.floor(point.x)];
        if (!tile || (tile.persistent && tile.solid)) continue;
        tile.solid = false;
        tile.hidden = false;
        tile.kind = "rock";
        tile.hp = 1;
        tile.maxHp = 1;
      }
    }
    const lostValue = Math.max(0, arena.resourceCount - arena.collected);
    showToast(
      reason === "clear"
        ? `Claim cleared · ${arena.collected} recovered`
        : `Swarm lost · ${lostValue} value exhausted`,
      2400,
    );
    sound(reason === "clear" ? "clear" : "lost");
    beginArenaExit(reason);
  }

  function rotateVelocity(ball, radians) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const vu = ball.vu * cos - ball.vv * sin;
    const vv = ball.vu * sin + ball.vv * cos;
    ball.vu = vu;
    ball.vv = vv;
  }

  function splitBall(source, count = 1, isCore = false) {
    const arena = state.arena;
    if (!arena || !source?.served) return 0;
    const available = Math.max(0, state.lab.maxBalls - arena.balls.length);
    const amount = Math.min(count, available);
    if (!amount) return 0;
    const spread = amount === 1 ? [.42] : [-.52, .52];
    for (let i = 0; i < amount; i++) {
      const clone = createBall(source.u, source.v, source.vu, source.vv, true);
      clone.age = source.age;
      rotateVelocity(clone, spread[i] ?? ((i + 1) * .38));
      clone.glow = .35;
      arena.balls.push(clone);
    }
    rotateVelocity(source, amount === 1 ? -.32 : 0);
    source.glow = .35;
    state.shake = isCore ? 8 : 5;
    state.flash = isCore ? .22 : .12;
    spawnRingAtBall(source, COLORS.brood, isCore ? 1.1 : .75);
    sound(isCore ? "coreSplit" : "split");
    updateArenaReadout();
    return amount;
  }

  function hitBrick(brick, arena, ball) {
    if (brick.kind === "shell" && arena.balls.length < 2) {
      brick.pulse = state.time;
      brick.hitFlash = .11;
      state.shake = Math.max(state.shake, 2);
      spawnRingAtBrick(brick, arena, COLORS.shell, .55);
      sound("shell");
    } else if (brick.kind === "heart" && arena.balls.length < 2) {
      brick.pulse = state.time;
      brick.hitFlash = .13;
      state.shake = Math.max(state.shake, 3);
      spawnRingAtBrick(brick, arena, COLORS.heart, .7);
      sound("deny");
    } else {
      brick.hp--;
      brick.hitFlash = .11;
      arena.combo++;
      arena.bestCombo = Math.max(arena.bestCombo, arena.combo);
      state.freeze = brick.kind === "heart" ? .035 : .014;
      state.shake = Math.max(state.shake, brick.kind === "heart" ? 6 : 2.7);
      const color = COLORS[brick.kind] ?? COLORS.seam;
      spawnParticles(brick.x + .5, brick.y + .5, color, brick.kind === "heart" ? 18 : 9, brick.kind === "heart" ? 175 : 115);
      spawnRingAtBrick(brick, arena, color, brick.kind === "heart" ? .75 : .32);
      sound(brick.hp <= 0 ? "break" : "hit", arena.combo);
      ball.glow = .11;

      if (brick.hp <= 0) {
        brick.alive = false;
        const tile = world[brick.y][brick.x];
        tile.solid = false;
        tile.hidden = false;
        if (brick.kind === "ore") {
          arena.drops.push({ u: brick.u, v: brick.v, vv: -2.3, kind: "ore", value: 1, spin: rand() * 5 });
        }
        if (brick.kind === "divider") splitBall(ball, 1, false);
        if (brick.kind === "heart") {
          state.heartDestroyed++;
          state.flash = .35;
          showToast(`Heart node ruptured · ${state.heartDestroyed}/${state.heartTotal}`, 2100, true);
          checkProgress();
        }
      }
    }

  }

  function rayCircle(px, py, dx, dy, cx, cy, radius) {
    const fx = px - cx;
    const fy = py - cy;
    const a = dx * dx + dy * dy;
    if (a < 1e-12) return null;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    const t = (-b - root) / (2 * a);
    return t >= -1e-7 && t <= 1 + 1e-7 ? clamp(t, 0, 1) : null;
  }

  function sweepRoundedRect(px, py, dx, dy, cx, cy, halfWidth, halfHeight, radius, ballRadius) {
    const x = px - cx;
    const y = py - cy;
    const expandedX = halfWidth + ballRadius;
    const expandedY = halfHeight + ballRadius;
    const expandedRadius = radius + ballRadius;
    const tangentX = Math.max(0, halfWidth - radius);
    const tangentY = Math.max(0, halfHeight - radius);
    let best = null;
    const consider = (t, nx, ny) => {
      if (t == null || t < -1e-7 || t > 1 + 1e-7) return;
      if (dx * nx + dy * ny >= -1e-9) return;
      if (!best || t < best.t) best = { t: clamp(t, 0, 1), nx, ny };
    };

    if (Math.abs(x) <= expandedX && Math.abs(y) <= expandedY) {
      const qx = Math.max(Math.abs(x) - tangentX, 0);
      const qy = Math.max(Math.abs(y) - tangentY, 0);
      if (qx * qx + qy * qy <= expandedRadius * expandedRadius) {
        const magnitude = Math.hypot(dx, dy) || 1;
        return { t: 0, nx: -dx / magnitude, ny: -dy / magnitude };
      }
    }

    if (Math.abs(dx) > 1e-10) {
      for (const side of [-1, 1]) {
        const t = (side * expandedX - x) / dx;
        const hitY = y + dy * t;
        if (Math.abs(hitY) <= tangentY + 1e-7) consider(t, side, 0);
      }
    }
    if (Math.abs(dy) > 1e-10) {
      for (const side of [-1, 1]) {
        const t = (side * expandedY - y) / dy;
        const hitX = x + dx * t;
        if (Math.abs(hitX) <= tangentX + 1e-7) consider(t, 0, side);
      }
    }
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cornerX = sx * tangentX;
        const cornerY = sy * tangentY;
        const t = rayCircle(x, y, dx, dy, cornerX, cornerY, expandedRadius);
        if (t == null) continue;
        const hitX = x + dx * t;
        const hitY = y + dy * t;
        const nxRaw = hitX - cornerX;
        const nyRaw = hitY - cornerY;
        if (nxRaw * sx < -1e-7 || nyRaw * sy < -1e-7) continue;
        const magnitude = Math.hypot(nxRaw, nyRaw) || 1;
        consider(t, nxRaw / magnitude, nyRaw / magnitude);
      }
    }
    return best;
  }

  function reflectBall(ball, nx, ny) {
    const dot = ball.vu * nx + ball.vv * ny;
    ball.vu -= 2 * dot * nx;
    ball.vv -= 2 * dot * ny;
    const speed = state.lab.ballSpeed;
    const magnitude = Math.hypot(ball.vu, ball.vv) || speed;
    ball.vu = ball.vu / magnitude * speed;
    ball.vv = ball.vv / magnitude * speed;
  }

  function resolvePaddleHit(ball, arena) {
    const speed = state.lab.ballSpeed;
    const english = clamp((ball.u - arena.paddle.u) / (arena.paddle.width / 2), -1, 1);
    const horizontal = clamp(english * speed * .76 + arena.paddle.velocity * .13, -speed * .82, speed * .82);
    ball.vu = horizontal;
    ball.vv = Math.sqrt(Math.max(speed * speed - horizontal * horizontal, speed * speed * .28));
    arena.paddle.flash = .13;
    arena.paddle.impact = english;
    arena.combo = 0;
    sound("paddle", Math.abs(english) * 4);
    const p = localToWorld(ball.u, .47, arena);
    spawnParticles(p.x, p.y, COLORS.paddleHot, 7, 92);
    spawnRingAtWorld(p.x, p.y, COLORS.paddleHot, .22);
    if (arena.splitArmed && !arena.splitUsed && state.upgrades.multiball) {
      const created = splitBall(ball, 2, true);
      if (created) {
        arena.splitUsed = true;
        arena.splitArmed = false;
        showToast("Brood Core · swarm released", 1600, true);
      }
    }
  }

  function updateBall(ball, arena, dt) {
    const half = arena.width / 2;
    ball.age += dt;
    ball.glow = Math.max(0, ball.glow - dt);
    let remaining = dt;
    let iterations = 0;

    while (remaining > 1e-6 && iterations++ < MAX_CONTACTS_PER_STEP) {
      const du = ball.vu * remaining;
      const dv = ball.vv * remaining;
      let bestT = 1 + 1e-6;
      let contacts = [];
      const consider = (hit, type, subject = null) => {
        if (!hit || hit.t < -1e-7 || hit.t > 1 + 1e-7) return;
        hit.t = clamp(hit.t, 0, 1);
        if (hit.t < bestT - 1e-6) {
          bestT = hit.t;
          contacts = [{ ...hit, type, subject }];
        } else if (Math.abs(hit.t - bestT) <= 1e-6) {
          contacts.push({ ...hit, type, subject });
        }
      };

      if (du < 0) consider({ t: (-half + ball.radius - ball.u) / du, nx: 1, ny: 0 }, "rail");
      if (du > 0) consider({ t: (half - ball.radius - ball.u) / du, nx: -1, ny: 0 }, "rail");
      if (dv > 0) consider({ t: (arena.depth + .55 - ball.radius - ball.v) / dv, nx: 0, ny: -1 }, "rail");

      if (dv < 0) {
        consider(
          sweepRoundedRect(ball.u, ball.v, du, dv, arena.paddle.u, .2, arena.paddle.width / 2, .18, .16, ball.radius),
          "paddle",
          arena.paddle,
        );
      }

      for (const brick of arena.bricks) {
        if (!brick.alive) continue;
        consider(
          sweepRoundedRect(ball.u, ball.v, du, dv, brick.u, brick.v, BRICK_HALF, BRICK_HALF, BRICK_RADIUS, ball.radius),
          "brick",
          brick,
        );
      }

      if (!contacts.length || bestT > 1) {
        ball.u += du;
        ball.v += dv;
        break;
      }

      ball.u += du * bestT;
      ball.v += dv * bestT;
      remaining *= Math.max(0, 1 - bestT);
      let nx = 0;
      let ny = 0;
      for (const contact of contacts) { nx += contact.nx; ny += contact.ny; }
      const normalMagnitude = Math.hypot(nx, ny) || 1;
      nx /= normalMagnitude;
      ny /= normalMagnitude;

      const paddleContact = contacts.find((contact) => contact.type === "paddle");
      const brickContacts = [...new Set(contacts.filter((contact) => contact.type === "brick").map((contact) => contact.subject))];
      for (const brick of brickContacts) hitBrick(brick, arena, ball);
      if (paddleContact) resolvePaddleHit(ball, arena);
      else {
        reflectBall(ball, nx, ny);
        if (contacts.some((contact) => contact.type === "rail")) sound("rail");
      }
      ball.u += nx * COLLISION_EPSILON;
      ball.v += ny * COLLISION_EPSILON;
    }

    const trailPoint = localToWorld(ball.u, ball.v, arena);
    ball.trail.unshift({ x: trailPoint.x * TILE, y: trailPoint.y * TILE, life: 1 });
    if (ball.trail.length > 10) ball.trail.pop();
    for (const point of ball.trail) point.life *= .83;
  }

  function updatePlayStep(dt) {
    const arena = state.arena;
    if (!arena || arena.resolving || state.camera.transition) return;
    const input = (state.keys.has("KeyD") || state.keys.has("ArrowRight") ? 1 : 0)
      - (state.keys.has("KeyA") || state.keys.has("ArrowLeft") ? 1 : 0);
    const targetVelocity = input * 11.4;
    const response = 1 - Math.pow(input && Math.sign(input) !== Math.sign(arena.paddle.velocity) ? .0000002 : .00002, dt);
    arena.paddle.velocity += (targetVelocity - arena.paddle.velocity) * response;
    arena.paddle.u += arena.paddle.velocity * dt;
    arena.paddle.flash = Math.max(0, arena.paddle.flash - dt);
    arena.paddle.impact *= Math.pow(.0005, dt);
    for (const brick of arena.bricks) brick.hitFlash = Math.max(0, (brick.hitFlash || 0) - dt);
    const half = arena.width / 2;
    const paddleLimit = half - arena.paddle.width / 2;
    if (arena.paddle.u < -paddleLimit) { arena.paddle.u = -paddleLimit; arena.paddle.velocity = Math.max(0, arena.paddle.velocity); }
    if (arena.paddle.u > paddleLimit) { arena.paddle.u = paddleLimit; arena.paddle.velocity = Math.min(0, arena.paddle.velocity); }

    if (!arena.balls.some((ball) => ball.served)) {
      const aimInput = (state.keys.has("KeyE") ? 1 : 0) - (state.keys.has("KeyQ") ? 1 : 0);
      arena.serveAim = Math.max(-.72, Math.min(.72, arena.serveAim + aimInput * 1.5 * dt));
      for (const ball of arena.balls) ball.u = arena.paddle.u;
      updateArenaReadout();
      return;
    }

    for (const ball of [...arena.balls]) updateBall(ball, arena, dt);
    for (let i = arena.balls.length - 1; i >= 0; i--) {
      const ball = arena.balls[i];
      if (ball.v < -.72) {
        const p = localToWorld(ball.u, 0, arena);
        spawnParticles(p.x, p.y, COLORS.ball, 13, 155);
        spawnRingAtBall(ball, COLORS.rust, .7);
        arena.balls.splice(i, 1);
        state.shake = 5;
        sound("ballLost");
      }
    }

    if (!arena.balls.length) {
      finishArena("lost");
      return;
    }

    for (let i = arena.drops.length - 1; i >= 0; i--) {
      const drop = arena.drops[i];
      drop.v += drop.vv * dt;
      drop.vv -= 1.35 * dt;
      drop.spin += dt * 5;
      drop.u += Math.sin(state.time * 4.5 + i) * dt * .2;
      if (drop.v < .45) {
        if (Math.abs(drop.u - arena.paddle.u) < arena.paddle.width / 2 + .36) {
          arena.collected += drop.value;
          state.recovered += drop.value;
          oreCount.textContent = String(state.recovered).padStart(3, "0");
          const p = localToWorld(drop.u, .3, arena);
          spawnParticles(p.x, p.y, COLORS.ore, 16, 135);
          spawnRingAtWorld(p.x, p.y, COLORS.ore, .45);
          sound("collect", arena.collected);
        }
        arena.drops.splice(i, 1);
      }
    }

    updateArenaReadout();
    if (!arena.bricks.some((brick) => brick.alive)) finishArena("clear");
  }

  function updatePlay(dt) {
    if (!state.arena || state.arena.resolving || state.camera.transition) return;
    state.physicsAccumulator = Math.min(PHYSICS_STEP * 5, state.physicsAccumulator + dt);
    while (state.physicsAccumulator >= PHYSICS_STEP) {
      updatePlayStep(PHYSICS_STEP);
      state.physicsAccumulator -= PHYSICS_STEP;
      if (!state.arena || state.arena.resolving) break;
    }
  }

  function updateRoam(dt) {
    const dx = (state.keys.has("KeyD") ? 1 : 0) - (state.keys.has("KeyA") ? 1 : 0);
    const dy = (state.keys.has("KeyS") ? 1 : 0) - (state.keys.has("KeyW") ? 1 : 0);
    const length = Math.hypot(dx, dy) || 1;
    const vx = dx / length * state.player.speed * dt;
    const vy = dy / length * state.player.speed * dt;
    if (isOpenAt(state.player.x + vx, state.player.y)) state.player.x += vx;
    if (isOpenAt(state.player.x, state.player.y + vy)) state.player.y += vy;
    const biome = biomeAt(state.player.x / TILE, state.player.y / TILE);
    if (biome === "brood" && !state.discoveredBrood) {
      state.discoveredBrood = true;
      showToast("THE BROOD · material classification failed", 2800, true);
      sound("discover");
    }
  }

  function spawnParticles(wx, wy, color, count, force = 120) {
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const speed = force * (.3 + rand() * .75);
      state.particles.push({
        x: wx * TILE, y: wy * TILE,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        gravity: 32 + rand() * 45,
        size: 1.5 + rand() * 3.2,
        life: .32 + rand() * .48, maxLife: .8,
        color,
      });
    }
  }

  function spawnRingAtWorld(wx, wy, color, strength = .5) {
    state.rings.push({ x: wx * TILE, y: wy * TILE, radius: 4, speed: 95 + strength * 80, life: .25 + strength * .18, maxLife: .45, color, width: 1 + strength * 2 });
  }

  function spawnRingAtBrick(brick, arena, color, strength) {
    const p = localToWorld(brick.u, brick.v, arena);
    spawnRingAtWorld(p.x, p.y, color, strength);
  }

  function spawnRingAtBall(ball, color, strength) {
    if (!state.arena) return;
    const p = localToWorld(ball.u, ball.v, state.arena);
    spawnRingAtWorld(p.x, p.y, color, strength);
  }

  function updateEffects(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(.08, dt);
      p.vy = p.vy * Math.pow(.12, dt) + p.gravity * dt;
      p.life -= dt;
      if (p.life <= 0) state.particles.splice(i, 1);
    }
    for (let i = state.rings.length - 1; i >= 0; i--) {
      const ring = state.rings[i];
      ring.radius += ring.speed * dt;
      ring.life -= dt;
      if (ring.life <= 0) state.rings.splice(i, 1);
    }
  }

  function updateCamera(dt) {
    if (updateCameraTransition(dt)) return;
    let tx = state.player.x - canvas.width / 2;
    let ty = state.player.y - canvas.height / 2;
    if (state.arena) {
      const center = localToWorld(0, state.arena.depth / 2, state.arena);
      tx = center.x * TILE - canvas.width / 2;
      ty = center.y * TILE - canvas.height / 2;
    }
    const smoothing = 1 - Math.pow(.002, dt);
    state.camera.x += (tx - state.camera.x) * smoothing;
    state.camera.y += (ty - state.camera.y) * smoothing;
    const targetRotation = state.arena ? arenaViewRotation(state.arena.direction) : 0;
    state.camera.rotation += (targetRotation - state.camera.rotation) * smoothing;
  }

  const MINE_RAMPS = [
    { base: "#4a463c", line: "#716957", deep: "#35342f" },
    { base: "#403e37", line: "#655f50", deep: "#2e2e2a" },
    { base: "#575044", line: "#81745e", deep: "#3d3932" },
  ];
  const BROOD_RAMPS = [
    { base: "#4b5533", line: "#7c8951", deep: "#29301f" },
    { base: "#3f4a2d", line: "#697746", deep: "#242b1c" },
    { base: "#59603b", line: "#8a925c", deep: "#303621" },
  ];

  function stratumAt(x, y) {
    const foldedY = y + Math.sin(x * .085) * 2.8 + Math.sin(x * .027 + y * .035) * 4.5;
    return Math.abs(Math.floor(foldedY / 6)) % MINE_RAMPS.length;
  }

  function broodRingAt(x, y) {
    const dx = x - BROOD_HEART.x;
    const dy = (y - BROOD_HEART.y) * 1.14;
    return Math.hypot(dx, dy) + Math.sin(Math.atan2(dy, dx) * 3) * 1.4;
  }

  function isBoundaryTile(x, y) {
    return !world[y - 1]?.[x]?.solid || !world[y + 1]?.[x]?.solid || !world[y]?.[x - 1]?.solid || !world[y]?.[x + 1]?.solid;
  }

  function traceTileBoundary(x, y, sx, sy, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    if (!world[y - 1]?.[x]?.solid) { ctx.moveTo(sx, sy + .5); ctx.lineTo(sx + TILE, sy + .5); }
    if (!world[y + 1]?.[x]?.solid) { ctx.moveTo(sx, sy + TILE - .5); ctx.lineTo(sx + TILE, sy + TILE - .5); }
    if (!world[y]?.[x - 1]?.solid) { ctx.moveTo(sx + .5, sy); ctx.lineTo(sx + .5, sy + TILE); }
    if (!world[y]?.[x + 1]?.solid) { ctx.moveTo(sx + TILE - .5, sy); ctx.lineTo(sx + TILE - .5, sy + TILE); }
    ctx.stroke();
  }

  function drawMineTile(tile, x, y, sx, sy) {
    const ramp = MINE_RAMPS[stratumAt(x + .5, y + .5)];
    ctx.fillStyle = y > WORLD_H * .56 ? ramp.deep : ramp.base;
    ctx.fillRect(sx, sy, TILE + .7, TILE + .7);

    // One continuous bedding line crosses selected six-tile strata. Its height is
    // derived only from world coordinates, so adjacent cells meet exactly.
    const folded = y + Math.sin((x + .5) * .085) * 2.8 + Math.sin((x + .5) * .027 + y * .035) * 4.5;
    const bandDistance = Math.abs(folded - Math.round(folded / 6) * 6);
    if (bandDistance < .62) {
      ctx.strokeStyle = ramp.line;
      ctx.globalAlpha = .44;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      const y0 = sy + TILE * (.5 + bandDistance * .22);
      ctx.moveTo(sx, y0);
      ctx.lineTo(sx + TILE + .5, y0 + Math.cos(x * .085) * 2.1);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (isBoundaryTile(x, y)) traceTileBoundary(x, y, sx, sy, "rgb(202 190 161 / .34)", 1.5);
    if (tile.kind === "armor" && !tile.hidden) {
      ctx.fillStyle = COLORS.armor;
      roundedRectPath(sx + 3, sy + 4, TILE - 6, TILE - 8, 3);
      ctx.fill();
      ctx.strokeStyle = "#595548";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx + 6, sy + 9); ctx.lineTo(sx + TILE - 6, sy + 9); ctx.stroke();
    }
  }

  function drawBroodTile(tile, x, y, sx, sy) {
    const ring = broodRingAt(x + .5, y + .5);
    const ramp = BROOD_RAMPS[Math.abs(Math.floor(ring / 4.8)) % BROOD_RAMPS.length];
    const collectivePulse = .5 + Math.sin(state.time * 2.15 - ring * .17) * .5;
    ctx.fillStyle = tile.kind === "shell" && !tile.hidden ? "#505637" : ramp.base;
    ctx.fillRect(sx, sy, TILE + .7, TILE + .7);

    // The entire province participates in one pulse and one concentric anatomy;
    // there is no per-tile decorative noise.
    const membrane = Math.abs(ring - Math.round(ring / 4.8) * 4.8);
    if (membrane < .58) {
      const dx = x + .5 - BROOD_HEART.x;
      const dy = y + .5 - BROOD_HEART.y;
      const tangent = Math.atan2(dy, dx) + Math.PI / 2;
      ctx.save();
      ctx.translate(sx + TILE / 2, sy + TILE / 2);
      ctx.rotate(tangent);
      ctx.strokeStyle = `rgb(194 207 112 / ${.28 + collectivePulse * .28})`;
      ctx.lineWidth = 1.5 + collectivePulse * .7;
      ctx.beginPath(); ctx.moveTo(-TILE * .7, 0); ctx.lineTo(TILE * .7, 0); ctx.stroke();
      ctx.restore();
    }
    if (isBoundaryTile(x, y)) {
      traceTileBoundary(x, y, sx, sy, `rgb(203 216 125 / ${.42 + collectivePulse * .18})`, 1.7);
      ctx.fillStyle = `rgb(217 228 128 / ${.09 + collectivePulse * .08})`;
      ctx.fillRect(sx, sy, TILE + .5, TILE + .5);
    }
  }

  function drawRevealedKind(tile, sx, sy) {
    if (tile.hidden || tile.kind === "rock" || tile.kind === "tissue" || tile.kind === "armor") return;
    if (tile.kind === "ore") {
      ctx.fillStyle = COLORS.ore;
      ctx.beginPath();
      ctx.moveTo(sx + 4, sy + 14); ctx.lineTo(sx + 9, sy + 5); ctx.lineTo(sx + 18, sy + 7);
      ctx.lineTo(sx + 21, sy + 15); ctx.lineTo(sx + 14, sy + 21); ctx.lineTo(sx + 6, sy + 19); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffd092"; ctx.fillRect(sx + 10, sy + 8, 4, 3);
    } else if (tile.kind === "divider") {
      ctx.strokeStyle = COLORS.divider;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx + 9, sy + 12, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx + 16, sy + 12, 5, 0, Math.PI * 2); ctx.stroke();
    } else if (tile.kind === "shell") {
      ctx.strokeStyle = COLORS.shell;
      ctx.lineWidth = 3;
      ctx.strokeRect(sx + 3, sy + 3, TILE - 6, TILE - 6);
      ctx.fillStyle = "rgb(216 230 108 / .24)"; ctx.fillRect(sx + 7, sy + 7, TILE - 14, TILE - 14);
    } else if (tile.kind === "heart") {
      const beat = 1 + Math.max(0, Math.sin(state.time * 4.4)) * .12;
      ctx.save(); ctx.translate(sx + 12, sy + 12); ctx.scale(beat, beat);
      ctx.fillStyle = COLORS.heart;
      ctx.beginPath(); ctx.arc(-4, -2, 6, 0, Math.PI * 2); ctx.arc(4, -2, 6, 0, Math.PI * 2);
      ctx.lineTo(0, 10); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }

  function roundedRectPath(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function brickPalette(brick, arena) {
    if (brick.kind === "ore") return { base: "#b84f2f", light: "#ff9a5b", dark: "#672c20" };
    if (brick.kind === "armor") return { base: "#857861", light: "#c5b896", dark: "#403a31" };
    if (brick.kind === "divider") return { base: "#aeba4e", light: "#eef994", dark: "#596021" };
    if (brick.kind === "shell") return { base: "#777b42", light: "#c7ce77", dark: "#3e4224" };
    if (brick.kind === "heart") return { base: "#c94f46", light: "#ff9480", dark: "#6c292b" };
    if (arena.biome === "brood" || brick.kind === "tissue") {
      const source = BROOD_RAMPS[Math.abs(Math.floor(broodRingAt(brick.x + .5, brick.y + .5) / 4.8)) % BROOD_RAMPS.length];
      return { base: source.base, light: source.line, dark: source.deep };
    }
    const source = MINE_RAMPS[stratumAt(brick.x + .5, brick.y + .5)];
    return { base: source.base, light: source.line, dark: source.deep };
  }

  function drawBrickGlyph(brick, size, palette) {
    if (brick.kind === "ore") {
      ctx.fillStyle = palette.light;
      ctx.beginPath();
      ctx.moveTo(-5, 4); ctx.lineTo(-2, -5); ctx.lineTo(5, -3); ctx.lineTo(7, 3); ctx.lineTo(1, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffd3a0"; ctx.fillRect(-1.5, -3.5, 3.5, 2);
    } else if (brick.kind === "divider") {
      ctx.strokeStyle = palette.light; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(-3.5, 0, 4, 0, Math.PI * 2); ctx.arc(3.5, 0, 4, 0, Math.PI * 2); ctx.stroke();
    } else if (brick.kind === "shell") {
      ctx.strokeStyle = palette.light; ctx.lineWidth = 2;
      roundedRectPath(-size * .28, -size * .28, size * .56, size * .56, 2); ctx.stroke();
    } else if (brick.kind === "heart") {
      const beat = 1 + Math.max(0, Math.sin(state.time * 4.4 + brick.pulse)) * .09;
      ctx.save(); ctx.scale(beat, beat); ctx.fillStyle = palette.light;
      ctx.beginPath(); ctx.arc(-3, -2, 4, 0, Math.PI * 2); ctx.arc(3, -2, 4, 0, Math.PI * 2); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill(); ctx.restore();
    } else if (brick.kind === "armor") {
      ctx.fillStyle = palette.dark;
      roundedRectPath(-size * .3, -3, size * .6, 6, 2); ctx.fill();
      ctx.fillStyle = palette.light; ctx.fillRect(-size * .22, -2, size * .44, 1.5);
    }
  }

  function drawArenaBoard() {
    const arena = state.arena;
    if (!arena) return;
    const half = arena.width / 2;
    const corners = [
      localToWorld(-half, -.1, arena), localToWorld(half, -.1, arena),
      localToWorld(half, arena.depth + .55, arena), localToWorld(-half, arena.depth + .55, arena),
    ];
    ctx.save();
    ctx.translate(-state.camera.x, -state.camera.y);
    ctx.beginPath(); ctx.moveTo(corners[0].x * TILE, corners[0].y * TILE);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x * TILE, corners[i].y * TILE);
    ctx.closePath();
    ctx.fillStyle = arena.biome === "brood" ? "rgb(13 17 10 / .965)" : "rgb(13 14 12 / .965)";
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = arena.biome === "brood" ? "rgb(196 210 112 / .07)" : "rgb(222 211 185 / .055)";
    ctx.lineWidth = 1;
    for (let i = -18; i < 28; i += 2) {
      ctx.beginPath();
      ctx.moveTo(corners[0].x * TILE - 400, corners[0].y * TILE + i * TILE);
      ctx.lineTo(corners[2].x * TILE + 400, corners[2].y * TILE + i * TILE);
      ctx.stroke();
    }
    ctx.restore();

    const fade = arena.resolving && state.camera.transition
      ? 1 - clamp(state.camera.transition.elapsed / (state.camera.transition.duration * 1.4), 0, .72)
      : 1;
    ctx.globalAlpha = fade;
    const size = BRICK_HALF * 2 * TILE;
    for (const brick of arena.bricks) {
      if (!brick.alive) continue;
      const p = localToWorld(brick.u, brick.v, arena);
      const palette = brickPalette(brick, arena);
      const flash = clamp((brick.hitFlash || 0) / .11, 0, 1);
      ctx.save();
      ctx.translate(p.x * TILE, p.y * TILE);
      ctx.rotate(arena.direction * Math.PI / 2);
      ctx.scale(1 + flash * .035, 1 - flash * .045);
      ctx.shadowColor = brick.kind === "heart" ? palette.light : "rgb(0 0 0 / .5)";
      ctx.shadowBlur = brick.kind === "heart" ? 9 : 1.5;
      ctx.shadowOffsetY = 2;
      roundedRectPath(-size / 2, -size / 2, size, size, BRICK_RADIUS * TILE);
      ctx.fillStyle = flash ? palette.light : palette.base;
      ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.strokeStyle = palette.dark; ctx.lineWidth = 1.25; ctx.stroke();
      ctx.globalAlpha = .78;
      ctx.strokeStyle = palette.light; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-size * .27, -size * .33); ctx.lineTo(size * .23, -size * .33);
      ctx.moveTo(-size * .33, -size * .27); ctx.lineTo(-size * .33, size * .17);
      ctx.stroke();
      ctx.globalAlpha = 1;
      drawBrickGlyph(brick, size, palette);
      if (brick.hp < brick.maxHp) {
        ctx.strokeStyle = "rgb(24 18 13 / .85)"; ctx.lineWidth = 1.25;
        ctx.beginPath(); ctx.moveTo(-2, -size * .34); ctx.lineTo(1, -3); ctx.lineTo(-3, 2); ctx.lineTo(4, size * .34); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawSurveyVoid(startX, startY, endX, endY) {
    ctx.save();
    ctx.translate(-state.camera.x, -state.camera.y);
    ctx.strokeStyle = "rgb(184 174 150 / .055)";
    ctx.lineWidth = 1;
    const grid = TILE * 8;
    for (let x = Math.floor(startX / 8) * grid; x <= endX * TILE; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, startY * TILE); ctx.lineTo(x, endY * TILE); ctx.stroke();
    }
    for (let y = Math.floor(startY / 8) * grid; y <= endY * TILE; y += grid) {
      ctx.beginPath(); ctx.moveTo(startX * TILE, y); ctx.lineTo(endX * TILE, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawBroodSignal() {
    const x = BROOD_HEART.x * TILE - state.camera.x;
    const y = BROOD_HEART.y * TILE - state.camera.y;
    const breathe = .5 + Math.sin(state.time * 2.15) * .5;
    ctx.save();
    ctx.strokeStyle = `rgb(211 225 122 / ${.11 + breathe * .08})`;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([3, 10]);
    for (const radius of [TILE * 5, TILE * 10, TILE * 15]) {
      ctx.beginPath();
      ctx.ellipse(x, y, radius + breathe * 3, radius * .86 + breathe * 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = `rgb(232 115 91 / ${.08 + breathe * .07})`;
    ctx.beginPath(); ctx.arc(x, y, 21 + breathe * 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawWorld() {
    const centerX = (state.camera.x + canvas.width / 2) / TILE;
    const centerY = (state.camera.y + canvas.height / 2) / TILE;
    const radius = Math.hypot(canvas.width, canvas.height) / TILE / 2 + 3;
    const startX = Math.max(0, Math.floor(centerX - radius));
    const startY = Math.max(0, Math.floor(centerY - radius));
    const endX = Math.min(WORLD_W, Math.ceil(centerX + radius));
    const endY = Math.min(WORLD_H, Math.ceil(centerY + radius));

    drawSurveyVoid(startX, startY, endX, endY);
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tile = world[y][x];
        const sx = x * TILE - state.camera.x;
        const sy = y * TILE - state.camera.y;
        if (!tile.solid) {
          if (tile.scar > .88) {
            ctx.fillStyle = biomeAt(x, y) === "brood" ? "#1a1d0d" : "#17130e";
            ctx.fillRect(sx + tile.scar * 9, sy + 8, 2, 2);
          }
          continue;
        }
        if (biomeAt(x, y) === "brood") drawBroodTile(tile, x, y, sx, sy);
        else drawMineTile(tile, x, y, sx, sy);
        drawRevealedKind(tile, sx, sy);
      }
    }
    drawBroodSignal();
  }

  function drawFramePreview() {
    const frame = frameGeometry();
    const half = frame.width / 2;
    const points = [
      localToWorld(-half, 0, frame), localToWorld(half, 0, frame),
      localToWorld(half, frame.depth + .5, frame), localToWorld(-half, frame.depth + .5, frame),
    ];
    const valid = isFrameWithinWorld(frame);
    ctx.save();
    ctx.translate(-state.camera.x, -state.camera.y);
    ctx.beginPath(); ctx.moveTo(points[0].x * TILE, points[0].y * TILE);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x * TILE, points[i].y * TILE);
    ctx.closePath();
    ctx.fillStyle = valid ? "rgb(217 228 122 / .075)" : "rgb(229 106 63 / .085)";
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = valid ? "rgb(232 222 196 / .12)" : "rgb(229 106 63 / .12)";
    ctx.lineWidth = 1;
    const minY = Math.min(...points.map((point) => point.y)) * TILE;
    const maxY = Math.max(...points.map((point) => point.y)) * TILE;
    const minX = Math.min(...points.map((point) => point.x)) * TILE;
    const maxX = Math.max(...points.map((point) => point.x)) * TILE;
    for (let scan = minY + ((state.time * 28) % 24); scan < maxY; scan += 24) {
      ctx.beginPath(); ctx.moveTo(minX, scan); ctx.lineTo(maxX, scan); ctx.stroke();
    }
    ctx.restore();

    // Framing reveals where a buried item exists, never what it is. These pings
    // are an overlay only: tile.hidden remains true until the claim is committed.
    const itemPulse = .65 + Math.sin(state.time * 4) * .2;
    for (const item of getFramedHiddenItems(frame)) {
      const x = (item.x + .5) * TILE;
      const y = (item.y + .5) * TILE;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = `rgb(245 232 200 / ${itemPulse})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-4.5, -4.5, 9, 9);
      ctx.fillStyle = "rgb(245 232 200 / .82)";
      ctx.fillRect(-1.5, -1.5, 3, 3);
      ctx.restore();
    }

    ctx.setLineDash([12, 8]); ctx.lineWidth = 1.5;
    ctx.strokeStyle = valid ? COLORS.brood : COLORS.rust; ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    const bracket = 17;
    for (const point of points) {
      const px = point.x * TILE;
      const py = point.y * TILE;
      const towardX = (points.reduce((sum, p) => sum + p.x, 0) / 4 - point.x) > 0 ? 1 : -1;
      const towardY = (points.reduce((sum, p) => sum + p.y, 0) / 4 - point.y) > 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(px, py + towardY * bracket); ctx.lineTo(px, py); ctx.lineTo(px + towardX * bracket, py);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer() {
    const p = state.player;
    const d = DIRECTIONS[p.direction];
    ctx.save();
    ctx.translate(p.x - state.camera.x, p.y - state.camera.y);
    ctx.rotate(p.direction * Math.PI / 2);
    const chassis = state.upgrades.multiball ? COLORS.brood : COLORS.paddle;
    ctx.fillStyle = "rgb(0 0 0 / .44)";
    roundedRectPath(-38, 7, 76, 7, 3); ctx.fill();
    ctx.fillStyle = "#2a2924";
    roundedRectPath(-38, -7, 76, 14, 5); ctx.fill();
    ctx.strokeStyle = chassis; ctx.lineWidth = 2;
    roundedRectPath(-36, -6, 72, 12, 4); ctx.stroke();
    ctx.fillStyle = chassis;
    roundedRectPath(-28, -4, 56, 8, 3); ctx.fill();
    ctx.fillStyle = "rgb(246 237 216 / .72)";
    roundedRectPath(-20, -3, 40, 2, 1); ctx.fill();
    ctx.fillStyle = COLORS.ball;
    ctx.beginPath(); ctx.arc(0, -8, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgb(246 237 216 / .34)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-28, 0); ctx.lineTo(-20, 0); ctx.moveTo(20, 0); ctx.lineTo(28, 0); ctx.stroke();
    if (state.upgrades.multiball) {
      ctx.fillStyle = COLORS.heart;
      ctx.beginPath(); ctx.arc(-3, 0, 3, 0, Math.PI * 2); ctx.arc(3, 0, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    const ax = p.x + d.x * 29 - state.camera.x;
    const ay = p.y + d.y * 29 - state.camera.y;
    ctx.strokeStyle = chassis; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.x - state.camera.x, p.y - state.camera.y); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.fillStyle = COLORS.ball; ctx.beginPath(); ctx.arc(ax, ay, 3, 0, Math.PI * 2); ctx.fill();
  }

  function drawAimGuide(arena) {
    if (arena.balls.some((ball) => ball.served)) return;
    const speed = 5.8;
    const start = localToWorld(arena.paddle.u, .65, arena);
    const end = localToWorld(arena.paddle.u + arena.serveAim * speed, .65 + speed, arena);
    ctx.save(); ctx.translate(-state.camera.x, -state.camera.y);
    ctx.strokeStyle = "rgb(245 232 200 / .48)"; ctx.setLineDash([5, 6]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(start.x * TILE, start.y * TILE); ctx.lineTo(end.x * TILE, end.y * TILE); ctx.stroke();
    ctx.restore();
  }

  function drawArenaActors() {
    const arena = state.arena;
    const half = arena.width / 2;
    ctx.save(); ctx.translate(-state.camera.x, -state.camera.y);
    ctx.strokeStyle = arena.biome === "brood" ? "rgb(216 230 108 / .58)" : "rgb(226 216 185 / .5)";
    ctx.lineWidth = 2; ctx.setLineDash([]);
    for (const u of [-half, half]) {
      const a = localToWorld(u, 0, arena); const b = localToWorld(u, arena.depth + .5, arena);
      ctx.beginPath(); ctx.moveTo(a.x * TILE, a.y * TILE); ctx.lineTo(b.x * TILE, b.y * TILE); ctx.stroke();
    }
    const farA = localToWorld(-half, arena.depth + .5, arena);
    const farB = localToWorld(half, arena.depth + .5, arena);
    ctx.beginPath(); ctx.moveTo(farA.x * TILE, farA.y * TILE); ctx.lineTo(farB.x * TILE, farB.y * TILE); ctx.stroke();

    for (const ball of arena.balls) {
      if (!ball.served) continue;
      for (let i = ball.trail.length - 1; i >= 0; i--) {
        const point = ball.trail[i];
        ctx.globalAlpha = point.life * .48;
        ctx.fillStyle = arena.splitUsed || arena.balls.length > 1 ? COLORS.brood : COLORS.ball;
        ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(1.25, ball.radius * TILE * point.life * .62), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    const paddleCenter = localToWorld(arena.paddle.u, .2, arena);
    const paddleWidth = arena.paddle.width * TILE;
    const paddleHeight = .36 * TILE;
    const paddleColor = arena.paddle.flash ? COLORS.paddleHot : (state.upgrades.multiball ? COLORS.brood : COLORS.paddle);
    ctx.save();
    ctx.translate(paddleCenter.x * TILE, paddleCenter.y * TILE);
    ctx.rotate(arena.direction * Math.PI / 2);
    ctx.transform(1, 0, arena.paddle.impact * -.055, 1, 0, 0);
    ctx.shadowColor = paddleColor; ctx.shadowBlur = arena.paddle.flash ? 17 : 6;
    roundedRectPath(-paddleWidth / 2, -paddleHeight / 2, paddleWidth, paddleHeight, paddleHeight * .48);
    ctx.fillStyle = paddleColor; ctx.fill();
    ctx.shadowBlur = 0;
    roundedRectPath(-paddleWidth / 2 + 2, -paddleHeight / 2 + 1.5, paddleWidth - 4, 3, 1.5);
    ctx.fillStyle = "rgb(255 221 173 / .52)"; ctx.fill();
    ctx.fillStyle = "rgb(39 21 13 / .28)";
    roundedRectPath(-paddleWidth * .06, -paddleHeight * .33, paddleWidth * .12, paddleHeight * .66, 2); ctx.fill();
    for (const side of [-1, 1]) {
      ctx.fillStyle = "rgb(45 22 12 / .22)";
      roundedRectPath(side * paddleWidth * .34 - paddleWidth * .06, -paddleHeight * .3, paddleWidth * .12, paddleHeight * .6, 2); ctx.fill();
    }
    ctx.restore();

    for (const ball of arena.balls) {
      const p = localToWorld(ball.u, ball.v, arena);
      ctx.fillStyle = arena.balls.length > 1 ? COLORS.brood : COLORS.ball;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10 + (ball.glow > 0 ? 14 : 0);
      ctx.beginPath(); ctx.arc(p.x * TILE, p.y * TILE, ball.radius * TILE, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgb(29 22 14 / .72)"; ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.fillStyle = "rgb(255 255 240 / .72)";
      ctx.beginPath(); ctx.arc(p.x * TILE - ball.radius * TILE * .28, p.y * TILE - ball.radius * TILE * .28, Math.max(1.2, ball.radius * TILE * .2), 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;

    for (const drop of arena.drops) {
      const p = localToWorld(drop.u, drop.v, arena);
      ctx.fillStyle = COLORS.ore;
      ctx.save(); ctx.translate(p.x * TILE, p.y * TILE); ctx.rotate(drop.spin); ctx.fillRect(-5, -5, 10, 10); ctx.restore();
    }
    ctx.restore();
    drawAimGuide(arena);
  }

  function objectiveTarget() {
    if (state.objectivePhase === "return") return OLD_VAULT;
    return BROOD_HEART;
  }

  function drawObjectiveMarker() {
    if (state.objectivePhase === "complete" || state.mode === "play") return;
    const target = objectiveTarget();
    const sx = target.x * TILE - state.camera.x;
    const sy = target.y * TILE - state.camera.y;
    const margin = 45;
    const visible = sx > margin && sx < canvas.width - margin && sy > margin && sy < canvas.height - margin;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    let x = sx;
    let y = sy;
    if (!visible) {
      const dx = sx - cx;
      const dy = sy - cy;
      const scale = Math.min((canvas.width / 2 - margin) / Math.max(1, Math.abs(dx)), (canvas.height / 2 - margin) / Math.max(1, Math.abs(dy)));
      x = cx + dx * scale;
      y = cy + dy * scale;
    }
    const pulse = 8 + Math.sin(state.time * 3.2) * 2;
    ctx.strokeStyle = state.objectivePhase === "return" ? COLORS.ore : COLORS.brood;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.font = "600 10px 'IBM Plex Sans Condensed', sans-serif";
    ctx.textAlign = x > canvas.width - 180 ? "right" : "left";
    ctx.fillText(state.objectivePhase === "return" ? "SEALED OLD-MINE POCKET" : "BIOLOGICAL SIGNAL", x + (ctx.textAlign === "right" ? -13 : 13), y + 4);
  }

  function drawEffects() {
    for (const p of state.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - state.camera.x, p.y - state.camera.y, p.size, p.size);
    }
    for (const ring of state.rings) {
      ctx.globalAlpha = Math.max(0, ring.life / ring.maxLife);
      ctx.strokeStyle = ring.color; ctx.lineWidth = ring.width;
      ctx.beginPath(); ctx.arc(ring.x - state.camera.x, ring.y - state.camera.y, ring.radius, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawDepthMarks() {
    ctx.fillStyle = "rgb(239 227 198 / .38)";
    ctx.font = "11px 'IBM Plex Sans Condensed', sans-serif";
    ctx.textAlign = "right";
    const worldY = state.camera.y / TILE;
    const first = Math.ceil(worldY / 10) * 10;
    for (let y = first; y < worldY + canvas.height / TILE; y += 10) {
      const sy = y * TILE - state.camera.y;
      ctx.fillText(`${Math.max(0, (y - 8) * 12)}m`, canvas.width - 10, sy - 4);
      ctx.fillRect(canvas.width - 7, sy, 7, 1);
    }
  }

  function drawScreenFinish() {
    const focusBiome = state.arena?.biome ?? biomeAt(state.player.x / TILE, state.player.y / TILE);
    const gradient = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * .2, canvas.width / 2, canvas.height / 2, canvas.height * .78);
    gradient.addColorStop(0, "rgb(0 0 0 / 0)");
    gradient.addColorStop(1, focusBiome === "brood" ? "rgb(13 16 5 / .48)" : "rgb(0 0 0 / .43)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (state.camera.transition) {
      const progress = clamp(state.camera.transition.elapsed / state.camera.transition.duration, 0, 1);
      ctx.fillStyle = `rgb(8 7 5 / ${Math.sin(progress * Math.PI) * .1})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function render() {
    const allowShake = !state.camera.transition;
    const shakeX = allowShake && state.shake ? (rand() - .5) * state.shake : 0;
    const shakeY = allowShake && state.shake ? (rand() - .5) * state.shake : 0;
    ctx.fillStyle = state.arena?.biome === "brood" ? COLORS.voidBrood : COLORS.void;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2 + shakeX, canvas.height / 2 + shakeY);
    ctx.rotate(state.camera.rotation);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
    drawWorld();
    if (state.arena) drawArenaBoard();
    if (state.mode === "frame") drawFramePreview();
    if (state.arena) drawArenaActors(); else drawPlayer();
    drawEffects();
    drawObjectiveMarker();
    ctx.restore();
    if (!state.arena && Math.abs(state.camera.rotation) < .001) drawDepthMarks();
    drawScreenFinish();
    if (state.flash > 0) {
      ctx.globalAlpha = Math.min(.25, state.flash);
      ctx.fillStyle = state.upgrades.multiball ? COLORS.brood : COLORS.ball;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  function updateObjectiveUI() {
    objectivePanel.classList.toggle("complete", state.objectivePhase === "complete");
    if (state.objectivePhase === "find") {
      objectiveKicker.textContent = state.discoveredBrood ? "THE BROOD" : "EXPEDITION 01";
      objectiveTitle.textContent = state.discoveredBrood ? `Rupture the heart · ${state.heartDestroyed}/${state.heartTotal}` : "Follow the living seam";
      objectiveDetail.textContent = state.discoveredBrood ? "Shell cells yield only while a swarm is active." : "The old survey tunnel descends southeast.";
    } else if (state.objectivePhase === "return") {
      objectiveKicker.textContent = "BROOD CORE ACQUIRED";
      objectiveTitle.textContent = "Return to the sealed pocket";
      objectiveDetail.textContent = "Arm the Core with SHIFT; it divides on paddle contact.";
    } else {
      objectiveKicker.textContent = "FIELD TEST COMPLETE";
      objectiveTitle.textContent = "The old stone remembers the swarm";
      objectiveDetail.textContent = "Continue mining—or open the Power Lab with L.";
    }
  }

  function updateArenaReadout() {
    const arena = state.arena;
    arenaReadout.classList.toggle("visible", Boolean(arena));
    if (!arena) return;
    ballCount.textContent = String(arena.balls.length);
    comboCount.textContent = String(arena.combo);
    splitState.classList.toggle("armed", arena.splitArmed);
    if (!state.upgrades.multiball) splitState.textContent = "BROOD CORE DORMANT";
    else if (arena.splitUsed) splitState.textContent = "CORE SPENT THIS CLAIM";
    else if (arena.splitArmed) splitState.textContent = "SPLIT ARMED";
    else splitState.textContent = "SHIFT · ARM SPLIT";
  }

  function updateUI() {
    const labels = { roam: "ROAM", frame: "FRAME CLAIM", play: "EXCAVATION LIVE" };
    const transitionPhase = state.camera.transition?.phase;
    modeLabel.textContent = transitionPhase
      ? (transitionPhase.includes("in") ? "ALIGNING ARENA" : "RETURNING TO MINE")
      : labels[state.mode];
    if (state.mode === "roam") {
      instructions.innerHTML = "<span><kbd>WASD</kbd> drift</span><span><kbd>R</kbd> rotate</span><span><kbd>F</kbd> establish arena</span>";
      claimValue.textContent = "—"; claimUnit.textContent = "unread";
    } else if (state.mode === "frame") {
      instructions.innerHTML = "<span><kbd>WASD</kbd> reposition</span><span><kbd>R</kbd> rotate</span><span><kbd>ARROWS</kbd> resize</span><span><kbd>ENTER</kbd> commit</span><span><kbd>ESC</kbd> cancel</span>";
      claimValue.textContent = `${state.frame.width}×${state.frame.depth}`;
      claimUnit.textContent = DIRECTIONS[state.player.direction].name;
    } else {
      const splitHelp = state.upgrades.multiball ? "<span><kbd>SHIFT</kbd> arm brood split</span>" : "";
      instructions.innerHTML = transitionPhase
        ? "<span>Stabilizing local playfield…</span>"
        : `<span><kbd>A / D</kbd> paddle</span><span><kbd>Q / E</kbd> aim serve</span><span><kbd>SPACE</kbd> serve</span>${splitHelp}`;
      claimValue.textContent = `${state.arena?.collected ?? 0}/${state.arena?.resourceCount ?? 0}`;
      claimUnit.textContent = "secured";
    }
    updateArenaReadout();
    updateObjectiveUI();
  }

  function checkProgress() {
    const remainingHearts = world.flat().filter((tile) => tile.kind === "heart" && tile.solid).length;
    state.heartDestroyed = state.heartTotal - remainingHearts;
    if (remainingHearts === 0 && !state.upgrades.multiball) {
      state.upgrades.multiball = true;
      labMultiball.checked = true;
      state.objectivePhase = "return";
      state.flash = .65;
      sound("upgrade");
      showToast("BROOD CORE ACQUIRED · PERMANENT MULTIBALL", 3600, true);
      if (state.arena) state.arena.splitUsed = false;
    }
    const remainingVault = world.flat().filter((tile) => tile.persistent && tile.x >= 24 && tile.x <= 27 && tile.y >= 19 && tile.y <= 25 && tile.solid).length;
    if (state.objectivePhase === "return" && remainingVault === 0) {
      state.objectivePhase = "complete";
      state.vaultComplete = true;
      sound("complete");
      showToast("FIELD TEST COMPLETE · OLD STONE RECONTEXTUALIZED", 4200, true);
    }
    updateUI();
  }

  function showToast(message, duration = 1700, brood = false) {
    toast.textContent = message;
    toast.classList.toggle("brood", brood);
    toast.classList.add("show");
    clearTimeout(state.messageTimer);
    state.messageTimer = setTimeout(() => toast.classList.remove("show"), duration);
  }

  function initAudio() {
    if (state.audio) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    state.audio = new AudioContext();
  }

  function tone(frequency, duration, type = "sine", volume = .03, endFrequency = null) {
    if (!state.audio) return;
    const now = state.audio.currentTime;
    const oscillator = state.audio.createOscillator();
    const gain = state.audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain); gain.connect(state.audio.destination);
    oscillator.start(now); oscillator.stop(now + duration);
  }

  function sound(name, value = 0) {
    if (!state.audio) return;
    if (name === "hit") tone(145 + Math.min(140, value * 8), .045, "square", .018);
    if (name === "break") { tone(220 + Math.min(220, value * 9), .07, "triangle", .035, 110); tone(620, .025, "square", .012); }
    if (name === "paddle") tone(105 + value * 12, .06, "triangle", .035, 190 + value * 15);
    if (name === "rail") tone(330, .024, "sine", .012);
    if (name === "collect") tone(520 + (value % 5) * 70, .09, "sine", .035, 760);
    if (name === "split") { tone(250, .12, "triangle", .035, 610); tone(370, .14, "sine", .025, 850); }
    if (name === "coreSplit") { tone(110, .22, "sawtooth", .04, 440); tone(330, .28, "triangle", .035, 920); }
    if (name === "shell") tone(82, .07, "square", .025, 58);
    if (name === "deny") tone(75, .11, "sawtooth", .025, 52);
    if (name === "commit") tone(92, .2, "triangle", .035, 260);
    if (name === "ballLost") tone(180, .18, "triangle", .025, 52);
    if (name === "lost") tone(120, .35, "sawtooth", .025, 45);
    if (name === "clear") { tone(240, .18, "triangle", .03, 480); tone(360, .25, "sine", .025, 720); }
    if (name === "discover") { tone(110, .6, "sine", .04, 330); tone(165, .8, "triangle", .025, 495); }
    if (name === "upgrade") { tone(110, .7, "sawtooth", .045, 440); tone(220, .8, "triangle", .04, 880); tone(330, 1, "sine", .03, 990); }
    if (name === "complete") { tone(196, .4, "triangle", .035, 392); tone(294, .6, "sine", .03, 588); }
  }

  function serveArena() {
    const arena = state.arena;
    if (!arena || arena.resolving || state.camera.transition || arena.balls.some((ball) => ball.served)) return;
    const ball = arena.balls[0];
    const speed = state.lab.ballSpeed;
    ball.vu = arena.serveAim * speed;
    ball.vv = Math.sqrt(Math.max(1, speed ** 2 - ball.vu ** 2));
    ball.served = true;
    sound("paddle");
    showToast("Claim live", 700);
  }

  function toggleLab(force) {
    const open = force ?? !labPanel.classList.contains("open");
    labPanel.classList.toggle("open", open);
    labPanel.setAttribute("aria-hidden", String(!open));
  }

  function handleKeyDown(event) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    if (event.code === "KeyL") {
      toggleLab();
      return;
    }
    if (!state.started && event.code !== "Escape") startGame();
    state.keys.add(event.code);
    if (event.repeat) return;

    if (state.mode === "roam") {
      if (event.code === "KeyR") {
        state.player.direction = (state.player.direction + 1) % 4;
        showToast(`Facing ${DIRECTIONS[state.player.direction].name}`, 700);
        sound("rail");
      } else if (event.code === "KeyF") {
        state.mode = "frame";
        updateUI();
      }
    } else if (state.mode === "frame") {
      if (event.code === "KeyR") {
        state.player.direction = (state.player.direction + 1) % 4;
        showToast(`Frame facing ${DIRECTIONS[state.player.direction].name}`, 700);
        sound("rail");
      }
      if (event.code === "ArrowLeft") state.frame.width = Math.max(5, state.frame.width - 2);
      if (event.code === "ArrowRight") state.frame.width = Math.min(19, state.frame.width + 2);
      if (event.code === "ArrowUp") state.frame.depth = Math.min(20, state.frame.depth + 1);
      if (event.code === "ArrowDown") state.frame.depth = Math.max(6, state.frame.depth - 1);
      if (event.code === "Enter") establishArena();
      if (event.code === "Escape" || event.code === "KeyF") state.mode = "roam";
      updateUI();
    } else if (state.mode === "play") {
      if (state.camera.transition || state.arena?.resolving) return;
      if (event.code === "Space") serveArena();
      if ((event.code === "ShiftLeft" || event.code === "ShiftRight") && state.upgrades.multiball && state.arena && !state.arena.splitUsed) {
        state.arena.splitArmed = !state.arena.splitArmed;
        showToast(state.arena.splitArmed ? "Split armed · return a ball to the paddle" : "Split disarmed", 1100, state.arena.splitArmed);
        sound(state.arena.splitArmed ? "split" : "rail");
        updateArenaReadout();
      }
    }
  }

  function startGame() {
    state.started = true;
    briefing.classList.add("hidden");
    canvas.focus();
    initAudio();
    if (state.audio?.state === "suspended") state.audio.resume();
    showToast("Follow the signal · choose every cut", 2200);
  }

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", (event) => state.keys.delete(event.code));
  window.addEventListener("blur", () => state.keys.clear());
  beginButton.addEventListener("click", startGame);
  labToggle.addEventListener("click", () => toggleLab());
  closeLab.addEventListener("click", () => toggleLab(false));
  labMultiball.addEventListener("change", () => {
    state.upgrades.multiball = labMultiball.checked;
    if (state.upgrades.multiball && state.objectivePhase === "find") state.objectivePhase = "return";
    updateUI();
  });
  labBallCap.addEventListener("change", () => { state.lab.maxBalls = Number(labBallCap.value); });
  labSpeed.addEventListener("input", () => { state.lab.ballSpeed = Number(labSpeed.value); });
  labWarp.addEventListener("click", () => {
    if (state.mode === "play") finishArena("lost");
    state.player.x = BROOD_HEART.x * TILE;
    state.player.y = BROOD_HEART.y * TILE;
    state.player.direction = 0;
    state.discoveredBrood = true;
    toggleLab(false);
    updateUI();
    showToast("Warp complete · Brood Heart", 1500, true);
  });
  labReset.addEventListener("click", () => window.location.reload());

  generateWorld();
  let previous = performance.now();
  function loop(now) {
    const dt = Math.min(.033, (now - previous) / 1000);
    previous = now;
    state.time += dt;
    if (state.freeze > 0) state.freeze -= dt;
    else if (state.started) {
      if (state.mode === "roam" || state.mode === "frame") updateRoam(dt);
      if (state.mode === "play") updatePlay(dt);
    }
    updateEffects(dt);
    updateCamera(dt);
    state.shake *= Math.pow(.0002, dt);
    state.flash = Math.max(0, state.flash - dt * 1.8);
    depthLabel.textContent = `DEPTH ${Math.max(0, Math.round((state.player.y / TILE - 8) * 12))}m`;
    biomeLabel.textContent = biomeAt(state.player.x / TILE, state.player.y / TILE) === "brood" ? "THE BROOD" : "THE OLD MINE";
    if (state.arena) claimValue.textContent = `${state.arena.collected}/${state.arena.resourceCount}`;
    render();
    requestAnimationFrame(loop);
  }

  updateUI();
  window.__OREKENOID_DEBUG__ = {
    state,
    world,
    establishArena,
    checkProgress,
    getFramedHiddenItems,
    splitActive() {
      const ball = state.arena?.balls.find((candidate) => candidate.served);
      return ball ? splitBall(ball, 2, true) : 0;
    },
    unlockBrood() {
      for (const tile of world.flat()) if (tile.kind === "heart") tile.solid = false;
      checkProgress();
    },
  };
  requestAnimationFrame(loop);
})();
