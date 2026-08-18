// The ball, out in the world.
//
// The arena solver in `physics.ts` sweeps a ball against a lattice of independent brick rects in
// paddle-local space. Out in the caverns there is no lattice and no paddle -- there is the cell
// grid, and solidity derived from every cut ever made in it. So this is a second solver rather
// than a generalisation of the first: same feel, different world.
//
// Everything here is in **cells and cells per second**, matching `solidAt` and the arena's own
// `BALL_SPEED` / `BALL_RADIUS`, so a cavern volley and an arena volley are the same ball moving at
// the same pace. Nothing in this file touches Pixi, the world model, or global state -- it takes a
// solidity oracle and a ball, and it is therefore testable without a browser.

import { BALL_RADIUS, BALL_SPEED, WORLD_COLS, WORLD_ROWS } from "../config";
import { FEEL } from "../physics";

export const FIELD = {
  /** Cavern volley pace. The arena's opening speed, before its clear-ramp. */
  speed: BALL_SPEED,
  radius: BALL_RADIUS,
  /**
   * Smallest angle, in radians, the ball may leave a wall at relative to that wall's normal.
   *
   * This is `FEEL.minOffVertical` doing its own job in a different room. In the arena it forbids
   * the exactly-vertical rally the player cannot break out of; here it forbids the exactly
   * perpendicular rebound, which in a one-cell slot is an infinite ping-pong between two faces --
   * the same degenerate state, arrived at the same way. Nudged off the normal, the ball walks
   * along the corridor and leaves.
   */
  minOffNormal: FEEL.minOffVertical,
  /**
   * Largest distance, in cells, the ball may advance between collision tests.
   *
   * Below the radius, so the circle can never step past a cell it should have hit. At the field
   * speed one frame at 60fps is about 0.16 cells, so ordinary play takes a single substep and the
   * loop only does real work when the frame hitches.
   */
  maxSubstep: BALL_RADIUS * 0.8,
  /** How far out of rock a buried ball is allowed to be pushed before it is declared lost. */
  maxUnburyCells: 2,
  /**
   * Overlap below this is not a contact.
   *
   * A ball resting exactly tangent to a face reports an overlap of about 1e-15, and pushing it out
   * by 1e-15 does not move it at all -- so without a floor the resolver spins on a contact it can
   * never clear and reports a ball sitting in open air as buried.
   */
  contactEpsilon: 1e-7,
  /** Pushed this much clear of a face rather than exactly onto it, so it settles instead of grazing. */
  contactSkin: 1e-4,
} as const;

export interface FieldBall {
  /** Cell coordinates. */
  x: number;
  y: number;
  /** Cells per second. */
  vx: number;
  vy: number;
  radius: number;
  /** Seconds since the ball was fired. The caller's recharge clock reads this. */
  age: number;
}

/** Anything that can answer "is this point rock?". `WorldModel` satisfies it. */
export interface SolidityOracle {
  solidAt(x: number, y: number): boolean;
}

export interface FieldBounce {
  /** Where the ball was when it rebounded, in cells. */
  x: number;
  y: number;
  /** Outward surface normal it rebounded off. */
  nx: number;
  ny: number;
}

export interface FieldStep {
  bounces: FieldBounce[];
  /** Cells travelled this step. */
  distance: number;
  /** The ball is inside rock with no way out, and the caller should retire it. */
  buried: boolean;
}

export function createFieldBall(x: number, y: number, heading: number, speed = FIELD.speed): FieldBall {
  return {
    x,
    y,
    vx: Math.cos(heading) * speed,
    vy: Math.sin(heading) * speed,
    radius: FIELD.radius,
    age: 0,
  };
}

/**
 * Rock, including everything past the edge of the map.
 *
 * `solidAt` reports a cell that does not exist as not solid, which is the right answer when
 * sampling a claim -- outside the map there is simply nothing to cut -- and the wrong one for a
 * ball, which would sail out of the world and never come back. Same distinction the drone's hull
 * makes, for the same reason.
 */
function blocked(world: SolidityOracle, cellX: number, cellY: number): boolean {
  if (cellX < 0 || cellY < 0 || cellX >= WORLD_COLS || cellY >= WORLD_ROWS) return true;
  return world.solidAt(cellX + 0.5, cellY + 0.5);
}

