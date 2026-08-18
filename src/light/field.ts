// Hard light and hard dark.
//
// Three states, not two. Teleglitch is lit-or-black and that is right for a corridor shooter, but
// a mining game has to let the player keep the shape of a chamber they have already walked --
// otherwise the Atlas is the only map and the world itself becomes unreadable. So:
//
//   LIT        drawn in full, with everything in it
//   REMEMBERED drawn dim: the geometry you walked, with no promise about what is in it now
//   UNSEEN     black
//
// The middle state is the game's own house style already. The Atlas leaves undiscovered ground as
// void rather than dimming it, for exactly this reason -- the negative space is information.
//
// Shadows are cast by recursive shadowcasting over the eight octants, which is what puts a shadow
// edge exactly on a cell boundary. A ring of rays would leave gaps between them at range and the
// edges would shimmer as the light moved.

import { WORLD_COLS, WORLD_ROWS } from "../config";
import type { SolidityOracle } from "../combat/ballField";

export const LIGHT = {
  /** Brightness of ground the player has seen before but cannot see now, 0..1. */
  remembered: 0.3,
  /**
   * How far the lit level may fall inside a light's own radius.
   *
   * Not a soft falloff -- the whole point is hard edges -- but a light that is uniformly full to
   * its last cell and then stops reads as a disc laid on the floor rather than as a lamp. This is
   * a shallow ramp over the outer third only.
   */
  edgeSoftness: 0.34,
} as const;

export interface LightSource {
  /** Cell coordinates. */
  x: number;
  y: number;
  /** Radius in cells. */
  radius: number;
  /** 0..1. Multiplies the light this source contributes. */
  strength: number;
}

const OCTANT_MULTIPLIERS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
  [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
];

export class LightField {
  /** Current lit level per cell, 0..1. Rebuilt every frame. */
  readonly lit = new Float32Array(WORLD_COLS * WORLD_ROWS);
  /** Has this cell ever been lit? Never cleared -- this is the player's memory of the mine. */
  readonly seen = new Uint8Array(WORLD_COLS * WORLD_ROWS);

  constructor(private readonly world: SolidityOracle) {}

  index(cellX: number, cellY: number): number {
    return cellY * WORLD_COLS + cellX;
  }

  litAt(x: number, y: number): number {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    if (cellX < 0 || cellY < 0 || cellX >= WORLD_COLS || cellY >= WORLD_ROWS) return 0;
    return this.lit[this.index(cellX, cellY)];
  }

  /** Is there enough light here to see something standing in it? */
  isLit(x: number, y: number): boolean {
    return this.litAt(x, y) > 0.12;
  }

  /**
   * Recompute the whole field from this frame's lights.
   *
   * The clear is the whole array rather than boxes around this frame's sources. Clearing only what
   * is about to be relit leaves last frame's light burning wherever a source moved away from --
   * a lamp carried down a corridor would smear a lit trail behind it that nothing ever switched
   * off. A `fill` over 34,560 floats is a memset and does not show up in a frame budget; the
   * expensive half is the texture upload, and that is bounded to the camera instead.
   */
  compute(sources: readonly LightSource[]): void {
    this.lit.fill(0);
    for (const source of sources) this.apply(source);
  }

  private apply(source: LightSource): void {
    if (source.radius <= 0 || source.strength <= 0) return;
    const originX = Math.floor(source.x);
    const originY = Math.floor(source.y);
    // The cell the light is standing in is always lit. A lamp inside a doorway whose cell the grid
    // calls solid would otherwise light nothing at all, including itself.
    this.mark(originX, originY, source.strength);
    for (const [xx, xy, yx, yy] of OCTANT_MULTIPLIERS) {
      this.castOctant(originX, originY, 1, 1, 0, source.radius, source.strength, xx, xy, yx, yy);
    }
  }

  private mark(cellX: number, cellY: number, value: number): void {
    if (cellX < 0 || cellY < 0 || cellX >= WORLD_COLS || cellY >= WORLD_ROWS) return;
    const index = this.index(cellX, cellY);
    if (value > this.lit[index]) this.lit[index] = value;
    if (value > 0.12) this.seen[index] = 1;
  }

  private solid(cellX: number, cellY: number): boolean {
    if (cellX < 0 || cellY < 0 || cellX >= WORLD_COLS || cellY >= WORLD_ROWS) return true;
    return this.world.solidAt(cellX + 0.5, cellY + 0.5);
  }

  /**
   * One octant of recursive shadowcasting.
   *
   * `start` and `end` are slopes bounding the wedge still visible. Meeting a wall narrows the wedge
   * and recurses for the part of it that survives, which is what makes a shadow a clean wedge
   * rather than a stipple.
   */
  private castOctant(
    originX: number,
    originY: number,
    row: number,
    start: number,
    end: number,
    radius: number,
    strength: number,
    xx: number,
    xy: number,
    yx: number,
    yy: number,
  ): void {
    if (start < end) return;
    const radiusSquared = radius * radius;
    let nextStart = start;
    for (let distance = row; distance <= Math.ceil(radius); distance++) {
      let blocked = false;
      for (let deltaX = -distance, deltaY = -distance; deltaX <= 0; deltaX++) {
        const leftSlope = (deltaX - 0.5) / (deltaY + 0.5);
        const rightSlope = (deltaX + 0.5) / (deltaY - 0.5);
        if (nextStart < rightSlope) continue;
        if (end > leftSlope) break;

        const cellX = originX + deltaX * xx + deltaY * xy;
        const cellY = originY + deltaX * yx + deltaY * yy;
        const distanceSquared = deltaX * deltaX + deltaY * deltaY;
        if (distanceSquared <= radiusSquared) {
          // A shallow ramp over the outer third, so the lamp has a shape without having a gradient.
          const reach = Math.sqrt(distanceSquared) / radius;
          const fade = reach < 1 - LIGHT.edgeSoftness
            ? 1
            : Math.max(0, 1 - (reach - (1 - LIGHT.edgeSoftness)) / LIGHT.edgeSoftness);
          this.mark(cellX, cellY, strength * fade);
        }

        const isWall = this.solid(cellX, cellY);
        if (blocked) {
          if (isWall) {
            nextStart = rightSlope;
            continue;
          }
          blocked = false;
          start = nextStart;
        } else if (isWall && distance < radius) {
          // A wall in open ground splits the wedge: recurse for the part to its left, and carry on
          // scanning with the right-hand bound pulled in.
          blocked = true;
          this.castOctant(originX, originY, distance + 1, start, leftSlope, radius, strength, xx, xy, yx, yy);
          nextStart = rightSlope;
        }
      }
      if (blocked) break;
    }
  }
}
