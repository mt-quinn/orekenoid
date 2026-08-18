// What lives in the caverns.
//
// The design rule, taken from Doom 2016's roster: creatures are not differentiated by how you kill
// them -- every one of them dies to the ball, hit enough times -- they are differentiated by what
// they take away from you while you line the shot up. The Grinder takes away standing still.
//
// Everything in this file is a pure state machine over a solidity oracle. No Pixi, no world model,
// no globals, so a fight can be simulated headlessly in a test and the answers are the same ones
// the renderer will draw.

import { resolveCircle, type SolidityOracle } from "./ballField";
import { hasLineOfSight } from "./sight";

export type CreatureKind = "grinder" | "spitter" | "douser";

/**
 * A Grinder's whole life.
 *
 * `prowl` wanders, `wind` is the tell, `charge` is the commitment, `recover` is the window the
 * player is being handed in exchange for having dodged. The last of those is the important one:
 * a creature that is always dangerous cannot be attacked, and a creature that is never dangerous
 * is scenery. The charge is what makes standing still fatal; the recovery is what makes dodging
 * pay.
 */
export type CreatureState = "prowl" | "wind" | "charge" | "recover" | "latched" | "dead";

export const GRINDER = {
  radius: 0.6,
  hp: 3,
  /** How far it can notice the drone, given clear line of sight. */
  senseRange: 11,
  /** Loses interest past this, so a fight can be left rather than only won. */
  forgetRange: 19,
  prowlSpeed: 1.7,
  chargeSpeed: 15.5,
  /** The tell. Long enough to read and act on, short enough to be a threat. */
  windUp: 0.42,
  /**
   * Last stretch of the tell, during which it stops tracking and the shot is locked.
   *
   * Without this the creature re-aims on the very frame it commits, which sounds like a smarter
   * enemy and is really a strictly worse one: the tell stops carrying any information, since
   * wherever you go the charge follows, and there is no dodge to learn. Locking early enough to
   * see turns the glow into a lane the player can step out of.
   */
  lockSeconds: 0.18,
  /** Longest a single charge runs before it burns out on its own. */
  chargeSeconds: 1.05,
  /** The window the player earned by dodging. */
  recoverSeconds: 0.85,
  /** Hull damage per ram, before armour. */
  ramDamage: 8,
  /** How hard a ball hit shoves it, in cells per second. */
  ballKnockback: 4.4,
  /** Turned this fast while prowling, so it noses along walls rather than juddering. */
  turnRate: 2.4,
} as const;

/**
 * The Spitter: it takes away free positioning.
 *
 * It will not close and it will not chase. It stands off at its own range and fills the room with
 * slow, blockable globs, so the ground between you and it stops being ground you can simply stand
 * on. Where a Grinder punishes standing still, a Spitter punishes standing *anywhere* for long.
 */
export const SPITTER = {
  radius: 0.55,
  hp: 2,
  senseRange: 14,
  forgetRange: 21,
  /** The range it wants. Closer and it backs off; further and it steps in. */
  holdRange: 8,
  /** Dead band around `holdRange`, so it settles instead of jittering across the threshold. */
  holdSlack: 1.6,
  moveSpeed: 3.4,
  /** The telegraph before a glob leaves. Longer than a Grinder's: the shot itself is slow too. */
  windUp: 0.5,
  /** Quiet between shots. This is the window to close the distance or break line of sight. */
  cooldownSeconds: 1.7,
  projectileSpeed: 7.4,
  projectileRadius: 0.3,
  projectileDamage: 5,
  /** A glob dies on its own after this long, so nothing is left drifting in an empty room. */
  projectileLife: 4,
  ballKnockback: 3.4,
  turnRate: 2.4,
} as const;

/**
 * The Douser: it takes away your light.
 *
 * It barely damages the hull. It closes, latches on, and smothers the lamp, and then the fight is
 * being had by the light of your own ball -- which is out in the room, not with you. It is the one
 * creature whose threat is entirely informational, and it only exists because the lighting engine
 * does.
 */
