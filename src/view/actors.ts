// Actor artwork: the survey drone, the paddle, the ball, membranes and drops.
//
// All of these share one construction vocabulary — carbon silhouette, ceramic
// armour plate, amber emitter, brass hardware — so the drone that roams the world
// and the paddle that plays the board read as the same machine seen two ways. That
// is the point: the paddle is not a UI element, it is the drone's working face.

import { BlurFilter, Container, Graphics } from "pixi.js";
import { CELL, PALETTE, PROVINCE_PALETTE, RESOURCES, type ResourceId } from "../config";
import type { StationGrades } from "../economy";
import type { Arena, Ball, Drop, Membrane } from "../types";

/**
 * Metal per plating grade, so the flanks change material and not merely thickness.
 *
 * Read off the resource colours the rest of the game already uses for these ores, so the plate
 * on the drone is recognisably made of the stuff the player mined for it.
 */
const PLATE_METAL: readonly number[] = [
  0x2a302f,
  RESOURCES.copper.colour,
  RESOURCES.iron.colour,
  RESOURCES.cobalt.colour,
  RESOURCES.mithril.colour,
  RESOURCES.runite.colour,
];

/**
 * The survey drone.
 *
 * Every station's grade is drawn. This used to take `paddleWidth` and nothing else, which meant
 * a machine at eighty armour with a full mast and a bandolier was pixel-identical to the one
 * that left the lander in minute one -- twenty-one upgrades with no visible consequence, which
 * is the single reason progression read as a menu bolted to a game. The player should see the
 * machine they built, and never have to read it off a stat line.
 */
