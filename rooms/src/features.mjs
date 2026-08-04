// Feature-tier rooms: the small found things.
//
// Features are ~59% of all placements and were the worst-starved tier in the library, which
// matters more than it sounds: features are what the player meets constantly, so they set
// the texture of the whole mine. A hall is a landmark you see three times a session; a
// feature is what "the world" feels like.
//
// Terraria's `CampsiteBiome` is the reference — radius 6-10 tiles, about a sixth of a
// screen, one idea, two or three things in it. Nothing here tries to be a place. Each is a
// single sentence: an overhang, a pocket, a vent, a collapse.
//
// The `any-` rooms are built from `#` host rock and `?` random slots, so one authored shape
// serves all three provinces *and* all three ecotones, taking its material and its contents
// from wherever it lands. That is the cheapest variety in the pipeline.

import { Canvas } from "../../tools/canvas.mjs";

// --- Surveyor's Karst --------------------------------------------------------

/** A slate overhang with a seam sheltering under it: the province rule in miniature. */
function slateShelf() {
  const room = new Canvas(11, 8, "-");
  room.ellipse(5, 4, 5.4, 4, ".");
  room.rect(1, 7, 9, 7, "c");
  // The shelf. Non-liable, so a claim framing it can keep the whole thing standing.
  room.rect(2, 3, 8, 3, "s");
  room.set(8, 4, "s");
  // The seam is under the shelf, so the shelf is both the clue and the obstacle.
  room.rect(3, 5, 4, 5, "c");
  room.set(4, 5, "3");
  room.set(2, 1, "?");
  return room;
}

/** A coal nodule in chalk. Cheap, plentiful, and the province's fuel. */
function coalPocket() {
  const room = new Canvas(10, 8, "-");
  room.ellipse(4.5, 4, 4.8, 3.9, ".");
  room.rect(1, 7, 8, 7, "c");
  // A rounded nodule rather than a seam: coal here is a lump you find, not a vein you follow.
  room.ellipse(4.5, 5.4, 2.2, 1.1, "k");
  room.ellipse(4.5, 5.4, 1, 0.5, "c");
  room.set(7, 2, "?");
  room.set(2, 4, "*");
  return room;
}

// --- Mirrorreef --------------------------------------------------------------

/** A short coherent facet vein, with its payoff at the far end of the reflection. */
function facetVein() {
  const room = new Canvas(11, 8, "-");
  room.ellipse(5, 4, 5.4, 4, ".");
  room.rect(1, 7, 9, 7, "r");
  // One axis only, so the vein is a readable plane rather than scattered crystal.
  room.band(2, 5, 8, 2, 1, "/");
  room.rect(8, 2, 9, 3, "r");
  room.set(9, 3, "3");
  room.set(3, 2, "?");
  return room;
}

/**
 * A charge node: one charged facet ringed by plain crystal. The smallest possible cascade,
 * and the cheapest place in the world to learn what a cascade does.
 */
function chargeNode() {
  const room = new Canvas(9, 9, "-");
  room.ellipse(4, 4, 4.2, 4.2, ".");
  room.rect(1, 7, 7, 8, "r");
  // A ring of plain facets on one axis, so the cascade has somewhere coherent to run.
  for (const [x, y] of [[3, 3], [4, 3], [5, 3], [3, 5], [4, 5], [5, 5], [3, 4], [5, 4]]) {
    room.set(x, y, "\\");
  }
  room.set(4, 4, "&");
  room.set(7, 2, "?");
  return room;
}

// --- Rootwarren --------------------------------------------------------------

/** A bulb cluster in a pocket: break them in the right order and the membranes stack. */
function bulbCluster() {
  const room = new Canvas(10, 8, "-");
  room.ellipse(4.5, 4, 4.6, 3.8, ".");
  room.rect(1, 6, 8, 7, "w");
  // Three bulbs on a sapwood spur, close enough that their membranes overlap.
  room.rect(3, 2, 6, 2, "w");
  room.set(3, 3, "b");
  room.set(5, 3, "b");
  room.set(6, 3, "b");
  room.set(2, 5, "?");
  return room;
}

