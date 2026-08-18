// What lives in the caverns.
//
// One creature, and it is a ball.
//
// The roster used to be three, differentiated by what they took from the player while the player
// shot at them. That was built on the drone having a ball to shoot, and it no longer does: out in the
// caverns the paddle is a paddle, purely defensive, and the only thing in flight is the enemy itself.
// The Bounder curls up and hurls itself, moving under the same solver the arena's ball moves under,
// so returning one is the same act as returning a serve -- and getting it wrong is the same failure.
//
// The whole fight is in that one exchange:
//
//   * it touches the drone anywhere but the paddle's front face, and the hull pays;
//   * it touches the front face, and it goes back out with english on it, and the rock it lands
//     against is what hurts it.
//
// Three of those to kill. One at a time is a rally you can win standing still; the difficulty is
// entirely in how many are in the air at once, which is a property of the room rather than of the
// creature, and is why there only needs to be one kind of them.
//
// Pure state machine over a solidity oracle: no Pixi, no world model, no globals.

import { resolveCircle, type SolidityOracle } from "./ballField";
import { hasLineOfSight } from "./sight";
import type { ResourceId } from "../config";

export type CreatureKind = "bounder";

/**
 * A Bounder's whole life.
 *
 * `idle` is uncurled and harmless, `coil` is the tell, `hurl` is the shot, `spent` is the beat after
 * it lands during which it cannot do anything at all. The last of those is what makes a crowd
 * readable: every Bounder in the room is somewhere in this cycle, so at any moment some of them are
 * threats and some are furniture, and the player is reading which is which.
 */
export type CreatureState = "idle" | "coil" | "hurl" | "spent" | "dead";

export const BOUNDER = {
  radius: 0.5,
  /** Environment hits, once the paddle has sent it into the rock. */
  hp: 3,
  /**
   * How close the drone has to be for it to wake.
   *
   * Waking needs line of sight as well. Range alone would mean rock stopped mattering, and the
   * whole reason the dark is worth having is that geometry decides what can see you.
   */
  aggroRange: 13,
  /** Past this it stops caring, so a fight can be left rather than only won. */
  forgetRange: 21,
  /** The tell. It has to be readable across a room with several of these in it. */
  coilSeconds: 0.55,
  /** Last stretch of the tell, during which the shot is locked and the lane can be stepped out of. */
  lockSeconds: 0.2,
  /** Flight speed, in cells per second. A shade under the arena ball, so a return is catchable. */
  hurlSpeed: 8.6,
  /** Longest one flight runs before it gives up and uncurls. */
  hurlSeconds: 2.8,
  /** The beat after landing. This is the window to walk away, or to line up the next one. */
  spentSeconds: 1.2,
  /** Hull damage for a hit anywhere but the paddle's front face. */
  hitDamage: 7,
  /** Crawl speed along a surface. Unhurried: it is an animal minding its own business. */
  crawlSpeed: 1.9,
  /**
   * How far off the rock it rides, in cells.
   *
   * Held rather than resolved out of collisions, so it sits *on* the surface with a visible gap
   * rather than embedded in it, and so the re-attach probe below has somewhere to look.
   */
  ride: 0.16,
  /**
   * How far past its ride height it feels for the surface.
   *
   * Strictly further than the ride, and that is not a tolerance: probing exactly to the ride height
   * puts the probe *on* the face, where floating point decides whether the point is in the rock or a
   * hair above it. At a corner it decided wrong, the sweep found nothing, and a Bounder let go of the
   * block it was walking round and stood in the air.
   */
  probeDepth: 0.34,
  /**
   * Widest the surface may turn under it in one re-attach, in radians.
   *
   * This is the whole of the crawl. Each step it walks along the surface it is holding, then looks
   * for that surface again from where it has arrived, sweeping outward from the direction it last
   * found rock. A convex corner turns the rock away and the sweep finds it a little further round; a
   * concave one turns the rock into its path and the sweep finds it a little sooner. Both fall out of
   * the same search, which is why it can circle an island without knowing what an island is.
   */
  reattachSweep: 2.5,
  /** Steps in that sweep. Fine enough to follow a cell-scale corner, coarse enough to be cheap. */
  reattachSteps: 22,
  /** How hard the rock shoves it when a deflected hurl lands. */
  impactKnockback: 3.2,
} as const;

