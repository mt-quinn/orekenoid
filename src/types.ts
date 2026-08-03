import type { Container, Graphics } from "pixi.js";
import type { Band, EcotoneId, MaterialKind, ProvinceId, ResourceId } from "./config";

export interface Vec2 { x: number; y: number }

export interface Cell {
  x: number;
  y: number;
  solid: boolean;
  baseSolid: boolean;
  hidden: boolean;
  exhausted: boolean;
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
  damageDisplay?: Graphics;
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
  paddle: { u: number; velocity: number; width: number; flash: number; impact: number; display?: Container };
  liabilityDisplay?: Graphics;
  trajectoryDisplay?: Graphics;
  container: Container;
  board: Container;
  actors: Container;
  resolving: boolean;
  visualAge: number;
}
