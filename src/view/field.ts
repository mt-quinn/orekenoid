// Placeholder artwork for cavern combat.
//
// Deliberately plain. Step 2 of the combat build is a go/no-go on whether aiming a bouncing ball
// at something that charges you is fun, and that question is answered by shapes and timings, not
// by finish. What is *not* placeholder is the tell: the Grinder's wind-up glow is the whole read,
// so it is drawn properly here even though the body is two polygons.

import { Container, Graphics } from "pixi.js";
import { CELL, PALETTE } from "../config";
import { FIELD } from "../combat/ballField";
import { DOUSER, GRINDER, SPITTER, type Creature, type CreatureKind } from "../combat/creatures";

/** The ball, out in the world. Same size as the arena's, because it is the same ball. */
export function createFieldBallDisplay(): Container {
  const container = new Container();
  const radius = FIELD.radius * CELL;
  const glow = new Graphics().circle(0, 0, radius * 2.6).fill({ color: PALETTE.rail, alpha: 0.14 });
  const body = new Graphics().circle(0, 0, radius).fill(PALETTE.rail);
  container.addChild(glow, body);
  return container;
}

/** The line the ball has swept this frame, so a fast ball reads as a streak and not a strobe. */
export function createFieldTrail(): Graphics {
  return new Graphics();
}

export interface CreatureDisplay {
  container: Container;
  body: Graphics;
  tell: Graphics;
}

/** A Spitter's glob, in flight. Its own light source, per the one rule the dark cannot break. */
export function createGlobDisplay(): Container {
  const container = new Container();
  const radius = SPITTER.projectileRadius * CELL;
  container.addChild(
    new Graphics().circle(0, 0, radius * 2.2).fill({ color: PALETTE.spore, alpha: 0.18 }),
    new Graphics().circle(0, 0, radius).fill(PALETTE.spore),
  );
  return container;
}

/**
 * Silhouettes.
 *
 * The one thing the player must be able to do in a black room lit by a passing ball is name what
 * they just saw in that one frame. So the three read as three shapes at a glance and never as
 * three tints of the same shape: the Grinder is a wedge with a point, the Spitter is a squat
 * hunched sac, the Douser is a ragged star with nothing solid about it.
 */
export function createCreatureDisplay(kind: CreatureKind): CreatureDisplay {
  if (kind === "spitter") return createSpitterDisplay();
  if (kind === "douser") return createDouserDisplay();
  return createGrinderDisplay();
}

function createSpitterDisplay(): CreatureDisplay {
  const container = new Container();
  const radius = SPITTER.radius * CELL;
  const tell = new Graphics();
  const body = new Graphics();
  // Squat and hunched, widest at the back, with a short blunt spout rather than a point: it throws
  // rather than rams, and the silhouette should say so before the first glob does.
  body
    .ellipse(-radius * 0.15, 0, radius * 0.85, radius * 0.7)
    .fill(0x40453a)
    .stroke({ width: 2, color: PALETTE.machine, alpha: 0.8 })
    .rect(radius * 0.5, -radius * 0.22, radius * 0.4, radius * 0.44)
    .fill(0x2f3329);
  container.addChild(tell, body);
  return { container, body, tell };
}

function createDouserDisplay(): CreatureDisplay {
  const container = new Container();
  const radius = DOUSER.radius * CELL;
  const tell = new Graphics();
  const body = new Graphics();
  // No flat faces and no point. A ragged star, so it never reads as something that can be blocked
  // or steered -- it is going to arrive, and the question is only what you do once it has.
  const points = 7;
  body.moveTo(radius, 0);
  for (let index = 1; index <= points * 2; index++) {
    const angle = (index / (points * 2)) * Math.PI * 2;
    const reach = index % 2 === 0 ? radius : radius * 0.42;
    body.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
  }
  body.closePath().fill(0x1f2a33).stroke({ width: 1.5, color: 0x6f97b8, alpha: 0.9 });
  container.addChild(tell, body);
  return { container, body, tell };
}

/**
 * A Grinder.
 *
 * Wedge-shaped and pointed the way it is facing, because the one thing the player has to read off
 * it at a glance is which way the charge is going to go.
 */
function createGrinderDisplay(): CreatureDisplay {
  const container = new Container();
  const radius = GRINDER.radius * CELL;
  const tell = new Graphics();
  const body = new Graphics();
  // Armoured wedge: broad at the back, driven to a point at the front.
  body
    .moveTo(radius, 0)
    .lineTo(-radius * 0.55, radius * 0.85)
    .lineTo(-radius * 0.85, 0)
    .lineTo(-radius * 0.55, -radius * 0.85)
    .closePath()
    .fill(0x4a3f38)
    .stroke({ width: 2, color: PALETTE.machine, alpha: 0.85 });
  container.addChild(tell, body);
  return { container, body, tell };
}