/**
 * Which way to slide a ball that hit a wall dead on.
 *
 * Deterministic, because a replayed save and a test both have to reproduce the same volley. Taken
 * from the impact cell's parity rather than a random draw, so neighbouring faces disagree and a
 * ball working along a corridor does not get nudged the same way every time.
 */
function tangentSign(cellX: number, cellY: number): number {
  return ((cellX * 73_856_093) ^ (cellY * 19_349_663)) & 1 ? 1 : -1;
}

/**
 * The deepest overlap between the ball and the rock around it.
 *
 * Every solid cell is an axis-aligned unit box, so the nearest point on each box to the ball's
 * centre gives both the distance and the normal. Taking the deepest of them resolves inside
 * corners correctly: the face the ball is most buried in is the one that pushed it there.
 */
function deepestContact(
  world: SolidityOracle,
  x: number,
  y: number,
  radius: number,
): { nx: number; ny: number; depth: number; cellX: number; cellY: number } | null {
  let best: { nx: number; ny: number; depth: number; cellX: number; cellY: number } | null = null;
  const minX = Math.floor(x - radius);
  const maxX = Math.floor(x + radius);
  const minY = Math.floor(y - radius);
  const maxY = Math.floor(y + radius);
  for (let cellY = minY; cellY <= maxY; cellY++) {
    for (let cellX = minX; cellX <= maxX; cellX++) {
      if (!blocked(world, cellX, cellY)) continue;
      const nearestX = Math.max(cellX, Math.min(x, cellX + 1));
      const nearestY = Math.max(cellY, Math.min(y, cellY + 1));
      let dx = x - nearestX;
      let dy = y - nearestY;
      let distance = Math.hypot(dx, dy);
      if (distance > radius - FIELD.contactEpsilon) continue;
      if (distance < 1e-9) {
        // Centre inside the box. There is no nearest-point normal to read, so leave along whichever
        // face is closest -- the shallowest way out is the one that does not shove the ball through
        // the rock behind it.
        const left = x - cellX;
        const right = cellX + 1 - x;
        const up = y - cellY;
        const down = cellY + 1 - y;
        const least = Math.min(left, right, up, down);
        dx = least === left ? -left : least === right ? right : 0;
        dy = least === up ? -up : least === down ? down : 0;
        distance = least || 1e-9;
        const depth = radius + least;
        if (!best || depth > best.depth) {
          best = { nx: Math.sign(dx) || 0, ny: Math.sign(dy) || 0, depth, cellX, cellY };
        }
        continue;
      }
      const depth = radius - distance;
      if (!best || depth > best.depth) {
        best = { nx: dx / distance, ny: dy / distance, depth, cellX, cellY };
      }
    }
  }
  return best;
}

/** Rebound off a surface, then refuse the perpendicular return that never ends. */
function reflect(ball: FieldBall, nx: number, ny: number, cellX: number, cellY: number): void {
  const speed = Math.hypot(ball.vx, ball.vy) || FIELD.speed;
  const dot = ball.vx * nx + ball.vy * ny;
  let vx = ball.vx - 2 * dot * nx;
  let vy = ball.vy - 2 * dot * ny;
  const magnitude = Math.hypot(vx, vy) || speed;
  vx = vx / magnitude * speed;
  vy = vy / magnitude * speed;

  // Angle between the outgoing heading and the surface normal. Zero is a dead-on return.
  const along = vx * nx + vy * ny;
  const cosLimit = Math.cos(FIELD.minOffNormal);
  if (along > cosLimit * speed) {
    // Tangent to the surface, in the direction the ball was already drifting. A ball that arrived
    // with no drift at all takes the cell's own sign, so the choice stays deterministic.
    const tangentX = -ny;
    const tangentY = nx;
    const drift = ball.vx * tangentX + ball.vy * tangentY;
    const sign = Math.abs(drift) > 1e-6 ? Math.sign(drift) : tangentSign(cellX, cellY);
    vx = (nx * Math.cos(FIELD.minOffNormal) + tangentX * sign * Math.sin(FIELD.minOffNormal)) * speed;
    vy = (ny * Math.cos(FIELD.minOffNormal) + tangentY * sign * Math.sin(FIELD.minOffNormal)) * speed;
  }
  ball.vx = vx;
  ball.vy = vy;
}

/**
 * Advance one ball through the rock for `dt` seconds.
 *
 * Returns every rebound so the caller can spark, ring and sound them, and reports the ball as
 * buried when regrowth or a bad spawn has left it somewhere it cannot be pushed out of.
 */
