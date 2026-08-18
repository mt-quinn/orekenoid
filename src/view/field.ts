// Placeholder artwork for cavern combat.
//
// Deliberately plain, with one exception. The Bounder has to read as two different things at a glance
// -- a segmented animal walking on a wall, and a ball in the air -- because the player's decision
// depends entirely on which of the two it currently is. So the curl is drawn properly even though the
// body is a handful of arcs, and the tell is drawn properly because the rule the dark cannot break is
// that every attack is its own light source.

import { Container, Graphics } from "pixi.js";
import { CELL, PALETTE } from "../config";
import { BOUNDER, type Creature } from "../combat/creatures";

export interface BounderDisplay {
  container: Container;
  /** Rotates with the creature. Everything that should lean with the surface lives in here. */
  body: Container;
  plates: Graphics;
  tell: Graphics;
  /** The airborne form: the arena's ball, in the creature's own colour. */
  ball: Container;
}

/**
 * A Bounder.
 *
 * Six overlapping plates around a centre, so curling is a single parameter: at rest they fan out into
 * a segmented back with legs showing, and closed they overlap into a sphere. Same trick a real pill
 * bug uses, and the reason it reads without animation frames.
 */
export function createBounderDisplay(): BounderDisplay {
  const container = new Container();
  const body = new Container();
  const tell = new Graphics();
  const plates = new Graphics();
  body.addChild(tell, plates);
  // Drawn to match the arena ball exactly -- same glow ring at the same proportion, same solid core --
  // and only recoloured. A launched Bounder *is* a ball to be returned, and the player should not have
  // to be told that twice.
  const radius = BOUNDER.radius * CELL;
  const ball = new Container();
  ball.addChild(
    new Graphics().circle(0, 0, radius * 2.6).fill({ color: SHELL, alpha: 0.14 }),
    new Graphics().circle(0, 0, radius).fill(SHELL),
    new Graphics().circle(-radius * 0.28, -radius * 0.3, radius * 0.3).fill({ color: 0xffffff, alpha: 0.22 }),
  );
  container.addChild(body, ball);
  return { container, body, plates, tell, ball };
}

/** The shell colour, shared by the walking plates and the airborne ball so they read as one animal. */
const SHELL = 0x6d5b46;

const PLATES = 6;

/**
 * Redraw a Bounder at its current curl.
 *
 * `curl` runs from nothing to fully closed: 0 while it is walking, 1 in the air. The plates slide
 * together and the whole body shortens as it goes, so an uncurled one is visibly wider than tall and a
 * curled one is round -- which is the only thing the player needs to read from across a dark room.
 */
export function drawBounder(display: BounderDisplay, creature: Creature): void {
  const radius = BOUNDER.radius * CELL;
  // In the air it is a ball and nothing else. It is never drawn part-folded off a surface: the two
  // forms mean two different things to the player, and a halfway pose means neither.
  const airborne = creature.state === "hurl";
  display.ball.visible = airborne;
  display.body.visible = !airborne;
  if (airborne) {
    display.ball.rotation = Math.atan2(creature.vy, creature.vx);
    // Brighter once the machine has touched it, because that is the one thing the player is waiting
    // to see: this one is going to land hurt.
    display.ball.alpha = creature.deflected ? 1 : 0.82;
    return;
  }
  const curl = creature.state === "coil" ? Math.min(1, creature.tell)
    : creature.state === "spent" ? 0.2
      : 0;

  // It lies along the surface: the body's long axis follows the tangent, and the plates fan away
  // from the rock.
  display.body.rotation = creature.surfaceAngle - Math.PI / 2;

  const plates = display.plates;
  plates.clear();
  // Legs, only while there is something to stand on and they are not tucked away.
  if (curl < 0.5) {
    const show = 1 - curl * 2;
    for (let index = 0; index < 4; index++) {
      const offset = (index / 3 - 0.5) * radius * 1.3;
      plates
        .moveTo(offset, radius * 0.5)
        .lineTo(offset + radius * 0.16, radius * (0.5 + 0.42 * show))
        .stroke({ width: 2, color: 0x53483c, alpha: 0.9 });
    }
  }
  // The shell. Fanned out along the body when walking, stacked into a circle when curled.
  for (let index = 0; index < PLATES; index++) {
    const t = index / (PLATES - 1);
    const spread = (t - 0.5) * radius * 1.7 * (1 - curl);
    const arc = radius * (0.52 + 0.48 * curl);
    const lift = -radius * 0.1 * (1 - curl);
    plates
      .ellipse(spread, lift, arc * (0.34 + 0.66 * curl), arc)
      .fill({ color: index % 2 === 0 ? SHELL : 0x5b4c3b, alpha: 1 })
      .stroke({ width: 1.5, color: 0x2a231c, alpha: 0.85 });
  }

  drawTell(display, creature, radius);
  const damage = 1 - creature.hp / creature.maxHp;
  display.plates.tint = creature.hitFlash > 0
    ? 0xffffff
    : damage > 0.6 ? 0xd08a72 : damage > 0.3 ? 0xc0a288 : 0xffffff;
}

/**
 * The tell.
 *
 * Only the wind-up is announced. It throws a lane down the heading it has locked, because that lane
 * is the ground to leave. In the air nothing is added: the ball form is the whole message, and a
 * second layer of glow on top of it would say the same thing twice.
 */
function drawTell(display: BounderDisplay, creature: Creature, radius: number): void {
  const tell = display.tell;
  tell.clear();
  if (creature.state === "coil") {
    const heat = creature.tell;
    // Drawn in body-local space, so it has to be rotated back out of the body's own lean.
    const lane = creature.facing - display.body.rotation;
    if (creature.timer <= BOUNDER.lockSeconds) {
      const reach = BOUNDER.hurlSpeed * BOUNDER.hurlSeconds * CELL * 0.3;
      const spread = radius * 0.5 * heat;
      tell.moveTo(Math.cos(lane) * radius * 0.5 - Math.sin(lane) * spread,
        Math.sin(lane) * radius * 0.5 + Math.cos(lane) * spread)
        .lineTo(Math.cos(lane) * reach - Math.sin(lane) * radius * 0.16,
          Math.sin(lane) * reach + Math.cos(lane) * radius * 0.16)
        .lineTo(Math.cos(lane) * reach + Math.sin(lane) * radius * 0.16,
          Math.sin(lane) * reach - Math.cos(lane) * radius * 0.16)
        .lineTo(Math.cos(lane) * radius * 0.5 + Math.sin(lane) * spread,
          Math.sin(lane) * radius * 0.5 - Math.cos(lane) * spread)
        .closePath()
        .fill({ color: PALETTE.danger, alpha: 0.1 + heat * 0.18 });
    }
    tell.circle(0, 0, radius * (1.1 + heat * 0.5)).fill({ color: PALETTE.danger, alpha: 0.12 + heat * 0.3 });
  }
}

/** A piece of ore on the cavern floor. */
export function createOreDisplay(colour: number): Container {
  const container = new Container();
  const size = CELL * 0.16;
  container.addChild(
    new Graphics().circle(0, 0, size * 2.4).fill({ color: colour, alpha: 0.16 }),
    new Graphics()
      .moveTo(-size, 0).lineTo(0, -size).lineTo(size, 0).lineTo(0, size).closePath()
      .fill(colour)
      .stroke({ width: 1, color: PALETTE.void, alpha: 0.6 }),
  );
  return container;
}