export interface Creature {
  kind: CreatureKind;
  /** Cell coordinates. */
  x: number;
  y: number;
  /** Cells per second. */
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  state: CreatureState;
  /** Seconds left in the current state, where the state is timed. */
  timer: number;
  /** Where it is pointing. Through `coil` this becomes the shot it has committed to. */
  facing: number;
  /** Counts down after damage, purely for the renderer. */
  hitFlash: number;
  /** Rises through `coil` from 0 to 1. The renderer draws the tell off this. */
  tell: number;
  /**
   * Seconds in flight. Present so a Bounder mid-hurl satisfies the ball solver's shape and can be
   * stepped by it directly -- the creature *is* a ball while it is in the air, and giving it its own
   * approximation of one would be two solvers to keep in agreement.
   */
  age: number;
  /** What it drops, decided from the ground it spawned in. */
  ores: ResourceId[];
  /**
   * Which way the rock is, from where it is standing.
   *
   * Its own private idea of down. Everything about the crawl is expressed relative to this rather
   * than to the world, which is what lets the same code walk a floor, a ceiling and the underside of
   * an overhang without any of them being special cases.
   */
  surfaceAngle: number;
  /** Which way round it walks. Never changes, so a crowd of them does not all orbit in step. */
  circulation: 1 | -1;
  /** Nothing to hold on to. It sits still rather than swimming through the air. */
  adrift: boolean;
}

export interface CreatureStep {
  /** It reached the drone somewhere that is not the paddle's face. The caller applies hull damage. */
  struck: boolean;
  /** A deflected hurl landed against rock. Worth a sound, a puff of grit, and one point of damage. */
  landed: boolean;
  /** It just committed to a hurl. Worth the tell's sound. */
  committed: boolean;
  /** It died this frame, and the caller should scatter its ore. */
  killed: boolean;
}

export function createBounder(
  x: number,
  y: number,
  facing = 0,
  ores: ResourceId[] = [],
  surfaceAngle = Math.PI / 2,
  circulation: 1 | -1 = 1,
): Creature {
  return {
    kind: "bounder",
    x,
    y,
    vx: 0,
    vy: 0,
    radius: BOUNDER.radius,
    hp: BOUNDER.hp,
    maxHp: BOUNDER.hp,
    state: "idle",
    timer: 0,
    facing,
    hitFlash: 0,
    tell: 0,
    age: 0,
    ores,
    surfaceAngle,
    circulation,
    adrift: false,
  };
}

const NOTHING: CreatureStep = { struck: false, landed: false, committed: false, killed: false };

/**
 * Send a Bounder back out.
 *
 * Called by whatever owns the paddle, because the paddle is the drone's and not the creature's.
 * `english` is where along the face it was met, from -1 at one end to 1 at the other, and the outgoing
 * heading is built from the face's own normal so a return off the edge bites and one off the middle
 * is forgiving -- the same curve the arena paddle uses, for the same reason.
 */
export function deflectCreature(
  creature: Creature,
  normalAngle: number,
  english: number,
  englishCurve: number,
  minOffNormal: number,
): void {
  if (creature.state !== "hurl") return;
  const bite = Math.sign(english) * Math.abs(english) ** englishCurve;
  // Clamped short of the face's own plane, or a return off the very end leaves along the paddle and
  // never reaches anything to land against.
  const swing = Math.max(-1, Math.min(1, bite)) * (Math.PI / 2 - minOffNormal);
  const heading = normalAngle + swing;
  const speed = Math.hypot(creature.vx, creature.vy) || BOUNDER.hurlSpeed;
  creature.vx = Math.cos(heading) * speed;
  creature.vy = Math.sin(heading) * speed;
  creature.facing = heading;
  // Lifted clear of the face so the next frame is not read as a second contact.
  creature.x += Math.cos(normalAngle) * 0.02;
  creature.y += Math.sin(normalAngle) * 0.02;
}

