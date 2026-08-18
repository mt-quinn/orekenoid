import type { Container, Graphics } from "pixi.js";
import type { Band, EcotoneId, MaterialKind, ProvinceId, ResourceId } from "./config";
import type { BrickReaction } from "./view/feedback";

export interface Vec2 { x: number; y: number }

/**
 * One rung of the opening sequence.
 *
 * `id` doubles as the control it unlocks, so the input gate and the tutorial cannot drift apart:
 * there is no separate list of what is available.
 */
export interface TutorialStep {
  id: "move" | "aim" | "commit" | "serve" | "paddle" | "arenaAim" | "speed" | "atlas" | "bank" | "face" | "liability";
  /**
   * Other controls this rung hands over at the same time.
   *
   * Turning the frame and committing it are one act -- you cannot fit a frame to a diagonal without
   * doing both -- and so are aiming a serve and serving it, since the aim only does anything before
   * the ball is live. Split across two rungs each, the sequence asked for a keystroke twice to teach
   * one idea, which is most of why nine rungs felt like nine things to remember. `also` lets one rung
   * own both controls without the input gate and the prompt drifting apart.
   */
  also?: Array<"move" | "aim" | "commit" | "serve" | "paddle" | "arenaAim" | "speed" | "atlas" | "bank" | "face" | "liability">;
  keys: string;
  /**
   * The imperative, in the player's terms rather than the machine's.
   *
   * This is the line the prompt leads with. "COMMIT THE CLAIM" is a thing a player can want;
   * "PRESS F" is a thing they can only obey, and a tutorial made of the second kind teaches a
   * keyboard rather than a game.
   */
  label: string;
  /** One short line on what it is for. Omitted where the goal is self-evident. */
  why?: string;
  /**
   * How to do it with a finger.
   *
   * Shown in place of `keys` on a touchscreen. Naming keys to somebody holding a phone is worse
   * than saying nothing: it advertises a control they do not have and hides the one they do.
   */
  gesture?: string;
  /**
   * Which gesture to *demonstrate*, if any.
   *
   * A phrase like "drag on the left" is a description; a thumb visibly performing the drag is an
   * instruction. Shown once per distinct gesture -- after the first time the player knows what a
   * drag is, and repeating the animation would be a game that keeps explaining itself.
   */
  demo?: "stick" | "swipe" | "tap" | "hold";
  /** The mode this can be performed in, so the prompt never asks for the impossible. */
  where: "survey" | "play";
  /** Shown and then advanced automatically. Worth knowing, not worth blocking on. */
  optional?: boolean;
  done: boolean;
}

export interface Cell {
  x: number;
  y: number;
  solid: boolean;
  baseSolid: boolean;
  hidden: boolean;
  exhausted: boolean;
  /**
   * Broken at least once, whatever put it back.
   *
   * Regrowth restores the rock but not the debt: a cell that has already been paid for does not
   * count as load a second time, and reads desaturated so the player can see it is free to leave.
   * Without this, the Rootwarren's whole rule punished you for standing still -- growth crept back
   * into a claim you had already cleared and charged you for it again.
   *
   * Never stored in a save. It is derived from the mutation log on load, because a cell that has
   * a `grow` edit was necessarily cut before it.
   */
  worked: boolean;
  kind: MaterialKind;
  /** What this cell drops when broken, if anything. */
  resource: ResourceId | null;
  hp: number;
  maxHp: number;
  persistent: boolean;
  province: ProvinceId;
  ecotone: EcotoneId | null;
  band: Band;
  /** Lattice orientation for facet materials: +1 is NE-SW, -1 is NW-SE. */
  facetAxis: 1 | -1;
}

export interface FrameGeometry {
  origin: Vec2;
  angle: number;
  width: number;
  depth: number;
}

export interface OrientedFootprint {
  center: Vec2;
  halfWidth: number;
  halfHeight: number;
  angle: number;
}

export interface Brick {
  /** Broken once already: not load, and drawn desaturated to say so. */
  worked: boolean;
  u: number;
  v: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  kind: MaterialKind;
  resource: ResourceId | null;
  facetAxis: 1 | -1;
  alive: boolean;
  persistent: boolean;
  liable: boolean;
  footprint: OrientedFootprint;
  sourceCells: Cell[];
  hitFlash: number;
  display?: Container;
  /**
   * Fracture layers, revealed one per hit taken.
   *
   * An array rather than one graphic because a four-hit slate bank has to be readable at 4, 3, 2
   * and 1 -- a single crack that fades in says only "damaged", which makes a nearly-broken brick
   * indistinguishable from a freshly chipped one and turns every multi-hit material into guesswork.
   */
  damageStages?: Graphics[];
  /** Where this brick sits when nothing is shoving it, in world pixels. */
  baseX?: number;
  baseY?: number;
  /** Transient shove, spin and colour-pulse state. See `view/feedback.ts`. */
  react?: BrickReaction;
}

/** A short-lived rebound surface left behind by a destroyed spore bulb. */
export interface Membrane {
  u: number;
  v: number;
  halfWidth: number;
  halfHeight: number;
  life: number;
  maxLife: number;
  display?: Graphics;
}

export interface Ball {
  id: number;
  u: number;
  v: number;
  vu: number;
  vv: number;
  served: boolean;
  radius: number;
  glow: number;
  trail: Vec2[];
  display?: Container;
  trailDisplay?: Graphics;
}

export interface Drop {
  u: number;
  v: number;
  vv: number;
  spin: number;
  resource: ResourceId;
  display: Graphics;
}

export interface Arena extends FrameGeometry {
  province: ProvinceId;
  ecotone: EcotoneId | null;
  band: Band;
  bricks: Brick[];
  balls: Ball[];
  drops: Drop[];
  membranes: Membrane[];
  /** Regrowth budget remaining, in cells. Bounded so no arena can stall forever. */
  regrowthBudget: number;
  regrowthTimer: number;
  resourceCount: number;
  collected: number;
  combo: number;
  splitArmed: boolean;
  splitUsed: boolean;
  serveAim: number;
  initialLiability: number;
  damageTaken: number;
  /** Sequential balls remaining after the current one is lost. */
  spareBalls: number;
  /** Rail glow from a rebound off the frame, 0..1, decaying. */
  railFlash: number;
  paddle: { u: number; velocity: number; width: number; flash: number; impact: number; recoil: number; display?: Container };
  liabilityDisplay?: Graphics;
  trajectoryDisplay?: Graphics;
  container: Container;
  board: Container;
  actors: Container;
  /**
   * How far the crumble wavefront has travelled, in board rows. Masks the board behind it.
   *
   * Ahead of the front nothing the board draws is visible at all, so the framed region reads as
   * the terrain it still is.
   */
  crumbleFront: number;
  crumbleMask?: Graphics;
  /** The rail glow, brightened as the claim's pace ramps up. */
  railLight?: Graphics;
  resolving: boolean;
  visualAge: number;
}