export const DOUSER = {
  radius: 0.5,
  hp: 2,
  /** Longer than the others: it hunts the lamp, and the lamp is the loudest thing in the mine. */
  senseRange: 17,
  forgetRange: 26,
  closeSpeed: 4.8,
  /** How long it clings before it lets go on its own. */
  latchSeconds: 5,
  /** Hull damage per latch. Token: the point is the dark, not the damage. */
  latchDamage: 2,
  /** How far the lamp falls while it is on, as a fraction of full reach. */
  smotherTo: 0.22,
  /** Fraction of the smother recovered or lost per second. */
  smotherRate: 0.85,
  recoverRate: 0.55,
  /**
   * How long after coming off it cannot latch again.
   *
   * Without this the release is not a release. It lets go while sitting exactly on the hull, is
   * therefore already inside contact range, and latches again on the next frame -- so the lamp
   * never comes back and the ball shot that shook it off bought the player nothing. The cooldown
   * *is* the reward for making that shot.
   */
  relatchCooldown: 2.6,
  /** How hard it shoves off when it lets go, so coming off is visible rather than merely logged. */
  releaseSpeed: 5.5,
  ballKnockback: 5.2,
  turnRate: 2.4,
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
  /** Where it is pointing. During `wind` this is the shot it has committed to. */
  facing: number;
  /** Counts down after a ball hit, purely for the renderer. */
  hitFlash: number;
  /** Rises through `wind` from 0 to 1. The renderer draws the tell off this. */
  tell: number;
  /** Seconds until this creature may attack again. Spitters only. */
  cooldown: number;
}

export interface CreatureStep {
  /** It reached the drone this frame. The caller applies hull damage. */
  rammed: boolean;
  /** It ended a charge against rock. Worth a sound and a puff of grit. */
  slammed: boolean;
  /** It just committed to a charge. Worth the tell's sound. */
  committed: boolean;
  /** A Spitter let a glob go this frame. The caller spawns it. */
  fired: { x: number; y: number; dirX: number; dirY: number } | null;
  /** A Douser is on the hull right now, smothering the lamp. */
  smothering: boolean;
}

export function createCreature(kind: CreatureKind, x: number, y: number, facing = 0): Creature {
  const species = SPECIES[kind];
  return {
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: species.radius,
    hp: species.hp,
    maxHp: species.hp,
    state: "prowl",
    timer: 0,
    facing,
    hitFlash: 0,
    tell: 0,
    cooldown: 0,
  };
}

export function createGrinder(x: number, y: number, facing = 0): Creature {
  return {
    kind: "grinder",
    x,
    y,
    vx: 0,
    vy: 0,
    radius: GRINDER.radius,
    hp: GRINDER.hp,
    maxHp: GRINDER.hp,
    state: "prowl",
    timer: 0,
    facing,
    hitFlash: 0,
    tell: 0,
    cooldown: 0,
  };
}

const NOTHING: CreatureStep = {
  rammed: false, slammed: false, committed: false, fired: null, smothering: false,
};

/** Shared numbers, so the dispatcher can ask any creature how big it is and how hard it is to kill. */
const SPECIES = { grinder: GRINDER, spitter: SPITTER, douser: DOUSER } as const;

/**
 * Take a hit from the ball.
 *
 * Knockback is applied by the caller's impact direction rather than computed here, because the ball
 * is the thing that knows which way it was going.
 */
export function damageCreature(creature: Creature, amount: number, pushX: number, pushY: number): boolean {
  if (creature.state === "dead") return false;
  creature.hp -= amount;
  creature.hitFlash = 0.24;
  const push = Math.hypot(pushX, pushY) || 1;
  const knockback = SPECIES[creature.kind].ballKnockback;
  creature.vx += pushX / push * knockback;
  creature.vy += pushY / push * knockback;
  if (creature.hp <= 0) {
    creature.state = "dead";
    return true;
  }
  // A latched Douser comes off. This is the whole shot the player is being asked to make: the thing
  // on your own hull, hit by your own ball, which means banking it back into yourself -- so it pays
  // the full relatch cooldown, and the player gets their light back for it.
  if (creature.state === "latched") {
    releaseDouser(creature, null);
    return false;
  }
  // A hit mid-charge does not stop the charge. Interrupting it would make the ball a stun button
  // and delete the dodge, which is the only thing the fight is actually about.
  if (creature.state === "prowl" || creature.state === "wind") {
    creature.state = "recover";
    creature.timer = 0.28;
    creature.tell = 0;
  }
  return false;
}