export function stepCreature(
  creature: Creature,
  world: SolidityOracle,
  target: { x: number; y: number } | null,
  dt: number,
): CreatureStep {
  if (creature.state === "dead") return NOTHING;
  const step: CreatureStep = { struck: false, landed: false, committed: false, killed: false };
  creature.hitFlash = Math.max(0, creature.hitFlash - dt);
  creature.timer -= dt;

  const distance = target ? Math.hypot(target.x - creature.x, target.y - creature.y) : Infinity;
  const aware = Boolean(
    target
    && distance <= BOUNDER.aggroRange
    && hasLineOfSight(world, creature.x, creature.y, target.x, target.y),
  );

  switch (creature.state) {
    case "idle": {
      if (aware && target) {
        creature.state = "coil";
        creature.timer = BOUNDER.coilSeconds;
        creature.tell = 0;
        creature.facing = Math.atan2(target.y - creature.y, target.x - creature.x);
        creature.vx = 0;
        creature.vy = 0;
        break;
      }
      crawl(creature, world, dt);
      return withContact(creature, target, step);
    }
    case "coil": {
      creature.vx = 0;
      creature.vy = 0;
      creature.tell = Math.min(1, 1 - Math.max(0, creature.timer) / BOUNDER.coilSeconds);
      // Tracks only until the lock, so the last fifth of a second is a lane the player can leave.
      if (target && aware && creature.timer > BOUNDER.lockSeconds) {
        creature.facing = Math.atan2(target.y - creature.y, target.x - creature.x);
      }
      if (creature.timer <= 0) {
        creature.state = "hurl";
        creature.timer = BOUNDER.hurlSeconds;
        creature.age = 0;
        creature.tell = 1;
        creature.vx = Math.cos(creature.facing) * BOUNDER.hurlSpeed;
        creature.vy = Math.sin(creature.facing) * BOUNDER.hurlSpeed;
        step.committed = true;
      }
      break;
    }
    case "hurl": {
      // Straight flight, and it ends at the first rock it touches. No rebound: a Bounder is not a
      // ball that happens to be alive, it is an animal that has thrown itself, and it lands where it
      // lands. Sticking rather than bouncing is also what makes the exchange legible -- a launch has
      // exactly one outcome, and the player can see which one it is going to be.
      const landing = flyUntilContact(creature, world, dt);
      if (landing) {
        creature.surfaceAngle = landing.surfaceAngle;
        creature.hp -= 1;
        creature.hitFlash = 0.26;
        creature.vx = 0;
        creature.vy = 0;
        step.landed = true;
        if (creature.hp <= 0) {
          creature.state = "dead";
          step.killed = true;
          return step;
        }
        // On the ground the instant it arrives, unfolded and stuck to whatever it hit. The beat that
        // follows is the player's, not the creature's: it has to be back on a surface before it can
        // wind up again.
        creature.state = "spent";
        creature.timer = BOUNDER.spentSeconds;
        creature.tell = 0;
        settle(creature, world, landing.surfaceAngle);
        return withContact(creature, target, step);
      }
      if (creature.timer <= 0) {
        // Ran out of flight without touching anything -- only possible out over a void. Drop it back
        // to looking for a surface rather than leaving it curled in mid-air.
        creature.state = "spent";
        creature.timer = BOUNDER.spentSeconds;
        creature.tell = 0;
        creature.vx = 0;
        creature.vy = 0;
      }
      // Already moved by the flight, so the shared mover below must not move it again.
      return withContact(creature, target, step);
    }
    case "spent": {
      creature.vx *= 0.84;
      creature.vy *= 0.84;
      creature.tell = 0;
      if (creature.timer <= 0) {
        creature.state = "idle";
        // Faces the drone again if it is still worth facing, so it does not wander off mid-fight.
        if (target && distance < BOUNDER.forgetRange) {
          creature.facing = Math.atan2(target.y - creature.y, target.x - creature.x);
        }
      }
      break;
    }
  }

  const resolved = resolveCircle(world, creature.x + creature.vx * dt, creature.y + creature.vy * dt, creature.radius);
  creature.x = resolved.x;
  creature.y = resolved.y;
  return withContact(creature, target, step);
}