/**
 * Redraw the tell.
 *
 * The rule for combat in the dark: every attack is its own light source. The wind-up therefore
 * brightens from nothing to a hard eye and throws a lane down the heading it has locked, so the
 * player is being shown the ground to leave rather than being asked to guess it.
 */
export function drawCreatureTell(display: CreatureDisplay, creature: Creature): void {
  if (creature.kind === "spitter") return drawSpitterTell(display, creature);
  if (creature.kind === "douser") return drawDouserTell(display, creature);
  drawGrinderTell(display, creature);
}

function drawGrinderTell(display: CreatureDisplay, creature: Creature): void {
  const radius = GRINDER.radius * CELL;
  display.tell.clear();
  if (creature.state === "wind") {
    const heat = creature.tell;
    // The lane it has committed to. Only drawn once the aim is locked, so it never points somewhere
    // the charge is not going to go.
    if (creature.timer <= GRINDER.lockSeconds) {
      display.tell
        .moveTo(radius * 0.6, -radius * 0.5 * heat)
        .lineTo(GRINDER.chargeSpeed * GRINDER.chargeSeconds * CELL * 0.42, -radius * 0.16 * heat)
        .lineTo(GRINDER.chargeSpeed * GRINDER.chargeSeconds * CELL * 0.42, radius * 0.16 * heat)
        .lineTo(radius * 0.6, radius * 0.5 * heat)
        .closePath()
        .fill({ color: PALETTE.danger, alpha: 0.1 + heat * 0.16 });
    }
    display.tell.circle(radius * 0.25, 0, radius * (0.2 + heat * 0.3))
      .fill({ color: PALETTE.danger, alpha: 0.35 + heat * 0.6 });
  } else if (creature.state === "charge") {
    display.tell.circle(radius * 0.25, 0, radius * 0.5).fill({ color: PALETTE.danger, alpha: 0.9 });
  } else if (creature.state === "recover") {
    // Visibly open. The recovery is the reward for dodging, so it has to look like one.
    display.tell.circle(radius * 0.25, 0, radius * 0.22).fill({ color: PALETTE.danger, alpha: 0.22 });
  }
  const damage = 1 - creature.hp / creature.maxHp;
  display.body.alpha = 1;
  display.body.tint = creature.hitFlash > 0
    ? 0xffffff
    : damage > 0.6 ? 0xd08a72 : damage > 0.3 ? 0xb59a86 : 0xffffff;
}

/**
 * The Spitter's telegraph.
 *
 * A charging mouth rather than a lane, because the shot is slow: the player is being told a glob
 * is coming and roughly from where, not handed a line to sidestep. The lane belongs to the Grinder,
 * whose attack is instantaneous once it commits.
 */
function drawSpitterTell(display: CreatureDisplay, creature: Creature): void {
  const radius = SPITTER.radius * CELL;
  display.tell.clear();
  if (creature.state === "wind") {
    const heat = creature.tell;
    display.tell
      .circle(radius * 0.75, 0, radius * (0.18 + heat * 0.45))
      .fill({ color: PALETTE.spore, alpha: 0.4 + heat * 0.55 });
  }
  display.body.tint = creature.hitFlash > 0 ? 0xffffff : creature.hp < creature.maxHp ? 0xc79f86 : 0xffffff;
}

/**
 * The Douser's glow.
 *
 * On the whole time it is hunting, and brightest when it is closest. It is the only creature that
 * announces itself continuously rather than per attack -- which is the trade for what it takes: it
 * can never ambush you, and it will reach you anyway.
 */
function drawDouserTell(display: CreatureDisplay, creature: Creature): void {
  const radius = DOUSER.radius * CELL;
  display.tell.clear();
  const heat = creature.state === "latched" ? 1 : creature.tell;
  if (heat > 0.02) {
    display.tell.circle(0, 0, radius * (1.1 + heat * 1.5)).fill({ color: 0x7fb2e8, alpha: 0.1 + heat * 0.3 });
    display.tell.circle(0, 0, radius * 0.4).fill({ color: 0xdcefff, alpha: 0.4 + heat * 0.5 });
  }
  display.body.tint = creature.hitFlash > 0 ? 0xffffff : creature.hp < creature.maxHp ? 0x9fc0d4 : 0xffffff;
}
