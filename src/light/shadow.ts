// Shadows, the way Teleglitch actually does them.
//
// Not a light radius and not a grid mask. The developer's own description is the specification:
// "the line of sight shadows aren't done with perspective. They are just black polygons extruded
// from the walls away from the player." So that is what this builds -- one quad per wall edge,
// extruded away from the eye until it is off screen, filled black.
//
// Two consequences worth being explicit about, because they are the whole feel:
//
//   * There is no distance limit. A corridor is visible all the way down it. What hides a thing is
//     never how far away it is, only what is standing between you and it. Being hidden from by
//     *shape* rather than by *distance* is the difference between peering round a corner and
//     carrying a lantern, and it is the reason this reads as Teleglitch and the old mask did not.
//   * There is no falloff. An edge is an edge.
//
// The eye is the drone alone, because Teleglitch has exactly one observer. Overlapping opaque
// shadow quads from a second caster would darken their intersection instead of lighting their
// union, so more than one eye needs a per-caster visibility pass rather than this -- a real cost,
// noted here because it is what the ball-as-a-moving-lamp idea would need.

import { WORLD_COLS, WORLD_ROWS } from "../config";
import type { SolidityOracle } from "../combat/ballField";

/**
 * One face of rock, with the direction of the open air in front of it.
 *
 * The normal is what makes back-face culling possible: an edge only casts when the eye is on its
 * open side. Without that, the far side of every wall would throw a shadow back across the room it
 * is already hiding.
 */
export interface Occluder {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Unit normal, pointing into the open cell. */
  nx: number;
  ny: number;
}

/** Off-map is rock, matching the ball solver, the hull and the old field. */
function solid(world: SolidityOracle, cellX: number, cellY: number): boolean {
  if (cellX < 0 || cellY < 0 || cellX >= WORLD_COLS || cellY >= WORLD_ROWS) return true;
  return world.solidAt(cellX + 0.5, cellY + 0.5);
}

/**
 * Every rock face bounding open air inside this rect, with collinear runs merged.
 *
 * The merge is not an optimisation detail, it is most of the cost: a twenty-cell wall is one quad
 * instead of twenty, and a screen of ordinary cave geometry drops from thousands of polygons to a
 * couple of hundred. Runs are broken when the open side flips, because those are two different
 * faces that happen to be in line.
 */
export function collectOccluders(
  world: SolidityOracle,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Occluder[] {
  const result: Occluder[] = [];
  const left = Math.max(-1, Math.floor(minX));
  const right = Math.min(WORLD_COLS, Math.ceil(maxX));
  const top = Math.max(-1, Math.floor(minY));
  const bottom = Math.min(WORLD_ROWS, Math.ceil(maxY));

  // Horizontal faces: the boundary between row y-1 and row y.
  for (let y = top; y <= bottom + 1; y++) {
    let runStart = -1;
    let runSide = 0;
    for (let x = left; x <= right + 1; x++) {
      const above = x <= right ? solid(world, x, y - 1) : true;
      const below = x <= right ? solid(world, x, y) : true;
      // +1 when the open air is below the face, -1 when it is above, 0 when this is not a face.
      const side = x > right || above === below ? 0 : above ? 1 : -1;
      if (side !== runSide) {
        if (runSide !== 0) {
          result.push({ x1: runStart, y1: y, x2: x, y2: y, nx: 0, ny: runSide });
        }
        runStart = x;
        runSide = side;
      }
    }
  }

  // Vertical faces: the boundary between column x-1 and column x.
  for (let x = left; x <= right + 1; x++) {
    let runStart = -1;
    let runSide = 0;
    for (let y = top; y <= bottom + 1; y++) {
      const before = y <= bottom ? solid(world, x - 1, y) : true;
      const after = y <= bottom ? solid(world, x, y) : true;
      const side = y > bottom || before === after ? 0 : before ? 1 : -1;
      if (side !== runSide) {
        if (runSide !== 0) {
          result.push({ x1: x, y1: runStart, x2: x, y2: y, nx: runSide, ny: 0 });
        }
        runStart = y;
        runSide = side;
      }
    }
  }
  return result;
}

/**
 * The shadow this face throws, as a quad, or null when it faces away from the eye.
 *
 * Points are returned as a flat `[x, y, ...]` ring in the order near-edge, far-edge-reversed, which
 * is a simple non-self-intersecting polygon whichever way the face is oriented.
 */
export function shadowQuad(
  occluder: Occluder,
  eyeX: number,
  eyeY: number,
  distance: number,
): number[] | null {
  const midX = (occluder.x1 + occluder.x2) / 2;
  const midY = (occluder.y1 + occluder.y2) / 2;
  // Back-face cull: only faces whose open side the eye is standing on can cast.
  if ((eyeX - midX) * occluder.nx + (eyeY - midY) * occluder.ny <= 0) return null;

  let dx1 = occluder.x1 - eyeX;
  let dy1 = occluder.y1 - eyeY;
  let dx2 = occluder.x2 - eyeX;
  let dy2 = occluder.y2 - eyeY;
  const length1 = Math.hypot(dx1, dy1);
  const length2 = Math.hypot(dx2, dy2);
  // An eye sitting exactly on a corner has no direction to extrude along. Refusing the quad is
  // right: standing in the surface means there is nothing behind it to hide.
  if (length1 < 1e-6 || length2 < 1e-6) return null;
  dx1 /= length1;
  dy1 /= length1;
  dx2 /= length2;
  dy2 /= length2;

  return [
    occluder.x1, occluder.y1,
    occluder.x2, occluder.y2,
    occluder.x2 + dx2 * distance, occluder.y2 + dy2 * distance,
    occluder.x1 + dx1 * distance, occluder.y1 + dy1 * distance,
  ];
}

/** Is this point in shadow from the eye? The same question `hasLineOfSight` answers, named for here. */
export { hasLineOfSight as visibleFrom } from "../combat/sight";
