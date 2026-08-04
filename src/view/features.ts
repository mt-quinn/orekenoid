// World features: the things worth travelling to, made visible.
//
// The generator places ~130 features per world, and until this file existed the player
// could perceive almost none of them. Buried seams were real but invisible until a claim
// was framed over them, and the five hanging marker types resolved to a carved cell and a
// database row -- nothing was drawn at all. A world with a hundred recorded points of
// interest and no way to notice any of them is the same world as one with none.
//
// Two rules from WORLD_DESIGN_BRIEF.md decide how these are drawn:
//
//   "Direction is discoverable; contents are a wager."
//       A feature announces *that* it is there, from across a cavern, and never what it
//       is. A seam shows as mineral staining on the rock, not as a labelled ore deposit.
//
//   "Nothing auto-fills or interprets discoveries for them."
//       So nothing here writes to the Atlas. The player sees a thing, travels to it, and
//       marks it themselves if they want it remembered. The world signals; it never
//       annotates.

import { Container, Graphics } from "pixi.js";
import { CELL, PALETTE, PROVINCE_PALETTE, RESOURCES } from "../config";
import type { FeatureSite } from "../worldgen/rooms";
import type { WorldModel } from "../world";

/** A drawn feature, kept so the update loop can animate the few that move. */
export interface FeatureMark {
  site: FeatureSite;
  display: Container;
  /** Rotated slowly by `updateFeatureMarks`. Only anomalies have one. */
  spinner: Container | null;
}

/**
 * Deterministic per-cell variation.
 *
 * Decoration must not be identical everywhere, and it must not shimmer or move when the
 * world reloads, so variation is hashed from position rather than drawn from a random
 * source.
 */
