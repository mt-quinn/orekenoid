// Mirrorreef rooms.
//
// The province rule: a facet reflects against a *fixed diagonal*, turning the ball by a
// right angle, and a charged facet cascades the break into adjacent crystal. So the
// question a Mirrorreef room must pose is always the same one, in a new shape:
//
//   does your claim heading agree with the lattice, or fight it?
//
// A facet wall of mixed axes is noise. Every wall here therefore pins its axis with the
// `/` and `\` glyphs, so the geometry is legible before the serve and the player can read
// the room rather than guess it. `f` is reserved for scattered crystal where incoherence
// is the point.
//
// Reef rock (`r`) is the 1-hit host and is liable, so a Mirrorreef room's load is real:
// leaving reef standing costs health in a way leaving Karst slate never does.

import { Canvas } from "../../tools/canvas.mjs";

/**
 * One coherent lattice wall across the chamber, with the payoff behind it.
 * Frame along the wall and the turns are predictable; frame across it and every facet
 * throws the ball back at you.
 */
function latticeWall() {
  const room = new Canvas(18, 9, "-");
  // A long low cavity rather than a round one: this room is read left to right.
  room.ellipse(9, 5, 8.6, 3.6, ".");
  room.ellipse(5, 3.4, 4, 2.6, ".");
  room.rect(1, 8, 16, 8, "r");
  // Two *shallow* lattice shelves on the same axis, stepped, rather than one steep wall
  // corner to corner. The steep version was geometrically identical to the Karst slate
  // bank -- same room, different palette -- which a contact sheet makes obvious and
  // reading the source never does. A shallow plane also turns the ball along the room
  // instead of straight back, which is the whole reason to align a claim to a lattice.
  room.band(2, 6, 9, 4, 1, "/");
  room.band(9, 4, 16, 2, 1, "/");
  // Reef piers under each shelf, so they read as held up rather than floating.
  room.rect(4, 7, 5, 7, "r");
  room.rect(11, 5, 12, 7, "r");
  // The seam sits under the upper shelf, in the pier: reaching it means working the
  // lattice rather than going over it.
  room.set(11, 6, "3");
  room.set(3, 3, "*");
  room.set(15, 5, "*");
  return room;
}

/**
 * A cascade chain. Charged facets in a coherent line through plain crystal, so one
 * well-aimed break runs the whole row -- if the claim is framed along the axis.
 */
function cascadeChain() {
  const room = new Canvas(18, 9, "-");
  // A cavity that rises to the right, following the chain.
  room.ellipse(6, 5, 5.6, 3.8, ".");
  room.ellipse(13, 4, 5.2, 4, ".");
  room.rect(1, 8, 16, 8, "r");
  // The chain, on the NW-SE axis so it reads as the opposite lattice to `latticeWall`.
  for (let i = 0; i < 7; i++) room.set(4 + i, 6 - i % 2, "\\");
  // Two charged seeds, spaced so either end can start the run.
  room.set(4, 6, "&");
  room.set(10, 6, "&");
  // A reef shelf under the chain gives the ball somewhere to come back from.
  room.rect(3, 7, 13, 7, "r");
  room.set(15, 3, "*");
  room.set(2, 3, "*");
  // The cascade's reward sits at the far end of the chain, not above it.
  room.rect(14, 5, 15, 6, "r");
  room.set(15, 6, "3");
  return room;
}

/**
 * A feature-tier funnel. Two facet walls on opposing axes form a V that steers anything
 * entering the top down to a single buried cache.
 */
function mirrorFunnel() {
  const room = new Canvas(12, 10, "-");
  room.ellipse(5.5, 4.5, 5.6, 4.6, ".");
  // The two arms. Opposing axes, so both walls turn the ball inward.
  room.band(1, 1, 5, 7, 1, "\\");
  room.band(10, 1, 6, 7, 1, "/");
  // The throat, and the cache beneath it.
  room.rect(4, 8, 7, 9, "r");
  room.set(5, 8, "1");
  room.set(5, 2, "*");
  return room;
}

/**
 * A warning room. Two lattices meet head-on, so no single claim heading is right and the
 * load is high whichever way it is framed. The reward is correspondingly good.
 */
function crossedLattice() {
  const room = new Canvas(18, 9, "-");
  // A wide waisted cavity: two bulges meeting where the lattices collide.
  room.ellipse(5, 4.4, 5, 4.2, ".");
  room.ellipse(13, 4.4, 5, 4.2, ".");
  room.ellipse(9, 4.4, 2.4, 3.2, ".");
  room.rect(1, 8, 16, 8, "r");
  // Left half NE-SW, right half NW-SE, meeting at the middle. Three ribs a side rather
  // than four, and stopped short of the roof: the room has to stay flyable, and the
  // collision at the centre is the point rather than the quantity of crystal.
  for (let i = 0; i < 3; i++) room.band(2 + i * 3, 7, 4 + i * 3, 3, 1, "/");
  for (let i = 0; i < 3; i++) room.band(16 - i * 3, 7, 14 - i * 3, 3, 1, "\\");
  // Charged crystal exactly on the seam between the two lattices, where a cascade could
  // run either way -- the one genuinely unpredictable break in the province.
  room.set(9, 4, "%");
  room.set(9, 5, "&");
  // A cache behind the collision, and an anomaly hanging above it.
  room.rect(8, 1, 10, 2, "r");
  room.set(9, 1, "1");
  room.set(4, 3, "*");
  room.set(14, 3, "*");
  return room;
}

/**
 * A hall: a crystal cathedral. Facet ribs alternate axis bay by bay, so each bay plays
 * differently and the whole hall is a row of small distinct problems rather than one big
 * one. Charged crystal sits at the apex, out of easy reach.
 */
function cathedral() {
  const room = new Canvas(36, 18, "-");
  room.ellipse(18, 9, 17.5, 8.6, ".");
  room.rect(2, 16, 33, 17, "r");
  // Six ribs, alternating axis. Each rib is one cell so the hall stays flyable.
  for (let bay = 0; bay < 6; bay++) {
    const x = 4 + bay * 6;
    const glyph = bay % 2 === 0 ? "/" : "\\";
    room.band(x, 15, x + 3, 5, 1, glyph);
    room.band(x + 4, 15, x + 1, 5, 1, glyph);
  }
  // A reef vault, so the roof reads as load-bearing.
  room.line(4, 4, 17, 2, "r");
  room.line(18, 2, 32, 4, "r");
  // The apex charge: conspicuous, and only reachable by a claim that reaches the roof.
  room.set(17, 3, "%");
  room.set(18, 3, "&");
  // Two seams, both buried in rock rather than hanging: one in the floor, one in a rib.
  room.set(11, 17, "3");
  room.set(27, 13, "3");
  room.set(18, 6, "2");
  for (const [x, y] of [[6, 12], [15, 14], [24, 7], [32, 12]]) room.set(x, y, "*");
  return room;
}

export const rooms = [
  { name: "mirrorreef-lattice-wall", tier: "chamber", canvas: latticeWall() },
  { name: "mirrorreef-cascade-chain-fixed", tier: "chamber", canvas: cascadeChain() },
  { name: "mirrorreef-mirror-funnel", tier: "feature", canvas: mirrorFunnel() },
  { name: "mirrorreef-crossed-lattice-b34-fixed-rot", tier: "chamber", canvas: crossedLattice() },
  { name: "mirrorreef-cathedral-b34", tier: "hall", canvas: cathedral() },
];
