// Turning a generated world into one pixel per cell.
//
// This is a development instrument, not part of the game. It exists because the numbers in
// the generation report say a world is correct and cannot say whether it is *good*: whether
// the provinces sit somewhere interesting, whether the rooms are spread or clumped, whether
// a band looks like a different depth or just more of the same. Those are all judgements
// about a picture, so the tool's job is to produce the picture.
//
// One cell is one pixel. Everything is drawn at 240x144 and then scaled with smoothing off,
// so what you see on screen is exactly the data and never an interpolation of it.

import {
  PALETTE, PROVINCE_PALETTE, RESOURCES, WORLD_COLS, WORLD_ROWS,
  type EcotoneId,
} from "../config";
import { MATERIALS } from "../materials";
import type { Cell } from "../types";
import { LANDING } from "../worldgen/landmarks";

/** What the base pixel means. Overlays are drawn on top in screen space. */
export type BaseLayer = "material" | "region" | "solidity" | "reach" | "components";

export const BASE_LAYERS: ReadonlyArray<{ id: BaseLayer; name: string; hint: string }> = [
  { id: "material", name: "Material", hint: "the rock itself, lit at open edges" },
  { id: "region", name: "Region", hint: "province and ecotone layout" },
  { id: "solidity", name: "Solidity", hint: "rock against air, nothing else" },
  { id: "reach", name: "Walkable from Landing", hint: "reachable without breaking anything" },
  { id: "components", name: "Connectivity", hint: "the cave network against orphaned pockets" },
];

const ECOTONE_COLOUR: Record<EcotoneId, number> = {
  brightFault: PALETTE.brightFault,
  chalkWarren: PALETTE.chalkWarren,
  bloomShelf: PALETTE.bloomShelf,
};

const channels = (colour: number): [number, number, number] =>
  [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff];

/** Linear blend between two packed colours. */
function mix(a: number, b: number, t: number): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const lerp = (from: number, to: number) => Math.round(from + (to - from) * t);
  return (lerp(ar, br) << 16) | (lerp(ag, bg) << 8) | lerp(ab, bb);
}

/**
 * Open cells reachable from the Landing without breaking any rock.
 *
 * Recomputed here rather than read from the generation report, and it was worth doing:
 * `report.reachableCells` says 20,474 of 20,490 while this says 262. The report is measured
 * inside `verify`, whose own corridor repair carves an escape route through the Landing's
 * teaching faces -- and the faces are then stamped back afterwards, so the number describes
 * a world that never ships. The Landing being sealed is almost certainly deliberate FTUE
 * design (the first lesson is to break the Chalk Face), but the *report* should not claim
 * otherwise. See the `components` layer for the property the contract actually wants.
 */
export function reachableFromLanding(cells: Cell[][]): Uint8Array {
  const seen = new Uint8Array(WORLD_COLS * WORLD_ROWS);
  if (cells[LANDING.y]?.[LANDING.x]?.solid !== false) return seen;
  const queue = [LANDING.y * WORLD_COLS + LANDING.x];
  seen[queue[0]] = 1;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const x = index % WORLD_COLS;
    const y = (index - x) / WORLD_COLS;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= WORLD_COLS || ny >= WORLD_ROWS) continue;
      const next = ny * WORLD_COLS + nx;
      if (seen[next] || cells[ny][nx].solid) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return seen;
}

/**
 * The largest connected body of open space, and everything cut off from it.
 *
 * This -- not reachability from the Landing -- is what "every cavern is reachable" should
 * mean. It does not care where the player starts, so the Landing's deliberate seal cannot
 * flatter it, and an orphaned pocket shows up wherever it is.
 */
