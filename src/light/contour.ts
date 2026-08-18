// The silhouette the player can actually see.
//
// Shadows used to be cast from `solidAt` -- exact per cell, axis-aligned -- while the terrain is
// drawn from `visualSolidAt`, a bilinear reconstruction of the same grid plus coherent noise. Those
// two disagree over a band with a median width of half a cell and a ninth decile of 1.2, which at
// forty-two pixels a cell is a twenty to fifty pixel error. On screen that was a staircase of square
// steps running alongside a curved rock face, casting from an outline nothing had drawn.
//
// A shadow whose edge disagrees with the thing casting it is not a shadow. So this traces the drawn
// boundary instead: marching squares over the *signed* visual field, with each crossing placed by
// interpolating the field across the sub-cell edge, which gives segments at whatever angle the rock
// actually has rather than at multiples of ninety degrees.
//
// Excavation is handled separately and exactly. Cuts are oriented rectangles with machined edges,
// crisp in the render by design -- geology is weathered, excavation is not, and the player is meant
// to be able to tell them apart. Sampling a straight line to rediscover it would blunt the one edge
// in the world that is supposed to be sharp, so cut edges come from their own geometry.

import type { OrientedFootprint } from "../types";
import type { Occluder } from "./shadow";

export const CONTOUR = {
  /**
   * Samples per cell along each axis.
   *
   * Three is the measured knee: sampling the field over a viewport and margin costs about 1.8ms at
   * this rate against a 16.7ms frame, and the contour is cached besides -- it only changes when the
   * terrain does, never when the drone moves. Four costs nearly twice as much for a curve the
   * interpolation is already placing to well under a pixel.
   */
  samplesPerCell: 3,
  /** How far off a face to sample when deciding which side the open air is on. */
  normalProbe: 0.08,
  /**
   * How far, in cells, a simplified face may sit from the traced curve.
   *
   * Marching squares emits one segment per sub-cell square it crosses, and on a smooth rock face
   * most of them are very nearly collinear: about eleven hundred faces across a viewport, where the
   * cell grid it replaced produced a little over two hundred.
   *
   * Measured across four locations, simplification trades count against fidelity like this --
   * 0.8px: 463 faces, 2.1px: 299, 3.4px: 212, 5.0px: 161. Two pixels is the pick. It lands the same
   * face count the cell grid did while sitting two pixels from the drawn curve instead of the twenty
   * to fifty that grid was out by, so the fidelity is an order of magnitude better for the same
   * work.
   */
  simplifyTolerance: 0.05,
} as const;

/** Anything that can report the signed visual field and whether a point is drawn as rock. */
export interface VisualField {
  visualFieldAt(x: number, y: number): number;
  visualSolidAt(x: number, y: number): boolean;
  cutsInRegion(minX: number, minY: number, maxX: number, maxY: number): OrientedFootprint[];
}

/** Where a segment's crossing sits along a sub-cell edge, by linear interpolation of the field. */
function crossing(a: number, b: number): number {
  const span = a - b;
  // Both samples on the same side is not a crossing; guarded because a flat zero field would divide
  // by nothing and place the point at infinity.
  if (Math.abs(span) < 1e-9) return 0.5;
  return Math.max(0, Math.min(1, a / span));
}

/**
 * Give a geology face its outward normal by asking which side the air is on.
 *
 * Geology only. The field this samples does not include excavation, so it cannot orient the edge of
 * a cut -- see `cutEdges`, which knows the answer without asking.
 *
 * Derived by sampling rather than from winding order. Marching squares can be made to emit
 * consistently wound segments, but only by being careful in sixteen places instead of one, and the
 * saddle cases are exactly where that care tends to go missing.
 */