/** A regrowth scar: living rock already halfway back into an old cut. */
function regrowthScar() {
  const room = new Canvas(11, 8, "-");
  room.ellipse(5, 4, 5.4, 4, ".");
  room.rect(1, 7, 9, 7, "w");
  // The old cut is a straight floor line; the growth eating it is not straight at all.
  room.rect(3, 6, 9, 6, "h");
  room.ellipse(7, 5, 1.7, 1.1, "l");
  room.ellipse(3, 5, 1.1, 0.8, "l");
  room.set(7, 5, "1");
  room.set(2, 2, "?");
  return room;
}

// --- Province-agnostic ------------------------------------------------------

/**
 * A roof collapse. Host rock spilled across the floor from a hole above, which is the most
 * universally readable "something happened here" in any material.
 */
function collapse() {
  const room = new Canvas(12, 10, "-");
  room.ellipse(5.5, 5, 5.8, 4.8, ".");
  // The hole it fell through.
  room.rect(4, 0, 7, 1, ".");
  // The spill, heaped toward the middle and thinning outward.
  room.rect(2, 8, 10, 9, "#");
  room.ellipse(6, 7.6, 3.4, 1.6, "#");
  room.ellipse(6, 6.6, 1.8, 0.9, "#");
  room.set(6, 7, "?");
  room.set(3, 4, "?");
  return room;
}

/** A vent: a tall narrow shaft with a one-cell throat only a turned hull will pass. */
function vent() {
  const room = new Canvas(9, 12, "-");
  room.ellipse(4, 2.5, 3.4, 2.4, ".");
  room.ellipse(4, 9.5, 3.4, 2.4, ".");
  // The throat. One cell, which is the only width that actually constrains the hull -- at
  // two or three cells the drone simply turns and walks through without noticing.
  //
  // The sides are left *transparent* rather than painted: a shaft is a hole through rock
  // that is already there, and painting its walls both wasted a third of the room's area
  // and replaced whatever the province had put there with generic host rock.
  room.rect(4, 4, 4, 8, ".");
  // A collar of host rock at each mouth. Without it the shaft is a bare one-cell slot with
  // no edge treatment, which reads as a rendering glitch rather than as a worked vent -- and
  // a room with no authored material in it is not a building block.
  room.rect(3, 3, 5, 3, "#");
  room.rect(3, 9, 5, 9, "#");
  room.set(4, 3, ".");
  room.set(4, 9, ".");
  room.set(4, 6, "?");
  room.set(2, 2, "*");
  return room;
}

/** A lone survey stake, left by whoever came through before. Information, not treasure. */
function oldStake() {
  const room = new Canvas(9, 7, "-");
  room.ellipse(4, 3.4, 4.2, 3.2, ".");
  room.rect(1, 5, 7, 6, "#");
  // Persistent, so it survives any claim framed over it: a clue must never be destroyable
  // without the player knowing they destroyed it.
  room.set(4, 4, "T");
  room.set(4, 3, "4");
  room.set(7, 2, "*");
  return room;
}

/** A spoil heap: somebody worked here, cut what they wanted, and left the rest. */
function spoilHeap() {
  const room = new Canvas(11, 8, "-");
  room.ellipse(5, 4, 5.4, 4, ".");
  room.rect(1, 7, 9, 7, "#");
  // Two heaps of graded rubble and the flat cut face they came out of.
  room.rect(9, 2, 9, 5, "#");
  room.ellipse(3, 6, 1.7, 0.8, "#");
  room.ellipse(6, 6.2, 1.2, 0.6, "#");
  room.set(3, 6, "?");
  room.set(9, 3, "?");
  return room;
}

export const rooms = [
  { name: "karst-slate-shelf", tier: "feature", canvas: slateShelf() },
  { name: "karst-coal-pocket-b12", tier: "feature", canvas: coalPocket() },
  { name: "mirrorreef-facet-vein", tier: "feature", canvas: facetVein() },
  { name: "mirrorreef-charge-node-fixed-rot", tier: "feature", canvas: chargeNode() },
  { name: "rootwarren-bulb-cluster", tier: "feature", canvas: bulbCluster() },
  { name: "rootwarren-regrowth-scar", tier: "feature", canvas: regrowthScar() },
  { name: "any-collapse", tier: "feature", canvas: collapse() },
  { name: "any-vent-rot", tier: "feature", canvas: vent() },
  { name: "any-old-stake", tier: "feature", canvas: oldStake() },
  { name: "any-spoil-heap-b12", tier: "feature", canvas: spoilHeap() },
];
