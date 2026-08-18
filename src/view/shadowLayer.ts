// Drawing the dark, as geometry.
//
// Replaces the per-cell mask texture that used to do this job. That version was wrong twice over:
// it limited sight by distance rather than by what was in the way, and it drew shadow edges on cell
// boundaries, so a wall's shadow came out as a staircase of squares instead of the sharp angular
// wedge a wall actually throws. Both are visible in a single screenshot once you know to look.
//
// What survives from the old system is only the *memory* of ground already seen, which is genuinely
// a per-cell question and is still drawn as a coarse mask underneath this. Live visibility is
// geometry.

import { Container, Graphics } from "pixi.js";
import { CELL } from "../config";
import type { SolidityOracle } from "../combat/ballField";
import { collectOccluders, shadowQuad } from "../light/shadow";

export const SHADOW = {
  /**
   * How dark an occluded cell goes. One, and it has to be one.
   *
   * A first version drew this at 0.7 so ground already walked showed faintly through, keeping a
   * memory of the mine in the world itself. Measured in the renderer, that was wrong: Pixi applies
   * container alpha per vertex rather than as a group opacity, so two overlapping shadow quads
   * composite twice -- 50% black measured 128, and the overlap measured 64. Shadow behind shadow
   * got progressively darker, which is a gradient arrived at by accident in the one system whose
   * whole point is not having one.
   *
   * Opaque removes the artifact and is the reference behaviour besides. The mine's memory lives in
   * the Atlas, which is what the Atlas is for.
   */
  opacity: 1,
  /**
   * How far a shadow is extruded, in cells.
   *
   * Only needs to clear the viewport, since anything past the screen edge is not drawn. Generous
   * rather than exact, because the camera rotates into a claim and the corners swing out.
   */
  reach: 90,
  /** Extra cells of geometry gathered beyond the visible rect, so walls just off screen still cast. */
  margin: 6,
} as const;

export class ShadowLayer {
  readonly container = new Container();
  private readonly shadows = new Graphics();
  private readonly cap = new Graphics();
  /** Occluder count from the last rebuild, for the render diagnostics. */
  lastOccluders = 0;
  private eyeX = 0;
  private eyeY = 0;

  constructor(private readonly world: SolidityOracle) {
    this.container.addChild(this.shadows, this.cap);
  }

  /**
   * Close the dark in to a fixed distance regardless of what is in the way.
   *
   * Off by default -- at full reach the ring falls outside the viewport and nothing is drawn, which
   * is the point: ordinary sight has no radius. It exists so a Douser on the hull has something to
   * actually take. Drawn as one enormously thick circular stroke rather than a rectangle with a
   * hole in it, because a stroke is a single call and needs no even-odd winding to make the hole.
   */
  setLampCap(reach: number): void {
    this.cap.clear();
    if (reach >= SHADOW.reach) return;
    const inner = reach * CELL;
    const band = SHADOW.reach * CELL;
    this.cap
      .circle(this.eyeX * CELL, this.eyeY * CELL, inner + band / 2)
      .stroke({ width: band, color: 0x000000, alpha: 1 });
  }

  /**
   * Rebuild the shadows for this eye.
   *
   * Everything is redrawn each frame rather than cached. The geometry depends on where the drone is
   * standing, so it changes every time the drone moves at all -- and a cache keyed on a position
   * that changes continuously is not a cache.
   */
  update(eyeX: number, eyeY: number, focusX: number, focusY: number, halfWidth: number, halfHeight: number): void {
    this.eyeX = eyeX;
    this.eyeY = eyeY;
    const shadows = this.shadows;
    shadows.clear();
    const occluders = collectOccluders(
      this.world,
      focusX - halfWidth - SHADOW.margin,
      focusY - halfHeight - SHADOW.margin,
      focusX + halfWidth + SHADOW.margin,
      focusY + halfHeight + SHADOW.margin,
    );
    this.lastOccluders = occluders.length;

    // Filled one quad at a time rather than accumulated into a single path.
    //
    // The quads overlap constantly, so one fill would hand the triangulator a single enormous
    // self-intersecting path every frame; four points at a time is trivial instead. Not measured
    // as a win -- a headless run is software-rendered and pins at about 13fps whatever this file
    // does, so it cannot tell the two apart -- chosen because it is the one that is obviously
    // cheap. Only correct because the fill is opaque; overlapping translucent quads would
    // compound, see `SHADOW.opacity`.
    for (const occluder of occluders) {
      const quad = shadowQuad(occluder, eyeX, eyeY, SHADOW.reach);
      if (!quad) continue;
      const points: number[] = [];
      for (let index = 0; index < quad.length; index += 2) {
        points.push(quad[index] * CELL, quad[index + 1] * CELL);
      }
      shadows.poly(points).fill({ color: 0x000000, alpha: SHADOW.opacity });
    }
  }
}
