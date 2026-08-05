// The arena board and its in-world overlays.
//
// A claim is presented as a *geological section*, not as a minigame panel: the
// world's strata keep going around a translucent extracted block, and rails and
// anchors are machinery bolted into real rock. Everything here is drawn in world
// space and rotated to the claim's heading, so the board stays part of the mine
// even while the camera is looking at it paddle-down.

import { Graphics } from "pixi.js";
import { BALL_SPEED, CELL, PALETTE, PROVINCE_PALETTE } from "../config";
import { calculateClaimDamage } from "../claims";
import { flatPoints } from "../maths";
import type { StationGrades } from "../economy";
import { predictPath } from "../physics";
import type { Arena, Ball, Vec2 } from "../types";
import { attachBall, createPaddle } from "./actors";
import { createBrickDisplay } from "./brick";

/** Arena-local to world-cell transform. Supplied by the caller's `WorldModel`. */
export type ToWorld = (u: number, v: number) => Vec2;

/**
 * Build every display object a committed arena needs.
 *
 * Draw order is load-bearing: cut shadow, translucent section, and lattice go on
 * `board` beneath the bricks; rails, gauges, paddle and balls go on `actors` above
 * them, so a ball never disappears behind the geometry it is bouncing off.
 */
export function buildArenaDisplay(arena: Arena, toWorld: ToWorld, grades: StationGrades = {}): void {
  const half = arena.width / 2;
  const accent = PROVINCE_PALETTE[arena.province].accent;
  const corners = [[-half, -0.15], [half, -0.15], [half, arena.depth + 0.55], [-half, arena.depth + 0.55]]
    .map(([u, v]) => toWorld(u, v));
  const polygon = flatPoints(corners.map((point) => ({ x: point.x * CELL, y: point.y * CELL })));

  // The extracted section reads as a hole cut into rock: a heavy dark rim outside,
  // a slight darkening inside, and the world still visible through it.
  const cutShadow = new Graphics().poly(polygon)
    .fill({ color: 0x020506, alpha: 0.54 })
    .stroke({ width: 12, color: 0x020405, alpha: 0.52 });
  const section = new Graphics().poly(polygon).fill({ color: 0x0d1011, alpha: 0.28 });

  const lattice = new Graphics();
  for (let column = 1; column < arena.width; column++) {
    const u = -half + column;
    const a = toWorld(u, 0);
    const b = toWorld(u, arena.depth + 0.5);
    lattice.moveTo(a.x * CELL, a.y * CELL).lineTo(b.x * CELL, b.y * CELL);
  }
  for (let row = 1; row <= arena.depth; row++) {
    const a = toWorld(-half, row);
    const b = toWorld(half, row);
    lattice.moveTo(a.x * CELL, a.y * CELL).lineTo(b.x * CELL, b.y * CELL);
  }
  lattice.stroke({ width: 1, color: accent, alpha: 0.075 });
  arena.board.addChild(cutShadow, section, lattice);

  for (const brick of arena.bricks) {
    const { container, damage } = createBrickDisplay(brick);
    brick.display = container;
    brick.damageDisplay = damage;
    const position = toWorld(brick.u, brick.v);
    container.position.set(position.x * CELL, position.y * CELL);
    container.rotation = arena.angle;
    // Bricks are revealed by the scan animation, so they start invisible and small.
    container.alpha = 0;
    container.scale.set(0.72);
    arena.board.addChild(container);
  }

  // Rails, drawn twice: a thick dark body so they occlude, and a thin accent
  // highlight so they read as lit machined edges.
  const rails = new Graphics();
  const railLight = new Graphics();
  const farA = toWorld(-half, arena.depth + 0.5);
  const farB = toWorld(half, arena.depth + 0.5);
  for (const graphic of [rails, railLight]) {
    for (const u of [-half, half]) {
      const a = toWorld(u, 0);
      const b = toWorld(u, arena.depth + 0.5);
      graphic.moveTo(a.x * CELL, a.y * CELL).lineTo(b.x * CELL, b.y * CELL);
    }
    graphic.moveTo(farA.x * CELL, farA.y * CELL).lineTo(farB.x * CELL, farB.y * CELL);
  }
  rails.stroke({ width: 11, color: 0x050809, alpha: 0.92 });
  railLight.stroke({ width: 2.5, color: accent, alpha: 0.88 });

  // Anchors on the three closed corners. The open edge behind the paddle gets none,
  // which is how the board says where the ball can be lost.
  const anchors = new Graphics();
  for (const point of [corners[1], corners[2], corners[3]]) {
    const x = point.x * CELL;
    const y = point.y * CELL;
    anchors.circle(x, y, 8).fill(0x111718).stroke({ width: 2.5, color: accent });
    anchors.circle(x, y, 2.5).fill(accent);
  }
  arena.railLight = railLight;
  arena.actors.addChild(rails, railLight, anchors);

  arena.trajectoryDisplay = new Graphics();
  arena.actors.addChild(arena.trajectoryDisplay);
  arena.liabilityDisplay = new Graphics();
  arena.actors.addChild(arena.liabilityDisplay);
  arena.paddle.display = createPaddle(arena, grades);
  arena.actors.addChild(arena.paddle.display);
  for (const ball of arena.balls) attachBall(ball, arena);
}

