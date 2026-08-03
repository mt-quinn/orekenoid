// Deterministic seeded randomness and coherent noise for world generation.
// Every function here is pure and depends only on its seed and coordinates, so a
// given seed always produces byte-identical geology.

export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly source: () => number;

  constructor(seed: number | string) {
    this.source = mulberry32(typeof seed === "string" ? hashString(seed) : seed >>> 0);
  }

  float(): number {
    return this.source();
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.source();
  }

  int(min: number, maxInclusive: number): number {
    return Math.min(maxInclusive, min + Math.floor(this.source() * (maxInclusive - min + 1)));
  }

  chance(probability: number): boolean {
    return this.source() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.source() * items.length))];
  }

  /** Fisher-Yates, in place, deterministic for a given stream position. */
  shuffle<T>(items: T[]): T[] {
    for (let index = items.length - 1; index > 0; index--) {
      const swap = Math.floor(this.source() * (index + 1));
      const held = items[index];
      items[index] = items[swap];
      items[swap] = held;
    }
    return items;
  }
}

function hashLattice(seed: number, x: number, y: number): number {
  let value = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b)
    ^ Math.imul((y | 0) ^ 0xc2b2ae35, 0x27d4eb2d)
    ^ Math.imul(seed | 0, 0x165667b1);
  value ^= value >>> 15;
  value = Math.imul(value, 0x2545f491);
  value ^= value >>> 13;
  return (value >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in 0..1. */
export function valueNoise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hashLattice(seed, ix, iy);
  const b = hashLattice(seed, ix + 1, iy);
  const c = hashLattice(seed, ix, iy + 1);
  const d = hashLattice(seed, ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Fractal value noise in 0..1, normalized across octaves. */
export function fbm(seed: number, x: number, y: number, octaves = 4, lacunarity = 2.03, gain = 0.5): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += valueNoise(seed + octave * 1013, x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / (total || 1);
}

/** Signed fractal noise in -1..1. */
export function sfbm(seed: number, x: number, y: number, octaves = 4): number {
  return fbm(seed, x, y, octaves) * 2 - 1;
}

/**
 * Domain warp. Displaces a sample point by coherent noise so downstream fields
 * acquire organic, non-axis-aligned boundaries instead of readable straight lines.
 */
export function warp(seed: number, x: number, y: number, strength: number, scale = 0.045): { x: number; y: number } {
  return {
    x: x + sfbm(seed + 7717, x * scale, y * scale, 3) * strength,
    y: y + sfbm(seed + 3313, x * scale + 4.7, y * scale - 2.3, 3) * strength,
  };
}

/** Logistic band: ~0 far below zero, ~1 far above, smooth across `softness`. */
export function logistic(distance: number, softness: number): number {
  return 1 / (1 + Math.exp(-distance / Math.max(1e-6, softness)));
}

/**
 * Ridged directional field, used for strata and seams. Returns 0..1 peaking on
 * evenly spaced lines running perpendicular to `angle`.
 */
export function strata(seed: number, x: number, y: number, angle: number, spacing: number, wobble = 1.4): number {
  const across = x * Math.sin(angle) - y * Math.cos(angle);
  const drift = sfbm(seed, x * 0.05, y * 0.05, 3) * wobble;
  const phase = (across + drift) / Math.max(0.001, spacing);
  return 1 - Math.abs((phase - Math.floor(phase)) * 2 - 1);
}
