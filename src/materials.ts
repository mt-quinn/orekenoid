// Material rules. This table is the single authority on how every kind of rock
// behaves: how much it takes to break, whether it counts as load when left
// standing, how it rebounds a ball, and whether it does anything afterwards.
//
// Gameplay code reads this table rather than branching on province, so a new
// material is a data addition and not a change to the solver.

import { PALETTE, type MaterialKind, type ProvinceId } from "./config";

export interface MaterialDefinition {
  kind: MaterialKind;
  name: string;
  hp: number;
  /** Liable material left alive at resolution becomes load, and load becomes damage. */
  liable: boolean;
  /** Persistent material is never broken and never exhausted by claim resolution. */
  persistent: boolean;
  /** `facet` reflects against a fixed diagonal plane, giving explicit right-angle turns. */
  reflect: "mirror" | "facet";
  /** Regrows into adjacent cleared cells, on a bounded deterministic budget. */
  regrows: boolean;
  /** Leaves a short-lived rebound membrane behind when destroyed. */
  spawnsMembrane: boolean;
  /** Destruction cascades into adjacent crystal. */
  chains: boolean;
  base: number;
  edge: number;
  province: ProvinceId | null;
}

const define = (
  kind: MaterialKind,
  name: string,
  hp: number,
  base: number,
  edge: number,
  province: ProvinceId | null,
  overrides: Partial<MaterialDefinition> = {},
): MaterialDefinition => ({
  kind,
  name,
  hp,
  liable: true,
  persistent: false,
  reflect: "mirror",
  regrows: false,
  spawnsMembrane: false,
  chains: false,
  base,
  edge,
  province,
  ...overrides,
});

export const MATERIALS: Record<MaterialKind, MaterialDefinition> = {
  // --- Surveyor's Karst -------------------------------------------------
  chalk: define("chalk", "Chalk", 1, 0x6b6152, PALETTE.karstEdge, "karst"),
  // Slate is the sharpest decision in the early game: four hits to break,
  // reflective, iron-rich -- and non-liable, so leaving it costs nothing.
  // The best wall and the best iron cannot both come from the same stone.
  slate: define("slate", "Slate", 4, PALETTE.slate, PALETTE.slateEdge, "karst", { liable: false }),
  coalSeam: define("coalSeam", "Coal Seam", 1, PALETTE.coal, 0x6e6a63, "karst"),

  // --- Mirrorreef -------------------------------------------------------
  reef: define("reef", "Reef Rock", 1, 0x4a5570, PALETTE.reefEdge, "mirrorreef"),
  facet: define("facet", "Crystal Facet", 2, PALETTE.facet, PALETTE.facetHot, "mirrorreef", { reflect: "facet" }),
  chargedFacet: define("chargedFacet", "Charged Facet", 2, 0x8fc0f0, PALETTE.facetHot, "mirrorreef", {
    reflect: "facet",
    chains: true,
  }),

  // --- Rootwarren -------------------------------------------------------
  sapwood: define("sapwood", "Sapwood", 1, 0x574d2c, PALETTE.rootEdge, "rootwarren"),
  living: define("living", "Living Block", 1, PALETTE.living, PALETTE.livingHot, "rootwarren", { regrows: true }),
  sporeBulb: define("sporeBulb", "Spore Bulb", 1, 0x8a7326, PALETTE.spore, "rootwarren", { spawnsMembrane: true }),
  heartwood: define("heartwood", "Heartwood", 3, 0x3d3722, 0xa89540, "rootwarren"),

  // --- Ecotone hybrids --------------------------------------------------
  // Reflective slate that also turns the ball: the best banking geometry there is.
  mirrorSlate: define("mirrorSlate", "Mirror Slate", 4, 0x44586b, PALETTE.brightFault, null, {
    liable: false,
    reflect: "facet",
  }),
  chalkroot: define("chalkroot", "Chalkroot", 2, 0x6f6844, PALETTE.chalkWarren, null, { regrows: true }),
  bloomcrystal: define("bloomcrystal", "Bloomcrystal", 2, 0x6a5a8a, PALETTE.bloomShelf, null, {
    reflect: "facet",
    regrows: true,
  }),

  // --- Structural -------------------------------------------------------
  lander: define("lander", "Lander", 1, 0x2b3335, PALETTE.machine, null, { liable: false, persistent: true }),
  mechanism: define("mechanism", "Mechanism", 1, 0x2f3a3c, PALETTE.rail, null, { liable: false, persistent: true }),
  stake: define("stake", "Survey Stake", 1, 0x4a4438, PALETTE.ink, null, { liable: false, persistent: true }),
};

export const materialOf = (kind: MaterialKind): MaterialDefinition => MATERIALS[kind];

/** Materials whose regrowth the Rootwarren rule drives. */
export const REGROWING_KINDS = (Object.keys(MATERIALS) as MaterialKind[]).filter((kind) => MATERIALS[kind].regrows);

/**
 * Facet reflection. A facet is a mirror set on one of the two diagonals, so an
 * axis-aligned approach leaves at a right angle. `axis` is +1 for the NE-SW
 * diagonal and -1 for NW-SE, and comes from the region's lattice orientation --
 * which is why aligning a claim to the lattice produces controllable cascades
 * and misaligning it produces chaos.
 */
export function facetNormal(axis: 1 | -1, incomingU: number, incomingV: number): { nx: number; ny: number } {
  const root = Math.SQRT1_2;
  // Both candidate normals of the diagonal plane; choose the opposing one.
  const nx = axis === 1 ? root : -root;
  const ny = root;
  const opposing = incomingU * nx + incomingV * ny > 0;
  return opposing ? { nx: -nx, ny: -ny } : { nx, ny };
}