export function largestComponent(cells: Cell[][]): { mask: Uint8Array; largest: number; open: number } {
  const seen = new Uint8Array(WORLD_COLS * WORLD_ROWS);
  const mask = new Uint8Array(WORLD_COLS * WORLD_ROWS);
  let best: number[] = [];
  let open = 0;
  for (let start = 0; start < seen.length; start++) {
    const sx = start % WORLD_COLS;
    const sy = (start - sx) / WORLD_COLS;
    if (cells[sy][sx].solid) continue;
    open++;
    if (seen[start]) continue;
    const body: number[] = [start];
    seen[start] = 1;
    for (let head = 0; head < body.length; head++) {
      const index = body[head];
      const x = index % WORLD_COLS;
      const y = (index - x) / WORLD_COLS;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_COLS || ny >= WORLD_ROWS) continue;
        const next = ny * WORLD_COLS + nx;
        if (seen[next] || cells[ny][nx].solid) continue;
        seen[next] = 1;
        body.push(next);
      }
    }
    if (body.length > best.length) best = body;
  }
  for (const index of best) mask[index] = 1;
  return { mask, largest: best.length, open };
}

/** True where a solid cell touches air, so the map can light its edges like the game does. */
function facesAir(cells: Cell[][], x: number, y: number): boolean {
  return cells[y - 1]?.[x]?.solid === false || cells[y + 1]?.[x]?.solid === false
    || cells[y]?.[x - 1]?.solid === false || cells[y]?.[x + 1]?.solid === false;
}

export interface RasterOptions {
  layer: BaseLayer;
  /** Tint solid cells that carry ore, which is the only way to see the economy's shape. */
  resources: boolean;
  /** Persistent material -- landers, mechanisms, stakes -- that a claim can never break. */
  persistent: boolean;
}

function colourFor(cells: Cell[][], x: number, y: number, reach: Uint8Array, options: RasterOptions): number {
  const cell = cells[y][x];

  if (options.layer === "solidity") {
    return cell.solid ? (cell.persistent ? PALETTE.machine : 0x5c6468) : PALETTE.void;
  }

  if (options.layer === "reach" || options.layer === "components") {
    if (cell.solid) return cell.persistent ? 0x2b3335 : 0x14181a;
    // Cut-off open space is the failure these layers exist to make obvious, so it gets the
    // one colour nothing else in the palette uses.
    return reach[y * WORLD_COLS + x] ? 0x4f9a72 : PALETTE.danger;
  }

  if (options.layer === "region") {
    const tint = cell.ecotone ? ECOTONE_COLOUR[cell.ecotone] : PROVINCE_PALETTE[cell.province].base;
    return cell.solid ? tint : mix(tint, PALETTE.void, 0.72);
  }

  // Material.
  if (!cell.solid) return PALETTE.void;
  if (options.persistent && cell.persistent) return PALETTE.rail;
  const definition = MATERIALS[cell.kind];
  let colour = facesAir(cells, x, y) ? mix(definition.base, definition.edge, 0.4) : definition.base;
  if (options.resources && cell.resource) colour = mix(colour, RESOURCES[cell.resource].colour, 0.7);
  return colour;
}

/** A bare RGBA buffer, so the rasteriser needs no DOM and can be tested in Node. */
export interface Raster {
  width: number;
  height: number;
  /** Explicitly backed by an `ArrayBuffer`, which is what `ImageData` will accept. */
  pixels: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Paint the whole world, one pixel per cell.
 *
 * Returns a plain buffer rather than an `ImageData` for the same reason the room library is
 * compiled to TypeScript: the interesting logic stays testable in Node without a DOM. The
 * caller wraps it. The on-screen view and the exported PNG both go through here, so the file
 * is never a different picture from the one that was inspected.
 */
export function rasterizeWorld(cells: Cell[][], options: RasterOptions): Raster {
  const pixels = new Uint8ClampedArray(new ArrayBuffer(WORLD_COLS * WORLD_ROWS * 4));
  const reach = options.layer === "reach" ? reachableFromLanding(cells)
    : options.layer === "components" ? largestComponent(cells).mask
    : new Uint8Array(0);
  for (let y = 0; y < WORLD_ROWS; y++) {
    for (let x = 0; x < WORLD_COLS; x++) {
      const [r, g, b] = channels(colourFor(cells, x, y, reach, options));
      const at = (y * WORLD_COLS + x) * 4;
      pixels[at] = r;
      pixels[at + 1] = g;
      pixels[at + 2] = b;
      pixels[at + 3] = 255;
    }
  }
  return { width: WORLD_COLS, height: WORLD_ROWS, pixels };
}

export const hex = (colour: number): string => `#${colour.toString(16).padStart(6, "0")}`;