export function createDrone(paddleWidth: number, grades: StationGrades = {}): Container {
  const drone = new Container();
  const width = paddleWidth * CELL;
  const plating = grades.plating ?? 0;
  const frame = grades.frame ?? 0;
  const emitterGrade = grades.emitter ?? 0;
  const mastGrade = grades.mast ?? 0;
  const salvage = grades.salvage ?? 0;
  const rack = grades.rack ?? 0;

  // The survey beam: very faint, very wide, and blurred. It says "this machine is
  // looking upward" without competing with the frame projection.
  const beam = new Graphics()
    .poly([-width * 0.32, -14, -116, -286, 116, -286, width * 0.32, -14])
    .fill({ color: PALETTE.karstEdge, alpha: 0.022 });
  beam.filters = [new BlurFilter({ strength: 16, quality: 2 })];
  // FRAME: the thrusters grow with the spine, because the grade carries travel speed.
  const thrusterSpan = width * (0.56 + frame * 0.07);
  const thrusterGlow = new Graphics()
    .ellipse(0, 9, thrusterSpan, 18 + frame * 4)
    .fill({ color: PALETTE.karstEdge, alpha: 0.18 + frame * 0.04 });
  thrusterGlow.filters = [new BlurFilter({ strength: 10, quality: 2 })];

  const silhouette = new Graphics()
    .poly([-width / 2 - 13, -2, -width / 2, -11, width / 2, -11, width / 2 + 13, -2, width / 2 + 8, 9, -width / 2 - 8, 9])
    .fill(0x111719).stroke({ width: 2.5, color: PALETTE.machine, alpha: 0.9 });

  // FRAME: a visible truss under the hull, one rib per grade.
  const spine = new Graphics();
  for (let rib = 0; rib < frame; rib++) {
    const inset = width * (0.16 + rib * 0.13);
    spine.moveTo(-inset, 9).lineTo(-inset * 0.6, 14).lineTo(inset * 0.6, 14).lineTo(inset, 9);
  }
  if (frame > 0) spine.stroke({ width: 2 + frame * 0.4, color: PALETTE.machine, alpha: 0.75 });

  // PLATING: each grade adds a layer, and the metal changes with the ore it was made from.
  const armor = new Graphics()
    .roundRect(-width / 2, -8, width, 14, 4).fill(PLATE_METAL[Math.min(plating, PLATE_METAL.length - 1)])
    .stroke({ width: 2, color: PALETTE.karstEdge, alpha: 0.95 });
  for (let layer = 1; layer < plating; layer++) {
    // Stacked outward, so a heavy machine is visibly thicker across the flanks.
    const grow = layer * 1.6;
    armor.roundRect(-width / 2 - grow, -8 - grow * 0.7, width + grow * 2, 14 + grow, 4 + layer)
      .stroke({ width: 1.6, color: PLATE_METAL[Math.min(layer + 1, PLATE_METAL.length - 1)], alpha: 0.85 });
  }
  armor.roundRect(-width * 0.31, -5, width * 0.62, 8, 2).fill(0x101516)
    .stroke({ width: 1.5, color: PALETTE.machine, alpha: 0.75 });

  // EMITTER: the strike face itself -- wider and hotter with the grade.
  const emitterHalf = width * (0.22 + emitterGrade * 0.05);
  const emitter = new Graphics()
    .rect(-emitterHalf, -2.5 - emitterGrade * 0.5, emitterHalf * 2, 3 + emitterGrade)
    .fill({ color: emitterGrade > 0 ? PALETTE.facetHot : PALETTE.ink, alpha: 0.92 });
  if (emitterGrade > 0) {
    const emitterGlow = new Graphics()
      .rect(-emitterHalf, -4, emitterHalf * 2, 7)
      .fill({ color: PALETTE.facetHot, alpha: 0.1 + emitterGrade * 0.08 });
    emitterGlow.filters = [new BlurFilter({ strength: 6 + emitterGrade * 2, quality: 2 })];
    emitter.addChild(emitterGlow);
  }

  const hardware = new Graphics()
    .circle(-width * 0.39, -1, 3).fill(PALETTE.machine)
    .circle(width * 0.39, -1, 3).fill(PALETTE.machine)
    .moveTo(-width * 0.36, 10).lineTo(-width * 0.28, 17).lineTo(-width * 0.18, 10)
    .moveTo(width * 0.36, 10).lineTo(width * 0.28, 17).lineTo(width * 0.18, 10)
    .stroke({ width: 3, color: PALETTE.machine, alpha: 0.8 });

  // SALVAGE: the bucket drone, docked under the hull when the machine is not in a claim.
  //
  // Docked rather than merely indicated, because it is a separate little machine that the player
  // will see flying on its own during a claim -- so it has to be recognisably the same object
  // parked here. It replaced a collector ring, which drew a radius that no longer exists.
  const salvageBay = new Graphics();
  if (salvage > 0) {
    const bucketWidth = 13 + salvage * 2;
    salvageBay
      // Cradle arms holding it against the hull.
      .moveTo(-bucketWidth / 2, 7).lineTo(-bucketWidth / 2, 11)
      .moveTo(bucketWidth / 2, 7).lineTo(bucketWidth / 2, 11)
      .stroke({ width: 1.4, color: PALETTE.machine, alpha: 0.7 })
      .roundRect(-bucketWidth / 2, 10, bucketWidth, 7, 2).fill(0x141a1b)
      .stroke({ width: 1.4, color: PALETTE.rail, alpha: 0.85 })
      // The hopper mouth, open upward.
      .moveTo(-bucketWidth * 0.34, 10).lineTo(-bucketWidth * 0.24, 6)
      .moveTo(bucketWidth * 0.34, 10).lineTo(bucketWidth * 0.24, 6)
      .stroke({ width: 1.2, color: PALETTE.rail, alpha: 0.6 });
    // One jaw pip per grade: a finer grinder keeps less of what it eats.
    for (let jaw = 0; jaw < salvage; jaw++) {
      salvageBay.circle(-4 + jaw * 4, 13.5, 1.3).fill({ color: RESOURCES.emerald.colour, alpha: 0.9 });
    }
  }

  // RACK: charges you can count, hanging off the hull rail.
  const chargeRack = new Graphics();
  if (rack > 0) {
    const carried = rack * 2;
    chargeRack.moveTo(-width * 0.44, 4).lineTo(width * 0.44, 4)
      .stroke({ width: 1.5, color: PALETTE.machine, alpha: 0.7 });
    for (let charge = 0; charge < carried; charge++) {
      const at = -width * 0.4 + (charge / Math.max(1, carried - 1)) * width * 0.8;
      chargeRack.roundRect(at - 2, 4, 4, 7, 1.5)
        .fill(RESOURCES.sulfur.colour).stroke({ width: 1, color: PALETTE.exhaust, alpha: 0.8 });
    }
  }

  // MAST: the frame projection's nominal source, and where survey grades accumulate.
  const mast = new Graphics()
    .moveTo(0, -11).lineTo(0, -28 - mastGrade * 3).stroke({ width: 2 + mastGrade * 0.3, color: PALETTE.machine });
  const head = -29 - mastGrade * 3;
  mast.poly([-7, head, 0, head - 8, 7, head, 0, head + 8]).fill(0x14191a)
    .stroke({ width: 2, color: PALETTE.ink, alpha: 0.8 })
    .circle(0, head, 2.2).fill(PALETTE.ink);
  // Grade 1 is the gimbal: a ring at the mast's base.
  if (mastGrade >= 1) {
    mast.circle(0, -13, 5).stroke({ width: 1.5, color: RESOURCES.emerald.colour, alpha: 0.8 });
  }
  // Grades 2 and 3 are optics: lens barrels part-way up.
  for (let lens = 0; lens < Math.min(mastGrade - 1, 2); lens++) {
    const at = -20 - lens * 7 - mastGrade;
    mast.roundRect(-4.5, at - 2.5, 9, 5, 2)
      .fill(0x1a2124).stroke({ width: 1.2, color: RESOURCES.ruby.colour, alpha: 0.85 });
  }
  // Grade 4 is the resonant lens, which is the only part material alone cannot buy.
  if (mastGrade >= 4) {
    mast.circle(0, head, 5.5).stroke({ width: 1.4, color: RESOURCES.diamond.colour, alpha: 0.9 });
    const halo = new Graphics().circle(0, head, 9).fill({ color: RESOURCES.diamond.colour, alpha: 0.18 });
    halo.filters = [new BlurFilter({ strength: 8, quality: 2 })];
    mast.addChild(halo);
  }

  drone.addChild(beam, thrusterGlow, silhouette, spine, armor, emitter, hardware, salvageBay, chargeRack, mast);
  return drone;
}