export function stepCreature(
  creature: Creature,
  world: SolidityOracle,
  target: { x: number; y: number; radius: number } | null,
  dt: number,
): CreatureStep {
  if (creature.state === "dead") return NOTHING;
  if (creature.kind === "spitter") return stepSpitter(creature, world, target, dt);
  if (creature.kind === "douser") return stepDouser(creature, world, target, dt);
  return stepGrinder(creature, world, target, dt);
}

/** Shared preamble: tick the clocks and work out whether the drone can be seen from here. */
function survey(
  creature: Creature,
  world: SolidityOracle,
  target: { x: number; y: number; radius: number } | null,
  dt: number,
  senseRange: number,
) {
  creature.hitFlash = Math.max(0, creature.hitFlash - dt);
  creature.cooldown = Math.max(0, creature.cooldown - dt);
  creature.timer -= dt;
  const toTarget = target
    ? {
      dx: target.x - creature.x,
      dy: target.y - creature.y,
      distance: Math.hypot(target.x - creature.x, target.y - creature.y),
    }
    : null;
  const aware = Boolean(
    toTarget
    && toTarget.distance <= senseRange
    && hasLineOfSight(world, creature.x, creature.y, target!.x, target!.y),
  );
  return { toTarget, aware };
}

/** Walk, and turn rather than grind when the rock says no. */
function advance(creature: Creature, world: SolidityOracle, dt: number, turnRate: number): boolean {
  const resolved = resolveCircle(world, creature.x + creature.vx * dt, creature.y + creature.vy * dt, creature.radius);
  creature.x = resolved.x;
  creature.y = resolved.y;
  if (resolved.hit && creature.state === "prowl") {
    creature.facing += turnRate * dt + Math.PI / 2;
    creature.vx = 0;
    creature.vy = 0;
  }
  return resolved.hit;
}

function stepGrinder(
  creature: Creature,
  world: SolidityOracle,
  target: { x: number; y: number; radius: number } | null,
  dt: number,
): CreatureStep {
  const step: CreatureStep = {
    rammed: false, slammed: false, committed: false, fired: null, smothering: false,
  };
  const { toTarget, aware } = survey(creature, world, target, dt, GRINDER.senseRange);

  switch (creature.state) {
    case "prowl": {
      if (aware && toTarget) {
        creature.state = "wind";
        creature.timer = GRINDER.windUp;
        creature.tell = 0;
        creature.facing = Math.atan2(toTarget.dy, toTarget.dx);
        break;
      }
      // Noses forward along its facing. Blocked, it turns rather than stopping, so a prowling
      // Grinder patrols a chamber instead of grinding into the wall it first met.
      creature.vx = Math.cos(creature.facing) * GRINDER.prowlSpeed;
      creature.vy = Math.sin(creature.facing) * GRINDER.prowlSpeed;
      break;
    }
    case "wind": {
      creature.vx = 0;
      creature.vy = 0;
      creature.tell = Math.min(1, 1 - Math.max(0, creature.timer) / GRINDER.windUp);
      // Tracks only until the lock. After that the shot is fixed and the lane is what the player
      // steps out of -- see `lockSeconds`.
      if (toTarget && aware && creature.timer > GRINDER.lockSeconds) {
        creature.facing = Math.atan2(toTarget.dy, toTarget.dx);
      }
      if (creature.timer <= 0) {
        creature.state = "charge";
        creature.timer = GRINDER.chargeSeconds;
        creature.tell = 1;
        creature.vx = Math.cos(creature.facing) * GRINDER.chargeSpeed;
        creature.vy = Math.sin(creature.facing) * GRINDER.chargeSpeed;
        step.committed = true;
      }
      break;
    }
    case "charge": {
      creature.vx = Math.cos(creature.facing) * GRINDER.chargeSpeed;
      creature.vy = Math.sin(creature.facing) * GRINDER.chargeSpeed;
      if (creature.timer <= 0) {
        creature.state = "recover";
        creature.timer = GRINDER.recoverSeconds;
        creature.tell = 0;
      }
      break;
    }
    case "recover": {
      // Bleeds off knockback rather than snapping still, so a hit visibly shoves it.
      creature.vx *= 0.86;
      creature.vy *= 0.86;
      creature.tell = 0;
      if (creature.timer <= 0) {
        creature.state = "prowl";
        // Turns to face the drone again if it is still around, so it does not wander off mid-fight.
        if (toTarget && toTarget.distance < GRINDER.forgetRange) {
          creature.facing = Math.atan2(toTarget.dy, toTarget.dx);
        }
      }
      break;
    }
  }

  const wasCharging = creature.state === "charge";
  const nextX = creature.x + creature.vx * dt;
  const nextY = creature.y + creature.vy * dt;
  const resolved = resolveCircle(world, nextX, nextY, creature.radius);
  creature.x = resolved.x;
  creature.y = resolved.y;
  if (resolved.hit) {
    if (wasCharging) {
      // Ran into the wall. That is the player's best outcome and it should look like the creature's
      // worst, so it costs the full recovery rather than a glancing stumble.
      creature.state = "recover";
      creature.timer = GRINDER.recoverSeconds;
      creature.vx = 0;
      creature.vy = 0;
      creature.tell = 0;
      step.slammed = true;
    } else if (creature.state === "prowl") {
      creature.facing += GRINDER.turnRate * dt + Math.PI / 2;
      creature.vx = 0;
      creature.vy = 0;
    }
  }

  if (target) {
    const distance = Math.hypot(target.x - creature.x, target.y - creature.y);
    if (distance <= creature.radius + target.radius) {
      step.rammed = true;
      if (creature.state === "charge") {
        creature.state = "recover";
        creature.timer = GRINDER.recoverSeconds;
        creature.tell = 0;
      }
    }
  }
  return step;
}