function hash01(x: number, y: number, salt: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * A soft halo, built from concentric strokes rather than a blur filter.
 *
 * A hundred blur filters is a hundred render targets; the same read costs nothing this
 * way, and this is what makes a feature visible from across a dark cavern.
 */
function halo(colour: number, radius: number, strength: number): Graphics {
  const graphic = new Graphics();
  // Twelve rings rather than seven: at seven the steps between them were visible as
  // concentric banding, which reads as a target painted on the rock instead of as light.
  const rings = 12;
  // Outermost first, alpha rising inward, so the stack integrates into a smooth falloff.
  // The first version ran the loop the other way and gave the *outer* ring alpha zero,
  // which stacked the middle rings into a flat grey disc that read as fog rather than as
  // light -- the one thing a halo must not do in a game about a dark mine.
  for (let ring = rings; ring >= 1; ring--) {
    const fraction = ring / rings;
    graphic.circle(0, 0, radius * fraction)
      .fill({ color: colour, alpha: strength * 0.1 * (1 - fraction) ** 1.6 + strength * 0.012 });
  }
  return graphic;
}

/**
 * Mineral staining over a buried seam.
 *
 * The whole prospecting loop depends on this being readable: a seam the player cannot see
 * is not a reason to travel, and a seam labelled with its contents is not a wager. So the
 * stain carries the ore's own colour but no shape that identifies it -- bloom and specks
 * bleeding out of the rock, dense at the centre and ragged at the edge.
 */
function seamStain(colour: number, x: number, y: number): Container {
  const container = new Container();
  container.addChild(halo(colour, 2.6 * CELL, 0.9));
  const bloom = new Graphics();
  // Irregular petals, so it reads as something that grew rather than something placed.
  for (let index = 0; index < 7; index++) {
    const angle = hash01(x, y, index) * Math.PI * 2;
    const distance = (0.35 + hash01(x, y, index + 20) * 0.7) * CELL;
    const size = (0.3 + hash01(x, y, index + 40) * 0.45) * CELL;
    bloom.ellipse(Math.cos(angle) * distance, Math.sin(angle) * distance, size, size * 0.72)
      .fill({ color: colour, alpha: 0.3 });
  }
  bloom.circle(0, 0, CELL * 0.42).fill({ color: colour, alpha: 0.42 });
  // A few bright grains, which is the only part that reads as *metal* rather than stain.
  for (let index = 0; index < 5; index++) {
    const angle = hash01(x, y, index + 60) * Math.PI * 2;
    const distance = hash01(x, y, index + 80) * CELL * 0.9;
    bloom.circle(Math.cos(angle) * distance, Math.sin(angle) * distance, 1.9)
      .fill({ color: 0xffffff, alpha: 0.6 });
  }
  container.addChild(bloom);
  return container;
}

/**
 * A spoil cairn over a buried cache.
 *
 * Deliberately *machined* rather than geological -- stacked cut stone and a scratched
 * tally. Somebody buried this, and the tell is that somebody was here, not that ore is
 * present.
 */
function cacheCairn(x: number, y: number): Container {
  const container = new Container();
  container.addChild(halo(PALETTE.machine, 1.8 * CELL, 0.6));
  const cairn = new Graphics();
  let width = CELL * 0.62;
  let top = CELL * 0.5;
  for (let course = 0; course < 4; course++) {
    const skew = (hash01(x, y, course) - 0.5) * CELL * 0.16;
    cairn.roundRect(-width / 2 + skew, top - CELL * 0.24, width, CELL * 0.22, 3)
      .fill(0x2a302f).stroke({ width: 2, color: PALETTE.machine, alpha: 0.85 });
    top -= CELL * 0.26;
    width *= 0.78;
  }
  // The tally: three scratches, the universal mark for "counted and left".
  for (let mark = 0; mark < 3; mark++) {
    const offset = (mark - 1) * 5;
    cairn.moveTo(offset, -CELL * 0.02).lineTo(offset + 2, CELL * 0.14)
      .stroke({ width: 1.6, color: PALETTE.ink, alpha: 0.7 });
  }
  container.addChild(cairn);
  return container;
}

/**
 * An anomaly: the discovery layer's hook, and the most conspicuous thing in the world
 * short of a cornerstone.
 *
 * It has to read as *deliberate and not geological* from a long way off, because its whole
 * job is to make a player change course. The inner figure rotates, which is the only motion
 * in the world outside an arena and therefore reads as significant on its own.
 */
function anomaly(province: keyof typeof PROVINCE_PALETTE): { display: Container; spinner: Container } {
  const container = new Container();
  const colour = PROVINCE_PALETTE[province].accent;
  container.addChild(halo(colour, 4.2 * CELL, 1.25));

  const cage = new Graphics()
    .circle(0, 0, CELL * 0.86).stroke({ width: 2.4, color: colour, alpha: 0.55 })
    .circle(0, 0, CELL * 1.18).stroke({ width: 1.2, color: colour, alpha: 0.26 });
  // Four registration ticks, so the ring reads as an instrument rather than a bubble.
  for (let tick = 0; tick < 4; tick++) {
    const angle = (tick / 4) * Math.PI * 2 + Math.PI / 4;
    cage.moveTo(Math.cos(angle) * CELL * 0.86, Math.sin(angle) * CELL * 0.86)
      .lineTo(Math.cos(angle) * CELL * 1.18, Math.sin(angle) * CELL * 1.18)
      .stroke({ width: 2, color: colour, alpha: 0.6 });
  }

  const spinner = new Container();
  // A single triangle with a radial index arm, not two overlapping triangles: the
  // hexagram the first version drew is a loaded symbol that reads as occult rather than
  // as instrumentation, which is the wrong promise for what the discovery layer will
  // hang here.
  const figure = new Graphics()
    .poly([0, -CELL * 0.5, CELL * 0.44, CELL * 0.28, -CELL * 0.44, CELL * 0.28])
    .stroke({ width: 2.6, color: 0xffffff, alpha: 0.9 });
  figure.moveTo(0, 0).lineTo(0, -CELL * 0.5).stroke({ width: 1.8, color: colour, alpha: 0.8 });
  figure.circle(0, -CELL * 0.5, 3).fill({ color: colour, alpha: 0.95 });
  figure.circle(0, 0, 3.2).fill({ color: 0xffffff, alpha: 0.95 });
  spinner.addChild(figure);

  container.addChild(cage, spinner);
  return { display: container, spinner };
}

/**
 * A survey instrument: a plumb on a graduated arc, left standing by whoever mapped this
 * before. Reads as information rather than as treasure.
 */
function surveyInstrument(): Container {
  const container = new Container();
  container.addChild(halo(PALETTE.rail, 2.2 * CELL, 0.7));
  const rig = new Graphics()
    // Tripod.
    .moveTo(-CELL * 0.42, CELL * 0.44).lineTo(0, -CELL * 0.34).lineTo(CELL * 0.42, CELL * 0.44)
    .moveTo(0, -CELL * 0.34).lineTo(0, CELL * 0.44)
    .stroke({ width: 2.4, color: PALETTE.machine, alpha: 0.9 });
  // The graduated arc, which is the part that says "measurement".
  for (let step = 0; step <= 6; step++) {
    const angle = Math.PI + (step / 6) * Math.PI;
    const inner = CELL * 0.5;
    const outer = step % 3 === 0 ? CELL * 0.68 : CELL * 0.6;
    rig.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner - CELL * 0.34)
      .lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer - CELL * 0.34)
      .stroke({ width: 1.6, color: PALETTE.rail, alpha: 0.75 });
  }
  rig.circle(0, -CELL * 0.34, 3).fill(PALETTE.ink);
  container.addChild(rig);
  return container;
}