/**
 * The paddle. Its emitter carries the province accent, tying board to geology.
 *
 * It also carries the machine's grades, because the paddle *is* the drone's working face -- the
 * same object seen from the other side. A player who spent an expedition's haul on plating
 * should see the plate on the thing they are steering, not only on the drone they park.
 */
export function createPaddle(arena: Arena, grades: StationGrades = {}): Container {
  const container = new Container();
  const width = arena.paddle.width * CELL;
  const energy = PROVINCE_PALETTE[arena.province].accent;
  const plating = grades.plating ?? 0;
  const emitterGrade = grades.emitter ?? 0;
  const rack = grades.rack ?? 0;

  const glow = new Graphics()
    .roundRect(-width / 2 + 8, -7, width - 16, 14, 7)
    .fill({ color: energy, alpha: 0.3 + emitterGrade * 0.07 });
  glow.filters = [new BlurFilter({ strength: 10 + emitterGrade * 2, quality: 2 })];
  const chassis = new Graphics()
    .poly([-width / 2 - 7, 0, -width / 2 + 1, -11, width / 2 - 1, -11, width / 2 + 7, 0, width / 2 - 2, 10, -width / 2 + 2, 10])
    .fill(0x101617).stroke({ width: 2.2, color: PALETTE.machine });
  // PLATING: layers of the metal it was made from, banded along the striking face.
  for (let layer = 1; layer <= plating; layer++) {
    const grow = layer * 1.5;
    chassis.roundRect(-width / 2 - grow, -11 - grow * 0.5, width + grow * 2, 21 + grow, 3 + layer)
      .stroke({ width: 1.5, color: PLATE_METAL[Math.min(layer, PLATE_METAL.length - 1)], alpha: 0.8 });
  }
  const emitter = new Graphics()
    .roundRect(-width / 2 + 7, -7, width - 14, 11, 4).fill(0x242a29)
    .stroke({ width: 2 + emitterGrade * 0.4, color: energy, alpha: 0.92 })
    .roundRect(-width / 2 + 13, -5 - emitterGrade * 0.4, width - 26, 4 + emitterGrade * 0.8, 2)
    .fill({ color: energy, alpha: 0.92 });
  const hardware = new Graphics()
    .circle(-width / 2 + 10, 1, 3).fill(PALETTE.machine)
    .circle(width / 2 - 10, 1, 3).fill(PALETTE.machine)
    .rect(-10, 6, 20, 5).fill(0x303634).stroke({ width: 1.5, color: PALETTE.machine });
  // RACK: the charges you can actually press B to spend, countable on the face you are steering.
  if (rack > 0) {
    const carried = rack * 2;
    for (let charge = 0; charge < carried; charge++) {
      const at = -width * 0.36 + (charge / Math.max(1, carried - 1)) * width * 0.72;
      hardware.roundRect(at - 1.5, 7, 3, 5, 1).fill(RESOURCES.sulfur.colour);
    }
  }
  container.addChild(glow, chassis, emitter, hardware);
  return container;
}