/**
 * The Spitter.
 *
 * Everything about it is range discipline: it walks to the distance it likes, waits out its
 * cooldown, telegraphs, and lets a slow glob go. It never chases. That is what makes it a
 * different problem from a Grinder rather than a Grinder with a gun -- you cannot dodge it by
 * moving out of one lane, because it will simply put the next one wherever you went.
 */
function stepSpitter(
  creature: Creature,
  world: SolidityOracle,
  target: { x: number; y: number; radius: number } | null,
  dt: number,
): CreatureStep {
  const step: CreatureStep = {
    rammed: false, slammed: false, committed: false, fired: null, smothering: false,
  };
  const { toTarget, aware } = survey(creature, world, target, dt, SPITTER.senseRange);

  if (creature.state === "wind") {
    creature.vx = 0;
    creature.vy = 0;
    creature.tell = Math.min(1, 1 - Math.max(0, creature.timer) / SPITTER.windUp);
    // Tracks through the whole telegraph and fires where it is pointing. The glob is slow enough
    // that leading it is the player's job, not the creature's -- so the dodge is the flight time,
    // not the wind-up.
    if (toTarget && aware) creature.facing = Math.atan2(toTarget.dy, toTarget.dx);
    if (creature.timer <= 0) {
      step.fired = {
        x: creature.x + Math.cos(creature.facing) * (creature.radius + SPITTER.projectileRadius + 0.05),
        y: creature.y + Math.sin(creature.facing) * (creature.radius + SPITTER.projectileRadius + 0.05),
        dirX: Math.cos(creature.facing),
        dirY: Math.sin(creature.facing),
      };
      step.committed = true;
      creature.state = "recover";
      creature.timer = SPITTER.cooldownSeconds;
      creature.cooldown = SPITTER.cooldownSeconds;
      creature.tell = 0;
    }
  } else if (aware && toTarget) {
    creature.facing = Math.atan2(toTarget.dy, toTarget.dx);
    // Hold the range. Inside the band it stands still, which is what lets the player read the
    // distance it wants and decide whether to close it or leave.
    const error = toTarget.distance - SPITTER.holdRange;
    const drive = Math.abs(error) > SPITTER.holdSlack ? Math.sign(error) : 0;
    creature.vx = Math.cos(creature.facing) * SPITTER.moveSpeed * drive;
    creature.vy = Math.sin(creature.facing) * SPITTER.moveSpeed * drive;
    if (creature.state !== "recover" && creature.cooldown <= 0) {
      creature.state = "wind";
      creature.timer = SPITTER.windUp;
      creature.tell = 0;
    } else if (creature.state === "recover" && creature.timer <= 0) {
      creature.state = "prowl";
    }
  } else {
    if (creature.state === "recover" && creature.timer <= 0) creature.state = "prowl";
    if (creature.state === "prowl") {
      creature.vx = Math.cos(creature.facing) * SPITTER.moveSpeed * 0.4;
      creature.vy = Math.sin(creature.facing) * SPITTER.moveSpeed * 0.4;
    } else {
      creature.vx = 0;
      creature.vy = 0;
    }
  }

  advance(creature, world, dt, SPITTER.turnRate);
  return step;
}

