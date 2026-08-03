import { BALL_RADIUS, BALL_SPEED, BRICK_HALF, BRICK_RADIUS } from "./config";
import { facetNormal, materialOf } from "./materials";
import type { Arena, Ball, Brick, Membrane, Vec2 } from "./types";

export interface SweepHit { t: number; nx: number; ny: number }
export interface BallStepEvents {
  bricks: Brick[];
  membranes: Membrane[];
  paddle: boolean;
  rail: boolean;
  /** True when the rebound came off a facet plane rather than a flat face. */
  faceted: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function rayCircle(px: number, py: number, dx: number, dy: number, cx: number, cy: number, radius: number): number | null {
  const fx = px - cx;
  const fy = py - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return null;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= -1e-7 && t <= 1 + 1e-7 ? clamp(t, 0, 1) : null;
}

export function sweepRoundedRect(
  px: number, py: number, dx: number, dy: number,
  cx: number, cy: number, halfWidth: number, halfHeight: number,
  radius: number, ballRadius: number,
): SweepHit | null {
  const x = px - cx;
  const y = py - cy;
  const expandedX = halfWidth + ballRadius;
  const expandedY = halfHeight + ballRadius;
  const expandedRadius = radius + ballRadius;
  const tangentX = Math.max(0, halfWidth - radius);
  const tangentY = Math.max(0, halfHeight - radius);
  let best: SweepHit | null = null;
  const consider = (t: number | null, nx: number, ny: number) => {
    if (t === null || t < -1e-7 || t > 1 + 1e-7 || dx * nx + dy * ny >= -1e-9) return;
    if (!best || t < best.t) best = { t: clamp(t, 0, 1), nx, ny };
  };

  const qx = Math.max(Math.abs(x) - tangentX, 0);
  const qy = Math.max(Math.abs(y) - tangentY, 0);
  if (Math.abs(x) <= expandedX && Math.abs(y) <= expandedY && qx * qx + qy * qy <= expandedRadius * expandedRadius) {
    const magnitude = Math.hypot(dx, dy) || 1;
    return { t: 0, nx: -dx / magnitude, ny: -dy / magnitude };
  }

  if (Math.abs(dx) > 1e-10) {
    for (const side of [-1, 1]) {
      const t = (side * expandedX - x) / dx;
      if (Math.abs(y + dy * t) <= tangentY + 1e-7) consider(t, side, 0);
    }
  }
  if (Math.abs(dy) > 1e-10) {
    for (const side of [-1, 1]) {
      const t = (side * expandedY - y) / dy;
      if (Math.abs(x + dx * t) <= tangentX + 1e-7) consider(t, 0, side);
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const cornerX = sx * tangentX;
    const cornerY = sy * tangentY;
    const t = rayCircle(x, y, dx, dy, cornerX, cornerY, expandedRadius);
    if (t === null) continue;
    const nxRaw = x + dx * t - cornerX;
    const nyRaw = y + dy * t - cornerY;
    if (nxRaw * sx < -1e-7 || nyRaw * sy < -1e-7) continue;
    const magnitude = Math.hypot(nxRaw, nyRaw) || 1;
    consider(t, nxRaw / magnitude, nyRaw / magnitude);
  }
  return best;
}

export function createBall(u = 0, v = 0.82): Ball {
  return { id: Math.floor(Math.random() * 1e9), u, v, vu: 0, vv: 0, served: false, radius: BALL_RADIUS, glow: 0, trail: [] };
}

export function reflectBall(ball: Ball, nx: number, ny: number, speed = BALL_SPEED): void {
  const dot = ball.vu * nx + ball.vv * ny;
  ball.vu -= 2 * dot * nx;
  ball.vv -= 2 * dot * ny;
  const magnitude = Math.hypot(ball.vu, ball.vv) || speed;
  ball.vu = ball.vu / magnitude * speed;
  ball.vv = ball.vv / magnitude * speed;
}

export function resolvePaddle(ball: Ball, arena: Arena): void {
  const english = clamp((ball.u - arena.paddle.u) / (arena.paddle.width / 2), -1, 1);
  const horizontal = clamp(english * BALL_SPEED * 0.76 + arena.paddle.velocity * 0.13, -BALL_SPEED * 0.82, BALL_SPEED * 0.82);
  ball.vu = horizontal;
  ball.vv = Math.sqrt(Math.max(BALL_SPEED ** 2 - horizontal ** 2, BALL_SPEED ** 2 * 0.28));
  arena.paddle.flash = 0.13;
  arena.paddle.impact = english;
  arena.combo = 0;
}

type ContactType = "rail" | "paddle" | "brick" | "membrane";

export function stepBall(ball: Ball, arena: Arena, dt: number, onEvents: (events: BallStepEvents) => void): void {
  const half = arena.width / 2;
  let remaining = dt;
  let iterations = 0;
  while (remaining > 1e-6 && iterations++ < 8) {
    const du = ball.vu * remaining;
    const dv = ball.vv * remaining;
    let bestT = 1 + 1e-6;
    let contacts: Array<SweepHit & { type: ContactType; subject?: Brick; membrane?: Membrane }> = [];
    const consider = (
      hit: SweepHit | null,
      type: ContactType,
      subject?: Brick,
      membrane?: Membrane,
    ) => {
      if (!hit || hit.t < -1e-7 || hit.t > 1 + 1e-7) return;
      if (hit.t < bestT - 1e-6) { bestT = hit.t; contacts = [{ ...hit, type, subject, membrane }]; }
      else if (Math.abs(hit.t - bestT) <= 1e-6) contacts.push({ ...hit, type, subject, membrane });
    };
    if (du < 0) consider({ t: (-half + ball.radius - ball.u) / du, nx: 1, ny: 0 }, "rail");
    if (du > 0) consider({ t: (half - ball.radius - ball.u) / du, nx: -1, ny: 0 }, "rail");
    if (dv > 0) consider({ t: (arena.depth + 0.55 - ball.radius - ball.v) / dv, nx: 0, ny: -1 }, "rail");
    if (dv < 0) consider(sweepRoundedRect(ball.u, ball.v, du, dv, arena.paddle.u, 0.2, arena.paddle.width / 2, 0.18, 0.16, ball.radius), "paddle");
    for (const brick of arena.bricks) if (brick.alive) {
      consider(sweepRoundedRect(ball.u, ball.v, du, dv, brick.u, brick.v, BRICK_HALF, BRICK_HALF, BRICK_RADIUS, ball.radius), "brick", brick);
    }
    // Spore membranes are rebound surfaces with a lifetime, never destructible.
    for (const membrane of arena.membranes) if (membrane.life > 0) {
      consider(
        sweepRoundedRect(ball.u, ball.v, du, dv, membrane.u, membrane.v, membrane.halfWidth, membrane.halfHeight, 0.1, ball.radius),
        "membrane",
        undefined,
        membrane,
      );
    }
    if (!contacts.length || bestT > 1) { ball.u += du; ball.v += dv; break; }
    ball.u += du * bestT;
    ball.v += dv * bestT;
    remaining *= Math.max(0, 1 - bestT);
    let nx = 0;
    let ny = 0;
    for (const contact of contacts) { nx += contact.nx; ny += contact.ny; }
    const normalMagnitude = Math.hypot(nx, ny) || 1;
    nx /= normalMagnitude;
    ny /= normalMagnitude;
    const paddle = contacts.some((contact) => contact.type === "paddle");
    const bricks = [...new Set(contacts.filter((contact) => contact.type === "brick").map((contact) => contact.subject).filter(Boolean))] as Brick[];
    const membranes = [...new Set(contacts.filter((contact) => contact.type === "membrane").map((contact) => contact.membrane).filter(Boolean))] as Membrane[];
    const rail = contacts.some((contact) => contact.type === "rail");

    // Material contact rule. A facet is a mirror set on a fixed diagonal, so an
    // axis-aligned approach leaves at a right angle regardless of which face it
    // struck. This is the one place the solver consults material, and it consults
    // the shared table rather than branching on province.
    let faceted = false;
    if (!paddle) {
      const facetBrick = bricks.find((brick) => materialOf(brick.kind).reflect === "facet");
      if (facetBrick) {
        const plane = facetNormal(facetBrick.facetAxis, ball.vu, ball.vv);
        nx = plane.nx;
        ny = plane.ny;
        faceted = true;
      }
    }

    if (paddle) resolvePaddle(ball, arena); else reflectBall(ball, nx, ny);
    onEvents({ bricks, membranes, paddle, rail, faceted });
    ball.u += nx * 0.0008;
    ball.v += ny * 0.0008;
  }
}

/**
 * Predict where the ball is going.
 *
 * Deliberately reuses the same sweep the solver uses, rather than an approximate
 * raycast, so the drawn line cannot disagree with what actually happens. Facet
 * planes are honoured for the same reason -- a predicted path through Mirrorreef
 * that ignored the 90-degree turn would be worse than no line at all.
 *
 * `bounces` is how many rebounds to follow. Zero draws only the current leg,
 * which is the unupgraded default.
 */
export function predictPath(arena: Arena, ball: Ball, bounces: number, maxLength = 34): Vec2[] {
  const half = arena.width / 2;
  const points: Vec2[] = [{ x: ball.u, y: ball.v }];
  const speed = Math.hypot(ball.vu, ball.vv);
  if (speed < 1e-6) return points;

  let u = ball.u;
  let v = ball.v;
  let dirU = ball.vu / speed;
  let dirV = ball.vv / speed;
  let remaining = maxLength;

  for (let segment = 0; segment <= bounces; segment++) {
    if (remaining <= 0.02) break;
    const stepU = dirU * remaining;
    const stepV = dirV * remaining;
    let bestT = 1 + 1e-6;
    let nx = 0;
    let ny = 0;
    let hitBrick: Brick | null = null;
    let hit = false;

    const consider = (t: number | null, hnx: number, hny: number, brick: Brick | null) => {
      if (t === null || t < -1e-7 || t > 1 + 1e-7 || t >= bestT) return;
      bestT = clamp(t, 0, 1);
      nx = hnx;
      ny = hny;
      hitBrick = brick;
      hit = true;
    };

    if (stepU < 0) consider((-half + ball.radius - u) / stepU, 1, 0, null);
    if (stepU > 0) consider((half - ball.radius - u) / stepU, -1, 0, null);
    if (stepV > 0) consider((arena.depth + 0.55 - ball.radius - v) / stepV, 0, -1, null);
    for (const brick of arena.bricks) {
      if (!brick.alive) continue;
      const sweep = sweepRoundedRect(u, v, stepU, stepV, brick.u, brick.v, BRICK_HALF, BRICK_HALF, BRICK_RADIUS, ball.radius);
      if (sweep) consider(sweep.t, sweep.nx, sweep.ny, brick);
    }
    for (const membrane of arena.membranes) {
      if (membrane.life <= 0) continue;
      const sweep = sweepRoundedRect(u, v, stepU, stepV, membrane.u, membrane.v, membrane.halfWidth, membrane.halfHeight, 0.1, ball.radius);
      if (sweep) consider(sweep.t, sweep.nx, sweep.ny, null);
    }

    if (!hit) {
      points.push({ x: u + stepU, y: v + stepV });
      break;
    }

    u += stepU * bestT;
    v += stepV * bestT;
    points.push({ x: u, y: v });
    remaining *= Math.max(0, 1 - bestT);

    const facet = hitBrick as Brick | null;
    if (facet && materialOf(facet.kind).reflect === "facet") {
      const plane = facetNormal(facet.facetAxis, dirU, dirV);
      nx = plane.nx;
      ny = plane.ny;
    }
    const dot = dirU * nx + dirV * ny;
    dirU -= 2 * dot * nx;
    dirV -= 2 * dot * ny;
    u += nx * 0.002;
    v += ny * 0.002;
  }
  return points;
}