function orient(world: VisualField, occluder: Occluder): Occluder {
  const midX = (occluder.x1 + occluder.x2) / 2;
  const midY = (occluder.y1 + occluder.y2) / 2;
  let nx = -(occluder.y2 - occluder.y1);
  let ny = occluder.x2 - occluder.x1;
  const length = Math.hypot(nx, ny) || 1;
  nx /= length;
  ny /= length;
  if (world.visualFieldAt(midX + nx * CONTOUR.normalProbe, midY + ny * CONTOUR.normalProbe) > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { ...occluder, nx, ny };
}

/**
 * Trace the drawn rock boundary across a region.
 *
 * Segments come out unordered and unchained, which is all the extruder needs -- it treats each face
 * independently and the shadows overlap harmlessly.
 */
export function traceVisualContour(
  world: VisualField,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Occluder[] {
  const result: Occluder[] = [];
  const step = 1 / CONTOUR.samplesPerCell;
  const columns = Math.ceil((maxX - minX) / step) + 1;
  const rows = Math.ceil((maxY - minY) / step) + 1;
  if (columns < 2 || rows < 2) return result;

  // Two rows of samples at a time. The field is the expensive part, so every sample is taken once
  // and used by both squares that share it.
  let top = new Float32Array(columns);
  let bottom = new Float32Array(columns);
  for (let column = 0; column < columns; column++) {
    top[column] = world.visualFieldAt(minX + column * step, minY);
  }

  for (let row = 1; row < rows; row++) {
    const y0 = minY + (row - 1) * step;
    const y1 = minY + row * step;
    for (let column = 0; column < columns; column++) {
      bottom[column] = world.visualFieldAt(minX + column * step, y1);
    }

    for (let column = 1; column < columns; column++) {
      const x0 = minX + (column - 1) * step;
      const x1 = minX + column * step;
      const v00 = top[column - 1];
      const v10 = top[column];
      const v11 = bottom[column];
      const v01 = bottom[column - 1];

      // Which of the four edges the boundary crosses. Zero, two or four of them, always.
      const points: Array<{ x: number; y: number }> = [];
      if (v00 > 0 !== v10 > 0) points.push({ x: x0 + crossing(v00, v10) * step, y: y0 });
      if (v10 > 0 !== v11 > 0) points.push({ x: x1, y: y0 + crossing(v10, v11) * step });
      if (v01 > 0 !== v11 > 0) points.push({ x: x0 + crossing(v01, v11) * step, y: y1 });
      if (v00 > 0 !== v01 > 0) points.push({ x: x0, y: y0 + crossing(v00, v01) * step });

      if (points.length === 2) {
        result.push({ x1: points[0].x, y1: points[0].y, x2: points[1].x, y2: points[1].y, nx: 0, ny: 0 });
      } else if (points.length === 4) {
        // A saddle: two opposite corners solid, two open, and two ways to join the crossings. The
        // sign of the average decides which -- joining them the other way punches a hole through
        // rock that is really connected, and light leaks diagonally through solid ground.
        const average = (v00 + v10 + v11 + v01) / 4;
        const pairs = average > 0 ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]];
        for (const [a, b] of pairs) {
          result.push({ x1: points[a].x, y1: points[a].y, x2: points[b].x, y2: points[b].y, nx: 0, ny: 0 });
        }
      }
    }
    const swap = top;
    top = bottom;
    bottom = swap;
  }

  // Chained into polylines and simplified before anything is oriented, so the tolerance is applied
  // to the curve as a whole rather than to each sub-cell fragment in isolation.
  const geology = simplifyChains(result)
    .map((occluder) => orient(world, occluder))
    .filter((occluder) => insideRock(world, occluder));

  return [...geology, ...cutEdges(world, minX, minY, maxX, maxY)];
}

/** Endpoints are computed from identical field samples on shared edges, so they match exactly. */
const pointKey = (x: number, y: number) => `${Math.round(x * 4096)},${Math.round(y * 4096)}`;

/**
 * Join the fragments into runs, then drop the points that were only describing a straight line.
 *
 * Marching squares emits each segment independently, but neighbouring squares share their crossing
 * points exactly -- both compute it from the same pair of field samples -- so the fragments chain
 * without any tolerance on the join.
 */
function simplifyChains(segments: readonly Occluder[]): Occluder[] {
  const ends = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    for (const key of [pointKey(segment.x1, segment.y1), pointKey(segment.x2, segment.y2)]) {
      const bucket = ends.get(key);
      if (bucket) bucket.push(index);
      else ends.set(key, [index]);
    }
  });

  const used = new Array<boolean>(segments.length).fill(false);
  const result: Occluder[] = [];

  const walk = (start: number): Array<{ x: number; y: number }> => {
    used[start] = true;
    const chain = [
      { x: segments[start].x1, y: segments[start].y1 },
      { x: segments[start].x2, y: segments[start].y2 },
    ];
    // Extend from the tail, then from the head, so an open run is captured whole whichever fragment
    // the walk happened to begin at.
    for (const forward of [true, false]) {
      for (;;) {
        const tip = forward ? chain[chain.length - 1] : chain[0];
        const candidates = ends.get(pointKey(tip.x, tip.y)) ?? [];
        const next = candidates.find((index) => !used[index]);
        if (next === undefined) break;
        used[next] = true;
        const segment = segments[next];
        const sameAsTip = pointKey(segment.x1, segment.y1) === pointKey(tip.x, tip.y);
        const far = sameAsTip ? { x: segment.x2, y: segment.y2 } : { x: segment.x1, y: segment.y1 };
        if (forward) chain.push(far);
        else chain.unshift(far);
      }
    }
    return chain;
  };

  for (let index = 0; index < segments.length; index++) {
    if (used[index]) continue;
    const simplified = simplifyRun(walk(index));
    for (let step = 1; step < simplified.length; step++) {
      const a = simplified[step - 1];
      const b = simplified[step];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) continue;
      result.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, nx: 0, ny: 0 });
    }
  }
  return result;
}