/**
 * A procedure site: a machined plinth with an empty socket. Its emptiness is the point --
 * it says something goes here without saying what, which is exactly what the four
 * knowledge procedures in the brief will need to hang on.
 */
function procedurePlinth(): Container {
  const container = new Container();
  container.addChild(halo(PALETTE.brightFault, 2.6 * CELL, 0.8));
  const plinth = new Graphics()
    .poly([
      -CELL * 0.62, CELL * 0.5, -CELL * 0.46, -CELL * 0.16,
      CELL * 0.46, -CELL * 0.16, CELL * 0.62, CELL * 0.5,
    ])
    .fill(0x232a2c).stroke({ width: 2.4, color: PALETTE.machine, alpha: 0.9 })
    .roundRect(-CELL * 0.3, -CELL * 0.34, CELL * 0.6, CELL * 0.22, 3)
    .fill(0x11181a).stroke({ width: 2, color: PALETTE.brightFault, alpha: 0.8 });
  // The socket: a dark recess with a bright rim, unmistakably waiting for something.
  plinth.circle(0, -CELL * 0.23, CELL * 0.13).fill(0x05090a)
    .stroke({ width: 2, color: PALETTE.brightFault, alpha: 0.95 });
  container.addChild(plinth);
  return container;
}

/**
 * Decoration: the texture tier. Four deterministic variants so a cavern is furnished
 * without every prop being the same object, and no halo -- decoration must never compete
 * with a feature that is actually worth walking to.
 */
function decoration(
  province: keyof typeof PROVINCE_PALETTE,
  x: number,
  y: number,
  surface: "above" | "below" | "wall",
): Container | null {
  const container = new Container();
  const palette = PROVINCE_PALETTE[province];
  // Variant is chosen from what the prop can actually attach to, then varied within that:
  // a stalactite hanging from nothing is worse than no stalactite.
  const roll = hash01(x, y, 7);
  const variant = surface === "above"
    ? (roll < 0.7 ? 0 : 2)
    : surface === "below"
      ? (roll < 0.45 ? 1 : roll < 0.8 ? 3 : 2)
      : 2;
  const graphic = new Graphics();
  if (variant === 0) {
    // A hanging spine.
    graphic.poly([-6, -CELL * 0.5, 6, -CELL * 0.5, 0, CELL * 0.42])
      .fill(palette.base).stroke({ width: 1.6, color: palette.edge, alpha: 0.7 });
  } else if (variant === 1) {
    // A settled boulder.
    graphic.ellipse(0, CELL * 0.16, CELL * 0.34, CELL * 0.26)
      .fill(palette.base).stroke({ width: 1.8, color: palette.edge, alpha: 0.6 });
    graphic.moveTo(-CELL * 0.2, CELL * 0.06).lineTo(CELL * 0.12, CELL * 0.02)
      .stroke({ width: 1.4, color: palette.edge, alpha: 0.4 });
  } else if (variant === 2) {
    // A crystal cluster, catching the accent.
    for (let shard = 0; shard < 3; shard++) {
      const lean = (hash01(x, y, shard + 11) - 0.5) * 14;
      graphic.poly([lean, -CELL * 0.36, lean + 5, CELL * 0.2, lean - 5, CELL * 0.2])
        .fill({ color: palette.accent, alpha: 0.5 })
        .stroke({ width: 1.2, color: palette.accent, alpha: 0.8 });
    }
  } else {
    // Rubble: a spill of small chips, the most common and least interesting thing.
    for (let chip = 0; chip < 5; chip++) {
      const cx = (hash01(x, y, chip + 30) - 0.5) * CELL * 0.8;
      const cy = CELL * 0.2 + (hash01(x, y, chip + 50) - 0.5) * CELL * 0.2;
      graphic.circle(cx, cy, 2.4 + hash01(x, y, chip + 70) * 2)
        .fill({ color: palette.base, alpha: 0.9 });
    }
  }
  container.addChild(graphic);
  return container;
}

