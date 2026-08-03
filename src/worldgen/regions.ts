// Province, ecotone and depth-band fields.
//
// Provinces are not Voronoi cells. Each has a smooth affinity field built from
// logistic bands, and the winner is the argmax. That gives controllable extents
// matching PROGRESSION_AND_ECONOMY.md while leaving wide overlaps where two
// affinities are comparable -- which is exactly what an ecotone is.

import { logistic, warp } from "./rng";
import type { Band, EcotoneId, ProvinceId } from "../config";

export interface RegionSample {
  primary: ProvinceId;
  secondary: ProvinceId;
  /** 0 = pure primary, 1 = the two provinces are equally strong. */
  blend: number;
  ecotone: EcotoneId | null;
  band: Band;
  depthMetres: number;
}

export const PROVINCE_IDS: readonly ProvinceId[] = ["karst", "mirrorreef", "rootwarren"];

/** Threshold on `blend` above which a cell counts as ecotone rather than pure province. */
export const ECOTONE_BLEND = 0.62;

export function depthMetresAt(y: number): number {
  return Math.max(0, (y - 5) * 14);
}

export function bandAt(y: number): Band {
  if (y < 32) return 1;
  if (y < 68) return 2;
  if (y < 106) return 3;
  return 4;
}

export function bandDepthRange(band: Band): { from: number; to: number } {
  const edges: Record<Band, [number, number]> = { 1: [5, 32], 2: [32, 68], 3: [68, 106], 4: [106, 144] };
  const [from, to] = edges[band];
  return { from: depthMetresAt(from), to: depthMetresAt(to) };
}

function ecotoneFor(a: ProvinceId, b: ProvinceId): EcotoneId | null {
  const pair = [a, b].sort().join("|");
  if (pair === "karst|mirrorreef") return "brightFault";
  if (pair === "karst|rootwarren") return "chalkWarren";
  if (pair === "mirrorreef|rootwarren") return "bloomShelf";
  return null;
}

/**
 * Province affinities at a warped sample point.
 *
 * Karst holds the shallow west, Mirrorreef the east above the shelf, and
 * Rootwarren the whole floor of the world -- which is why the Chalk Warren
 * ecotone can reach west under Karst while pure Rootwarren stays east.
 */
function affinities(seed: number, x: number, y: number): Record<ProvinceId, number> {
  const warped = warp(seed + 4409, x, y, 9.5, 0.038);
  return {
    karst: logistic(96 - warped.x, 15) * logistic(96 - warped.y, 13),
    mirrorreef: logistic(warped.x - 96, 15) * logistic(88 - warped.y, 13),
    rootwarren: logistic(warped.y - 86, 11),
  };
}

export function sampleRegion(seed: number, x: number, y: number): RegionSample {
  const field = affinities(seed, x, y);
  let primary: ProvinceId = "karst";
  let secondary: ProvinceId = "mirrorreef";
  let best = -Infinity;
  let runnerUp = -Infinity;
  for (const id of PROVINCE_IDS) {
    const value = field[id];
    if (value > best) {
      runnerUp = best;
      secondary = primary;
      best = value;
      primary = id;
    } else if (value > runnerUp) {
      runnerUp = value;
      secondary = id;
    }
  }
  const blend = best > 1e-9 ? Math.max(0, Math.min(1, runnerUp / best)) : 0;
  const ecotone = blend >= ECOTONE_BLEND ? ecotoneFor(primary, secondary) : null;
  return { primary, secondary, blend, ecotone, band: bandAt(y), depthMetres: depthMetresAt(y) };
}

/**
 * The three dials from the design doc, as continuous fields.
 *
 * All three are monotonic in depth within a province -- generator contract item
 * 5 -- because each is a fixed per-province base plus a strictly increasing
 * function of the band index.
 */
export interface Dials {
  density: number;
  volatility: number;
  yield: number;
}

const PROVINCE_DIALS: Record<ProvinceId, Dials> = {
  karst: { density: 0.52, volatility: 0.16, yield: 0.15 },
  mirrorreef: { density: 0.56, volatility: 0.3, yield: 0.19 },
  rootwarren: { density: 0.62, volatility: 0.4, yield: 0.22 },
};

export function dialsFor(sample: RegionSample): Dials {
  const primary = PROVINCE_DIALS[sample.primary];
  const secondary = PROVINCE_DIALS[sample.secondary];
  const mix = sample.ecotone ? sample.blend * 0.5 : 0;
  const lerp = (a: number, b: number) => a + (b - a) * mix;
  const step = sample.band - 1;
  return {
    density: Math.min(0.94, lerp(primary.density, secondary.density) + step * 0.085),
    volatility: Math.min(0.92, lerp(primary.volatility, secondary.volatility) + step * 0.13),
    yield: Math.min(0.6, lerp(primary.yield, secondary.yield) + step * 0.055),
  };
}

export const PROVINCE_NAMES: Record<ProvinceId, string> = {
  karst: "SURVEYOR'S KARST",
  mirrorreef: "MIRRORREEF",
  rootwarren: "ROOTWARREN",
};

export const ECOTONE_NAMES: Record<EcotoneId, string> = {
  brightFault: "THE BRIGHT FAULT",
  chalkWarren: "THE CHALK WARREN",
  bloomShelf: "THE BLOOM SHELF",
};

export const BAND_NAMES: Record<Band, string> = {
  1: "SHALLOW",
  2: "MID",
  3: "DEEP",
  4: "ABYSSAL",
};
