// Rootwarren rooms.
//
// The province rule: living rock regrows into cleared cells on a bounded budget, and a
// spore bulb leaves a short-lived rebound membrane where it broke. So fast clearing can be
// worse than pruning, and the question a Rootwarren room poses is:
//
//   what should you deliberately leave standing?
//
// That makes Rootwarren the mirror of Karst. In Karst the non-liable stone is *free* to
// leave, so leaving is easy; here living rock is liable and regrows, so leaving costs
// health and clearing invites it back. The rooms below are built so that the greedy line
// is the wrong one.
//
// Materials: `w` sapwood is the 1-hit host, `l` living regrows, `b` spore bulbs leave
// membranes, `h` heartwood takes 3 hits and does neither -- it is the province's only
// genuinely stable rock, and therefore its structure.

import { Canvas } from "../../tools/canvas.mjs";

/**
 * Cells of living rock divided by heartwood ribs. Clear a whole cell and regrowth has a
 * clear run at refilling it; prune along the ribs and it has nowhere to spread from.
 */
function pruningCells() {
  const room = new Canvas(18, 9, "-");
  // A low broad cavity with a raised right end, so the bays are not all the same height.
  room.ellipse(8, 5.2, 7.4, 3.6, ".");
  room.ellipse(14, 4.2, 4, 4, ".");
  room.rect(1, 8, 16, 8, "w");
  // Three heartwood ribs rising from the floor, one cell thick, stopping short of the
  // roof. Expensive but stable -- and short enough that the chamber stays flyable.
  for (const x of [5, 9, 13]) room.rect(x, 4, x, 8, "h");
  // Living rock banked against the ribs, so each bay is its own decision. Kept low: the
  // decision is which bay to clear, not how to get through a wall of it.
  room.rect(3, 7, 4, 7, "l");
  room.rect(6, 6, 8, 7, "l");
  room.rect(10, 7, 12, 7, "l");
  room.rect(14, 6, 15, 7, "l");
  // The seam sits inside a rib: heartwood, so it is 3 hits and cannot regrow over.
  room.set(9, 5, "3");
  room.set(2, 3, "*");
  room.set(16, 3, "*");
  return room;
}

/**
 * A bulb gallery. Spore bulbs line the ceiling, so breaking them in the right order
 * leaves a run of membranes that keeps the ball alive above the floor.
 */
function bulbGallery() {
  const room = new Canvas(18, 9, "-");
  // A tall cavity, because this room is read top to bottom: bulbs above, floor below.
  room.ellipse(9, 4.4, 8.4, 4.4, ".");
  room.ellipse(9, 2.2, 6, 2.2, ".");
  room.rect(1, 8, 16, 8, "w");
  // The bulbs, spaced so their membranes overlap rather than abut. Each hangs from a
  // short sapwood stub rather than a full ceiling row -- the world supplies the roof, and
  // painting one over it costs the room a third of its air.
  for (const x of [3, 6, 9, 12, 15]) {
    room.set(x, 1, "w");
    room.set(x, 2, "b");
  }
  // Living rock creeping up the far wall.
  room.rect(15, 5, 16, 7, "l");
  // The cache is low and central: reachable only if a membrane keeps the ball up long
  // enough to work the floor.
  room.rect(8, 6, 10, 7, "w");
  room.set(9, 7, "1");
  room.set(4, 5, "*");
  return room;
}

/**
 * A feature-tier knot. Dense heartwood wrapped around a seam: three hits a cell, no
 * regrowth, no membranes. The most expensive small reward in the province, and the safest.
 */
function heartwoodKnot() {
  // Sized 13x11 rather than 11x9 on purpose: a ring of fixed thickness is a much larger
  // fraction of a small room, and at 11x9 this one was 34% painted and unflyable. The
  // smallest tier needs the most headroom, not the least.
  const room = new Canvas(13, 11, "-");
  room.ellipse(6, 5, 6, 5, ".");
  room.rect(1, 9, 11, 10, "w");
  // The knot as a *ring*, not a lump: heartwood shell, hollow inside, with a living core
  // bar holding the seam. Solid through would leave the ball nothing to work into.
  room.ellipse(6, 5, 3.4, 2.9, "h");
  room.ellipse(6, 5, 2.5, 1.9, ".");
  room.rect(5, 5, 7, 5, "l");
  room.set(6, 5, "3");
  room.set(2, 3, "*");
  return room;
}

/**
 * Creep: living rock reclaiming an old excavation. The straight machined edges are still
 * visible under it, which is the story, and the growth is thickest over the thing worth
 * having.
 */
function creep() {
  const room = new Canvas(18, 9, "-");
  room.ellipse(8.5, 4.4, 8.4, 4.2, ".");
  // The old cut. A full rectangle read as a plain box on the contact sheet, so the
  // machined edges are now *partial* -- two heartwood pit props and a cut floor, with the
  // roof left to the world. What sells "somebody was here" is the straight line meeting
  // an organic one, not a complete frame.
  room.rect(3, 7, 15, 7, "h");
  room.rect(4, 3, 4, 6, "h");
  room.rect(12, 2, 12, 6, "h");
  // Growth swallowing the props from the far end, thickest over the thing worth having.
  room.rect(13, 3, 15, 6, "l");
  room.rect(11, 5, 12, 6, "l");
  room.rect(5, 6, 7, 6, "l");
  // A spore bulb where the growth is thinnest, so clearing it opens the route in.
  room.set(9, 6, "b");
  // The cache is behind the growth at the far end.
  room.set(14, 5, "1");
  room.set(7, 3, "*");
  room.set(5, 5, "4");
  return room;
}

/**
 * A hall: a hollow bole. One enormous heartwood ring lined with living rock, so the hall
 * is structurally safe but everything soft in it will come back.
 */
function hollowBole() {
  const room = new Canvas(36, 18, "-");
  room.ellipse(18, 9, 17.5, 8.6, ".");
  room.rect(2, 16, 33, 17, "w");
  // The bole wall: a heartwood ring, one cell thick, broken at both sides so the hall has
  // two ways through rather than being a sealed drum.
  room.ellipse(18, 9, 15, 8, "h");
  room.ellipse(18, 9, 13.6, 6.8, ".");
  room.rect(2, 7, 5, 11, ".");
  room.rect(30, 7, 33, 11, ".");
  // Living rock lining the inside of the ring, thickest at the base.
  room.rect(6, 13, 29, 14, "l");
  room.rect(6, 5, 8, 12, "l");
  room.rect(27, 5, 29, 12, "l");
  // Bulbs high in the bole, where their membranes do the most good.
  for (const x of [11, 18, 25]) room.set(x, 4, "b");
  // Two seams in the heartwood ring itself: stable, expensive, and worth the trip.
  room.set(18, 16, "3");
  room.set(8, 13, "3");
  room.set(18, 7, "2");
  for (const [x, y] of [[13, 11], [23, 9], [30, 13], [6, 9]]) room.set(x, y, "*");
  return room;
}

export const rooms = [
  { name: "rootwarren-pruning-cells", tier: "chamber", canvas: pruningCells() },
  { name: "rootwarren-bulb-gallery", tier: "chamber", canvas: bulbGallery() },
  { name: "rootwarren-heartwood-knot-rot", tier: "feature", canvas: heartwoodKnot() },
  { name: "rootwarren-creep-b34", tier: "chamber", canvas: creep() },
  { name: "rootwarren-hollow-bole-b34", tier: "hall", canvas: hollowBole() },
];