/**
 * Simplify one run, splitting it first if it closes on itself.
 *
 * A closed loop -- an isolated pillar, which the mine is full of -- has its first and last point in
 * the same place, so Douglas-Peucker measures every deviation against a zero-length baseline, finds
 * none, and discards the entire loop. Left unsplit, every free-standing piece of rock in the world
 * silently cast no shadow whatsoever. Cutting the loop at its most distant point gives two open runs
 * with real baselines.
 */
function simplifyRun(chain: ReadonlyArray<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const closed = chain.length > 3
    && pointKey(chain[0].x, chain[0].y) === pointKey(chain[chain.length - 1].x, chain[chain.length - 1].y);
  if (!closed) return douglasPeucker(chain, CONTOUR.simplifyTolerance);

  let split = 1;
  let farthest = -1;
  for (let index = 1; index < chain.length - 1; index++) {
    const distance = Math.hypot(chain[index].x - chain[0].x, chain[index].y - chain[0].y);
    if (distance > farthest) {
      farthest = distance;
      split = index;
    }
  }
  const first = douglasPeucker(chain.slice(0, split + 1), CONTOUR.simplifyTolerance);
  const second = douglasPeucker(chain.slice(split), CONTOUR.simplifyTolerance);
  return [...first, ...second.slice(1)];
}

/** Iterative Douglas-Peucker. Recursion would be fine but a long cave wall is a deep chain. */
function douglasPeucker(
  points: ReadonlyArray<{ x: number; y: number }>,
  tolerance: number,
): Array<{ x: number; y: number }> {
  if (points.length < 3) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;
    const ax = points[first].x;
    const ay = points[first].y;
    const bx = points[last].x;
    const by = points[last].y;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy) || 1e-9;
    let worst = -1;
    let worstIndex = first;
    for (let index = first + 1; index < last; index++) {
      const distance = Math.abs(
        (points[index].x - ax) * dy - (points[index].y - ay) * dx,
      ) / length;
      if (distance > worst) {
        worst = distance;
        worstIndex = index;
      }
    }
    if (worst > tolerance) {
      keep[worstIndex] = true;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/**
 * Does this face still have rock behind it?
 *
 * The field is geology alone, so a contour traced through ground the player has excavated is a face
 * with nothing left to cast. Tested against `visualSolidAt`, which knows about cuts.
 */
function insideRock(world: VisualField, occluder: Occluder): boolean {
  const midX = (occluder.x1 + occluder.x2) / 2;
  const midY = (occluder.y1 + occluder.y2) / 2;
  return world.visualSolidAt(midX - occluder.nx * CONTOUR.normalProbe, midY - occluder.ny * CONTOUR.normalProbe);
}

/**
 * The exact edges of every cut in the region, kept as straight lines.
 *
 * A cut is a hole, so its faces look inward: the air is inside the rectangle and the rock is
 * outside. Only edges with rock still standing beyond them are kept, so a cut opening into an
 * existing cavern does not cast a shadow off a wall that is not there.
 *
 * Cut footprints are at most about a cell across -- claim resolution emits one per lattice cell
 * rather than one per frame -- so owning a cut by its centre never orphans an edge far from it.
 */
function cutEdges(world: VisualField, minX: number, minY: number, maxX: number, maxY: number): Occluder[] {
  const result: Occluder[] = [];
  for (const cut of world.cutsInRegion(minX, minY, maxX, maxY)) {
    // Emitted only by the region containing the cut's centre. Callers trace chunk by chunk, and a
    // footprint straddling a seam overlaps both -- without this it would contribute its edges twice
    // and every claim boundary would carry a doubled set of faces.
    if (cut.center.x < minX || cut.center.x >= maxX || cut.center.y < minY || cut.center.y >= maxY) continue;
    const cosine = Math.cos(cut.angle);
    const sine = Math.sin(cut.angle);
    const corners = [
      { u: -cut.halfWidth, v: -cut.halfHeight },
      { u: cut.halfWidth, v: -cut.halfHeight },
      { u: cut.halfWidth, v: cut.halfHeight },
      { u: -cut.halfWidth, v: cut.halfHeight },
    ].map(({ u, v }) => ({
      x: cut.center.x + u * cosine - v * sine,
      y: cut.center.y + u * sine + v * cosine,
    }));
    for (let index = 0; index < 4; index++) {
      const a = corners[index];
      const b = corners[(index + 1) % 4];
      // Oriented toward the cut's own centre rather than by sampling. `orient` reads the geology
      // field, which is still solid inside a cut -- the rock was removed by the footprint, not by
      // the geology -- so sampling cannot tell which side of a machined face the air is on and
      // picks one arbitrarily. For a rectangle the answer needs no sampling: the air is inside it.
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      let nx = cut.center.x - midX;
      let ny = cut.center.y - midY;
      const length = Math.hypot(nx, ny) || 1;
      const face: Occluder = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, nx: nx / length, ny: ny / length };
      if (insideRock(world, face)) result.push(face);
    }
  }
  return result;
}
