import { BALL_RADIUS, BALL_SPEED, BRICK_HALF, BRICK_RADIUS } from "./config";
import { facetNormal, materialOf } from "./materials";
import type { Arena, Ball, Brick, Membrane, Vec2 } from "./types";

/**
 * Ball feel, gathered.
 *
 * Every number here is a play judgement. They exist because a mirror-and-renormalise solver is
 * physically correct and feels wrong: it permits a ball to skim near-horizontally between the side
 * rails forever, and it permits a dead-vertical rally that no amount of skill breaks out of. The
 * genre's answer, since the arcade cabinets, is to refuse those states outright -- reflection is
 * clamped away from both axes, and a hard minimum off horizontal is what keeps a rally descending.
 */
export const FEEL = {
  /**
   * Minimum angle, in radians, between the ball's heading and the horizontal axis.
   *
   * The floor on "how flat can a rally get". Below about twenty degrees a ball crossing the claim
   * reads as stalled even though it is moving.
   */
  minOffHorizontal: 22 * Math.PI / 180,
  /**
   * Minimum angle off the vertical axis.
   *
   * Smaller, because a steep ball is exciting where a flat one is dull -- this exists only to
   * forbid the exactly-vertical column, which `resolvePaddle` used to produce every time the ball
   * was caught dead centre.
   */
  minOffVertical: 12 * Math.PI / 180,
  /** How much faster the ball ends a fully cleared claim than it started. */
  speedRamp: 0.45,
  /** Paddle response curve. Above one, the centre is forgiving and the edges bite. */
  englishCurve: 1.6,
  /** Share of the paddle's own motion handed to the ball. Catch-and-throw. */
  paddleCarry: 0.22,
} as const;

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
  /**
   * Reject individual candidate surfaces without rejecting the whole shape.
   *
   * This is how interior seams are suppressed. Filtering the *result* instead was wrong and let
   * the ball pass straight through a brick whose nearest surface happened to be an interior
   * corner: the brick has other faces, and one of them is the real contact.
   */
  accept?: (nx: number, ny: number) => boolean,
  /**
   * Extra tangential reach for the flat faces, in cells, per axis.
   *
   * Corner rounding only belongs on *exposed* corners. Where a live neighbour sits alongside, the
   * flat face has to run all the way across the seam, or a ball arriving exactly on the join finds
   * no surface at all: the face test rejects it for being outside the flat span, the corner arcs
   * are interior and suppressed, and it sails through a solid wall.
   */
  padX = 0, padY = 0,
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
    if (accept && !accept(nx, ny)) return;
    if (!best || t < best.t) best = { t: clamp(t, 0, 1), nx, ny };
  };

  const qx = Math.max(Math.abs(x) - tangentX, 0);
  const qy = Math.max(Math.abs(y) - tangentY, 0);
  if (Math.abs(x) <= expandedX && Math.abs(y) <= expandedY && qx * qx + qy * qy <= expandedRadius * expandedRadius) {
    // Already overlapping. Push out along the shallowest escape axis rather than straight back
    // down the velocity, which reversed the ball on the spot and read as a phantom bounce.
    const escapeX = expandedX - Math.abs(x);
    const escapeY = expandedY - Math.abs(y);
    if (escapeX <= escapeY) return { t: 0, nx: x >= 0 ? 1 : -1, ny: 0 };
    return { t: 0, nx: 0, ny: y >= 0 ? 1 : -1 };
  }

  if (Math.abs(dx) > 1e-10) {
    for (const side of [-1, 1]) {
      const t = (side * expandedX - x) / dx;
      if (Math.abs(y + dy * t) <= tangentY + padY + 1e-7) consider(t, side, 0);
    }
  }
  if (Math.abs(dy) > 1e-10) {
    for (const side of [-1, 1]) {
      const t = (side * expandedY - y) / dy;
      if (Math.abs(x + dx * t) <= tangentX + padX + 1e-7) consider(t, 0, side);
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

/**
 * Force a heading at least `offHorizontal` from the horizontal axis and `offVertical` from the
 * vertical one, keeping speed and, wherever possible, the sign of both components.
 *
 * A zero component has no sign to keep, so it is pushed to whichever side the other component
 * suggests -- deterministically, because the same rally must play the same way twice.
 */
export function clampHeading(
  ball: Ball, speed: number, offHorizontal: number, offVertical: number,
): void {
  const angle = Math.atan2(ball.vv, ball.vu);
  // Fold into the first quadrant, clamp there, and unfold. Doing it on the folded angle means one
  // pair of bounds covers all four quadrants and no sign case has to be written out.
  const signU = ball.vu === 0 ? 1 : Math.sign(ball.vu);
  const signV = ball.vv === 0 ? (Math.abs(Math.sin(angle)) >= 0 ? 1 : -1) : Math.sign(ball.vv);
  const folded = Math.abs(Math.atan2(Math.abs(ball.vv), Math.abs(ball.vu)));
  const low = offHorizontal;
  const high = Math.PI / 2 - offVertical;
  const clamped = Math.min(high, Math.max(low, folded));
  ball.vu = Math.cos(clamped) * speed * signU;
  ball.vv = Math.sin(clamped) * speed * signV;
}

export function reflectBall(ball: Ball, nx: number, ny: number, speed = BALL_SPEED): void {
  const dot = ball.vu * nx + ball.vv * ny;
  ball.vu -= 2 * dot * nx;
  ball.vv -= 2 * dot * ny;
  const magnitude = Math.hypot(ball.vu, ball.vv) || speed;
  ball.vu = ball.vu / magnitude * speed;
  ball.vv = ball.vv / magnitude * speed;
  clampHeading(ball, speed, FEEL.minOffHorizontal, FEEL.minOffVertical);
}

/**
 * A facet rebound. Wholly exempt from the off-axis clamp.
 *
 * An exact right angle *is* the Mirrorreef rule -- "an axis-aligned approach leaves at a right
 * angle", which is what makes aligning a claim to the lattice produce controllable cascades. I
 * first gave this a 2.5 degree nudge for the same anti-stall reason as everything else, and that
 * was the wrong trade: it visibly bent a documented mechanic to guard against a hazard the rest of
 * the solver already prevents. An axis-aligned ball cannot orbit forever, because facet bricks die
 * when struck and any rail contact applies the full clamp.
 */
export function reflectFacet(ball: Ball, nx: number, ny: number, speed: number): void {
  const dot = ball.vu * nx + ball.vv * ny;
  ball.vu -= 2 * dot * nx;
  ball.vv -= 2 * dot * ny;
  const magnitude = Math.hypot(ball.vu, ball.vv) || speed;
  ball.vu = ball.vu / magnitude * speed;
  ball.vv = ball.vv / magnitude * speed;
}

export function resolvePaddle(ball: Ball, arena: Arena): void {
  const speed = ballSpeed(arena);
  const english = clamp((ball.u - arena.paddle.u) / (arena.paddle.width / 2), -1, 1);
  // Curved rather than linear. A linear face responds identically everywhere, which reads as mushy;
  // an exponent above one gives the middle a forgiving flat zone and lets the edges bite, which is
  // what makes a paddle feel like an instrument instead of a wall.
  const curved = Math.sign(english) * Math.abs(english) ** FEEL.englishCurve;
  const horizontal = clamp(
    curved * speed * 0.92 + arena.paddle.velocity * FEEL.paddleCarry,
    -speed * 0.94, speed * 0.94,
  );
  ball.vu = horizontal;
  ball.vv = Math.sqrt(Math.max(speed ** 2 - horizontal ** 2, 1e-6));
  // Dead centre used to give exactly zero horizontal, which is a vertical rally the player cannot
  // break out of by playing well.
  clampHeading(ball, speed, FEEL.minOffHorizontal, FEEL.minOffVertical);
  arena.paddle.flash = 0.13;
  arena.paddle.impact = english;
  arena.combo = 0;
}

/**
 * How fast the ball is travelling in this claim.
 *
 * Ramps with how much of the claim has been cleared, and resets with the claim. A constant speed
 * from first serve to last brick gives a claim no shape -- the arcade original accelerated at the
 * fourth hit and again at the twelfth for exactly this reason.
 */
export function ballSpeed(arena: Arena): number {
  const total = Math.max(1, arena.initialLiability);
  const cleared = clamp(1 - arena.bricks.filter((brick) => brick.alive && brick.liable).length / total, 0, 1);
  return BALL_SPEED * (1 + cleared * FEEL.speedRamp);
}

type ContactType = "rail" | "paddle" | "brick" | "membrane";

/**
 * Is a surface with this outward normal hidden by a live neighbour?
 *
 * A wall of bricks should present a wall. Each brick is an independent rounded rect, so without
 * this a ball skimming along a wall catches on the little corner arcs *between* bricks and
 * scatters off interior seams that are not surfaces at all -- a large part of why bounces did not
 * behave the way anyone expected.
 *
 * Geometric rather than grid-keyed. The first version hashed positions to a doubled integer grid,
 * which quietly collapsed distinct positions onto the same key and invented neighbours that were
 * not there; asking whether a live brick actually sits one brick-width away cannot do that.
 */
function neighbourAt(bricks: readonly Brick[], brick: Brick, du: number, dv: number): boolean {
  const width = BRICK_HALF * 2;
  const targetU = brick.u + du * width;
  const targetV = brick.v + dv * width;
  return bricks.some((other) =>
    other !== brick && other.alive
    && Math.abs(other.u - targetU) < BRICK_HALF * 0.5
    && Math.abs(other.v - targetV) < BRICK_HALF * 0.5);
}

/** A face is interior when its outward neighbour is alive; a corner arc when either face is. */
function exposed(bricks: readonly Brick[], brick: Brick, nx: number, ny: number): boolean {
  const alongU = Math.abs(nx) > 1e-6;
  const alongV = Math.abs(ny) > 1e-6;
  if (alongU && neighbourAt(bricks, brick, Math.sign(nx), 0)) return false;
  if (alongV && neighbourAt(bricks, brick, 0, Math.sign(ny))) return false;
  return true;
}

export function stepBall(ball: Ball, arena: Arena, dt: number, onEvents: (events: BallStepEvents) => void): void {
  const half = arena.width / 2;
  const speed = ballSpeed(arena);
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
      // A brick with a live neighbour alongside presents a flat wall across that seam, and its
      // interior arcs are not surfaces at all. Together these two make a row of bricks behave like
      // one wall instead of a line of separate lumps with catchable gaps between them.
      const joinedU = neighbourAt(arena.bricks, brick, -1, 0) || neighbourAt(arena.bricks, brick, 1, 0);
      const joinedV = neighbourAt(arena.bricks, brick, 0, -1) || neighbourAt(arena.bricks, brick, 0, 1);
      consider(sweepRoundedRect(
        ball.u, ball.v, du, dv, brick.u, brick.v, BRICK_HALF, BRICK_HALF, BRICK_RADIUS, ball.radius,
        (nx, ny) => exposed(arena.bricks, brick, nx, ny),
        joinedU ? BRICK_RADIUS : 0, joinedV ? BRICK_RADIUS : 0,
      ), "brick", brick);
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

    if (paddle) resolvePaddle(ball, arena);
    else if (faceted) reflectFacet(ball, nx, ny, speed);
    else reflectBall(ball, nx, ny, speed);
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