export function stepFieldBall(ball: FieldBall, world: SolidityOracle, dt: number): FieldStep {
  const bounces: FieldBounce[] = [];
  const step: FieldStep = { bounces, distance: 0, buried: false };
  ball.age += Math.max(0, dt);

  // Start buried: push out before moving, or retire the ball. A ball that has had rock grow back
  // around it must not simply vanish -- the caller shows it leaving.
  for (let escape = 0; escape < 16; escape++) {
    const contact = deepestContact(world, ball.x, ball.y, ball.radius);
    if (!contact) break;
    if (contact.depth > ball.radius + FIELD.maxUnburyCells) {
      step.buried = true;
      return step;
    }
    ball.x += contact.nx * (contact.depth + FIELD.contactSkin);
    ball.y += contact.ny * (contact.depth + FIELD.contactSkin);
  }
  // Asked again rather than inferred from the loop running out: a pinch between two faces can take
  // several pushes and still end in open air, and calling that buried retires a live ball.
  if (deepestContact(world, ball.x, ball.y, ball.radius)) {
    step.buried = true;
    return step;
  }

  // Only the travel is skipped for a zero-length step. The burial check above still runs, which is
  // what makes `stepFieldBall(ball, world, 0)` a usable "could this ball exist here?" question --
  // returning early would have answered "not buried" for a ball spawned in the middle of a wall.
  if (dt <= 0) return step;

  let remaining = dt;
  let guard = 0;
  while (remaining > 1e-6 && guard < 512) {
    guard++;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed < 1e-6) break;
    const slice = Math.min(remaining, FIELD.maxSubstep / speed);
    remaining -= slice;
    ball.x += ball.vx * slice;
    ball.y += ball.vy * slice;
    step.distance += speed * slice;

    // Resolve repeatedly, because leaving one face can press the ball into the next one along --
    // which is exactly what an inside corner is.
    for (let pass = 0; pass < 4; pass++) {
      const contact = deepestContact(world, ball.x, ball.y, ball.radius);
      if (!contact) break;
      ball.x += contact.nx * (contact.depth + FIELD.contactSkin);
      ball.y += contact.ny * (contact.depth + FIELD.contactSkin);
      // Only rebound off a face the ball is actually travelling into. Without this, being pushed
      // out of a corner reflects the ball twice and it leaves along the path it arrived on.
      if (ball.vx * contact.nx + ball.vy * contact.ny < 0) {
        reflect(ball, contact.nx, contact.ny, contact.cellX, contact.cellY);
        bounces.push({ x: ball.x, y: ball.y, nx: contact.nx, ny: contact.ny });
      }
    }
  }
  return step;
}

/**
 * Lift a circle out of any rock it overlaps.
 *
 * Creatures move through the same grid the ball does and must not end a frame inside a wall, so
 * they resolve against the same contact routine rather than a second one that could disagree with
 * it. Returns the corrected position and the face that did the pushing, which a charging creature
 * reads as "I hit something".
 */
export function resolveCircle(
  world: SolidityOracle,
  x: number,
  y: number,
  radius: number,
): { x: number; y: number; hit: boolean; nx: number; ny: number } {
  let nx = 0;
  let ny = 0;
  let hit = false;
  for (let pass = 0; pass < 8; pass++) {
    const contact = deepestContact(world, x, y, radius);
    if (!contact) break;
    x += contact.nx * (contact.depth + FIELD.contactSkin);
    y += contact.ny * (contact.depth + FIELD.contactSkin);
    nx = contact.nx;
    ny = contact.ny;
    hit = true;
  }
  return { x, y, hit, nx, ny };
}

/**
 * Did the ball's path this frame pass through this circle?
 *
 * Creatures are circles and the ball is small and fast, so a point-segment test against the swept
 * path catches contacts that sampling the endpoints would step straight over. Used by the caller
 * for creature hits; terrain is handled above.
 */
export function pathHitsCircle(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return Math.hypot(cx - fromX, cy - fromY) <= radius;
  const t = Math.max(0, Math.min(1, ((cx - fromX) * dx + (cy - fromY) * dy) / lengthSquared));
  const nearestX = fromX + dx * t;
  const nearestY = fromY + dy * t;
  return Math.hypot(cx - nearestX, cy - nearestY) <= radius;
}
