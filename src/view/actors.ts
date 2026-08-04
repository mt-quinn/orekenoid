// Actor artwork: the survey drone, the paddle, the ball, membranes and drops.
//
// All of these share one construction vocabulary — carbon silhouette, ceramic
// armour plate, amber emitter, brass hardware — so the drone that roams the world
// and the paddle that plays the board read as the same machine seen two ways. That
// is the point: the paddle is not a UI element, it is the drone's working face.

import { BlurFilter, Container, Graphics } from "pixi.js";
import { CELL, PALETTE, PROVINCE_PALETTE, RESOURCES, type ResourceId } from "../config";
import type { Arena, Ball, Drop, Membrane } from "../types";

/**
 * The survey drone.
 *
 * Rebuilt whenever paddle width changes, because the silhouette is drawn to the
 * paddle's real width -- the player should see a wider machine after fitting a
 * wider emitter, not read it off a stat line.
 */
export function createDrone(paddleWidth: number): Container {
  const drone = new Container();
  const width = paddleWidth * CELL;

  // The survey beam: very faint, very wide, and blurred. It says "this machine is
  // looking upward" without competing with the frame projection.
  const beam = new Graphics()
    .poly([-width * 0.32, -14, -116, -286, 116, -286, width * 0.32, -14])
    .fill({ color: PALETTE.karstEdge, alpha: 0.022 });
  beam.filters = [new BlurFilter({ strength: 16, quality: 2 })];
  const thrusterGlow = new Graphics()
    .ellipse(0, 9, width * 0.56, 18)
    .fill({ color: PALETTE.karstEdge, alpha: 0.18 });
  thrusterGlow.filters = [new BlurFilter({ strength: 10, quality: 2 })];

  const silhouette = new Graphics()
    .poly([-width / 2 - 13, -2, -width / 2, -11, width / 2, -11, width / 2 + 13, -2, width / 2 + 8, 9, -width / 2 - 8, 9])
    .fill(0x111719).stroke({ width: 2.5, color: PALETTE.machine, alpha: 0.9 });
  const armor = new Graphics()
    .roundRect(-width / 2, -8, width, 14, 4).fill(0x2a302f).stroke({ width: 2, color: PALETTE.karstEdge, alpha: 0.95 })
    .roundRect(-width * 0.31, -5, width * 0.62, 8, 2).fill(0x101516).stroke({ width: 1.5, color: PALETTE.machine, alpha: 0.75 })
    .rect(-width * 0.22, -2.5, width * 0.44, 3).fill({ color: PALETTE.ink, alpha: 0.92 });
  const hardware = new Graphics()
    .circle(-width * 0.39, -1, 3).fill(PALETTE.machine)
    .circle(width * 0.39, -1, 3).fill(PALETTE.machine)
    .moveTo(-width * 0.36, 10).lineTo(-width * 0.28, 17).lineTo(-width * 0.18, 10)
    .moveTo(width * 0.36, 10).lineTo(width * 0.28, 17).lineTo(width * 0.18, 10)
    .stroke({ width: 3, color: PALETTE.machine, alpha: 0.8 });
  // The survey mast, which is what the frame projection nominally comes from.
  const mast = new Graphics()
    .moveTo(0, -11).lineTo(0, -28).stroke({ width: 2, color: PALETTE.machine })
    .poly([-7, -29, 0, -37, 7, -29, 0, -21]).fill(0x14191a).stroke({ width: 2, color: PALETTE.ink, alpha: 0.8 })
    .circle(0, -29, 2.2).fill(PALETTE.ink);

  drone.addChild(beam, thrusterGlow, silhouette, armor, hardware, mast);
  return drone;
}

/** The paddle. Its emitter carries the province accent, tying board to geology. */
export function createPaddle(arena: Arena): Container {
  const container = new Container();
  const width = arena.paddle.width * CELL;
  const energy = PROVINCE_PALETTE[arena.province].accent;
  const glow = new Graphics().roundRect(-width / 2 + 8, -7, width - 16, 14, 7).fill({ color: energy, alpha: 0.3 });
  glow.filters = [new BlurFilter({ strength: 10, quality: 2 })];
  const chassis = new Graphics()
    .poly([-width / 2 - 7, 0, -width / 2 + 1, -11, width / 2 - 1, -11, width / 2 + 7, 0, width / 2 - 2, 10, -width / 2 + 2, 10])
    .fill(0x101617).stroke({ width: 2.2, color: PALETTE.machine });
  const emitter = new Graphics()
    .roundRect(-width / 2 + 7, -7, width - 14, 11, 4).fill(0x242a29).stroke({ width: 2, color: energy, alpha: 0.92 })
    .roundRect(-width / 2 + 13, -5, width - 26, 4, 2).fill({ color: energy, alpha: 0.92 });
  const hardware = new Graphics()
    .circle(-width / 2 + 10, 1, 3).fill(PALETTE.machine)
    .circle(width / 2 - 10, 1, 3).fill(PALETTE.machine)
    .rect(-10, 6, 20, 5).fill(0x303634).stroke({ width: 1.5, color: PALETTE.machine });
  container.addChild(glow, chassis, emitter, hardware);
  return container;
}

/** Build and attach a ball's optics and its trail graphic. */
export function attachBall(ball: Ball, arena: Arena): void {
  const display = new Container();
  const colour = PROVINCE_PALETTE[arena.province].accent;
  const glow = new Graphics().circle(0, 0, ball.radius * CELL * 1.8).fill({ color: colour, alpha: 0.24 });
  glow.filters = [new BlurFilter({ strength: 7, quality: 2 })];
  const ring = new Graphics().circle(0, 0, ball.radius * CELL + 2).stroke({ width: 1.5, color: colour, alpha: 0.75 });
  const core = new Graphics().circle(0, 0, ball.radius * CELL).fill(PALETTE.ink).stroke({ width: 2, color: 0x282d2b });
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