/** Build and attach a ball's optics and its trail graphic. */
export function attachBall(ball: Ball, arena: Arena): void {
  const display = new Container();
  // A captured Bounder keeps its own colour, so the player can tell at a glance which ball is theirs and
  // which one is the animal they framed -- they behave identically and only one of them pays out.
  const colour = ball.captured ? SHELL : PROVINCE_PALETTE[arena.province].accent;
  // A captured Bounder glows harder and wider. It has to be findable in a field of brown bricks, and the
  // player is tracking two balls at once by then.
  const glow = new Graphics()
    .circle(0, 0, ball.radius * CELL * (ball.captured ? 2.5 : 1.8))
    .fill({ color: colour, alpha: ball.captured ? 0.4 : 0.24 });
  glow.filters = [new BlurFilter({ strength: 7, quality: 2 })];
  const ring = new Graphics().circle(0, 0, ball.radius * CELL + 2).stroke({ width: 1.5, color: colour, alpha: 0.75 });
  const core = new Graphics()
    .circle(0, 0, ball.radius * CELL)
    .fill(ball.captured ? SHELL : PALETTE.ink)
    .stroke({ width: 2, color: 0x282d2b });
  // Offset specular: gives the ball a light direction, which makes its spin and
  // speed legible at a glance.
  core.circle(-3, -3, 2).fill(0xffffff);
  display.addChild(glow, ring, core);
  ball.display = display;
  ball.trailDisplay = new Graphics();
  // Trail behind the ball, so a fast ball never hides under its own history.
  arena.actors.addChild(ball.trailDisplay, display);
}

/** A spore bulb's short-lived rebound membrane, positioned in world space. */
export function attachMembrane(
  membrane: Membrane,
  arena: Arena,
  toWorld: (u: number, v: number) => { x: number; y: number },
): void {
  const graphic = new Graphics();
  const position = toWorld(membrane.u, membrane.v);
  graphic
    .roundRect(
      -membrane.halfWidth * CELL,
      -membrane.halfHeight * CELL,
      membrane.halfWidth * 2 * CELL,
      membrane.halfHeight * 2 * CELL,
      6,
    )
    .fill({ color: PALETTE.spore, alpha: 0.34 })
    .stroke({ width: 2.4, color: PALETTE.spore, alpha: 0.92 });
  graphic.position.set(position.x * CELL, position.y * CELL);
  graphic.rotation = arena.angle;
  membrane.display = graphic;
  arena.actors.addChild(graphic);
}

/**
 * A falling resource drop. Carries its own metal's colour, because catching it is
 * a decision and the player needs to know what they are reaching for.
 */
export function spawnDrop(arena: Arena, u: number, v: number, resource: ResourceId): Drop {
  const display = new Graphics()
    .poly([0, -7, 7, 0, 0, 7, -7, 0])
    .fill(RESOURCES[resource].colour)
    .stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
  arena.actors.addChild(display);
  const drop: Drop = { u, v, vv: -2.2, spin: 0, resource, display };
  arena.drops.push(drop);
  return drop;
}

/**
 * A framed Bounder's ball, in the shell's family but lifted well clear of it.
 *
 * The creature's own tone is 0x6d5b46, which is almost exactly the brown of a chalk brick -- a ball painted
 * in it sat in the middle of the brick field and could not be picked out at all. So it keeps the warmth,
 * which is what says "this is the animal", and takes the brightness it needs to be a ball you can track.
 * It is nothing like the player's own pale ball either, which is the other thing it must never be confused
 * with: only one of the two pays out.
 */
const SHELL = 0xd8a860;
