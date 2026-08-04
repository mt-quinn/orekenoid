export const VIEW_WIDTH = 1280;
export const VIEW_HEIGHT = 720;
export const CELL = 42;

// The world is now a generated region rather than an authored fixture.
// 240 x 144 cells at 14 m per cell of depth runs 0 m to 1946 m.
export const WORLD_COLS = 240;
export const WORLD_ROWS = 144;

/** Terrain is rasterized in square chunks so the world never needs one oversized canvas. */
export const CHUNK_CELLS = 24;
export const TERRAIN_SCALE = 0.82;
/** Chunks within this many cells of the camera focus stay resident. */
export const CHUNK_RESIDENCY_CELLS = 46;

/**
 * The drone's hull, in pixels, measured off the silhouette drawn in
 * `view/actors.ts` rather than invented.
 *
 * `createDrone` draws its body as a polygon spanning `paddleWidth * CELL + 26`
 * across and 20 tall, so the hull is that box: the nose overhang is the 13px the
 * silhouette extends past the paddle face on each side, and the half-thickness is
 * half of the 20px body. The survey mast is deliberately excluded -- it is a thin
 * antenna, and treating it as hull would make the machine unable to pass anything.
 */
export const DRONE_NOSE_PX = 13;
export const DRONE_HALF_THICKNESS_PX = 10;

export const PHYSICS_STEP = 1 / 120;
export const BRICK_HALF = 0.42;
export const BRICK_RADIUS = 0.14;
export const BALL_RADIUS = 0.255;
export const BALL_SPEED = 9.35;

/**
 * Seed for the default world.
 *
 * This is an opaque token, not a name: its exact characters are hashed to produce
 * the geology, so changing the string rerolls the entire world. It kept its
 * original value through the rename to Orekenoid deliberately, so the map does
 * not silently change underneath anyone playtesting it.
 */
export const DEFAULT_SEED = "bounceworld-01";

/**
 * Balls per claim before any cornerstone verb.
 *
 * One is punishing enough that a single early misread ends a claim outright,
 * which reads as arbitrary rather than as a decision. Two gives the player a
 * recovery attempt while leaving the Twin Engine's third ball a real change.
 */
export const BASE_ARENA_BALLS = 2;

export type ProvinceId = "karst" | "mirrorreef" | "rootwarren";
export type EcotoneId = "brightFault" | "chalkWarren" | "bloomShelf";
export type Band = 1 | 2 | 3 | 4;

/**
 * Material kinds. Province palettes plus the three ecotone hybrids plus
 * structural cells that claim resolution must never exhaust.
 */
export type MaterialKind =
  // Surveyor's Karst
  | "chalk"
  | "slate"
  | "coalSeam"
  // Mirrorreef
  | "reef"
  | "facet"
  | "chargedFacet"
  // Rootwarren
  | "sapwood"
  | "living"
  | "sporeBulb"
  | "heartwood"
  // Ecotone hybrids
  | "mirrorSlate"
  | "chalkroot"
  | "bloomcrystal"
  // Structural, persistent
  | "lander"
  | "mechanism"
  | "stake";

/** Mined materials. Metals are depth-banded; reagents are province-locked. */
export type ResourceId =
  | "copper"
  | "iron"
  | "cobalt"
  | "mithril"
  | "adamantite"
  | "runite"
  | "coal"
  | "sapphire"
  | "emerald"
  | "ruby"
  | "diamond"
  | "sulfur"
  | "saltpeter"
  | "vitriol";

export type ResourceFamily = "metal" | "fuel" | "gem" | "reagent";

export interface ResourceDefinition {
  id: ResourceId;
  name: string;
  family: ResourceFamily;
  colour: number;
  /** Governs durability, precision, fuel or fabrication -- see the doc's second law. */
  governs: string;
}

export const RESOURCES: Record<ResourceId, ResourceDefinition> = {
  copper: { id: "copper", name: "Copper", family: "metal", colour: 0xc87f4a, governs: "durability" },
  iron: { id: "iron", name: "Iron", family: "metal", colour: 0xa8a29b, governs: "durability" },
  cobalt: { id: "cobalt", name: "Cobalt", family: "metal", colour: 0x4f7ac4, governs: "durability" },
  mithril: { id: "mithril", name: "Mithril", family: "metal", colour: 0x7fc8d8, governs: "durability" },
  adamantite: { id: "adamantite", name: "Adamantite", family: "metal", colour: 0x4faa78, governs: "durability" },
  runite: { id: "runite", name: "Runite", family: "metal", colour: 0x3fc0b0, governs: "durability" },
  coal: { id: "coal", name: "Coal", family: "fuel", colour: 0x3a3a3d, governs: "fuel" },
  sapphire: { id: "sapphire", name: "Sapphire", family: "gem", colour: 0x3f6fe0, governs: "precision" },
  emerald: { id: "emerald", name: "Emerald", family: "gem", colour: 0x35b464, governs: "precision" },
  ruby: { id: "ruby", name: "Ruby", family: "gem", colour: 0xd8354f, governs: "precision" },
  diamond: { id: "diamond", name: "Diamond", family: "gem", colour: 0xbfeaf5, governs: "precision" },
  sulfur: { id: "sulfur", name: "Sulfur", family: "reagent", colour: 0xd8c23f, governs: "gunpowder" },
  saltpeter: { id: "saltpeter", name: "Saltpeter", family: "reagent", colour: 0xe0dcc8, governs: "gunpowder" },
  vitriol: { id: "vitriol", name: "Vitriol", family: "reagent", colour: 0x8f5fc0, governs: "fabrication" },
};