/**
 * Advance a launched Bounder until it touches rock.
 *
 * Substepped below its own radius so it cannot pass through a wall between frames, and reported as
 * the direction the rock lies in so the creature can stick to the face it actually met. Returns null
 * while it is still in the air.
 */
function flyUntilContact(
  creature: Creature,
  world: SolidityOracle,
  dt: number,
): { surfaceAngle: number } | null {
  const speed = Math.hypot(creature.vx, creature.vy);
  if (speed < 1e-6) return null;
  let remaining = dt;
  let guard = 0;
  while (remaining > 1e-6 && guard++ < 64) {
    const slice = Math.min(remaining, (creature.radius * 0.5) / speed);
    remaining -= slice;
    const nextX = creature.x + creature.vx * slice;
    const nextY = creature.y + creature.vy * slice;
    const resolved = resolveCircle(world, nextX, nextY, creature.radius);
    if (resolved.hit) {
      creature.x = resolved.x;
      creature.y = resolved.y;
      // The resolver's normal points out of the rock, so the rock is the other way.
      return { surfaceAngle: Math.atan2(-resolved.ny, -resolved.nx) };
    }
    creature.x = nextX;
    creature.y = nextY;
  }
  return null;
}

/**
 * Walk along whatever it is stuck to.
 *
 * Two steps, and no notion of gravity or of up. It slides along the surface it is currently holding,
 * then looks for that surface again from where it arrived. The look sweeps outward from the direction
 * rock was last found, taking the first hit, so the smallest turn that keeps contact is always the one
 * chosen -- which is what makes it hug a convex corner instead of walking off it, and round a concave
 * one instead of burrowing into it. On a free-standing island of rock the same two steps circle it
 * forever, because there is nowhere else for the search to go.
 */
function crawl(creature: Creature, world: SolidityOracle, dt: number): void {
  const attached = reattach(creature, world, creature.surfaceAngle, BOUNDER.reattachSweep);
  if (!attached) {
    // Nothing within reach. Look all the way round once -- it has probably just landed from a hurl --
    // and if there is genuinely nothing, sit still rather than swim.
    if (!reattach(creature, world, creature.surfaceAngle, Math.PI)) {
      creature.adrift = true;
      creature.vx = 0;
      creature.vy = 0;
      return;
    }
  }
  creature.adrift = false;

  // Along the surface, which is its own down turned a quarter turn the way it happens to walk.
  const tangent = creature.surfaceAngle + creature.circulation * Math.PI / 2;
  creature.facing = tangent;
  creature.vx = Math.cos(tangent) * BOUNDER.crawlSpeed;
  creature.vy = Math.sin(tangent) * BOUNDER.crawlSpeed;
  const nextX = creature.x + creature.vx * dt;
  const nextY = creature.y + creature.vy * dt;
  const resolved = resolveCircle(world, nextX, nextY, creature.radius);
  creature.x = resolved.x;
  creature.y = resolved.y;
  if (!resolved.hit) return;
  // Walked into something. That is a concave corner -- the floor at the foot of a wall, most often --
  // and the face it just met is the one to carry on along. Re-attaching to it here is what turns the
  // corner; without it a Bounder that landed on a wall above a floor jammed in the join and stayed
  // there, which looked exactly like the crawl being broken.
  reattach(creature, world, Math.atan2(-resolved.ny, -resolved.nx), BOUNDER.reattachSweep);
}

