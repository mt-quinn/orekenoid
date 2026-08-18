// Seeing through the cell grid.
//
// One grid walk, two customers: creatures ask whether they can see the drone, and the lighting
// mask asks how far a ray gets before rock stops it. Both are the same question, so both are the
// same traversal -- an Amanatides & Woo march that visits every cell a ray actually crosses and no
// others, which is what makes hard-edged shadows land on cell boundaries rather than near them.

import { WORLD_COLS, WORLD_ROWS } from "../config";
import type { SolidityOracle } from "./ballField";

export interface RayHit {
  /** Distance travelled, in cells, before rock stopped the ray. */
  distance: number;
  /** The cell that stopped it, or null when the ray ran its full length through open air. */
  cellX: number | null;
  cellY: number | null;
}

/** Off-map counts as rock, matching the ball solver and the drone hull. */
function blocked(world: SolidityOracle, cellX: number, cellY: number): boolean {
  if (cellX < 0 || cellY < 0 || cellX >= WORLD_COLS || cellY >= WORLD_ROWS) return true;
  return world.solidAt(cellX + 0.5, cellY + 0.5);
}

/**
 * March a ray from a point until rock stops it or it runs out of length.
 *
 * The origin cell is deliberately not tested. A creature standing in a doorway, or a lamp carried
 * by a drone pressed against a wall, is inside a cell the grid may call solid at sub-cell scale --
 * testing it would blind them both from where they legitimately stand.
 */
export function castRay(
  world: SolidityOracle,
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  maxDistance: number,
): RayHit {
  const length = Math.hypot(dirX, dirY);
  if (length < 1e-9 || maxDistance <= 0) return { distance: 0, cellX: null, cellY: null };
  const dx = dirX / length;
  const dy = dirY / length;

  let cellX = Math.floor(originX);
  let cellY = Math.floor(originY);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  // Distance along the ray between successive grid lines on each axis, and to the first one.
  const deltaX = Math.abs(dx) < 1e-12 ? Infinity : Math.abs(1 / dx);
  const deltaY = Math.abs(dy) < 1e-12 ? Infinity : Math.abs(1 / dy);
  let nextX = deltaX === Infinity
    ? Infinity
    : (dx > 0 ? cellX + 1 - originX : originX - cellX) * deltaX;
  let nextY = deltaY === Infinity
    ? Infinity
    : (dy > 0 ? cellY + 1 - originY : originY - cellY) * deltaY;

  let travelled = 0;
  // Bounded by the diagonal of the world, so a ray parallel to an open corridor still terminates.
  for (let guard = 0; guard < WORLD_COLS + WORLD_ROWS + 4; guard++) {
    if (nextX < nextY) {
      travelled = nextX;
      cellX += stepX;
      nextX += deltaX;
    } else {
      travelled = nextY;
      cellY += stepY;
      nextY += deltaY;
    }
    if (travelled > maxDistance) return { distance: maxDistance, cellX: null, cellY: null };
    if (blocked(world, cellX, cellY)) return { distance: travelled, cellX, cellY };
  }
  return { distance: Math.min(travelled, maxDistance), cellX: null, cellY: null };
}

/** Is there unbroken open ground between these two points? */
export function hasLineOfSight(
  world: SolidityOracle,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-9) return true;
  // A hair short of the target, so standing against a wall does not blind a creature to the drone
  // pressed up on the near side of it.
  const hit = castRay(world, fromX, fromY, dx, dy, distance - 1e-4);
  return hit.cellX === null;
}