/**
 * The dotted forward trajectory.
 *
 * Unupgraded this shows only the current leg, which is an aiming aid rather than a
 * solution; optics extend it through rebounds. Later legs fade, so the certain part
 * of the prediction reads strongest and the speculative tail does not lie.
 */
export function drawTrajectory(arena: Arena, toWorld: ToWorld, bounces: number): void {
  const graphic = arena.trajectoryDisplay;
  if (!graphic) return;
  graphic.clear();
  const ball = arena.balls[0];
  if (!ball || arena.resolving) return;

  // Before the serve the line follows the aim, so it doubles as the aim preview.
  const preview = ball.served
    ? ball
    : {
      ...ball,
      vu: arena.serveAim * BALL_SPEED,
      vv: Math.sqrt(Math.max(1, BALL_SPEED ** 2 - (arena.serveAim * BALL_SPEED) ** 2)),
    };
  const path = predictPath(arena, preview as Ball, bounces);
  if (path.length < 2) return;

  const colour = PROVINCE_PALETTE[arena.province].accent;
  const DASH = 0.34;
  const GAP = 0.26;
  // Dash phase carries across legs so the pattern does not restart at each bounce.
  let carry = 0;
  for (let index = 0; index < path.length - 1; index++) {
    const from = path[index];
    const to = path[index + 1];
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    if (span < 1e-4) continue;
    const stepX = (to.x - from.x) / span;
    const stepY = (to.y - from.y) / span;
    let cursor = carry;
    while (cursor < span) {
      const end = Math.min(span, cursor + DASH);
      const a = toWorld(from.x + stepX * cursor, from.y + stepY * cursor);
      const b = toWorld(from.x + stepX * end, from.y + stepY * end);
      graphic.moveTo(a.x * CELL, a.y * CELL).lineTo(b.x * CELL, b.y * CELL);
      cursor = end + GAP;
    }
    carry = Math.max(0, cursor - span);
    // Mark each predicted rebound so the bounce reads as a deliberate result.
    if (index < path.length - 2) {
      const point = toWorld(to.x, to.y);
      graphic.circle(point.x * CELL, point.y * CELL, 3.4);
    }
    graphic.stroke({ width: 2.4, color: colour, alpha: Math.max(0.14, 0.55 - index * 0.12) });
  }
}

/**
 * The liability gauge, drawn on the board's far edge.
 *
 * It answers one question — *if this claim ended now, would it hurt?* — with a
 * threshold tick at armour capacity. Everything left of the tick is absorbed;
 * everything right of it is health. It is in the world rather than the HUD because
 * the decision it informs is where to aim next.
 */
export function drawLiabilityGauge(arena: Arena, toWorld: ToWorld, soakCapacity: number): void {
  const graphic = arena.liabilityDisplay;
  if (!graphic) return;
  const remaining = arena.bricks.filter((brick) => brick.alive && brick.liable).length;
  const damage = calculateClaimDamage(remaining, soakCapacity);
  const total = Math.max(1, arena.initialLiability, soakCapacity);
  const width = Math.min(arena.width * CELL * 0.72, 330);
  const height = 9;
  const point = toWorld(0, -0.32);
  const safeWidth = width * Math.min(remaining, soakCapacity) / total;
  const dangerWidth = width * damage / total;

  graphic.clear();
  graphic.roundRect(-width / 2, -height / 2, width, height, 4)
    .fill({ color: 0x080b0c, alpha: 0.9 })
    .stroke({
      width: 1.5,
      color: damage ? PALETTE.danger : PROVINCE_PALETTE[arena.province].accent,
      alpha: 0.9,
    });
  if (safeWidth > 0) {
    graphic.roundRect(-width / 2 + 2, -height / 2 + 2, Math.max(1, safeWidth - 4), height - 4, 2)
      .fill({ color: PROVINCE_PALETTE[arena.province].accent, alpha: 0.8 });
  }
  if (dangerWidth > 0) {
    graphic.roundRect(-width / 2 + safeWidth, -height / 2 + 2, Math.max(1, dangerWidth), height - 4, 2)
      .fill({ color: PALETTE.danger, alpha: 0.95 });
  }
  const thresholdX = -width / 2 + width * soakCapacity / total;
  graphic.moveTo(thresholdX, -height).lineTo(thresholdX, height)
    .stroke({ width: 2, color: PALETTE.ink, alpha: 0.9 });
  graphic.position.set(point.x * CELL, point.y * CELL);
  graphic.rotation = arena.angle;
}