/**
 * Come off the hull.
 *
 * Shoved clear along its own facing and barred from latching again for a beat, so the light
 * genuinely comes back rather than flickering for one frame.
 */
function releaseDouser(creature: Creature, target: { x: number; y: number } | null): void {
  creature.state = "recover";
  creature.timer = 1.4;
  creature.tell = 0;
  creature.cooldown = DOUSER.relatchCooldown;
  const away = target
    ? Math.atan2(creature.y - target.y, creature.x - target.x)
    : creature.facing + Math.PI;
  const heading = Number.isFinite(away) && (creature.x !== target?.x || creature.y !== target?.y)
    ? away
    : creature.facing + Math.PI;
  creature.vx = Math.cos(heading) * DOUSER.releaseSpeed;
  creature.vy = Math.sin(heading) * DOUSER.releaseSpeed;
}

/**
 * The Douser.
 *
 * It does not fight the hull, it fights the lamp. It closes on the light, latches on, and holds
 * until it is shaken off, and while it is on the drone the player's world is whatever their ball
 * happens to be flying past. It glows the whole time it is closing, which is deliberate: this is
 * the creature that takes your light, so it had better be the one thing you can always see coming.
 */
function stepDouser(
  creature: Creature,
  world: SolidityOracle,
  target: { x: number; y: number; radius: number } | null,
  dt: number,
): CreatureStep {
  const step: CreatureStep = {
    rammed: false, slammed: false, committed: false, fired: null, smothering: false,
  };
  const { toTarget, aware } = survey(creature, world, target, dt, DOUSER.senseRange);

  if (creature.state === "latched") {
    step.smothering = true;
    creature.tell = 1;
    if (target) {
      // Rides the hull rather than merely touching it, so running does not scrape it off -- only
      // the ball does.
      creature.x = target.x;
      creature.y = target.y;
      creature.vx = 0;
      creature.vy = 0;
    }
    if (creature.timer <= 0 || !target) {
      releaseDouser(creature, target);
    }
    return step;
  }

  if (creature.state === "recover") {
    creature.vx *= 0.9;
    creature.vy *= 0.9;
    creature.tell = 0;
    if (creature.timer <= 0) creature.state = "prowl";
  } else if (aware && toTarget) {
    creature.state = "charge";
    creature.facing = Math.atan2(toTarget.dy, toTarget.dx);
    creature.vx = Math.cos(creature.facing) * DOUSER.closeSpeed;
    creature.vy = Math.sin(creature.facing) * DOUSER.closeSpeed;
    // Brightens as it closes, so distance is readable off the glow alone in a black room.
    creature.tell = Math.max(0, Math.min(1, 1 - toTarget.distance / DOUSER.senseRange));
  } else {
    if (creature.state === "charge") creature.state = "prowl";
    creature.tell = 0;
    creature.vx = Math.cos(creature.facing) * DOUSER.closeSpeed * 0.32;
    creature.vy = Math.sin(creature.facing) * DOUSER.closeSpeed * 0.32;
  }

  advance(creature, world, dt, DOUSER.turnRate);

  if (target && creature.state === "charge" && creature.cooldown <= 0) {
    const distance = Math.hypot(target.x - creature.x, target.y - creature.y);
    if (distance <= creature.radius + target.radius) {
      creature.state = "latched";
      creature.timer = DOUSER.latchSeconds;
      step.rammed = true;
      step.smothering = true;
    }
  }
  return step;
}