export interface PaddleChassis {
  id: string;
  name: string;
  frame: { width: number; depth: number; shape: "rectangle" };
  paddleWidth: number;
  paddleSpeed: number;
  travelSpeed: number;
  rotationSpeed: number;
  soak: number;
  maxHealth: number;
  /** Starters are available at deployment; fabricated chassis must be built. */
  fabricated?: boolean;
}

export const STARTER_CHASSIS: PaddleChassis = {
  id: "bx04-surveyor",
  name: "SURVEYOR",
  frame: { width: 11, depth: 11, shape: "rectangle" },
  paddleWidth: 3.1,
  paddleSpeed: 11.6,
  travelSpeed: 250,
  rotationSpeed: 1.75,
  soak: 18,
  maxHealth: 40,
};

export const PADDLE_CHASSIS: readonly PaddleChassis[] = [
  {
    id: "needle-prospector",
    name: "NEEDLE",
    frame: { width: 7, depth: 15, shape: "rectangle" },
    paddleWidth: 2.35,
    paddleSpeed: 14.4,
    travelSpeed: 285,
    rotationSpeed: 2.15,
    soak: 12,
    maxHealth: 30,
  },
  STARTER_CHASSIS,
  {
    id: "bastion-extractor",
    name: "BASTION",
    frame: { width: 15, depth: 9, shape: "rectangle" },
    paddleWidth: 4.8,
    paddleSpeed: 8.6,
    travelSpeed: 205,
    rotationSpeed: 1.25,
    soak: 28,
    maxHealth: 60,
  },
] as const;

/** Tier 3 fabrication targets. Each is gated on one ecotone's rare reagent. */
export const FABRICATED_CHASSIS: readonly PaddleChassis[] = [
  {
    id: "lantern",
    name: "LANTERN",
    frame: { width: 9, depth: 19, shape: "rectangle" },
    paddleWidth: 2.6,
    paddleSpeed: 15.8,
    travelSpeed: 275,
    rotationSpeed: 1.95,
    soak: 20,
    maxHealth: 44,
    fabricated: true,
  },
  {
    id: "weir",
    name: "WEIR",
    frame: { width: 19, depth: 9, shape: "rectangle" },
    paddleWidth: 5.6,
    paddleSpeed: 8.2,
    travelSpeed: 195,
    rotationSpeed: 1.1,
    soak: 44,
    maxHealth: 78,
    fabricated: true,
  },
  {
    id: "prismatic",
    name: "PRISMATIC",
    frame: { width: 13, depth: 13, shape: "rectangle" },
    paddleWidth: 3.6,
    paddleSpeed: 12.8,
    travelSpeed: 245,
    rotationSpeed: 2.6,
    soak: 30,
    maxHealth: 56,
    fabricated: true,
  },
] as const;

export const PALETTE = {
  void: 0x070a0b,
  ink: 0xf1eadb,
  machine: 0x9a927d,
  rail: 0xe7dbc0,
  exhaust: 0x252927,
  danger: 0xff655b,
  // Surveyor's Karst -- pale limestone, dark reflective slate
  karst: 0x5a5346,
  karstEdge: 0xc3b394,
  slate: 0x39424a,
  slateEdge: 0x9fc0d4,
  coal: 0x24262a,
  // Mirrorreef -- cold crystal. Reef is pushed dark so crystal reads as a bright
  // lattice against it rather than dissolving into the same blue.
  reef: 0x2f3850,
  reefEdge: 0x7ba2cf,
  facet: 0x7fb2e8,
  facetHot: 0xdcefff,
  // Rootwarren -- warm living growth
  root: 0x4a4327,
  rootEdge: 0xc0b055,
  living: 0x6d7a33,
  livingHot: 0xd4e878,
  spore: 0xe8c04f,
  // Ecotones
  brightFault: 0xb9d2e8,
  chalkWarren: 0xd8cf9a,
  bloomShelf: 0xb08fd8,
} as const;

export const PROVINCE_PALETTE: Record<ProvinceId, { base: number; edge: number; accent: number }> = {
  karst: { base: PALETTE.karst, edge: PALETTE.karstEdge, accent: PALETTE.slateEdge },
  mirrorreef: { base: PALETTE.reef, edge: PALETTE.reefEdge, accent: PALETTE.facetHot },
  rootwarren: { base: PALETTE.root, edge: PALETTE.rootEdge, accent: PALETTE.livingHot },
};