/**
 * Find the rock again, and sit on it.
 *
 * Sweeps candidate down-directions outward from `from` in both senses at once, alternating, so the
 * smallest turn wins whichever way the surface went. Having found one, it holds the creature a fixed
 * ride height off the face rather than resolving out of an overlap: sitting on the surface with a gap
 * is what a walking animal looks like, and being pushed out of the surface is what a ball looks like.
 */
function reattach(creature: Creature, world: SolidityOracle, from: number, sweep: number): boolean {
  const reach = creature.radius + BOUNDER.probeDepth;
  for (let step = 0; step <= BOUNDER.reattachSteps; step++) {
    const delta = (step / BOUNDER.reattachSteps) * sweep;
    // Both senses of the turn, nearest first. The one that follows the walk is tried first so a tie
    // at a sharp corner resolves in the direction it is already travelling.
    for (const sense of step === 0 ? [0] : [creature.circulation, -creature.circulation]) {
      const angle = from + delta * sense;
      const probeX = creature.x + Math.cos(angle) * reach;
      const probeY = creature.y + Math.sin(angle) * reach;
      if (!world.solidAt(probeX, probeY)) continue;
      creature.surfaceAngle = angle;
      // Walk in along the found direction until it is exactly riding the face, so it neither floats
      // off after a convex corner nor sinks in after a concave one.
      settle(creature, world, angle);
      return true;
    }
  }
  return false;
}

/** Hold the creature at its ride height along `angle`, by bisection on the surface it just found. */
function settle(creature: Creature, world: SolidityOracle, angle: number): void {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  // The face is somewhere between "here" and "a radius and a ride further on", because the probe that
  // got us here found rock at the far end and the creature is standing in air at the near end.
  let near = 0;
  let far = creature.radius + BOUNDER.probeDepth;
  for (let pass = 0; pass < 8; pass++) {
    const middle = (near + far) / 2;
    if (world.solidAt(creature.x + dirX * middle, creature.y + dirY * middle)) far = middle;
    else near = middle;
  }
  const correction = far - (creature.radius + BOUNDER.ride);
  creature.x += dirX * correction;
  creature.y += dirY * correction;
}

/**
 * Did it reach the drone?
 *
 * Only reported, never resolved. Whether a contact was the paddle's face is a question about the
 * paddle, which belongs to the drone, so the caller decides and either deflects or takes the hit.
 * An uncurled Bounder is harmless: walking into one is not the threat, being hit by one is.
 */
function withContact(creature: Creature, target: { x: number; y: number } | null, step: CreatureStep): CreatureStep {
  if (!target || creature.state !== "hurl") return step;
  step.struck = true;
  return step;
}

/**
 * Bounce a Bounder off the machine anywhere that is not the paddle's face.
 *
 * Marked for environment damage exactly as a proper return is. Hitting the back of the paddle is a
 * mistake that costs the hull, not a mistake that wastes the exchange: the creature still goes into
 * the rock and the rock still hurts it. What the player lost was the free version of the same trade.
 *
 * A clean miss is the only outcome that leaves it unharmed, which is why the rock alone never damages
 * anything -- otherwise a Bounder would kill itself in the first corridor it crossed.
 */
export function bounceCreature(creature: Creature, nx: number, ny: number): void {
  if (creature.state !== "hurl") return;
  const length = Math.hypot(nx, ny) || 1;
  const ux = nx / length;
  const uy = ny / length;
  const dot = creature.vx * ux + creature.vy * uy;
  // Only reflect if it is travelling into the surface; a glancing contact on the way out would
  // otherwise be turned back around into the machine.
  if (dot < 0) {
    creature.vx -= 2 * dot * ux;
    creature.vy -= 2 * dot * uy;
  }
  creature.facing = Math.atan2(creature.vy, creature.vx);
  creature.x += ux * 0.02;
  creature.y += uy * 0.02;
}