/** How far a prop will reach to find something to hang off, in cells. */
const DECOR_REACH = 4;

/**
 * The nearest rock face to a decoration marker, and how far the prop must move to touch it.
 *
 * Ceilings are preferred over floors and floors over walls, because a hanging spine reads
 * as cave and a prop on the ground reads as clutter -- and clutter is what the eye should
 * notice least.
 */
function findSurface(
  world: WorldModel,
  x: number,
  y: number,
): { side: "above" | "below" | "wall"; offsetX: number; offsetY: number } | null {
  for (let distance = 0; distance <= DECOR_REACH; distance++) {
    if (world.solidAt(x + 0.5, y - distance - 0.5)) return { side: "above", offsetX: 0, offsetY: -distance };
    if (world.solidAt(x + 0.5, y + distance + 1.5)) return { side: "below", offsetX: 0, offsetY: distance };
    if (world.solidAt(x - distance - 0.5, y + 0.5)) return { side: "wall", offsetX: -distance, offsetY: 0 };
    if (world.solidAt(x + distance + 1.5, y + 0.5)) return { side: "wall", offsetX: distance, offsetY: 0 };
  }
  return null;
}

/**
 * Draw every feature the generator placed.
 *
 * Buried features are drawn at their cell so the stain or cairn sits on the rock face that
 * hides them; hanging features are drawn in the cavity they were carved into.
 */
export function buildFeatureMarks(layer: Container, features: readonly FeatureSite[], world: WorldModel): FeatureMark[] {
  const marks: FeatureMark[] = [];
  for (const site of features) {
    const province = world.provinceAt(site.x, site.y);
    let display: Container;
    let spinner: Container | null = null;
    switch (site.marker) {
      case "seam": {
        const resource = world.cells[site.y]?.[site.x]?.resource;
        display = seamStain(resource ? RESOURCES[resource].colour : PALETTE.machine, site.x, site.y);
        break;
      }
      case "cache":
        display = cacheCairn(site.x, site.y);
        break;
      case "anomaly": {
        const built = anomaly(province);
        display = built.display;
        spinner = built.spinner;
        break;
      }
      case "survey":
        display = surveyInstrument();
        break;
      case "procedure":
        display = procedurePlinth();
        break;
      default: {
        // Decoration is authored mid-cavity -- an author marks *roughly here*, not "on this
        // exact rock face" -- so the renderer finds the nearest surface and attaches the
        // prop to it. Testing only the adjacent cells discarded 59 of 68 props as floating,
        // which is the marker being read too literally rather than the art being wrong.
        const anchor = findSurface(world, site.x, site.y);
        if (!anchor) continue;
        const prop = decoration(province, site.x, site.y, anchor.side);
        if (!prop) continue;
        prop.position.set(anchor.offsetX * CELL, anchor.offsetY * CELL);
        display = new Container();
        display.addChild(prop);
        break;
      }
    }
    display.position.set((site.x + 0.5) * CELL, (site.y + 0.5) * CELL);
    display.label = `feature-${site.marker}-${site.x}-${site.y}`;
    layer.addChild(display);
    marks.push({ site, display, spinner });
  }
  return marks;
}

/**
 * Advance the few features that move.
 *
 * Anomalies rotate slowly and out of phase with each other. This is currently the only
 * motion anywhere in the world outside an arena, which is precisely why it reads as
 * significant: a still world with one turning thing in it points at the turning thing.
 */
export function updateFeatureMarks(marks: readonly FeatureMark[], time: number): void {
  for (const mark of marks) {
    if (!mark.spinner) continue;
    const phase = hash01(mark.site.x, mark.site.y, 3) * Math.PI * 2;
    mark.spinner.rotation = time * 0.32 + phase;
  }
}
